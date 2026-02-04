# OpenClaw Lite 개발 문서

> **Project Eagle Eye** - 24시간 깨어있는 개인 AI 비서

## 프로젝트 개요

- **저장소**: `/home/jblee/openclaw-lite` (별도 Git 레포)
- **개발 기간**: 2026.02.04
- **현재 버전**: v2.0

---

## 핵심 철학

### 1. Zero-Dementia (절대 잊지 않는다)
옵시디언 볼트 = 장기 기억. 요약/압축 대신 원본 파일 직접 검색.

### 2. High Context, Low Loop
한 턴에 필요한 도구 동시 호출. 토큰 낭비 최소화.

### 3. External Defense (철저한 보안)
- Telegram 화이트리스트 (ALLOWED_USER_ID)
- 로컬 바인딩
- .env로 API 키 관리

---

## 기술 스택

| 구성요소 | 기술 |
|---------|------|
| Runtime | Node.js + TypeScript |
| AI Core | Google Gemini 2.5 Flash |
| Interface | grammY (Telegram Bot) |
| Database | SQLite (better-sqlite3) |
| Logging | Winston |
| Web Search | Brave Search API |

---

## 버전 히스토리

### v1.0 (초기)
- 기본 Telegram 봇
- Gemini API 연동
- read_file, search_files, run_script 도구

### v2.0 (2026.02.04 고도화)
**새 기능**:
- `search_content`: 파일 내용 검색 (grep)
- `journal_memory`: 자동 저널링 (memory/YYYY-MM-DD.md)
- `write_file`: 파일 쓰기 (보안 검증 포함)
- `web_search`: Brave API 실시간 검색
- **Vision**: 이미지 분석 (Gemini Vision)
- **SQLite**: 대화 기록 영속화
- **Winston**: 구조화된 로깅

**코드 모듈화**:
```
src/
├── bot.ts          # Telegram 핸들러
├── agent.ts        # 메인 에이전트
├── tools/
│   ├── index.ts    # 도구 레지스트리
│   ├── librarian.ts  # read, search
│   ├── journalist.ts # journal, write
│   └── web.ts        # web_search
├── lib/
│   ├── logger.ts   # Winston
│   └── db.ts       # SQLite
└── types/
    └── index.ts
```

---

## 도구 명세

| 도구 | 설명 | 트리거 예시 |
|------|------|------------|
| search_content | 파일 내용 검색 | "배럴 딜 찾아줘" |
| search_files | 파일명 패턴 검색 | "APR 관련 파일" |
| journal_memory | 저널 저장 | "기억해", "메모해" |
| write_file | 파일 쓰기/수정 | "트래커에 추가해" |
| web_search | 웹 검색 | "삼성전자 현재 주가" |
| read_file | 파일 읽기 | 내부 사용 |
| run_script | 스크립트 실행 | "스크래퍼 돌려" |

---

## 보안 체크리스트

- [x] write_file: vault 경로 외부 차단
- [x] write_file: 실행 파일 확장자 차단 (.sh, .js, .py 등)
- [x] run_script: 화이트리스트 방식
- [x] Telegram: ALLOWED_USER_ID 검증
- [x] API 키: .env + .gitignore

---

## 환경 변수 (.env)

```
TELEGRAM_BOT_TOKEN=xxx
ALLOWED_USER_ID=123456789
GOOGLE_API_KEY=xxx
VAULT_PATH=/path/to/vault
BRAVE_API_KEY=xxx
```

---

## 실행 방법

```bash
cd /home/jblee/openclaw-lite
npm run build
npm start
```

---

## 개발 과정 메모

1. **v1 → v24**: 24개 버전 반복 개선
   - 모델 failover 로직 추가
   - HTML 포맷팅 안정화
   - 토큰 비용 표시
   - 검색 우선 정책 적용

2. **v2.0 고도화**: 8개 Phase 구현
   - Phase 1-4: 4개 신규 도구
   - Phase 5: Vision 기능
   - Phase 6: 코드 모듈화
   - Phase 7-8: 로깅/DB 영속화

---

*2026.02.04 | OpenClaw Lite v2.0*
