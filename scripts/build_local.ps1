param(
    [ValidateSet('Test', 'Release')][string]$Mode = 'Test',
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.tauri\reimbursement.key'),
    [switch]$PlanOnly,
    [switch]$OpenOutput,
    [Security.SecureString]$SigningPassword
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ConfigPath = Join-Path $Root 'src-tauri\tauri.conf.json'
$Utf8 = New-Object Text.UTF8Encoding($false)
$savedPath = $env:Path
$savedPython = $env:PYTHON
$savedConsoleOutputEncoding = [Console]::OutputEncoding
$savedPowerShellOutputEncoding = $OutputEncoding
$secretNames = @('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TAURI_PRIVATE_KEY', 'TAURI_PRIVATE_KEY_PATH', 'TAURI_PRIVATE_KEY_PASSWORD')
$savedSecrets = @{}
$password = $null
$buildLock = $null
$outputRoot = $null

function Invoke-Checked {
    param([string]$Name, [string]$Command, [object[]]$Arguments)
    Write-Host "==> $Name"
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name 失败（退出码 $LASTEXITCODE）。" }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('X2') })
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Get-GitState {
    $headValue = & git -C $Root rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Git 提交。' }
    $changes = @(& git -C $Root status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Git 工作区状态。' }
    return @{ commit = ([string]$headValue).Trim(); changes = $changes; dirty = $changes.Count -gt 0 }
}

function Assert-ReleaseClean {
    param($State)
    if ($Mode -eq 'Release' -and $State.dirty) {
        throw '正式版要求干净工作区。请先提交本次源码改动（包括新脚本），再双击构建正式版；日常调试请使用构建测试版。'
    }
}

function Assert-PublicKey {
    if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw "未找到生产私钥：$KeyPath。请按 docs/release-process.md 首次配置密钥。" }
    if (-not (Test-Path -LiteralPath "$KeyPath.pub" -PathType Leaf)) { throw "未找到配套公钥：$KeyPath.pub" }
    $publicKey = (Get-Content -Raw -Encoding UTF8 -LiteralPath "$KeyPath.pub").Trim()
    $embedded = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
    if ($publicKey -cne [string]$embedded.plugins.updater.pubkey) {
        throw '生产公钥与项目内嵌公钥不一致。请核对配置；脚本不会自动更换密钥。'
    }
}

function Resolve-BuildTools {
    foreach ($directory in @((Join-Path $env:USERPROFILE '.cargo\bin'), (Join-Path $env:ProgramFiles 'nodejs'), (Join-Path $env:ProgramFiles 'Git\cmd'))) {
        if (Test-Path -LiteralPath $directory) { $env:Path = "$directory;$env:Path" }
    }
    foreach ($tool in @('git', 'cargo', 'node', 'npm.cmd', 'powershell.exe')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "缺少构建工具 $tool，请安装后重试。" }
    }
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $basePython = & $pythonCommand.Source -3 -c 'import sys; print(sys.executable)'
    } else {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) { throw '未找到 Python 3，请安装 Python 后重试。' }
        $basePython = & $pythonCommand.Source -c 'import sys; print(sys.executable)'
    }
    if ($LASTEXITCODE -ne 0 -or -not $basePython) { throw 'Python 无法启动，请修复本机 Python 安装。' }
    $basePython = ([string]($basePython | Select-Object -Last 1)).Trim()
    Invoke-Checked '检查 Python 版本和位数' $basePython @('-c', "import sys,struct; assert sys.version_info >= (3,10) and struct.calcsize('P') == 8, 'Need Python 3.10+ x64'")
    Invoke-Checked '检查 Node.js' 'node' @('-e', "if(Number(process.versions.node.split('.')[0])<20 || process.arch!=='x64') process.exit(1)")
    Invoke-Checked '检查 Tauri CLI' 'cargo' @('tauri', '--version')
    return $basePython
}

Push-Location $Root
try {
    # Native Windows consoles commonly start in an OEM code page. The release
    # tests capture child PowerShell output as UTF-8, so normalize the shared
    # console before any nested process is launched.
    [Console]::OutputEncoding = $Utf8
    $OutputEncoding = $Utf8
    # Existing shell secrets must not leak into dependency installation or tests.
    foreach ($name in $secretNames) {
        $savedSecrets[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    Write-Host "本地 Tauri 构建：$(if ($Mode -eq 'Test') { '测试版（在线安装包）' } else { '正式版（在线安装包 + 更新文件）' })"
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
    $version = [string]$config.version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'src-tauri/tauri.conf.json 的版本必须为 X.Y.Z。' }
    $cargoText = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $Root 'src-tauri\Cargo.toml')
    if ($cargoText -notmatch '(?m)^version\s*=\s*"([^"]+)"' -or $Matches[1] -cne $version) { throw 'Cargo.toml 和 tauri.conf.json 版本不一致。' }
    $basePython = Resolve-BuildTools | Select-Object -Last 1
    $KeyPath = [IO.Path]::GetFullPath($KeyPath)
    Assert-PublicKey
    $initialState = Get-GitState
    Assert-ReleaseClean $initialState
    $releaseDate = Get-Date -Format 'yyyyMMdd'
    $buildId = "$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
    $outputRoot = Join-Path $Root "artifacts\local-$($Mode.ToLowerInvariant())\$version-$buildId"
    Write-Host "应用版本：$version"
    Write-Host "源码提交：$($initialState.commit)"
    Write-Host "输出目录：$outputRoot"
    if ($initialState.dirty) { Write-Host '测试版将包含当前未提交改动，构建摘要会标记 dirty。' }
    if ($PlanOnly) { Write-Host '预检查完成：未读取私钥内容、未要求密码、未构建。'; return }

    # Both variants stage resources in the same repository, so serialize runs.
    $artifactRoot = Join-Path $Root 'artifacts'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    try {
        $buildLock = [IO.File]::Open((Join-Path $artifactRoot '.local-build.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch { throw '另一个一键构建正在运行，请等它结束后再试。' }

    $password = if ($SigningPassword) {
        $SigningPassword.Copy()
    } else {
        Read-Host '请输入生产 updater 私钥密码（输入不显示）' -AsSecureString
    }
    New-Item -ItemType Directory -Path $outputRoot -ErrorAction Stop | Out-Null
    $probe = Join-Path $outputRoot 'signing-check.txt'
    try {
        [IO.File]::WriteAllText($probe, "reimbursement signing check $buildId", $Utf8)
        Write-Host '==> 检查密码及生产密钥配对'
        & (Join-Path $PSScriptRoot 'sign_updater.ps1') -File $probe -KeyPath $KeyPath -Password $password
        Invoke-Checked '验证签名与项目公钥' 'node' @((Join-Path $PSScriptRoot 'verify_updater_signature.mjs'), $probe, "$probe.sig", $ConfigPath)
    } finally {
        foreach ($probePath in @($probe, "$probe.sig")) {
            if (Test-Path -LiteralPath $probePath) { Remove-Item -LiteralPath $probePath -Force }
        }
    }

    $venv = Join-Path $Root '.build-venv'
    $python = Join-Path $venv 'Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) { Invoke-Checked '建立专用构建环境' $basePython @('-m', 'venv', $venv) }
    Invoke-Checked '准备 Python 构建和测试依赖' $python @('-m', 'pip', 'install', '--disable-pip-version-check', '-r', (Join-Path $Root 'backend\requirements-dev.txt'), '-r', (Join-Path $Root 'backend\requirements-packaging.txt'))
    $env:Path = "$(Split-Path -Parent $python);$env:Path"
    $env:PYTHON = $python
    Push-Location (Join-Path $Root 'frontend')
    try { Invoke-Checked '准备前端依赖' 'npm.cmd' @('ci', '--no-audit', '--no-fund') } finally { Pop-Location }
    $profile = if ($Mode -eq 'Release') { 'All' } else { 'Release' }
    Invoke-Checked "运行 $profile 验证" 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'verify.ps1'), '-Profile', $profile)
    $beforeBuild = Get-GitState
    Assert-ReleaseClean $beforeBuild
    if ($beforeBuild.commit -cne $initialState.commit) { throw '验证期间 Git 提交发生变化，请重新构建。' }
    Assert-PublicKey

    if ($Mode -eq 'Release') {
        & (Join-Path $PSScriptRoot 'build_target.ps1') -Target Tauri -Version $version -ReleaseDate $releaseDate `
            -OutputRoot $outputRoot -Python $python -SigningKeyPath $KeyPath -SigningPassword $password
    } else {
        $bundleDir = Join-Path $outputRoot 'tauri\online'
        & (Join-Path $PSScriptRoot 'build_tauri_release.ps1') -Version $version -ReleaseDate $releaseDate `
            -PreviewBuild -RequireSignature -Python $python -CommitSha $initialState.commit `
            -OutputDir $bundleDir -IntermediateRoot (Join-Path $outputRoot '.build') `
            -FeedOutputDir (Join-Path $outputRoot 'tauri\updater') -SigningKeyPath $KeyPath -SigningPassword $password
        $setups = @(Get-ChildItem -LiteralPath $bundleDir -Filter '*-setup.exe')
        if ($setups.Count -ne 1) { throw '测试安装包数量异常。' }
        $original = $setups[0].FullName
        $renamed = Join-Path $bundleDir ($setups[0].Name -replace '-setup\.exe$', "-test-$buildId-setup.exe")
        Move-Item -LiteralPath $original -Destination $renamed
        Move-Item -LiteralPath "$original.sig" -Destination "$renamed.sig"
        Invoke-Checked '验证测试版产物' 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            (Join-Path $PSScriptRoot 'validate_tauri_release.ps1'), '-Version', $version, '-ReleaseDate', $releaseDate,
            '-BundleDir', $bundleDir, '-ExpectedCommit', $initialState.commit, '-SkipFeed')
    }
    $installers = @(Get-ChildItem -LiteralPath (Join-Path $outputRoot 'tauri') -Recurse -Filter '*.exe')
    $expectedCount = 1
    if ($installers.Count -ne $expectedCount) { throw '安装包数量与构建模式不一致。' }
    foreach ($installer in $installers) {
        Invoke-Checked '验证安装包生产签名' 'node' @((Join-Path $PSScriptRoot 'verify_updater_signature.mjs'), $installer.FullName, "$($installer.FullName).sig", $ConfigPath)
    }
    $finalState = Get-GitState
    Assert-ReleaseClean $finalState
    if ($finalState.commit -cne $initialState.commit) { throw '构建期间 Git 提交发生变化，请重新构建。' }
    $summary = [ordered]@{
        mode = $Mode; version = $version; build_id = $buildId; commit = $initialState.commit
        dirty = $beforeBuild.dirty; worktree_changes = @($beforeBuild.changes)
        verification_profile = $profile; updater_signatures_verified = $true
        public_key_sha256 = Get-Sha256 -Path "$KeyPath.pub"
        installers = @($installers | ForEach-Object { [ordered]@{
            file = $_.Name; bytes = $_.Length; sha256 = Get-Sha256 -Path $_.FullName
        } })
    }
    [IO.File]::WriteAllText((Join-Path $outputRoot 'build-summary.json'), ($summary | ConvertTo-Json -Depth 6), $Utf8)
    Write-Host "`n构建及签名验证完成：$outputRoot" -ForegroundColor Green
    Write-Host '此入口只生成本地安装包。发布到 GitHub 仍走单独的正式发布流程。'
    if ($OpenOutput) { & explorer.exe $outputRoot }
} catch {
    Write-Host "`n构建未完成：$($_.Exception.Message)" -ForegroundColor Red
    if ($outputRoot -and (Test-Path -LiteralPath $outputRoot)) { Write-Host "本次工作目录：$outputRoot（保留以便排查）" }
    exit 1
} finally {
    if ($password) { $password.Dispose() }
    if ($buildLock) { $buildLock.Dispose() }
    $env:Path = $savedPath
    $env:PYTHON = $savedPython
    [Console]::OutputEncoding = $savedConsoleOutputEncoding
    $OutputEncoding = $savedPowerShellOutputEncoding
    foreach ($name in $savedSecrets.Keys) { [Environment]::SetEnvironmentVariable($name, $savedSecrets[$name], 'Process') }
    Pop-Location
}
