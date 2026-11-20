#!/usr/bin/env bash
# 艮 安装脚本：Node 版本检查 → 依赖安装 → 前端构建 → 生成 runtime 目录
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

NODE_VER=$(node -v 2>/dev/null | sed 's/v//' || true)
if [ -z "$NODE_VER" ]; then
  echo "错误：未安装 Node.js。请先安装 Node.js 22.22.2+ 或 24.15.0+（https://nodejs.org）" >&2
  exit 1
fi
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
MINOR=$(echo "$NODE_VER" | cut -d. -f2)
ok=0
{ [ "$MAJOR" = "22" ] && [ "$MINOR" -ge 22 ]; } && ok=1
{ [ "$MAJOR" = "24" ] && [ "$MINOR" -ge 15 ]; } && ok=1
[ "$MAJOR" -ge 26 ] 2>/dev/null && ok=1
if [ "$ok" = "0" ]; then
  echo "错误：Node.js v$NODE_VER 版本过低，需要 ^22.22.2 || ^24.15.0（当前 v${NODE_VER}）" >&2
  exit 1
fi
echo "==> Node.js v$NODE_VER 符合要求"

echo "==> 安装依赖（npm ci）"
npm ci --no-audit --no-fund

echo "==> 构建前端（npm run build）"
npm run build

echo "==> 生成 runtime 目录"
mkdir -p runtime/state runtime/data runtime/dsh-home runtime/backups
if [ ! -f runtime/config.env ]; then
  cp config.env.example runtime/config.env
  echo "==> 已生成 runtime/config.env 模板（请编辑填写 DashScope / DeepSeek Key）"
else
  echo "==> runtime/config.env 已存在，跳过"
fi

cat <<'EOF'

安装完成。下一步：
  1. vim runtime/config.env        # 填入 DashScope / DeepSeek API Key
  2. bash scripts/start.sh         # 启动
  3. 浏览器打开 http://127.0.0.1:3201

服务器部署（systemd + nginx + HTTPS）见 docs/部署.md；Docker 见 README.md。
EOF
