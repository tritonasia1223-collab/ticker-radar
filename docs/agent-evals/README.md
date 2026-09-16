# 에이전트 평가 및 교차 검증 운영

이 디렉터리는 두 가지 목적을 분리해 관리합니다.

1. 새 프론티어 모델이 나왔을 때 동일 조건으로 다시 실행하는 **벤치마크**
2. Claude Code가 실제 변경을 구현한 뒤 Codex가 독립적으로 검증하는 **실무 검증**

실행 도구는 `tools/agent-eval`, 장기 보존 결과는 `docs/agent-evals/results`에 둡니다. `runtime`은 대용량 worktree와 원시 로그가 들어가는 로컬 임시 영역이므로 Git에 커밋하지 않습니다.

## 1. 프론티어 모델 벤치마크

비교 가능성을 유지하려면 다음 항목을 고정합니다.

- 프로토콜: `frontier-cross-v1`
- 과제: `tools/agent-eval/tasks/CAP-EVAL-001.json`
- 기준 커밋: `f1c8dd9cef9697d72665047cf463ae4b17b9dfae`
- 구현·검증 프롬프트 구조
- 필수 검사 명령
- 내부 서브에이전트 비활성화
- 구현 후보 하나를 두 검증자가 공유하는 비용 계산 방식

새 모델 실험에서는 모델 ID, 추론 강도, 공개 API 단가와 실행일만 바꿉니다. 과제나 기준 커밋을 바꾸면 같은 시계열에 넣지 않고 새 프로토콜 ID를 만듭니다.

재실행 대상은 공급사가 새로운 최상위 코딩·추론 모델로 공개했거나 에이전트 도구 사용 능력이 유의미하게 바뀐 모델입니다. 모델 별칭이나 가격만 바뀐 경우에는 품질 실험을 반복하지 않고 기존 토큰 기록으로 비용만 다시 계산할 수 있습니다. 러너는 실행 프로필, Node 환경, 러너 커밋과 dirty 여부를 manifest에 기록하므로 런타임 변경이 섞인 결과를 구분할 수 있습니다.

### 새 모델 실행 절차

1. `tools/agent-eval/profiles/frontier-2026-09.json`을 새 날짜 이름으로 복사합니다.
2. 복사한 프로필에서 모델 ID, 추론 강도와 가격표만 수정합니다.
3. 프로젝트 루트에서 아래 명령을 실행합니다.

```powershell
Set-Location tools\agent-eval
.\powershell\agent-eval.ps1 doctor --config profiles\frontier-YYYY-MM.json
.\powershell\agent-eval.ps1 pipeline --config profiles\frontier-YYYY-MM.json --task tasks\CAP-EVAL-001.json --implementer claude
.\powershell\agent-eval.ps1 pipeline --config profiles\frontier-YYYY-MM.json --task tasks\CAP-EVAL-001.json --implementer codex
```

4. 두 검증 결과를 서로에게 공개하지 않은 상태에서 결함을 재현하고 최종 판정합니다.
5. `results`에 보고서 Markdown, 구조화 JSON, PDF를 추가하고 `summary.csv`에 네 조합을 추가합니다.

모델이 더 이상 해당 고정 커밋의 도구 체인을 실행할 수 없거나 패키지 설치가 불가능하면 결과를 실패로 단정하지 않고 환경 비호환으로 기록합니다.

## 2. Claude 구현 → Codex 독립 검증

구현 작업은 Antigravity의 Claude Code에서 진행하는 것이 좋습니다. Claude가 현재 편집 맥락과 사용자 피드백을 이어받을 수 있기 때문입니다. 다만 Claude가 Codex를 직접 호출하게 하지 않고, 구현이 끝난 **커밋**을 중립적인 저장소 스크립트가 Codex에 전달합니다. 그래야 구현 대화가 검증자에게 섞이지 않고 시간·토큰·결과가 같은 형식으로 남습니다.

`master`는 커밋·푸시 시 Vercel 운영 배포로 연결되므로 검증 전 작업은 별도 브랜치에서 수행합니다.

### 작업 순서

1. `master`에서 `agent/<작업-ID>` 브랜치를 만듭니다.
2. `tools/agent-eval/tasks/change-template.json`을 복사해 요구사항과 완료 조건을 작성합니다.
3. Claude Code에 해당 작업 JSON을 기준으로 구현하고 필수 검사를 실행하도록 요청합니다.
4. Claude가 변경을 커밋하되 push·배포는 하지 않습니다.
5. 별도 PowerShell에서 다음 명령을 실행합니다.

```powershell
Set-Location tools\agent-eval
.\powershell\agent-eval.ps1 review --task tasks\CHANGE-YYYYMMDD-001.json --candidate HEAD --reviewer codex --config profiles\frontier-2026-09.json
```

러너는 먼저 타입 검사·테스트·빌드를 실행합니다. 하나라도 실패하거나 검사가 저장소 상태를 바꾸면 Codex를 호출하지 않아 비용과 오염을 막습니다. 모두 통과하면 후보 커밋을 별도 worktree에 체크아웃하고 새 Codex 세션으로 검증합니다.

### 판정 규칙

- `PASS`: 객관 검사와 완료 조건이 증거로 확인됨. 사람이 결과를 읽은 뒤 master 반영 가능
- `FAIL`: Claude Code에 finding과 재현 절차를 전달해 같은 브랜치에서 수정·재커밋한 뒤 다시 검증
- `INCONCLUSIVE`: 필요한 DB·브라우저·외부 환경을 준비한 뒤 다시 검증
- `protocol_violation`: 검증자가 추적 소스를 수정함. 결과를 폐기하고 다시 실행

저장·협업·복구·마이그레이션 작업은 실제 격리 PostgreSQL과 브라우저 검증이 없으면 PASS로 취급하지 않습니다. 최종 master 반영과 배포는 자동화하지 않고 사람이 검증 보고서를 확인한 뒤 실행합니다.

## 결과 파일 형식

- Markdown: 사람이 읽는 판정 근거와 운영 결론
- JSON: 모델, 토큰, 비용, 시간, 결함 발견 여부와 한계
- CSV: 여러 실험의 조합별 비교표
- PDF: 회의·공유용 고정 문서

현재 기준 결과는 `results/2026-09-15-CAP-EVAL-001.*`에 보존합니다.
