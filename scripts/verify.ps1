param(
    [ValidateSet("Backend", "Frontend", "Release", "Desktop", "All")]
    [string]$Profile = "All"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $Root
    )

    Write-Host "==> $Name"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-BackendVerification {
    Invoke-External `
        -Name "Backend test suite" `
        -FilePath "python" `
        -ArgumentList @("-m", "pytest", "-q")
}

function Invoke-FrontendVerification {
    $frontendPath = Join-Path $Root "frontend"
    Invoke-External `
        -Name "Frontend test suite" `
        -FilePath "npm" `
        -ArgumentList @("test") `
        -WorkingDirectory $frontendPath
    Invoke-External `
        -Name "Frontend production build" `
        -FilePath "npm" `
        -ArgumentList @("run", "build") `
        -WorkingDirectory $frontendPath
}

function Invoke-ReleaseTests {
    Invoke-External `
        -Name "Release tooling tests" `
        -FilePath "python" `
        -ArgumentList @("-m", "pytest", "-q", "tests/release")
}

function Invoke-ReleaseStaticChecks {
    Write-Host "==> PowerShell syntax"
    foreach ($script in Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.ps1" | Sort-Object Name) {
        $tokens = $null
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile(
            $script.FullName,
            [ref]$tokens,
            [ref]$parseErrors
        ) | Out-Null
        if (@($parseErrors).Count -gt 0) {
            $details = ($parseErrors | ForEach-Object { $_.Message }) -join "; "
            throw "$($script.Name) has PowerShell syntax errors: $details"
        }
    }

    Invoke-External `
        -Name "Whitespace check" `
        -FilePath "git" `
        -ArgumentList @("diff", "--check", "HEAD", "--")
}

function Invoke-DesktopStaticChecks {
    Write-Host "==> Tauri configuration"
    $tauriRoot = Join-Path $Root "src-tauri"
    $configPath = Join-Path $tauriRoot "tauri.conf.json"
    $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json

    if ($config.identifier -cne "com.winloud.reimbursementtool") {
        throw "tauri.conf.json identifier must stay com.winloud.reimbursementtool (ADR 0009)."
    }
    if (@($config.bundle.targets) -notcontains "nsis") {
        throw "tauri.conf.json bundle.targets must include nsis."
    }
    if ($config.bundle.windows.nsis.installMode -cne "currentUser") {
        throw "NSIS installMode must stay currentUser (no admin rights required)."
    }
    if (@($config.bundle.resources) -notcontains "resources/reimbursement-sidecar") {
        throw "tauri.conf.json bundle.resources must carry the PyInstaller sidecar onedir."
    }
    if (-not $config.plugins.updater.active) {
        throw "Updater plugin must stay active."
    }
    if (@($config.plugins.updater.endpoints).Count -eq 0) {
        throw "Updater plugin must declare at least one latest.json endpoint."
    }
    if ([string]::IsNullOrWhiteSpace([string]$config.plugins.updater.pubkey)) {
        throw "Updater plugin must declare the signing public key."
    }
    if ($config.version -notmatch "^\d+\.\d+\.\d+$") {
        throw "tauri.conf.json version must use X.Y.Z format."
    }

    $cargoToml = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $tauriRoot "Cargo.toml")
    if ($cargoToml -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
        throw "Cannot resolve version from src-tauri/Cargo.toml."
    }
    if ($Matches[1] -cne [string]$config.version) {
        throw "Cargo.toml version $($Matches[1]) does not match tauri.conf.json $($config.version)."
    }

    Write-Host "==> Tauri capabilities"
    # 前端只应拿到窗口相关的最小权限：sidecar 启动、文件保存和更新安装都由 Rust 端发起，
    # 一旦把 shell/fs/dialog 的执行权限暴露给 WebView，会话令牌鉴权就形同虚设。
    foreach ($capability in Get-ChildItem -LiteralPath (Join-Path $tauriRoot "capabilities") -Filter "*.json") {
        $permissions = @((Get-Content -Raw -Encoding UTF8 -LiteralPath $capability.FullName | ConvertFrom-Json).permissions)
        foreach ($permission in $permissions) {
            $name = [string]$permission
            if ($name -match "^(shell|fs|http):") {
                throw "$($capability.Name) must not expose $name to the frontend."
            }
        }
    }
}

function Invoke-DesktopVerification {
    $tauriRoot = Join-Path $Root "src-tauri"
    Invoke-DesktopStaticChecks
    Invoke-External `
        -Name "Tauri Rust unit tests" `
        -FilePath "cargo" `
        -ArgumentList @("test", "--lib") `
        -WorkingDirectory $tauriRoot
    Invoke-External `
        -Name "Tauri clippy" `
        -FilePath "cargo" `
        -ArgumentList @("clippy", "--all-targets", "--", "-D", "warnings") `
        -WorkingDirectory $tauriRoot
}

switch ($Profile) {
    "Backend" {
        Invoke-BackendVerification
    }
    "Frontend" {
        Invoke-FrontendVerification
    }
    "Release" {
        Invoke-ReleaseTests
        Invoke-ReleaseStaticChecks
    }
    "Desktop" {
        Invoke-DesktopVerification
    }
    "All" {
        Invoke-BackendVerification
        Invoke-FrontendVerification
        Invoke-DesktopVerification
        Invoke-ReleaseStaticChecks
    }
}

Write-Host "Verification profile '$Profile' passed."
