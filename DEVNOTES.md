# OpenClaw Lite 개발 노트

> 이 파일은 Claude Code 세션 간 컨텍스트 유지를 위한 개발 기록입니다.

---

## 현재 상태 (2026-02-04)

### 버전
- **OpenClaw Lite v4.4** (bot.ts는 v4.1로 표시)
- GraphRAG + VectorRAG + Context Caching 적용

### 활성 Provider
- **Claude** (MODEL_PROVIDER=claude)
- Gemini는 Google Cloud 결제 전파 대기 중 (1-2시간 후 재시도)

### 핵심 파일 구조
```
src/
├── bot.ts           # Telegram 봇 메인 (v4.1)
├── agent.ts         # AI Agent 코어 (Claude/Gemini 지원)
├── types/index.ts   # TypeScript 타입 정의
├── tools/
│   ├── index.ts     # Tool Registry
│   ├── librarian.ts # 파일 검색/읽기 (Google Drive 포함)
│   ├── journalist.ts# 저널링/파일쓰기
│   ├── web.ts       # Brave 웹검색
│   └── utility.ts   # PDF, 리마인더, Obsidian 링크
└── lib/
    ├── db.ts        # SQLite (대화기록, 리마인더, 비용)
    ├── logger.ts    # Winston 로깅
    ├── vectordb.ts  # Vectra + Gemini Embedding
    ├── graphdb.ts   # Neo4j GraphRAG
    └── cache.ts     # Context Caching (NEW)
```

---

## 오늘의 변경사항 (2026-02-04)

### 1. Gemini API 429 오류 이슈
**문제**: Google Cloud 결제 계정 연결 후에도 `free_tier` 할당량 초과 오류 발생

**시도한 것들**:
- 프로젝트 새로 생성 (clawlite / gen-lang-client-0317536668)
- 결제 계정 연결 확인 (Console에서 연결됨으로 표시)
- API 키 새로 발급 (결제 연결 후)
- Generative Language API 활성화 확인

**현재 상태**:
- 결제 계정 연결됨, Paid Tier 할당량 표시됨 (10M 토큰)
- 하지만 API 호출 시 여전히 `free_tier` 오류
- **원인 추정**: Google 시스템 전파 지연 (1-2시간)

**임시 해결책**: Claude API로 전환 (MODEL_PROVIDER=claude)

### 2. Claude API 설정
```env
ANTHROPIC_API_KEY=sk-ant-api03-ERDMdVK...  # 일반 API 키
MODEL_PROVIDER=claude
```

**주의**: Claude Code 전용 키(sk-ant-oat)는 일반 API 호출 불가

### 3. Context Caching 구현 (NEW)
**목적**: 토큰 비용 절감 (30-50%)

**구현 내용**:
- `src/lib/cache.ts` 신규 생성
- GraphDB 스키마 캐싱 (5분 TTL)
- Claude Prompt Caching (`cache_control: ephemeral`)
- Bootstrap context 최적화 (SOUL.md, USER.md 500자 제한)

**효과**:
- 첫 요청: 동일
- 2번째 이후 (5분 내): 캐시 히트로 비용 절감

### 4. GraphRAG 구축 완료
- Neo4j Aura Free Tier 사용
- `/buildgraph` 명령으로 Obsidian 링크/태그 기반 그래프 생성
- 비용: 0원 (AI API 미사용, 로컬 파싱만)

---

## 주요 설정 (.env)

```env
# Telegram
TELEGRAM_BOT_TOKEN=xxx
ALLOWED_USER_ID=380922285

# AI Providers
MODEL_PROVIDER=claude  # claude 또는 gemini
ANTHROPIC_API_KEY=sk-ant-api03-xxx
GOOGLE_API_KEY=AIzaSyCVL7YeeK3mGg2Hm0eet-xyGmBWUesZBLg

# Paths
VAULT_PATH=/home/jblee/obsidian-vault

# Neo4j (GraphRAG)
NEO4J_URI=neo4j+s://bb7a8527.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=xxx

# Optional
BRAVE_API_KEY=xxx
```

---

## 아키텍처 결정 사항

### 1. Dual Provider 지원
- Claude: 고품질, 고비용 (Sonnet $3/$15 per 1M)
- Gemini: 저비용, 준수 품질 (Flash $0.5/$3 per 1M)
- 환경변수로 전환 가능

### 2. 검색 전략 (3-tier)
1. **GraphRAG** (`graph_search`): 관계/연결 질문 - Neo4j
2. **SemanticRAG** (`semantic_search`): 의미 기반 - Vectra + Gemini Embedding
3. **KeywordRAG** (`search_content`): 정확한 키워드 - ripgrep

### 3. Google Drive 연동
- API 없이 파일시스템 마운트 방식 사용
- 경로 별칭: `gdrive:`, `투자검토:`, `work:`, `personal:`
- 설정: `GOOGLE_DRIVE_PATH=/mnt/g/내 드라이브`

### 4. 비용 최적화
- Prompt Caching (Claude/Gemini 모두 지원)
- Graph Schema 캐싱으로 매번 전체 파일맵 로드 방지
- Bootstrap context 500자 제한

---

## 알려진 이슈

### 1. Gemini 429 오류 (진행 중)
- Google Cloud 결제 전파 지연
- 1-2시간 후 재시도 필요
- 해결 후: `MODEL_PROVIDER=gemini`로 변경

### 2. node-cron missed execution 경고
- CPU 집약적 작업 시 발생
- 기능에 영향 없음, 로그만 출력됨

### 3. Claude 비용
- "헬로" 한마디에 ~45원
- Gemini 대비 10-20배 비쌈
- 가급적 Gemini 사용 권장

---

## 다음 할 일

1. **Gemini 전환**: 결제 전파 완료 후 MODEL_PROVIDER=gemini
2. **README 업데이트**: GraphRAG, Caching 내용 추가
3. **Haiku 옵션**: Claude 저비용 모델 지원 고려
4. **OpenRouter 연동**: 단일 API로 다중 모델 지원 옵션

---

### 5. /provider 명령어 추가 (NEW)
런타임에서 Provider 전환 가능 (재시작 불필요)

```
/provider         # 현재 상태 확인
/provider gemini  # Gemini로 전환
/provider claude  # Claude로 전환
```

**구현 내용**:
- `agent.ts`: `switchProvider()`, `getProvider()` 메서드 추가
- `bot.ts`: `/provider` 명령어 추가
- 양쪽 API 키가 있으면 즉시 전환 가능

---

## 자주 쓰는 명령어

```bash
# 봇 재시작
pkill -9 -f "bot.js"; cd /home/jblee/openclaw-lite && node dist/bot.js &

# 빌드
cd /home/jblee/openclaw-lite && npm run build

# 로그 확인
tail -f /tmp/openclaw.log

# Provider 전환
sed -i 's/MODEL_PROVIDER=.*/MODEL_PROVIDER=gemini/' .env

# Git
cd /home/jblee/openclaw-lite && git add -A && git commit -m "message" && git push
```

---

## 참고: 류성옥 박사 조언

> "graphDB 구축해놓으면 경량화해도 성능저하가 많이 없음. 왜냐면 다 네 doc & relationship 기반으로 찾고 생각하고 정리해줄거니까. semantic relationship (vector similarity) 만으로 하는 것은 한계가 있거든."

> "caching해. DB schema 바탕으로."

→ 이 조언을 바탕으로 `src/lib/cache.ts` 구현함

---

*마지막 업데이트: 2026-02-04 13:25 KST*
