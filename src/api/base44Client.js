import { appParams } from '@/lib/app-params';

const TOKEN_KEYS = ['app_access_token', 'base44_access_token', 'token'];
const isBrowser = typeof window !== 'undefined';

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const API_BASE_URL = normalizeBaseUrl(appParams.appBaseUrl || import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8787');

export const isDemoMode = String(import.meta.env.VITE_USE_DEMO || '').toLowerCase() === 'true';

function readStoredToken() {
    if (!isBrowser) return null;
    for (const key of TOKEN_KEYS) {
        const value = window.localStorage.getItem(key);
        if (value) return value;
    }
    return null;
}

function writeStoredToken(tokenValue) {
    if (!isBrowser) return;
    TOKEN_KEYS.forEach((key) => {
        if (tokenValue) {
            window.localStorage.setItem(key, tokenValue);
        } else {
            window.localStorage.removeItem(key);
        }
    });
}

let accessToken = appParams.token || readStoredToken();

function setAccessToken(tokenValue) {
    accessToken = tokenValue || null;
    writeStoredToken(accessToken);
}

function clearAccessToken() {
    setAccessToken(null);
}

function createApiError(response, data) {
    const status = response?.status || 500;
    const message = data?.message || data?.error || response?.statusText || 'Request failed.';
    const error = new Error(message);
    error.status = status;
    error.data = data;
    error.response = response;
    return error;
}

async function parseResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    const text = await response.text();
    return text ? { message: text } : {};
}

async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {
        Accept: 'application/json',
    };

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (auth && accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const parsed = await parseResponseBody(response);
    if (!response.ok) {
        throw createApiError(response, parsed);
    }
    return parsed;
}

function parseAuthPayload(input, passwordFromArg) {
    if (typeof input === 'object' && input !== null) {
        return {
            email: input.email || input.username || '',
            password: input.password || '',
        };
    }

    return {
        email: String(input || ''),
        password: String(passwordFromArg || ''),
    };
}

function buildEntityApi(entityName) {
    return {
        async list(sort, limit, skip, fields) {
            const params = new URLSearchParams();
            if (sort !== undefined && sort !== null) params.set('sort', String(sort));
            if (limit !== undefined && limit !== null) params.set('limit', String(limit));
            if (skip !== undefined && skip !== null) params.set('skip', String(skip));
            if (fields !== undefined && fields !== null) {
                params.set('fields', Array.isArray(fields) ? fields.join(',') : String(fields));
            }
            const suffix = params.toString() ? `?${params.toString()}` : '';
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/list${suffix}`);
        },
        async filter(query, sort, limit, skip, fields) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/filter`, {
                method: 'POST',
                body: { query, sort, limit, skip, fields },
            });
        },
        async get(id) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`);
        },
        async create(data) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}`, {
                method: 'POST',
                body: data || {},
            });
        },
        async update(id, data) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: data || {},
            });
        },
        async delete(id) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
        },
        async deleteMany(ids = []) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/deleteMany`, {
                method: 'POST',
                body: { ids },
            });
        },
        async bulkCreate(items = []) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/bulkCreate`, {
                method: 'POST',
                body: { items },
            });
        },
        async importEntities(payload = {}) {
            return apiRequest(`/api/entities/${encodeURIComponent(entityName)}/importEntities`, {
                method: 'POST',
                body: payload,
            });
        },
        subscribe() {
            return {
                unsubscribe() {
                    return;
                },
            };
        },
    };
}

const entitiesProxy = new Proxy(
    {},
    {
        get: (_, entityName) => {
            if (typeof entityName !== 'string') return undefined;
            return buildEntityApi(entityName);
        },
    }
);

const coreIntegrationsProxy = new Proxy(
    {},
    {
        get: (_, methodName) => {
            if (typeof methodName !== 'string') return undefined;
            return async (payload = {}) => apiRequest(`/api/integrations/core/${encodeURIComponent(methodName)}`, {
                method: 'POST',
                body: payload,
            });
        },
    }
);

export const base44 = {
    entities: entitiesProxy,
    integrations: {
        Core: coreIntegrationsProxy,
    },
    users: {
        async inviteUser(email, role = 'user') {
            return apiRequest('/api/users/invite', {
                method: 'POST',
                body: { email, role },
            });
        },
    },
    appLogs: {
        async logUserInApp(pageName) {
            return apiRequest('/api/app-logs/navigation', {
                method: 'POST',
                body: { pageName },
            });
        },
    },
    functions: {
        async invoke(name, payload = {}) {
            return apiRequest('/api/functions/invoke', {
                method: 'POST',
                body: { name, payload },
            });
        },
    },
    auth: {
        async me() {
            if (isDemoMode) {
                return {
                    id: 'demo_user',
                    role: 'admin',
                    full_name: 'Admin Demo',
                    email: 'admin.demo@local.test',
                    className: '12A',
                    specialization: 'Coordonare',
                    operatorId: '',
                    isActive: true,
                };
            }

            try {
                return await apiRequest('/api/auth/me');
            } catch (error) {
                if (error?.status === 401) {
                    clearAccessToken();
                }
                throw error;
            }
        },
        async updateMe(data = {}) {
            return apiRequest('/api/auth/me', {
                method: 'PATCH',
                body: data,
            });
        },
        redirectToLogin(fromUrl) {
            if (!isBrowser) return;
            const target = fromUrl || window.location.href;
            window.location.assign(`/Login?from_url=${encodeURIComponent(target)}`);
        },
        logout(redirectTo = true) {
            clearAccessToken();
            if (!isBrowser || redirectTo === false) return;
            const target = typeof redirectTo === 'string' && redirectTo
                ? redirectTo
                : window.location.href;
            window.location.assign(`/Login?from_url=${encodeURIComponent(target)}`);
        },
        setToken(tokenValue) {
            setAccessToken(tokenValue || null);
        },
        async isAuthenticated() {
            try {
                await this.me();
                return true;
            } catch (error) {
                return false;
            }
        },
        async loginViaEmailPassword(credentialsOrEmail, maybePassword) {
            const credentials = parseAuthPayload(credentialsOrEmail, maybePassword);
            const result = await apiRequest('/api/auth/login', {
                method: 'POST',
                auth: false,
                body: credentials,
            });
            if (result?.access_token) {
                setAccessToken(result.access_token);
            }
            return result;
        },
        async inviteUser(email, role = 'user') {
            return apiRequest('/api/auth/invite', {
                method: 'POST',
                body: { email, role },
            });
        },
        async register(payload = {}) {
            const result = await apiRequest('/api/auth/register', {
                method: 'POST',
                auth: false,
                body: payload,
            });
            if (result?.access_token) {
                setAccessToken(result.access_token);
            }
            return result;
        },
        async verifyOtp() {
            return { success: true };
        },
        async resendOtp() {
            return { success: true };
        },
        async resetPasswordRequest(email) {
            return apiRequest('/api/auth/reset-password-request', {
                method: 'POST',
                body: { email },
            });
        },
        async resetPassword(payload = {}) {
            return apiRequest('/api/auth/reset-password', {
                method: 'POST',
                body: payload,
            });
        },
        async changePassword(payload = {}) {
            return apiRequest('/api/auth/change-password', {
                method: 'POST',
                body: payload,
            });
        },
    },
};
