param(
    [string]$Version = "",
    [switch]$PreviewBuild,
    [string]$PreviewSerial = "",
    [switch]$TestBuild,
    [string]$TestBuildSerial = "",
    [switch]$UseSystemPython,
    [switch]$SkipDependencyInstall,
    [switch]$ReuseReleaseVenv,
    [switch]$BuildOpenCvRuntime,
    [string]$OpenCvPackageVersion = "4.10.0.84",
    [string]$ReleaseDate = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BasePython = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$ReleaseVenv = Join-Path $Root ".release-venv"
$Python = $BasePython
$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$AppExeName = "$AppName.exe"
Push-Location $Root
try {
    $DataSchemaJson = & $BasePython -c "import json; from backend.data_schema import DATA_SCHEMA_VERSION, MIN_SUPPORTED_DATA_SCHEMA_VERSION, MAX_SUPPORTED_DATA_SCHEMA_VERSION; print(json.dumps({'data_schema_version': DATA_SCHEMA_VERSION, 'min_supported_data_schema_version': MIN_SUPPORTED_DATA_SCHEMA_VERSION, 'max_supported_data_schema_version': MAX_SUPPORTED_DATA_SCHEMA_VERSION}))"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read backend data schema version with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
$DataSchemaInfo = ($DataSchemaJson | Select-Object -Last 1) | ConvertFrom-Json
$DataSchemaVersion = [int]$DataSchemaInfo.data_schema_version
$MinSupportedDataSchemaVersion = [int]$DataSchemaInfo.min_supported_data_schema_version
$MaxSupportedDataSchemaVersion = [int]$DataSchemaInfo.max_supported_data_schema_version
$DistApp = Join-Path $Root "dist\$AppName"
$LauncherExe = Join-Path $Root "dist\$AppName-launcher.exe"
$ReleaseDir = Join-Path $Root "release"
if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = Get-Date -Format "yyyyMMdd"
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
if ($TestBuild) {
    Write-Warning "TestBuild is deprecated. Use -PreviewBuild and -PreviewSerial NNN."
    $PreviewBuild = $true
    if ([string]::IsNullOrWhiteSpace($PreviewSerial) -and -not [string]::IsNullOrWhiteSpace($TestBuildSerial)) {
        $PreviewSerial = $TestBuildSerial
    }
}
if ($PreviewBuild) {
    if ([string]::IsNullOrWhiteSpace($PreviewSerial)) {
        throw "PreviewSerial is required for preview builds, for example 001."
    }
    if ($PreviewSerial -notmatch "^\d{3}$") {
        throw "PreviewSerial must be a three-digit daily serial, for example 001."
    }
    $PreviewId = "preview-$ReleaseDate-$PreviewSerial"
    if ([string]::IsNullOrWhiteSpace($Version)) {
        $PackageVersion = $PreviewId
        $ZipFileName = "{0}-{1}.zip" -f $AppName, $PreviewId
    }
    else {
        if ($Version -notmatch "^\d+\.\d+\.\d+$") {
            throw "Version must use X.Y.Z format when binding a preview build to a target version."
        }
        $PackageVersion = "$Version-$PreviewId"
        $ZipFileName = "{0}-v{1}-{2}.zip" -f $AppName, $Version, $PreviewId
    }
    $ZipPath = Join-Path -Path $ReleaseDir -ChildPath $ZipFileName
}
else {
    if (-not [string]::IsNullOrWhiteSpace($PreviewSerial) -or -not [string]::IsNullOrWhiteSpace($TestBuildSerial)) {
        throw "PreviewSerial is only valid with -PreviewBuild."
    }
    if ([string]::IsNullOrWhiteSpace($Version)) {
        throw "Version is required for formal release builds. Use -PreviewBuild for preview packages."
    }
    if ($Version -notmatch "^\d+\.\d+\.\d+$") {
        throw "Version must use X.Y.Z format for formal release builds. Use -PreviewBuild for preview packages."
    }
    $PackageVersion = $Version
    $ZipFileName = "{0}-v{1}-{2}.zip" -f $AppName, $PackageVersion, $ReleaseDate
    $ZipPath = Join-Path -Path $ReleaseDir -ChildPath $ZipFileName
}
$StageName = ".staging-{0}-{1}" -f $PackageVersion, $ReleaseDate
$StageRoot = Join-Path -Path $ReleaseDir -ChildPath $StageName

function Remove-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot,
        [int]$MaxAttempts = 5
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $AllowedRoot).Path.TrimEnd("\")
    if ($resolvedPath -ne $resolvedRoot -and -not $resolvedPath.StartsWith("$resolvedRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside allowed root: $resolvedPath"
    }

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolvedPath -Recurse -Force
            return
        }
        catch {
            if ($attempt -ge $MaxAttempts) {
                throw
            }
            Write-Host "Remove-Item failed on attempt $attempt; retrying..."
            Start-Sleep -Seconds 2
        }
    }
}

function Compress-ArchiveWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][string]$AllowedRoot,
        [int]$MaxAttempts = 5
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            if (Test-Path -LiteralPath $DestinationPath) {
                Remove-PathInside -Path $DestinationPath -AllowedRoot $AllowedRoot
            }
            Compress-Archive -Path $SourcePath -DestinationPath $DestinationPath
            return
        }
        catch {
            if ($attempt -ge $MaxAttempts) {
                throw
            }
            Write-Host "Compress-Archive failed on attempt $attempt; retrying..."
            Start-Sleep -Seconds 2
        }
    }
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
    $ModelSource = Join-Path $Root "assets\opencv-wechat-qrcode"

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

    Compress-ArchiveWithRetry -SourcePath (Join-Path $RuntimeStage "*") -DestinationPath $RuntimeZipPath -AllowedRoot $ReleaseDir
    Remove-PathInside -Path $RuntimeStage -AllowedRoot $ReleaseDir
    Write-Host "OpenCV runtime output: $RuntimeZipPath"
    Write-Host "OpenCV runtime zip size: $(Format-SizeMb -Bytes (Get-TreeSizeBytes -Path $RuntimeZipPath))"
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $json = $Value | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
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
& $Python -m PyInstaller --clean --noconfirm (Join-Path $Root "reimbursement_launcher.spec")
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller launcher build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $DistApp)) {
    throw "PyInstaller output not found: $DistApp"
}
if (-not (Test-Path -LiteralPath $LauncherExe)) {
    throw "PyInstaller launcher output not found: $LauncherExe"
}

foreach ($name in @("data", "uploads", "logs", "browser-profile", "vendor", "window-state.json")) {
    Remove-PathInside -Path (Join-Path $DistApp $name) -AllowedRoot $DistApp
}
Remove-OptionalDistFiles -AppRoot $DistApp
$DistSize = Get-TreeSizeBytes -Path $DistApp

Remove-PathInside -Path $StageRoot -AllowedRoot $ReleaseDir
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
$StageAppRoot = Join-Path $StageRoot $AppName
$StageVersionRoot = Join-Path $StageAppRoot "versions\$PackageVersion"
New-Item -ItemType Directory -Path $StageAppRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $StageVersionRoot) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "README.md") -Destination (Join-Path $StageAppRoot "README.md")
Copy-Item -LiteralPath (Join-Path $Root "docs\zip-upgrade-guide.md") -Destination (Join-Path $StageAppRoot "zip-upgrade-guide.md")
Copy-Item -LiteralPath (Join-Path $Root "scripts\upgrade_zip_release.ps1") -Destination (Join-Path $StageAppRoot "upgrade_zip_release.ps1")
Copy-Item -LiteralPath $LauncherExe -Destination (Join-Path $StageAppRoot $AppExeName)
foreach ($item in Get-ChildItem -LiteralPath $DistApp -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $StageVersionRoot $item.Name) -Recurse -Force
}

$PortableManifest = [ordered]@{
    schema_version = 1
    package_type = "reimbursement_portable_release"
    app_version = $PackageVersion
    release_date = $ReleaseDate
    app_dir = $AppName
    launcher_path = "$AppName/$AppExeName"
    current_version_file = "$AppName/current-version.json"
    version_dir = "$AppName/versions/$PackageVersion"
    executable_path = "$AppName/versions/$PackageVersion/$AppExeName"
    data_schema_version = $DataSchemaVersion
    min_supported_data_schema_version = $MinSupportedDataSchemaVersion
    max_supported_data_schema_version = $MaxSupportedDataSchemaVersion
}
$CurrentVersion = [ordered]@{
    current_version = $PackageVersion
    release_date = $ReleaseDate
    data_schema_version = $DataSchemaVersion
    min_supported_data_schema_version = $MinSupportedDataSchemaVersion
    max_supported_data_schema_version = $MaxSupportedDataSchemaVersion
}
Write-JsonFile -Value $PortableManifest -Path (Join-Path $StageAppRoot "portable-release.json")
Write-JsonFile -Value $PortableManifest -Path (Join-Path $StageVersionRoot "portable-release.json")
Write-JsonFile -Value $CurrentVersion -Path (Join-Path $StageAppRoot "current-version.json")
Compress-ArchiveWithRetry -SourcePath (Join-Path $StageRoot "*") -DestinationPath $ZipPath -AllowedRoot $ReleaseDir
Remove-PathInside -Path $StageRoot -AllowedRoot $ReleaseDir

Write-Host "Release output: $ZipPath"
Write-Host "Dist size: $(Format-SizeMb -Bytes $DistSize)"
Write-Host "Zip size: $(Format-SizeMb -Bytes (Get-TreeSizeBytes -Path $ZipPath))"

if ($BuildOpenCvRuntime) {
    New-OpenCvRuntimePackage
}
