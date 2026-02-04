# 텔레그램 채널 모니터링 봇

공시 채널(darthacking 등)을 모니터링하고 키워드 필터링 후 톨라니에게 포워딩합니다.

## 설치

```bash
cd scripts/telegram-channel-monitor
pip install -r requirements.txt
```

## 설정

1. https://my.telegram.org 에서 API 발급
2. `.env` 파일 생성:

```env
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+821012345678
TARGET_BOT_TOKEN=REDACTED_TOKEN
TARGET_CHAT_ID=380922285
```

3. 키워드 설정 (config.json)

## 실행

```bash
python monitor.py
```

## 백그라운드 실행 (launchd)

```bash
./install-service.sh
```
