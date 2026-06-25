param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [string]$TagName = "",
    [string]$ZipPath = "",
    [switch]$MetadataOnly,
    [string]$DownloadDir = "",
    [string]$OutputJson = "",
    [switch]$KeepDownload,
    [switch]$SkipOpenCvRuntimeCheck
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch "^\d+\.\d+\.\d+$") {
    throw "Version must use X.Y.Z format."
}
if ([string]::IsNullOrWhiteSpace($TagName)) {
    $TagName = "v$Version"
}
if (-not [string]::IsNullOrWhiteSpace($ReleaseDate) -and $ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
if ($MetadataOnly -and -not [string]::IsNullOrWhiteSpace($ZipPath)) {
    throw "-MetadataOnly cannot be combined with -ZipPath."
}

$AppName = -join ([char[]](0x62A5, 0x9500, 0x7BA1, 0x7406))
$AppExeName = "$AppName.exe"

function ConvertTo-SizeMb {
    param([Parameter(Mandatory = $true)][double]$Bytes)
    return [math]::Round($Bytes / 1MB, 2)
}

function Write-JsonOutput {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [string]$Path = ""
    )

    $json = $Value | ConvertTo-Json -Depth 10
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

function Get-ReleaseMetadata {
    Assert-GhAvailable

    $releaseJson = & gh release view $TagName --json url,tagName,isDraft,isPrerelease,publishedAt,assets
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read GitHub Release $TagName."
    }
    $release = $releaseJson | ConvertFrom-Json
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
    }

    $mainAssetName = "reimbursement-tool-v$Version-$ReleaseDate.zip"
    $mainAsset = $release.assets | Where-Object { $_.name -eq $mainAssetName } | Select-Object -First 1
    if (-not $mainAsset) {
        throw "Main release ZIP asset not found: $mainAssetName"
    }
    $runtimeAssets = @($release.assets | Where-Object { $_.name -like "opencv-wechat-runtime-*.zip" })
    if (-not $SkipOpenCvRuntimeCheck -and $runtimeAssets.Count -eq 0) {
        throw "OpenCV runtime asset is missing from $TagName."
    }

    return [ordered]@{
        release = $release
        main_asset = $mainAsset
        main_asset_name = $mainAssetName
        runtime_assets = $runtimeAssets
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
        [Parameter(Mandatory = $true)]$Content
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
if ($MetadataOnly) {
    $content = New-MetadataOnlyContentResult
    $result = New-ValidationResult -Source "github_release_metadata" -Release $metadata.release -MainAsset $metadata.main_asset -RuntimeAssets $metadata.runtime_assets -Content $content
    Write-JsonOutput -Value $result -Path $OutputJson
    return
}

$createdTempDir = $false
if ([string]::IsNullOrWhiteSpace($DownloadDir)) {
    $DownloadDir = Join-Path $env:TEMP ("reimbursement-release-asset-" + [guid]::NewGuid().ToString("N"))
    $createdTempDir = $true
}
New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null

$downloadedZipPath = Join-Path $DownloadDir $metadata.main_asset_name
try {
    Invoke-ReleaseAssetDownload -Tag $TagName -Pattern $metadata.main_asset_name -Directory $DownloadDir -ExpectedPath $downloadedZipPath
    $content = Test-ReleaseZipContent -Path $downloadedZipPath
    $result = New-ValidationResult -Source "github_release_download" -Release $metadata.release -MainAsset $metadata.main_asset -RuntimeAssets $metadata.runtime_assets -Content $content
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
