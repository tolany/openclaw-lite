#!/bin/bash
# Telegram Channel Monitor 서비스 설치 스크립트
# WSL (systemd) / macOS (launchd) 자동 감지

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="telegram-channel-monitor"

# OS 감지
detect_os() {
    if grep -q Microsoft /proc/version 2>/dev/null || grep -q WSL /proc/version 2>/dev/null; then
        echo "wsl"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "mac"
    else
        echo "linux"
    fi
}

OS_TYPE=$(detect_os)
echo "🔍 감지된 환경: $OS_TYPE"

# Python 경로 확인
if [ -f "$SCRIPT_DIR/venv/bin/python3" ]; then
    PYTHON_PATH="$SCRIPT_DIR/venv/bin/python3"
elif [ -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
    PYTHON_PATH="$SCRIPT_DIR/.venv/bin/python3"
else
    echo "❌ venv not found. Run:"
    echo "   python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# .env 파일 확인
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "❌ .env 파일이 없습니다!"
    echo "   .env.template을 복사하고 API 정보를 입력하세요:"
    echo "   cp .env.template .env"
    echo "   그리고 https://my.telegram.org 에서 API ID/Hash 발급"
    exit 1
fi

# ===== WSL / Linux (systemd) =====
install_systemd() {
    echo "📦 systemd 서비스 설치 중..."

    SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
    mkdir -p "$HOME/.config/systemd/user"

    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Telegram Channel Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${PYTHON_PATH} ${SCRIPT_DIR}/monitor.py
Restart=always
RestartSec=10
StandardOutput=append:${SCRIPT_DIR}/stdout.log
StandardError=append:${SCRIPT_DIR}/stderr.log

[Install]
WantedBy=default.target
EOF

    echo "✅ 서비스 파일 생성: $SERVICE_FILE"

    # systemd 리로드 및 활성화
    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME"
    systemctl --user start "$SERVICE_NAME"

    echo "✅ 서비스 설치 완료!"
    echo ""
    echo "📋 명령어:"
    echo "  상태 확인: systemctl --user status $SERVICE_NAME"
    echo "  중지: systemctl --user stop $SERVICE_NAME"
    echo "  시작: systemctl --user start $SERVICE_NAME"
    echo "  재시작: systemctl --user restart $SERVICE_NAME"
    echo "  로그: tail -f $SCRIPT_DIR/monitor.log"
}

# ===== macOS (launchd) =====
install_launchd() {
    echo "📦 launchd 서비스 설치 중..."

    PLIST_NAME="com.tolany.${SERVICE_NAME}"
    PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON_PATH}</string>
        <string>${SCRIPT_DIR}/monitor.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

    echo "✅ plist 생성: $PLIST_PATH"

    # 기존 서비스 언로드 (있으면)
    launchctl unload "$PLIST_PATH" 2>/dev/null
    launchctl load "$PLIST_PATH"

    echo "✅ 서비스 설치 완료!"
    echo ""
    echo "📋 명령어:"
    echo "  상태 확인: launchctl list | grep $SERVICE_NAME"
    echo "  중지: launchctl unload $PLIST_PATH"
    echo "  시작: launchctl load $PLIST_PATH"
    echo "  로그: tail -f $SCRIPT_DIR/monitor.log"
}

# ===== 메인 =====
case "$OS_TYPE" in
    wsl|linux)
        install_systemd
        ;;
    mac)
        install_launchd
        ;;
    *)
        echo "❌ 지원하지 않는 OS입니다."
        exit 1
        ;;
esac
