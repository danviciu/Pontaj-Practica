import { base44, isDemoMode } from '@/api/base44Client';

const STORAGE_KEY = 'attendance.classCatalog.v1';

function generateLocalId() {
    return `local_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeClassName(value) {
    return normalizeWhitespace(value).toUpperCase();
}

function normalizeClassPayload(payload = {}) {
    const name = normalizeClassName(payload.name);
    return {
        name,
        specialization: normalizeWhitespace(payload.specialization || ''),
        defaultOperatorId: payload.defaultOperatorId || '',
        isActive: payload.isActive !== false,
    };
}

function readLocalCatalog() {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map((entry) => ({
                id: entry.id || generateLocalId(),
                ...normalizeClassPayload(entry),
            }))
            .filter((entry) => Boolean(entry.name));
    } catch (error) {
        console.error('Cannot read class catalog from localStorage:', error);
        return [];
    }
}

function writeLocalCatalog(items) {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function isRecoverableCatalogError(error) {
    const status = error?.status || error?.response?.status;
    if (status === 404 || status === 403 || status === 405) {
        return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('not found')
        || message.includes('entity')
        || message.includes('forbidden')
    );
}

async function withFallback(remoteCall, localCall) {
    if (isDemoMode) {
        return localCall();
    }

    try {
        return await remoteCall();
    } catch (error) {
        if (isRecoverableCatalogError(error)) {
            return localCall();
        }
        throw error;
    }
}

export async function listClassCatalog() {
    return withFallback(
        async () => {
            const items = await base44.entities.Classroom.list('name', 500);
            return items
                .map((entry) => ({ ...normalizeClassPayload(entry), id: entry.id }))
                .filter((entry) => Boolean(entry.name));
        },
        async () => readLocalCatalog()
    );
}

export async function createClassCatalogItem(payload) {
    const normalized = normalizeClassPayload(payload);
    if (!normalized.name) {
        throw new Error('Numele clasei este obligatoriu.');
    }

    return withFallback(
        async () => base44.entities.Classroom.create(normalized),
        async () => {
            const items = readLocalCatalog();
            const existing = items.find((entry) => normalizeClassName(entry.name) === normalized.name);
            if (existing) {
                return existing;
            }
            const created = { id: generateLocalId(), ...normalized };
            const updated = [created, ...items];
            writeLocalCatalog(updated);
            return created;
        }
    );
}

export async function updateClassCatalogItem(id, payload) {
    const normalized = normalizeClassPayload(payload);
    if (!normalized.name) {
        throw new Error('Numele clasei este obligatoriu.');
    }

    return withFallback(
        async () => base44.entities.Classroom.update(id, normalized),
        async () => {
            const items = readLocalCatalog();
            const updated = items.map((entry) => (
                entry.id === id ? { ...entry, ...normalized } : entry
            ));
            writeLocalCatalog(updated);
            return updated.find((entry) => entry.id === id) || null;
        }
    );
}

export async function deleteClassCatalogItem(id) {
    return withFallback(
        async () => base44.entities.Classroom.delete(id),
        async () => {
            const items = readLocalCatalog();
            const updated = items.filter((entry) => entry.id !== id);
            writeLocalCatalog(updated);
            return { success: true };
        }
    );
}
