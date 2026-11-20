package com.gen.app;

import android.app.Notification;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.regex.Pattern;

public class GenNotificationListener extends NotificationListenerService {
    private static final String TAG = "GenNotify";
    private static final String QUEUE_FILE = "notifications-queue.json";
    private static final Pattern OTP = Pattern.compile("(验证码|校验码|动态码|OTP|verification code|code)[^0-9]{0,6}(\\d{4,8})", Pattern.CASE_INSENSITIVE);
    private static final Pattern CARD = Pattern.compile("\\b(\\d{16,19})\\b");
    private static final Pattern PHONE = Pattern.compile("\\b(1[3-9]\\d{9})\\b");

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || sbn.getNotification() == null) return;
            String pkg = sbn.getPackageName();
            if (pkg == null || pkg.equals(getPackageName())) return;
            Notification n = sbn.getNotification();
            Bundle extras = n.extras;
            String title = String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, ""));
            String text = String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT, ""));
            if (title.isEmpty() && text.isEmpty()) return;

            String category = classify(pkg);
            String safeText = mask(text);
            String sensitive = safeText.equals(text) ? "no" : "yes";

            JSONObject item = new JSONObject();
            item.put("package", pkg);
            item.put("appName", appName(pkg));
            item.put("title", title);
            item.put("text", safeText);
            item.put("postedAt", sbn.getPostTime());
            item.put("category", category);
            item.put("importance", importance(category, text));
            item.put("sensitive", sensitive);

            appendQueue(item);
            GenUploader.uploadNotificationsAsync(this);
        } catch (Exception e) {
            Log.w(TAG, "post failed", e);
        }
    }

    private String classify(String pkg) {
        String p = pkg.toLowerCase();
        if (p.contains("com.tencent.mm") || p.contains("com.tencent.mobileqq") || p.contains("telegram") || p.contains("feishu") || p.contains("dingtalk") || p.equals("com.android.mms")) return "message";
        if (p.contains("bank") || p.contains("cmb") || p.contains("icbc") || p.contains("ccb") || p.contains("boc") || p.contains("alipay") || p.contains("unionpay") || p.contains("wallet")) return "finance";
        if (p.contains("mail") || p.contains("gmail") || p.contains("netease.mail")) return "email";
        if (p.contains("sf") || p.contains("cainiao") || p.contains("meituan") || p.contains("eleme") || p.contains("jd") || p.contains("taobao")) return "delivery";
        if (p.contains("calendar") || p.contains("meeting") || p.contains("zoom") || p.contains("tencent.wemeet")) return "schedule";
        if (p.equals("android") || p.contains("systemui") || p.contains("settings")) return "system";
        return "other";
    }

    private String importance(String category, String text) {
        if ("finance".equals(category) || "schedule".equals(category)) return "high";
        if (OTP.matcher(text).find()) return "high";
        return "normal";
    }

    private String mask(String text) {
        if (text == null) return "";
        String out = text;
        if (OTP.matcher(out).find()) {
            return "[验证码已隐藏] " + out.replaceAll("\\d{4,8}", "****");
        }
        out = CARD.matcher(out).replaceAll(m -> "****" + m.group().substring(m.group().length() - 4));
        out = PHONE.matcher(out).replaceAll(m -> m.group().substring(0, 3) + "****" + m.group().substring(7));
        return out;
    }

    private String appName(String pkg) {
        try {
            android.content.pm.PackageManager pm = getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    private synchronized void appendQueue(JSONObject item) {
        try {
            File f = new File(getFilesDir(), QUEUE_FILE);
            JSONArray arr = new JSONArray();
            if (f.exists() && f.length() > 0) {
                FileInputStream in = new FileInputStream(f);
                byte[] buf = new byte[(int) f.length()];
                int read = in.read(buf);
                in.close();
                if (read > 0) arr = new JSONArray(new String(buf, 0, read, "UTF-8"));
            }
            arr.put(item);
            while (arr.length() > 500) arr.remove(0);
            FileOutputStream out = new FileOutputStream(f);
            out.write(arr.toString().getBytes("UTF-8"));
            out.close();
        } catch (Exception e) {
            Log.w(TAG, "queue failed", e);
        }
    }
}
