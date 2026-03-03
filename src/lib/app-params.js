const isNode = typeof window === 'undefined';
const windowObj = isNode ? { localStorage: new Map() } : window;
const storage = windowObj.localStorage;

const toSnakeCase = (str) => {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false } = {}) => {
    if (isNode) {
        return defaultValue;
    }
    const storageKey = `app_${toSnakeCase(paramName)}`;
    const legacyStorageKey = `base44_${toSnakeCase(paramName)}`;
    const urlParams = new URLSearchParams(window.location.search);
    const searchParam = urlParams.get(paramName);
    if (removeFromUrl) {
        urlParams.delete(paramName);
        const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ""
            }${window.location.hash}`;
        window.history.replaceState({}, document.title, newUrl);
    }
    if (searchParam) {
        storage.setItem(storageKey, searchParam);
        return searchParam;
    }
    if (defaultValue) {
        storage.setItem(storageKey, defaultValue);
        return defaultValue;
    }
    const storedValue = storage.getItem(storageKey);
    if (storedValue) {
        return storedValue;
    }
    const legacyValue = storage.getItem(legacyStorageKey);
    if (legacyValue) {
        storage.setItem(storageKey, legacyValue);
        return legacyValue;
    }
    return null;
}

const getAppParams = () => {
    if (getAppParamValue("clear_access_token") === 'true') {
        storage.removeItem('app_access_token');
        storage.removeItem('base44_access_token');
        storage.removeItem('token');
    }

    // Preferred app config keys (vendor-neutral naming).
    // Keep Base44 keys as fallback for backward compatibility.
    const envAppId = import.meta.env.VITE_APP_ID || import.meta.env.VITE_BASE44_APP_ID;
    const envApiBaseUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BASE44_APP_BASE_URL;
    const envFunctionsVersion = import.meta.env.VITE_FUNCTIONS_VERSION || import.meta.env.VITE_BASE44_FUNCTIONS_VERSION;

    return {
        appId: getAppParamValue("app_id", { defaultValue: envAppId }),
        token: getAppParamValue("access_token", { removeFromUrl: true }),
        fromUrl: getAppParamValue("from_url", { defaultValue: window.location.href }),
        functionsVersion: getAppParamValue("functions_version", { defaultValue: envFunctionsVersion }),
        appBaseUrl: getAppParamValue("app_base_url", { defaultValue: envApiBaseUrl }),
    }
}


export const appParams = {
    ...getAppParams()
}
