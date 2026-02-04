#!/bin/bash
# OpenClaw Gateway Watchdog for WSL (systemd)
# systemd가 서비스를 관리하므로 이 스크립트는 참고용입니다.
# 실제 서비스 관리: systemctl --user [start|stop|restart|status] openclaw-gateway.service

# 사용법 (수동 체크 필요 시):
# bash ~/obsidian-vault/scripts/openclaw-watchdog.sh

LOG_FILE="/tmp/openclaw-watchdog.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
PORT=18789

# 로그 로테이션 (1MB 초과 시)
if [ -f "$LOG_FILE" ] && [ $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) -gt 1048576 ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
fi

# 함수: Gateway 재시작 (systemd 사용)
restart_gateway() {
    echo "[$TIMESTAMP] Restarting gateway via systemd..." >> "$LOG_FILE"
    systemctl --user restart openclaw-gateway.service
    sleep 5
    echo "[$TIMESTAMP] Gateway restarted" >> "$LOG_FILE"
}

# 1단계: systemd 서비스 상태 확인
if ! systemctl --user is-active --quiet openclaw-gateway.service; then
    echo "[$TIMESTAMP] Gateway service not active" >> "$LOG_FILE"
    restart_gateway
    exit 0
fi

# 2단계: 포트 리스닝 확인
if ! ss -tlnp | grep -q ":$PORT"; then
    echo "[$TIMESTAMP] Port $PORT not listening" >> "$LOG_FILE"
    restart_gateway
    exit 0
fi

# 3단계: HTTP 헬스체크
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://127.0.0.1:$PORT/" 2>/dev/null)

if [ "$HTTP_STATUS" != "200" ] && [ "$HTTP_STATUS" != "101" ] && [ "$HTTP_STATUS" != "426" ]; then
    echo "[$TIMESTAMP] Health check failed (HTTP: $HTTP_STATUS)" >> "$LOG_FILE"
    restart_gateway
    exit 0
fi

echo "[$TIMESTAMP] Gateway OK" >> "$LOG_FILE"
