# OpenClaw Lite 개발 노트

> 이 파일은 Claude Code 세션 간 컨텍스트 유지를 위한 개발 기록입니다.

---

## 현재 상태 (2026-02-04)

### 버전
- **OpenClaw Lite v4.5** (bot.ts v4.5 - Streaming UI 적용)
- GraphRAG + VectorRAG + Context Caching + **Streaming Response**

### 활성 Provider
- **Claude** (MODEL_PROVIDER=claude) - 고품질
- **OpenAI** (MODEL_PROVIDER=openai) - 가성비/안정 (gpt-4o-mini)
- **Gemini** - gemini-3-flash-preview ✅ 작동 확인

### 핵심 파일 구조
```
src/
├── bot.ts           # Telegram 봇 메인 (v4.5 - Streaming UI)
├── agent.ts         # AI Agent 코어 (Streaming 지원)
```

---

## 오늘의 변경사항 (2026-02-04)

### 7. OpenAI Provider 추가 (NEW)
**목적**: Gemini의 불안정성과 Claude의 높은 비용 사이의 완벽한 대안(가성비) 확보

### 8. Streaming 응답 구현 (NEW) 🚀
**목적**: 답변이 완료될 때까지 기다리는 UX 답답함 해소 및 체감 속도 향상

**구현 내용**:
- `agent.ts`: OpenAI, Claude, Gemini 모든 모델에 `stream: true` 및 `onChunk` 콜백 적용
- `bot.ts`: 텔레그램 `editMessageText`를 활용한 실시간 텍스트 업데이트 로직 구현
- **최적화**: 텔레그램 Rate Limit 방지를 위해 **800ms 스로틀링(Throttling)** 적용
- **UI**: 메시지 생성 중 `⏳ 작성 중...` 상태 표시 추가

---

## 알려진 이슈 및 해결

### 1. Gemini API 429 오류 (해결)
- 결제 계정 전파 완료되어 `gemini-3-flash-preview` 정상 작동 확인

### 4. Node.js 버전 충돌 및 systemd 실행 오류 (해결)
**문제**: 터미널은 Node v24를 사용하나, systemd 서비스는 시스템 기본값(v22)을 사용하여 `better-sqlite3` 등 바이너리 모듈 실행 실패
**해결**: 
- `/home/jblee/.config/systemd/user/openclaw-lite.service` 파일 수정
- `ExecStart`에 NVM 노드 바이너리 절대 경로 직접 지정:
  `ExecStart=/home/jblee/.nvm/versions/node/v24.13.0/bin/node dist/bot.js`
- `daemon-reload` 후 서비스 정상화

---

## 아키텍처 결정 사항

### 1. 검색 전략 (3-tier)
1. **GraphRAG** (`graph_search`): 관계/연결 질문 - Neo4j
2. **SemanticRAG** (`semantic_search`): 의미 기반 - Vectra + Gemini Embedding
3. **KeywordRAG** (`search_content`): 정확한 키워드 - ripgrep

---

## 자주 쓰는 명령어

```bash
# 서비스 관리 (systemd user mode)
systemctl --user restart openclaw-lite.service
systemctl --user status openclaw-lite.service
journalctl --user -u openclaw-lite.service -f

# 빌드
cd /home/jblee/openclaw-lite && npm run build

# 로그 확인
tail -f /home/jblee/openclaw-lite/logs/output.log
tail -f /home/jblee/openclaw-lite/logs/error.log
```

---

## 참고: 류성옥 박사 조언 (구현 우선순위)
1. Prompt Caching ✅
2. Streaming 응답 ✅
3. System Prompt 최적화 ✅
4. Response Length Control (진행 예정)
5. Model Routing (진행 예정)

---

## 개발 워크플로우

**모든 작업 후 필수:**
1. DEVNOTES.md 업데이트
2. 개인정보 검수 (API 키, 비밀번호, 개인 경로 노출 금지)
3. git commit & push

---

*마지막 업데이트: 2026-02-04 23:25 KST*