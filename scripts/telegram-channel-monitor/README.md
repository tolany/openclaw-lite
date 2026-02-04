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
TELEGRAM_PHONE=+82101234xxxx
TARGET_BOT_TOKEN=your_bot_token_from_botfather
TARGET_CHAT_ID=your_chat_id
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
