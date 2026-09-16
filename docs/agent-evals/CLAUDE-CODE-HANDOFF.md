# Claude Code 구현 지시문

아래 내용을 새 Claude Code 작업을 시작할 때 그대로 전달합니다. `<작업 내용>`만 실제 요청으로 바꿉니다.

```text
이 프로젝트의 유의미한 기능 변경은 "Claude Code 구현 → Codex 독립 검증" 절차로 진행해줘.

시작 전에 반드시 CLAUDE.md와 docs/agent-evals/README.md를 읽고 적용해.

작업 내용:
<작업 내용을 여기에 입력>

진행 규칙:
1. 먼저 git status를 확인하고 기존 사용자 변경이나 다른 작업 파일을 건드리거나 커밋하지 마.
2. master는 커밋·푸시 시 운영 배포되므로, 이번 작업은 master가 아닌 agent/<작업-ID> 브랜치 또는 별도 worktree에서 진행해.
3. tools/agent-eval/tasks/change-template.json을 복사해 이번 작업 JSON을 만들고, 사용자 요구 원문·관찰 가능한 완료 조건·필수 검사 명령을 먼저 고정해.
4. 저장 기능은 UI 표시만 확인하지 말고 타입, 직렬화, 요청, 서버 검증, DB 쓰기·읽기, 새로고침 복원까지 추적해.
5. 협업 기능은 두 창의 독립 변경 보존, 구버전과 최신 버전 혼용, 임시 초안 복구를 완료 조건에 포함해.
6. 필요한 코드를 구현하고 작업 JSON의 필수 검사와 관련 브라우저·DB 통합 검사를 실행해.
7. 시험 DB가 없어서 영속성을 확인하지 못했다면 PASS라고 하지 말고 INCONCLUSIVE로 기록해.
8. 구현과 검사가 끝나면 변경을 한 커밋으로 고정해. push, master 반영, Vercel 배포는 하지 마.
9. Claude 자체 검증으로 최종 승인하지 말고 Codex가 독립 검증할 수 있도록 아래 정보를 최종 답변에 남겨.
   - 작업 JSON 경로
   - 구현 커밋 SHA
   - 변경 파일과 핵심 동작
   - 실행한 검사와 결과
   - 확인하지 못한 항목
   - 그대로 실행할 Codex 검증 명령

Codex 검증 명령 형식:
Set-Location tools\agent-eval
.\powershell\agent-eval.ps1 review --task tasks\<작업 JSON> --candidate <구현 커밋 SHA> --reviewer codex --config profiles\frontier-2026-09.json

Codex 결과가 FAIL이면 finding의 재현 절차를 기준으로 같은 브랜치에서 수정하고 새 커밋으로 다시 검증해. PASS가 나오더라도 사람이 검증 보고서를 확인하기 전에는 master 반영이나 배포를 하지 마.
```

낮은 위험의 문구·스타일 변경에는 전체 절차를 생략할 수 있습니다. 저장, 협업, DB, 마이그레이션, 복구, 여러 화면의 공용 상태에 영향을 주는 변경에는 이 절차를 적용합니다.
