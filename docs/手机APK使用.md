# 手机 APK 使用与构建

## 1. 原理

APK 是 WebView 外壳：UI 全部来自服务器网页，原生部分负责**通知监听**、**锁屏录音前台服务**、
**JS 桥**（`GenNative`）。因此服务器地址必须写进包里 —— 拿到源码后改两个常量再打包即可。

## 2. 构建环境

- Linux（或 WSL/macOS + 命令行工具链）
- JDK 17
- Android SDK：platform `android-34` + build-tools `34.0.0`

## 3. 打包前必改（指向你的服务器）

`mobile/gen-apk/src/com/gen/app/MainActivity.java`：

```java
// 改成你的服务器地址（末尾带 /）
private static final String APP_URL = "http://192.168.1.100:3201/";
// 可选：填 pair 命令输出的完整链接，首次打开 401 时自动配对；留空则手动配对
private static final String PAIRING_URL = "";
```

`mobile/gen-apk/src/com/gen/app/GenUploader.java`：

```java
// 与 APP_URL 一致，不带末尾斜杠
static final String BASE = "http://192.168.1.100:3201";
```

## 4. 构建与签名

```bash
cd mobile/gen-apk
# 按需修改 build.sh 顶部：JAVA_HOME / SDK（或 ANDROID_SDK 环境变量）/ PROJECT_DIR / OUT_APK
bash build.sh
```

- 首次运行自动生成开发密钥库 `gen-release.keystore`（**不要提交到任何仓库**）
- 正式发布：自行 `keytool -genkeypair` 生成私钥，修改 `build.sh` 的 `KS` / `KS_PASS`
- 每次发布递增 `AndroidManifest.xml` 的 `versionCode` / `versionName`

## 5. 安装与授权

1. 把 `gen.apk` 传到手机安装
2. 允许**麦克风**、**相机**权限（语音与图片识别用）
3. 完成设备配对（见下节）
4. 设置 → 手机同步：
   - 开启「通知使用权」（通知归档才可用）
   - 加入电池优化白名单（防止后台被杀）

## 6. 设备配对

在服务器上执行（Key 与域名换成自己的）：

```bash
node cli/bin/qwenaudio.mjs gateway pair --name 我的手机 --endpoint https://your-domain.com
```

输出形如 `https://your-domain.com/c#d.xxx` 的链接，**在手机浏览器打开**即完成配对
（凭证保存在手机浏览器 Cookie 中，APK 的 WebView 共享该 Cookie）。
若已在 `PAIRING_URL` 填了链接，首次打开 APK 会自动配对。

## 7. 使用要点

- **会议录音**：会议页点开始后可**直接锁屏**，录音由前台服务继续；结束自动上传转写并生成纪要
- **通知归档**：只在 APK 内自动生效；电脑浏览器只能手动上传
- **多设备**：手机与电脑访问同一服务器，数据自动同步
