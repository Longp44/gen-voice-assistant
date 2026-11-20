#!/usr/bin/env bash
# 艮 看门狗：网关无响应则重启（由 gen-watchdog.timer 每分钟触发）
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3201/ || true)
if [ "$code" = "000" ] || [ -z "$code" ]; then
  systemctl restart gen-gateway
  echo "$(date -Is) watchdog restart" >> /var/log/gen-watchdog.log
fi
