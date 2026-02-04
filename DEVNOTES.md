# OpenClaw Lite 개발 노트

> 이 파일은 Claude Code 세션 간 컨텍스트 유지를 위한 개발 기록입니다.

---

## 현재 상태 (2026-02-04)

### 버전
- **OpenClaw Lite v4.6** (bot.ts v4.6 - Model Routing 적용)
- GraphRAG + VectorRAG + Context Caching + Streaming + **Smart Routing**

### 활성 Provider
- **Auto (Smart Routing)**: 질문 의도에 따라 OpenAI/Claude 자동 전환 ✅
- **Claude** (Sonnet 3.5): 고성능 분석용
- **OpenAI** (GPT-4o-mini): 가성비/일상 대화용
- **Gemini** (3 Flash): 초저렴 대안

---

## 오늘의 변경사항 (2026-02-04)

### 8. Streaming 응답 구현 🚀
- 실시간 텍스트 업데이트로 체감 속도 대폭 향상
- 800ms 스로틀링으로 텔레그램 Rate Limit 최적화

### 9. Smart Model Routing 구현 (NEW) 🧠
**목적**: 질문 난이도에 따른 모델 자동 선택으로 **지능은 Sonnet급, 비용은 Mini급** 유지
- **동작 원리**: 
  1. 사용자의 질문을 GPT-4o-mini가 1차 분석 (Simple vs Complex)
  2. 단순 인사/저널링/정보 확인 -> **OpenAI** 처리 (비용 절감)
  3. 심층 분석/추론/복잡한 문서 검색 -> **Claude** 처리 (성능 보장)
- **명령어**: `/provider auto`를 통해 활성화 가능

---

## 알려진 이슈 및 해결

### 4. Node.js 버전 충돌 및 systemd 실행 오류 (해결)
- systemd 서비스에서 NVM 노드 바이너리 절대 경로 지정으로 버전 불일치 해결

---

## 참고: 류성옥 박사 조언 (구현 현황)
1. Prompt Caching ✅
2. Streaming 응답 ✅
3. System Prompt 최적화 ✅
4. Model Routing ✅ (v4.6 추가)
5. Response Length Control (진행 예정)

---

## 개발 워크플로우
1. DEVNOTES.md 업데이트
2. 개인정보 검수
3. git commit & push

---

*마지막 업데이트: 2026-02-04 23:35 KST*
