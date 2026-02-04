#!/bin/bash
# 텔레그램 채널 모니터 초기 설정

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 텔레그램 채널 모니터 설정"
echo "=============================="
echo ""

# 1. 의존성 설치
echo "1️⃣ Python 패키지 설치..."
pip3 install -r requirements.txt -q
echo "   ✅ 완료"
echo ""

# 2. .env 파일 확인/생성
if [ ! -f ".env" ]; then
    echo "2️⃣ .env 파일 생성 중..."
    cp .env.template .env
    echo "   ✅ .env 파일 생성됨"
    echo ""
    echo "   ⚠️  https://my.telegram.org 에서 API 발급 필요!"
    echo ""
    echo "   발급 방법:"
    echo "   1. https://my.telegram.org 접속"
    echo "   2. 전화번호로 로그인"
    echo "   3. 'API development tools' 클릭"
    echo "   4. 앱 생성 (이름: TolanyMonitor 등)"
    echo "   5. api_id와 api_hash 복사"
    echo ""
    read -p "   API ID: " api_id
    read -p "   API Hash: " api_hash
    read -p "   전화번호 (+82..): " phone
    
    # .env 파일 업데이트
    sed -i '' "s/TELEGRAM_API_ID=.*/TELEGRAM_API_ID=$api_id/" .env
    sed -i '' "s/TELEGRAM_API_HASH=.*/TELEGRAM_API_HASH=$api_hash/" .env
    sed -i '' "s/TELEGRAM_PHONE=.*/TELEGRAM_PHONE=$phone/" .env
    
    echo "   ✅ .env 파일 업데이트됨"
else
    echo "2️⃣ .env 파일 이미 존재"
fi
echo ""

# 3. 첫 실행 (인증)
echo "3️⃣ 첫 실행 (Telegram 인증)..."
echo "   인증 코드가 텔레그램으로 발송됩니다."
echo ""

python3 monitor.py &
PID=$!
sleep 30

# 인증 완료 확인
if [ -f "monitor_session.session" ]; then
    echo "   ✅ 인증 완료!"
    kill $PID 2>/dev/null
else
    echo "   ⚠️  인증이 필요합니다. 수동으로 실행하세요:"
    echo "      python3 monitor.py"
    kill $PID 2>/dev/null
    exit 1
fi
echo ""

# 4. 서비스 설치
echo "4️⃣ 백그라운드 서비스 설치..."
./install-service.sh
echo ""

echo "🎉 설정 완료!"
echo ""
echo "📋 다음 단계:"
echo "   - config.json에서 모니터링 키워드 수정 가능"
echo "   - 로그 확인: tail -f monitor.log"
