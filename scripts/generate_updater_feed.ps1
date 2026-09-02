# 生成 tauri-plugin-updater 的 feed 文件（latest.json + data-compat.json）。
#
# 用法：发布流程在 tauri build 产出 NSIS 更新包并用 tauri signer 签名后调用本脚本。
#   powershell -File scripts/generate_updater_feed.ps1 `
#     -Version 2.0.0 `
#     -UpdateUrl "https://github.com/winloud/Reimbursement-Tool/releases/download/v2.0.0/报销管理_2.0.0_x64-setup.exe" `
#     -SignatureFile "...\报销管理_2.0.0_x64-setup.exe.sig" `
#     -ReleaseDate "2026-08-28" `
#     -Notes "本次更新内容..." `
#     -MinDataSchema 7 -MaxDataSchema 7 `
#     -OutputDir "dist-feed"
#
# 产物 latest.json 与 data-compat.json 上传到 GitHub Release（与 tag 对应），
# 由 tauri.conf.json 的 updater.endpoints 指向 latest.json。
# 私钥签名由调用方在发布前用 `cargo tauri signer sign` 完成（私钥不入仓库）。

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$UpdateUrl,
    [Parameter(Mandatory = $true)][string]$SignatureFile,
    [string]$ReleaseDate = "",
    [string]$Notes = "",
    [int]$MinDataSchema = 7,
    [int]$MaxDataSchema = 7,
    [string]$Platform = "windows-x86_64",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $Root "dist-feed"
}

if (-not (Test-Path -LiteralPath $SignatureFile)) {
    throw "签名文件不存在: $SignatureFile"
}
$signature = (Get-Content -Raw -Encoding UTF8 -LiteralPath $SignatureFile).Trim()

if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $chinaTimeZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("China Standard Time")
    $ReleaseDate = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $chinaTimeZone).ToString("yyyy-MM-dd")
}

# pub_date 用 ISO 8601（当天 00:00:00Z）。
$pubDate = "$ReleaseDate" + "T00:00:00Z"

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

# latest.json：标准 tauri updater Static 格式（多平台）。
$latest = [ordered]@{
    version  = $Version
    notes    = $Notes
    pub_date = $pubDate
    platforms = [ordered]@{
        $Platform = [ordered]@{
            signature = $signature
            url       = $UpdateUrl
        }
    }
}

# feed 必须写成无 BOM 的 UTF-8：Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8`
# 会带 BOM，而客户端（tauri-plugin-updater 与 updater.rs 的 fetch_data_compat）用
# serde_json 解析，BOM 会让解析在第 1 列直接失败，导致所有客户端都检查不到更新。
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$latestPath = Join-Path $OutputDir "latest.json"
[System.IO.File]::WriteAllText($latestPath, ($latest | ConvertTo-Json -Depth 5), $Utf8NoBom)

# data-compat.json：声明新版兼容的数据结构范围，与 latest.json 同址发布。
$compat = [ordered]@{
    min_data_schema_version = $MinDataSchema
    max_data_schema_version = $MaxDataSchema
}
$compatPath = Join-Path $OutputDir "data-compat.json"
[System.IO.File]::WriteAllText($compatPath, ($compat | ConvertTo-Json -Depth 3), $Utf8NoBom)

Write-Host "已生成 updater feed："
Write-Host "  latest.json      -> $latestPath"
Write-Host "  data-compat.json  -> $compatPath"
Write-Host "  platform          -> $Platform"
Write-Host "  version           -> $Version"
