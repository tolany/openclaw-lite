#!/bin/bash
# Investment Tracker Price Updater Wrapper
# Crontab: 0 16 * * 1-5 /home/jblee/openclaw-lite/scripts/run_tracker.sh

cd /home/jblee/openclaw-lite
source .venv/bin/activate

# 실행
python scripts/update_tracker.py >> logs/tracker.log 2>&1
