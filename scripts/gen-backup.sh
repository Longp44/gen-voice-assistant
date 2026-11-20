#!/usr/bin/env bash
# 艮 备份脚本：每日轻量 + 每周全量，保留 30 天
# 用法：bash scripts/gen-backup.sh [runtime目录] [备份输出目录]
set -euo pipefail
RT=${1:-$(cd "$(dirname "$0")/.." && pwd)/runtime}
DIR=${2:-$RT/backups}
DATE=$(date +%F)
mkdir -p "$DIR"

tar -czf "$DIR/daily-$DATE.tar.gz" -C "$RT" \
  --exclude='backups' --exclude='*.log' \
  data state/config state/sessions dsh-home 2>/dev/null || \
tar -czf "$DIR/daily-$DATE.tar.gz" -C "$RT" \
  --exclude='backups' --exclude='*.log' data state dsh-home

if [ "$(date +%u)" = "7" ]; then
  tar -czf "$DIR/weekly-$DATE-full.tar.gz" -C "$RT" \
    --exclude='backups' --exclude='*.log' data state dsh-home
fi
find "$DIR" -name '*.tar.gz' -mtime +30 -delete
echo "备份完成：$DIR/daily-$DATE.tar.gz"
