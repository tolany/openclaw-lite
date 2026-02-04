#!/usr/bin/env python3
"""
텔레그램 채널 모니터링 봇
- 공시 채널(darthacking 등) 실시간 모니터링
- alert 키워드: 텔레그램 알림 (보유 종목)
- track 키워드: 로그 저장 (투자아이디어 트래커용)
"""

import os
import json
import asyncio
import logging
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
from telethon import TelegramClient, events
import aiohttp

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('monitor.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 환경변수 로드
load_dotenv()

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')
PHONE = os.getenv('TELEGRAM_PHONE')
BOT_TOKEN = os.getenv('TARGET_BOT_TOKEN')
CHAT_ID = os.getenv('TARGET_CHAT_ID')

# 설정 로드
CONFIG_PATH = Path(__file__).parent / 'config.json'

def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

def check_keywords(text: str, keywords: list, case_sensitive: bool = False) -> list:
    """키워드 매칭 확인 - 매칭된 키워드 리스트 반환"""
    if not text:
        return []
    
    check_text = text if case_sensitive else text.lower()
    matched = []
    
    for keyword in keywords:
        check_keyword = keyword if case_sensitive else keyword.lower()
        if check_keyword in check_text:
            matched.append(keyword)
    
    return matched

async def send_to_bot(message: str):
    """톨라니 봇으로 메시지 전송"""
    if not BOT_TOKEN or not CHAT_ID:
        logger.error("BOT_TOKEN or CHAT_ID not configured")
        return False
    
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status == 200:
                    logger.info(f"Message forwarded successfully")
                    return True
                else:
                    error = await resp.text()
                    logger.error(f"Failed to forward: {error}")
                    return False
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        return False

def log_to_track_file(track_file: Path, data: dict):
    """track 키워드 매칭 메시지를 JSONL 파일에 저장"""
    try:
        with open(track_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(data, ensure_ascii=False) + '\n')
        logger.info(f"Logged to track file: {data.get('matched_track', [])}")
    except Exception as e:
        logger.error(f"Error logging to track file: {e}")

async def main():
    """메인 모니터링 루프"""
    
    if not API_ID or not API_HASH:
        logger.error("TELEGRAM_API_ID and TELEGRAM_API_HASH required")
        logger.info("Get them from https://my.telegram.org")
        return
    
    config = load_config()
    channels = [ch['url'] for ch in config['channels'] if ch.get('enabled', True)]
    
    # 키워드 분리: alert (텔레그램 알림) vs track (로그만)
    alert_keywords = config['keywords'].get('alert', [])
    track_keywords = config['keywords'].get('track', [])
    case_sensitive = config['keywords'].get('case_sensitive', False)
    
    # 포워딩 설정
    alert_to_telegram = config['forward'].get('alert_to_telegram', True)
    track_to_log = config['forward'].get('track_to_log', True)
    include_channel_name = config['forward'].get('include_channel_name', True)
    
    # 트랙 로그 파일
    track_file = Path(__file__).parent / config.get('log', {}).get('track_file', 'track_log.jsonl')
    
    logger.info(f"Monitoring channels: {channels}")
    logger.info(f"Alert keywords (텔레그램 알림): {alert_keywords}")
    logger.info(f"Track keywords (로그 저장): {len(track_keywords)}개")
    
    # Telethon 클라이언트 생성
    client = TelegramClient('monitor_session', API_ID, API_HASH)
    
    @client.on(events.NewMessage(chats=channels))
    async def handler(event):
        """새 메시지 핸들러"""
        try:
            message_text = event.message.message or ""
            
            # 키워드 매칭 확인
            matched_alert = check_keywords(message_text, alert_keywords, case_sensitive)
            matched_track = check_keywords(message_text, track_keywords, case_sensitive)
            
            # 매칭 없으면 무시
            if not matched_alert and not matched_track:
                return
            
            # 채널 정보
            chat = await event.get_chat()
            channel_name = getattr(chat, 'title', 'Unknown')
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # Alert 키워드 매칭 → 텔레그램 알림
            if matched_alert and alert_to_telegram:
                if include_channel_name:
                    forward_msg = f"🚨 <b>[{channel_name}]</b>\n"
                    forward_msg += f"⏰ {timestamp}\n\n"
                    forward_msg += message_text[:3800]
                else:
                    forward_msg = message_text[:4000]
                
                forward_msg += f"\n\n🔍 매칭: {', '.join(matched_alert)}"
                
                await send_to_bot(forward_msg)
                logger.info(f"🚨 ALERT forwarded from {channel_name}: {matched_alert}")
            
            # Track 키워드 매칭 → 로그 파일에 저장
            if matched_track and track_to_log:
                log_data = {
                    "timestamp": timestamp,
                    "channel": channel_name,
                    "matched_track": matched_track,
                    "message": message_text[:2000],
                    "processed": False
                }
                log_to_track_file(track_file, log_data)
            
        except Exception as e:
            logger.error(f"Error handling message: {e}")
    
    # 클라이언트 시작
    await client.start(phone=PHONE)
    logger.info("✅ Channel monitor started!")
    logger.info("Listening for new messages...")
    
    # 무한 대기
    await client.run_until_disconnected()

if __name__ == '__main__':
    asyncio.run(main())
