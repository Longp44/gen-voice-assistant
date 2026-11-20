#!/usr/bin/env bash
# 艮 停止脚本
set -euo pipefail
cd "$(dirname "$0")/.."
PID_FILE=runtime/gen-gateway.pid
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "已停止（PID $PID）"
  else
    echo "进程不存在（PID $PID）"
  fi
  rm -f "$PID_FILE"
else
  echo "未找到 PID 文件，艮可能未在运行"
fi
