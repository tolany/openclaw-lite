#!/bin/bash
# Vault Structure Map Generator - with clickable links

VAULT_PATH="${1:-/home/jblee/obsidian-vault}"
MAP_FILE="$VAULT_PATH/00_inbox/볼트구조_맵.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

cat > "$MAP_FILE" << HEADER
---
updated: $TIMESTAMP
auto_generated: true
---

# 📁 볼트 구조 맵

> 마지막 업데이트: $TIMESTAMP

## 🆕 최근 생성/수정된 문서 (24시간 이내)

HEADER

# Recent files with links (last 24 hours)
find "$VAULT_PATH" -name "*.md" -mmin -1440 -type f 2>/dev/null | \
    grep -v "/.git/" | grep -v "/.obsidian/" | grep -v "볼트구조_맵" | \
    while read -r file; do
        relpath="${file#$VAULT_PATH/}"
        filename=$(basename "$file" .md)
        modtime=$(stat -c '%Y' "$file" 2>/dev/null)
        moddate=$(date -d "@$modtime" '+%m-%d %H:%M' 2>/dev/null)
        # Obsidian wiki link format
        echo "- \`$moddate\` [[${filename}]] _(${relpath%/*})_"
    done | sort -r | head -50 >> "$MAP_FILE"

cat >> "$MAP_FILE" << SECTION

---

## 📂 폴더별 최신 문서

SECTION

# For each main folder, list recent documents
for dir in "$VAULT_PATH"/[0-9]*; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        echo "### $dirname" >> "$MAP_FILE"
        echo "" >> "$MAP_FILE"
        
        # List 10 most recent files in this folder with links
        find "$dir" -name "*.md" -type f 2>/dev/null | \
            while read -r file; do
                modtime=$(stat -c '%Y' "$file" 2>/dev/null)
                filename=$(basename "$file" .md)
                subdir=$(dirname "${file#$dir/}")
                if [ "$subdir" = "." ]; then
                    echo "$modtime|[[${filename}]]"
                else
                    echo "$modtime|[[${filename}]] _($subdir)_"
                fi
            done | sort -rn | head -5 | cut -d'|' -f2 | while read -r line; do
                echo "- $line" >> "$MAP_FILE"
            done
        
        echo "" >> "$MAP_FILE"
    fi
done

echo "Vault map updated: $MAP_FILE"
