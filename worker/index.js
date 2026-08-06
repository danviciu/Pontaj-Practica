import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwtVerify, SignJWT } from 'jose';

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

const DB_KEY = 'state:v1';
const PBKDF2_PREFIX = 'pbkdf2$';
const PBKDF2_ITERATIONS = 100_000;
const LEGACY_SHA256_PREFIX = 'sha256$';
const LEGACY_BCRYPT_RE = /^\$2[aby]\$/;
const passwordEncoder = new TextEncoder();
const PUSH_CORE_METHODS = new Set(['SendPushNotification', 'SendPush', 'PushNotification']);
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_REFRESH_BUFFER_MS = 60_000;
let cachedFcmToken = { value: '', expiresAt: 0 };

function nowIso() {
    return new Date().toISOString();
}

function toHex(buffer) {
    return [...new Uint8Array(buffer)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
    const normalized = String(hex || '');
    const length = Math.floor(normalized.length / 2);
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

function constantTimeEqual(a, b) {
    const left = String(a || '');
    const right = String(b || '');
    if (left.length !== right.length) return false;
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return mismatch === 0;
}

async function pbkdf2Derive(password, saltBytes, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordEncoder.encode(String(password || '')),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
        keyMaterial,
        256
    );
    return toHex(bits);
}

async function legacySha256Hash(password) {
    const payload = `pontaj-practica:${String(password || '')}`;
    const digest = await crypto.subtle.digest('SHA-256', passwordEncoder.encode(payload));
    return `${LEGACY_SHA256_PREFIX}${toHex(digest)}`;
}

async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await pbkdf2Derive(password, salt, PBKDF2_ITERATIONS);
    return `${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${derived}`;
}

// Returns true when a stored hash uses an old/weak scheme and should be
// transparently re-hashed with the current algorithm on next successful login.
function passwordNeedsRehash(storedHash) {
    return !String(storedHash || '').startsWith(PBKDF2_PREFIX);
}

async function verifyPassword(password, storedHash) {
    const normalizedPassword = String(password || '');
    const normalizedHash = String(storedHash || '');
    if (!normalizedHash) return false;

    if (normalizedHash.startsWith(PBKDF2_PREFIX)) {
        const [, iterationsRaw, saltHex, expectedHex] = normalizedHash.split('$');
        const iterations = Number(iterationsRaw) || PBKDF2_ITERATIONS;
        if (!saltHex || !expectedHex) return false;
        const derived = await pbkdf2Derive(normalizedPassword, hexToBytes(saltHex), iterations);
        return constantTimeEqual(derived, expectedHex);
    }

    if (normalizedHash.startsWith(LEGACY_SHA256_PREFIX)) {
        const nextHash = await legacySha256Hash(normalizedPassword);
        return constantTimeEqual(nextHash, normalizedHash);
    }

    if (LEGACY_BCRYPT_RE.test(normalizedHash)) {
        try {
            return await bcrypt.compare(normalizedPassword, normalizedHash);
        } catch {
            return false;
        }
    }

    return constantTimeEqual(normalizedPassword, normalizedHash);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Login brute-force protection: after MAX_LOGIN_ATTEMPTS failures for the same
// account within LOGIN_ATTEMPT_WINDOW_SECONDS, further attempts are locked out
// for the same window. Counters live in the DB_KV namespace (auto-expiring via
// expirationTtl) since Workers have no persistent in-memory state across requests.
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;

function loginRateLimitKey(email) {
    return `ratelimit:login:${normalizeEmail(email)}`;
}

async function checkLoginRateLimit(env, email) {
    if (!env.DB_KV) return { limited: false };
    try {
        const raw = await env.DB_KV.get(loginRateLimitKey(email), 'json');
        if (raw && Number(raw.count) >= MAX_LOGIN_ATTEMPTS) {
            return { limited: true, retryAfterSeconds: LOGIN_ATTEMPT_WINDOW_SECONDS };
        }
    } catch {
        // KV unavailable: fail open rather than lock everyone out.
    }
    return { limited: false };
}

async function recordLoginFailure(env, email) {
    if (!env.DB_KV) return;
    const key = loginRateLimitKey(email);
    try {
        const raw = await env.DB_KV.get(key, 'json');
        const nextCount = (Number(raw?.count) || 0) + 1;
        await env.DB_KV.put(key, JSON.stringify({ count: nextCount }), {
            expirationTtl: LOGIN_ATTEMPT_WINDOW_SECONDS,
        });
    } catch {
        // Best-effort only.
    }
}

async function clearLoginRateLimit(env, email) {
    if (!env.DB_KV) return;
    try {
        await env.DB_KV.delete(loginRateLimitKey(email));
    } catch {
        // Best-effort only.
    }
}

async function sha256Hex(input) {
    const digest = await crypto.subtle.digest('SHA-256', passwordEncoder.encode(String(input || '')));
    return toHex(digest);
}

function randomToken(byteLength = 24) {
    return toHex(crypto.getRandomValues(new Uint8Array(byteLength)).buffer);
}

// Send a password-reset email via Resend. Throws if not configured / on failure.
async function sendResetEmail(env, { to, link, fullName }) {
    const apiKey = String(env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
        throw Object.assign(new Error('Email provider not configured.'), { status: 503 });
    }
    const from = String(env.RESEND_FROM || 'Pontaj Practica <onboarding@resend.dev>');
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

function makeId(prefix = 'id') {
    const unique = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    return `${prefix}_${unique}`;
}

// High-entropy temporary password (avoids the old predictable Tmp###### form).
function generateTempPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const randomValues = crypto.getRandomValues(new Uint8Array(14));
    const body = [...randomValues].map((value) => alphabet[value % alphabet.length]).join('');
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
        passwordHash,
        password,
        resetTokenHash,
        resetTokenExpiresAt,
        ...safeUser
    } = user;
    return safeUser;
}

function sanitizeEntity(entityName, item) {
    if (entityName === 'User') return stripSensitiveUserFields(item);
    return item;
}

async function createDefaultState() {
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
        passwordHash: await hashPassword('admin123'),
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
        passwordHash: await hashPassword('elev123'),
    };

    return {
        entities: {
            User: [admin, student],
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

async function normalizeState(rawState) {
    const fallback = await createDefaultState();
    const source = rawState && typeof rawState === 'object' ? rawState : fallback;
    const entities = source.entities && typeof source.entities === 'object'
        ? source.entities
        : fallback.entities;

    const normalizedEntities = {};
    ENTITY_NAMES.forEach((entityName) => {
        const records = entities[entityName];
        normalizedEntities[entityName] = Array.isArray(records) ? records : [];
    });

    if (!normalizedEntities.User.some((entry) => entry?.role === 'admin')) {
        const defaultAdmin = fallback.entities.User.find((entry) => entry.role === 'admin');
        normalizedEntities.User.unshift(defaultAdmin);
    }

    normalizedEntities.User = await Promise.all(normalizedEntities.User.map(async (entry) => {
        const safeEntry = entry && typeof entry === 'object' ? entry : {};
        if (safeEntry.passwordHash) return safeEntry;
        const fallbackPassword = safeEntry.role === 'admin' ? 'admin123' : 'elev123';
        const passwordSource = safeEntry.password || fallbackPassword;
        const { password, ...cleanEntry } = safeEntry;
        return {
            ...cleanEntry,
            passwordHash: await hashPassword(passwordSource),
        };
    }));

    return {
        entities: normalizedEntities,
        navigationLogs: Array.isArray(source.navigationLogs) ? source.navigationLogs : [],
    };
}

const ENTITY_SET = new Set(ENTITY_NAMES);
let initializedFlag = false;

// Promote a few fields out of the JSON for indexing / tenant isolation.
function recordRow(entity, record) {
    return {
        entity,
        id: String(record?.id || ''),
        owner_id: record?.ownerId || record?.owner_id || null,
        email: entity === 'User' ? (normalizeEmail(record?.email) || null) : null,
        data: JSON.stringify(record),
        created_date: record?.created_date || null,
    };
}

function upsertStatement(env, row) {
    return env.DB.prepare(
        'INSERT INTO records (entity,id,owner_id,email,data,created_date) VALUES (?,?,?,?,?,?) '
        + 'ON CONFLICT(entity,id) DO UPDATE SET '
        + 'owner_id=excluded.owner_id, email=excluded.email, data=excluded.data, created_date=excluded.created_date'
    ).bind(row.entity, row.id, row.owner_id, row.email, row.data, row.created_date);
}

function insertIgnoreStatement(env, row) {
    return env.DB.prepare(
        'INSERT OR IGNORE INTO records (entity,id,owner_id,email,data,created_date) VALUES (?,?,?,?,?,?)'
    ).bind(row.entity, row.id, row.owner_id, row.email, row.data, row.created_date);
}

async function insertEntitiesIgnore(env, entitiesMap) {
    const statements = [];
    for (const entity of ENTITY_NAMES) {
        for (const record of entitiesMap[entity] || []) {
            if (!record?.id) continue;
            statements.push(insertIgnoreStatement(env, recordRow(entity, record)));
        }
    }
    if (statements.length > 0) await env.DB.batch(statements);
}

// One-time migration: pull the old single-blob KV state into per-record rows.
async function importLegacyKvState(env) {
    let raw = null;
    try {
        raw = env.DB_KV ? await env.DB_KV.get(DB_KEY, 'json') : null;
    } catch {
        raw = null;
    }
    if (!raw) return false;
    const normalized = await normalizeState(raw);
    await insertEntitiesIgnore(env, normalized.entities);
    return true;
}

async function ensureInitialized(env) {
    if (initializedFlag) return;
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM records').first();
    if (Number(countRow?.n || 0) === 0) {
        const imported = await importLegacyKvState(env);
        if (!imported) {
            const initial = await createDefaultState();
            await insertEntitiesIgnore(env, initial.entities);
        }
    }
    // Guarantee at least one admin account exists.
    const adminRow = await env.DB
        .prepare("SELECT 1 FROM records WHERE entity='User' AND json_extract(data,'$.role')='admin' LIMIT 1")
        .first();
    if (!adminRow) {
        const initial = await createDefaultState();
        await insertEntitiesIgnore(env, { User: initial.entities.User });
    }
    initializedFlag = true;
}

async function loadState(env) {
    await ensureInitialized(env);
    const { results } = await env.DB.prepare('SELECT entity, id, data FROM records').all();

    const entities = {};
    ENTITY_NAMES.forEach((name) => { entities[name] = []; });
    const snapshot = new Map();

    for (const row of results || []) {
        if (!ENTITY_SET.has(row.entity)) continue;
        let parsed;
        try {
            parsed = JSON.parse(row.data);
        } catch {
            continue;
        }
        entities[row.entity].push(parsed);
        snapshot.set(`${row.entity}:${row.id}`, row.data);
    }

    const state = { entities };
    Object.defineProperty(state, '__snapshot', { value: snapshot, enumerable: false, writable: true });
    return state;
}

// Diff the in-memory state against the snapshot loaded at request start and
// persist ONLY the rows that changed/were added/removed — each as its own
// statement. Concurrent requests touching different records never clobber
// each other (unlike the old whole-blob rewrite).
async function saveState(env, state) {
    const snapshot = state.__snapshot instanceof Map ? state.__snapshot : new Map();
    const seen = new Set();
    const statements = [];

    for (const entity of ENTITY_NAMES) {
        const records = Array.isArray(state.entities?.[entity]) ? state.entities[entity] : [];
        for (const record of records) {
            if (!record?.id) continue;
            const key = `${entity}:${record.id}`;
            seen.add(key);
            const serialized = JSON.stringify(record);
            if (snapshot.get(key) === serialized) continue;
            statements.push(upsertStatement(env, recordRow(entity, record)));
        }
    }

    for (const key of snapshot.keys()) {
        if (seen.has(key)) continue;
        const sep = key.indexOf(':');
        statements.push(
            env.DB.prepare('DELETE FROM records WHERE entity=? AND id=?')
                .bind(key.slice(0, sep), key.slice(sep + 1))
        );
    }

    if (statements.length === 0) return;
    await env.DB.batch(statements);

    // Resync the snapshot so a second saveState in the same request is a no-op
    // for already-persisted rows.
    snapshot.clear();
    for (const entity of ENTITY_NAMES) {
        for (const record of state.entities?.[entity] || []) {
            if (record?.id) snapshot.set(`${entity}:${record.id}`, JSON.stringify(record));
        }
    }
}

async function insertNavLog(env, { userId, pageName }) {
    await env.DB
        .prepare('INSERT INTO nav_logs (id,user_id,page_name,timestamp) VALUES (?,?,?,?)')
        .bind(makeId('nav'), String(userId || ''), String(pageName || ''), nowIso())
        .run();
}

function getEntityStore(state, entityName) {
    if (!ENTITY_NAMES.includes(entityName)) return null;
    if (!Array.isArray(state.entities[entityName])) {
        state.entities[entityName] = [];
    }
    return state.entities[entityName];
}

function getUserById(state, userId) {
    return state.entities.User.find((entry) => entry.id === userId) || null;
}

function getUserByEmail(state, email) {
    const normalized = normalizeEmail(email);
    return state.entities.User.find((entry) => normalizeEmail(entry.email) === normalized) || null;
}

function secretKeyFromEnv(env) {
    const secret = String(env.APP_JWT_SECRET || '');
    // Fail closed: never fall back to a known/default signing key in production,
    // otherwise anyone can forge tokens (including admin ones).
    if (!secret || secret === 'change-me-in-production' || secret.length < 16) {
        throw Object.assign(
            new Error('Server misconfigured: APP_JWT_SECRET is not set to a strong value.'),
            { status: 500 }
        );
    }
    return new TextEncoder().encode(secret);
}

function normalizePrivateKey(value) {
    return String(value || '').replace(/\\n/g, '\n').trim();
}

function getFcmConfig(env) {
    const projectId = String(env.FCM_PROJECT_ID || '').trim();
    const clientEmail = String(env.FCM_CLIENT_EMAIL || '').trim();
    const privateKey = normalizePrivateKey(env.FCM_PRIVATE_KEY || '');
    return {
        projectId,
        clientEmail,
        privateKey,
        isConfigured: Boolean(projectId && clientEmail && privateKey),
    };
}

function pemToArrayBuffer(privateKeyPem) {
    const base64Payload = String(privateKeyPem || '')
        .replace(/-----BEGIN PRIVATE KEY-----/g, '')
        .replace(/-----END PRIVATE KEY-----/g, '')
        .replace(/\s+/g, '');
    const binary = atob(base64Payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
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

async function createServiceAccountAssertion(clientEmail, privateKey) {
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKey),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const nowInSeconds = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: FCM_SCOPE })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(clientEmail)
        .setAudience(GOOGLE_OAUTH_TOKEN_URL)
        .setIssuedAt(nowInSeconds)
        .setExpirationTime(nowInSeconds + 3600)
        .sign(key);
}

async function getFcmAccessToken(env) {
    if (cachedFcmToken.value && Date.now() < cachedFcmToken.expiresAt - FCM_TOKEN_REFRESH_BUFFER_MS) {
        return cachedFcmToken.value;
    }

    const config = getFcmConfig(env);
    if (!config.isConfigured) {
        throw Object.assign(new Error('FCM provider not configured.'), { status: 503 });
    }

    const assertion = await createServiceAccountAssertion(config.clientEmail, config.privateKey);
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

async function sendPushWithFcm(env, { token, title, body, data }) {
    const config = getFcmConfig(env);
    if (!config.isConfigured) {
        throw Object.assign(new Error('FCM provider not configured.'), { status: 503 });
    }

    const accessToken = await getFcmAccessToken(env);
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

function resolvePushTargetToken(state, body) {
    const directToken = String(body?.token || '').trim();
    if (directToken) return directToken;
    const userId = String(body?.userId || '').trim();
    if (!userId) return '';
    const user = getUserById(state, userId);
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

function createAttendanceForAuthUser(state, authUser, payload = {}, requestMeta = {}) {
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

    const operators = getEntityStore(state, 'Operator');
    const operator = operators.find((entry) => entry.id === authUser.operatorId) || null;
    const now = new Date();
    const dateKey = toDateKey(now);
    const attendances = getEntityStore(state, 'Attendance');
    const existingAttendances = attendances.filter(
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
        periods: getEntityStore(state, 'PracticePeriod'),
        classPlans: getEntityStore(state, 'ClassPracticePlan'),
        practiceSchedules: getEntityStore(state, 'PracticeSchedule'),
        schedules: getEntityStore(state, 'Schedule'),
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
        // deviceLabel/devicePlatform are client-reported; deviceUserAgent is the
        // authoritative value read from the request header server-side.
        deviceLabel: sanitizeDeviceText(payload?.deviceLabel, 120),
        devicePlatform: sanitizeDeviceText(payload?.devicePlatform, 40),
        deviceUserAgent: sanitizeDeviceText(requestMeta?.userAgent, 300),
        // Mock-location anti-fraud signals (mocked=true is rejected earlier).
        isMocked: false,
        mockCheckAvailable,
    };

    attendances.unshift(created);
    return {
        statusCode: 201,
        created,
        validation,
    };
}

async function issueToken(env, user) {
    return new SignJWT({
        role: user.role || 'user',
        email: normalizeEmail(user.email),
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(secretKeyFromEnv(env));
}

function getBearerToken(c) {
    const authHeader = String(c.req.header('Authorization') || '');
    if (!authHeader.startsWith('Bearer ')) return '';
    return authHeader.slice('Bearer '.length).trim();
}

async function createInvitedUser(state, email, role = 'user') {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw Object.assign(new Error('Email is required.'), { status: 400 });
    }

    const existing = getUserByEmail(state, normalizedEmail);
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
        passwordHash: await hashPassword(tempPassword),
    };

    state.entities.User.unshift(newUser);
    return { user: newUser, tempPassword, created: true };
}

// Default production origins: the deployed Pages frontend, plus the Capacitor
// WebView origins Android/iOS use by default (androidScheme defaults to
// 'https', iOS uses the capacitor:// scheme). Extend via APP_ALLOWED_ORIGINS
// (comma-separated) without a code change, e.g. for a future custom domain.
const DEFAULT_ALLOWED_ORIGINS = [
    'https://pontaj-practica.pages.dev',
    'https://localhost',
    'capacitor://localhost',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
];

function resolveAllowedOrigins(env) {
    const extra = String(env?.APP_ALLOWED_ORIGINS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

const app = new Hono();
app.use('*', (c, next) => cors({
    origin: (origin) => (origin && resolveAllowedOrigins(c.env).has(origin) ? origin : ''),
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
})(c, next));

app.use('*', async (c, next) => {
    c.set('state', await loadState(c.env));
    await next();
});

app.get('/api/health', (c) => {
    return c.json({ ok: true, timestamp: nowIso() });
});

app.get('/api/apps/public/prod/public-settings/by-id/:appId', (c) => {
    return c.json({
        id: c.req.param('appId'),
        public_settings: {},
    });
});

app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const email = normalizeEmail(body?.email);

    const rateLimit = await checkLoginRateLimit(c.env, email);
    if (rateLimit.limited) {
        c.header('Retry-After', String(rateLimit.retryAfterSeconds));
        return c.json({ message: 'Prea multe incercari esuate. Incearca din nou mai tarziu.' }, 429);
    }

    const state = c.get('state');
    const user = getUserByEmail(state, email);
    if (!user || user.isActive === false) {
        await recordLoginFailure(c.env, email);
        return c.json({ message: 'Email sau parola invalida.' }, 401);
    }

    const isValidPassword = await verifyPassword(body?.password, user.passwordHash);
    if (!isValidPassword) {
        await recordLoginFailure(c.env, email);
        return c.json({ message: 'Email sau parola invalida.' }, 401);
    }

    await clearLoginRateLimit(c.env, email);

    // Opportunistically upgrade legacy/weak hashes to the current scheme.
    if (passwordNeedsRehash(user.passwordHash)) {
        user.passwordHash = await hashPassword(body?.password);
        await saveState(c.env, state);
    }

    const token = await issueToken(c.env, user);
    return c.json({
        access_token: token,
        user: stripSensitiveUserFields(user),
    });
});

app.post('/api/auth/register', async (c) => {
    const body = await c.req.json();
    const state = c.get('state');
    const normalizedEmail = normalizeEmail(body?.email);
    if (!normalizedEmail || !body?.password) {
        return c.json({ message: 'Email si parola sunt obligatorii.' }, 400);
    }

    if (getUserByEmail(state, normalizedEmail)) {
        return c.json({ message: 'Exista deja un cont cu acest email.' }, 409);
    }

    const created = {
        id: makeId('user'),
        // Self-service registration can only ever create a plain student account.
        // Elevated roles are assigned exclusively by an authenticated admin.
        role: 'user',
        full_name: String(body?.full_name || normalizedEmail.split('@')[0]),
        email: normalizedEmail,
        phoneNumber: '',
        pushToken: '',
        className: '',
        specialization: '',
        operatorId: '',
        isActive: true,
        created_date: nowIso(),
        passwordHash: await hashPassword(body.password),
    };
    state.entities.User.unshift(created);
    await saveState(c.env, state);

    return c.json({
        access_token: await issueToken(c.env, created),
        user: stripSensitiveUserFields(created),
    }, 201);
});

app.use('/api/*', async (c, next) => {
    const publicPaths = new Set([
        '/api/health',
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/reset-password-request',
        '/api/auth/reset-password-confirm',
    ]);
    if (publicPaths.has(c.req.path) || c.req.path.startsWith('/api/apps/public/')) {
        await next();
        return;
    }

    const token = getBearerToken(c);
    if (!token) {
        return c.json({ message: 'Authentication required.' }, 401);
    }

    try {
        const verified = await jwtVerify(token, secretKeyFromEnv(c.env));
        const state = c.get('state');
        const user = getUserById(state, verified.payload.sub);
        if (!user || user.isActive === false) {
            return c.json({ message: 'Invalid user session.' }, 401);
        }
        c.set('authUser', user);
        c.set('authPayload', verified.payload);
        await next();
    } catch {
        return c.json({ message: 'Invalid token.' }, 401);
    }
});

app.get('/api/auth/me', (c) => {
    return c.json(stripSensitiveUserFields(c.get('authUser')));
});

app.patch('/api/auth/me', async (c) => {
    const allowedFields = new Set([
        'full_name',
        'phoneNumber',
        'pushToken',
        'className',
        'specialization',
        'operatorId',
    ]);
    const body = await c.req.json();
    const authUser = c.get('authUser');
    Object.entries(body || {}).forEach(([key, value]) => {
        if (allowedFields.has(key)) {
            authUser[key] = value;
        }
    });
    await saveState(c.env, c.get('state'));
    return c.json(stripSensitiveUserFields(authUser));
});

app.post('/api/auth/logout', (c) => c.json({ success: true }));

function isAdmin(c) {
    return c.get('authUser')?.role === 'admin';
}

function assertAdmin(c) {
    if (!isAdmin(c)) {
        return c.json({ message: 'Admin role is required for this action.' }, 403);
    }
    return null;
}

// Entities a normal (student) account may never read in bulk — they expose
// other people's PII or audit data.
const STUDENT_READ_FORBIDDEN_ENTITIES = new Set(['User', 'AuditLog']);

// Generic entity writes (create/update/delete/bulk) are admin-only. The narrow
// exceptions a student is allowed (own attendance check-in, own absence note)
// are handled explicitly in the create route below.
function assertEntityReadAllowed(c, entity) {
    if (isAdmin(c)) return null;
    if (STUDENT_READ_FORBIDDEN_ENTITIES.has(entity)) {
        return c.json({ message: 'Admin role is required for this action.' }, 403);
    }
    return null;
}

// For non-admins, force Attendance queries to only ever return their own rows
// (prevents enumerating every student's GPS location).
function scopeAttendanceToUser(c, entity, items) {
    if (entity !== 'Attendance' || isAdmin(c)) return items;
    const selfId = c.get('authUser')?.id;
    return items.filter((entry) => entry?.studentUserId === selfId);
}

app.post('/api/auth/invite', async (c) => {
    const denied = assertAdmin(c);
    if (denied) return denied;
    const body = await c.req.json();
    const state = c.get('state');
    try {
        const result = await createInvitedUser(state, body?.email, body?.role || 'user');
        await saveState(c.env, state);
        return c.json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        }, result.created ? 201 : 200);
    } catch (error) {
        return c.json({ message: error.message || 'Cannot invite user.' }, error.status || 500);
    }
});

app.post('/api/auth/invite-user', async (c) => {
    const denied = assertAdmin(c);
    if (denied) return denied;
    const body = await c.req.json();
    const state = c.get('state');
    try {
        const result = await createInvitedUser(state, body?.email, body?.role || 'user');
        await saveState(c.env, state);
        return c.json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        }, result.created ? 201 : 200);
    } catch (error) {
        return c.json({ message: error.message || 'Cannot invite user.' }, error.status || 500);
    }
});

app.post('/api/users/invite', async (c) => {
    const denied = assertAdmin(c);
    if (denied) return denied;
    const body = await c.req.json();
    const state = c.get('state');
    try {
        const result = await createInvitedUser(state, body?.email, body?.role || 'user');
        await saveState(c.env, state);
        return c.json({
            ...stripSensitiveUserFields(result.user),
            tempPassword: result.tempPassword,
        }, result.created ? 201 : 200);
    } catch (error) {
        return c.json({ message: error.message || 'Cannot invite user.' }, error.status || 500);
    }
});

// Public self-service "forgot password": emails a one-time reset link.
// Always returns success so it can't be used to discover which emails exist.
app.post('/api/auth/reset-password-request', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const state = c.get('state');
    const user = email ? getUserByEmail(state, email) : null;

    if (user && user.isActive !== false) {
        const rawToken = randomToken();
        user.resetTokenHash = await sha256Hex(rawToken);
        user.resetTokenExpiresAt = Date.now() + RESET_TOKEN_TTL_MS;
        await saveState(c.env, state);

        const base = String(c.env.APP_PUBLIC_URL || 'https://pontaj-practica.pages.dev').replace(/\/+$/, '');
        const link = `${base}/ResetPassword?token=${rawToken}&uid=${encodeURIComponent(user.id)}`;
        try {
            await sendResetEmail(c.env, { to: user.email, link, fullName: user.full_name });
        } catch {
            // Swallow provider errors: never reveal whether the address is real.
        }
    }

    return c.json({ success: true });
});

// Public: consume a reset token and set a new password.
app.post('/api/auth/reset-password-confirm', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const userId = String(body?.uid || body?.userId || '').trim();
    const token = String(body?.token || '').trim();
    const newPassword = String(body?.newPassword || '');

    if (!userId || !token || newPassword.length < 6) {
        return c.json({ message: 'Date invalide sau parola prea scurta (minim 6 caractere).' }, 400);
    }

    const state = c.get('state');
    const user = getUserById(state, userId);
    const providedHash = await sha256Hex(token);
    const tokenValid = user
        && user.resetTokenHash
        && constantTimeEqual(providedHash, user.resetTokenHash)
        && Number(user.resetTokenExpiresAt || 0) > Date.now();

    if (!tokenValid) {
        return c.json({ message: 'Link de resetare invalid sau expirat.' }, 400);
    }

    user.passwordHash = await hashPassword(newPassword);
    delete user.resetTokenHash;
    delete user.resetTokenExpiresAt;
    await saveState(c.env, state);
    return c.json({ success: true });
});

app.post('/api/auth/reset-password', async (c) => {
    const body = await c.req.json();
    const state = c.get('state');
    const authUser = c.get('authUser');
    const targetUser = body?.userId
        ? getUserById(state, body.userId)
        : (body?.email ? getUserByEmail(state, body.email) : authUser);

    if (!targetUser) {
        return c.json({ message: 'User not found.' }, 404);
    }
    if (authUser.role !== 'admin' && authUser.id !== targetUser.id) {
        return c.json({ message: 'Not allowed.' }, 403);
    }

    targetUser.passwordHash = await hashPassword(body?.newPassword || 'elev123');
    await saveState(c.env, state);
    return c.json({ success: true });
});

// Admin-driven reset for accounts that can't receive email (e.g. students with
// @practica.local addresses): set a fresh temp password and return it so the
// admin can hand it over.
app.post('/api/auth/admin-reset-password', async (c) => {
    const denied = assertAdmin(c);
    if (denied) return denied;
    const body = await c.req.json();
    const state = c.get('state');
    const target = body?.userId
        ? getUserById(state, body.userId)
        : (body?.email ? getUserByEmail(state, body.email) : null);
    if (!target) {
        return c.json({ message: 'User not found.' }, 404);
    }
    const tempPassword = generateTempPassword();
    target.passwordHash = await hashPassword(tempPassword);
    delete target.resetTokenHash;
    delete target.resetTokenExpiresAt;
    await saveState(c.env, state);
    return c.json({ success: true, tempPassword });
});

app.post('/api/auth/change-password', async (c) => {
    const body = await c.req.json();
    const authUser = c.get('authUser');
    if (!body?.newPassword) {
        return c.json({ message: 'New password is required.' }, 400);
    }
    const isValidOldPassword = await verifyPassword(body?.oldPassword, authUser.passwordHash);
    if (!isValidOldPassword) {
        return c.json({ message: 'Parola curenta este incorecta.' }, 400);
    }
    authUser.passwordHash = await hashPassword(body.newPassword);
    await saveState(c.env, c.get('state'));
    return c.json({ success: true });
});

app.post('/api/functions/invoke', async (c) => {
    const body = await c.req.json();
    if (!body?.name) {
        return c.json({ message: 'Function name is required.' }, 400);
    }
    return c.json({
        success: true,
        functionName: body.name,
        payload: body.payload || {},
    });
});

app.post('/api/integrations/core/:method', async (c) => {
    const body = await c.req.json();
    const method = c.req.param('method');

    if (!PUSH_CORE_METHODS.has(method)) {
        return c.json({
            success: true,
            method,
            payload: body || {},
        });
    }

    // Sending push notifications to arbitrary users is an admin-only capability.
    const denied = assertAdmin(c);
    if (denied) return denied;

    const targetToken = resolvePushTargetToken(c.get('state'), body);
    if (!targetToken) {
        return c.json({ message: 'Target push token missing.' }, 400);
    }

    const dataPayload = {
        channel: body?.channel || 'push',
        userId: body?.userId || '',
        studentName: body?.studentName || '',
        ...(body?.data && typeof body.data === 'object' ? body.data : {}),
    };

    try {
        const providerResponse = await sendPushWithFcm(c.env, {
            token: targetToken,
            title: body?.title,
            body: body?.body,
            data: dataPayload,
        });
        return c.json({
            success: true,
            method,
            provider: 'fcm',
            payload: body || {},
            response: providerResponse,
        });
    } catch (error) {
        const statusCode = Number(error?.status) || 500;
        return c.json({
            message: error?.message || 'Cannot send push notification.',
            details: error?.details || null,
        }, statusCode);
    }
});

app.post('/api/attendance/checkin', async (c) => {
    const authUser = c.get('authUser');
    const body = await c.req.json();
    const state = c.get('state');
    const result = createAttendanceForAuthUser(state, authUser, body, {
        userAgent: c.req.header('User-Agent'),
    });

    if (!result.created) {
        return c.json(result.response, result.statusCode);
    }
    await saveState(c.env, state);

    return c.json({
        attendance: result.created,
        message: result.validation.validationMessage,
    }, 201);
});

app.post('/api/app-logs/navigation', async (c) => {
    const body = await c.req.json();
    const authUser = c.get('authUser');
    await insertNavLog(c.env, { userId: authUser.id, pageName: body?.pageName || '' });
    return c.json({ success: true });
});

app.get('/api/entities/:entity/list', (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const readDenied = assertEntityReadAllowed(c, entity);
    if (readDenied) return readDenied;

    const scoped = scopeAttendanceToUser(c, entity, store);
    const sanitized = scoped.map((entry) => sanitizeEntity(entity, entry));
    const sorted = applySort(sanitized, c.req.query('sort'));
    const sliced = applyLimitSkip(sorted, c.req.query('limit'), c.req.query('skip'));
    const selected = applyFields(sliced, c.req.query('fields'));
    return c.json(selected);
});

app.post('/api/entities/:entity/filter', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const readDenied = assertEntityReadAllowed(c, entity);
    if (readDenied) return readDenied;

    const body = await c.req.json();
    const filtered = scopeAttendanceToUser(c, entity, store)
        .map((entry) => sanitizeEntity(entity, entry))
        .filter((entry) => matchesQuery(entry, body?.query));
    const sorted = applySort(filtered, body?.sort);
    const sliced = applyLimitSkip(sorted, body?.limit, body?.skip);
    const selected = applyFields(sliced, body?.fields);
    return c.json(selected);
});

app.get('/api/entities/:entity/:id', (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const id = c.req.param('id');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const readDenied = assertEntityReadAllowed(c, entity);
    if (readDenied) return readDenied;

    const found = scopeAttendanceToUser(c, entity, store).find((entry) => String(entry.id) === String(id));
    if (!found) return c.json({ message: 'Entity not found.' }, 404);
    return c.json(sanitizeEntity(entity, found));
});

app.post('/api/entities/:entity', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const body = await c.req.json();
    const authUser = c.get('authUser');

    if (!isAdmin(c)) {
        // Students may submit their own attendance check-in...
        if (entity === 'Attendance') {
            const result = createAttendanceForAuthUser(state, authUser, body, {
                userAgent: c.req.header('User-Agent'),
            });
            if (!result.created) {
                return c.json(result.response, result.statusCode);
            }
            await saveState(c.env, state);
            return c.json(sanitizeEntity(entity, result.created), 201);
        }

        // ...and append an audit-log note (e.g. absence explanation), but actor
        // identity is stamped server-side so it cannot be spoofed.
        if (entity === 'AuditLog') {
            const note = {
                id: makeId('auditlog'),
                created_date: nowIso(),
                ...(body || {}),
                actorName: authUser.full_name || 'Elev',
                actorEmail: authUser.email || '',
                actorId: authUser.id,
            };
            store.unshift(note);
            await saveState(c.env, state);
            return c.json(sanitizeEntity(entity, note), 201);
        }

        // Any other direct entity write is an admin-only operation.
        return c.json({ message: 'Admin role is required for this action.' }, 403);
    }

    const created = {
        id: makeId(entity.toLowerCase()),
        created_date: nowIso(),
        ...(body || {}),
    };

    if (entity === 'User') {
        created.email = normalizeEmail(created.email);
        if (created.email && getUserByEmail(state, created.email)) {
            return c.json({ message: 'Exista deja un utilizator cu acest email.' }, 409);
        }
        created.role = created.role || 'user';
        if (!created.passwordHash) {
            created.passwordHash = await hashPassword(created.password || 'elev123');
        }
        delete created.password;
    }

    store.unshift(created);
    await saveState(c.env, state);
    return c.json(sanitizeEntity(entity, created), 201);
});

app.patch('/api/entities/:entity/:id', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const id = c.req.param('id');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);
    // Students edit only their own profile via PATCH /api/auth/me; any direct
    // entity update requires admin.
    const denied = assertAdmin(c);
    if (denied) return denied;

    const index = store.findIndex((entry) => String(entry.id) === String(id));
    if (index === -1) return c.json({ message: 'Entity not found.' }, 404);

    const body = await c.req.json();
    const payload = body || {};
    if (entity === 'User' && payload.email) {
        const existingByEmail = getUserByEmail(state, payload.email);
        if (existingByEmail && existingByEmail.id !== id) {
            return c.json({ message: 'Exista deja un utilizator cu acest email.' }, 409);
        }
        payload.email = normalizeEmail(payload.email);
    }

    if (entity === 'User' && payload.password) {
        payload.passwordHash = await hashPassword(payload.password);
        delete payload.password;
    }

    store[index] = { ...store[index], ...payload };
    await saveState(c.env, state);
    return c.json(sanitizeEntity(entity, store[index]));
});

app.delete('/api/entities/:entity/:id', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const id = c.req.param('id');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);
    const denied = assertAdmin(c);
    if (denied) return denied;

    const index = store.findIndex((entry) => String(entry.id) === String(id));
    if (index === -1) return c.json({ message: 'Entity not found.' }, 404);
    store.splice(index, 1);
    await saveState(c.env, state);
    return c.json({ success: true });
});

app.post('/api/entities/:entity/deleteMany', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);
    const denied = assertAdmin(c);
    if (denied) return denied;

    const body = await c.req.json();
    const ids = Array.isArray(body?.ids) ? body.ids.map((entry) => String(entry)) : [];
    state.entities[entity] = store.filter((entry) => !ids.includes(String(entry.id)));
    await saveState(c.env, state);
    return c.json({ success: true });
});

app.post('/api/entities/:entity/bulkCreate', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);
    const denied = assertAdmin(c);
    if (denied) return denied;

    const body = await c.req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const created = [];
    for (const item of items) {
        const payload = item && typeof item === 'object' ? item : {};
        const next = {
            id: makeId(entity.toLowerCase()),
            created_date: nowIso(),
            ...payload,
        };
        if (entity === 'User') {
            next.email = normalizeEmail(next.email);
            next.role = next.role || 'user';
            if (!next.passwordHash) {
                next.passwordHash = await hashPassword(next.password || 'elev123');
            }
            delete next.password;
        }
        store.unshift(next);
        created.push(sanitizeEntity(entity, next));
    }
    await saveState(c.env, state);
    return c.json(created, 201);
});

app.post('/api/entities/:entity/importEntities', (c) => {
    const denied = assertAdmin(c);
    if (denied) return denied;
    return c.json({ success: true });
});

app.notFound((c) => c.json({ message: 'Not Found' }, 404));

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

async function runAutomaticReminderSweep(env, state, triggerLabel = 'scheduled') {
    const classrooms = getEntityStore(state, 'Classroom');
    const users = getEntityStore(state, 'User');
    const attendances = getEntityStore(state, 'Attendance');
    const auditLogs = getEntityStore(state, 'AuditLog');

    const now = new Date();
    const todayKey = toDateKey(now);
    const nowMinutes = getAppMinutes(now);
    const todayAttendanceIds = new Set(
        attendances
            .filter((entry) => entry?.dateKey === todayKey)
            .map((entry) => String(entry.studentUserId || ''))
    );

    let changed = false;
    const results = [];
    const notificationLink = String(env.REMINDER_NOTIFICATION_LINK || '').trim();

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
                await sendPushWithFcm(env, {
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
        changed = true;

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

        results.push({
            className,
            recipients: targets.length,
            sent,
            missing,
            error,
        });
    }

    if (changed) {
        await saveState(env, state);
    }

    return {
        changed,
        dateKey: todayKey,
        results,
    };
}

const workerHandlers = {
    fetch: app.fetch,
    async scheduled(controller, env) {
        const state = await loadState(env);
        await runAutomaticReminderSweep(env, state, controller?.cron || 'scheduled');
    },
};

export default workerHandlers;
