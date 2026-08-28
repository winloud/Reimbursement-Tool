# 校验 Tauri NSIS 本地构建产物。
#
# 校验 NSIS setup exe 存在、签名文件存在、latest.json 与 data-compat.json 格式与字段完整、
# 签名与更新包匹配（签名内容由 tauri signer 生成，此处校验非空与基本格式）。
#
# 发布后校验 GitHub Release 上的公开资产用 scripts/validate_release_asset.ps1。

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [string]$BundleDir = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TagName = "v$Version"

# 默认从 cargo tauri build 产物目录读取。
if ([string]::IsNullOrWhiteSpace($BundleDir)) {
    $BundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
}
$FeedDir = Join-Path $Root "dist-feed"

function Assert-FileExists {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Description)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Description 不存在: $Path"
    }
    return (Get-Item -LiteralPath $Path)
}

function Assert-JsonField {
    param($Object, [Parameter(Mandatory = $true)][string]$Field, [Parameter(Mandatory = $true)][string]$Description)
    $value = $Object.$Field
    if ($null -eq $value -or ([string]::IsNullOrWhiteSpace([string]$value) -and $value -ne 0)) {
        throw "$Description 缺少字段 $Field"
    }
}

# 1. NSIS setup 产物。
$setupExe = Get-ChildItem -LiteralPath $BundleDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike "*.sig" } |
    Select-Object -First 1
if (-not $setupExe) {
    throw "未找到 NSIS setup 产物: $BundleDir"
}
Write-Host "NSIS 产物: $($setupExe.FullName)"
Write-Host "大小: $([math]::Round($setupExe.Length / 1MB, 2)) MB"

# 2. 签名文件。
$sigPath = "$($setupExe.FullName).sig"
$sigFile = Assert-FileExists -Path $sigPath -Description "更新包签名"
$sigContent = (Get-Content -Raw -LiteralPath $sigPath).Trim()
if ($sigContent.Length -lt 100) {
    throw "签名文件内容过短，可能无效: $sigPath"
}
if (-not $sigContent.StartsWith("untrusted comment:")) {
    throw "签名文件格式不符 minisign（应以 'untrusted comment:' 开头）: $sigPath"
}
Write-Host "签名: $sigPath"

# 3. latest.json。
$latestPath = Join-Path $FeedDir "latest.json"
$latestFile = Assert-FileExists -Path $latestPath -Description "latest.json"
$latest = Get-Content -Raw -LiteralPath $latestPath | ConvertFrom-Json
Assert-JsonField -Object $latest -Field "version" -Description "latest.json"
Assert-JsonField -Object $latest -Field "pub_date" -Description "latest.json"
if ($latest.version -ne $Version) {
    throw "latest.json version $($latest.version) 与发布版本 $Version 不符"
}
$platformKey = "windows-x86_64"
if (-not $latest.platforms.$platformKey) {
    throw "latest.json 缺少平台 $platformKey"
}
Assert-JsonField -Object $latest.platforms.$platformKey -Field "signature" -Description "latest.json $platformKey"
Assert-JsonField -Object $latest.platforms.$platformKey -Field "url" -Description "latest.json $platformKey"
$expectedSigLines = ($sigContent -split "`n" | Where-Object { $_ -notmatch "^untrusted comment:" -and $_ -notmatch "^trusted comment:" })
$feedSig = [string]$latest.platforms.$platformKey.signature
if ([string]::IsNullOrWhiteSpace($feedSig)) {
    throw "latest.json signature 为空"
}
Write-Host "latest.json: version=$($latest.version) platform=$platformKey"

# 4. data-compat.json。
$compatPath = Join-Path $FeedDir "data-compat.json"
$compatFile = Assert-FileExists -Path $compatPath -Description "data-compat.json"
$compat = Get-Content -Raw -LiteralPath $compatPath | ConvertFrom-Json
Assert-JsonField -Object $compat -Field "min_data_schema_version" -Description "data-compat.json"
Assert-JsonField -Object $compat -Field "max_data_schema_version" -Description "data-compat.json"
if ([int]$compat.min_data_schema_version -gt [int]$compat.max_data_schema_version) {
    throw "data-compat.json min_data_schema_version ($($compat.min_data_schema_version)) 大于 max ($($compat.max_data_schema_version))"
}
Write-Host "data-compat.json: min=$($compat.min_data_schema_version) max=$($compat.max_data_schema_version)"

# 5. SHA256 清单。
$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $setupExe.FullName).Hash.ToLowerInvariant()
Write-Host "NSIS SHA256: $sha256"

Write-Host ""
Write-Host "=== 校验通过 ==="
Write-Host "tag:         $TagName"
Write-Host "version:     $Version"
Write-Host "setup:       $($setupExe.FullName)"
Write-Host "signature:   $sigPath"
Write-Host "feed:        $FeedDir"
