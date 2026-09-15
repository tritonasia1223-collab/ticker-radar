[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'FiscusAgentEval'
$codexHome = Join-Path $runtimeRoot 'codex-home'
New-Item -ItemType Directory -Path $codexHome -Force | Out-Null

$previousCodexHome = $env:CODEX_HOME
try {
  $env:CODEX_HOME = $codexHome
  Write-Host "실험 전용 Codex 로그인 저장소: $codexHome"
  & codex login
  if ($LASTEXITCODE -ne 0) { throw "codex login failed with exit code $LASTEXITCODE" }
  & codex login status
  if ($LASTEXITCODE -ne 0) { throw "codex login status failed with exit code $LASTEXITCODE" }
} finally {
  $env:CODEX_HOME = $previousCodexHome
}
