# Unified formal-release entrypoint. ZIP and Tauri keep their own builders and
# validators; this script supplies one immutable build context and isolated paths.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Zip", "Tauri", "All")]
    [string]$Target,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [ValidateSet("ZipFirst", "TauriFirst")][string]$BuildOrder = "ZipFirst",
    [string]$OutputRoot = "",
    [string]$Python = "python",
    [switch]$UseSystemPython,
    [switch]$SkipDependencyInstall,
    [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($Version -notmatch "^\d+\.\d+\.\d+$") { throw "Version must use X.Y.Z format." }
if ([string]::IsNullOrWhiteSpace($ReleaseDate)) { $ReleaseDate = Get-Date -Format "yyyyMMdd" }
if ($ReleaseDate -notmatch "^\d{8}$") { throw "ReleaseDate must use yyyymmdd format." }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $Root "artifacts" }
elseif (-not [IO.Path]::IsPathRooted($OutputRoot)) { $OutputRoot = Join-Path $Root $OutputRoot }
$CommitSha = (& git -C $Root rev-parse HEAD | Select-Object -Last 1).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $CommitSha -notmatch "^[0-9a-f]{40}$") { throw "Unable to resolve a full Git commit SHA." }

$ZipOutput = Join-Path $OutputRoot "zip"
$TauriOnlineOutput = Join-Path $OutputRoot "tauri\online"
$TauriOfflineOutput = Join-Path $OutputRoot "tauri\offline"
$TauriFeedOutput = Join-Path $OutputRoot "tauri\updater"
$BuildRoot = Join-Path $OutputRoot ".build"

function Invoke-Script {
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object[]]$Arguments)
    Write-Host "==> $Name"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $Path @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

function Remove-IsolatedDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    $rootFull = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\') + '\'
    $pathFull = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or $pathFull -eq $rootFull) { throw "Refusing to remove path outside isolated output root: $Path" }
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

function Build-ZipTarget {
    Remove-IsolatedDirectory $ZipOutput
    Remove-IsolatedDirectory (Join-Path $BuildRoot "zip")
    $args = @("-Version", $Version, "-ReleaseDate", $ReleaseDate, "-OutputDir", $ZipOutput, "-IntermediateRoot", (Join-Path $BuildRoot "zip"), "-CommitSha", $CommitSha)
    if ($UseSystemPython) { $args += "-UseSystemPython" }
    if ($SkipDependencyInstall) { $args += "-SkipDependencyInstall" }
    Invoke-Script "Build ZIP target" (Join-Path $PSScriptRoot "build_release.ps1") $args
    $zips = @(Get-ChildItem -LiteralPath $ZipOutput -Filter "*.zip" | Where-Object { $_.Name -notlike "opencv-wechat-runtime-*" })
    if ($zips.Count -ne 1) { throw "Expected exactly one ZIP release artifact, found $($zips.Count)." }
    Invoke-Script "Validate ZIP target" (Join-Path $PSScriptRoot "validate_zip_release.ps1") @("-Version", $Version, "-ReleaseDate", $ReleaseDate, "-ExpectedCommit", $CommitSha, "-ZipPath", $zips[0].FullName, "-SkipOpenCvRuntimeCheck")
}

function Build-TauriVariant {
    param([Parameter(Mandatory = $true)][ValidateSet("online", "offline")][string]$Variant)
    $isOffline = $Variant -eq "offline"
    $output = if ($isOffline) { $TauriOfflineOutput } else { $TauriOnlineOutput }
    $intermediate = Join-Path $BuildRoot "tauri\$Variant"
    Remove-IsolatedDirectory $output
    Remove-IsolatedDirectory $intermediate
    if (-not $isOffline) { Remove-IsolatedDirectory $TauriFeedOutput }
    $args = @("-Version", $Version, "-ReleaseDate", $ReleaseDate, "-Python", $Python, "-OutputDir", $output, "-IntermediateRoot", $intermediate, "-FeedOutputDir", $TauriFeedOutput, "-CommitSha", $CommitSha, "-RequireSignature")
    if ($isOffline) { $args += @("-Offline", "-SkipFeed") }
    Invoke-Script "Build Tauri $Variant target" (Join-Path $PSScriptRoot "build_tauri_release.ps1") $args
    $validate = @("-Version", $Version, "-ReleaseDate", $ReleaseDate, "-BundleDir", $output, "-BuildContextPath", (Join-Path $output "build-context.json"), "-ExpectedCommit", $CommitSha, "-ExpectedVariant", $Variant)
    if ($isOffline) { $validate += "-SkipFeed" } else { $validate += @("-FeedDir", $TauriFeedOutput) }
    Invoke-Script "Validate Tauri $Variant target" (Join-Path $PSScriptRoot "validate_tauri_release.ps1") $validate
}

function Build-TauriTarget {
    Build-TauriVariant "online"
    Build-TauriVariant "offline"
}

$targets = if ($Target -eq "All") {
    if ($BuildOrder -eq "TauriFirst") { @("Tauri", "Zip") } else { @("Zip", "Tauri") }
} else { @($Target) }

Write-Host "Dual-target release plan"
Write-Host "  target:       $Target"
Write-Host "  order:        $($targets -join ' -> ')"
Write-Host "  version:      $Version"
Write-Host "  release date: $ReleaseDate"
Write-Host "  commit:       $CommitSha"
Write-Host "  output root:  $OutputRoot"
if ($PlanOnly) { return }

$trackedChanges = @(git -C $Root status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Git worktree." }
if ($trackedChanges.Count -gt 0) { throw "Formal target builds require a clean tracked worktree." }

foreach ($item in $targets) {
    if ($item -eq "Zip") { Build-ZipTarget } else { Build-TauriTarget }
}

$context = [ordered]@{
    schema_version = 1
    version = $Version
    commit = $CommitSha
    release_date = $ReleaseDate
    targets = $targets
}
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $OutputRoot "build-context.json"), ($context | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
Write-Host "=== Dual-target release build complete ==="
