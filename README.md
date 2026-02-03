# 🦅 OpenClaw Lite: The Eagle Eye

> **"옵시디언은 두뇌, 제미나이는 입, 텔레그램은 손발."**  
> 복잡한 건 빼고, 핵심만 남긴 고효율 개인 AI 에이전트.

OpenClaw Lite는 기존 에이전트의 비대함을 걷어내고, **24시간 깨어있는 가벼움**과 **옵시디언 볼트 기반의 완벽한 기억력**을 결합한 실무 중심 프로젝트입니다.

---

## 💎 핵심 철학 (Core Philosophy)

### 1. 절대 잊지 않는다 (Zero-Dementia)
대화 내용을 요약해서 압축하면 디테일이 사라집니다. OpenClaw Lite는 요약 대신, **옵시디언 볼트의 원본 파일**을 직접 검색하고 참조합니다. 당신의 과거 기록, 프로젝트, 자아(Soul)를 있는 그대로 기억합니다.

### 2. 똑똑하지만 빠르다 (High Context, Low Loop)
AI가 혼자 "생각-행동-관찰"을 반복하며 토큰을 낭비하는 것을 막습니다. 한 번의 턴에 필요한 도구들을 동시에 호출하여, 비용은 줄이고 반응 속도는 극대화했습니다. (Gemini 3.0 최적화)

### 3. 철저한 보안 (External Defense)
내부 시스템(파일, 프로세스)에 대해서는 주인의 대리인으로서 막강한 권한을 갖지만, 외부 네트워크에 대해서는 철저히 은폐됩니다. **텔레그램 화이트리스트**와 **로컬 바인딩**으로 당신 외엔 누구도 접근할 수 없습니다.

---

## 🚀 주요 기능

- **전문가 페르소나**: PE 6년차 심사역의 전문 용어와 품격 있는 문체 구사 (커스텀 가능)
- **볼트 연동**: `SOUL.md`, `MEMORY.md` 등을 자동으로 읽어 '나를 아는' 비서로 동작
- **스마트 툴**: 파일 읽기/쓰기, 디렉토리 탐색 등 시스템 제어 능력
- **자동 복구**: 5분 주기 Watchdog이 감시하여 죽지 않는 좀비 프로세스 구현

---

## 🛠 기술 스택

- **Runtime**: Node.js + TypeScript
- **AI Core**: Google Gemini 3.0 Flash Preview (현존 최고 가성비/속도)
- **Interface**: grammY (Modern Telegram Bot Framework)
- **Database**: SQLite (WAL Mode)

---

## 📝 설치 및 실행

### 1. 환경 설정
예제 파일을 복사하고 API 키를 입력합니다.
```bash
cp .env.example .env
```
`.env` 파일 수정:
- `TELEGRAM_BOT_TOKEN`: @BotFather에게 받은 토큰
- `GOOGLE_API_KEY`: Google AI Studio 키
- `ALLOWED_USER_ID`: 본인의 텔레그램 숫자 ID
- `VAULT_PATH`: 옵시디언 볼트 절대 경로

### 2. 페르소나 설정
`persona.json`을 수정하여 에이전트의 이름, 직업, 말투를 정의합니다.

### 3. 실행
```bash
# 의존성 설치
npm install

# 개발 모드 (수정 시 자동 재시작)
npm run dev

# 빌드 및 백그라운드 실행
npm run build
npm start
```

---

*2026.02.04 | Project Eagle Eye*
