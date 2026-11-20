package com.gen.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.util.Base64;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;

public class RecordService extends Service {
    private static final String TAG = "GenRecord";
    private static final String CHANNEL = "gen_recording";
    private static final int SAMPLE_RATE = 16000;

    private AudioRecord audioRecord;
    private Thread readThread;
    private volatile boolean recording = false;
    private String meetingId = "";
    private long startedAt;
    private long lastChunkAt;
    private int totalBytes = 0;
    private File pcmFile;
    private final Handler handler = new Handler();
    private final java.util.concurrent.LinkedBlockingQueue<Object[]> uploadQueue = new java.util.concurrent.LinkedBlockingQueue<>();
    public static volatile String transcript = "";
    public static volatile long transcriptUpdatedAt = 0;
    private Thread uploadThread;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : intent.getAction();
        if ("stop".equals(action)) { stopRecording(); return START_NOT_STICKY; }
        meetingId = intent == null ? "" : intent.getStringExtra("meetingId");
        if (!recording) startRecording();
        return START_NOT_STICKY;
    }

    private void startRecording() {
        try {
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(minBuf, SAMPLE_RATE * 2);
            audioRecord = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("AudioRecord init failed");
            pcmFile = new File(getFilesDir(), "meeting-" + System.currentTimeMillis() + ".pcm");
            final FileOutputStream out = new FileOutputStream(pcmFile);
            audioRecord.startRecording();
            recording = true;
            transcript = "";
            transcriptUpdatedAt = System.currentTimeMillis();
            startedAt = System.currentTimeMillis();
            lastChunkAt = startedAt;
            startForeground(1001, buildNotification("正在录音"));
            handler.post(tick);

            uploadThread = new Thread(() -> {
                while (recording || !uploadQueue.isEmpty()) {
                    try {
                        Object[] job = uploadQueue.poll(500, java.util.concurrent.TimeUnit.MILLISECONDS);
                        if (job != null) uploadChunk((byte[]) job[0], (Long) job[1]);
                    } catch (InterruptedException ignored) { }
                }
            });
            uploadThread.start();

            readThread = new Thread(() -> {
                byte[] buf = new byte[3200 * 2]; // ~200ms
                java.io.ByteArrayOutputStream window = new java.io.ByteArrayOutputStream();
                while (recording) {
                    int n = audioRecord.read(buf, 0, buf.length);
                    if (n <= 0) continue;
                    try {
                        out.write(buf, 0, n);
                        totalBytes += n;
                        window.write(buf, 0, n);
                    } catch (Exception e) { break; }
                    long now = System.currentTimeMillis();
                    if (now - lastChunkAt >= 2000 && window.size() >= SAMPLE_RATE / 4) {
                        byte[] chunk = window.toByteArray();
                        window.reset();
                        long startMs = lastChunkAt - startedAt;
                        lastChunkAt = now;
                        uploadQueue.offer(new Object[]{ chunk, startMs });
                    }
                }
                // 尾部
                if (window.size() > SAMPLE_RATE / 2) {
                    uploadQueue.offer(new Object[]{ window.toByteArray(), Math.max(0, lastChunkAt - startedAt) });
                }
                try { out.close(); } catch (Exception ignored) { }
            });
            readThread.start();
            Log.i(TAG, "recording started meeting=" + meetingId);
        } catch (Exception e) {
            Log.e(TAG, "start failed", e);
            stopSelf();
        }
    }

    private void uploadChunk(byte[] pcm, long startMs) {
        try {
            String b64 = Base64.encodeToString(pcm, Base64.NO_WRAP);
            String json = "{\"pcm\":\"" + b64 + "\",\"startMs\":" + startMs + ",\"sampleRate\":" + SAMPLE_RATE + "}";
            String ck = GenUploader.cookie(this);
            if (ck.isEmpty()) return;
            String body = GenUploader.postForBody(this, "/api/gen/meetings/" + meetingId + "/chunk", json, ck);
            Log.i(TAG, "chunk upload @" + startMs + " " + body);
            try {
                org.json.JSONObject obj = new org.json.JSONObject(body);
                String text = obj.optString("text", "");
                if (!text.isEmpty()) {
                    transcript = transcript + text;
                    transcriptUpdatedAt = System.currentTimeMillis();
                }
            } catch (Exception ignored) { }
        } catch (Exception e) {
            Log.w(TAG, "chunk upload failed", e);
        }
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!recording) return;
            long sec = (System.currentTimeMillis() - startedAt) / 1000;
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(1001, buildNotification(String.format("正在录音 %02d:%02d", sec / 60, sec % 60)));
            handler.postDelayed(this, 1000);
        }
    };

    private Notification buildNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "会议录音", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent stop = new Intent(this, RecordService.class).setAction("stop");
        android.app.PendingIntent pi = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? android.app.PendingIntent.getService(this, 1, stop, android.app.PendingIntent.FLAG_IMMUTABLE)
                : android.app.PendingIntent.getService(this, 1, stop, 0);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return b.setContentTitle("艮 · 会议录音")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "结束录音", pi).build())
                .build();
    }

    private void stopRecording() {
        recording = false;
        long duration = System.currentTimeMillis() - startedAt;
        handler.removeCallbacks(tick);
        try {
            if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); }
        } catch (Exception ignored) { }
        audioRecord = null;
        try { if (readThread != null) readThread.join(3000); } catch (Exception ignored) { }
        if (pcmFile != null && pcmFile.exists() && totalBytes > 0 && !meetingId.isEmpty()) {
            GenUploader.uploadWavAsync(this, meetingId, pcmFile, SAMPLE_RATE, duration);
        }
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        recording = false;
        handler.removeCallbacks(tick);
        try { if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); } } catch (Exception ignored) { }
        super.onDestroy();
    }

    public static String getTranscript() { return transcript; }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
