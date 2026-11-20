package com.gen.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;

public class MainActivity extends Activity {
    // GEN-MOD: 改成你自己的服务器地址（末尾带 /），修改后重新打包（见 docs/手机APK使用.md）
    private static final String APP_URL = "http://192.168.1.100:3201/";
    // 首次启动自动配对：把服务器上 `node cli/bin/qwenaudio.mjs gateway pair --name 我的手机 ...`
    // 命令输出的完整链接贴到这里；留空则跳过自动配对，在浏览器里手动打开配对链接
    private static final String PAIRING_URL = "";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestPermissions(new String[]{
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA
        }, 1);

        webView = new WebView(this);
        webView.addJavascriptInterface(new GenNative(this), "GenNative");
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4);
        }
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedHttpError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() == 401) {
                    android.content.SharedPreferences prefs = getSharedPreferences("gen", 0);
                    if (!prefs.getBoolean("pairing_loaded", false) && !PAIRING_URL.isEmpty()) {
                        prefs.edit().putBoolean("pairing_loaded", true).apply();
                        view.loadUrl(PAIRING_URL);
                    }
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                GenUploader.cookie(MainActivity.this);
                if (url != null && url.startsWith(APP_URL)) {
                    view.evaluateJavascript("document.title", null);
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    pendingPermission = request;
                    String[] resources = request.getResources();
                    java.util.List<String> need = new java.util.ArrayList<>();
                    boolean hasAudio = false, hasCamera = false;
                    for (String r : resources) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) hasAudio = true;
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) hasCamera = true;
                    }
                    if (hasAudio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        need.add(Manifest.permission.RECORD_AUDIO);
                    }
                    if (hasCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                        need.add(Manifest.permission.CAMERA);
                    }
                    if (!need.isEmpty()) {
                        requestPermissions(need.toArray(new String[0]), 2);
                    } else {
                        pendingPermission = null;
                        request.grant(resources);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), 3);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl(APP_URL);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (pendingPermission != null) {
            boolean ok = true;
            for (int r : grantResults) if (r != PackageManager.PERMISSION_GRANTED) ok = false;
            if (ok) pendingPermission.grant(pendingPermission.getResources());
            else pendingPermission.deny();
            pendingPermission = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 3 && fileCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        GenUploader.uploadNotificationsAsync(this);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
