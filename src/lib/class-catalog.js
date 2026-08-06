import { base44, isDemoMode } from '@/api/base44Client';

const STORAGE_KEY = 'attendance.classCatalog.v1';
export const DEFAULT_CLASS_REMINDER_SETTINGS = {
    enabled: false,
    reminderTime: '09:00',
    onlyAbsent: true,
    channels: {
        email: false,
        push: true,
        sms: false,
    },
};

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
    if (!/^\d{2}:\d{2}$/.test(candidate)) return DEFAULT_CLASS_REMINDER_SETTINGS.reminderTime;
    const [hoursRaw, minutesRaw] = candidate.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return DEFAULT_CLASS_REMINDER_SETTINGS.reminderTime;
    }
    return `${hoursRaw.padStart(2, '0')}:${minutesRaw.padStart(2, '0')}`;
}

export function normalizeClassReminderSettings(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        enabled: source.enabled === true,
        reminderTime: normalizeReminderTime(source.reminderTime),
        onlyAbsent: source.onlyAbsent === false ? false : true,
        channels: normalizeReminderChannels({
            ...DEFAULT_CLASS_REMINDER_SETTINGS.channels,
            ...(source.channels || {}),
        }),
    };
}

function hasReminderPayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    return (
        Object.prototype.hasOwnProperty.call(payload, 'reminderSettings')
        || Object.prototype.hasOwnProperty.call(payload, 'reminderEnabled')
        || Object.prototype.hasOwnProperty.call(payload, 'reminderTime')
        || Object.prototype.hasOwnProperty.call(payload, 'reminderOnlyAbsent')
        || Object.prototype.hasOwnProperty.call(payload, 'reminderChannels')
    );
}

function normalizeClassPayload(payload = {}) {
    const name = normalizeClassName(payload.name);
    const normalized = {
        name,
        specialization: normalizeWhitespace(payload.specialization || ''),
        defaultOperatorId: payload.defaultOperatorId || '',
        isActive: payload.isActive !== false,
    };
    if (hasReminderPayload(payload)) {
        const mergedReminderSettings = normalizeClassReminderSettings({
            ...(payload.reminderSettings && typeof payload.reminderSettings === 'object' ? payload.reminderSettings : {}),
            enabled: payload.reminderEnabled === true
                ? true
                : payload.reminderEnabled === false
                    ? false
                    : payload.reminderSettings?.enabled,
            reminderTime: payload.reminderTime || payload.reminderSettings?.reminderTime,
            onlyAbsent: payload.reminderOnlyAbsent === false
                ? false
                : payload.reminderOnlyAbsent === true
                    ? true
                    : payload.reminderSettings?.onlyAbsent,
            channels: {
                ...(payload.reminderSettings?.channels || {}),
                ...(payload.reminderChannels && typeof payload.reminderChannels === 'object' ? payload.reminderChannels : {}),
            },
        });
        normalized.reminderSettings = mergedReminderSettings;
        normalized.reminderEnabled = mergedReminderSettings.enabled;
        normalized.reminderTime = mergedReminderSettings.reminderTime;
        normalized.reminderOnlyAbsent = mergedReminderSettings.onlyAbsent;
        normalized.reminderChannels = mergedReminderSettings.channels;
    }
    return normalized;
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
