[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$secretRoot = Join-Path $env:LOCALAPPDATA 'FiscusAgentEval'
$secretFile = Join-Path $secretRoot 'credentials.clixml'
$toolRoot = Split-Path -Parent $PSScriptRoot
$localConfig = Join-Path $toolRoot 'config.local.json'
$exampleConfig = Join-Path $toolRoot 'config.example.json'

New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null

Write-Host '키는 화면에 표시되지 않으며 현재 Windows 사용자 계정으로 암호화됩니다.'
$anthropicKey = Read-Host 'Anthropic API key' -AsSecureString
if ($anthropicKey.Length -eq 0) { throw 'Anthropic API key is required.' }

Write-Host 'OpenAI API 키가 아직 없으면 Enter를 누르세요.'
$openaiKey = Read-Host 'OpenAI API key (optional)' -AsSecureString

Write-Host '시험용 Supabase DB가 아직 없으면 Enter를 누르세요.'
$databaseUrl = Read-Host 'Evaluation DATABASE_URL (optional)' -AsSecureString

[PSCustomObject]@{
  SchemaVersion = 1
  CreatedAt = (Get-Date).ToUniversalTime().ToString('o')
  AnthropicApiKey = $anthropicKey
  OpenAIApiKey = $openaiKey
  EvaluationDatabaseUrl = $databaseUrl
} | Export-Clixml -LiteralPath $secretFile -Force

if (-not (Test-Path -LiteralPath $localConfig)) {
  Copy-Item -LiteralPath $exampleConfig -Destination $localConfig
}

Write-Host "저장 완료: $secretFile"
Write-Host "로컬 설정: $localConfig"
Write-Host '다음 단계: powershell\login-codex-subscription.ps1'
