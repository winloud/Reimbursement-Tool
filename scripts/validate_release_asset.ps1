# 校验已发布的 GitHub Release 资产（v2.0.0 起为 Tauri NSIS + updater feed）。
#
# 与 validate_tauri_release.ps1 的分工：
#   - validate_tauri_release.ps1 校验本地 cargo tauri build 的产物（发布前）。
#   - 本脚本校验 GitHub Release 上已公开的资产、manifest 和 checksum（发布后），
#     由 scripts/release_publish.ps1 在发布状态机中调用。
#
# 阶段 8 随便携 ZIP 链路一并改造：主资产从 报销管理-vX.Y.Z-yyyymmdd.zip 改为
# NSIS setup exe，并新增更新包签名（.sig）、latest.json、data-compat.json 的校验。

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [string]$TagName = "",
    [string]$ExpectedCommit = "",
    [switch]$MetadataOnly,
    [string]$DownloadDir = "",
    [string]$OutputJson = "",
    [switch]$KeepDownload,
    [switch]$SkipOpenCvRuntimeCheck
)

$ErrorActionPreference = "Stop"

# gh 以 UTF-8 输出 JSON，而 Windows PowerShell 默认按控制台 OEM 代码页解码子进程 stdout。
# 中文 Windows（CP936）上这会把安装包名 报销管理_X.Y.Z_x64-setup.exe 解成乱码，
# 后续按名字比对 manifest/checksum 的断言就会全部错位。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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

$ManifestAssetName = "release-manifest.json"
$ChecksumsAssetName = "SHA256SUMS.txt"
$LatestFeedAssetName = "latest.json"
$CompatFeedAssetName = "data-compat.json"
$UpdaterPlatformKey = "windows-x86_64"

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

    # 主资产：NSIS 安装包。产物名由 Tauri 生成（productName_version_arch-setup.exe），
    # 离线包带 -offline 后缀，两者都可作为主资产发布。
    $installerAssets = @($release.assets | Where-Object { $_.name -like "*-setup.exe" -or $_.name -like "*-setup-offline.exe" })
    if ($installerAssets.Count -eq 0) {
        throw "No NSIS installer asset found for $TagName."
    }
    foreach ($installerAsset in $installerAssets) {
        if ([int64]$installerAsset.size -le 0) {
            throw "NSIS installer asset is empty: $($installerAsset.name)"
        }
        if ([string]$installerAsset.name -notmatch [regex]::Escape($Version)) {
            throw "NSIS installer asset does not carry version $Version : $($installerAsset.name)"
        }
    }

    # 每个安装包都必须带 updater 签名，否则客户端无法验签升级。
    $signatureNames = @($release.assets | Where-Object { $_.name -like "*.sig" } | ForEach-Object { $_.name })
    foreach ($installerAsset in $installerAssets) {
        $expectedSignature = "$($installerAsset.name).sig"
        if ($signatureNames -notcontains $expectedSignature) {
            throw "Updater signature asset is missing: $expectedSignature"
        }
    }

    $feedAssets = @{}
    foreach ($feedName in @($LatestFeedAssetName, $CompatFeedAssetName)) {
        $matched = @($release.assets | Where-Object { $_.name -ceq $feedName })
        if ($matched.Count -ne 1 -or [int64]$matched[0].size -le 0) {
            throw "GitHub Release must contain one non-empty $feedName asset."
        }
        $feedAssets[$feedName] = $matched[0]
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

    $signatureAssets = @($release.assets | Where-Object { $_.name -like "*-setup.exe.sig" -or $_.name -like "*-setup-offline.exe.sig" })
    $primaryInstaller = @($installerAssets | Sort-Object name | Select-Object -First 1)[0]

    return [ordered]@{
        release = $release
        published_at = $publishedAt
        installer_assets = $installerAssets
        primary_installer = $primaryInstaller
        signature_assets = $signatureAssets
        feed_assets = $feedAssets
        runtime_assets = $runtimeAssets
        manifest_asset = $manifestAssets[0]
        checksums_asset = $checksumsAssets[0]
    }
}

function Read-ChecksumFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $checksums = @{}
    $lineNumber = 0
    foreach ($line in Get-Content -Encoding UTF8 -LiteralPath $Path) {
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
        $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $ManifestPath | ConvertFrom-Json
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
    if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
        if ([string]$manifest.release_date -notmatch "^\d{4}-\d{2}-\d{2}$") {
            throw "Release manifest date is missing or malformed: $($manifest.release_date)"
        }
        $script:ReleaseDate = ([DateTime]::ParseExact([string]$manifest.release_date, "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)).ToString("yyyyMMdd")
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

    # 目标资产集合：安装包 + 其签名 + updater feed + 可选 OpenCV runtime。
    $releaseAssets = @()
    $releaseAssets += @($Metadata.installer_assets)
    $releaseAssets += @($Metadata.signature_assets)
    $releaseAssets += @($Metadata.feed_assets[$LatestFeedAssetName], $Metadata.feed_assets[$CompatFeedAssetName])
    $runtimeRecordNames = @($recordsByName.Keys | Where-Object { $_ -like "opencv-wechat-runtime-*.zip" } | Sort-Object)
    foreach ($runtimeName in $runtimeRecordNames) {
        $matched = @($Metadata.runtime_assets | Where-Object { $_.name -ceq $runtimeName })
        if ($matched.Count -ne 1) {
            throw "Expected exactly one GitHub runtime asset declared by the manifest: $runtimeName"
        }
        $releaseAssets += $matched[0]
    }
    if (-not $SkipOpenCvRuntimeCheck -and $runtimeRecordNames.Count -eq 0) {
        throw "Release manifest contains no OpenCV runtime asset record."
    }

    $expectedNames = @($releaseAssets | ForEach-Object { [string]$_.name })
    $unexpectedRecordNames = @($recordsByName.Keys | Where-Object { $expectedNames -notcontains $_ })
    if ($unexpectedRecordNames.Count -gt 0) {
        throw "Release manifest contains unexpected asset records: $($unexpectedRecordNames -join ', ')"
    }

    $checksums = Read-ChecksumFile -Path $ChecksumsPath
    if ($recordsByName.Count -ne $releaseAssets.Count) {
        throw "Release manifest asset count does not match its declared installer, signature, feed and runtime assets."
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
        installer_downloaded = $false
        installer_sha256_verified = $false
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

function Test-UpdaterFeed {
    param(
        [Parameter(Mandatory = $true)][string]$LatestPath,
        [Parameter(Mandatory = $true)][string]$CompatPath,
        [Parameter(Mandatory = $true)]$Metadata
    )

    try {
        $latest = Get-Content -Raw -Encoding UTF8 -LiteralPath $LatestPath | ConvertFrom-Json
    }
    catch {
        throw "$LatestFeedAssetName is not valid JSON: $($_.Exception.Message)"
    }
    if ([string]$latest.version -cne $Version) {
        throw "$LatestFeedAssetName version is $($latest.version), expected $Version."
    }
    if ([string]::IsNullOrWhiteSpace([string]$latest.pub_date)) {
        throw "$LatestFeedAssetName is missing pub_date."
    }
    $platform = $latest.platforms.$UpdaterPlatformKey
    if (-not $platform) {
        throw "$LatestFeedAssetName is missing platform $UpdaterPlatformKey."
    }
    if ([string]::IsNullOrWhiteSpace([string]$platform.signature)) {
        throw "$LatestFeedAssetName platform $UpdaterPlatformKey has an empty signature."
    }
    $updateUrl = [string]$platform.url
    if ([string]::IsNullOrWhiteSpace($updateUrl)) {
        throw "$LatestFeedAssetName platform $UpdaterPlatformKey has an empty url."
    }
    if ($updateUrl -notlike "*/download/$TagName/*") {
        throw "$LatestFeedAssetName update url does not point at $TagName : $updateUrl"
    }
    $urlAssetName = [System.Uri]::UnescapeDataString(($updateUrl -split "/")[-1])
    $installerNames = @($Metadata.installer_assets | ForEach-Object { [string]$_.name })
    if ($installerNames -notcontains $urlAssetName) {
        throw "$LatestFeedAssetName update url asset $urlAssetName is not published on $TagName."
    }

    try {
        $compat = Get-Content -Raw -Encoding UTF8 -LiteralPath $CompatPath | ConvertFrom-Json
    }
    catch {
        throw "$CompatFeedAssetName is not valid JSON: $($_.Exception.Message)"
    }
    $minSchema = [int]$compat.min_data_schema_version
    $maxSchema = [int]$compat.max_data_schema_version
    if ($minSchema -le 0 -or $maxSchema -le 0) {
        throw "$CompatFeedAssetName declares a non-positive data schema range."
    }
    if ($minSchema -gt $maxSchema) {
        throw "$CompatFeedAssetName min_data_schema_version ($minSchema) is greater than max ($maxSchema)."
    }

    return [ordered]@{
        checked = $true
        latest_version = [string]$latest.version
        pub_date = [string]$latest.pub_date
        platform = $UpdaterPlatformKey
        update_asset_name = $urlAssetName
        signature_present = $true
        min_data_schema_version = $minSchema
        max_data_schema_version = $maxSchema
    }
}

function New-ValidationResult {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)]$Feed,
        $Integrity = $null
    )

    $release = $Metadata.release
    return [ordered]@{
        ok = $true
        source = $Source
        version = $Version
        tag_name = $release.tagName
        release_date = $ReleaseDate
        release_url = $release.url
        is_draft = [bool]$release.isDraft
        is_prerelease = [bool]$release.isPrerelease
        published_at = $release.publishedAt
        release_health_verified = $true
        installers = @($Metadata.installer_assets | ForEach-Object {
            [ordered]@{
                name = $_.name
                size_bytes = [int64]$_.size
                size_mb = ConvertTo-SizeMb -Bytes ([double]$_.size)
            }
        })
        signatures = @($Metadata.signature_assets | ForEach-Object { $_.name })
        opencv_runtime_assets = @($Metadata.runtime_assets | ForEach-Object {
            [ordered]@{
                name = $_.name
                size_bytes = [int64]$_.size
                size_mb = ConvertTo-SizeMb -Bytes ([double]$_.size)
            }
        })
        updater_feed = $Feed
        integrity = if ($Integrity) { $Integrity } else {
            [ordered]@{
                checked = $false
                metadata_assets_downloaded = @()
                installer_downloaded = $false
                installer_sha256_verified = $false
            }
        }
    }
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
$latestPath = Join-Path $DownloadDir $LatestFeedAssetName
$compatPath = Join-Path $DownloadDir $CompatFeedAssetName
$installerName = [string]$metadata.primary_installer.name
$downloadedInstallerPath = Join-Path $DownloadDir $installerName
try {
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $ManifestAssetName -Directory $DownloadDir -ExpectedPath $manifestPath
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $ChecksumsAssetName -Directory $DownloadDir -ExpectedPath $checksumsPath
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $LatestFeedAssetName -Directory $DownloadDir -ExpectedPath $latestPath
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $CompatFeedAssetName -Directory $DownloadDir -ExpectedPath $compatPath
    $integrity = Test-ReleaseIntegrity -Metadata $metadata -ManifestPath $manifestPath -ChecksumsPath $checksumsPath
    $feed = Test-UpdaterFeed -LatestPath $latestPath -CompatPath $compatPath -Metadata $metadata

    if ($MetadataOnly) {
        $result = New-ValidationResult -Source "github_release_metadata" -Metadata $metadata -Feed $feed -Integrity $integrity
        Write-JsonOutput -Value $result -Path $OutputJson
        return
    }

    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $installerName -Directory $DownloadDir -ExpectedPath $downloadedInstallerPath
    $installerRecord = @((Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json).assets | Where-Object { $_.name -ceq $installerName })[0]
    $downloadedInstallerSha256 = Get-FileSha256 -Path $downloadedInstallerPath
    if ($downloadedInstallerSha256 -cne ([string]$installerRecord.sha256).ToLowerInvariant()) {
        throw "Downloaded NSIS installer SHA256 does not match the release manifest."
    }
    $integrity.installer_downloaded = $true
    $integrity.installer_sha256_verified = $true
    $result = New-ValidationResult -Source "github_release_download" -Metadata $metadata -Feed $feed -Integrity $integrity
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
