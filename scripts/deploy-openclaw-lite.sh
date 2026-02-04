#!/bin/bash
PROJECT_DIR="$HOME/openclaw-lite"
SRC_DIR="$PROJECT_DIR/src"

echo "📂 Deploying OpenClaw Lite to $PROJECT_DIR..."

# 디렉토리 생성
mkdir -p "$SRC_DIR"

# 설정 파일 복사
cp scripts/openclaw-lite-setup/tsconfig.json "$PROJECT_DIR/"

# 소스 코드 복사
cp scripts/openclaw-lite-setup/bot.ts "$SRC_DIR/"

# .env 파일 생성 (사용자 입력 필요하므로 템플릿만)
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE" > "$PROJECT_DIR/.env"
    echo "ALLOWED_USER_ID=YOUR_TELEGRAM_ID_HERE" >> "$PROJECT_DIR/.env"
    echo "⚠️ .env file created. Please update it with real credentials."
else
    echo "✅ .env file already exists."
fi

# package.json 스크립트 업데이트
cd "$PROJECT_DIR"
npm pkg set scripts.dev="nodemon --watch 'src/**/*.ts' --exec 'ts-node' src/bot.ts"
npm pkg set scripts.build="tsc"
npm pkg set scripts.start="node dist/bot.js"

echo "✅ Deployment Complete!"
echo "👉 Next Steps:"
echo "1. cd ~/openclaw-lite"
echo "2. nano .env (Enter your Bot Token and ID)"
echo "3. npm run dev"
