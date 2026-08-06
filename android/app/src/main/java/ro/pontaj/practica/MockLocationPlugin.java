package ro.pontaj.practica;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Custom Capacitor plugin: returns the current location together with a
 * mock/fake-location flag (the value the JS side cannot otherwise obtain).
 * The web/JS fallback in geolocation.jsx is used when this plugin is absent.
 */
@CapacitorPlugin(
    name = "MockLocation",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location")
    }
)
public class MockLocationPlugin extends Plugin {

    private static final long TIMEOUT_MS = 10000L;

    @PluginMethod
    public void getCurrentPosition(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermsCallback");
            return;
        }
        startLocationRequest(call);
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            startLocationRequest(call);
        } else {
            call.reject("Location permission denied");
        }
    }

    private void startLocationRequest(final PluginCall call) {
        // LocationManager listeners need a thread with a Looper; use the main thread.
        getActivity().runOnUiThread(() -> {
            final Context context = getContext();
            final LocationManager manager =
                (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) {
                call.reject("Location services unavailable");
                return;
            }

            final boolean[] settled = { false };
            final Handler handler = new Handler(Looper.getMainLooper());

            final LocationListener listener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    if (settled[0]) return;
                    settled[0] = true;
                    try { manager.removeUpdates(this); } catch (Exception ignored) {}
                    handler.removeCallbacksAndMessages(null);
                    resolveWithLocation(call, location);
                }

                @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                @Override public void onProviderEnabled(String provider) {}
                @Override public void onProviderDisabled(String provider) {}
            };

            try {
                boolean requested = false;
                if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    manager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper());
                    requested = true;
                } else if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    manager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, Looper.getMainLooper());
                    requested = true;
                }

                // Timeout: fall back to the best last-known fix, else reject.
                handler.postDelayed(() -> {
                    if (settled[0]) return;
                    settled[0] = true;
                    try { manager.removeUpdates(listener); } catch (Exception ignored) {}
                    Location best = bestLastKnown(manager);
                    if (best != null) {
                        resolveWithLocation(call, best);
                    } else {
                        call.reject("Could not obtain a location fix");
                    }
                }, TIMEOUT_MS);

                if (!requested) {
                    // No providers enabled: try last-known immediately.
                    handler.removeCallbacksAndMessages(null);
                    settled[0] = true;
                    Location best = bestLastKnown(manager);
                    if (best != null) {
                        resolveWithLocation(call, best);
                    } else {
                        call.reject("Location is turned off");
                    }
                }
            } catch (SecurityException e) {
                call.reject("Location permission denied");
            }
        });
    }

    private Location bestLastKnown(LocationManager manager) {
        Location best = null;
        try {
            Location gps = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location net = manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (gps != null && net != null) {
                best = gps.getTime() >= net.getTime() ? gps : net;
            } else {
                best = gps != null ? gps : net;
            }
        } catch (SecurityException ignored) {}
        return best;
    }

    private void resolveWithLocation(PluginCall call, Location location) {
        if (location == null) {
            call.reject("No location available");
            return;
        }
        boolean isMock;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isMock = location.isMock();
        } else {
            isMock = location.isFromMockProvider();
        }
        JSObject result = new JSObject();
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        result.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 0);
        result.put("isMocked", isMock);
        call.resolve(result);
    }
}
