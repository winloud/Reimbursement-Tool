param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [string]$TagName = "",
    [string]$ExpectedCommit = "",
    [string]$ZipPath = "",
    [switch]$MetadataOnly,
    [string]$DownloadDir = "",
    [string]$OutputJson = "",
    [switch]$KeepDownload,
    [switch]$SkipOpenCvRuntimeCheck
)

$ErrorActionPreference = "Stop"

$strictVersionPattern = "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"
if ($Version -notmatch $strictVersionPattern) {
    throw "Version must use strict X.Y.Z SemVer without leading zeroes."
}
$expectedTagName = "v$Version"
if ([string]::IsNullOrWhiteSpace($TagName)) {
    $TagName = $expectedTagName
}
elseif ($TagName -cne $expectedTagName) {
    throw "TagName must be exactly $expectedTagName."
}
if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit) -and $ExpectedCommit -notmatch "^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$") {
    throw "ExpectedCommit must be a full 40- or 64-character hexadecimal Git commit ID."
}
if (-not [string]::IsNullOrWhiteSpace($ReleaseDate)) {
    if ($ReleaseDate -notmatch "^\d{8}$") {
        throw "ReleaseDate must use yyyymmdd format."
    }
    try {
        [void][DateTime]::ParseExact($ReleaseDate, "yyyyMMdd", [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        throw "ReleaseDate is not a valid calendar date: $ReleaseDate"
    }
}
if ($MetadataOnly -and -not [string]::IsNullOrWhiteSpace($ZipPath)) {
    throw "-MetadataOnly cannot be combined with -ZipPath."
}

$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$AppExeName = "$AppName.exe"
$ManifestAssetName = "release-manifest.json"
$ChecksumsAssetName = "SHA256SUMS.txt"

function ConvertTo-SizeMb {
    param([Parameter(Mandatory = $true)][double]$Bytes)
    return [math]::Round($Bytes / 1MB, 2)
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash($stream)
        return ([BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Write-JsonOutput {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [string]$Path = ""
    )

    $json = $Value | ConvertTo-Json -Depth 12
    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
    }
    Write-Output $json
}

function Assert-GhAvailable {
    & gh --version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI 'gh' is required."
    }
}

function Invoke-ReleaseAssetDownload {
    param(
        [Parameter(Mandatory = $true)][string]$Tag,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [int]$MaxAttempts = 3
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        Remove-Item -LiteralPath $ExpectedPath -Force -ErrorAction SilentlyContinue
        & gh release download $Tag --pattern $Pattern --dir $Directory --clobber
        if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $ExpectedPath) -and (Get-Item -LiteralPath $ExpectedPath).Length -gt 0) {
            return
        }
        if ($attempt -lt $MaxAttempts) {
            Write-Warning "Download attempt $attempt failed for $Pattern; retrying."
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
    throw "Failed to download $Pattern from $Tag after $MaxAttempts attempts."
}

function Get-AssetDigestSha256 {
    param([Parameter(Mandatory = $true)]$Asset)

    $digestProperty = $Asset.PSObject.Properties["digest"]
    if (-not $digestProperty -or [string]::IsNullOrWhiteSpace([string]$digestProperty.Value)) {
        return $null
    }
    $digest = [string]$digestProperty.Value
    if ($digest -notmatch "^sha256:([0-9a-fA-F]{64})$") {
        throw "GitHub asset $($Asset.name) has an unsupported or malformed digest: $digest"
    }
    return $Matches[1].ToLowerInvariant()
}

function Assert-AssetDigest {
    param(
        [Parameter(Mandatory = $true)]$Asset,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][ref]$AvailableCount,
        [Parameter(Mandatory = $true)][ref]$VerifiedCount
    )

    $githubSha256 = Get-AssetDigestSha256 -Asset $Asset
    if ($null -eq $githubSha256) {
        return
    }
    $AvailableCount.Value++
    if ($githubSha256 -cne $ExpectedSha256.ToLowerInvariant()) {
        throw "GitHub digest mismatch for $($Asset.name)."
    }
    $VerifiedCount.Value++
}

function Get-ReleaseMetadata {
    Assert-GhAvailable

    $releaseJson = & gh release view $TagName --json url,tagName,isDraft,isPrerelease,publishedAt,assets
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read GitHub Release $TagName."
    }
    $release = $releaseJson | ConvertFrom-Json
    if ($release.tagName -cne $TagName) {
        throw "GitHub Release tag is $($release.tagName), expected $TagName."
    }
    if ([bool]$release.isDraft) {
        throw "GitHub Release $TagName is still a draft."
    }
    if ([bool]$release.isPrerelease) {
        throw "GitHub Release $TagName is marked as a prerelease."
    }
    if ([string]::IsNullOrWhiteSpace([string]$release.publishedAt)) {
        throw "GitHub Release $TagName has no publishedAt timestamp."
    }
    try {
        $publishedAt = [DateTimeOffset]::Parse([string]$release.publishedAt, [Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        throw "GitHub Release $TagName has an invalid publishedAt timestamp: $($release.publishedAt)"
    }
    if ($publishedAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) {
        throw "GitHub Release $TagName has a publishedAt timestamp in the future: $($release.publishedAt)"
    }

    $escapedVersion = [regex]::Escape($Version)
    $mainAssetPattern = "^reimbursement-tool-v$escapedVersion-(\d{8})\.zip$"
    $mainAssets = @($release.assets | Where-Object { $_.name -match $mainAssetPattern })
    if ($mainAssets.Count -eq 0) {
        throw "No main release ZIP asset found for $TagName."
    }
    if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
        if ($mainAssets.Count -ne 1) {
            throw "Multiple main release ZIP assets found; provide -ReleaseDate."
        }
        [void]($mainAssets[0].name -match $mainAssetPattern)
        $script:ReleaseDate = $Matches[1]
        try {
            [void][DateTime]::ParseExact($script:ReleaseDate, "yyyyMMdd", [Globalization.CultureInfo]::InvariantCulture)
        }
        catch {
            throw "Main release ZIP contains an invalid release date: $($mainAssets[0].name)"
        }
    }

    $mainAssetName = "reimbursement-tool-v$Version-$ReleaseDate.zip"
    $mainAssetMatches = @($release.assets | Where-Object { $_.name -ceq $mainAssetName })
    if ($mainAssetMatches.Count -ne 1) {
        throw "Expected exactly one main release ZIP asset named $mainAssetName."
    }
    $mainAsset = $mainAssetMatches[0]
    if ([int64]$mainAsset.size -le 0) {
        throw "Main release ZIP asset is empty: $mainAssetName"
    }

    $runtimeAssets = @($release.assets | Where-Object { $_.name -like "opencv-wechat-runtime-*.zip" })
    if (-not $SkipOpenCvRuntimeCheck -and $runtimeAssets.Count -eq 0) {
        throw "OpenCV runtime asset is missing from $TagName."
    }
    foreach ($runtimeAsset in $runtimeAssets) {
        if ([int64]$runtimeAsset.size -le 0) {
            throw "OpenCV runtime asset is empty: $($runtimeAsset.name)"
        }
    }

    $manifestAssets = @($release.assets | Where-Object { $_.name -ceq $ManifestAssetName })
    if ($manifestAssets.Count -ne 1 -or [int64]$manifestAssets[0].size -le 0) {
        throw "GitHub Release must contain one non-empty $ManifestAssetName asset."
    }
    $checksumsAssets = @($release.assets | Where-Object { $_.name -ceq $ChecksumsAssetName })
    if ($checksumsAssets.Count -ne 1 -or [int64]$checksumsAssets[0].size -le 0) {
        throw "GitHub Release must contain one non-empty $ChecksumsAssetName asset."
    }

    return [ordered]@{
        release = $release
        published_at = $publishedAt
        main_asset = $mainAsset
        main_asset_name = $mainAssetName
        runtime_assets = $runtimeAssets
        manifest_asset = $manifestAssets[0]
        checksums_asset = $checksumsAssets[0]
    }
}

function Read-ChecksumFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $checksums = @{}
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $Path) {
        $lineNumber++
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -notmatch "^([0-9a-fA-F]{64})\s{2}(.+)$") {
            throw "Malformed checksum line $lineNumber in $ChecksumsAssetName."
        }
        $name = $Matches[2]
        if ($checksums.ContainsKey($name)) {
            throw "Duplicate checksum entry for $name."
        }
        $checksums[$name] = $Matches[1].ToLowerInvariant()
    }
    if ($checksums.Count -eq 0) {
        throw "$ChecksumsAssetName contains no checksum entries."
    }
    return $checksums
}

function Test-ReleaseIntegrity {
    param(
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)][string]$ManifestPath,
        [Parameter(Mandatory = $true)][string]$ChecksumsPath
    )

    try {
        $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
    }
    catch {
        throw "$ManifestAssetName is not valid JSON: $($_.Exception.Message)"
    }
    if ($manifest.tag -cne $TagName) {
        throw "Release manifest tag is $($manifest.tag), expected $TagName."
    }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.commit) -or [string]$manifest.commit -notmatch "^([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$") {
        throw "Release manifest commit is missing or invalid."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit) -and [string]$manifest.commit -ine $ExpectedCommit) {
        throw "Release manifest commit is $($manifest.commit), expected $ExpectedCommit."
    }
    $expectedReleaseDate = [DateTime]::ParseExact($ReleaseDate, "yyyyMMdd", [Globalization.CultureInfo]::InvariantCulture).ToString("yyyy-MM-dd")
    if ([string]$manifest.release_date -cne $expectedReleaseDate) {
        throw "Release manifest date is $($manifest.release_date), expected $expectedReleaseDate."
    }

    $manifestRecords = @($manifest.assets)
    if ($manifestRecords.Count -eq 0) {
        throw "Release manifest contains no asset records."
    }
    $recordsByName = @{}
    foreach ($record in $manifestRecords) {
        $name = [string]$record.name
        if ([string]::IsNullOrWhiteSpace($name)) {
            throw "Release manifest contains an asset record without a name."
        }
        if ($recordsByName.ContainsKey($name)) {
            throw "Release manifest contains a duplicate asset record for $name."
        }
        if ([int64]$record.size -le 0) {
            throw "Release manifest has an invalid size for $name."
        }
        if ([string]$record.sha256 -notmatch "^[0-9a-fA-F]{64}$") {
            throw "Release manifest has an invalid SHA256 for $name."
        }
        $recordsByName[$name] = $record
    }

    if (-not $recordsByName.ContainsKey($Metadata.main_asset_name)) {
        throw "Release manifest is missing the main ZIP asset record: $($Metadata.main_asset_name)"
    }
    $runtimeRecordNames = @($recordsByName.Keys | Where-Object { $_ -like "opencv-wechat-runtime-*.zip" } | Sort-Object)
    $unexpectedRecordNames = @($recordsByName.Keys | Where-Object {
        $_ -cne $Metadata.main_asset_name -and $_ -notlike "opencv-wechat-runtime-*.zip"
    })
    if ($unexpectedRecordNames.Count -gt 0) {
        throw "Release manifest contains unexpected asset records: $($unexpectedRecordNames -join ', ')"
    }
    if (-not $SkipOpenCvRuntimeCheck -and $runtimeRecordNames.Count -eq 0) {
        throw "Release manifest contains no OpenCV runtime asset record."
    }

    $targetRuntimeAssets = @()
    foreach ($runtimeName in $runtimeRecordNames) {
        $matches = @($Metadata.runtime_assets | Where-Object { $_.name -ceq $runtimeName })
        if ($matches.Count -ne 1) {
            throw "Expected exactly one GitHub runtime asset declared by the manifest: $runtimeName"
        }
        $targetRuntimeAssets += $matches[0]
    }

    $checksums = Read-ChecksumFile -Path $ChecksumsPath
    $releaseAssets = @($Metadata.main_asset) + $targetRuntimeAssets
    if ($recordsByName.Count -ne $releaseAssets.Count) {
        throw "Release manifest asset count does not match its declared main ZIP and runtime assets."
    }
    if ($checksums.Count -ne $recordsByName.Count) {
        throw "$ChecksumsAssetName entry count does not match the release manifest."
    }

    $digestAvailableCount = 0
    $digestVerifiedCount = 0
    foreach ($asset in $releaseAssets) {
        $name = [string]$asset.name
        if (-not $recordsByName.ContainsKey($name)) {
            throw "Release manifest is missing asset record: $name"
        }
        $record = $recordsByName[$name]
        if ([int64]$record.size -ne [int64]$asset.size) {
            throw "Release manifest size mismatch for $name."
        }
        $sha256 = ([string]$record.sha256).ToLowerInvariant()
        if (-not $checksums.ContainsKey($name) -or $checksums[$name] -cne $sha256) {
            throw "Checksum file mismatch for $name."
        }
        Assert-AssetDigest -Asset $asset -ExpectedSha256 $sha256 -AvailableCount ([ref]$digestAvailableCount) -VerifiedCount ([ref]$digestVerifiedCount)
    }
    foreach ($name in $checksums.Keys) {
        if (-not $recordsByName.ContainsKey($name)) {
            throw "$ChecksumsAssetName contains an unexpected asset: $name"
        }
    }

    $manifestFileSha256 = Get-FileSha256 -Path $ManifestPath
    $checksumsFileSha256 = Get-FileSha256 -Path $ChecksumsPath
    Assert-AssetDigest -Asset $Metadata.manifest_asset -ExpectedSha256 $manifestFileSha256 -AvailableCount ([ref]$digestAvailableCount) -VerifiedCount ([ref]$digestVerifiedCount)
    Assert-AssetDigest -Asset $Metadata.checksums_asset -ExpectedSha256 $checksumsFileSha256 -AvailableCount ([ref]$digestAvailableCount) -VerifiedCount ([ref]$digestVerifiedCount)

    return [ordered]@{
        checked = $true
        metadata_assets_downloaded = @($ManifestAssetName, $ChecksumsAssetName)
        main_zip_downloaded = $false
        main_zip_sha256_verified = $false
        manifest = [ordered]@{
            name = $ManifestAssetName
            size_bytes = [int64]$Metadata.manifest_asset.size
            sha256 = $manifestFileSha256
            tag = [string]$manifest.tag
            commit = [string]$manifest.commit
            release_date = [string]$manifest.release_date
            asset_count = $recordsByName.Count
        }
        checksums = [ordered]@{
            name = $ChecksumsAssetName
            size_bytes = [int64]$Metadata.checksums_asset.size
            sha256 = $checksumsFileSha256
            entry_count = $checksums.Count
        }
        release_assets_verified = $releaseAssets.Count
        verified_runtime_asset_names = $runtimeRecordNames
        github_digest_checks_available = $digestAvailableCount
        github_digest_checks_verified = $digestVerifiedCount
        manifest_checksum_consistent = $true
        expected_commit = if ([string]::IsNullOrWhiteSpace($ExpectedCommit)) { $null } else { $ExpectedCommit }
    }
}

function Resolve-ReleaseDateFromZip {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [string]::IsNullOrWhiteSpace($ReleaseDate)) {
        return
    }
    $escapedVersion = [regex]::Escape($Version)
    $zipName = Split-Path -Leaf $Path
    if ($zipName -match "^(reimbursement-tool|$([regex]::Escape($AppName)))-v$escapedVersion-(\d{8})\.zip$") {
        $script:ReleaseDate = $Matches[2]
        try {
            [void][DateTime]::ParseExact($script:ReleaseDate, "yyyyMMdd", [Globalization.CultureInfo]::InvariantCulture)
        }
        catch {
            throw "ZIP name contains an invalid release date: $zipName"
        }
        return
    }
    throw "ReleaseDate is required when ZipPath name does not contain v$Version-yyyymmdd."
}

function Test-ReleaseZipContent {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "ZIP not found: $Path"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName })
        $requiredEntries = @(
            "$AppName/README.md",
            "$AppName/zip-upgrade-guide.md",
            "$AppName/upgrade_zip_release.ps1",
            "$AppName/portable-release.json",
            "$AppName/current-version.json",
            "$AppName/$AppExeName",
            "$AppName/versions/$Version/portable-release.json",
            "$AppName/versions/$Version/$AppExeName"
        )
        $missingEntries = @($requiredEntries | Where-Object { $entries -notcontains $_ })
        $forbiddenPatterns = @(
            "/data/",
            "/uploads/",
            "/logs/",
            "/browser-profile/",
            "/vendor/",
            "/release/",
            "/test example/",
            "window-state.json"
        )
        $forbiddenEntries = @($entries | Where-Object {
            $entryName = $_
            @($forbiddenPatterns | Where-Object { $entryName -like "*$_*" }).Count -gt 0
        })

        $currentVersionEntry = $archive.GetEntry("$AppName/current-version.json")
        $portableManifestEntry = $archive.GetEntry("$AppName/portable-release.json")
        if (-not $currentVersionEntry -or -not $portableManifestEntry) {
            throw "Required manifest entries are missing."
        }

        $reader = New-Object System.IO.StreamReader($currentVersionEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $currentVersion = $reader.ReadToEnd() | ConvertFrom-Json
        }
        finally {
            $reader.Dispose()
        }
        $reader = New-Object System.IO.StreamReader($portableManifestEntry.Open(), [System.Text.Encoding]::UTF8)
        try {
            $portableManifest = $reader.ReadToEnd() | ConvertFrom-Json
        }
        finally {
            $reader.Dispose()
        }

        if ($currentVersion.current_version -ne $Version) {
            throw "current-version.json has $($currentVersion.current_version), expected $Version."
        }
        if ($portableManifest.app_version -ne $Version) {
            throw "portable-release.json has $($portableManifest.app_version), expected $Version."
        }
        if ($portableManifest.package_type -ne "reimbursement_portable_release") {
            throw "portable-release.json package_type is $($portableManifest.package_type)."
        }
        if ($portableManifest.distribution_target -cne "zip" -or $currentVersion.distribution_target -cne "zip") {
            throw "ZIP manifests must declare distribution_target=zip."
        }
        if ([string]$portableManifest.commit -notmatch "^[0-9a-fA-F]{40}$") {
            throw "portable-release.json must contain a full Git commit ID."
        }
        if ($portableManifest.commit -cne $currentVersion.commit) {
            throw "ZIP manifest commit values do not match."
        }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit) -and $portableManifest.commit -cne $ExpectedCommit.ToLowerInvariant()) {
            throw "ZIP manifest commit does not match ExpectedCommit."
        }
        if ($missingEntries.Count -gt 0) {
            throw "Missing required ZIP entries: $($missingEntries -join ', ')"
        }
        if ($forbiddenEntries.Count -gt 0) {
            throw "Forbidden runtime ZIP entries found: $($forbiddenEntries -join ', ')"
        }

        return [ordered]@{
            zip = [ordered]@{
                path = $Path
                size_bytes = (Get-Item -LiteralPath $Path).Length
                size_mb = ConvertTo-SizeMb -Bytes (Get-Item -LiteralPath $Path).Length
                entry_count = $entries.Count
                content_checked = $true
                missing_required_entries = $missingEntries
                forbidden_entries = $forbiddenEntries
            }
            manifest = [ordered]@{
                distribution_target = $portableManifest.distribution_target
                commit = $portableManifest.commit
                current_version = $currentVersion.current_version
                app_version = $portableManifest.app_version
                data_schema_version = $portableManifest.data_schema_version
                min_supported_data_schema_version = $portableManifest.min_supported_data_schema_version
                max_supported_data_schema_version = $portableManifest.max_supported_data_schema_version
                supported_range = "$($portableManifest.min_supported_data_schema_version)-$($portableManifest.max_supported_data_schema_version)"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}

function New-MetadataOnlyContentResult {
    return [ordered]@{
        zip = [ordered]@{
            path = $null
            size_bytes = $null
            size_mb = $null
            entry_count = $null
            content_checked = $false
            missing_required_entries = @()
            forbidden_entries = @()
        }
        manifest = [ordered]@{
            current_version = $null
            app_version = $null
            data_schema_version = $null
            min_supported_data_schema_version = $null
            max_supported_data_schema_version = $null
            supported_range = $null
        }
    }
}

function New-ValidationResult {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        $Release = $null,
        $MainAsset = $null,
        [array]$RuntimeAssets = @(),
        [Parameter(Mandatory = $true)]$Content,
        $Integrity = $null
    )

    $mainAssetName = if ($MainAsset) { $MainAsset.name } else { Split-Path -Leaf $Content.zip.path }
    $mainAssetSizeBytes = if ($MainAsset) { [int64]$MainAsset.size } else { [int64]$Content.zip.size_bytes }

    return [ordered]@{
        ok = $true
        source = $Source
        version = $Version
        tag_name = if ($Release) { $Release.tagName } else { $TagName }
        release_date = $ReleaseDate
        release_url = if ($Release) { $Release.url } else { $null }
        is_draft = if ($Release) { [bool]$Release.isDraft } else { $null }
        is_prerelease = if ($Release) { [bool]$Release.isPrerelease } else { $null }
        published_at = if ($Release) { $Release.publishedAt } else { $null }
        release_health_verified = [bool]$Release
        main_asset = [ordered]@{
            name = $mainAssetName
            size_bytes = $mainAssetSizeBytes
            size_mb = ConvertTo-SizeMb -Bytes ([double]$mainAssetSizeBytes)
        }
        opencv_runtime_assets = @($RuntimeAssets | ForEach-Object {
            [ordered]@{
                name = $_.name
                size_bytes = [int64]$_.size
                size_mb = ConvertTo-SizeMb -Bytes ([double]$_.size)
            }
        })
        integrity = if ($Integrity) { $Integrity } else {
            [ordered]@{
                checked = $false
                metadata_assets_downloaded = @()
                main_zip_downloaded = $false
                main_zip_sha256_verified = $false
            }
        }
        zip = $Content.zip
        manifest = $Content.manifest
    }
}

if (-not [string]::IsNullOrWhiteSpace($ZipPath)) {
    Resolve-ReleaseDateFromZip -Path $ZipPath
    $resolvedZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
    $content = Test-ReleaseZipContent -Path $resolvedZipPath
    $result = New-ValidationResult -Source "local_zip" -Content $content
    Write-JsonOutput -Value $result -Path $OutputJson
    return
}

$metadata = Get-ReleaseMetadata
$createdTempDir = $false
if ([string]::IsNullOrWhiteSpace($DownloadDir)) {
    $DownloadDir = Join-Path $env:TEMP ("reimbursement-release-asset-" + [guid]::NewGuid().ToString("N"))
    $createdTempDir = $true
}
New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null

$manifestPath = Join-Path $DownloadDir $ManifestAssetName
$checksumsPath = Join-Path $DownloadDir $ChecksumsAssetName
$downloadedZipPath = Join-Path $DownloadDir $metadata.main_asset_name
try {
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $ManifestAssetName -Directory $DownloadDir -ExpectedPath $manifestPath
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $ChecksumsAssetName -Directory $DownloadDir -ExpectedPath $checksumsPath
    $integrity = Test-ReleaseIntegrity -Metadata $metadata -ManifestPath $manifestPath -ChecksumsPath $checksumsPath
    $verifiedRuntimeAssets = @($metadata.runtime_assets | Where-Object { $integrity.verified_runtime_asset_names -contains $_.name })

    if ($MetadataOnly) {
        $content = New-MetadataOnlyContentResult
        $result = New-ValidationResult -Source "github_release_metadata" -Release $metadata.release -MainAsset $metadata.main_asset -RuntimeAssets $verifiedRuntimeAssets -Content $content -Integrity $integrity
        Write-JsonOutput -Value $result -Path $OutputJson
        return
    }

    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $metadata.main_asset_name -Directory $DownloadDir -ExpectedPath $downloadedZipPath
    $mainRecord = @((Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).assets | Where-Object { $_.name -ceq $metadata.main_asset_name })[0]
    $downloadedMainSha256 = Get-FileSha256 -Path $downloadedZipPath
    if ($downloadedMainSha256 -cne ([string]$mainRecord.sha256).ToLowerInvariant()) {
        throw "Downloaded main release ZIP SHA256 does not match the release manifest."
    }
    $integrity.main_zip_downloaded = $true
    $integrity.main_zip_sha256_verified = $true
    $content = Test-ReleaseZipContent -Path $downloadedZipPath
    $result = New-ValidationResult -Source "github_release_download" -Release $metadata.release -MainAsset $metadata.main_asset -RuntimeAssets $verifiedRuntimeAssets -Content $content -Integrity $integrity
    Write-JsonOutput -Value $result -Path $OutputJson
}
finally {
    if ($createdTempDir -and -not $KeepDownload -and (Test-Path -LiteralPath $DownloadDir)) {
        $resolvedDownloadDir = (Resolve-Path -LiteralPath $DownloadDir).Path
        $resolvedTemp = (Resolve-Path -LiteralPath $env:TEMP).Path.TrimEnd("\")
        if ($resolvedDownloadDir.StartsWith("$resolvedTemp\", [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedDownloadDir -Recurse -Force
        }
    }
}
