param(
    [Parameter(Mandatory = $true)][string]$OldAppDir,
    [Parameter(Mandatory = $true)][string]$NewAppDir,
    [string]$BackupDir = "",
    [switch]$AllowExistingRuntimeOverwrite
)

$ErrorActionPreference = "Stop"

$RuntimeDirsToBackup = @("data", "uploads", "vendor", "logs", "browser-profile")
$RuntimeDirsToCopy = @("data", "uploads", "vendor")
$RuntimeFilesToBackup = @("window-state.json")
$RuntimeFilesToCopy = @("window-state.json")
$AppBaseName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$AppExeName = "$AppBaseName.exe"

function Resolve-ExistingDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Directory not found: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Assert-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $AllowedRoot).Path.TrimEnd("\")
    if ($resolvedPath -ne $resolvedRoot -and -not $resolvedPath.StartsWith("$resolvedRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside allowed root: $resolvedPath"
    }
    return $resolvedPath
}

function Remove-PathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $resolvedPath = Assert-PathInside -Path $Path -AllowedRoot $AllowedRoot
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Assert-AppDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $exePath = Join-Path $Path $AppExeName
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        throw "$Label is not a valid app directory. Missing: $exePath"
    }
}

function Assert-AppNotRunning {
    $running = Get-Process -Name $AppBaseName -ErrorAction SilentlyContinue
    if ($running) {
        throw "报销管理.exe is running. Close the app before upgrading."
    }
}

function New-BackupManifest {
    param(
        [Parameter(Mandatory = $true)][string]$OldApp,
        [Parameter(Mandatory = $true)][string]$NewApp
    )

    return [ordered]@{
        schema_version = 1
        created_at = (Get-Date).ToUniversalTime().ToString("o")
        reason = "zip_upgrade"
        old_app_dir = $OldApp
        new_app_dir = $NewApp
        copied_runtime_dirs = $RuntimeDirsToCopy
        backed_up_runtime_dirs = $RuntimeDirsToBackup
        copied_runtime_files = $RuntimeFilesToCopy
        backed_up_runtime_files = $RuntimeFilesToBackup
    }
}

$OldApp = Resolve-ExistingDirectory -Path $OldAppDir
$NewApp = Resolve-ExistingDirectory -Path $NewAppDir
if ($OldApp -eq $NewApp) {
    throw "OldAppDir and NewAppDir must be different directories."
}

Assert-AppDirectory -Path $OldApp -Label "OldAppDir"
Assert-AppDirectory -Path $NewApp -Label "NewAppDir"
Assert-AppNotRunning

if ([string]::IsNullOrWhiteSpace($BackupDir)) {
    $BackupDir = Join-Path (Split-Path -Parent $OldApp) "$AppBaseName-upgrade-backups"
}
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$BackupRoot = (Resolve-Path -LiteralPath $BackupDir).Path

$Timestamp = Get-Date -Format "yyyyMMddHHmmss"
$BackupZip = Join-Path $BackupRoot "zip-upgrade-backup-$Timestamp.zip"
if (Test-Path -LiteralPath $BackupZip) {
    throw "Backup ZIP already exists: $BackupZip"
}

$StageRoot = Join-Path $BackupRoot ".staging-$Timestamp"
Remove-PathInside -Path $StageRoot -AllowedRoot $BackupRoot
New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null

try {
    foreach ($name in $RuntimeDirsToBackup) {
        $source = Join-Path $OldApp $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $StageRoot $name) -Recurse
        }
    }
    foreach ($name in $RuntimeFilesToBackup) {
        $source = Join-Path $OldApp $name
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $StageRoot $name)
        }
    }
    New-BackupManifest -OldApp $OldApp -NewApp $NewApp |
        ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath (Join-Path $StageRoot "backup-manifest.json") -Encoding UTF8

    Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $BackupZip
}
finally {
    Remove-PathInside -Path $StageRoot -AllowedRoot $BackupRoot
}

foreach ($name in $RuntimeDirsToCopy) {
    $source = Join-Path $OldApp $name
    if (-not (Test-Path -LiteralPath $source)) {
        continue
    }

    $target = Join-Path $NewApp $name
    if (Test-Path -LiteralPath $target) {
        if (-not $AllowExistingRuntimeOverwrite) {
            throw "Target runtime directory already exists: $target. Re-run with -AllowExistingRuntimeOverwrite only after confirming it is safe."
        }
        Remove-PathInside -Path $target -AllowedRoot $NewApp
    }
    Copy-Item -LiteralPath $source -Destination $target -Recurse
}

foreach ($name in $RuntimeFilesToCopy) {
    $source = Join-Path $OldApp $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        continue
    }

    $target = Join-Path $NewApp $name
    if (Test-Path -LiteralPath $target) {
        if (-not $AllowExistingRuntimeOverwrite) {
            throw "Target runtime file already exists: $target. Re-run with -AllowExistingRuntimeOverwrite only after confirming it is safe."
        }
        Remove-PathInside -Path $target -AllowedRoot $NewApp
    }
    Copy-Item -LiteralPath $source -Destination $target
}

Write-Host "Upgrade runtime copy completed."
Write-Host "Backup ZIP: $BackupZip"
Write-Host "New app EXE: $(Join-Path $NewApp $AppExeName)"
