#!/bin/bash
# 책 지식베이스화 스크립트
# 하루 3권씩 처리

BOOKS_DIR="$HOME/Library/CloudStorage/GoogleDrive-jb.lee.v@gmail.com/내 드라이브/00_Archive/R40/OCR 완료"
OUTPUT_DIR="$HOME/Documents/Tolany Vault/03_knowledge-base/books"
TRACKER="$HOME/Documents/Tolany Vault/03_knowledge-base/books/_tracker.json"
TEMP_DIR="/tmp/book-process"

mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR"

# 트래커 초기화
if [ ! -f "$TRACKER" ]; then
    echo '{"processed": [], "lastRun": null}' > "$TRACKER"
fi

# 처리할 책 3권 선택 (아직 처리 안 된 것)
echo "📚 처리할 책 선택 중..."
