# OpenClaw Lite 개발 노트

> 이 파일은 Claude Code 세션 간 컨텍스트 유지를 위한 개발 기록입니다.

---

## 현재 상태 (2026-02-04)

### 버전
- **OpenClaw Lite v4.7** (Full Migration 완료)
- **기능**: GraphRAG + VectorRAG + Streaming + Smart Routing + **Auto Cron Jobs**

### 활성 Provider
- **Auto (Smart Routing)**: 기본 모드. OpenAI/Claude 자동 전환 ✅
- **OpenAI (GPT-4o-mini)**: 일상 대화, 크론 작업 판단, 단순 요약용
- **Claude (Sonnet 3.5)**: 심층 투자 분석, 복잡한 추론용

---

## 오늘의 주요 변경사항 (2026-02-04)

### 10. OpenClaw 핵심 기능 완전 이식 (v4.7) 🚀
**목적**: 기존 대형 OpenClaw 시스템을 Lite 버전으로 완전 통합 및 대체
**구현 내용**:
- **자동화 스케줄러**: `node-cron`을 활용하여 기존 `jobs.json`의 5대 핵심 작업 이식
  - fnguide-daily (오전/오후), book-processor, tracker-price, news-summary
- **지능형 문서 핸들러**: 텔레그램 PDF 수신 시 '투자 동료 워크플로우' 자동 적용
- **스크래퍼 연동**: `run_scraper.sh` 등 외부 스크립트 실행 엔진 탑재

### 11. 시스템 안정화 및 환경 최적화
- **Node v24 고정**: systemd 서비스 환경에서 NVM 바이너리 경로 직접 지정으로 라이브러리 충돌 해결
- **스트리밍 최적화**: 800ms 스로틀링 적용으로 텔레그램 차단 방지 및 부드러운 UX 구현

---

## 이식된 크론 작업 리스트 (Cron Tab)
1. `0 6 * * *`: 도서 PDF 지식화 (book-processor)
2. `0 9 * * *`: 오전 리포트 수집 및 투자 아이디어 추출 (fnguide-morning)
3. `0 11,16 * * 1-5`: 주식 현재가 및 트리거 업데이트 (tracker-update)
4. `40 15 * * 1-5`: 오늘의 투자 뉴스 요약 (news-summary)
5. `0 21 * * *`: 저녁 리포트 수집 및 요약 (fnguide-evening)

---

## 개발 워크플로우
1. DEVNOTES.md 업데이트
2. 개인정보 검수
3. git commit & push (GitHub: tolany/openclaw-lite)

---

### 최종 마이그레이션 점검 (2026-02-04 23:50)
- **빌드 안정화**: `npx tsc`를 통한 클린 빌드로 구문 에러 완전 해결
- **종속성 해결**: `bot.ts` 내 누락된 `fs` 모듈 추가 및 테스트 완료
- **스크립트 통합**: `scripts/` 폴더 내 모든 자동화 스크립트 권한 설정 및 배치 완료

---

*마지막 업데이트: 2026-02-04 23:50 KST*