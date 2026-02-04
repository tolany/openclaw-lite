#!/bin/bash
# Vault Structure Map Generator
# Automatically updates whenever files change

VAULT_PATH="${1:-/home/jblee/obsidian-vault}"
MAP_FILE="$VAULT_PATH/00_inbox/볼트구조_맵.md"
TEMP_FILE="/tmp/vault_map_new.md"
CHANGELOG_FILE="$VAULT_PATH/00_inbox/볼트변경_로그.md"

# Generate timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Create new map
cat > "$TEMP_FILE" << HEADER
---
updated: $TIMESTAMP
auto_generated: true
---

# 📁 볼트 구조 맵

> 자동 생성됨. 마지막 업데이트: $TIMESTAMP

HEADER

# Generate folder structure (excluding hidden folders and common excludes)
echo "## 폴더별 문서 현황" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"

for dir in "$VAULT_PATH"/[0-9]*; do
    if [ -d "$dir" ]; then
        dirname=$(basename "$dir")
        file_count=$(find "$dir" -name "*.md" -type f 2>/dev/null | wc -l)
        echo "### $dirname ($file_count 문서)" >> "$TEMP_FILE"
        echo "" >> "$TEMP_FILE"
        
        # List subdirectories with counts
        for subdir in "$dir"/*/; do
            if [ -d "$subdir" ]; then
                subdirname=$(basename "$subdir")
                subfile_count=$(find "$subdir" -name "*.md" -type f 2>/dev/null | wc -l)
                echo "- **$subdirname/** ($subfile_count)" >> "$TEMP_FILE"
            fi
        done
        
        # List root files in this folder (not in subdirs)
        root_files=$(find "$dir" -maxdepth 1 -name "*.md" -type f 2>/dev/null | wc -l)
        if [ "$root_files" -gt 0 ]; then
            echo "- _루트 파일: $root_files개_" >> "$TEMP_FILE"
        fi
        echo "" >> "$TEMP_FILE"
    fi
done

# Recent changes section
echo "## 📝 최근 변경 (24시간 이내)" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"

# Find recently modified files
find "$VAULT_PATH" -name "*.md" -mmin -1440 -type f 2>/dev/null | \
    grep -v "/.git/" | grep -v "/.obsidian/" | \
    while read -r file; do
        relpath="${file#$VAULT_PATH/}"
        modtime=$(stat -c '%Y' "$file" 2>/dev/null || stat -f '%m' "$file" 2>/dev/null)
        moddate=$(date -d "@$modtime" '+%m-%d %H:%M' 2>/dev/null || date -r "$modtime" '+%m-%d %H:%M' 2>/dev/null)
        echo "- \`$moddate\` $relpath" >> "$TEMP_FILE"
    done | head -30

echo "" >> "$TEMP_FILE"

# Check for differences and log changes
if [ -f "$MAP_FILE" ]; then
    # Extract file list from old map
    old_count=$(grep -c "^- " "$MAP_FILE" 2>/dev/null || echo "0")
    new_count=$(grep -c "^- " "$TEMP_FILE" 2>/dev/null || echo "0")
    
    if [ "$old_count" != "$new_count" ]; then
        echo "[$TIMESTAMP] 문서 수 변경: $old_count → $new_count" >> "$CHANGELOG_FILE"
    fi
fi

# Move new map to final location
mv "$TEMP_FILE" "$MAP_FILE"

echo "Vault map updated: $MAP_FILE"
