param([switch]$Restart, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$wishNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $wishNode) {
    $wishBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $wishBundledNode) { $wishNode = $wishBundledNode }
}
if (-not $wishNode) { throw 'Node.js 22 or newer is required. Install it from https://nodejs.org/' }
$wishRunning = $false
try { $wishResponse = Invoke-WebRequest 'http://127.0.0.1:3210/' -UseBasicParsing -TimeoutSec 2; $wishRunning = $wishResponse.Content -match 'wish-token' } catch {}
if ($wishRunning -and $Restart) {
    $wishTokenMatch = [regex]::Match($wishResponse.Content, 'name="wish-token" content="([^"]+)"')
    if (-not $wishTokenMatch.Success) { throw 'Cannot safely identify this app. Restart cancelled.' }
    Invoke-RestMethod 'http://127.0.0.1:3210/api/stop' -Method Post -ContentType 'application/json' -Headers @{ 'X-Wish-Token' = $wishTokenMatch.Groups[1].Value } -Body '{}' | Out-Null
    $wishRunning = $false
    $wishStopped = $false
    for ($wishAttempt = 0; $wishAttempt -lt 30; $wishAttempt++) {
        Start-Sleep -Milliseconds 300
        try { Invoke-WebRequest 'http://127.0.0.1:3210/' -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { $wishStopped = $true; break }
    }
    if (-not $wishStopped) { throw 'The previous app is still shutting down. Please retry shortly.' }
}
if (-not $wishRunning) {
    Start-Process -FilePath $wishNode -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log')
    for ($wishAttempt = 0; $wishAttempt -lt 30; $wishAttempt++) {
        Start-Sleep -Milliseconds 300
        try { $wishResponse = Invoke-WebRequest 'http://127.0.0.1:3210/' -UseBasicParsing -TimeoutSec 1; if ($wishResponse.Content -match 'wish-token') { $wishRunning = $true; break } } catch {}
    }
}
if (-not $wishRunning) { throw 'The app could not start. Check server-error.log.' }
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3210/' }
