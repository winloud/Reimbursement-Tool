# Tauri NSIS 安装包构建脚本。
#
# 取代已删除的便携 ZIP 构建链路（见 ADR 0009）。流程：
#   1. 同步版本号到 Cargo.toml 与 tauri.conf.json（避免 feed 与二进制版本不一致）。
#   2. PyInstaller 用 reimbursement_sidecar.spec 打 onedir 产物到 dist/reimbursement-sidecar。
#   3. 复制 onedir 产物到 src-tauri/resources/reimbursement-sidecar（Tauri bundle.resources 装入点）。
#   4. cargo tauri build 产出 NSIS 安装包（前端构建由 tauri.conf.json beforeBuildCommand 在 frontend 执行，
#      脚本不重复跑）。
#   5. 用 tauri signer sign 对更新包签名，生成 .sig（私钥/密码由环境变量注入，脚本不持有）。
#   6. 调 generate_updater_feed.ps1 产出 latest.json + data-compat.json。
#
# 离线包：-Offline 用 tauri build --config 临时覆盖 bundle.windows.webviewInstallMode.type
# 为 offlineInstaller，产出含 WebView2 offline installer 的 NSIS，资产名带 -offline 后缀。
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
$CargoTomlPath = Join-Path $TauriSrcDir "Cargo.toml"
$TauriConfPath = Join-Path $TauriSrcDir "tauri.conf.json"

if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = Get-Date -Format "yyyyMMdd"
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
if ($Version -notmatch "^\d+\.\d+\.\d+$") {
    throw "Version must use X.Y.Z format."
}

function Invoke-Step {
    param([Parameter(Mandatory = $true)][string]$Name, [scriptblock]$Block)
    Write-Host "==> $Name"
    # 纯 PowerShell 步骤（同步版本号、复制 sidecar）不会设置 $LASTEXITCODE。
    # 先归零：否则要么沿用上一条原生命令的退出码，要么在本进程从未调用过原生命令时
    # 拿到 $null，$null -ne 0 成立，步骤会被误判成失败。
    # PowerShell 自身的错误由 $ErrorActionPreference = "Stop" 负责抛出。
    $global:LASTEXITCODE = 0
    & $Block
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

# 1. 同步版本号到 Cargo.toml 与 tauri.conf.json，避免 feed/二进制/安装包版本不一致。
# 两处都必须显式按 UTF-8 读：这两个文件含中文（Cargo.toml 的 description、
# tauri.conf.json 的 productName「报销管理」），而 Windows PowerShell 默认按 ANSI 代码页
# 读取无 BOM 的 UTF-8，再用 UTF8 写回就会把中文写成乱码，进而毁掉安装包名和窗口标题。
# 存在性判断也不能比较替换前后是否相同：版本号本来就等于目标值时（同一 tag 重建构建，
# 即 workflow_dispatch 的主要用途）内容不变，会被误判成“找不到 version 字段”。
$VersionPatterns = @{
    Cargo = '(?m)^version\s*=\s*"[^"]*"'
    Conf  = '(?m)^(\s*)"version"\s*:\s*"[^"]*"'
}
Invoke-Step "Sync version to $Version" {
    $cargoContent = Get-Content -Raw -Encoding UTF8 -LiteralPath $CargoTomlPath
    if ($cargoContent -notmatch $VersionPatterns.Cargo) {
        throw "无法在 $CargoTomlPath 找到 version 字段"
    }
    $cargoUpdated = $cargoContent -replace $VersionPatterns.Cargo, "version = `"$Version`""
    [System.IO.File]::WriteAllText($CargoTomlPath, $cargoUpdated, (New-Object System.Text.UTF8Encoding($false)))

    $confContent = Get-Content -Raw -Encoding UTF8 -LiteralPath $TauriConfPath
    if ($confContent -notmatch $VersionPatterns.Conf) {
        throw "无法在 $TauriConfPath 找到 version 字段"
    }
    $confUpdated = $confContent -replace $VersionPatterns.Conf, "`${1}`"version`": `"$Version`""
    [System.IO.File]::WriteAllText($TauriConfPath, $confUpdated, (New-Object System.Text.UTF8Encoding($false)))
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
# 只复制 onedir 的内容，不要复制目录本身：`Copy-Item -LiteralPath <dir> -Destination <已存在的dir>`
# 会把源目录塞进目标里，产生 resources/reimbursement-sidecar/reimbursement-sidecar/ 的多余嵌套，
# 使 sidecar.rs 在生产安装包里定位不到 exe，回退到开发用的 `python sidecar_app.py`。
Invoke-Step "Stage sidecar to src-tauri/resources" {
    if (Test-Path -LiteralPath $ResourcesDir) {
        # 清理上一次的产物，但保留纳入版本管理的占位说明：
        # 该文件负责让 bundle.resources 指向的目录在干净检出后依然存在
        # （cargo tauri build 要求该路径存在），删掉它会让仓库出现意外的删除改动。
        Get-ChildItem -LiteralPath $ResourcesDir -Force |
            Where-Object { $_.Name -ne "README.md" } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    } else {
        New-Item -ItemType Directory -Path $ResourcesDir -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $SidecarDist "*") -Destination $ResourcesDir -Recurse -Force

    # 布局断言：exe 必须直接位于装入点下。这条路径要和 sidecar.rs 的
    # resource_dir()/resources/reimbursement-sidecar/reimbursement-sidecar.exe 保持一致。
    $stagedExe = Join-Path $ResourcesDir "reimbursement-sidecar.exe"
    if (-not (Test-Path -LiteralPath $stagedExe)) {
        throw "sidecar 装入布局错误，未找到 $stagedExe（检查是否多了一层目录嵌套）"
    }
}

# 4. cargo tauri build 产出 NSIS。前端构建由 beforeBuildCommand（cwd=../frontend）执行，脚本不重复。
# 离线包用 --config 临时覆盖 webviewInstallMode 为 offlineInstaller。
$tauriArgs = @("tauri", "build")
if ($TauriFeatures) {
    $tauriArgs += @("--features", $TauriFeatures)
}
$buildLabel = "cargo tauri build (NSIS online)"
if ($Offline) {
    # 临时配置覆盖：离线 WebView2 installer。
    $offlineConfig = '{"bundle":{"windows":{"webviewInstallMode":{"type":"offlineInstaller"}}}}'
    $tauriArgs += @("--config", $offlineConfig)
    $buildLabel = "cargo tauri build (NSIS offline)"
}
Invoke-Step $buildLabel {
    Push-Location $TauriSrcDir
    try { cargo @tauriArgs } finally { Pop-Location }
}

# 5. 对更新包签名（产出 .sig）。
$NsisDir = Join-Path $TauriSrcDir "target\release\bundle\nsis"
$setupExe = Get-ChildItem -LiteralPath $NsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $setupExe) {
    throw "未找到 NSIS setup 产物: $NsisDir"
}
# 离线包重命名加 -offline 后缀，便于区分在线/离线资产。
$setupPath = $setupExe.FullName
if ($Offline -and -not $setupPath.Contains("-offline")) {
    $offlinePath = [System.IO.Path]::ChangeExtension($setupPath, "-offline.exe").Replace(".-offline", "-offline")
    Move-Item -LiteralPath $setupPath -Destination $offlinePath -Force
    $setupPath = $offlinePath
    $setupExe = Get-Item -LiteralPath $setupPath
}
$sigPath = "$setupPath.sig"

if ($env:TAURI_SIGNING_PRIVATE_KEY_PATH -and (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    Invoke-Step "Sign update package" {
        # Tauri v2 正确签名子命令：cargo tauri signer sign <file> --private-key-path <path>
        $signArgs = @("tauri", "signer", "sign", $setupPath, "--private-key-path", $env:TAURI_SIGNING_PRIVATE_KEY_PATH)
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
