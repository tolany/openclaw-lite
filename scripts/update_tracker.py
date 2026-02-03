#!/usr/bin/env python3
import os
import re
import yfinance as yf
import requests
from pathlib import Path
from dotenv import load_dotenv

# .env 로드
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

VAULT_PATH = Path(os.getenv("VAULT_PATH", "/home/jblee/obsidian-vault"))
TRACKER_FILE = VAULT_PATH / "11_개인투자/투자아이디어_트래커.md"
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ALLOWED_USER_ID = os.getenv("ALLOWED_USER_ID")

# 종목명 -> 야후 파이낸스 티커 매핑 (KOSPI: .KS, KOSDAQ: .KQ)
TICKER_MAP = {
    "삼성전자": "005930.KS",
    "SK하이닉스": "000660.KS",
    "하이브": "352820.KS",
    "HD한국조선해양": "009540.KS",
    "HD현대일렉트릭": "267260.KS",
    "현대모비스": "012330.KS",
    "대덕전자": "009060.KS",
    "태광": "023160.KQ",
    "휴젤": "145020.KQ",
    "효성중공업": "298040.KS",
    "파마리서치": "214450.KQ",
    "LS ELECTRIC": "010120.KS",
    "삼성전기": "009150.KS"
}

def get_current_price(ticker):
    try:
        stock = yf.Ticker(ticker)
        # fast_info를 사용하여 빠르게 가져오기
        price = stock.fast_info['last_price']
        return int(price)
    except:
        return None

def update_table_row(line, name, price):
    # 마크다운 테이블 행 업데이트 로직
    # | **종목** | 등급 | 현재가 | 목표가 | 트리거 | vs트리거 | 비고 |
    parts = [p.strip() for p in line.split('|')]
    if len(parts) < 6: return line
    
    try:
        # 현재가 업데이트 (3번째 컬럼)
        parts[3] = f"{price:,}"
        
        # 트리거 가격 가져오기 (5번째 컬럼)
        trigger_str = parts[5].replace(',', '')
        trigger_price = int(re.sub(r'[^0-9]', '', trigger_str))
        
        # vs트리거 계산
        diff_pct = ((price / trigger_price) - 1) * 100
        parts[6] = f"**{diff_pct:+.0f}%**" if abs(diff_pct) < 10 else f"{diff_pct:+.0f}%"
        
        return " | ".join(parts[1:-1]).join(['| ', ' |'])
    except:
        return line

def send_telegram(message):
    if not TELEGRAM_BOT_TOKEN or not ALLOWED_USER_ID: return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    requests.post(url, json={"chat_id": ALLOWED_USER_ID, "text": message, "parse_mode": "Markdown"})

def main():
    if not TRACKER_FILE.exists():
        print(f"File not found: {TRACKER_FILE}")
        return

    content = TRACKER_FILE.read_text(encoding="utf-8")
    lines = content.splitlines()
    new_lines = []
    updated_count = 0
    alerts = []

    for line in lines:
        matched = False
        for name, ticker in TICKER_MAP.items():
            # 종목명이 포함된 테이블 행 찾기 (볼드체 포함 고려)
            if f"**{name}**" in line or (name in line and '|' in line):
                price = get_current_price(ticker)
                if price:
                    # 정규식으로 현재가 컬럼(숫자 부분) 교체 시도
                    # 구조: | 종목 | 등급 | 현재가 | 목표가 | 트리거 | ...
                    parts = [p.strip() for p in line.split('|')]
                    if len(parts) >= 6:
                        old_price_str = parts[3]
                        parts[3] = f"{price:,}"
                        
                        # vs트리거/조정트리거 계산
                        trigger_idx = 5
                        trigger_str = parts[trigger_idx].replace(',', '')
                        try:
                            trigger_val = int(re.sub(r'[^0-9]', '', trigger_str))
                            diff_pct = int(((price / trigger_val) - 1) * 100)
                            
                            # vs트리거 업데이트
                            if len(parts) > 6:
                                parts[6] = f"**{diff_pct:+.0f}%**"
                            
                            line = " | ".join(parts).strip()
                            if not line.startswith('|'): line = "| " + line
                            if not line.endswith('|'): line = line + " |"
                            
                            # 알림 조건 (트리거 도달 등)
                            if diff_pct <= 0:
                                alerts.append(f"🎯 *{name}* 트리거 도달! (현재가: {price:,} / 트리거: {trigger_val:,})")
                            
                            matched = True
                            updated_count += 1
                        except: pass
        
        new_lines.append(line)

    if updated_count > 0:
        TRACKER_FILE.write_text("\n".join(new_lines), encoding="utf-8")
        msg = f"📈 *투자 트래커 업데이트 완료*\n- 업데이트 종목: {updated_count}개"
        if alerts:
            msg += "\n\n" + "\n".join(alerts)
        send_telegram(msg)
        print(msg)
    else:
        print("No matches found to update.")

if __name__ == "__main__":
    main()
