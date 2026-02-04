#!/bin/bash
# 톨라니 백업 스크립트
# 새 PC로 이식 전 실행

set -e

BACKUP_DIR="${1:-$HOME/tolany-backup-$(date +%Y%m%d)}"
mkdir -p "$BACKUP_DIR"

echo "🧠 톨라니 백업 시작..."
echo "백업 위치: $BACKUP_DIR"

# 1. OpenClaw 설정 백업
echo "📁 OpenClaw 설정 백업..."
if [ -d "$HOME/.openclaw" ]; then
    cp -r "$HOME/.openclaw" "$BACKUP_DIR/openclaw-config"
    echo "  ✓ ~/.openclaw"
elif [ -d "$HOME/.config/openclaw" ]; then
    cp -r "$HOME/.config/openclaw" "$BACKUP_DIR/openclaw-config"
    echo "  ✓ ~/.config/openclaw"
fi

# 2. Credentials 백업
echo "🔐 Credentials 백업..."
if [ -f "$HOME/.fnguide_credentials" ]; then
    cp "$HOME/.fnguide_credentials" "$BACKUP_DIR/"
    echo "  ✓ ~/.fnguide_credentials"
fi

# 3. 볼트 git 상태 확인
echo "📚 볼트 Git 상태 확인..."
# WSL 경로 우선, Mac 경로 폴백
if [ -d "/mnt/c/Users/jblee/Music/obsidian-vault/.git" ]; then
    VAULT_DIR="/mnt/c/Users/jblee/Music/obsidian-vault"
elif [ -d "$HOME/Documents/Tolany Vault/.git" ]; then
    VAULT_DIR="$HOME/Documents/Tolany Vault"
else
    VAULT_DIR=""
fi
if [ -n "$VAULT_DIR" ] && [ -d "$VAULT_DIR/.git" ]; then
    cd "$VAULT_DIR"
    git status --short
    REMOTE=$(git remote get-url origin 2>/dev/null || echo "없음")
    echo "  Git Remote: $REMOTE"
    echo "$REMOTE" > "$BACKUP_DIR/vault-git-remote.txt"
fi

# 4. 백업 정보 파일 생성
echo "📝 백업 정보 저장..."
cat > "$BACKUP_DIR/RESTORE.md" << 'EOF'
# 톨라니 복원 가이드

## 새 PC에서 실행

### 1. OpenClaw 설치
```bash
npm install -g openclaw
```

### 2. 볼트 클론
```bash
git clone [REPO_URL] ~/Documents/Tolany\ Vault
```
(REPO_URL은 vault-git-remote.txt 참조)

### 3. OpenClaw 설정 복원
```bash
cp -r openclaw-config ~/.config/openclaw
```

### 4. Credentials 복원
```bash
cp .fnguide_credentials ~/
chmod 600 ~/.fnguide_credentials
```

### 5. Gateway 시작
```bash
cd ~/Documents/Tolany\ Vault
openclaw gateway start
```

## 복원 후 확인
- [ ] `openclaw status` 정상
- [ ] Telegram 연결 확인
- [ ] 크론잡 확인: `openclaw cron list`
EOF

# 5. 백업 완료
echo ""
echo "✅ 백업 완료!"
echo "위치: $BACKUP_DIR"
echo ""
echo "포함된 파일:"
ls -la "$BACKUP_DIR"
