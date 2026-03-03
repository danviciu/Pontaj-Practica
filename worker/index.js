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
const PASSWORD_HASH_PREFIX = 'sha256$';
const LEGACY_BCRYPT_RE = /^\$2[aby]\$/;
const passwordEncoder = new TextEncoder();

function nowIso() {
    return new Date().toISOString();
}

function toHex(buffer) {
    return [...new Uint8Array(buffer)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
    const normalizedPassword = String(password || '');
    const payload = `pontaj-practica:${normalizedPassword}`;
    const digest = await crypto.subtle.digest('SHA-256', passwordEncoder.encode(payload));
    return `${PASSWORD_HASH_PREFIX}${toHex(digest)}`;
}

async function verifyPassword(password, storedHash) {
    const normalizedPassword = String(password || '');
    const normalizedHash = String(storedHash || '');
    if (!normalizedHash) return false;

    if (normalizedHash.startsWith(PASSWORD_HASH_PREFIX)) {
        const nextHash = await hashPassword(normalizedPassword);
        return nextHash === normalizedHash;
    }

    if (LEGACY_BCRYPT_RE.test(normalizedHash)) {
        try {
            return await bcrypt.compare(normalizedPassword, normalizedHash);
        } catch {
            return false;
        }
    }

    return normalizedPassword === normalizedHash;
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

async function loadState(env) {
    const raw = await env.DB_KV.get(DB_KEY, 'json');
    if (!raw) {
        const initial = await createDefaultState();
        await env.DB_KV.put(DB_KEY, JSON.stringify(initial));
        return initial;
    }
    return normalizeState(raw);
}

async function saveState(env, state) {
    await env.DB_KV.put(DB_KEY, JSON.stringify(state));
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
    const secret = String(env.APP_JWT_SECRET || 'change-me-in-production');
    return new TextEncoder().encode(secret);
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
        passwordHash: await hashPassword(tempPassword),
    };

    state.entities.User.unshift(newUser);
    return { user: newUser, tempPassword, created: true };
}

const app = new Hono();
app.use('*', cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

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

app.post('/api/auth/bootstrap', async (c) => {
    const state = c.get('state');
    let adminUser = state.entities.User.find((entry) => entry.role === 'admin' && entry.isActive !== false);
    if (!adminUser) {
        const created = await createInvitedUser(state, 'admin.demo@local.test', 'admin');
        adminUser = created.user;
        adminUser.full_name = 'Admin Demo';
        adminUser.passwordHash = await hashPassword('admin123');
        await saveState(c.env, state);
    }

    const token = await issueToken(c.env, adminUser);
    return c.json({
        access_token: token,
        user: stripSensitiveUserFields(adminUser),
    });
});

app.post('/api/auth/login', async (c) => {
    const body = await c.req.json();
    const state = c.get('state');
    const user = getUserByEmail(state, body?.email);
    if (!user || user.isActive === false) {
        return c.json({ message: 'Email sau parola invalida.' }, 401);
    }

    const isValidPassword = await verifyPassword(body?.password, user.passwordHash);
    if (!isValidPassword) {
        return c.json({ message: 'Email sau parola invalida.' }, 401);
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
        role: body?.role || 'user',
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
        '/api/auth/bootstrap',
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

function assertAdmin(c) {
    if (c.get('authUser')?.role !== 'admin') {
        return c.json({ message: 'Admin role is required for this action.' }, 403);
    }
    return null;
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

app.post('/api/auth/reset-password-request', (c) => c.json({ success: true }));

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
    return c.json({
        success: true,
        method: c.req.param('method'),
        payload: body || {},
    });
});

app.post('/api/app-logs/navigation', async (c) => {
    const body = await c.req.json();
    const state = c.get('state');
    const authUser = c.get('authUser');
    state.navigationLogs.unshift({
        id: makeId('nav'),
        userId: authUser.id,
        pageName: body?.pageName || '',
        timestamp: nowIso(),
    });
    if (state.navigationLogs.length > 2000) {
        state.navigationLogs.length = 2000;
    }
    await saveState(c.env, state);
    return c.json({ success: true });
});

app.get('/api/entities/:entity/list', (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const sanitized = store.map((entry) => sanitizeEntity(entity, entry));
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

    const body = await c.req.json();
    const filtered = store
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

    const found = store.find((entry) => String(entry.id) === String(id));
    if (!found) return c.json({ message: 'Entity not found.' }, 404);
    return c.json(sanitizeEntity(entity, found));
});

app.post('/api/entities/:entity', async (c) => {
    const state = c.get('state');
    const entity = c.req.param('entity');
    const store = getEntityStore(state, entity);
    if (!store) return c.json({ message: `Unknown entity ${entity}` }, 404);

    const body = await c.req.json();
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

app.post('/api/entities/:entity/importEntities', (c) => c.json({ success: true }));

app.notFound((c) => c.json({ message: 'Not Found' }, 404));

export default app;
