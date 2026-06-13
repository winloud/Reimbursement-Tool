param(
    [string]$Version = "1.1.0",
    [switch]$UseSystemPython,
    [switch]$SkipDependencyInstall,
    [switch]$ReuseReleaseVenv,
    [switch]$BuildOpenCvRuntime,
    [string]$OpenCvPackageVersion = "4.10.0.84"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BasePython = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$ReleaseVenv = Join-Path $Root ".release-venv"
$Python = $BasePython
$AppName = "报销管理"
$DistApp = Join-Path $Root "dist\$AppName"
$ReleaseDir = Join-Path $Root "release"
$ReleaseDate = Get-Date -Format "yyyyMMdd"
$StageRoot = Join-Path $ReleaseDir ".staging-$Version-$ReleaseDate"
$ZipPath = Join-Path $ReleaseDir "$AppName-v$Version-$ReleaseDate.zip"

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

function Get-TreeSizeBytes {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return 0
    }
    $item = Get-Item -LiteralPath $Path
    if (-not $item.PSIsContainer) {
        return $item.Length
    }
    return (Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Measure-Object Length -Sum).Sum
}

function Format-SizeMb {
    param([Parameter(Mandatory = $true)][double]$Bytes)

    return "{0:N2} MB" -f ($Bytes / 1MB)
}

function Remove-OptionalDistFiles {
    param([Parameter(Mandatory = $true)][string]$AppRoot)

    $internal = Join-Path $AppRoot "_internal"
    if (-not (Test-Path -LiteralPath $internal)) {
        return
    }

    $patterns = @(
        "PIL\_avif*.pyd",
        "PIL\_imagingtk*.pyd",
        "numpy\_core\_multiarray_tests*.pyd",
        "Pythonwin"
    )
    foreach ($pattern in $patterns) {
        foreach ($item in Get-ChildItem -Path (Join-Path $internal $pattern) -Force -ErrorAction SilentlyContinue) {
            Remove-PathInside -Path $item.FullName -AllowedRoot $AppRoot
        }
    }
}

function Copy-DirectoryRequired {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Required runtime directory not found: $Source"
    }
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse
}

function Get-PythonValue {
    param([Parameter(Mandatory = $true)][string]$Code)

    $value = & $Python -c $Code
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE"
    }
    return ($value | Select-Object -Last 1).Trim()
}

function Get-SitePackagesPath {
    if (-not $UseSystemPython) {
        return (Join-Path $ReleaseVenv "Lib\site-packages")
    }
    return Get-PythonValue "import site; print(next(p for p in site.getsitepackages() if p.endswith('site-packages')))"
}

function New-OpenCvRuntimePackage {
    if (-not $SkipDependencyInstall) {
        & $Python -m pip install "opencv-contrib-python-headless==$OpenCvPackageVersion"
        if ($LASTEXITCODE -ne 0) {
            throw "OpenCV runtime dependency install failed with exit code $LASTEXITCODE"
        }
    }

    $ActualOpenCvPackageVersion = Get-PythonValue "import importlib.metadata as m; print(m.version('opencv-contrib-python-headless'))"
    $NumpyVersion = Get-PythonValue "import importlib.metadata as m; print(m.version('numpy'))"
    $SitePackages = Get-SitePackagesPath
    $OpenCvPackageVersion = $ActualOpenCvPackageVersion
    $RuntimeZipName = "opencv-wechat-runtime-opencv-$OpenCvPackageVersion-win_amd64.zip"
    $RuntimeZipPath = Join-Path $ReleaseDir $RuntimeZipName
    $RuntimeStage = Join-Path $ReleaseDir ".opencv-runtime-$OpenCvPackageVersion"
    $ModelSource = Join-Path $Root "docs\archive\wechat_qrcode"

    if (Test-Path -LiteralPath $RuntimeZipPath) {
        throw "OpenCV runtime ZIP already exists: $RuntimeZipPath. Delete it manually before rebuilding."
    }

    Remove-PathInside -Path $RuntimeStage -AllowedRoot $ReleaseDir
    New-Item -ItemType Directory -Path $RuntimeStage -Force | Out-Null

    Copy-DirectoryRequired -Source (Join-Path $SitePackages "cv2") -Destination (Join-Path $RuntimeStage "cv2")
    Copy-DirectoryRequired -Source (Join-Path $SitePackages "numpy") -Destination (Join-Path $RuntimeStage "numpy")
    $NumpyLibs = Join-Path $SitePackages "numpy.libs"
    if (Test-Path -LiteralPath $NumpyLibs) {
        Copy-Item -LiteralPath $NumpyLibs -Destination (Join-Path $RuntimeStage "numpy.libs") -Recurse
    }
    Copy-DirectoryRequired -Source $ModelSource -Destination (Join-Path $RuntimeStage "wechat_qrcode")

    $Manifest = [ordered]@{
        opencv_package_version = $ActualOpenCvPackageVersion
        numpy_version = $NumpyVersion
        platform = "win_amd64"
        model_files = @(
            "wechat_qrcode/detect.prototxt",
            "wechat_qrcode/detect.caffemodel",
            "wechat_qrcode/sr.prototxt",
            "wechat_qrcode/sr.caffemodel"
        )
    }
    $Manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $RuntimeStage "runtime.json") -Encoding UTF8

    Compress-Archive -Path (Join-Path $RuntimeStage "*") -DestinationPath $RuntimeZipPath -Force
    Remove-PathInside -Path $RuntimeStage -AllowedRoot $ReleaseDir
    Write-Host "OpenCV runtime output: $RuntimeZipPath"
    Write-Host "OpenCV runtime zip size: $(Format-SizeMb -Bytes (Get-TreeSizeBytes -Path $RuntimeZipPath))"
}

New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
if (Test-Path -LiteralPath $ZipPath) {
    throw "Release ZIP already exists: $ZipPath. Delete it manually before rebuilding."
}

if (-not $UseSystemPython) {
    $Python = Join-Path $ReleaseVenv "Scripts\python.exe"
    if (-not $SkipDependencyInstall -and -not $ReuseReleaseVenv -and (Test-Path -LiteralPath $ReleaseVenv)) {
        Remove-PathInside -Path $ReleaseVenv -AllowedRoot $Root
    }
    if (-not (Test-Path -LiteralPath $Python)) {
        & $BasePython -m venv $ReleaseVenv
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create release virtual environment with exit code $LASTEXITCODE"
        }
    }
    if (-not $SkipDependencyInstall) {
        & $Python -m pip install --upgrade pip
        if ($LASTEXITCODE -ne 0) {
            throw "pip upgrade failed with exit code $LASTEXITCODE"
        }
        & $Python -m pip install -r (Join-Path $Root "backend\requirements-packaging.txt")
        if ($LASTEXITCODE -ne 0) {
            throw "release dependency install failed with exit code $LASTEXITCODE"
        }
    }
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
Remove-OptionalDistFiles -AppRoot $DistApp
$DistSize = Get-TreeSizeBytes -Path $DistApp

Remove-PathInside -Path $StageRoot -AllowedRoot $ReleaseDir
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination (Join-Path $StageRoot "README.md")
Copy-Item -LiteralPath $DistApp -Destination $StageRoot -Recurse
Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $ZipPath -Force
Remove-PathInside -Path $StageRoot -AllowedRoot $ReleaseDir

Write-Host "Release output: $ZipPath"
Write-Host "Dist size: $(Format-SizeMb -Bytes $DistSize)"
Write-Host "Zip size: $(Format-SizeMb -Bytes (Get-TreeSizeBytes -Path $ZipPath))"

if ($BuildOpenCvRuntime) {
    New-OpenCvRuntimePackage
}
