# Tauri NSIS 安装包构建脚本。
#
# 与便携 ZIP 的 build_release.ps1 并行存在。Tauri Target 流程：
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
    [string]$TauriFeatures = "",
    [string]$OutputDir = "",
    [string]$IntermediateRoot = "",
    [string]$FeedOutputDir = "",
    [string]$CommitSha = "",
    [switch]$PreviewBuild,
    [switch]$SkipFeed,
    [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$ResourcesDir = Join-Path $Root "src-tauri\resources\reimbursement-sidecar"
$TauriSrcDir = Join-Path $Root "src-tauri"
$CargoTomlPath = Join-Path $TauriSrcDir "Cargo.toml"
$CargoLockPath = Join-Path $TauriSrcDir "Cargo.lock"
$TauriConfPath = Join-Path $TauriSrcDir "tauri.conf.json"
$NsisDir = Join-Path $TauriSrcDir "target\release\bundle\nsis"

if ([string]::IsNullOrWhiteSpace($IntermediateRoot)) {
    $DistRoot = Join-Path $Root "dist"
    $PyInstallerWorkRoot = Join-Path $Root "build"
}
else {
    if (-not [System.IO.Path]::IsPathRooted($IntermediateRoot)) { $IntermediateRoot = Join-Path $Root $IntermediateRoot }
    $DistRoot = Join-Path $IntermediateRoot "dist"
    $PyInstallerWorkRoot = Join-Path $IntermediateRoot "pyinstaller"
}
$SidecarDist = Join-Path $DistRoot "reimbursement-sidecar"
if ([string]::IsNullOrWhiteSpace($OutputDir)) { $OutputDir = $NsisDir }
elseif (-not [System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir = Join-Path $Root $OutputDir }
if ([string]::IsNullOrWhiteSpace($FeedOutputDir)) { $FeedOutputDir = Join-Path $Root "dist-feed" }
elseif (-not [System.IO.Path]::IsPathRooted($FeedOutputDir)) { $FeedOutputDir = Join-Path $Root $FeedOutputDir }

if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = Get-Date -Format "yyyyMMdd"
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
if ($Version -notmatch "^\d+\.\d+\.\d+$") {
    throw "Version must use X.Y.Z format."
}
if ([string]::IsNullOrWhiteSpace($CommitSha)) {
    $CommitSha = (& git -C $Root rev-parse HEAD | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to resolve Git commit SHA." }
}
if ($CommitSha -notmatch "^[0-9a-fA-F]{40}$") { throw "CommitSha must be a full 40-character Git commit ID." }
$CommitSha = $CommitSha.ToLowerInvariant()
if ($Offline -or $PreviewBuild) { $SkipFeed = $true }

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

function Save-TrackedFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $exists = Test-Path -LiteralPath $Path
    $bytes = $null
    if ($exists) {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
    }
    return [ordered]@{ path = $Path; exists = $exists; bytes = $bytes }
}

function Restore-TrackedFile {
    param($Snapshot)
    if ($Snapshot.exists) { [System.IO.File]::WriteAllBytes($Snapshot.path, $Snapshot.bytes) }
    elseif (Test-Path -LiteralPath $Snapshot.path) { Remove-Item -LiteralPath $Snapshot.path -Force }
}

function Clear-StagedResources {
    if (Test-Path -LiteralPath $ResourcesDir) {
        Get-ChildItem -LiteralPath $ResourcesDir -Force |
            Where-Object { $_.Name -ne "README.md" } |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    }
}

$TrackedFileSnapshots = @(
    (Save-TrackedFile -Path $CargoTomlPath),
    (Save-TrackedFile -Path $CargoLockPath),
    (Save-TrackedFile -Path $TauriConfPath)
)

try {

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
    New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $PyInstallerWorkRoot -Force | Out-Null
    Invoke-Step "PyInstaller sidecar build" {
        & $Python -m PyInstaller --clean --noconfirm `
            --distpath $DistRoot `
            --workpath (Join-Path $PyInstallerWorkRoot "sidecar") `
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
    $buildMode = if ($PreviewBuild) { "preview" } else { "release" }
    $buildVariant = if ($Offline) { "offline" } else { "online" }
    $buildContext = [ordered]@{
        schema_version = 1
        distribution_target = "tauri"
        version = $Version
        commit = $CommitSha
        release_date = $ReleaseDate
        build_mode = $buildMode
        variant = $buildVariant
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $ResourcesDir "build-context.json"),
        ($buildContext | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
}

# 4. cargo tauri build 产出 NSIS。前端构建由 beforeBuildCommand（cwd=../frontend）执行，脚本不重复。
# 离线包用 --config 临时覆盖 webviewInstallMode 为 offlineInstaller。
New-Item -ItemType Directory -Path $NsisDir -Force | Out-Null
Get-ChildItem -LiteralPath $NsisDir -Filter "*-setup*.exe*" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$tauriArgs = @("tauri", "build")
$offlineConfigPath = $null
if ($TauriFeatures) {
    $tauriArgs += @("--features", $TauriFeatures)
}
$buildLabel = "cargo tauri build (NSIS online)"
if ($Offline) {
    # PowerShell 将传给原生命令的内联 JSON 双引号处理掉，不能直接把 JSON
    # 字符串作为 cargo tauri --config 参数。使用短生命周期的临时 JSON 文件，
    # 让 Tauri CLI 按文件路径读取覆盖配置。
    $offlineConfigPath = Join-Path $env:TEMP "reimbursement-tauri-offline-$([guid]::NewGuid().ToString('N')).json"
    $offlineConfig = [ordered]@{
        bundle = [ordered]@{
            windows = [ordered]@{
                webviewInstallMode = [ordered]@{ type = "offlineInstaller" }
            }
        }
    } | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText(
        $offlineConfigPath,
        $offlineConfig,
        (New-Object System.Text.UTF8Encoding($false))
    )
    $tauriArgs += @("--config", $offlineConfigPath)
    $buildLabel = "cargo tauri build (NSIS offline)"
}
try {
    Invoke-Step $buildLabel {
        Push-Location $TauriSrcDir
        try { cargo @tauriArgs } finally { Pop-Location }
    }
}
finally {
    if ($offlineConfigPath -and (Test-Path -LiteralPath $offlineConfigPath)) {
        Remove-Item -LiteralPath $offlineConfigPath -Force -ErrorAction SilentlyContinue
    }
}

# 5. 对更新包签名（产出 .sig）。
$setupFiles = @(Get-ChildItem -LiteralPath $NsisDir -Filter "*-setup.exe" -ErrorAction SilentlyContinue)
if ($setupFiles.Count -ne 1) {
    throw "NSIS setup 产物数量异常，预期 1 个，实际 $($setupFiles.Count) 个: $NsisDir"
}
$setupExe = $setupFiles[0]
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
} elseif ($RequireSignature) {
    throw "TAURI_SIGNING_PRIVATE_KEY_PATH is required for a formal Tauri build."
} else {
    Write-Warning "未设置 TAURI_SIGNING_PRIVATE_KEY_PATH，跳过更新包签名（仅本地测试用）。"
}

# 6. 生成 updater feed。
if (-not $SkipFeed) {
    $dataSchemaJson = & $Python -c "import json; from backend.data_schema import DATA_SCHEMA_VERSION; print(json.dumps({'v': DATA_SCHEMA_VERSION}))"
    if ($LASTEXITCODE -ne 0) { throw "读取数据结构版本失败，exit code $LASTEXITCODE" }
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
        "-OutputDir", $FeedOutputDir
    )
    Invoke-Step "Generate updater feed" {
        if (Test-Path -LiteralPath $sigPath) {
            powershell -NoProfile -File (Join-Path $PSScriptRoot "generate_updater_feed.ps1") @feedArgs
        } else {
            Write-Warning "签名文件不存在（$sigPath），跳过 feed 生成。"
        }
    }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$outputSetupPath = Join-Path $OutputDir $setupExe.Name
if (-not [string]::Equals([System.IO.Path]::GetFullPath($setupPath), [System.IO.Path]::GetFullPath($outputSetupPath), [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $setupPath -Destination $outputSetupPath -Force
}
if ((Test-Path -LiteralPath $sigPath) -and -not [string]::Equals([System.IO.Path]::GetFullPath($sigPath), [System.IO.Path]::GetFullPath("$outputSetupPath.sig"), [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath $sigPath -Destination "$outputSetupPath.sig" -Force
}
Copy-Item -LiteralPath (Join-Path $ResourcesDir "build-context.json") -Destination (Join-Path $OutputDir "build-context.json") -Force

Write-Host ""
Write-Host "=== 构建完成 ==="
Write-Host "NSIS 安装包: $outputSetupPath"
if (Test-Path -LiteralPath $sigPath) {
    Write-Host "更新签名:    $sigPath"
}
if (-not $SkipFeed) {
    Write-Host "Feed 产物:   $FeedOutputDir"
}
Write-Host "安装包大小:  $([math]::Round((Get-Item -LiteralPath $outputSetupPath).Length / 1MB, 2)) MB"
}
finally {
    Clear-StagedResources
    foreach ($snapshot in $TrackedFileSnapshots) { Restore-TrackedFile -Snapshot $snapshot }
}
