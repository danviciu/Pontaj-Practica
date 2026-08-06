import { Capacitor } from '@capacitor/core';

// Best-effort, dependency-free device description for attendance records.
// On native (Capacitor) we know the platform reliably; the readable label is
// derived from the User-Agent. The server additionally stores the raw
// User-Agent header as the authoritative value.

function getPlatform() {
    try {
        if (Capacitor && typeof Capacitor.getPlatform === 'function') {
            return Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
        }
    } catch {
        // ignore
    }
    return 'web';
}

function detectOs(userAgent) {
    const ua = userAgent.toLowerCase();
    if (/android/.test(ua)) return 'Android';
    if (/iphone|ipad|ipod/.test(ua)) return 'iOS';
    if (/windows/.test(ua)) return 'Windows';
    if (/mac os x|macintosh/.test(ua)) return 'macOS';
    if (/linux/.test(ua)) return 'Linux';
    return '';
}

function detectBrowser(userAgent) {
    const ua = userAgent;
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return '';
}

// Tries to pull a device model out of an Android User-Agent, e.g.
// "...; SM-A525F Build/..." -> "SM-A525F".
function detectAndroidModel(userAgent) {
    const match = userAgent.match(/Android[^;]*;\s*([^;)]+?)\s*(?:Build\/|\))/i);
    if (!match) return '';
    const candidate = match[1].trim();
    if (!candidate || /^[a-z]{2}-[a-z]{2}$/i.test(candidate)) return '';
    return candidate;
}

export function getDeviceInfo() {
    const platform = getPlatform();
    const userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';

    const os = detectOs(userAgent);
    const browser = detectBrowser(userAgent);
    const androidModel = os === 'Android' ? detectAndroidModel(userAgent) : '';

    const parts = [];
    if (androidModel) parts.push(androidModel);
    if (os) parts.push(os);
    if (browser) parts.push(browser);
    if (platform && platform !== 'web') parts.push(`app ${platform}`);

    const deviceLabel = parts.length > 0 ? parts.join(' · ') : (userAgent || 'Necunoscut');

    return {
        deviceLabel: deviceLabel.slice(0, 120),
        devicePlatform: platform,
    };
}
