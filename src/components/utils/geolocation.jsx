// Haversine formula pentru calcul distanță între două coordonate GPS
import { Capacitor, registerPlugin } from '@capacitor/core';
import { getAppDateKey } from '@/lib/app-time';

// Custom native plugin (Android) that returns the location together with a
// mock/fake-location flag. Absent on web and on APKs built before the plugin
// was added; in that case we fall back to the browser geolocation API below.
const MockLocation = registerPlugin('MockLocation');

function getWebPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocația nu este suportată de acest browser.'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    // Browsers expose no mock-location signal.
                    isMocked: false,
                    mockCheckAvailable: false,
                });
            },
            (error) => {
                let message = 'Eroare la obținerea locației.';
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        message = 'Permisiunea pentru geolocație a fost refuzată. Te rugăm să activezi locația în setările browserului.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        message = 'Informațiile de locație nu sunt disponibile.';
                        break;
                    case error.TIMEOUT:
                        message = 'Timeout la obținerea locației. Încearcă din nou.';
                        break;
                }
                reject(new Error(message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0,
            }
        );
    });
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Raza Pământului în metri
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distanța în metri
}

// Obține locația curentă (+ flag mock pe Android, dacă pluginul nativ există)
export async function getCurrentPosition() {
    if (Capacitor.getPlatform() === 'android') {
        try {
            const result = await MockLocation.getCurrentPosition();
            if (result && Number.isFinite(Number(result.latitude)) && Number.isFinite(Number(result.longitude))) {
                const parsedAccuracy = Number(result.accuracy);
                return {
                    lat: Number(result.latitude),
                    lng: Number(result.longitude),
                    accuracy: Number.isFinite(parsedAccuracy) ? parsedAccuracy : null,
                    isMocked: result.isMocked === true,
                    mockCheckAvailable: true,
                };
            }
        } catch (error) {
            // Plugin absent (APK vechi) sau eroare — cădem pe geolocația web.
        }
    }
    return getWebPosition();
}

// Formatare dată pentru dateKey (YYYY-MM-DD)
export function getDateKey(date = new Date()) {
    return getAppDateKey(date);
}
