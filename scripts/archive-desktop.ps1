param([switch]$IncludeData)
$ErrorActionPreference = 'Stop'
$wishRoot = Split-Path -Parent $PSScriptRoot
$wishVersion = (Get-Content -Raw -LiteralPath (Join-Path $wishRoot 'package.json') | ConvertFrom-Json).version
$wishSuffix = if ($IncludeData) { 'with-records' } else { 'clean' }
$wishFolder = Join-Path $wishRoot "release\WishAtlas-$wishVersion-win-x64-$wishSuffix"
$wishName = if ($IncludeData) { "WishAtlas-$wishVersion-windows-x64-with-records.zip" } else { "WishAtlas-$wishVersion-windows-x64.zip" }
$wishArchive = Join-Path $wishRoot "release\$wishName"
if (Test-Path -LiteralPath $wishArchive) { throw 'Archive already exists. Keep the old release and use a new version number.' }
if (-not $IncludeData -and (Test-Path -LiteralPath (Join-Path $wishFolder 'data'))) { throw 'Public releases must not contain a data directory.' }
node (Join-Path $PSScriptRoot 'finalize-desktop.mjs') $wishFolder
if ($LASTEXITCODE -ne 0) { throw 'Release validation failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($wishFolder, $wishArchive, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$wishDigest = (Get-FileHash -LiteralPath $wishArchive -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($wishArchive + '.sha256', "$wishDigest  $wishName`n", [System.Text.Encoding]::ASCII)
Write-Output $wishArchive
