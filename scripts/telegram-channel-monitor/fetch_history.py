#!/usr/bin/env python3
"""
텔레그램 채널 과거 메시지 가져오기
- 최근 N일간 메시지에서 키워드 매칭
"""

import os
import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient

load_dotenv()

API_ID = os.getenv('TELEGRAM_API_ID')
API_HASH = os.getenv('TELEGRAM_API_HASH')

CONFIG_PATH = Path(__file__).parent / 'config.json'

def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)

async def fetch_history(days=14, limit=1000):
    """최근 N일간 메시지 가져오기"""
    
    config = load_config()
    channels = [ch['url'] for ch in config['channels'] if ch.get('enabled', True)]
    keywords = [kw.lower() for kw in config['keywords']['watchlist']]
    
    client = TelegramClient('monitor_session', API_ID, API_HASH)
    await client.start()
    
    cutoff_date = datetime.now() - timedelta(days=days)
    matched_messages = []
    
    for channel_url in channels:
        print(f"\n📢 채널: {channel_url}")
        print(f"   최근 {days}일간 메시지 검색 중...")
        
        try:
            channel = await client.get_entity(channel_url)
            
            async for message in client.iter_messages(channel, limit=limit):
                if message.date.replace(tzinfo=None) < cutoff_date:
                    break
                
                text = (message.message or "").lower()
                matched_kw = [kw for kw in keywords if kw in text]
                
                if matched_kw:
                    matched_messages.append({
                        'date': message.date.strftime('%Y-%m-%d %H:%M'),
                        'text': message.message[:500],
                        'keywords': matched_kw
                    })
        
        except Exception as e:
            print(f"   ❌ 에러: {e}")
    
    await client.disconnect()
    
    # 결과 출력
    print(f"\n{'='*60}")
    print(f"📊 매칭된 메시지: {len(matched_messages)}개")
    print(f"{'='*60}\n")
    
    for msg in sorted(matched_messages, key=lambda x: x['date'], reverse=True):
        print(f"📅 {msg['date']}")
        print(f"🔍 키워드: {', '.join(msg['keywords'][:5])}")
        print(f"📝 {msg['text'][:200]}...")
        print("-" * 40)
    
    return matched_messages

if __name__ == '__main__':
    import sys
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    asyncio.run(fetch_history(days=days))
