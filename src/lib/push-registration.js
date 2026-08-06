import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { base44 } from '@/api/base44Client';

let listenersAttached = false;
let activeUserId = '';
let registrationInFlight = null;
const tokenCacheByUser = new Map();
let webSupportCheck = null;

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function normalizeToken(value) {
    return String(value || '').trim();
}

function isNativePushPlatform() {
    const platform = Capacitor.getPlatform();
    return Capacitor.isNativePlatform() && platform !== 'web';
}

function isWebPlatform() {
    return typeof window !== 'undefined' && Capacitor.getPlatform() === 'web';
}

function getFirebaseWebConfig() {
    return {
        apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
        authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
        projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
        storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
        messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
        appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
        measurementId: String(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '').trim(),
    };
}

function hasFirebaseWebConfig(config) {
    return Boolean(config.apiKey && config.projectId && config.messagingSenderId && config.appId);
}

function buildFirebaseServiceWorkerUrl(config) {
    const search = new URLSearchParams({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
        measurementId: config.measurementId,
    });
    return `/firebase-messaging-sw.js?${search.toString()}`;
}

function isSecureBrowserContext() {
    if (typeof window === 'undefined') return false;
    return window.isSecureContext || LOCALHOST_NAMES.has(window.location.hostname);
}

async function persistTokenForActiveUser(token) {
    const normalizedToken = normalizeToken(token);
    if (!activeUserId || !normalizedToken) return;
    if (tokenCacheByUser.get(activeUserId) === normalizedToken) return;

    await base44.auth.updateMe({ pushToken: normalizedToken });
    tokenCacheByUser.set(activeUserId, normalizedToken);
}

function attachListenersOnce() {
    if (listenersAttached) return;

    PushNotifications.addListener('registration', (registrationToken) => {
        persistTokenForActiveUser(registrationToken?.value).catch((error) => {
            console.warn('Cannot persist push token:', error);
        });
    });

    PushNotifications.addListener('registrationError', (error) => {
        console.warn('Push registration failed:', error);
    });

    listenersAttached = true;
}

async function isWebMessagingSupported() {
    if (!webSupportCheck) {
        webSupportCheck = isSupported().catch(() => false);
    }
    return webSupportCheck;
}

async function ensureWebPushRegistration(user) {
    if (!isWebPlatform()) return { status: 'skipped', reason: 'not_web_platform' };
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return { status: 'skipped', reason: 'not_browser' };
    }

    const firebaseConfig = getFirebaseWebConfig();
    const vapidKey = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();

    if (!hasFirebaseWebConfig(firebaseConfig)) {
        return { status: 'skipped', reason: 'missing_web_config' };
    }

    if (!('Notification' in window)) return { status: 'skipped', reason: 'notification_unsupported' };
    if (!('serviceWorker' in navigator)) return { status: 'skipped', reason: 'service_worker_unsupported' };
    if (!isSecureBrowserContext()) return { status: 'skipped', reason: 'insecure_context' };

    const supported = await isWebMessagingSupported();
    if (!supported) return { status: 'skipped', reason: 'messaging_unsupported' };

    activeUserId = user.id;
    const existingUserToken = normalizeToken(user.pushToken || user.deviceToken);
    if (existingUserToken) {
        tokenCacheByUser.set(user.id, existingUserToken);
    }

    if (!registrationInFlight) {
        registrationInFlight = (async () => {
            let permission = Notification.permission;
            if (permission === 'default') {
                permission = await Notification.requestPermission();
            }
            if (permission !== 'granted') {
                return { status: 'skipped', reason: 'permission_denied' };
            }

            const app = getApps()[0] || initializeApp(firebaseConfig);
            const messaging = getMessaging(app);
            const registration = await navigator.serviceWorker.register(
                buildFirebaseServiceWorkerUrl(firebaseConfig)
            );

            const token = await getToken(messaging, {
                serviceWorkerRegistration: registration,
                ...(vapidKey ? { vapidKey } : {}),
            });

            if (!token) {
                return { status: 'skipped', reason: 'token_unavailable' };
            }

            await persistTokenForActiveUser(token);
            return { status: 'ok' };
        })()
            .finally(() => {
                registrationInFlight = null;
            });
    }

    return registrationInFlight;
}

export async function ensureDevicePushRegistration(user) {
    if (!user?.id) return { status: 'skipped', reason: 'missing_user' };
    if (isWebPlatform()) {
        return ensureWebPushRegistration(user);
    }
    if (!isNativePushPlatform()) return { status: 'skipped', reason: 'not_native_platform' };

    activeUserId = user.id;
    const existingUserToken = normalizeToken(user.pushToken || user.deviceToken);
    if (existingUserToken) {
        tokenCacheByUser.set(user.id, existingUserToken);
    }

    attachListenersOnce();

    if (!registrationInFlight) {
        registrationInFlight = (async () => {
            const permissionState = await PushNotifications.checkPermissions();
            let receivePermission = permissionState?.receive;
            if (receivePermission === 'prompt') {
                const requested = await PushNotifications.requestPermissions();
                receivePermission = requested?.receive;
            }

            if (receivePermission !== 'granted') {
                return { status: 'skipped', reason: 'permission_denied' };
            }

            await PushNotifications.register();
            return { status: 'ok' };
        })()
            .finally(() => {
                registrationInFlight = null;
            });
    }

    return registrationInFlight;
}
