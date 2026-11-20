#!/bin/bash
# 艮 APK 构建脚本（Linux + JDK 17 + Android SDK build-tools 34）
# 用法：按需修改下面的变量后 `bash build.sh`
set -e

# ---- 按本机环境修改 ----
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}
SDK=${ANDROID_SDK:-$HOME/android-sdk}
PROJECT_DIR=${PROJECT_DIR:-$(pwd)}
OUT_APK=${OUT_APK:-$PROJECT_DIR/gen.apk}
# 签名：默认自动生成开发密钥库；正式发布请换成自己的 keystore 与强密码
KS=${KS:-$PROJECT_DIR/gen-release.keystore}
KS_PASS=${KS_PASS:-genapp}
# ---- 修改到此为止 ----

BT=$SDK/build-tools/34.0.0
AJAR=$SDK/platforms/android-34/android.jar
cd "$PROJECT_DIR"
rm -rf build && mkdir -p build/gen build/classes build/dex
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/app-unsigned.apk -I "$AJAR" --manifest AndroidManifest.xml -R build/res.zip --java build/gen --auto-add-overlay
"$JAVA_HOME/bin/javac" -d build/classes --release 11 -classpath "$AJAR" $(find src build/gen -name "*.java")
"$BT/d8" --release --lib "$AJAR" --output build/dex $(find build/classes -name "*.class")
cd build/dex && zip -q ../app-unsigned.apk classes.dex && cd ../..
"$BT/zipalign" -f 4 build/app-unsigned.apk build/app-aligned.apk
if [ ! -f "$KS" ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KS" -alias gen \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Gen" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" --out "$OUT_APK" build/app-aligned.apk
"$BT/apksigner" verify "$OUT_APK" && echo SIGN_OK
ls -lh "$OUT_APK"
