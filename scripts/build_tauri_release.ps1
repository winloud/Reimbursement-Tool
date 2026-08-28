# Tauri NSIS 安装包构建脚本（阶段 7）。
#
# 取代旧 build_release.ps1 的便携 ZIP 逻辑。流程：
#   1. 构建前端（npm run build）。
#   2. PyInstaller 用 reimbursement_sidecar.spec 打 onedir 产物到 dist/reimbursement-sidecar。
#   3. 复制 onedir 产物到 src-tauri/resources/reimbursement-sidecar（Tauri bundle.resources 装入点）。
#   4. cargo tauri build 产出 NSIS 安装包（两种：常规联网 bootstrap WebView2 / 完全离线含 WebView2 offline）。
#   5. 用 tauri signer 对更新包签名，生成 .sig（私钥/密码由环境变量注入，脚本不持有）。
#   6. 调 generate_updater_feed.ps1 产出 latest.json + data-compat.json。
#
# 私钥环境变量（发布时注入，本地构建用测试密钥）：
#   TAURI_SIGNING_PRIVATE_KEY_PATH：私钥文件路径。
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD：私钥密码。
#
# 用法：
#   powershell -File scripts/build_tauri_release.ps1 -Version 2.0.0 -ReleaseDate 20260828
#   powershell -File scripts/build_tauri_release.ps1 -Version 2.0.0 -Offline  # 完全离线包

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [switch]$Offline,
    [switch]$SkipFrontend,
    [switch]$SkipSidecar,
    [string]$Python = "python",
    [string]$TauriFeatures = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$SidecarDist = Join-Path $Root "dist\reimbursement-sidecar"
$ResourcesDir = Join-Path $Root "src-tauri\resources\reimbursement-sidecar"
$TauriSrcDir = Join-Path $Root "src-tauri"

if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = Get-Date -Format "yyyyMMdd"
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}

function Invoke-Step {
    param([Parameter(Mandatory = $true)][string]$Name, [scriptblock]$Block)
    Write-Host "==> $Name"
    & $Block
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

# 1. 构建前端。
if (-not $SkipFrontend) {
    Invoke-Step "Frontend build" {
        Push-Location (Join-Path $Root "frontend")
        try { npm run build } finally { Pop-Location }
    }
}

# 2. PyInstaller 打 sidecar onedir。
if (-not $SkipSidecar) {
    Invoke-Step "PyInstaller sidecar build" {
        & $Python -m PyInstaller --clean --noconfirm `
            --distpath (Join-Path $Root "dist") `
            (Join-Path $Root "reimbursement_sidecar.spec")
    }
    if (-not (Test-Path -LiteralPath (Join-Path $SidecarDist "reimbursement-sidecar.exe"))) {
        throw "PyInstaller sidecar 产物未找到: $SidecarDist\reimbursement-sidecar.exe"
    }
}

# 3. 复制 onedir 到 Tauri resources 装入点。
Invoke-Step "Stage sidecar to src-tauri/resources" {
    if (Test-Path -LiteralPath $ResourcesDir) {
        # 清除旧产物（含开发占位 README），保留目录本身。
        Get-ChildItem -LiteralPath $ResourcesDir -Force | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
        }
    } else {
        New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $SidecarDist -Destination $ResourcesDir -Recurse -Force
    # 复制后 resources 下结构应为 resources/reimbursement-sidecar/reimbursement-sidecar.exe + 依赖
}

# 4. cargo tauri build 产出 NSIS。
$tauriArgs = @("tauri", "build")
if ($TauriFeatures) {
    $tauriArgs += @("--features", $TauriFeatures)
}
# 离线包：通过环境变量或 feature 切换 WebView2 offline installer（阶段 7 收尾按需配置）。
# 当前 tauri.conf.json bundle.targets 为 nsis，先产出常规包。
Invoke-Step "cargo tauri build (NSIS)" {
    Push-Location $TauriSrcDir
    try { cargo @tauriArgs } finally { Pop-Location }
}

# 5. 对更新包签名（产出 .sig）。
# tauri build 默认产出到 src-tauri/target/release/bundle/nsis/。
$NsisDir = Join-Path $TauriSrcDir "target\release\bundle\nsis"
$setupExe = Get-ChildItem -LiteralPath $NsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $setupExe) {
    throw "未找到 NSIS setup 产物: $NsisDir"
}
$setupPath = $setupExe.FullName
$sigPath = "$setupPath.sig"

if ($env:TAURI_SIGNING_PRIVATE_KEY_PATH -and (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    Invoke-Step "Sign update package" {
        $signArgs = @("tauri", "sign", $setupPath, "--private-key", $env:TAURI_SIGNING_PRIVATE_KEY_PATH)
        if ($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
            $signArgs += @("--password", $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
        }
        cargo @signArgs
    }
} else {
    Write-Warning "未设置 TAURI_SIGNING_PRIVATE_KEY_PATH，跳过更新包签名（仅本地测试用）。"
}

# 6. 生成 updater feed。
$dataSchemaJson = & $Python -c "import json; from backend.data_schema import DATA_SCHEMA_VERSION; print(json.dumps({'v': DATA_SCHEMA_VERSION}))"
$dataSchema = ($dataSchemaJson | Select-Object -Last 1) | ConvertFrom-Json
$githubAssetName = $setupExe.Name
$updateUrl = "https://github.com/winloud/Reimbursement-Tool/releases/download/v$Version/$githubAssetName"

$feedArgs = @(
    "-Version", $Version,
    "-UpdateUrl", $updateUrl,
    "-SignatureFile", $sigPath,
    "-ReleaseDate", ([DateTime]::ParseExact($ReleaseDate, "yyyyMMdd", $null)).ToString("yyyy-MM-dd"),
    "-MinDataSchema", [int]$dataSchema.v,
    "-MaxDataSchema", [int]$dataSchema.v,
    "-OutputDir", (Join-Path $Root "dist-feed")
)
Invoke-Step "Generate updater feed" {
    if (Test-Path -LiteralPath $sigPath) {
        powershell -NoProfile -File (Join-Path $PSScriptRoot "generate_updater_feed.ps1") @feedArgs
    } else {
        Write-Warning "签名文件不存在（$sigPath），跳过 feed 生成。"
    }
}

Write-Host ""
Write-Host "=== 构建完成 ==="
Write-Host "NSIS 安装包: $setupPath"
if (Test-Path -LiteralPath $sigPath) {
    Write-Host "更新签名:    $sigPath"
}
Write-Host "Feed 产物:   $(Join-Path $Root 'dist-feed')"
Write-Host "安装包大小:  $([math]::Round((Get-Item -LiteralPath $setupPath).Length / 1MB, 2)) MB"
