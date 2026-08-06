import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const API_PORT = Number(process.env.API_PORT || 8787);
// Never fall back to a known/default signing key — that would let anyone forge
// tokens (including admin ones). In production a strong secret is mandatory; in
// local dev we generate an ephemeral one (sessions reset on restart).
let JWT_SECRET = process.env.APP_JWT_SECRET || '';
if (JWT_SECRET === 'change-me-in-production') {
    throw new Error('APP_JWT_SECRET still uses the insecure default. Set a strong, unique secret.');
}
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('APP_JWT_SECRET must be set to a strong secret in production.');
    }
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    // eslint-disable-next-line no-console
    console.warn('[pontaj] APP_JWT_SECRET not set — using an ephemeral dev secret. Sessions reset on restart.');
} else if (JWT_SECRET.length < 16) {
    throw new Error('APP_JWT_SECRET is too short; use at least 16 characters.');
}
const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

const ENTITY_NAMES = [
    'User',
    'Operator',
    'Attendance',
    'PracticeSchedule',
    'Schedule',
    'PracticePeriod',
    'ClassPracticePlan',
    'Classroom',
    'AuditLog',
];
const PUSH_CORE_METHODS = new Set(['SendPushNotification', 'SendPush', 'PushNotification']);
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_REFRESH_BUFFER_MS = 60_000;
let cachedFcmToken = { value: '', expiresAt: 0 };

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = 'id') {
    return `${prefix}_${crypto.randomUUID()}`;
}

// High-entropy temporary password (avoids the old predictable Tmp###### form).
function generateTempPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(14);
    const body = [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
    return `Tmp-${body}`;
}

function sanitizeDeviceText(value, maxLength) {
    const text = String(value ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function parseNumber(value, fallbackValue) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallbackValue;
}

function compareValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
}

function applySort(items, sort) {
    if (!sort) return [...items];
    const desc = String(sort).startsWith('-');
    const field = desc ? String(sort).slice(1) : String(sort);
    return [...items].sort((left, right) => {
        const result = compareValues(left?.[field], right?.[field]);
        return desc ? -result : result;
    });
}

function applyLimitSkip(items, limit, skip) {
    const start = parseNumber(skip, 0);
    const parsedLimit = parseNumber(limit, 0);
    const end = parsedLimit > 0 ? start + parsedLimit : undefined;
    return items.slice(start, end);
}

function applyFields(items, fields) {
    if (!fields) return items;
    const fieldList = Array.isArray(fields)
        ? fields
        : String(fields)
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);

    if (fieldList.length === 0) return items;

    return items.map((item) => {
        const picked = {};
        fieldList.forEach((field) => {
            picked[field] = item?.[field];
        });
        return picked;
    });
}

function matchesQuery(item, query) {
    if (!query || typeof query !== 'object') return true;
    return Object.entries(query).every(([key, value]) => item?.[key] === value);
}

function stripSensitiveUserFields(user) {
    if (!user) return user;
    const {
        passwordHash, password, resetTokenHash, resetTokenExpiresAt, ...safeUser
    } = user;
    return safeUser;
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256Hex(input) {
    return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function randomToken(byteLength = 24) {
    return crypto.randomBytes(byteLength).toString('hex');
}

function constantTimeEqual(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8');
    const bufB = Buffer.from(String(b || ''), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// Login brute-force protection: after MAX_LOGIN_ATTEMPTS failures for the same
// account within LOGIN_ATTEMPT_WINDOW_MS, further attempts are locked out for
// the remainder of that window. In-memory only (fine for a single-process dev
// server / small production deployment; resets on restart).
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const loginAttemptsByEmail = new Map();

function checkLoginRateLimit(email) {
    const entry = loginAttemptsByEmail.get(email);
    if (!entry) return { limited: false };
    if (Date.now() - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
        loginAttemptsByEmail.delete(email);
        return { limited: false };
    }
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
        return {
            limited: true,
            retryAfterSeconds: Math.ceil((entry.windowStart + LOGIN_ATTEMPT_WINDOW_MS - Date.now()) / 1000),
        };
    }
    return { limited: false };
}

function recordLoginFailure(email) {
    const entry = loginAttemptsByEmail.get(email);
    if (!entry || Date.now() - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
        loginAttemptsByEmail.set(email, { count: 1, windowStart: Date.now() });
        return;
    }
    entry.count += 1;
}

function clearLoginRateLimit(email) {
    loginAttemptsByEmail.delete(email);
}

// Send a password-reset email via Resend. Throws if not configured / on failure.
async function sendResetEmail({ to, link, fullName }) {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
        throw Object.assign(new Error('Email provider not configured.'), { status: 503 });
    }
    const from = String(process.env.RESEND_FROM || 'Pontaj Practica <onboarding@resend.dev>');
    const greeting = fullName ? `Salut, ${fullName},` : 'Salut,';
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject: 'Resetare parola - Pontaj Practica',
            html: `<p>${greeting}</p>`
                + '<p>Ai cerut resetarea parolei pentru contul tau Pontaj Practica.</p>'
                + `<p><a href="${link}">Apasa aici pentru a seta o parola noua</a></p>`
                + '<p>Linkul expira in 1 ora. Daca nu ai cerut tu resetarea, ignora acest email.</p>',
        }),
    });
    if (!response.ok) {
        const detail = await response.text();
        throw Object.assign(new Error('Email send failed.'), { status: 502, details: detail });
    }
}

function sanitizeEntity(entityName, item) {
    if (entityName === 'User') {
        return stripSensitiveUserFields(item);
    }
    return item;
}

function createDefaultState() {
    const operator = {
        id: 'op_demo_1',
        name: 'Operator Demo',
        address: 'Str. Exemplu 1, Bucuresti',
        lat: 44.4268,
        lng: 26.1025,
        radiusMeters: 500,
        isActive: true,
        created_date: nowIso(),
    };

    const admin = {
        id: 'admin_demo_1',
        role: 'admin',
        full_name: 'Admin Demo',
        email: 'admin.demo@local.test',
        className: '12A',
        specialization: 'Coordonare',
        operatorId: operator.id,
        isActive: true,
        created_date: nowIso(),
        passwordHash: bcrypt.hashSync('admin123', 10),
    };

    const secondAdmin = {
        id: 'admin_demo_2',
        role: 'admin',
        full_name: 'Admin Demo 2',
        email: 'admin2.demo@local.test',
        className: '12B',
        specialization: 'Coordonare',
        operatorId: operator.id,
        isActive: true,
        created_date: nowIso(),
        passwordHash: bcrypt.hashSync('admin123', 10),
    };

    const student = {
        id: 'user_demo_1',
        role: 'user',
        full_name: 'Elev Demo',
        email: 'elev.demo@local.test',
        phoneNumber: '+40740111222',
        className: '10A',
        specialization: 'Informatica',
        operatorId: operator.id,
        isActive: true,
        created_date: nowIso(),
        passwordHash: bcrypt.hashSync('elev123', 10),
    };

    return {
        entities: {
            User: [admin, secondAdmin, student],
            Operator: [operator],
            Attendance: [],
            PracticeSchedule: [],
            Schedule: [],
            PracticePeriod: [],
            ClassPracticePlan: [],
            Classroom: [],
            AuditLog: [],
        },
        navigationLogs: [],
    };
}

function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultState(), null, 2), 'utf8');
    }
}

function normalizeState(rawState) {
    const fallback = createDefaultState();
    const source = rawState && typeof rawState === 'object' ? rawState : fallback;
    const entities = source.entities && typeof source.entities === 'object'
        ? source.entities
        : fallback.entities;

    const normalizedEntities = {};
    ENTITY_NAMES.forEach((entityName) => {
        const records = entities[entityName];
        normalizedEntities[entityName] = Array.isArray(records) ? records : [];
    });

    // Ensure required demo accounts exist in persisted snapshots.
    const requiredDemoAccounts = [
        'admin.demo@local.test',
        'admin2.demo@local.test',
        'elev.demo@local.test',
    ];
    requiredDemoAccounts.forEach((demoEmail) => {
        const hasUser = normalizedEntities.User.some(
            (entry) => normalizeEmail(entry.email) === demoEmail
        );
        if (hasUser) return;

        const fallbackUser = fallback.entities.User.find(
            (entry) => normalizeEmail(entry.email) === demoEmail
        );
        if (fallbackUser) {
            normalizedEntities.User.unshift(fallbackUser);
        }
    });

    // Keep a safety net if all admins were deleted manually.
    if (!normalizedEntities.User.some((entry) => entry.role === 'admin' && entry.isActive !== false)) {
        const defaultAdmin = fallback.entities.User.find((entry) => entry.role === 'admin');
        if (defaultAdmin) {
            normalizedEntities.User.unshift(defaultAdmin);
        }
    }

    // Backfill hashes for older data snapshots.
    normalizedEntities.User = normalizedEntities.User.map((entry) => {
        if (!entry.passwordHash) {
            return {
                ...entry,
                passwordHash: bcrypt.hashSync(entry.role === 'admin' ? 'admin123' : 'elev123', 10),
            };
        }
        return entry;
    });

    return {
        entities: normalizedEntities,
        navigationLogs: Array.isArray(source.navigationLogs) ? source.navigationLogs : [],
    };
}

function loadState() {
    ensureDataFile();
    try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return normalizeState(JSON.parse(raw));
    } catch (error) {
        return createDefaultState();
    }
}

const state = loadState();

function persistState() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getEntityStore(entityName) {
    if (!ENTITY_NAMES.includes(entityName)) {
        return null;
    }
    if (!Array.isArray(state.entities[entityName])) {
        state.entities[entityName] = [];
    }
    return state.entities[entityName];
}

function getUserById(userId) {
    return state.entities.User.find((entry) => entry.id === userId) || null;
}

function getUserByEmail(email) {
    const normalized = normalizeEmail(email);
    return state.entities.User.find((entry) => normalizeEmail(entry.email) === normalized) || null;
}

function normalizePrivateKey(value) {
    return String(value || '').replace(/\\n/g, '\n').trim();
}

function getFcmConfig() {
    const projectId = String(process.env.FCM_PROJECT_ID || '').trim();
    const clientEmail = String(process.env.FCM_CLIENT_EMAIL || '').trim();
    const privateKey = normalizePrivateKey(process.env.FCM_PRIVATE_KEY || '');
    return {
        projectId,
        clientEmail,
        privateKey,
        isConfigured: Boolean(projectId && clientEmail && privateKey),
    };
}

function normalizePushDataPayload(input) {
    if (!input || typeof input !== 'object') return undefined;
    const normalized = {};
    Object.entries(input).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        normalized[String(key)] = typeof value === 'string' ? value : JSON.stringify(value);
    });
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function createServiceAccountAssertion(clientEmail, privateKey) {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return jwt.sign(
        {
            iss: clientEmail,
            scope: FCM_SCOPE,
            aud: GOOGLE_OAUTH_TOKEN_URL,
            iat: nowInSeconds,
            exp: nowInSeconds + 3600,
        },
        privateKey,
        { algorithm: 'RS256' }
    );
}

async function getFcmAccessToken() {
    if (cachedFcmToken.value && Date.now() < cachedFcmToken.expiresAt - FCM_TOKEN_REFRESH_BUFFER_MS) {
        return cachedFcmToken.value;
    }

    const config = getFcmConfig();
    if (!config.isConfigured) {
        throw Object.assign(new Error('FCM provider not configured.'), { status: 503 });
    }

    const assertion = createServiceAccountAssertion(config.clientEmail, config.privateKey);
    const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
    });

    const rawBody = await tokenResponse.text();
    let payload = {};
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        payload = { rawBody };
    }

    if (!tokenResponse.ok || !payload?.access_token) {
        throw Object.assign(new Error(payload?.error_description || payload?.error || 'Cannot obtain FCM access token.'), {
            status: tokenResponse.status || 500,
            details: payload,
        });
    }

    const expiresInSeconds = Number(payload.expires_in || 3600);
    cachedFcmToken = {
        value: payload.access_token,
        expiresAt: Date.now() + Math.max(60, expiresInSeconds) * 1000,
    };
    return cachedFcmToken.value;
}

async function sendPushWithFcm({ token, title, body, data }) {
    const config = getFcmConfig();
    if (!config.isConfigured) {
        throw Object.assign(new Error('FCM provider not configured.'), { status: 503 });
    }

    const accessToken = await getFcmAccessToken();
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`;
    const normalizedData = normalizePushDataPayload(data);
    const notificationLink = String(data?.link || '').trim();
    const messagePayload = {
        token,
        notification: {
            title: String(title || 'Reminder prezenta practica'),
            body: String(body || ''),
        },
        data: normalizedData,
        android: {
            priority: 'high',
        },
    };

    if (notificationLink) {
        messagePayload.webpush = {
            headers: {
                Urgency: 'high',
            },
            fcm_options: {
                link: notificationLink,
            },
        };
    }

    const messageResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: messagePayload,
        }),
    });

    const rawBody = await messageResponse.text();
    let payload = {};
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        payload = { rawBody };
    }

    if (!messageResponse.ok) {
        if (messageResponse.status === 401 || messageResponse.status === 403) {
            cachedFcmToken = { value: '', expiresAt: 0 };
        }
        throw Object.assign(new Error(payload?.error?.message || 'FCM send failed.'), {
            status: messageResponse.status || 500,
            details: payload,
        });
    }

    return payload;
}

function resolvePushTargetToken(payload) {
    const directToken = String(payload?.token || '').trim();
    if (directToken) return directToken;
    const userId = String(payload?.userId || '').trim();
    if (!userId) return '';
    const user = getUserById(userId);
    if (!user) return '';
    return String(user.pushToken || user.deviceToken || '').trim();
}

const VALIDATION_STATUS = {
    VALIDA: 'VALIDA',
    INVALIDA: 'INVALIDA',
};

const VALIDATION_REASON = {
    OK: 'OK',
    IN_AFARA_RAZEI: 'IN_AFARA_RAZEI',
    IN_AFARA_INTERVALULUI: 'IN_AFARA_INTERVALULUI',
    GPS_SLAB: 'GPS_SLAB',
    DUPLICAT_ZI: 'DUPLICAT_ZI',
    ELEV_INACTIV: 'ELEV_INACTIV',
    FARA_OPERATOR: 'FARA_OPERATOR',
    LOCATIE_FALSA: 'LOCATIE_FALSA',
};

const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const APP_TIME_ZONE = 'Europe/Bucharest';
const WEEKDAY_INDEX_BY_SHORT_NAME = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};
const APP_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});
const DAY_ALIASES = {
    monday: 'monday',
    luni: 'monday',
    tuesday: 'tuesday',
    marti: 'tuesday',
    wednesday: 'wednesday',
    miercuri: 'wednesday',
    thursday: 'thursday',
    joi: 'thursday',
    friday: 'friday',
    vineri: 'friday',
    saturday: 'saturday',
    sambata: 'saturday',
    sunday: 'sunday',
    duminica: 'sunday',
};

function normalizeDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getAppTimeParts(value = new Date()) {
    const parts = Object.fromEntries(
        APP_TIME_FORMATTER
            .formatToParts(normalizeDate(value))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );
    const hours = Number(parts.hour);
    const minutes = Number(parts.minute);
    const weekdayIndex = WEEKDAY_INDEX_BY_SHORT_NAME[parts.weekday];

    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        dayName: WEEK_DAYS[weekdayIndex] || null,
        minutes: ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(minutes) ? minutes : 0),
    };
}

function toDateKey(value = new Date()) {
    return getAppTimeParts(value).dateKey;
}

function getAppDayName(value = new Date()) {
    return getAppTimeParts(value).dayName;
}

function getAppMinutes(value = new Date()) {
    return getAppTimeParts(value).minutes;
}

function addDaysToDateKey(dateKey, days) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return toDateKey();

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
    return date.toISOString().split('T')[0];
}

function getDayNameFromDateKey(dateKey) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return getAppDayName();

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return WEEK_DAYS[date.getUTCDay()];
}

function normalizeDayToken(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    return DAY_ALIASES[normalized] || normalized;
}

function includesDay(daysOfWeek, dayName) {
    const normalizedDayName = normalizeDayToken(dayName);
    return Array.isArray(daysOfWeek) && daysOfWeek.some((entry) => normalizeDayToken(entry) === normalizedDayName);
}

function isWithinDateRange(dateKey, startDate, endDate) {
    if (!startDate && !endDate) return true;
    if (startDate && dateKey < startDate) return false;
    if (endDate && dateKey > endDate) return false;
    return true;
}

function toMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const parts = timeValue.split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return (hours * 60) + minutes;
}

function normalizeClassName(value) {
    return String(value || '').trim().toUpperCase();
}

function getBestClassPlan(classPlans, userClassName, dateKey) {
    return (classPlans || [])
        .filter((plan) => normalizeClassName(plan?.className) === normalizeClassName(userClassName))
        .filter((plan) => isWithinDateRange(dateKey, plan?.validFrom, plan?.validTo))
        .sort((left, right) => Number(right?.priority || 0) - Number(left?.priority || 0))[0];
}

function getDirectPracticeScheduleCandidates(practiceSchedules, user, operator) {
    return (practiceSchedules || [])
        .filter((item) => item?.isActive !== false)
        .filter((item) => !item?.className || normalizeClassName(item.className) === normalizeClassName(user?.className))
        .filter((item) => !item?.operatorId || item.operatorId === operator?.id)
        .filter((item) => !Array.isArray(item?.studentUserIds) || item.studentUserIds.length === 0 || item.studentUserIds.includes(user?.id))
        .filter((item) => Array.isArray(item?.daysOfWeek) && item.daysOfWeek.length > 0)
        .filter((item) => item?.checkinStartTime && item?.checkinEndTime);
}

function findDirectPracticeScheduleForDate(candidates, dateKey, dayName) {
    return (candidates || []).find((item) =>
        isWithinDateRange(dateKey, item?.validFrom, item?.validTo)
        && includesDay(item?.daysOfWeek, dayName)
    ) || null;
}

function findNextDirectPracticeScheduleSlot(candidates, now = new Date()) {
    const startDateKey = toDateKey(now);

    for (let offset = 0; offset < 120; offset += 1) {
        const probeDateKey = addDaysToDateKey(startDateKey, offset);
        const probeDayName = getDayNameFromDateKey(probeDateKey);
        const schedule = findDirectPracticeScheduleForDate(candidates, probeDateKey, probeDayName);
        if (!schedule) continue;
        return {
            dateKey: probeDateKey,
            start: schedule.checkinStartTime,
            end: schedule.checkinEndTime,
            source: 'practice_schedule',
        };
    }

    return null;
}

function resolveScheduleTimeWindow({ date, dateKey, user, operator, classPlans, practiceSchedules, schedules }) {
    const dayName = getAppDayName(date);

    const bestPlan = getBestClassPlan(classPlans, user?.className, dateKey);
    if (bestPlan) {
        const schedule = (practiceSchedules || []).find((item) =>
            item?.id === bestPlan.scheduleId
            && item?.isActive !== false
            && isWithinDateRange(dateKey, item?.validFrom, item?.validTo)
            && includesDay(item?.daysOfWeek, dayName)
            && (!item?.className || normalizeClassName(item.className) === normalizeClassName(user?.className))
            && (!item?.operatorId || item.operatorId === operator?.id)
            && (!Array.isArray(item?.studentUserIds) || item.studentUserIds.length === 0 || item.studentUserIds.includes(user?.id))
        );

        if (schedule?.checkinStartTime && schedule?.checkinEndTime) {
            return {
                start: schedule.checkinStartTime,
                end: schedule.checkinEndTime,
                source: 'practice_schedule',
            };
        }
    }

    const directPracticeSchedule = findDirectPracticeScheduleForDate(
        getDirectPracticeScheduleCandidates(practiceSchedules, user, operator),
        dateKey,
        dayName
    );

    if (directPracticeSchedule?.checkinStartTime && directPracticeSchedule?.checkinEndTime) {
        return {
            start: directPracticeSchedule.checkinStartTime,
            end: directPracticeSchedule.checkinEndTime,
            source: 'practice_schedule_direct',
        };
    }

    const scheduleCandidates = (schedules || [])
        .filter((item) => item?.isActive !== false)
        .filter((item) => item?.operatorId === operator?.id)
        .filter((item) => !item?.className || normalizeClassName(item.className) === normalizeClassName(user?.className))
        .filter((item) => includesDay(item?.daysOfWeek, dayName));

    if (scheduleCandidates.length > 0) {
        const preferred = scheduleCandidates.find(
            (item) => normalizeClassName(item?.className) === normalizeClassName(user?.className)
        ) || scheduleCandidates[0];
        if (preferred?.startTime && preferred?.endTime) {
            return {
                start: preferred.startTime,
                end: preferred.endTime,
                source: 'operator_schedule',
            };
        }
    }

    return null;
}

function getActivePeriod(periods, dateKey, user, operator) {
    return (periods || [])
        .filter((period) => period?.isActive !== false)
        .filter((period) => isWithinDateRange(dateKey, period?.startDate, period?.endDate))
        .filter((period) => !period?.className || normalizeClassName(period.className) === normalizeClassName(user?.className))
        .filter((period) => !period?.operatorId || period.operatorId === operator?.id)
        .sort((left, right) => {
            const leftSpecificity = Number(Boolean(left?.className)) + Number(Boolean(left?.operatorId));
            const rightSpecificity = Number(Boolean(right?.className)) + Number(Boolean(right?.operatorId));
            if (leftSpecificity !== rightSpecificity) {
                return rightSpecificity - leftSpecificity;
            }
            return String(right?.startDate || '').localeCompare(String(left?.startDate || ''));
        })[0];
}

function findNextPeriod(periods, dateKey, user, operator) {
    return (periods || [])
        .filter((period) => period?.isActive !== false)
        .filter((period) => period?.startDate && period.startDate > dateKey)
        .filter((period) => !period?.className || normalizeClassName(period.className) === normalizeClassName(user?.className))
        .filter((period) => !period?.operatorId || period.operatorId === operator?.id)
        .sort((left, right) => String(left?.startDate || '').localeCompare(String(right?.startDate || '')))[0] || null;
}

function resolvePeriodTimeWindow(activePeriod) {
    if (activePeriod?.checkinStartTime && activePeriod?.checkinEndTime) {
        return {
            start: activePeriod.checkinStartTime,
            end: activePeriod.checkinEndTime,
            source: 'practice_period',
        };
    }
    return null;
}

function getAttendanceWindowForUser({
    now = new Date(),
    user,
    operator,
    periods = [],
    classPlans = [],
    practiceSchedules = [],
    schedules = [],
}) {
    const dateKey = toDateKey(now);
    const dayName = getAppDayName(now);
    const hasPeriodsConfigured = (periods || []).length > 0;
    const activePeriod = hasPeriodsConfigured ? getActivePeriod(periods, dateKey, user, operator) : null;
    const hasActivePeriod = !hasPeriodsConfigured || Boolean(activePeriod);
    const nextPeriod = hasPeriodsConfigured && !activePeriod ? findNextPeriod(periods, dateKey, user, operator) : null;

    const directPracticeScheduleCandidates = getDirectPracticeScheduleCandidates(practiceSchedules, user, operator);
    const hasPracticeScheduleConstraints = directPracticeScheduleCandidates.length > 0;
    const nextDirectPracticeSlot = findNextDirectPracticeScheduleSlot(directPracticeScheduleCandidates, now);
    const scheduleWindow = resolveScheduleTimeWindow({
        date: now,
        dateKey,
        user,
        operator,
        classPlans,
        practiceSchedules,
        schedules,
    });

    const timeWindow = resolvePeriodTimeWindow(activePeriod) || scheduleWindow || null;

    let isWithinTimeWindow = true;
    let nextCheckinSlot = nextDirectPracticeSlot;
    if (timeWindow?.start && timeWindow?.end) {
        const nowMinutes = getAppMinutes(now);
        const startMinutes = toMinutes(timeWindow.start);
        const endMinutes = toMinutes(timeWindow.end);
        if (
            startMinutes !== null
            && endMinutes !== null
            && (nowMinutes < startMinutes || nowMinutes > endMinutes)
        ) {
            isWithinTimeWindow = false;
        }

        if (startMinutes !== null && endMinutes !== null && nowMinutes <= endMinutes) {
            nextCheckinSlot = {
                dateKey,
                start: timeWindow.start,
                end: timeWindow.end,
                source: timeWindow.source || 'schedule',
            };
        }
    } else if (hasPracticeScheduleConstraints || hasPeriodsConfigured) {
        isWithinTimeWindow = false;
    }

    if (!nextCheckinSlot && nextPeriod?.startDate) {
        nextCheckinSlot = {
            dateKey: nextPeriod.startDate,
            start: nextPeriod.checkinStartTime || null,
            end: nextPeriod.checkinEndTime || null,
            source: 'practice_period',
        };
    }

    return {
        hasPeriodsConfigured,
        hasActivePeriod,
        hasPracticeScheduleConstraints,
        timeWindow,
        nextCheckinSlot,
        isWithinTimeWindow,
    };
}

function buildValidationResult(overrides = {}) {
    return {
        validationStatus: VALIDATION_STATUS.VALIDA,
        validationReason: VALIDATION_REASON.OK,
        validationMessage: 'Prezenta a fost validata automat.',
        requiresReview: false,
        checkinWindowStart: null,
        checkinWindowEnd: null,
        allowedRadiusMeters: null,
        ...overrides,
    };
}

function validateAttendanceAttemptServer({
    now = new Date(),
    user,
    operator,
    existingAttendances = [],
    periods = [],
    classPlans = [],
    practiceSchedules = [],
    schedules = [],
    distanceMeters,
    accuracyMeters,
}) {
    const windowInfo = getAttendanceWindowForUser({
        now,
        user,
        operator,
        periods,
        classPlans,
        practiceSchedules,
        schedules,
    });
    const allowedRadiusMeters = Number(operator?.radiusMeters) || 200;

    if (!user?.id || user?.isActive === false) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.ELEV_INACTIV,
            validationMessage: 'Contul elevului este inactiv.',
            allowedRadiusMeters,
        });
    }

    if (!operator?.id) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.FARA_OPERATOR,
            validationMessage: 'Nu exista operator alocat pentru elev.',
            allowedRadiusMeters,
        });
    }

    if ((existingAttendances || []).length > 0) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.DUPLICAT_ZI,
            validationMessage: 'Exista deja o prezenta inregistrata pentru azi.',
            allowedRadiusMeters,
        });
    }

    if ((windowInfo.hasPeriodsConfigured && !windowInfo.hasActivePeriod) || (windowInfo.hasPracticeScheduleConstraints && !windowInfo.timeWindow)) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: 'Nu exista interval activ pentru pontaj acum.',
            allowedRadiusMeters,
        });
    }

    const timeWindow = windowInfo.timeWindow;
    if (!windowInfo.isWithinTimeWindow && timeWindow?.start && timeWindow?.end) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: `Pontaj permis doar intre ${timeWindow.start} si ${timeWindow.end}.`,
            checkinWindowStart: timeWindow.start,
            checkinWindowEnd: timeWindow.end,
            allowedRadiusMeters,
        });
    }

    if (!Number.isFinite(accuracyMeters) || accuracyMeters > 120) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.GPS_SLAB,
            validationMessage: Number.isFinite(accuracyMeters)
                ? `Semnal GPS slab (±${Math.round(accuracyMeters)}m).`
                : 'Precizia semnalului GPS lipseste sau este invalida.',
            requiresReview: true,
            checkinWindowStart: timeWindow?.start || null,
            checkinWindowEnd: timeWindow?.end || null,
            allowedRadiusMeters,
        });
    }

    if (!Number.isFinite(distanceMeters) || distanceMeters > allowedRadiusMeters) {
        return buildValidationResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_RAZEI,
            validationMessage: Number.isFinite(distanceMeters)
                ? `Distanta prea mare: ${distanceMeters}m (maxim permis ${allowedRadiusMeters}m).`
                : 'Nu s-a putut calcula distanta fata de operator (verifica locatia operatorului).',
            checkinWindowStart: timeWindow?.start || null,
            checkinWindowEnd: timeWindow?.end || null,
            allowedRadiusMeters,
        });
    }

    return buildValidationResult({
        validationStatus: VALIDATION_STATUS.VALIDA,
        validationReason: VALIDATION_REASON.OK,
        validationMessage: 'Prezenta a fost validata automat.',
        checkinWindowStart: timeWindow?.start || null,
        checkinWindowEnd: timeWindow?.end || null,
        allowedRadiusMeters,
    });
}

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = (Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2))
        + (Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function createAttendanceForAuthUser(authUser, payload = {}, requestMeta = {}) {
    if (authUser?.role !== 'user') {
        return {
            statusCode: 403,
            response: { message: 'Doar elevii pot trimite pontajul din aplicatie.' },
        };
    }

    const pushToken = String(authUser?.pushToken || authUser?.deviceToken || '').trim();
    if (!pushToken) {
        return {
            statusCode: 422,
            response: {
                message: 'Pentru pontaj trebuie sa activezi notificarile aplicatiei.',
                validationStatus: VALIDATION_STATUS.INVALIDA,
                validationReason: 'NOTIFICARI_INACTIVE',
                validationMessage: 'Pentru pontaj trebuie sa activezi notificarile aplicatiei.',
            },
        };
    }

    const lat = Number(payload?.lat);
    const lng = Number(payload?.lng);
    const accuracyMeters = payload?.accuracyMeters == null ? null : Number(payload.accuracyMeters);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return {
            statusCode: 400,
            response: { message: 'Coordonate GPS invalide.' },
        };
    }

    // Anti-fraud: a mocked/fake GPS location (reported by the native app) is
    // rejected outright. mockCheckAvailable tells us whether the client was
    // actually able to evaluate this (web has no such signal).
    const isMockedLocation = payload?.isMocked === true;
    const mockCheckAvailable = payload?.mockCheckAvailable === true;
    if (isMockedLocation) {
        return {
            statusCode: 422,
            response: {
                message: 'Locatie GPS falsa detectata. Dezactiveaza aplicatiile de mock location si incearca din nou.',
                validationStatus: VALIDATION_STATUS.INVALIDA,
                validationReason: VALIDATION_REASON.LOCATIE_FALSA,
                validationMessage: 'Locatie GPS falsa detectata (mock location).',
            },
        };
    }

    const operator = getEntityStore('Operator')?.find((entry) => entry.id === authUser.operatorId) || null;
    const now = new Date();
    const dateKey = toDateKey(now);
    const existingAttendances = getEntityStore('Attendance').filter(
        (entry) => entry.studentUserId === authUser.id && entry.dateKey === dateKey
    );

    const roundedDistance = operator && Number.isFinite(Number(operator.lat)) && Number.isFinite(Number(operator.lng))
        ? Math.round(calculateDistanceMeters(lat, lng, Number(operator.lat), Number(operator.lng)))
        : null;

    const validation = validateAttendanceAttemptServer({
        now,
        user: authUser,
        operator,
        existingAttendances,
        periods: getEntityStore('PracticePeriod'),
        classPlans: getEntityStore('ClassPracticePlan'),
        practiceSchedules: getEntityStore('PracticeSchedule'),
        schedules: getEntityStore('Schedule'),
        distanceMeters: roundedDistance,
        accuracyMeters,
    });

    if (validation.validationStatus !== VALIDATION_STATUS.VALIDA) {
        return {
            statusCode: 422,
            response: {
                message: validation.validationMessage,
                ...validation,
            },
        };
    }

    const created = {
        id: makeId('attendance'),
        created_date: nowIso(),
        studentUserId: authUser.id,
        studentName: authUser.full_name || '',
        className: authUser.className || '',
        operatorId: operator?.id || '',
        operatorName: operator?.name || '',
        dateKey,
        timestamp: nowIso(),
        lat,
        lng,
        accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : null,
        distanceMeters: roundedDistance,
        allowedRadiusMeters: validation.allowedRadiusMeters,
        checkinWindowStart: validation.checkinWindowStart,
        checkinWindowEnd: validation.checkinWindowEnd,
        validationStatus: validation.validationStatus,
        validationReason: validation.validationReason,
        validationMessage: validation.validationMessage,
        requiresReview: validation.requiresReview,
        status: 'present',
        // Device fingerprint of the phone/browser that submitted the check-in.
        deviceLabel: sanitizeDeviceText(payload?.deviceLabel, 120),
        devicePlatform: sanitizeDeviceText(payload?.devicePlatform, 40),
        deviceUserAgent: sanitizeDeviceText(requestMeta?.userAgent, 300),
        // Mock-location anti-fraud signals (mocked=true is rejected earlier).
        isMocked: false,
        mockCheckAvailable,
    };

    getEntityStore('Attendance').unshift(created);
    return {
        statusCode: 201,
        created,
        validation,
    };
}

function issueToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            role: user.role || 'user',
            email: normalizeEmail(user.email),
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function getBearerToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) return '';
    return authHeader.slice('Bearer '.length).trim();
}

function requireAuth(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        res.status(401).json({ message: 'Authentication required.' });
        return;
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = getUserById(payload.sub);
        if (!user || user.isActive === false) {
            res.status(401).json({ message: 'Invalid user session.' });
            return;
        }
        req.authUser = user;
        req.authPayload = payload;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token.' });
    }
}

function requireAdmin(req, res, next) {
    if (req.authUser?.role !== 'admin') {
        res.status(403).json({ message: 'Admin role is required for this action.' });
        return;
    }
    next();
}

function isAdminReq(req) {
    return req.authUser?.role === 'admin';
}

function denyNonAdmin(res) {
    res.status(403).json({ message: 'Admin role is required for this action.' });
}

// Entities a normal (student) account may never read in bulk.
const STUDENT_READ_FORBIDDEN_ENTITIES = new Set(['User', 'AuditLog']);

// For non-admins, force Attendance queries to only ever return their own rows.
function scopeAttendanceToReqUser(req, entity, items) {
    if (entity !== 'Attendance' || isAdminReq(req)) return items;
    const selfId = req.authUser?.id;
    return items.filter((entry) => entry?.studentUserId === selfId);
}

function createInvitedUser(email, role = 'user') {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw Object.assign(new Error('Email is required.'), { status: 400 });
    }

    const existing = getUserByEmail(normalizedEmail);
    if (existing) {
        return { user: existing, tempPassword: null, created: false };
    }

    const tempPassword = generateTempPassword();
    const newUser = {
        id: makeId('user'),
        role: role || 'user',
        full_name: normalizedEmail.split('@')[0],
        email: normalizedEmail,
        phoneNumber: '',
        pushToken: '',
        className: '',
        specialization: '',
        operatorId: '',
        isActive: true,
        created_date: nowIso(),
        passwordHash: bcrypt.hashSync(tempPassword, 10),
    };

    state.entities.User.unshift(newUser);
    persistState();
    return { user: newUser, tempPassword, created: true };
}

// Permissive by default (local dev, two ports on 127.0.0.1). In production,
// APP_ALLOWED_ORIGINS (comma-separated) is mandatory — mirrors the fail-closed
// APP_JWT_SECRET handling above, since an open CORS policy in production would
// let any third-party page make authenticated cross-origin API calls.
const allowedOrigins = String(process.env.APP_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    throw new Error('APP_ALLOWED_ORIGINS must be set to a comma-separated list of allowed frontend origins in production.');
}

const app = express();
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_, res) => {
    res.json({ ok: true, timestamp: nowIso() });
});

// Backward compatibility with previous auth pre-check logic.
app.get('/api/apps/public/prod/public-settings/by-id/:appId', (req, res) => {
    res.json({
        id: req.params.appId,
        public_settings: {},
    });
});

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    const email = normalizeEmail(req.body?.email);

    const rateLimit = checkLoginRateLimit(email);
    if (rateLimit.limited) {
        res.set('Retry-After', String(rateLimit.retryAfterSeconds));
        res.status(429).json({ message: 'Prea multe incercari esuate. Incearca din nou mai tarziu.' });
        return;
    }

    const user = getUserByEmail(email);
    if (!user || user.isActive === false) {
        recordLoginFailure(email);
        res.status(401).json({ message: 'Email sau parola invalida.' });
        return;
    }

    const isValidPassword = bcrypt.compareSync(String(password || ''), user.passwordHash || '');
    if (!isValidPassword) {
        recordLoginFailure(email);
        res.status(401).json({ message: 'Email sau parola invalida.' });
        return;
    }

    clearLoginRateLimit(email);

    const token = issueToken(user);
    res.json({
        access_token: token,
        user: stripSensitiveUserFields(user),
    });
});

app.post('/api/auth/register', (req, res) => {
    const {
        email,
        password,
        full_name,
    } = req.body || {};

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
        res.status(400).json({ message: 'Email si parola sunt obligatorii.' });
        return;
    }

    if (getUserByEmail(normalizedEmail)) {
        res.status(409).json({ message: 'Exista deja un cont cu acest email.' });
        return;
    }

    const created = {
        id: makeId('user'),
        // Self-service registration always creates a plain student account.
        role: 'user',
        full_name: String(full_name || normalizedEmail.split('@')[0]),
        email: normalizedEmail,
        phoneNumber: '',
        pushToken: '',
        className: '',
        specialization: '',
        operatorId: '',
        isActive: true,
        created_date: nowIso(),
        passwordHash: bcrypt.hashSync(String(password), 10),
    };

    state.entities.User.unshift(created);
    persistState();

    res.status(201).json({
        access_token: issueToken(created),
        user: stripSensitiveUserFields(created),
    });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json(stripSensitiveUserFields(req.authUser));
});

app.patch('/api/auth/me', requireAuth, (req, res) => {
    const allowedFields = new Set([
        'full_name',
        'phoneNumber',
        'pushToken',
        'className',
        'specialization',
        'operatorId',
    ]);

    const updates = req.body && typeof req.body === 'object' ? req.body : {};
    Object.entries(updates).forEach(([key, value]) => {
        if (allowedFields.has(key)) {
            req.authUser[key] = value;
        }
    });
    persistState();
    res.json(stripSensitiveUserFields(req.authUser));
});

app.post('/api/auth/logout', (_req, res) => {
    res.json({ success: true });
});

app.post('/api/auth/invite', requireAuth, requireAdmin, (req, res) => {
    const { email, role = 'user' } = req.body || {};
    try {
        const result = createInvitedUser(email, role);
        res.status(result.created ? 201 : 200).json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        });
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message || 'Cannot invite user.' });
    }
});

app.post('/api/auth/invite-user', requireAuth, requireAdmin, (req, res) => {
    const { email, role = 'user' } = req.body || {};
    try {
        const result = createInvitedUser(email, role);
        res.status(result.created ? 201 : 200).json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        });
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message || 'Cannot invite user.' });
    }
});

// Public self-service "forgot password": emails a one-time reset link.
// Always returns success so it can't be used to discover which emails exist.
app.post('/api/auth/reset-password-request', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const user = email ? getUserByEmail(email) : null;

    if (user && user.isActive !== false) {
        const rawToken = randomToken();
        user.resetTokenHash = sha256Hex(rawToken);
        user.resetTokenExpiresAt = Date.now() + RESET_TOKEN_TTL_MS;
        persistState();

        const base = String(process.env.APP_PUBLIC_URL || 'http://127.0.0.1:4173').replace(/\/+$/, '');
        const link = `${base}/ResetPassword?token=${rawToken}&uid=${encodeURIComponent(user.id)}`;
        try {
            await sendResetEmail({ to: user.email, link, fullName: user.full_name });
        } catch {
            // Swallow provider errors: never reveal whether the address is real.
        }
    }

    res.json({ success: true });
});

// Public: consume a reset token and set a new password.
app.post('/api/auth/reset-password-confirm', (req, res) => {
    const userId = String(req.body?.uid || req.body?.userId || '').trim();
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!userId || !token || newPassword.length < 6) {
        res.status(400).json({ message: 'Date invalide sau parola prea scurta (minim 6 caractere).' });
        return;
    }

    const user = getUserById(userId);
    const providedHash = sha256Hex(token);
    const tokenValid = Boolean(user
        && user.resetTokenHash
        && constantTimeEqual(providedHash, user.resetTokenHash)
        && Number(user.resetTokenExpiresAt || 0) > Date.now());

    if (!tokenValid) {
        res.status(400).json({ message: 'Link de resetare invalid sau expirat.' });
        return;
    }

    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    delete user.resetTokenHash;
    delete user.resetTokenExpiresAt;
    persistState();
    res.json({ success: true });
});

// Admin-driven reset for accounts that can't receive email (e.g. students with
// @practica.local addresses): set a fresh temp password and return it so the
// admin can hand it over.
app.post('/api/auth/admin-reset-password', requireAuth, requireAdmin, (req, res) => {
    const { userId, email } = req.body || {};
    const target = userId
        ? getUserById(userId)
        : (email ? getUserByEmail(email) : null);
    if (!target) {
        res.status(404).json({ message: 'User not found.' });
        return;
    }
    const tempPassword = generateTempPassword();
    target.passwordHash = bcrypt.hashSync(tempPassword, 10);
    delete target.resetTokenHash;
    delete target.resetTokenExpiresAt;
    persistState();
    res.json({ success: true, tempPassword });
});

app.post('/api/auth/reset-password', requireAuth, (req, res) => {
    const { userId, email, newPassword } = req.body || {};
    const targetUser = userId
        ? getUserById(userId)
        : (email ? getUserByEmail(email) : req.authUser);

    if (!targetUser) {
        res.status(404).json({ message: 'User not found.' });
        return;
    }

    if (req.authUser.role !== 'admin' && req.authUser.id !== targetUser.id) {
        res.status(403).json({ message: 'Not allowed.' });
        return;
    }

    const passwordValue = String(newPassword || 'elev123');
    targetUser.passwordHash = bcrypt.hashSync(passwordValue, 10);
    persistState();

    res.json({ success: true });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword) {
        res.status(400).json({ message: 'New password is required.' });
        return;
    }

    const isValidOldPassword = bcrypt.compareSync(String(oldPassword || ''), req.authUser.passwordHash || '');
    if (!isValidOldPassword) {
        res.status(400).json({ message: 'Parola curenta este incorecta.' });
        return;
    }

    req.authUser.passwordHash = bcrypt.hashSync(String(newPassword), 10);
    persistState();
    res.json({ success: true });
});

app.post('/api/users/invite', requireAuth, requireAdmin, (req, res) => {
    const { email, role = 'user' } = req.body || {};
    try {
        const result = createInvitedUser(email, role);
        res.status(result.created ? 201 : 200).json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        });
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message || 'Cannot invite user.' });
    }
});

app.post('/api/functions/invoke', requireAuth, (req, res) => {
    const { name, payload } = req.body || {};
    if (!name) {
        res.status(400).json({ message: 'Function name is required.' });
        return;
    }
    res.json({
        success: true,
        functionName: name,
        payload: payload || {},
    });
});

app.post('/api/integrations/core/:method', requireAuth, async (req, res) => {
    const { method } = req.params;
    const payload = req.body || {};

    if (!PUSH_CORE_METHODS.has(method)) {
        res.json({
            success: true,
            method,
            payload,
        });
        return;
    }

    // Sending push notifications to arbitrary users is an admin-only capability.
    if (req.authUser?.role !== 'admin') {
        res.status(403).json({ message: 'Admin role is required for this action.' });
        return;
    }

    const targetToken = resolvePushTargetToken(payload);
    if (!targetToken) {
        res.status(400).json({ message: 'Target push token missing.' });
        return;
    }

    const dataPayload = {
        channel: payload.channel || 'push',
        userId: payload.userId || '',
        studentName: payload.studentName || '',
        ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
    };

    try {
        const providerResponse = await sendPushWithFcm({
            token: targetToken,
            title: payload.title,
            body: payload.body,
            data: dataPayload,
        });
        res.json({
            success: true,
            method,
            provider: 'fcm',
            payload,
            response: providerResponse,
        });
    } catch (error) {
        const statusCode = Number(error?.status) || 500;
        res.status(statusCode).json({
            message: error?.message || 'Cannot send push notification.',
            details: error?.details || null,
        });
    }
});

app.post('/api/attendance/checkin', requireAuth, (req, res) => {
    const result = createAttendanceForAuthUser(req.authUser, req.body, {
        userAgent: req.get('User-Agent'),
    });
    if (!result.created) {
        res.status(result.statusCode).json(result.response);
        return;
    }
    persistState();

    res.status(201).json({
        attendance: result.created,
        message: result.validation.validationMessage,
    });
});

app.post('/api/app-logs/navigation', requireAuth, (req, res) => {
    const { pageName = '' } = req.body || {};
    state.navigationLogs.unshift({
        id: makeId('nav'),
        userId: req.authUser.id,
        pageName,
        timestamp: nowIso(),
    });
    if (state.navigationLogs.length > 2000) {
        state.navigationLogs.length = 2000;
    }
    persistState();
    res.json({ success: true });
});

app.get('/api/entities/:entity/list', requireAuth, (req, res) => {
    const { entity } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }

    if (!isAdminReq(req) && STUDENT_READ_FORBIDDEN_ENTITIES.has(entity)) {
        denyNonAdmin(res);
        return;
    }

    const scoped = scopeAttendanceToReqUser(req, entity, store);
    const sanitized = scoped.map((entry) => sanitizeEntity(entity, entry));
    const sorted = applySort(sanitized, req.query.sort);
    const sliced = applyLimitSkip(sorted, req.query.limit, req.query.skip);
    const selected = applyFields(sliced, req.query.fields);
    res.json(selected);
});

app.post('/api/entities/:entity/filter', requireAuth, (req, res) => {
    const { entity } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }

    if (!isAdminReq(req) && STUDENT_READ_FORBIDDEN_ENTITIES.has(entity)) {
        denyNonAdmin(res);
        return;
    }

    const { query, sort, limit, skip, fields } = req.body || {};
    const filtered = scopeAttendanceToReqUser(req, entity, store)
        .map((entry) => sanitizeEntity(entity, entry))
        .filter((entry) => matchesQuery(entry, query));
    const sorted = applySort(filtered, sort);
    const sliced = applyLimitSkip(sorted, limit, skip);
    const selected = applyFields(sliced, fields);
    res.json(selected);
});

app.get('/api/entities/:entity/:id', requireAuth, (req, res) => {
    const { entity, id } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }

    if (!isAdminReq(req) && STUDENT_READ_FORBIDDEN_ENTITIES.has(entity)) {
        denyNonAdmin(res);
        return;
    }

    const found = scopeAttendanceToReqUser(req, entity, store).find((entry) => String(entry.id) === String(id));
    if (!found) {
        res.status(404).json({ message: 'Entity not found.' });
        return;
    }
    res.json(sanitizeEntity(entity, found));
});

app.post('/api/entities/:entity', requireAuth, (req, res) => {
    const { entity } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }
    const payload = req.body && typeof req.body === 'object' ? req.body : {};

    if (!isAdminReq(req)) {
        // Students may submit their own attendance check-in...
        if (entity === 'Attendance') {
            const result = createAttendanceForAuthUser(req.authUser, payload, {
                userAgent: req.get('User-Agent'),
            });
            if (!result.created) {
                res.status(result.statusCode).json(result.response);
                return;
            }
            persistState();
            res.status(201).json(sanitizeEntity(entity, result.created));
            return;
        }

        // ...and append an audit-log note, with actor identity stamped
        // server-side so it cannot be spoofed.
        if (entity === 'AuditLog') {
            const note = {
                id: makeId('auditlog'),
                created_date: nowIso(),
                ...payload,
                actorName: req.authUser.full_name || 'Elev',
                actorEmail: req.authUser.email || '',
                actorId: req.authUser.id,
            };
            store.unshift(note);
            persistState();
            res.status(201).json(sanitizeEntity(entity, note));
            return;
        }

        denyNonAdmin(res);
        return;
    }

    const created = {
        id: makeId(entity.toLowerCase()),
        created_date: nowIso(),
        ...payload,
    };

    if (entity === 'User') {
        created.email = normalizeEmail(created.email);
        if (created.email && getUserByEmail(created.email)) {
            res.status(409).json({ message: 'Exista deja un utilizator cu acest email.' });
            return;
        }
        created.role = created.role || 'user';
        created.passwordHash = created.passwordHash || bcrypt.hashSync('elev123', 10);
    }

    store.unshift(created);
    persistState();
    res.status(201).json(sanitizeEntity(entity, created));
});

app.patch('/api/entities/:entity/:id', requireAuth, (req, res) => {
    const { entity, id } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }
    // Students edit only their own profile via PATCH /api/auth/me; any direct
    // entity update requires admin.
    if (!isAdminReq(req)) {
        denyNonAdmin(res);
        return;
    }

    const index = store.findIndex((entry) => String(entry.id) === String(id));
    if (index === -1) {
        res.status(404).json({ message: 'Entity not found.' });
        return;
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    if (entity === 'User' && payload.email) {
        const existingByEmail = getUserByEmail(payload.email);
        if (existingByEmail && existingByEmail.id !== id) {
            res.status(409).json({ message: 'Exista deja un utilizator cu acest email.' });
            return;
        }
        payload.email = normalizeEmail(payload.email);
    }

    if (entity === 'User' && payload.password) {
        payload.passwordHash = bcrypt.hashSync(String(payload.password), 10);
        delete payload.password;
    }

    store[index] = { ...store[index], ...payload };
    persistState();
    res.json(sanitizeEntity(entity, store[index]));
});

app.delete('/api/entities/:entity/:id', requireAuth, (req, res) => {
    const { entity, id } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }
    if (!isAdminReq(req)) {
        denyNonAdmin(res);
        return;
    }

    const index = store.findIndex((entry) => String(entry.id) === String(id));
    if (index === -1) {
        res.status(404).json({ message: 'Entity not found.' });
        return;
    }
    store.splice(index, 1);
    persistState();
    res.json({ success: true });
});

app.post('/api/entities/:entity/deleteMany', requireAuth, (req, res) => {
    const { entity } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }
    if (!isAdminReq(req)) {
        denyNonAdmin(res);
        return;
    }

    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((entry) => String(entry)) : [];
    state.entities[entity] = store.filter((entry) => !ids.includes(String(entry.id)));
    persistState();
    res.json({ success: true });
});

app.post('/api/entities/:entity/bulkCreate', requireAuth, (req, res) => {
    const { entity } = req.params;
    const store = getEntityStore(entity);
    if (!store) {
        res.status(404).json({ message: `Unknown entity ${entity}` });
        return;
    }
    if (!isAdminReq(req)) {
        denyNonAdmin(res);
        return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const created = items.map((item) => {
        const payload = item && typeof item === 'object' ? item : {};
        const next = {
            id: makeId(entity.toLowerCase()),
            created_date: nowIso(),
            ...payload,
        };

        if (entity === 'User') {
            next.email = normalizeEmail(next.email);
            next.role = next.role || 'user';
            next.passwordHash = next.passwordHash || bcrypt.hashSync('elev123', 10);
        }

        store.unshift(next);
        return sanitizeEntity(entity, next);
    });

    persistState();
    res.status(201).json(created);
});

app.post('/api/entities/:entity/importEntities', requireAuth, requireAdmin, (_req, res) => {
    res.json({ success: true });
});

const REMINDER_DEFAULT_SETTINGS = {
    enabled: false,
    reminderTime: '09:00',
    onlyAbsent: true,
    channels: {
        email: false,
        push: true,
        sms: false,
    },
};

function normalizeReminderChannels(channels = {}) {
    const normalized = {
        email: channels.email === true,
        push: channels.push === true,
        sms: channels.sms === true,
    };
    if (!normalized.email && !normalized.push && !normalized.sms) {
        normalized.push = true;
    }
    return normalized;
}

function normalizeReminderTime(value) {
    const candidate = String(value || '').trim();
    if (!/^\d{2}:\d{2}$/.test(candidate)) return REMINDER_DEFAULT_SETTINGS.reminderTime;
    const [hoursRaw, minutesRaw] = candidate.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return REMINDER_DEFAULT_SETTINGS.reminderTime;
    }
    return `${hoursRaw.padStart(2, '0')}:${minutesRaw.padStart(2, '0')}`;
}

function extractReminderSettings(classroom) {
    const nestedSettings = classroom?.reminderSettings && typeof classroom.reminderSettings === 'object'
        ? classroom.reminderSettings
        : {};
    const enabled = classroom?.reminderEnabled === true || nestedSettings.enabled === true;
    const reminderTime = normalizeReminderTime(classroom?.reminderTime || nestedSettings.reminderTime);
    const onlyAbsent = classroom?.reminderOnlyAbsent === false || nestedSettings.onlyAbsent === false
        ? false
        : true;
    const channels = normalizeReminderChannels({
        ...REMINDER_DEFAULT_SETTINGS.channels,
        ...(nestedSettings.channels || {}),
        ...(classroom?.reminderChannels && typeof classroom.reminderChannels === 'object' ? classroom.reminderChannels : {}),
    });
    return {
        enabled,
        reminderTime,
        onlyAbsent,
        channels,
    };
}

function buildReminderBody(now = new Date()) {
    const dateLabel = new Intl.DateTimeFormat('ro-RO', {
        timeZone: APP_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(now);
    return `Reminder prezenta practica pentru ${dateLabel}. Te rugam sa intri in aplicatie si sa marchezi prezenta in intervalul permis.`;
}

async function runAutomaticReminderSweepNode(triggerLabel = 'server-timer') {
    const classrooms = getEntityStore('Classroom');
    const users = getEntityStore('User');
    const attendances = getEntityStore('Attendance');
    const auditLogs = getEntityStore('AuditLog');

    const now = new Date();
    const todayKey = toDateKey(now);
    const nowMinutes = getAppMinutes(now);
    const todayAttendanceIds = new Set(
        attendances
            .filter((entry) => entry?.dateKey === todayKey)
            .map((entry) => String(entry.studentUserId || ''))
    );

    let changed = false;
    const notificationLink = String(process.env.REMINDER_NOTIFICATION_LINK || '').trim();

    for (const classroom of classrooms) {
        const className = normalizeClassName(classroom?.name);
        if (!className) continue;

        const reminderSettings = extractReminderSettings(classroom);
        if (!reminderSettings.enabled || !reminderSettings.channels.push) continue;

        const reminderMinutes = toMinutes(reminderSettings.reminderTime);
        if (reminderMinutes === null || nowMinutes < reminderMinutes) continue;
        if (classroom.reminderLastSentDate === todayKey) continue;

        const classStudents = users.filter((user) => (
            (user?.role === 'user' || !user?.role)
            && user?.isActive !== false
            && normalizeClassName(user?.className) === className
        ));
        const targets = reminderSettings.onlyAbsent
            ? classStudents.filter((student) => !todayAttendanceIds.has(String(student.id || '')))
            : classStudents;

        let sent = 0;
        let missing = 0;
        let error = 0;
        const body = buildReminderBody(now);
        const title = 'Reminder prezenta practica';

        for (const student of targets) {
            const token = String(student?.pushToken || student?.deviceToken || '').trim();
            if (!token) {
                missing += 1;
                continue;
            }
            const data = notificationLink ? { link: notificationLink } : undefined;
            try {
                await sendPushWithFcm({
                    token,
                    title,
                    body,
                    data,
                });
                sent += 1;
            } catch {
                error += 1;
            }
        }

        classroom.reminderLastSentDate = todayKey;
        classroom.reminderLastSentAt = nowIso();
        classroom.reminderLastStats = {
            recipients: targets.length,
            sent,
            missing,
            error,
            trigger: triggerLabel,
        };

        auditLogs.unshift({
            id: makeId('audit'),
            timestamp: nowIso(),
            action: 'CLASS_REMINDER_AUTO_SEND',
            entityType: 'Classroom',
            entityId: className,
            actorName: 'System',
            actorEmail: 'system@cron.local',
            details: `Reminder automat ${className}: push sent=${sent}, missing=${missing}, error=${error}, total=${targets.length}`,
            metadata: {
                className,
                dateKey: todayKey,
                trigger: triggerLabel,
                channels: reminderSettings.channels,
                onlyAbsent: reminderSettings.onlyAbsent,
            },
        });
        changed = true;
    }

    if (changed) {
        persistState();
    }
}

app.use((error, _req, res, _next) => {
    res.status(error?.status || 500).json({
        message: error?.message || 'Unexpected server error.',
    });
});

app.listen(API_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] Listening on http://127.0.0.1:${API_PORT}`);
    setInterval(() => {
        runAutomaticReminderSweepNode('server-timer').catch((error) => {
            // eslint-disable-next-line no-console
            console.error('[api] Automatic reminder sweep failed:', error?.message || error);
        });
    }, 60 * 1000);
});
