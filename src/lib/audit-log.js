import { base44 } from '@/api/base44Client';

const LOCAL_AUDIT_LOGS_KEY = 'pontaj.audit.logs.v1';

function nowIso() {
    return new Date().toISOString();
}

function readLocalAuditLogs() {
    if (typeof window === 'undefined') return [];
    try {
        const rawValue = window.localStorage.getItem(LOCAL_AUDIT_LOGS_KEY);
        const parsed = rawValue ? JSON.parse(rawValue) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function writeLocalAuditLogs(logs) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LOCAL_AUDIT_LOGS_KEY, JSON.stringify(logs.slice(0, 500)));
    } catch (error) {
        console.warn('Cannot persist local audit logs:', error);
    }
}

function normalizeAuditEntry(entry) {
    return {
        id: entry.id || `${entry.timestamp || entry.created_date || nowIso()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: entry.timestamp || entry.created_date || nowIso(),
        action: entry.action || 'UNKNOWN_ACTION',
        entityType: entry.entityType || 'SYSTEM',
        entityId: entry.entityId || '',
        actorName: entry.actorName || 'Sistem',
        actorEmail: entry.actorEmail || '',
        details: entry.details || '',
        metadata: entry.metadata || {},
        source: entry.source || 'remote',
    };
}

export async function logAuditEvent(payload = {}) {
    const entry = normalizeAuditEntry({
        ...payload,
        timestamp: payload.timestamp || nowIso(),
    });

    try {
        await base44.entities.AuditLog.create({
            timestamp: entry.timestamp,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId,
            actorName: entry.actorName,
            actorEmail: entry.actorEmail,
            details: entry.details,
            metadata: entry.metadata,
        });
        return { status: 'remote', entry };
    } catch (error) {
        const localLogs = readLocalAuditLogs();
        localLogs.unshift({ ...entry, source: 'local' });
        writeLocalAuditLogs(localLogs);
        return { status: 'local', entry };
    }
}

export async function listAuditEvents(limit = 50) {
    let remoteEntries = [];
    try {
        const records = await base44.entities.AuditLog.list('-created_date', limit);
        remoteEntries = records.map((record) => normalizeAuditEntry({ ...record, source: 'remote' }));
    } catch (error) {
        remoteEntries = [];
    }

    const localEntries = readLocalAuditLogs().map((entry) => normalizeAuditEntry({ ...entry, source: 'local' }));

    return [...remoteEntries, ...localEntries]
        .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))
        .slice(0, limit);
}
