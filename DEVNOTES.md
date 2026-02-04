# OpenClaw Lite 개발 노트

> 이 파일은 Claude Code 세션 간 컨텍스트 유지를 위한 개발 기록입니다.

---

## 현재 상태 (2026-02-05)

### 버전
- **OpenClaw Lite v5.0** (Backup Mode)
- **기능**: GraphRAG + VectorRAG + Streaming + Claude Sonnet 4.5
- **역할**: 원본 OpenClaw의 백업용 (Claude Max 한도 소진 시 사용)

### 활성 Provider
- **Claude Sonnet 4.5** (`claude-sonnet-4-5-20250929`): 기본 모델
- **비용**: ~120원/응답 (Pay-as-you-go)

### 듀얼 봇 운영 전략
| 봇 | 용도 | 모델 | 비용 | Cron |
|---|---|---|---|---|
| @tolanybot (원본) | 메인 | Claude Sonnet 4.5 | Claude Max 구독 내 | ✅ 활성 |
| @tolanylitebot (Lite) | 백업 | Claude Sonnet 4.5 | ~120원/응답 | ❌ 비활성 |

**운영 방식**:
1. 평소에는 원본(@tolanybot)으로 Claude Max 구독 내에서 무료 사용
2. Claude Max 한도 임박 시 Lite(@tolanylitebot)로 전환하여 pay-as-you-go로 사용
3. Cron 작업은 원본에서만 실행 (중복 방지)

---

## 주요 변경사항 (2026-02-05)

### 12. 백업 모드 전환 및 Claude Sonnet 4.5 적용
**목적**: 원본 OpenClaw와의 듀얼 봇 운영을 위한 백업 모드 전환
**구현 내용**:
- **모델 변경**: GPT-4o-mini/Auto → Claude Sonnet 4.5 고정
  - 모델 ID: `claude-sonnet-4-5-20250929`
  - 비용: $3/1M input, $15/1M output (~120원/응답)
- **Cron 비활성화**: 원본과의 중복 실행 방지
  - FnGuide 스캔 (09:00, 21:00) - 비활성
  - 트래커 업데이트 (11:00, 16:00) - 비활성
- **비용 계산 수정**: Sonnet 가격 기준으로 원화 환산 로직 업데이트

### 모델 비교 테스트 결과
| 모델 | 비용 | 품질 |
|---|---|---|
| GPT-4o-mini | ~40원 | 단순 요약 수준 |
| Claude Sonnet | ~120원 | 90% OPM 이상 감지 + 정상화 실적 추정 |
| Claude Opus | ~660원 | Sonnet과 유사한 품질 |

**결론**: Sonnet이 가성비 최고 (Opus의 1/5 비용, 유사 품질)

---

## 이전 변경사항 (2026-02-04)

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