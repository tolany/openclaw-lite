# OpenClaw Lite v5.0

> **"옵시디언은 두뇌, AI는 입, 텔레그램은 손발."**
> 복잡한 건 빼고, 핵심만 남긴 고효율 개인 AI 에이전트.

텔레그램으로 언제 어디서나 접근하고, 옵시디언 볼트를 장기 기억으로 사용하는 개인 AI 비서입니다.

## 현재 모드: 🔋 Backup Mode

| 설정 | 값 |
|------|-----|
| 모델 | Claude Sonnet 4.5 |
| Cron | ❌ 비활성 (원본에서 실행) |
| 비용 | ~120원/응답 (Pay-as-you-go) |

**듀얼 봇 운영**: 원본 OpenClaw(Claude Max 구독)를 메인으로 사용하고, 한도 소진 시 Lite로 전환

---

## 핵심 철학

### 1. 절대 잊지 않는다 (Zero-Dementia)
대화를 요약하면 디테일이 사라집니다. OpenClaw Lite는 요약 대신 **옵시디언 볼트 파일을 직접 검색**합니다. 과거 기록, 프로젝트, 메모를 있는 그대로 기억합니다.

### 2. 똑똑하지만 빠르다 (High Context, Low Loop)
AI가 혼자 "생각-행동-관찰"을 반복하며 토큰을 낭비하지 않습니다. 한 번의 턴에 필요한 도구들을 동시에 호출하여 비용은 줄이고 속도는 높였습니다.

### 3. 의미로 검색한다 (Semantic Search)
"돈 많이 번 건" 검색하면 "IRR", "수익률", "exit" 관련 문서를 찾습니다. 키워드가 아닌 **의미로 검색**합니다. (Gemini Embedding 무료)

### 4. 관계로 탐색한다 (GraphRAG)
Obsidian의 `[[링크]]`와 `#태그`를 Neo4j 그래프로 구축합니다. "A와 B의 연결점"을 찾거나, 문서 간 관계를 탐색할 수 있습니다.

---

## 주요 기능

### 도구 (Tools)

| 도구 | 설명 |
|------|------|
| `semantic_search` | 의미 기반 검색 - "실패한 투자", "성공 사례" |
| `search_content` | 키워드 기반 파일 내용 검색 |
| `search_files` | 파일명 패턴 검색 |
| `read_file` | 파일 읽기 (볼트, 구글드라이브) |
| `read_pdf` | PDF 파일 파싱 |
| `write_file` | 파일 쓰기/수정 |
| `journal_memory` | 일일 저널에 메모 저장 |
| `web_search` | 실시간 웹 검색 (Brave API) |
| `set_reminder` | 리마인더 설정 |
| `list_dir` | 디렉토리 목록 |
| `copy_to_vault` | 드라이브 → 볼트 복사 |
| `graph_search` | 문서 + 관계 검색 (GraphRAG) |
| `find_connection` | 두 주제 간 연결 경로 탐색 |

### 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 상태 확인 |
| `/clear` | 대화 히스토리 초기화 |
| `/stats` | 최근 7일 사용량 |
| `/cost` | 일별/월별 비용 현황 |
| `/topic [이름]` | 컨텍스트 분리 (토픽 세션) |
| `/reminders` | 예정된 리마인더 목록 |
| `/health` | 시스템 상태 확인 |
| `/index` | 벡터 인덱스 빌드 (의미 검색용) |
| `/indexstats` | 인덱스 현황 |
| `/buildgraph` | Neo4j 그래프 빌드 (관계 검색용) |
| `/graphstats` | 그래프 현황 (노드/관계 수) |

### 인라인 쿼리
`@봇이름 질문` - 다른 채팅에서도 바로 사용 가능

### 구글 드라이브 연동
로컬 마운트된 구글 드라이브에 접근:
```
gdrive:폴더/파일.md
투자검토:회사명/IR.pdf
work:프로젝트/문서.xlsx
```

---

## 기술 스택

| 구성요소 | 기술 |
|----------|------|
| Runtime | Node.js + TypeScript |
| AI Provider | Claude Sonnet 4.5 (Anthropic) |
| Bot Framework | grammY |
| Database | SQLite (better-sqlite3) |
| Vector DB | Vectra + Gemini Embedding |
| Graph DB | Neo4j Aura (GraphRAG) |
| Logging | Winston |

---

## 설치

### 1. 환경 설정
```bash
git clone https://github.com/tolany/openclaw-lite.git
cd openclaw-lite
cp .env.example .env
```

`.env` 파일 수정:
```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_USER_ID=your_telegram_id

# AI Provider (choose one or both)
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=your_gemini_key
MODEL_PROVIDER=gemini  # or claude

# Paths
VAULT_PATH=/path/to/obsidian/vault

# Optional
BRAVE_API_KEY=your_brave_key  # for web search

# Neo4j (GraphRAG - optional)
NEO4J_URI=neo4j+s://xxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 실행
```bash
# 개발 모드 (자동 재시작)
npm run dev

# 프로덕션
npm run build
npm start
```

### 4. 벡터 인덱스 빌드 (선택)
의미 검색을 사용하려면 텔레그램에서 `/index` 명령 실행

---

## 페르소나 커스터마이징

`persona.json` 수정:
```json
{
  "name": "Your Assistant",
  "role": "Your Role Description",
  "language": "Korean",
  "instructions": [
    "첫 번째 지침",
    "두 번째 지침"
  ]
}
```

---

## 볼트 구조 (선택)

OpenClaw Lite는 다음 파일들을 자동으로 로드합니다:
- `SOUL.md` - AI의 핵심 인격/역할 정의
- `USER.md` - 사용자 프로필 정보
- `MEMORY.md` - 장기 기억 (중요 사항)

---

## systemd 서비스 (선택)

```ini
# /etc/systemd/system/openclaw-lite.service
[Unit]
Description=OpenClaw Lite Telegram Bot
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/openclaw-lite
ExecStart=/usr/bin/node dist/bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable openclaw-lite
sudo systemctl start openclaw-lite
```

---

## 비용

### Claude Sonnet 4.5 (기본 모델)
| 항목 | 가격 |
|------|------|
| 입력 | $3/1M tokens |
| 출력 | $15/1M tokens |
| **응답당 평균** | **~120원** |

### 모델별 비교
| 모델 | 응답당 비용 | 품질 |
|------|------------|------|
| GPT-4o-mini | ~40원 | 단순 요약 |
| Claude Sonnet | ~120원 | 심층 분석 |
| Claude Opus | ~660원 | Sonnet과 유사 |

**권장**: Sonnet (가성비 최고)

---

## 라이선스

MIT License

---

*"우리는 토큰을 아끼기 위해 지능을 포기하지 않는다. 다만 더 똑똑하게 일할 뿐이다."*
