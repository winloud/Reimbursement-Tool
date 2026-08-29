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

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash($stream)
        return ([BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
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
# `cargo tauri signer sign` 写出的 .sig 是 **base64 编码**的 minisign 签名，
# 不是明文 minisign 文件：直接按 'untrusted comment:' 前缀断言必然失败。
# updater 也是拿这段 base64 原样填进 latest.json 的 signature 字段。
$sigPath = "$($setupExe.FullName).sig"
Assert-FileExists -Path $sigPath -Description "更新包签名" | Out-Null
$sigContent = (Get-Content -Raw -Encoding UTF8 -LiteralPath $sigPath).Trim()
if ($sigContent.Length -lt 100) {
    throw "签名文件内容过短，可能无效: $sigPath"
}
try {
    $decodedSig = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($sigContent))
}
catch {
    throw "签名文件不是合法 base64: $sigPath"
}
if (-not $decodedSig.StartsWith("untrusted comment:")) {
    throw "签名解码后不符 minisign 格式（应以 'untrusted comment:' 开头）: $sigPath"
}
Write-Host "签名: $sigPath"

# 3. latest.json。
$latestPath = Join-Path $FeedDir "latest.json"
Assert-FileExists -Path $latestPath -Description "latest.json" | Out-Null
$latest = Get-Content -Raw -Encoding UTF8 -LiteralPath $latestPath | ConvertFrom-Json
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
$feedSig = [string]$latest.platforms.$platformKey.signature
if ([string]::IsNullOrWhiteSpace($feedSig)) {
    throw "latest.json signature 为空"
}
# feed 里的签名必须与 .sig 文件逐字一致，否则客户端验签会失败。
if ($feedSig -cne $sigContent) {
    throw "latest.json signature 与 $sigPath 内容不一致"
}
Write-Host "latest.json: version=$($latest.version) platform=$platformKey"

# 4. data-compat.json。
$compatPath = Join-Path $FeedDir "data-compat.json"
Assert-FileExists -Path $compatPath -Description "data-compat.json" | Out-Null
$compat = Get-Content -Raw -Encoding UTF8 -LiteralPath $compatPath | ConvertFrom-Json
Assert-JsonField -Object $compat -Field "min_data_schema_version" -Description "data-compat.json"
Assert-JsonField -Object $compat -Field "max_data_schema_version" -Description "data-compat.json"
if ([int]$compat.min_data_schema_version -gt [int]$compat.max_data_schema_version) {
    throw "data-compat.json min_data_schema_version ($($compat.min_data_schema_version)) 大于 max ($($compat.max_data_schema_version))"
}
Write-Host "data-compat.json: min=$($compat.min_data_schema_version) max=$($compat.max_data_schema_version)"

# 5. SHA256 清单。
# 用 .NET 直接算，不走 Get-FileHash：该 cmdlet 依赖 Microsoft.PowerShell.Utility 的
# 模块自动加载，PSModulePath 被 PowerShell 7 等挤占的机器上会 CommandNotFound。
# validate_release_asset.ps1 出于同样原因用的也是 .NET 实现。
$sha256 = Get-FileSha256 -Path $setupExe.FullName
Write-Host "NSIS SHA256: $sha256"

Write-Host ""
Write-Host "=== 校验通过 ==="
Write-Host "tag:         $TagName"
Write-Host "version:     $Version"
Write-Host "setup:       $($setupExe.FullName)"
Write-Host "signature:   $sigPath"
Write-Host "feed:        $FeedDir"
