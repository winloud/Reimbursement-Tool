$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = if ($env:PYTHON) { $env:PYTHON } else { "python" }

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

Write-Host "Release output: $(Join-Path $Root 'dist\报销管理')"
