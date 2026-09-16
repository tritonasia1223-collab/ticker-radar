# FISCUS 교차 에이전트 평가 러너

Claude와 Codex를 실제 코딩 에이전트 런타임으로 실행해 구현·검증 조합의 품질, 시간, 토큰, 비용을 비교합니다. 현재 운영 방식은 Claude API와 Codex ChatGPT 구독의 혼합 인증이며, 나중에 OpenAI API 키를 추가하면 같은 러너에서 API 과금으로 전환할 수 있습니다.

## 격리 원칙

- Antigravity의 Claude 확장 로그인과 기본 Codex 데스크톱 로그인을 변경하지 않습니다.
- 비밀키는 `%LOCALAPPDATA%\FiscusAgentEval\credentials.clixml`에 Windows DPAPI로 암호화해 저장합니다.
- Codex 구독 로그인은 `%LOCALAPPDATA%\FiscusAgentEval\codex-home`에 따로 저장합니다.
- 각 구현·검증은 프로젝트 내부의 무시된 `runtime/` 아래 별도 Git worktree와 새 세션에서 실행됩니다. Codex Desktop의 부모 작업 권한 경계 안에 두어 중첩 Codex가 실제로 파일을 수정할 수 있게 합니다.
- 구현 결과를 커밋으로 고정한 다음 Claude와 Codex가 같은 커밋을 각각 검증합니다.
- 공급자 내부 서브에이전트는 프롬프트와 런타임 설정에서 비활성화합니다.
- push, Vercel 배포, 운영 DB 연결은 실험 범위에서 제외합니다.

## 최초 설정

프로젝트 루트 PowerShell에서 실행합니다.

```powershell
Set-Location tools\agent-eval
npm.cmd install
.\powershell\setup-secrets.ps1
.\powershell\login-codex-subscription.ps1
.\powershell\agent-eval.ps1 doctor
```

`setup-secrets.ps1`에는 Anthropic API 키를 입력합니다. OpenAI API 키와 시험용 `DATABASE_URL`은 아직 없으면 Enter로 건너뜁니다. 입력값은 콘솔에 표시되지 않습니다.

OpenAI API 키를 나중에 추가할 때는 `setup-secrets.ps1`을 다시 실행하고 `config.local.json`의 `providers.codex.authMode`를 `api`로 바꿉니다.

## 작업 정의

`tasks/example.json`을 복사해 작업마다 새 JSON을 만듭니다. `requiresEvaluationDatabase`가 `true`인 작업은 시험용 Supabase 연결이 없으면 시작하지 않습니다.

```json
{
  "id": "CAP-001",
  "title": "예시 제목",
  "baseRef": "master",
  "requirement": "사용자가 요청한 원문 요구사항",
  "acceptanceCriteria": ["관찰 가능한 완료 조건"],
  "requiredChecks": ["npm.cmd run check", "npm.cmd test", "npm.cmd run build"],
  "requiresEvaluationDatabase": true
}
```

## 파이프라인 실행

현재 최고 등급 비교에서는 구현자와 검증자 모두 Claude Fable 5.1/max 또는 GPT-6 Astra/ultra를 사용합니다. 역할별 모델 설정은 분리되어 있어 후속 비용 실험에서는 구현자만 낮추는 식으로 바꿀 수 있습니다. 실제 사용 모델과 effort는 각 `record.json`에 기록됩니다.

재현 가능한 모델 비교에는 추적된 프로필을 명시합니다. 새 프론티어 모델이 나오면 `profiles/frontier-2026-09.json`을 복사하고 모델 ID·추론 강도·가격표만 바꿉니다.

Claude 구현 후 두 모델 검증:

```powershell
.\powershell\agent-eval.ps1 pipeline --config profiles\frontier-2026-09.json --task tasks\CAP-EVAL-001.json --implementer claude
```

Codex 구현 후 두 모델 검증:

```powershell
.\powershell\agent-eval.ps1 pipeline --config profiles\frontier-2026-09.json --task tasks\CAP-EVAL-001.json --implementer codex
```

결과는 `tools\agent-eval\runtime\runs` 아래에 저장됩니다. 구현자의 결과는 검증 worktree에 복사되지 않으며, 검증 결과도 상대 검증자의 작업공간에 노출되지 않습니다. 구현자가 파일 변경을 하나도 만들지 못하면 검증 호출 전에 실패 처리해 비용 낭비를 막습니다.

## 기존 Claude Code 변경을 Codex로 검증

실제 작업은 Claude Code에서 별도 브랜치로 구현하고 커밋한 뒤, 같은 하네스가 그 커밋만 Codex에 전달하도록 합니다.

```powershell
.\powershell\agent-eval.ps1 review --task tasks\CHANGE-YYYYMMDD-001.json --candidate HEAD --reviewer codex --config profiles\frontier-2026-09.json
```

객관 검사가 먼저 실행되며 하나라도 실패하면 Codex 호출을 생략합니다. 통과하면 `runtime/reviews` 아래 격리 worktree에서 새 Codex 세션이 검증합니다. 결과는 `PASS`, `FAIL`, `INCONCLUSIVE` 중 하나이며 검증자가 추적 소스를 수정하면 `protocol_violation`으로 기록합니다. 자세한 운영 절차는 `docs/agent-evals/README.md`를 따릅니다.

## 측정값 해석

- Claude `modelUsage`: 전체 에이전트 호출 트리의 토큰 측정값입니다.
- Claude `total_cost_usd`: SDK 내장 가격표로 계산한 추정값이며 청구서가 아닙니다.
- Codex `Turn.usage`: SDK가 보고한 입력·캐시·출력·추론 토큰입니다.
- Codex 구독 실행의 `incremental_cash_cost_usd`: 월 구독 안에서는 0으로 기록합니다.
- Codex `api_equivalent_cost_usd`: `config.local.json`의 공개 API 단가로 환산합니다.
- 공급자별 최종 청구는 각 Console의 실험 전용 Project/Workspace 사용량과 대조합니다.

전체 기록 요약:

```powershell
.\powershell\agent-eval.ps1 summarize
```

## 판정

두 검증이 완료되면 run 폴더에 `READY_FOR_ADJUDICATION`이 생성됩니다. 검증자가 보고한 개수 자체를 점수로 사용하지 않습니다. 각 finding을 재현해 유효 결함, 오탐, 미확인으로 판정한 뒤 비용 대비 유효 결함 수를 계산합니다.
