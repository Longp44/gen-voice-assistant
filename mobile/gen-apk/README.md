# 艮 手机 APK 构建说明

- 用途：Android WebView 外壳 + 原生服务（通知监听 NotificationListener、锁屏前台录音 RecordService、JS 桥 GenNative）
- 构建环境：Linux + JDK 17 + Android SDK（build-tools 34.0.0，platform android-34）
- **打包前必改**（指向你自己的服务器）：
  - `src/com/gen/app/MainActivity.java` 的 `APP_URL`（末尾带 `/`）
  - `src/com/gen/app/GenUploader.java` 的 `BASE`（不带末尾斜杠，与 APP_URL 一致）
  - `MainActivity.java` 的 `PAIRING_URL`：填服务器上 `gateway pair` 命令输出的完整链接可自动配对，留空则手动在浏览器打开配对链接
- 构建：`bash build.sh`（脚本顶部按需修改 `JAVA_HOME` / `SDK` / `PROJECT_DIR` / `OUT_APK`）
- 签名：首次运行自动生成开发密钥库 `gen-release.keystore`（**不要提交到仓库**）；
  正式发布请用 `keytool` 自行生成私钥并修改 `build.sh` 的 `KS` / `KS_PASS` 变量
- 产物：`gen.apk`（versionName / versionCode 见 AndroidManifest.xml，发布时递增）
- 源码要点：
  - `src/com/gen/app/MainActivity.java`：WebView 加载 APP_URL，注册 `GenNative` 桥，onPageFinished 保存 Cookie
  - `src/com/gen/app/GenNotificationListener.java`：通知监听、分类、脱敏、本地队列
  - `src/com/gen/app/RecordService.java`：AudioRecord 16k PCM、每 2 秒分段上传、结束时 WAV 上传
  - `src/com/gen/app/GenUploader.java`：Cookie 读取、通知批量上传、录音上传、chunk 上传（postForBody）
  - `src/com/gen/app/GenNative.java`：JS 桥（录音开始/结束、实时转写缓冲、通知权限、电池白名单、同步）
