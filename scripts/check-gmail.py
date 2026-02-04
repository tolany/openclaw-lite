#!/usr/bin/env python3
"""
Gmail 새 메일 체크 스크립트
- IMAP으로 Gmail 읽음
- 새 메일 있으면 요약 출력
- credentials: ~/.gmail_credentials (email:app_password)
"""

import imaplib
import email
from email.header import decode_header
from datetime import datetime, timedelta
import os
import json

CREDENTIALS_PATH = os.path.expanduser("~/.gmail_credentials")
STATE_PATH = os.path.expanduser("~/Documents/Tolany Vault/memory/gmail-state.json")

def load_credentials():
    """Load Gmail credentials from file"""
    if not os.path.exists(CREDENTIALS_PATH):
        print(f"❌ Credentials not found: {CREDENTIALS_PATH}")
        print("Create file with format: email:app_password")
        return None, None
    
    with open(CREDENTIALS_PATH, 'r') as f:
        line = f.read().strip()
        email_addr, app_password = line.split(':', 1)
        return email_addr, app_password

def load_state():
    """Load last check state"""
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH, 'r') as f:
            return json.load(f)
    return {"last_uid": 0, "last_check": None}

def save_state(state):
    """Save check state"""
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, 'w') as f:
        json.dump(state, f, indent=2)

def decode_mime_header(header):
    """Decode MIME encoded header"""
    if header is None:
        return ""
    decoded_parts = decode_header(header)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or 'utf-8', errors='replace'))
        else:
            result.append(part)
    return ''.join(result)

def check_gmail(since_hours=24, max_results=10):
    """Check Gmail for new messages"""
    email_addr, app_password = load_credentials()
    if not email_addr:
        return []
    
    state = load_state()
    
    try:
        # Connect to Gmail IMAP
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(email_addr, app_password)
        mail.select("inbox")
        
        # Search for recent emails
        since_date = (datetime.now() - timedelta(hours=since_hours)).strftime("%d-%b-%Y")
        _, message_numbers = mail.search(None, f'(SINCE "{since_date}")')
        
        messages = []
        msg_nums = message_numbers[0].split()
        
        # Get latest messages (reverse order)
        for num in msg_nums[-max_results:][::-1]:
            _, msg_data = mail.fetch(num, "(RFC822)")
            email_body = msg_data[0][1]
            msg = email.message_from_bytes(email_body)
            
            subject = decode_mime_header(msg["Subject"])
            from_addr = decode_mime_header(msg["From"])
            date_str = msg["Date"]
            
            # Extract sender name/email
            if "<" in from_addr:
                sender = from_addr.split("<")[0].strip().strip('"')
            else:
                sender = from_addr
            
            messages.append({
                "subject": subject[:100],
                "from": sender[:50],
                "date": date_str
            })
        
        mail.logout()
        
        # Update state
        state["last_check"] = datetime.now().isoformat()
        save_state(state)
        
        return messages
        
    except Exception as e:
        print(f"❌ Gmail 연결 오류: {e}")
        return []

def main():
    print("📧 Gmail 새 메일 체크 중...")
    messages = check_gmail(since_hours=24, max_results=5)
    
    if not messages:
        print("✅ 새 메일 없음 (최근 24시간)")
        return
    
    print(f"\n📬 새 메일 {len(messages)}건:\n")
    for i, msg in enumerate(messages, 1):
        print(f"{i}. **{msg['subject']}**")
        print(f"   From: {msg['from']}")
        print(f"   Date: {msg['date']}\n")

if __name__ == "__main__":
    main()
