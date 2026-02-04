# Mac 앱 복구 가이드

생성일: 2026-02-02

## 자동 복구

```bash
./restore-apps.sh
```

## 수동 설치 필요

### 공식 웹사이트

| 앱 | 다운로드 |
|-----|----------|
| Google Chrome | https://www.google.com/chrome/ |
| Google Drive | https://www.google.com/drive/download/ |
| Obsidian | https://obsidian.md/ |
| Notion | https://www.notion.so/desktop |
| Notion Calendar | https://www.notion.so/product/calendar |
| Telegram | https://telegram.org/ |
| Spotify | https://www.spotify.com/download/ |
| KakaoTalk | https://www.kakaocorp.com/page/service/service/KakaoTalk |
| Tailscale | https://tailscale.com/download |
| Perplexity | https://www.perplexity.ai/hub/getting-started/perplexity-apps |

### Mac App Store

| 앱 | 비고 |
|-----|------|
| Amphetamine | 잠자기 방지 |
| Keka | 압축 해제 |
| Maccy | 클립보드 관리 |
| Rectangle | 창 관리 |
| RunCat | 시스템 모니터 |
| Caret | Markdown 에디터 |

### Microsoft 365

| 앱 | 비고 |
|-----|------|
| Microsoft Word | |
| Microsoft Excel | |
| Microsoft PowerPoint | |
| Microsoft Outlook | |

다운로드: https://www.microsoft.com/microsoft-365

### Adobe Creative Cloud

| 앱 | 비고 |
|-----|------|
| Adobe Creative Cloud | |
| Adobe Lightroom | |

다운로드: https://www.adobe.com/creativecloud.html

### 기타

| 앱 | 비고 |
|-----|------|
| Hancom Office HWP | 한컴오피스 |
| Windows App | 원격 데스크톱 |

## Homebrew로 설치되는 앱 (restore-apps.sh)

### Casks (GUI 앱)

| 앱 | 용도 |
|-----|------|
| AlDente | 배터리 관리 |
| AltTab | 윈도우 스타일 앱 전환 |
| AppCleaner | 앱 완전 삭제 |
| Battery | 배터리 상태 |
| Claude | Claude AI |
| Dropzone | 드래그앤드롭 유틸리티 |
| HiddenBar | 메뉴바 정리 |
| iTerm2 | 터미널 |
| MonitorControl | 외부 모니터 밝기 조절 |
| Raycast | 런처 (Spotlight 대체) |
| Shottr | 스크린샷 |
| Stats | 시스템 모니터 |
| VLC | 미디어 플레이어 |
| VSCodium | VS Code 오픈소스 버전 |

### CLI 도구

| 도구 | 용도 |
|-----|------|
| deno | JavaScript 런타임 |
| ffmpeg | 미디어 변환 |
| gh | GitHub CLI |
| gemini-cli | Gemini CLI |
| gnupg | GPG 암호화 |
| mosh | 모바일 셸 |
| node | Node.js |
| pandoc | 문서 변환 |
| pipx | Python CLI 앱 관리 |
| poppler | PDF 유틸리티 |
| tesseract | OCR |
| yt-dlp | 동영상 다운로드 |

### 폰트

| 폰트 | 용도 |
|-----|------|
| D2Coding | 코딩용 한글 폰트 |
| Hack Nerd Font | 터미널 폰트 |
| Pretendard | 한글 UI 폰트 |

## 설정 복구

### Obsidian
- iCloud 또는 Git에서 Vault 복구
- 플러그인은 Vault 내 `.obsidian/plugins/`에 포함

### Claude Code
- `~/.claude/` 설정 복구 필요

### OpenClaw
- `~/.openclaw/` 설정 복구 필요
- `openclaw.json` 백업 권장

### iTerm2
- 설정 > General > Preferences에서 설정 파일 경로 지정
