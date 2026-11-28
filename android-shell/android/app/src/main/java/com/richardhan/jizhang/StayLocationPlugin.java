package com.richardhan.jizhang;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "StayLocation", permissions = {
    @Permission(alias = "position", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })
})
public final class StayLocationPlugin extends Plugin {
    // All state belongs to the activity thread, including permission and lifecycle callbacks.
    private String session;
    private LocationListener listener;

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (session != null) {
                call.reject("定位已啟用。");
                return;
            }
            session = call.getString("session");
            if (session == null) {
                call.reject("請重新開啟定位。");
                return;
            }
            if (getPermissionState("position") == PermissionState.GRANTED) begin(call);
            else requestPermissionForAlias("position", call, "permissionResult");
        });
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        if (call != null) getActivity().runOnUiThread(() -> begin(call));
    }

    private LocationManager manager() {
        return (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
    }

    private void begin(PluginCall call) {
        String id = call.getString("session", "");
        if (!id.equals(session)) {
            call.reject("這次定位已結束。");
            return;
        }
        if (getPermissionState("position") != PermissionState.GRANTED) {
            session = null;
            call.reject("辨識短距離停留需要精確位置。你仍可使用手動記帳。");
            return;
        }
        try {
            if (!manager().isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                session = null;
                call.reject("請先開啟裝置定位。");
                return;
            }
            listener = new LocationListener() {
                @Override public void onLocationChanged(Location location) {
                    if (!id.equals(session) || !location.hasAccuracy()) return;
                    long age = (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1000000;
                    if (age < 0 || age > 30000) return;
                    JSObject point = new JSObject().put("session", id)
                            .put("lat", location.getLatitude()).put("lon", location.getLongitude())
                            .put("accuracy", location.getAccuracy()).put("time", location.getTime());
                    if (location.hasSpeed()) point.put("speed", location.getSpeed());
                    notifyListeners("position", point);
                }
                @Override public void onProviderDisabled(String provider) { if (id.equals(session)) end(true); }
                @Override public void onProviderEnabled(String provider) {}
                @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            };
            manager().requestLocationUpdates(LocationManager.GPS_PROVIDER, 10000, 0, listener, Looper.getMainLooper());
            call.resolve();
        } catch (RuntimeException e) {
            end(false);
            call.reject("無法取得精確位置，請檢查定位設定。");
        }
    }

    private void end(boolean notify) {
        String id = session;
        session = null;
        if (listener != null) {
            manager().removeUpdates(listener);
            listener = null;
        }
        if (notify && id != null) notifyListeners("ended", new JSObject().put("session", id));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (call.getString("session", "").equals(session)) end(false);
            call.resolve();
        });
    }

    @Override protected void handleOnStop() { end(true); }
    @Override protected void handleOnDestroy() { end(false); }
}
