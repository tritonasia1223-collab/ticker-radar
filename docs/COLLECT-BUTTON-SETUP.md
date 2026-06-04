# 수집 '갱신' 버튼 설정 (GitHub Actions)

> 최종 업데이트: 2026-06-04
> 상태: **코드 완료·배포됨 ✅ / 시크릿 설정 미완료 ⏳ (← 여기서 이어서)**

종목 발견 화면 우상단의 **[↻ 갱신]** 버튼으로 수집을 돌리기 위한 설정입니다.
Vercel 함수는 10초 제한이라 긴 Apify 수집을 직접 못 돌리므로, 버튼이 **GitHub Actions**를
트리거해서 GH 러너가 수집을 실행하고 같은 Supabase에 기록합니다.

```
[배포앱 ↻갱신] → POST /api/collect/trigger → GitHub workflow_dispatch
                                            → GH 러너: npm run collect (+ :threads)
                                            → Supabase 기록
   버튼은 트리거만 즉시 응답 → sync-logs 폴링 → 완료 시 자동 갱신
```

## 이미 완료 (코드, 커밋 `9fe8299`)
- `.github/workflows/collect.yml` — `workflow_dispatch`로 X+Threads 수집
- `POST /api/collect/trigger` — `GH_DISPATCH_TOKEN`으로 워크플로 dispatch (90초 중복 가드)
- 우상단 갱신 버튼(수집 중 스피너 → 완료 토스트 + 자동 갱신)

## ⏳ 남은 설정 (1회) — 이어서 할 일

### 1) GitHub 저장소 Secrets
`github.com/tritonasia1223-collab/ticker-radar` → **Settings → Secrets and variables → Actions → New repository secret**.
로컬 `.env` 값을 그대로 복사:

| Name | Value |
|---|---|
| `DATABASE_URL` | .env의 DATABASE_URL |
| `APIFY_TOKEN` | .env의 APIFY_TOKEN |

### 2) 트리거용 토큰 → Vercel
- GitHub: 프로필 → **Settings → Developer settings → Fine-grained tokens → Generate new token**
  - Repository access: **Only select repositories** → `ticker-radar`
  - Permissions → Repository permissions → **Actions: Read and write**
  - 생성된 토큰 복사(한 번만 표시)
- Vercel: 프로젝트 → **Settings → Environment Variables**
  - `GH_DISPATCH_TOKEN` = (방금 토큰), Environment: **Production**
  - 저장 후 **Redeploy** (또는 다음 배포 때 적용)

### 3) 테스트
배포 앱 → 종목 발견 → 우상단 **[↻ 갱신]** → "수집을 시작했어요" 토스트 → 1~2분 뒤 자동 갱신.

## 검증 (설정 후)
- GitHub repo → **Actions** 탭에 `collect` 실행이 떴는지
- 또는 CLI: `gh run list --workflow collect.yml`
- 앱 우상단 배지가 "데이터 방금"으로 바뀌고 급상승 목록 갱신

## 참고 / 알아둘 것
- 워크플로 파일은 **master에 있어야** `workflow_dispatch`가 작동 (이미 푸시됨).
- `GH_DISPATCH_TOKEN`이 Vercel에 없으면 버튼이 501("미설정")을 반환.
- ⚠️ **보안**: 트리거 엔드포인트는 공개(앱에 인증 없음) → 누구나 호출 가능. 90초 가드는 있지만
  남용 시 Apify 비용 발생 가능. 개인용이라 위험 낮음. 필요 시 후속으로 보호장치 추가.
- 옵션: 같은 워크플로에 `on: schedule` cron을 넣으면 **매일 자동 수집**도 가능(현재는 버튼만).
