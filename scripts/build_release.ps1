param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$AppName = "报销管理"
$DistApp = Join-Path $Root "dist\$AppName"
$ReleaseDir = Join-Path $Root "release"
$StageRoot = Join-Path $ReleaseDir ".staging-$Version"
$ZipPath = Join-Path $ReleaseDir "$AppName-v$Version.zip"

function Remove-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $AllowedRoot).Path.TrimEnd("\")
    if ($resolvedPath -ne $resolvedRoot -and -not $resolvedPath.StartsWith("$resolvedRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside allowed root: $resolvedPath"
    }

    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

Push-Location (Join-Path $Root "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

& $Python -m PyInstaller --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is not available. Install backend\requirements-packaging.txt first."
}
& $Python -m PyInstaller --clean --noconfirm (Join-Path $Root "reimbursement_tool.spec")
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $DistApp)) {
    throw "PyInstaller output not found: $DistApp"
}

foreach ($name in @("data", "uploads", "logs", "browser-profile")) {
    Remove-PathInside -Path (Join-Path $DistApp $name) -AllowedRoot $DistApp
}

New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $ReleaseDir -Force) {
    Remove-PathInside -Path $item.FullName -AllowedRoot $ReleaseDir
}

New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination (Join-Path $StageRoot "README.md")
Copy-Item -LiteralPath $DistApp -Destination $StageRoot -Recurse
Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $ZipPath -Force
Remove-PathInside -Path $StageRoot -AllowedRoot $ReleaseDir

Write-Host "Release output: $ZipPath"
