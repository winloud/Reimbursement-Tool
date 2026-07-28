param(
    [ValidateSet("Backend", "Frontend", "Release", "All")]
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
    "All" {
        Invoke-BackendVerification
        Invoke-FrontendVerification
        Invoke-ReleaseStaticChecks
    }
}

Write-Host "Verification profile '$Profile' passed."
