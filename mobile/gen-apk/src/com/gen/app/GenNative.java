package com.gen.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

public class GenNative {
    private final Activity activity;
    GenNative(Activity activity) { this.activity = activity; }

    @JavascriptInterface
    public void startRecording(String meetingId) {
        Intent i = new Intent(activity, RecordService.class);
        i.putExtra("meetingId", meetingId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(i);
        else activity.startService(i);
    }

    @JavascriptInterface
    public String getTranscript() { return RecordService.getTranscript(); }

    @JavascriptInterface
    public void stopRecording() {
        Intent i = new Intent(activity, RecordService.class).setAction("stop");
        activity.startService(i);
    }

    @JavascriptInterface
    public boolean hasNotificationAccess() {
        String enabled = Settings.Secure.getString(activity.getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(activity.getPackageName());
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(i);
    }

    @JavascriptInterface
    public boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) activity.getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(activity.getPackageName());
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(i);
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public void syncNotifications() {
        GenUploader.uploadNotificationsAsync(activity);
    }
}
