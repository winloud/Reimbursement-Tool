# Validate one isolated Tauri installer variant and, for online release builds,
# its updater feed. Preview validation may explicitly allow unsigned output.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [string]$BundleDir = "",
    [string]$FeedDir = "",
    [string]$BuildContextPath = "",
    [string]$ExpectedCommit = "",
    [ValidateSet("online", "offline")][string]$ExpectedVariant = "online",
    [switch]$AllowUnsigned,
    [switch]$SkipFeed
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ($Version -notmatch "^\d+\.\d+\.\d+$") { throw "Version must use X.Y.Z format." }
if (-not [string]::IsNullOrWhiteSpace($ReleaseDate) -and $ReleaseDate -notmatch "^\d{8}$") { throw "ReleaseDate must use yyyymmdd format." }
if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit) -and $ExpectedCommit -notmatch "^[0-9a-fA-F]{40}$") { throw "ExpectedCommit must be a full 40-character Git commit ID." }
if ([string]::IsNullOrWhiteSpace($BundleDir)) { $BundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis" }
if ([string]::IsNullOrWhiteSpace($FeedDir)) { $FeedDir = Join-Path $Root "dist-feed" }
if ([string]::IsNullOrWhiteSpace($BuildContextPath)) { $BuildContextPath = Join-Path $BundleDir "build-context.json" }

function Assert-FileExists {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Description)
    if (-not (Test-Path -LiteralPath $Path)) { throw "$Description does not exist: $Path" }
    return Get-Item -LiteralPath $Path
}
function Assert-JsonField {
    param($Object, [Parameter(Mandatory = $true)][string]$Field, [Parameter(Mandatory = $true)][string]$Description)
    $value = $Object.$Field
    if ($null -eq $value -or ([string]::IsNullOrWhiteSpace([string]$value) -and $value -ne 0)) { throw "$Description is missing $Field" }
}
function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [IO.File]::OpenRead($Path); $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

$setups = @(Get-ChildItem -LiteralPath $BundleDir -Filter "*-setup*.exe" -ErrorAction SilentlyContinue)
if ($setups.Count -ne 1) { throw "Expected exactly one NSIS setup artifact in $BundleDir, found $($setups.Count)." }
$setup = $setups[0]
if ($ExpectedVariant -eq "offline" -and $setup.Name -notlike "*-offline.exe") { throw "Offline artifact name must end with -offline.exe." }
if ($ExpectedVariant -eq "online" -and $setup.Name -like "*-offline.exe") { throw "Online artifact cannot use the offline suffix." }

$context = Get-Content -Raw -Encoding UTF8 -LiteralPath (Assert-FileExists $BuildContextPath "Build context") | ConvertFrom-Json
foreach ($field in @("schema_version", "distribution_target", "version", "commit", "release_date", "build_mode", "variant")) { Assert-JsonField $context $field "build-context.json" }
if ($context.distribution_target -cne "tauri") { throw "Build context target is $($context.distribution_target), expected tauri." }
if ($context.version -cne $Version) { throw "Build context version is $($context.version), expected $Version." }
if ($context.variant -cne $ExpectedVariant) { throw "Build context variant is $($context.variant), expected $ExpectedVariant." }
if ($ReleaseDate -and $context.release_date -cne $ReleaseDate) { throw "Build context release date is $($context.release_date), expected $ReleaseDate." }
if ($ExpectedCommit -and $context.commit -cne $ExpectedCommit.ToLowerInvariant()) { throw "Build context commit does not match ExpectedCommit." }

$sigPath = "$($setup.FullName).sig"
if (-not $AllowUnsigned) {
    $sig = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Assert-FileExists $sigPath "Updater signature")).Trim()
    if ($sig.Length -lt 100) { throw "Signature is too short: $sigPath" }
    try { $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sig)) } catch { throw "Signature is not valid base64: $sigPath" }
    if (-not $decoded.StartsWith("untrusted comment:")) { throw "Decoded signature is not minisign format." }
}

if (-not $SkipFeed) {
    if ($AllowUnsigned) { throw "Unsigned validation cannot require an updater feed." }
    $latestPath = (Assert-FileExists (Join-Path $FeedDir "latest.json") "latest.json").FullName
    $compatPath = (Assert-FileExists (Join-Path $FeedDir "data-compat.json") "data-compat.json").FullName
    $latest = Get-Content -Raw -Encoding UTF8 -LiteralPath $latestPath | ConvertFrom-Json
    if ($latest.version -cne $Version) { throw "latest.json version is $($latest.version), expected $Version." }
    $platform = $latest.platforms."windows-x86_64"
    if (-not $platform) { throw "latest.json is missing windows-x86_64." }
    $sigContent = (Get-Content -Raw -Encoding UTF8 -LiteralPath $sigPath).Trim()
    if ([string]$platform.signature -cne $sigContent) { throw "latest.json signature differs from the installer signature." }
    $compat = Get-Content -Raw -Encoding UTF8 -LiteralPath $compatPath | ConvertFrom-Json
    if ([int]$compat.min_data_schema_version -gt [int]$compat.max_data_schema_version) { throw "Invalid data schema compatibility range." }
}

Write-Host "=== Tauri validation passed ==="
Write-Host "target:  tauri/$ExpectedVariant"
Write-Host "version: $Version"
Write-Host "commit:  $($context.commit)"
Write-Host "setup:   $($setup.FullName)"
Write-Host "sha256:  $(Get-FileSha256 $setup.FullName)"
