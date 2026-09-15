[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RunnerArgs
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'FiscusAgentEval'
$secretFile = Join-Path $runtimeRoot 'credentials.clixml'
$codexHome = Join-Path $runtimeRoot 'codex-home'
$toolRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path -LiteralPath $secretFile)) {
  throw "비밀키 파일이 없습니다. 먼저 powershell\setup-secrets.ps1을 실행하세요: $secretFile"
}

function ConvertTo-PlainText {
  param([Security.SecureString]$SecureValue)
  if ($null -eq $SecureValue -or $SecureValue.Length -eq 0) { return '' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$credentials = Import-Clixml -LiteralPath $secretFile
$previousAnthropic = $env:ANTHROPIC_API_KEY
$previousOpenAI = $env:OPENAI_API_KEY
$previousDatabase = $env:FISCUS_EVAL_DATABASE_URL
$previousCodexHome = $env:CODEX_HOME

try {
  $env:ANTHROPIC_API_KEY = ConvertTo-PlainText $credentials.AnthropicApiKey
  $openaiKey = ConvertTo-PlainText $credentials.OpenAIApiKey
  $databaseUrl = ConvertTo-PlainText $credentials.EvaluationDatabaseUrl
  if ($openaiKey) { $env:OPENAI_API_KEY = $openaiKey } else { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
  if ($databaseUrl) { $env:FISCUS_EVAL_DATABASE_URL = $databaseUrl } else { Remove-Item Env:FISCUS_EVAL_DATABASE_URL -ErrorAction SilentlyContinue }
  $env:CODEX_HOME = $codexHome

  Push-Location $toolRoot
  try {
    & node 'src/cli.mjs' @RunnerArgs
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $previousAnthropic) { Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue } else { $env:ANTHROPIC_API_KEY = $previousAnthropic }
  if ($null -eq $previousOpenAI) { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue } else { $env:OPENAI_API_KEY = $previousOpenAI }
  if ($null -eq $previousDatabase) { Remove-Item Env:FISCUS_EVAL_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:FISCUS_EVAL_DATABASE_URL = $previousDatabase }
  if ($null -eq $previousCodexHome) { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue } else { $env:CODEX_HOME = $previousCodexHome }
}
