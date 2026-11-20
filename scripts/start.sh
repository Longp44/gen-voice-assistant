#!/usr/bin/env bash
# 艮 启动脚本（后台运行，日志在 runtime/state/logs）
set -euo pipefail
cd "$(dirname "$0")/.."
export QWAUDIO_CONFIG_DIR=${QWAUDIO_CONFIG_DIR:-$PWD/runtime}
export QWAUDIO_STATE_DIR=${QWAUDIO_STATE_DIR:-$PWD/runtime/state}
export QWAUDIO_DATA_DIR=${QWAUDIO_DATA_DIR:-$PWD/runtime/data}
export DSH_HOME=${DSH_HOME:-$PWD/runtime/dsh-home}
export QWEN_AUDIO_AGENT_COMPUTER_USE=${QWEN_AUDIO_AGENT_COMPUTER_USE:-false}
export PORT=${PORT:-3201}
export HOST=${HOST:-0.0.0.0}

PID_FILE=runtime/gen-gateway.pid
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "艮已在运行（PID $(cat "$PID_FILE")）"
  exit 0
fi
mkdir -p runtime/state/logs
nohup node cli/bin/qwenaudio.mjs gateway >> runtime/state/logs/gen-gateway.log 2>&1 &
echo $! > "$PID_FILE"
echo "艮已启动（PID $(cat "$PID_FILE")），日志：runtime/state/logs/gen-gateway.log"
echo "浏览器打开 http://127.0.0.1:${PORT}"
