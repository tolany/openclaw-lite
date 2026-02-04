#!/bin/bash
# 고아 노트 찾기 (다른 노트에서 링크되지 않은 노트)

VAULT="$HOME/Documents/Tolany Vault"

echo "🔍 고아 노트 검색 중..."
echo ""

# 모든 md 파일에서 링크된 파일 목록 추출
linked_files=$(grep -roh '\[\[[^]]*\]\]' "$VAULT" --include="*.md" 2>/dev/null | \
    sed 's/\[\[//g; s/\]\]//g' | \
    sed 's/|.*//g' | \
    sort -u)

# 모든 md 파일 목록
all_files=$(find "$VAULT" -name "*.md" -type f | \
    grep -v ".obsidian" | \
    grep -v "90_settings" | \
    grep -v ".trash")

orphan_count=0

echo "📄 링크되지 않은 노트:"
echo "========================"

for file in $all_files; do
    filename=$(basename "$file" .md)
    
    # 대시보드, 인덱스, 템플릿 제외
    if [[ "$filename" == _* ]] || [[ "$filename" == *템플릿* ]] || [[ "$filename" == *index* ]]; then
        continue
    fi
    
    # 이 파일이 다른 곳에서 링크되었는지 확인
    if ! echo "$linked_files" | grep -q "$filename"; then
        echo "  - $file"
        ((orphan_count++))
    fi
done

echo ""
echo "========================"
echo "총 고아 노트: $orphan_count 개"
