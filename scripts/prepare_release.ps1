param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [switch]$SkipTests,
    [switch]$RunFrontendBuild,
    [switch]$KeepReleaseNotes
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($Version -notmatch "^\d+\.\d+\.\d+$") {
    throw "Version must use X.Y.Z format."
}

if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $chinaTimeZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("China Standard Time")
    $ReleaseDate = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $chinaTimeZone).ToString("yyyyMMdd")
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}

$ReleaseDateDisplay = [DateTime]::ParseExact(
    $ReleaseDate,
    "yyyyMMdd",
    [System.Globalization.CultureInfo]::InvariantCulture
).ToString("yyyy-MM-dd")
$TagName = "v$Version"
$EscapedVersion = [regex]::Escape($Version)
$EscapedTag = [regex]::Escape($TagName)
$ReleaseNotesPath = Join-Path $env:TEMP "release-notes-$TagName-check.md"

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

function Assert-FileContains {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $fullPath = Join-Path $Root $Path
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw "Required file does not exist: $Path"
    }
    $text = Get-Content -Raw -LiteralPath $fullPath
    if ($text -notmatch $Pattern) {
        throw "$Description check failed in $Path."
    }
}

function Get-JsonValueWithNode {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expression
    )

    $fullPath = Join-Path $Root $Path
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw "Required JSON file does not exist: $Path"
    }

    $nodeScript = @"
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const value = ($Expression);
if (value === undefined || value === null) {
  process.exit(2);
}
console.log(String(value));
"@
    $tempScript = Join-Path $env:TEMP "release-json-$([guid]::NewGuid().ToString('N')).js"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempScript, $nodeScript, $utf8NoBom)
    try {
        $value = & node $tempScript $fullPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to read JSON value from $Path."
        }
        return ($value | Select-Object -Last 1).Trim()
    }
    finally {
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Preparing release preflight for $TagName ($ReleaseDate)..."

Assert-FileContains `
    -Path "CHANGELOG.md" `
    -Pattern "(?m)^##\s+$EscapedTag\s+-\s+$ReleaseDateDisplay\s*$" `
    -Description "CHANGELOG release heading"
Assert-FileContains `
    -Path "README.md" `
    -Pattern "报销管理 V$EscapedVersion 发布说明" `
    -Description "README release title"
Assert-FileContains `
    -Path "README.md" `
    -Pattern "报销管理_$EscapedVersion`_x64-setup\.exe" `
    -Description "README installer example"
Assert-FileContains `
    -Path "backend/app_metadata.py" `
    -Pattern "DEFAULT_APP_VERSION\s*=\s*`"$EscapedVersion`"" `
    -Description "backend default version"

$packageVersion = Get-JsonValueWithNode -Path "frontend/package.json" -Expression "data.version"
if ($packageVersion -ne $Version) {
    throw "frontend/package.json version is $packageVersion, expected $Version."
}
$packageLockVersion = Get-JsonValueWithNode -Path "frontend/package-lock.json" -Expression "data.version"
$packageLockRootVersion = Get-JsonValueWithNode -Path "frontend/package-lock.json" -Expression "data.packages[''].version"
if ($packageLockVersion -ne $Version -or $packageLockRootVersion -ne $Version) {
    throw "frontend/package-lock.json root version does not match $Version."
}

$frozenPlanPath = Join-Path $Root "docs/releases/$TagName-plan.md"
if (-not (Test-Path -LiteralPath $frozenPlanPath)) {
    throw "Frozen release plan is missing: docs/releases/$TagName-plan.md"
}
$activePlan = Get-Content -Raw -LiteralPath (Join-Path $Root "docs/releases/active-plan.md")
if ($activePlan -match "版本号：v?$EscapedVersion") {
    throw "docs/releases/active-plan.md still points at $TagName. Freeze it and recreate the next active plan first."
}

Invoke-External `
    -Name "Extract release notes" `
    -FilePath "python" `
    -ArgumentList @("scripts\extract_changelog_section.py", "--version", $Version, "--output", $ReleaseNotesPath)
if (-not $KeepReleaseNotes) {
    Remove-Item -LiteralPath $ReleaseNotesPath -Force -ErrorAction SilentlyContinue
}

if (-not $SkipTests) {
    Invoke-External -Name "Backend tests" -FilePath "python" -ArgumentList @("-m", "pytest")
    Invoke-External `
        -Name "Frontend tests" `
        -FilePath "npm" `
        -ArgumentList @("test") `
        -WorkingDirectory (Join-Path $Root "frontend")
}
else {
    Write-Warning "Skipping tests because -SkipTests was provided."
}

if ($RunFrontendBuild) {
    Invoke-External `
        -Name "Frontend production build" `
        -FilePath "npm" `
        -ArgumentList @("run", "build") `
        -WorkingDirectory (Join-Path $Root "frontend")
}

Invoke-External -Name "Whitespace diff check" -FilePath "git" -ArgumentList @("diff", "--check")

$existingLocalTag = & git -C $Root tag --list $TagName
if ($existingLocalTag) {
    Write-Warning "Local tag $TagName already exists."
}

Write-Host ""
Write-Host "Release preflight passed for $TagName."
Write-Host "Fast path: commit release files, create $TagName, then push branch and tag so GitHub Actions builds the formal NSIS installer."
