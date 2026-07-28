param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [ValidateSet("patch", "minor", "major", "TBD")][string]$VersionType = "patch",
    [switch]$Publish,
    [switch]$AllowUntracked,
    [switch]$SkipTests,
    [switch]$RunFrontendBuild,
    [switch]$DownloadReleaseAssetForValidation,
    [string]$ReleaseBranch = "main"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TagName = "v$Version"
$ReleasePlanPath = Join-Path $Root "docs\releases\$TagName-plan.md"
$ActivePlanPath = Join-Path $Root "docs\releases\active-plan.md"
$ReleaseDateDisplay = ""
$ReleaseFiles = @(
    "CHANGELOG.md",
    "README.md",
    "backend/app_metadata.py",
    "frontend/package.json",
    "frontend/package-lock.json",
    "docs/README.md",
    "docs/expense-reimbursement-plan.md",
    "docs/releases/active-plan.md",
    "docs/releases/$TagName-plan.md"
)

function Get-ChinaReleaseDate {
    $chinaTimeZone = [System.TimeZoneInfo]::FindSystemTimeZoneById("China Standard Time")
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $chinaTimeZone).ToString("yyyyMMdd")
}

function Get-DateDisplay {
    param([Parameter(Mandatory = $true)][string]$DateText)
    return [DateTime]::ParseExact(
        $DateText,
        "yyyyMMdd",
        [System.Globalization.CultureInfo]::InvariantCulture
    ).ToString("yyyy-MM-dd")
}

function Read-TextFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.File]::ReadAllText($Path)
}

function Write-TextFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Get-NewLine {
    param([Parameter(Mandatory = $true)][string]$Text)
    if ($Text.Contains("`r`n")) {
        return "`r`n"
    }
    return "`n"
}

function Replace-Required {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Replacement,
        [Parameter(Mandatory = $true)][string]$Description
    )
    $regex = [regex]::new($Pattern)
    if (-not $regex.IsMatch($Text)) {
        throw "Could not update $Description; pattern not found."
    }
    return $regex.Replace($Text, $Replacement, 1)
}

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $Root
    )
    Write-Host "==> $Name"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Get-JsonValueWithNode {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expression
    )
    $fullPath = Join-Path $Root $Path
    $nodeScript = @"
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const value = ($Expression);
if (value === undefined || value === null) process.exit(2);
console.log(String(value));
"@
    $tempScript = Join-Path $env:TEMP "release-json-$([guid]::NewGuid().ToString('N')).js"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempScript, $nodeScript, $utf8NoBom)
    try {
        $value = & node $tempScript $fullPath
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to read JSON value from $Path."
        }
        return ($value | Select-Object -Last 1).Trim()
    }
    finally {
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Get-ChangelogReleaseDate {
    $path = Join-Path $Root "CHANGELOG.md"
    $text = Read-TextFile -Path $path
    $pattern = "(?m)^##\s+$([regex]::Escape($TagName))\s+-\s+(?<date>\d{4}-\d{2}-\d{2})\s*$"
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -gt 1) {
        throw "CHANGELOG.md contains duplicate sections for $TagName."
    }
    if ($matches.Count -eq 0) {
        return $null
    }
    $date = [DateTime]::ParseExact(
        $matches[0].Groups["date"].Value,
        "yyyy-MM-dd",
        [System.Globalization.CultureInfo]::InvariantCulture
    )
    return $date.ToString("yyyyMMdd")
}

function Get-StatusEntries {
    return @(git -C $Root status --porcelain=v1 --untracked-files=all)
}

function Get-StatusPath {
    param([Parameter(Mandatory = $true)][string]$Entry)
    $path = $Entry.Substring(3).Trim()
    if ($path -match " -> ") {
        $path = ($path -split " -> ")[-1]
    }
    return $path.Trim('"').Replace("\", "/")
}

function Assert-CleanForNewPreparation {
    $blocking = @()
    foreach ($entry in Get-StatusEntries) {
        if ($entry.StartsWith("??") -and $AllowUntracked) {
            Write-Warning "Ignoring untracked file because -AllowUntracked was provided: $(Get-StatusPath -Entry $entry)"
            continue
        }
        $blocking += $entry
    }
    if ($blocking.Count -gt 0) {
        throw "Working tree is not clean. Commit existing work before preparing a release."
    }
}

function Assert-OnlyReleaseChanges {
    $expected = @{}
    foreach ($path in $ReleaseFiles) {
        $expected[$path.Replace("\", "/")] = $true
    }
    $blocking = @()
    foreach ($entry in Get-StatusEntries) {
        if ($entry.StartsWith("??") -and $AllowUntracked) {
            Write-Warning "Ignoring untracked file because -AllowUntracked was provided: $(Get-StatusPath -Entry $entry)"
            continue
        }
        $path = Get-StatusPath -Entry $entry
        if (-not $expected.ContainsKey($path)) {
            $blocking += $entry
        }
    }
    if ($blocking.Count -gt 0) {
        throw "Working tree contains changes outside the prepared release files: $($blocking -join '; ')"
    }
}

function Test-FileContains {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Pattern
    )
    $path = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        return $false
    }
    return (Read-TextFile -Path $path) -match $Pattern
}

function Test-ReleasePrepared {
    $escapedVersion = [regex]::Escape($Version)
    $escapedTag = [regex]::Escape($TagName)
    if (-not (Test-FileContains -RelativePath "CHANGELOG.md" -Pattern "(?m)^##\s+$escapedTag\s+-\s+$([regex]::Escape($ReleaseDateDisplay))\s*$")) {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "README.md" -Pattern "报销管理 V$escapedVersion 发布说明")) {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "README.md" -Pattern "报销管理-v$escapedVersion-$ReleaseDate\.zip")) {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "backend/app_metadata.py" -Pattern "DEFAULT_APP_VERSION\s*=\s*`"$escapedVersion`"")) {
        return $false
    }
    try {
        $packageVersion = Get-JsonValueWithNode -Path "frontend/package.json" -Expression "data.version"
        $packageLockVersion = Get-JsonValueWithNode -Path "frontend/package-lock.json" -Expression "data.version"
        $packageLockRootVersion = Get-JsonValueWithNode -Path "frontend/package-lock.json" -Expression "data.packages[''].version"
        if ($packageVersion -ne $Version -or $packageLockVersion -ne $Version -or $packageLockRootVersion -ne $Version) {
            return $false
        }
    }
    catch {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "docs/releases/$TagName-plan.md" -Pattern "(?m)^- 版本号：$escapedTag\s*$")) {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "docs/releases/$TagName-plan.md" -Pattern "(?m)^- 计划状态：内容已冻结\s*$")) {
        return $false
    }
    if (Test-FileContains -RelativePath "docs/releases/active-plan.md" -Pattern "(?m)^- 版本号：$escapedTag\s*$") {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "docs/README.md" -Pattern "(?m)^- 当前源码版本：$escapedTag\s*$")) {
        return $false
    }
    if (Test-FileContains -RelativePath "docs/expense-reimbursement-plan.md" -Pattern "(?m)^- 当前源码版本：") {
        return $false
    }
    if (-not (Test-FileContains -RelativePath "docs/expense-reimbursement-plan.md" -Pattern ([regex]::Escape("| ``$TagName`` | 内容已冻结 |")))) {
        return $false
    }
    return $true
}

function Update-Changelog {
    $path = Join-Path $Root "CHANGELOG.md"
    $text = Read-TextFile -Path $path
    $existing = [regex]::Matches($text, "(?m)^##\s+$([regex]::Escape($TagName))\s+-\s+(?<date>\d{4}-\d{2}-\d{2})\s*$")
    if ($existing.Count -gt 1) {
        throw "CHANGELOG.md contains duplicate sections for $TagName."
    }
    if ($existing.Count -eq 1) {
        if ($existing[0].Groups["date"].Value -ne $ReleaseDateDisplay) {
            throw "CHANGELOG.md records $TagName with date $($existing[0].Groups['date'].Value), expected $ReleaseDateDisplay."
        }
        return
    }
    $nl = Get-NewLine -Text $text
    $regex = [regex]::new("(?ms)^## Unreleased\s*\r?\n(?<body>.*?)(?=^##\s+v)")
    $match = $regex.Match($text)
    if (-not $match.Success) {
        throw "Could not find CHANGELOG.md Unreleased section."
    }
    $body = $match.Groups["body"].Value.Trim()
    if ([string]::IsNullOrWhiteSpace($body)) {
        throw "CHANGELOG.md Unreleased section is empty; release notes would be empty."
    }
    $replacement = "## Unreleased$nl$nl## $TagName - $ReleaseDateDisplay$nl$nl$body$nl$nl"
    $updated = $regex.Replace($text, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacement }, 1)
    Write-TextFile -Path $path -Text $updated
}

function Update-Readme {
    $path = Join-Path $Root "README.md"
    $text = Read-TextFile -Path $path
    $text = Replace-Required -Text $text -Pattern "# 报销管理 V\d+\.\d+\.\d+ 发布说明" -Replacement "# 报销管理 V$Version 发布说明" -Description "README title"
    $text = Replace-Required -Text $text -Pattern "发布日期：\d{4}-\d{2}-\d{2}" -Replacement "发布日期：$ReleaseDateDisplay" -Description "README release date"
    $text = Replace-Required -Text $text -Pattern "报销管理 V\d+\.\d+\.\d+ 是" -Replacement "报销管理 V$Version 是" -Description "README positioning version"
    $text = Replace-Required -Text $text -Pattern "报销管理-v\d+\.\d+\.\d+-\d{8}\.zip" -Replacement "报销管理-v$Version-$ReleaseDate.zip" -Description "README ZIP example"
    $text = Replace-Required -Text $text -Pattern "V\d+\.\d+\.\d+ 使用便携式安装根目录" -Replacement "V$Version 使用便携式安装根目录" -Description "README portable version"
    $text = Replace-Required -Text $text -Pattern "versions\\\d+\.\d+\.\d+\\" -Replacement "versions\$Version\" -Description "README version directory"
    $text = Replace-Required -Text $text -Pattern "从旧版 ZIP 迁移到 V\d+\.\d+\.\d+ 时" -Replacement "从旧版 ZIP 迁移到 V$Version 时" -Description "README upgrade version"
    $text = Replace-Required -Text $text -Pattern "解压 V\d+\.\d+\.\d+ ZIP" -Replacement "解压 V$Version ZIP" -Description "README unzip version"
    $text = Replace-Required -Text $text -Pattern "V\d+\.\d+\.\d+ 主包默认" -Replacement "V$Version 主包默认" -Description "README QR version"
    Write-TextFile -Path $path -Text $text
}

function Update-VersionFiles {
    $backendPath = Join-Path $Root "backend\app_metadata.py"
    $backendText = Read-TextFile -Path $backendPath
    $backendText = Replace-Required -Text $backendText -Pattern 'DEFAULT_APP_VERSION\s*=\s*"[^"]+"' -Replacement "DEFAULT_APP_VERSION = `"$Version`"" -Description "backend version"
    Write-TextFile -Path $backendPath -Text $backendText

    $nodeScript = @"
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const version = process.argv[3];
for (const relativePath of ["frontend/package.json", "frontend/package-lock.json"]) {
  const fullPath = path.join(root, relativePath);
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  data.version = version;
  if (data.packages && data.packages[""]) data.packages[""].version = version;
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n");
}
"@
    $tempScript = Join-Path $env:TEMP "release-version-$([guid]::NewGuid().ToString('N')).js"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tempScript, $nodeScript, $utf8NoBom)
    try {
        Invoke-External -Name "Update frontend package versions" -FilePath "node" -ArgumentList @($tempScript, $Root, $Version)
    }
    finally {
        Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
    }
}

function Freeze-ReleasePlan {
    if (Test-Path -LiteralPath $ReleasePlanPath) {
        $existing = Read-TextFile -Path $ReleasePlanPath
        if ($existing -notmatch "(?m)^- 版本号：$([regex]::Escape($TagName))\s*$" -or $existing -notmatch "(?m)^- 计划状态：内容已冻结\s*$") {
            throw "Existing frozen plan does not match $TagName or the '内容已冻结' state."
        }
        return
    }

    $text = Read-TextFile -Path $ActivePlanPath
    $text = Replace-Required -Text $text -Pattern "(?m)^# .+$" -Replacement "# $TagName 发布计划" -Description "release plan title"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 版本号：.*$" -Replacement "- 版本号：$TagName" -Description "release plan version"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 计划状态：.*$" -Replacement "- 计划状态：内容已冻结" -Description "release plan status"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 预计版本类型：.*$" -Replacement "- 预计版本类型：$VersionType" -Description "release plan type"
    Write-TextFile -Path $ReleasePlanPath -Text $text

    $newActive = @"
# 当前开发计划

> 只记录当前目标、范围、验收条件和阻塞；完成结果、长期验证和技术决策分别写入 ``CHANGELOG.md``、``docs/testing/``、``docs/decisions/``。正式发布前冻结本文件。

## 状态

- 版本号：TBD
- 计划状态：规划中
- 预计版本类型：TBD

## 目标

- [ ] 收集下一轮需求并确认版本范围。

## 范围

- 本轮包含：TBD
- 本轮不包含：未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器。

## 验收条件

- [ ] 根据实际改动补充可验证的完成条件。

## 阻塞

- 无。
"@
    Write-TextFile -Path $ActivePlanPath -Text $newActive
}

function Update-DocsIndexes {
    $docsReadmePath = Join-Path $Root "docs\README.md"
    $docsReadme = Read-TextFile -Path $docsReadmePath
    $docsReadme = Replace-Required -Text $docsReadme -Pattern "(?m)^- 当前源码版本：v?\d+\.\d+\.\d+.*$" -Replacement "- 当前源码版本：$TagName" -Description "docs README source version"
    Write-TextFile -Path $docsReadmePath -Text $docsReadme

    $planPath = Join-Path $Root "docs\expense-reimbursement-plan.md"
    $plan = Read-TextFile -Path $planPath
    if ($plan -notmatch [regex]::Escape("| ``$TagName`` |")) {
        $versionRow = "| ``$TagName`` | 内容已冻结 | [releases/$TagName-plan.md](releases/$TagName-plan.md) |"
        $plan = Replace-Required -Text $plan -Pattern "(?m)(^\| 版本 \| 状态 \| 文档 \|\r?\n^\| --- \| --- \| --- \|\r?\n)" -Replacement "`$1$versionRow`r`n" -Description "main plan version index"
    }
    Write-TextFile -Path $planPath -Text $plan
}

function Invoke-Preflight {
    $params = @{
        Version = $Version
        ReleaseDate = $ReleaseDate
    }
    if ($SkipTests) {
        $params.SkipTests = $true
    }
    if ($RunFrontendBuild) {
        $params.RunFrontendBuild = $true
    }
    Write-Host "==> Release preflight"
    & (Join-Path $PSScriptRoot "prepare_release.ps1") @params
    if (-not $?) {
        throw "Release preflight failed."
    }
}

function Get-CurrentBranch {
    $branch = (git -C $Root branch --show-current | Select-Object -Last 1).Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) {
        throw "Cannot publish from a detached HEAD."
    }
    return $branch
}

function Assert-ReleaseBranch {
    param([Parameter(Mandatory = $true)][string]$Branch)
    if ([string]::IsNullOrWhiteSpace($ReleaseBranch)) {
        throw "ReleaseBranch cannot be empty."
    }
    if ($Branch -ne $ReleaseBranch) {
        throw "Formal releases must be published from '$ReleaseBranch'. Current branch: '$Branch'."
    }
}

function Get-LocalTagCommit {
    $tag = git -C $Root tag --list $TagName
    if (-not $tag) {
        return $null
    }
    $commit = & git -C $Root rev-list -n 1 $TagName
    if ($LASTEXITCODE -ne 0 -or -not $commit) {
        throw "Could not resolve local tag $TagName."
    }
    return ($commit | Select-Object -Last 1).Trim()
}

function Get-RemoteTagCommit {
    $peeled = & git -C $Root ls-remote --tags origin "refs/tags/$TagName^{}"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query remote tag $TagName."
    }
    $line = $peeled | Select-Object -First 1
    if (-not $line) {
        $direct = & git -C $Root ls-remote --tags origin "refs/tags/$TagName"
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to query remote tag $TagName."
        }
        $line = $direct | Select-Object -First 1
    }
    if (-not $line) {
        return $null
    }
    return (($line -split "\s+")[0]).Trim()
}

function Get-ReleaseCommitFromHistory {
    $commit = & git -C $Root log --all --fixed-strings --grep="chore(release): publish $TagName" --format=%H -1
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to inspect release commit history for $TagName."
    }
    $value = $commit | Select-Object -First 1
    if (-not $value) {
        return $null
    }
    return $value.Trim()
}

function Assert-TagCommitMatches {
    param(
        [string]$Commit,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Description
    )
    if ($Commit -and $Commit -ne $Expected) {
        throw "$Description points to $Commit, expected immutable release commit $Expected. Publish a new patch version instead of moving $TagName."
    }
}

function Get-LatestReleaseRun {
    param([Parameter(Mandatory = $true)][string]$ReleaseCommit)
    $json = & gh run list --workflow "Publish Release" --limit 50 --json databaseId,displayTitle,headBranch,headSha,event,status,conclusion,url,createdAt
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to list GitHub Actions runs."
    }
    $parsed = $json | ConvertFrom-Json
    $runs = if ($parsed -is [array]) { $parsed } else { @($parsed) }
    $exactRuns = @($runs | Where-Object { $_.displayTitle -eq "Publish Release $TagName" })
    $matchingRuns = if ($exactRuns.Count -gt 0) {
        $exactRuns
    }
    else {
        @($runs | Where-Object { $_.headBranch -eq $TagName -or $_.headSha -eq $ReleaseCommit })
    }
    return $matchingRuns |
        Sort-Object createdAt -Descending |
        Select-Object -First 1
}

function Wait-NewReleaseRun {
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseCommit,
        [Parameter(Mandatory = $true)][datetime]$NotBeforeUtc,
        [int]$Attempts = 24
    )
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $run = Get-LatestReleaseRun -ReleaseCommit $ReleaseCommit
        if ($run -and ([DateTime]$run.createdAt).ToUniversalTime() -ge $NotBeforeUtc) {
            return $run
        }
        Start-Sleep -Seconds 5
    }
    return $null
}

function Watch-ReleaseRun {
    param([Parameter(Mandatory = $true)]$Run)
    Write-Host "==> Watch Publish Release run $($Run.databaseId)"
    & gh run watch $Run.databaseId --exit-status
    if ($LASTEXITCODE -ne 0) {
        throw "Publish Release workflow failed for run $($Run.databaseId). The release commit and immutable tag were preserved. Commit and push any workflow-only fix to $ReleaseBranch, then rerun this command. Actions: $($Run.url)"
    }
}

function Invoke-ReleaseAssetValidation {
    param(
        [switch]$ReturnBoolean,
        [string]$ExpectedCommit = ""
    )
    $validationJsonPath = Join-Path $env:TEMP "release-validation-$TagName.json"
    $validationParams = @{
        Version = $Version
        ReleaseDate = $ReleaseDate
        OutputJson = $validationJsonPath
    }
    if (-not $DownloadReleaseAssetForValidation) {
        $validationParams.MetadataOnly = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedCommit)) {
        $validationParams.ExpectedCommit = $ExpectedCommit
    }
    try {
        & (Join-Path $PSScriptRoot "validate_release_asset.ps1") @validationParams | Out-Null
        if (-not $?) {
            throw "Release asset validation failed."
        }
        $validation = Get-Content -Raw -LiteralPath $validationJsonPath | ConvertFrom-Json
        if ($ReturnBoolean) {
            return $true
        }
        return $validation
    }
    catch {
        if ($ReturnBoolean) {
            Write-Warning "Release is not yet healthy: $($_.Exception.Message)"
            return $false
        }
        throw
    }
}

function Invoke-ReleaseWorkflow {
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseCommit,
        [Parameter(Mandatory = $true)][bool]$TagWasJustPushed
    )
    $run = Get-LatestReleaseRun -ReleaseCommit $ReleaseCommit
    if (-not $TagWasJustPushed -and (Invoke-ReleaseAssetValidation -ReturnBoolean -ExpectedCommit $ReleaseCommit)) {
        if (-not $run -or ($run.status -eq "completed" -and $run.conclusion -eq "success")) {
            Write-Host "Existing GitHub Release for $TagName is already healthy; no workflow rerun is required."
            return $run
        }
    }
    if ($TagWasJustPushed) {
        $notBefore = [DateTime]::UtcNow.AddSeconds(-20)
        $newRun = Wait-NewReleaseRun -ReleaseCommit $ReleaseCommit -NotBeforeUtc $notBefore -Attempts 18
        if ($newRun) {
            $run = $newRun
        }
        if ($run -and $run.status -eq "completed" -and $run.conclusion -ne "success") {
            throw "Initial Publish Release workflow failed for run $($run.databaseId). The release commit and immutable tag were preserved. Commit and push any workflow-only fix to $ReleaseBranch, then rerun the same -Publish command to resume from this tag. Actions: $($run.url)"
        }
    }

    if ($run -and $run.status -ne "completed") {
        Watch-ReleaseRun -Run $run
        return Get-LatestReleaseRun -ReleaseCommit $ReleaseCommit
    }

    if ($run -and $run.conclusion -eq "success") {
        if (Invoke-ReleaseAssetValidation -ReturnBoolean -ExpectedCommit $ReleaseCommit) {
            return $run
        }
        Write-Host "The previous workflow succeeded, but the Release is incomplete. Dispatching a repair from immutable tag $TagName."
        $run = $null
    }
    elseif ($run) {
        Write-Host "Previous Publish Release run $($run.databaseId) failed. Dispatching the current $ReleaseBranch workflow against immutable tag $TagName."
        $run = $null
    }

    $dispatchStartedAt = [DateTime]::UtcNow.AddSeconds(-10)
    Write-Host "==> Dispatch Publish Release for immutable tag $TagName"
    & gh workflow run "Publish Release" --ref $ReleaseBranch -f "tag=$TagName"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to dispatch Publish Release for $TagName. The tag was not moved or deleted."
    }
    $run = Wait-NewReleaseRun -ReleaseCommit $ReleaseCommit -NotBeforeUtc $dispatchStartedAt -Attempts 60
    if (-not $run) {
        throw "Timed out waiting for the dispatched Publish Release workflow for $TagName."
    }
    Watch-ReleaseRun -Run $run
    return Get-LatestReleaseRun -ReleaseCommit $ReleaseCommit
}

if ($Version -notmatch "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$") {
    throw "Version must use X.Y.Z format."
}

$existingChangelogDate = Get-ChangelogReleaseDate
if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = if ($existingChangelogDate) { $existingChangelogDate } else { Get-ChinaReleaseDate }
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
$ReleaseDateDisplay = Get-DateDisplay -DateText $ReleaseDate
if ($existingChangelogDate -and $existingChangelogDate -ne $ReleaseDate) {
    throw "CHANGELOG.md records $TagName with date $existingChangelogDate, expected $ReleaseDate."
}

$branch = Get-CurrentBranch
if ($Publish) {
    Assert-ReleaseBranch -Branch $branch
}

Write-Host "Preparing $TagName ($ReleaseDate)..."
$wasPrepared = Test-ReleasePrepared
if (-not $wasPrepared) {
    Assert-CleanForNewPreparation
    Update-Changelog
    Update-Readme
    Update-VersionFiles
    Freeze-ReleasePlan
    Update-DocsIndexes
}

if (-not (Test-ReleasePrepared)) {
    throw "Release preparation did not produce a complete, internally consistent $TagName state."
}
Assert-OnlyReleaseChanges
Invoke-Preflight

if (-not $Publish) {
    Write-Host ""
    Write-Host "Prepared and validated $TagName without creating a commit or tag."
    Write-Host "Inspect the release diff, then rerun with -Publish. The command will resume from this prepared state."
    return
}

$releaseChanges = @(Get-StatusEntries | Where-Object { -not $_.StartsWith("??") })
$localTagCommit = Get-LocalTagCommit
$remoteTagCommit = Get-RemoteTagCommit
if ($releaseChanges.Count -gt 0 -and ($localTagCommit -or $remoteTagCommit)) {
    throw "$TagName already has a local or remote tag, but the working tree contains prepared release changes. Refusing to create a second release commit for an immutable version."
}
if ($releaseChanges.Count -gt 0) {
    Invoke-External -Name "Stage release files" -FilePath "git" -ArgumentList (@("add") + $ReleaseFiles)
    Invoke-External -Name "Create release commit" -FilePath "git" -ArgumentList @("commit", "-m", "chore(release): publish $TagName")
}

$headCommit = (& git -C $Root rev-parse HEAD | Select-Object -Last 1).Trim()
$historyCommit = Get-ReleaseCommitFromHistory
$releaseCommit = if ($historyCommit) { $historyCommit } elseif ($localTagCommit) { $localTagCommit } elseif ($remoteTagCommit) { $remoteTagCommit } else { $headCommit }

Assert-TagCommitMatches -Commit $localTagCommit -Expected $releaseCommit -Description "Local tag $TagName"
Assert-TagCommitMatches -Commit $remoteTagCommit -Expected $releaseCommit -Description "Remote tag $TagName"

if (-not $remoteTagCommit -and $releaseCommit -ne $headCommit) {
    throw "A new remote tag can only be created from the current release commit. HEAD is $headCommit, release commit is $releaseCommit."
}

if (-not $localTagCommit -and -not $remoteTagCommit) {
    Invoke-External -Name "Create immutable release tag" -FilePath "git" -ArgumentList @("tag", "-a", $TagName, $releaseCommit, "-m", $TagName)
    $localTagCommit = Get-LocalTagCommit
}

$tagWasJustPushed = $false
if (-not $remoteTagCommit) {
    Invoke-External -Name "Push release branch" -FilePath "git" -ArgumentList @("push", "origin", $branch)
    Invoke-External -Name "Push immutable release tag" -FilePath "git" -ArgumentList @("push", "origin", $TagName)
    $tagWasJustPushed = $true
}
else {
    Write-Host "Remote immutable tag $TagName already exists; the current branch will not be pushed as part of Release recovery."
}

Invoke-External -Name "Fetch published refs" -FilePath "git" -ArgumentList @("fetch", "origin", $ReleaseBranch, "--tags")
$remoteTagCommit = Get-RemoteTagCommit
Assert-TagCommitMatches -Commit $remoteTagCommit -Expected $releaseCommit -Description "Remote tag $TagName"

& git -C $Root merge-base --is-ancestor $releaseCommit "origin/$ReleaseBranch"
if ($LASTEXITCODE -ne 0) {
    throw "Release commit $releaseCommit is not contained in origin/$ReleaseBranch."
}

$run = Invoke-ReleaseWorkflow -ReleaseCommit $releaseCommit -TagWasJustPushed $tagWasJustPushed
$validation = Invoke-ReleaseAssetValidation -ExpectedCommit $releaseCommit

$metrics = $null
if ($run) {
    $metricsJsonPath = Join-Path $env:TEMP "release-metrics-$TagName.json"
    $metricsMarkdownPath = Join-Path $env:TEMP "release-metrics-$TagName.md"
    Write-Host "==> Collect release metrics"
    & (Join-Path $PSScriptRoot "collect_release_metrics.ps1") `
        -RunId ([long]$run.databaseId) `
        -OutputJson $metricsJsonPath `
        -OutputMarkdown $metricsMarkdownPath | Out-Null
    if (-not $?) {
        throw "Release metrics collection failed."
    }
    $metrics = Get-Content -Raw -LiteralPath $metricsJsonPath | ConvertFrom-Json
}

Write-Host ""
Write-Host "Published and verified $TagName without moving the tag or creating a post-release docs commit."
Write-Host "Release commit: $releaseCommit"
Write-Host "Release: $($validation.release_url)"
if ($metrics) {
    Write-Host "Actions: $($metrics.url)"
    Write-Host "Duration: $($metrics.duration_seconds)s"
}
