#!/bin/bash
# FnGuide Scraper Wrapper
# Crontab: 0 9 * * 1-5 /home/jblee/openclaw-lite/scripts/run_scraper.sh

cd /home/jblee/openclaw-lite
source .venv/bin/activate

# 실행 (로그 남기기)
python scripts/fnguide_scraper.py >> logs/scraper.log 2>&1