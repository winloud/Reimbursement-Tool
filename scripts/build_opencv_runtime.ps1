# OpenCV WeChat QRCode 可选运行时包构建脚本（阶段 8）。
#
# 从旧 build_release.ps1 拆出：OpenCV 兼容模式作为独立的可选运行时资产，
# 可供并行的 ZIP 与 Tauri 两个 Target 使用（见 ADR 0011），
# 用户下载后解压到 runtime 的 vendor/ 目录启用。
#
# 产物：release\opencv-wechat-runtime-opencv-<version>-win_amd64.zip
#   cv2/、numpy/、numpy.libs/（若存在）、wechat_qrcode/ 模型、runtime.json 清单。
#
# 用法：
#   powershell -File scripts\build_opencv_runtime.ps1
#   powershell -File scripts\build_opencv_runtime.ps1 -OpenCvPackageVersion 4.10.0.84 -SkipDependencyInstall

param(
    [string]$OpenCvPackageVersion = "4.10.0.84",
    [switch]$UseSystemPython,
    [switch]$SkipDependencyInstall,
    [switch]$ReuseReleaseVenv
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BasePython = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$ReleaseVenv = Join-Path $Root ".release-venv"
$ReleaseDir = Join-Path $Root "release"
$Python = $BasePython

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

function Normalize-ZipEntryPaths {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $normalizedPath = Join-Path `
        (Split-Path -Parent $Path) `
        (".{0}.normalized-{1}.zip" -f (Split-Path -Leaf $Path), [guid]::NewGuid().ToString("N"))
    $backupPath = Join-Path `
        (Split-Path -Parent $Path) `
        (".{0}.backup-{1}.zip" -f (Split-Path -Leaf $Path), [guid]::NewGuid().ToString("N"))
    $sourceArchive = $null
    $targetArchive = $null
    try {
        $sourceArchive = [System.IO.Compression.ZipFile]::OpenRead($Path)
        $targetArchive = [System.IO.Compression.ZipFile]::Open(
            $normalizedPath,
            [System.IO.Compression.ZipArchiveMode]::Create
        )
        foreach ($entry in $sourceArchive.Entries) {
            $entryName = $entry.FullName.Replace("\", "/")
            $targetEntry = $targetArchive.CreateEntry(
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $targetEntry.LastWriteTime = $entry.LastWriteTime
            if (-not $entryName.EndsWith("/")) {
                $sourceStream = $entry.Open()
                $targetStream = $targetEntry.Open()
                try {
                    $sourceStream.CopyTo($targetStream)
                }
                finally {
                    $targetStream.Dispose()
                    $sourceStream.Dispose()
                }
            }
        }
        $targetArchive.Dispose()
        $targetArchive = $null
        $sourceArchive.Dispose()
        $sourceArchive = $null
        [System.IO.File]::Replace($normalizedPath, $Path, $backupPath)
    }
    finally {
        if ($targetArchive) {
            $targetArchive.Dispose()
        }
        if ($sourceArchive) {
            $sourceArchive.Dispose()
        }
        Remove-PathInside -Path $normalizedPath -AllowedRoot $AllowedRoot
        Remove-PathInside -Path $backupPath -AllowedRoot $AllowedRoot
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
            Normalize-ZipEntryPaths -Path $DestinationPath -AllowedRoot $AllowedRoot
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

New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

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
    }
}

if (-not $SkipDependencyInstall) {
    & $Python -m pip install "opencv-contrib-python-headless==$OpenCvPackageVersion"
    if ($LASTEXITCODE -ne 0) {
        throw "OpenCV runtime dependency install failed with exit code $LASTEXITCODE"
    }
}

$ActualOpenCvPackageVersion = Get-PythonValue "import importlib.metadata as m; print(m.version('opencv-contrib-python-headless'))"
$NumpyVersion = Get-PythonValue "import importlib.metadata as m; print(m.version('numpy'))"
$SitePackages = Get-SitePackagesPath
$RuntimeZipName = "opencv-wechat-runtime-opencv-$ActualOpenCvPackageVersion-win_amd64.zip"
$RuntimeZipPath = Join-Path $ReleaseDir $RuntimeZipName
$RuntimeStage = Join-Path $ReleaseDir ".opencv-runtime-$ActualOpenCvPackageVersion"
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
