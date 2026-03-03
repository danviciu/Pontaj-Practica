import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const API_PORT = Number(process.env.API_PORT || 8787);
const JWT_SECRET = process.env.APP_JWT_SECRET || 'change-me-in-production';
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

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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
    const { passwordHash, password, ...safeUser } = user;
    return safeUser;
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

    // Ensure at least one admin account exists.
    if (!normalizedEntities.User.some((entry) => entry.role === 'admin')) {
        const defaultAdmin = fallback.entities.User.find((entry) => entry.role === 'admin');
        normalizedEntities.User.unshift(defaultAdmin);
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

function createInvitedUser(email, role = 'user') {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        throw Object.assign(new Error('Email is required.'), { status: 400 });
    }

    const existing = getUserByEmail(normalizedEmail);
    if (existing) {
        return { user: existing, tempPassword: null, created: false };
    }

    const tempPassword = `Tmp${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}!`;
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

const app = express();
app.use(cors());
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

app.post('/api/auth/bootstrap', (_, res) => {
    let adminUser = state.entities.User.find((entry) => entry.role === 'admin' && entry.isActive !== false);
    if (!adminUser) {
        const created = createInvitedUser('admin.demo@local.test', 'admin');
        adminUser = created.user;
        adminUser.full_name = 'Admin Demo';
        adminUser.passwordHash = bcrypt.hashSync('admin123', 10);
        persistState();
    }

    const token = issueToken(adminUser);
    res.json({
        access_token: token,
        user: stripSensitiveUserFields(adminUser),
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = getUserByEmail(email);
    if (!user || user.isActive === false) {
        res.status(401).json({ message: 'Email sau parola invalida.' });
        return;
    }

    const isValidPassword = bcrypt.compareSync(String(password || ''), user.passwordHash || '');
    if (!isValidPassword) {
        res.status(401).json({ message: 'Email sau parola invalida.' });
        return;
    }

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
        role = 'user',
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
        role,
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

app.post('/api/auth/reset-password-request', requireAuth, (_req, res) => {
    res.json({ success: true });
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

app.post('/api/integrations/core/:method', requireAuth, (req, res) => {
    const { method } = req.params;
    res.json({
        success: true,
        method,
        payload: req.body || {},
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

    const sanitized = store.map((entry) => sanitizeEntity(entity, entry));
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

    const { query, sort, limit, skip, fields } = req.body || {};
    const filtered = store
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

    const found = store.find((entry) => String(entry.id) === String(id));
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

app.post('/api/entities/:entity/importEntities', requireAuth, (_req, res) => {
    res.json({ success: true });
});

app.use((error, _req, res, _next) => {
    res.status(error?.status || 500).json({
        message: error?.message || 'Unexpected server error.',
    });
});

app.listen(API_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] Listening on http://127.0.0.1:${API_PORT}`);
});
