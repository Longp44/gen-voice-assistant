package com.gen.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.CookieManager;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.atomic.AtomicBoolean;

public class GenUploader {
    // GEN-MOD: 与 MainActivity.APP_URL 保持一致（不带末尾斜杠）
    static final String BASE = "http://192.168.1.100:3201";
    private static final String TAG = "GenUploader";
    private static final AtomicBoolean running = new AtomicBoolean(false);
    private static final AtomicBoolean notified = new AtomicBoolean(false);

    static String cookie(Context ctx) {
        try {
            CookieManager cm = CookieManager.getInstance();
            cm.flush();
            String c = cm.getCookie(BASE + "/");
            if (c == null || c.isEmpty()) {
                SharedPreferences sp = ctx.getSharedPreferences("gen", 0);
                c = sp.getString("cookie", "");
            } else {
                ctx.getSharedPreferences("gen", 0).edit().putString("cookie", c).apply();
            }
            return c == null ? "" : c;
        } catch (Exception e) {
            return "";
        }
    }

    static void uploadNotificationsAsync(Context ctx) {
        if (!notified.compareAndSet(false, true)) return;
        new Thread(() -> {
            try { Thread.sleep(1500); } catch (InterruptedException ignored) { }
            uploadNotifications(ctx);
            notified.set(false);
        }).start();
    }

    static synchronized void uploadNotifications(Context ctx) {
        if (!running.compareAndSet(false, true)) return;
        try {
            File f = new File(ctx.getFilesDir(), "notifications-queue.json");
            if (!f.exists() || f.length() == 0) return;
            String ck = cookie(ctx);
            if (ck.isEmpty()) return;
            String body = readFile(f);
            String json = "{\"device\":\"android\",\"items\":" + body + "}";
            int code = post(ctx, "/api/gen/notifications/batch", json, ck);
            if (code >= 200 && code < 300) {
                new FileOutputStreamSafe().clear(f);
                Log.i(TAG, "notifications uploaded");
            } else {
                Log.w(TAG, "upload failed " + code);
            }
        } catch (Exception e) {
            Log.w(TAG, "upload error", e);
        } finally {
            running.set(false);
        }
    }

    static String postForBody(Context ctx, String path, String json, String cookie) throws Exception {
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(BASE + path).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(90000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        byte[] data = json.getBytes("UTF-8");
        conn.setFixedLengthStreamingMode(data.length);
        OutputStream os = conn.getOutputStream();
        os.write(data);
        os.close();
        int code = conn.getResponseCode();
        java.io.InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (in == null) { conn.disconnect(); return ""; }
        java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        conn.disconnect();
        return sb.toString();
    }

    static int post(Context ctx, String path, String json, String cookie) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(BASE + path).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        byte[] data = json.getBytes("UTF-8");
        conn.setFixedLengthStreamingMode(data.length);
        OutputStream os = conn.getOutputStream();
        os.write(data);
        os.close();
        int code = conn.getResponseCode();
        conn.disconnect();
        return code;
    }

    static String readFile(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString();
    }

    static class FileOutputStreamSafe {
        void clear(File f) {
            try { new java.io.FileOutputStream(f).close(); } catch (Exception ignored) { }
        }
    }

    // 录音上传：PCM 转 WAV 后上传
    static void uploadWavAsync(Context ctx, String meetingId, File pcmFile, int sampleRate, long durationMs) {
        new Thread(() -> {
            try {
                byte[] pcm = readBytes(pcmFile);
                byte[] wav = wavFromPcm(pcm, sampleRate);
                String ck = cookie(ctx);
                if (ck.isEmpty()) { Log.w(TAG, "no cookie for wav upload"); return; }
                String b64 = android.util.Base64.encodeToString(wav, android.util.Base64.NO_WRAP);
                String json = "{\"audio\":\"data:audio/wav;base64," + b64 + "\",\"durationMs\":" + durationMs + "}";
                int code = post(ctx, "/api/gen/meetings/" + meetingId + "/audio", json, ck);
                Log.i(TAG, "wav recording upload " + code);
                if (code >= 200 && code < 300) pcmFile.delete();
            } catch (Exception e) {
                Log.w(TAG, "wav upload error", e);
            }
        }).start();
    }

    static byte[] wavFromPcm(byte[] pcm, int sampleRate) {
        byte[] wav = new byte[44 + pcm.length];
        java.nio.ByteBuffer b = java.nio.ByteBuffer.wrap(wav).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes()); b.putInt(36 + pcm.length); b.put("WAVE".getBytes());
        b.put("fmt ".getBytes()); b.putInt(16); b.putShort((short) 1); b.putShort((short) 1);
        b.putInt(sampleRate); b.putInt(sampleRate * 2); b.putShort((short) 2); b.putShort((short) 16);
        b.put("data".getBytes()); b.putInt(pcm.length); b.put(pcm);
        return wav;
    }

    // 录音上传：meetingId + m4a 文件
    static void uploadRecordingAsync(Context ctx, String meetingId, File file, long durationMs) {
        new Thread(() -> {
            try {
                String ck = cookie(ctx);
                if (ck.isEmpty()) { Log.w(TAG, "no cookie for upload"); return; }
                byte[] audio = readBytes(file);
                String b64 = android.util.Base64.encodeToString(audio, android.util.Base64.NO_WRAP);
                String json = "{\"audio\":\"data:audio/mp4;base64," + b64 + "\",\"durationMs\":" + durationMs + "}";
                int code = post(ctx, "/api/gen/meetings/" + meetingId + "/audio", json, ck);
                Log.i(TAG, "recording upload " + code);
                if (code >= 200 && code < 300) file.delete();
            } catch (Exception e) {
                Log.w(TAG, "recording upload error", e);
            }
        }).start();
    }

    static byte[] readBytes(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        byte[] buf = new byte[(int) f.length()];
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) break;
            off += n;
        }
        in.close();
        return buf;
    }
}
