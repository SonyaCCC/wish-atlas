param([switch]$IncludeData)
$ErrorActionPreference = 'Stop'
$wishRoot = Split-Path -Parent $PSScriptRoot
$wishVerify = Get-Content -Raw -LiteralPath (Join-Path $wishRoot '.tmp\electron-download\verified.json') | ConvertFrom-Json
$wishZip = Join-Path $wishRoot ('.tmp\electron-download\' + $wishVerify.name)
if ((Get-FileHash -LiteralPath $wishZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wishVerify.sha256) { throw 'Electron checksum mismatch.' }
$wishSuffix = if ($IncludeData) { 'with-records' } else { 'clean' }
$wishVersion = (Get-Content -Raw -LiteralPath (Join-Path $wishRoot 'package.json') | ConvertFrom-Json).version
$wishDest = Join-Path $wishRoot ('release\WishAtlas-' + $wishVersion + '-win-x64-' + $wishSuffix)
if (Test-Path -LiteralPath $wishDest) { throw 'Release folder already exists; use the existing build or move it before rebuilding.' }
New-Item -ItemType Directory -Path $wishDest -Force | Out-Null
Expand-Archive -LiteralPath $wishZip -DestinationPath $wishDest
Rename-Item -LiteralPath (Join-Path $wishDest 'electron.exe') -NewName ([string]([char]0x7948)+[char]0x613f+[char]0x624b+[char]0x8d26+'.exe')
$wishApp = Join-Path $wishDest 'resources\app'
New-Item -ItemType Directory -Path $wishApp -Force | Out-Null
foreach ($wishFile in @('package.json','server.mjs','README.md')) { Copy-Item -LiteralPath (Join-Path $wishRoot $wishFile) -Destination $wishApp }
foreach ($wishFolder in @('public','lib','desktop','licenses')) { Copy-Item -LiteralPath (Join-Path $wishRoot $wishFolder) -Destination $wishApp -Recurse }
$wishGuide = Get-ChildItem -LiteralPath $wishRoot -Filter '*.md' | Where-Object { $_.Name -ne 'README.md' } | Where-Object { $_.Name -eq ([string]([char]0x7ed9)+[char]0x670b+[char]0x53cb+[char]0x7684+[char]0x4f7f+[char]0x7528+[char]0x8bf4+[char]0x660e+'.md') }
Copy-Item -LiteralPath $wishGuide.FullName -Destination $wishDest
if ($IncludeData) {
    New-Item -ItemType Directory -Path (Join-Path $wishDest 'data') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $wishRoot 'data\records.json') -Destination (Join-Path $wishDest 'data\records.json')
}
Write-Output $wishDest
