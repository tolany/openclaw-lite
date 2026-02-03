#!/usr/bin/env python3
"""
FnGuide 증권사 리포트 자동 수집 스크립트 (OpenClaw Lite Port)
매일 아침 9시 cron으로 실행

사용법:
    source ../.venv/bin/activate
    python fnguide_scraper.py [--date YYYY-MM-DD] [--dry-run]
"""

import os
import sys
import json
import subprocess
import requests
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# .env 로드
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright 설치 필요: pip install playwright && playwright install chromium")
    sys.exit(1)

# ===== 설정 =====
FNGUIDE_URL = "https://www.fnguide.com"
LOGIN_URL = f"{FNGUIDE_URL}/Users/Login"
REPORT_URL = f"{FNGUIDE_URL}/Research/ReportsSummary"

# 환경변수 로드
FNGUIDE_ID = os.getenv("FNGUIDE_ID", "")
FNGUIDE_PW = os.getenv("FNGUIDE_PW", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ALLOWED_USER_ID = os.getenv("ALLOWED_USER_ID")
VAULT_PATH = Path(os.getenv("VAULT_PATH", str(Path.home() / "obsidian-vault")))

DOWNLOAD_DIR = Path.home() / "Downloads" / "fnguide"
KB_PATH = VAULT_PATH / "03_knowledge-base" / "securities-reports"
HISTORY_FILE = SCRIPT_DIR / "download_history.json"

def load_download_history():
    try:
        with open(HISTORY_FILE, "r") as f:
            return set(json.load(f).get("downloaded", []))
    except:
        return set()

def save_download_history(history: set):
    with open(HISTORY_FILE, "w") as f:
        json.dump({"downloaded": list(history)}, f, indent=2)

def is_weekday():
    return datetime.now().weekday() < 5

def setup_directories(date_str: str):
    (DOWNLOAD_DIR / date_str).mkdir(parents=True, exist_ok=True)
    (DOWNLOAD_DIR / "txt").mkdir(parents=True, exist_ok=True)
    KB_PATH.mkdir(parents=True, exist_ok=True)

def login_fnguide(page):
    import time
    print(f"[INFO] FnGuide 로그인 중...")
    page.goto(LOGIN_URL)
    page.wait_for_load_state("networkidle")
    page.fill('#userId', FNGUIDE_ID)
    page.fill('#userPw', FNGUIDE_PW)
    page.click('button.btn.fill-primary.btn-lg')
    time.sleep(2)
    
    # 중복 로그인 팝업 처리
    try:
        if page.is_visible("text=확인"):
            page.click("text=확인")
            time.sleep(2)
    except: pass
    
    page.wait_for_load_state("networkidle")
    if "홈" in page.title():
        print(f"[INFO] 로그인 완료")
    else:
        print(f"[WARN] 로그인 실패 가능성: {page.title()}")

def get_report_list(page, target_date: str, min_pages: int = 5, max_reports: int = None):
    import time, re
    if max_reports is None:
        max_reports = 9999 if is_weekday() else 30
    history = load_download_history()
    
    print(f"[INFO] 리포트 목록 조회 중...")
    page.goto(REPORT_URL)
    page.wait_for_load_state("networkidle")
    time.sleep(3)
    
    reports = []
    rows = page.query_selector_all("table tbody tr")
    
    for row in rows:
        try:
            cells = row.query_selector_all("td")
            if len(cells) < 7: continue
            
            stock = cells[0].inner_text().strip()
            title_cell = cells[1]
            title = title_cell.inner_text().strip()
            link = title_cell.query_selector("a")
            href = link.get_attribute("href") if link else ""
            
            rpt_match = re.search(r'rptId=(\d+)', href)
            report_id = rpt_match.group(1) if rpt_match else ""
            
            company = cells[3].inner_text().strip()
            analyst = cells[2].inner_text().strip()
            opinion = cells[4].inner_text().strip()
            target_price = cells[5].inner_text().strip()
            
            try: page_count = int(cells[6].inner_text().strip())
            except: page_count = 0

            if page_count >= min_pages and report_id and report_id not in history:
                reports.append({
                    "id": report_id, "stock": stock, "title": title,
                    "company": company, "analyst": analyst, "opinion": opinion,
                    "target_price": target_price, "date": target_date,
                    "page_count": page_count, "pdf_url": f"https://www.fnguide.com{href}" if href else ""
                })
                print(f"  [+] {company} | {stock} | {title[:20]}... ({page_count}p)")
                if len(reports) >= max_reports: break
        except Exception as e:
            print(f"[WARN] 파싱 오류: {e}")
            continue
            
    return reports

def download_report(page, report: dict, save_dir: Path):
    import time
    if not report.get("pdf_url"): return None
    try:
        page.goto(report["pdf_url"])
        page.wait_for_load_state("networkidle")
        time.sleep(3)
        
        # 다운로드 버튼 찾기 (Syncfusion Viewer)
        btn = page.query_selector(".e-pv-download-document") or page.query_selector("#e-pv-download-document_container")
        if not btn: return None
        
        with page.expect_download(timeout=30000) as download_info:
            btn.click()
            
        download = download_info.value
        filepath = save_dir / download.suggested_filename
        download.save_as(filepath)
        print(f"[OK] 다운로드: {filepath.name}")
        time.sleep(2)
        return filepath
    except Exception as e:
        print(f"[ERROR] 다운로드 실패: {e}")
        return None

def convert_pdf_to_text(pdf_path: Path):
    txt_path = DOWNLOAD_DIR / "txt" / f"{pdf_path.stem}.txt"
    try:
        subprocess.run(["pdftotext", str(pdf_path), str(txt_path)], check=True, capture_output=True)
        return txt_path
    except:
        return None

def save_to_kb(reports: list, date_str: str):
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    filename = f"증권사리포트_요약_{dt.year}W{dt.isocalendar()[1]:02d}.md"
    filepath = KB_PATH / filename
    
    mode = "a" if filepath.exists() else "w"
    with open(filepath, mode, encoding="utf-8") as f:
        if mode == "w": f.write(f"# 주간 리포트 요약 - {dt.year}년 {dt.isocalendar()[1]}주\n\n")
        f.write(f"\n## {date_str}\n\n")
        for i, r in enumerate(reports, 1):
            f.write(f"### {i}. {r['stock']} ({r['company']})\n")
            f.write(f"- **제목**: {r['title']}\n- **의견**: {r['opinion']} / TP: {r['target_price']}\n\n")
    return filepath

def send_telegram(message: str):
    if not TELEGRAM_BOT_TOKEN or not ALLOWED_USER_ID: return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={"chat_id": ALLOWED_USER_ID, "text": message, "parse_mode": "Markdown"})
    except Exception as e:
        print(f"[WARN] 텔레그램 전송 실패: {e}")

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    
    target_date = args.date or datetime.now().strftime("%Y-%m-%d")
    
    if not FNGUIDE_ID or not FNGUIDE_PW:
        print("[ERROR] .env에 FNGUIDE_ID/PW 설정 필요")
        return

    setup_directories(target_date)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        login_fnguide(page)
        reports = get_report_list(page, target_date)
        
        if not reports:
            print("[INFO] 리포트 없음")
            return

        if args.dry_run: return

        downloaded = []
        history = load_download_history()
        
        for r in reports:
            pdf = download_report(page, r, DOWNLOAD_DIR / target_date)
            if pdf:
                convert_pdf_to_text(pdf)
                downloaded.append(r)
                if r.get("id"): history.add(r["id"])
        
        save_download_history(history)
        if downloaded:
            kb_path = save_to_kb(downloaded, target_date)
            msg = f"📊 *FnGuide 리포트 수집 완료*\n\n날짜: `{target_date}`\n수집: {len(downloaded)}개\n저장: `{kb_path.name}`"
            send_telegram(msg)

if __name__ == "__main__":
    main()
