#!/bin/bash
# Mac 초기화 후 앱 복구 스크립트
# 생성일: 2026-02-02

set -e

echo "=== Homebrew 설치 ==="
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

echo "=== Homebrew Formulae ==="
brew install \
  deno \
  ffmpeg \
  gh \
  gemini-cli \
  gnupg \
  mosh \
  node \
  pandoc \
  pipx \
  poppler \
  tesseract \
  yt-dlp

echo "=== Homebrew Casks (앱) ==="
brew install --cask \
  aldente \
  alt-tab \
  appcleaner \
  battery \
  claude \
  dropzone \
  hiddenbar \
  iterm2 \
  monitorcontrol \
  raycast \
  shottr \
  stats \
  syntax-highlight \
  vlc \
  vscodium

echo "=== 폰트 ==="
brew install --cask \
  font-d2coding \
  font-hack-nerd-font \
  font-pretendard

echo "=== npm 글로벌 패키지 ==="
npm install -g openclaw

echo "=== pipx 패키지 ==="
pipx install openai-whisper

echo "=== 완료 ==="
echo "수동 설치 필요한 앱 목록은 restore-apps.md 참고"
