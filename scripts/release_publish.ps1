param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$ReleaseDate = "",
    [ValidateSet("patch", "minor", "major", "TBD")][string]$VersionType = "patch",
    [switch]$Publish,
    [switch]$RepublishExistingTag,
    [switch]$AllowUntracked,
    [switch]$SkipTests,
    [switch]$RunFrontendBuild,
    [switch]$DownloadReleaseAssetForValidation,
    [long]$CompareRunId = 0
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TagName = "v$Version"
$ReleasePlanPath = Join-Path $Root "docs\releases\$TagName-plan.md"
$ActivePlanPath = Join-Path $Root "docs\releases\active-plan.md"
$ReleaseDateDisplay = ""

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

function Assert-CleanWorktree {
    $status = @(git -C $Root status --porcelain)
    $blockingStatus = $status
    $untrackedStatus = @()
    if ($AllowUntracked) {
        $blockingStatus = @($status | Where-Object { $_ -notmatch "^\?\?" })
        $untrackedStatus = @($status | Where-Object { $_ -match "^\?\?" })
    }
    if ($blockingStatus.Count -gt 0) {
        throw "Working tree is not clean. Commit or stash changes before running release_publish.ps1."
    }
    if ($untrackedStatus.Count -gt 0) {
        Write-Warning "Ignoring untracked files because -AllowUntracked was provided: $($untrackedStatus -join '; ')"
    }
}

function Assert-ReleaseTagAvailable {
    $localTag = git -C $Root tag --list $TagName
    if ($localTag) {
        throw "Local tag $TagName already exists."
    }
    $remoteTag = git -C $Root ls-remote --tags origin "refs/tags/$TagName"
    if ($remoteTag) {
        throw "Remote tag $TagName already exists."
    }
}

function Assert-ReleaseTagExistsForRepublish {
    $remoteTag = git -C $Root ls-remote --tags origin "refs/tags/$TagName"
    if (-not $remoteTag) {
        throw "Remote tag $TagName does not exist; remove -RepublishExistingTag for a new release."
    }
    $releaseJson = & gh release view $TagName --json tagName 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $releaseJson) {
        throw "GitHub Release $TagName does not exist; -RepublishExistingTag only updates an existing release."
    }
}

function Update-Changelog {
    $path = Join-Path $Root "CHANGELOG.md"
    $text = Read-TextFile -Path $path
    if ($text -match "(?m)^##\s+$([regex]::Escape($TagName))\s+-\s+") {
        throw "CHANGELOG.md already contains $TagName."
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
  if (data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
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
        throw "Frozen release plan already exists: $ReleasePlanPath"
    }
    $text = Read-TextFile -Path $ActivePlanPath
    $text = Replace-Required -Text $text -Pattern "(?m)^# .+$" -Replacement "# $TagName 发布计划" -Description "release plan title"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 版本号：.*$" -Replacement "- 版本号：$TagName" -Description "release plan version"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 计划状态：.*$" -Replacement "- 计划状态：发布准备中" -Description "release plan status"
    $text = Replace-Required -Text $text -Pattern "(?m)^- 预计版本类型：.*$" -Replacement "- 预计版本类型：$VersionType" -Description "release plan type"
    Write-TextFile -Path $ReleasePlanPath -Text $text

    $newActive = @"
# 当前开发计划

## 状态
- 版本号：TBD
- 计划状态：规划中
- 预计版本类型：TBD

## 目标
- [ ] 收集下一轮需求并确认版本范围。

## 范围
本次做：
- TBD

本次不做：
- 未明确版本号和发布前验证前，不主动同步或部署 Linux 服务器；后续修改先在本地完成测试。

## 版本号判断
- 如果只是修复问题：patch
- 如果增加用户可见功能：minor
- 如果数据结构或使用方式有不兼容变化：major

---

## 完成记录

### 重要改动
- 暂无。

### 验证记录
- 暂无。

### 已同步到 CHANGELOG
- 暂无。
"@
    Write-TextFile -Path $ActivePlanPath -Text $newActive
}

function Update-DocsIndexes {
    $docsReadmePath = Join-Path $Root "docs\README.md"
    $docsReadme = Read-TextFile -Path $docsReadmePath
    $docsReadme = Replace-Required -Text $docsReadme -Pattern "(?m)^- 当前稳定版：v?\d+\.\d+\.\d+.*$" -Replacement "- 当前稳定版：$TagName" -Description "docs README stable version"
    Write-TextFile -Path $docsReadmePath -Text $docsReadme

    $planPath = Join-Path $Root "docs\expense-reimbursement-plan.md"
    $plan = Read-TextFile -Path $planPath
    $plan = Replace-Required -Text $plan -Pattern '(?m)^- 当前稳定版：`?v?\d+\.\d+\.\d+`?.*$' -Replacement "- 当前稳定版：``$TagName``" -Description "main plan stable version"
    if ($plan -notmatch [regex]::Escape("| ``$TagName`` |")) {
        $versionRow = "| ``$TagName`` | 已发布 | [releases/$TagName-plan.md](releases/$TagName-plan.md) |"
        $plan = Replace-Required -Text $plan -Pattern "(?m)(^\| 版本 \| 状态 \| 文档 \|\r?\n^\| --- \| --- \| --- \|\r?\n)" -Replacement "`$1$versionRow`r`n" -Description "main plan version index"
    }
    if ($plan -notmatch [regex]::Escape("| V$Version 发布验证 |")) {
        $testRow = "| V$Version 发布验证 | 发布预检、GitHub Release workflow、Release notes 和资产均已验证 | [releases/$TagName-plan.md](releases/$TagName-plan.md) |"
        $plan = Replace-Required -Text $plan -Pattern "(?m)(^\| 测试 \| 结论 \| 文档 \|\r?\n^\| --- \| --- \| --- \|\r?\n)" -Replacement "`$1$testRow`r`n" -Description "main plan testing index"
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
    if ($LASTEXITCODE -ne 0) {
        throw "Release preflight failed with exit code $LASTEXITCODE."
    }
}

function Get-CurrentBranch {
    $branch = (git -C $Root branch --show-current | Select-Object -Last 1).Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) {
        throw "Cannot publish from a detached HEAD."
    }
    return $branch
}

function Wait-ReleaseRun {
    param(
        [Parameter(Mandatory = $true)][string]$BranchOrTag,
        [Parameter(Mandatory = $true)][datetime]$NotBeforeUtc
    )
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        $json = & gh run list --workflow "Publish Release" --limit 20 --json databaseId,headBranch,event,status,conclusion,url,createdAt
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to list GitHub Actions runs."
        }
        $parsedRuns = $json | ConvertFrom-Json
        $runs = if ($parsedRuns -is [array]) { $parsedRuns } else { @($parsedRuns) }
        $run = $runs |
            Where-Object {
                $_.headBranch -eq $BranchOrTag `
                    -and $_.event -eq "push" `
                    -and ([DateTime]$_.createdAt).ToUniversalTime() -ge $NotBeforeUtc
            } |
            Sort-Object createdAt -Descending |
            Select-Object -First 1
        if ($run) {
            return $run
        }
        Start-Sleep -Seconds 5
    }
    throw "Timed out waiting for Publish Release workflow for $BranchOrTag."
}

function Add-VerificationSummary {
    param(
        [Parameter(Mandatory = $true)]$Metrics,
        [Parameter(Mandatory = $true)]$Validation
    )
    $text = Read-TextFile -Path $ReleasePlanPath
    $nl = Get-NewLine -Text $text
    $runtimeSummary = if (@($Validation.opencv_runtime_assets).Count -gt 0) {
        (@($Validation.opencv_runtime_assets) | ForEach-Object { "``$($_.name)``（约 $($_.size_mb) MB）" }) -join "、"
    }
    else {
        "未要求 OpenCV runtime asset"
    }
    $comparisonText = if ($Metrics.comparison) {
        "；对比 run ``$($Metrics.comparison.baseline_run_id)``，总耗时差值 ``$($Metrics.comparison.total_delta_seconds)s``"
    }
    else {
        ""
    }
    $contentSummary = if ($Validation.zip.content_checked) {
        "- [x] $TagName 正式 ZIP 内容校验：条目数 ``$($Validation.zip.entry_count)``，``current_version`` 与 ``app_version`` 均为 ``$Version``，数据结构兼容范围 ``$($Validation.manifest.supported_range)``，未包含运行态目录或测试样本。"
    }
    else {
        "- [x] $TagName 正式 ZIP 内容校验：发布后本地执行 metadata-only 校验，未下载远端主 ZIP；ZIP 内容结构由 GitHub Actions 的 ``Validate local release ZIP`` 步骤在上传前对本地构建产物完成校验。"
    }
    $summaryLines = @(
        "- [x] $TagName GitHub Release workflow：run ``$($Metrics.run_id)`` 成功，总耗时 ``$($Metrics.duration_seconds)s``$comparisonText；URL $($Metrics.url)。",
        "- [x] $TagName GitHub Release 资产校验：主包 ``$($Validation.main_asset.name)``（约 $($Validation.main_asset.size_mb) MB），OpenCV runtime $runtimeSummary；Release URL $($Validation.release_url)。",
        $contentSummary,
        "- [x] $TagName 发布耗时采集：``scripts\collect_release_metrics.ps1 -RunId $($Metrics.run_id)`` 已生成 JSON/Markdown 摘要。"
    )
    $summary = ($summaryLines -join $nl) + $nl
    $regex = [regex]::new("(?ms)(### 验证记录\s*\r?\n)(?<body>.*?)(?=### 已同步到 CHANGELOG|$)")
    if (-not $regex.IsMatch($text)) {
        throw "Could not find verification section in $ReleasePlanPath."
    }
    $updated = $regex.Replace(
        $text,
        [System.Text.RegularExpressions.MatchEvaluator]{
            param($m)
            $body = $m.Groups["body"].Value
            $body = $body -replace "(?m)^\s*-\s*暂无。\s*\r?\n", ""
            $body = $body.TrimEnd()
            if (-not [string]::IsNullOrWhiteSpace($body)) {
                return $m.Groups[1].Value + $body + $nl + $summary + $nl
            }
            return $m.Groups[1].Value + $summary + $nl
        },
        1
    )
    Write-TextFile -Path $ReleasePlanPath -Text $updated
}

if ($Version -notmatch "^\d+\.\d+\.\d+$") {
    throw "Version must use X.Y.Z format."
}
if ([string]::IsNullOrWhiteSpace($ReleaseDate)) {
    $ReleaseDate = Get-ChinaReleaseDate
}
if ($ReleaseDate -notmatch "^\d{8}$") {
    throw "ReleaseDate must use yyyymmdd format."
}
$ReleaseDateDisplay = Get-DateDisplay -DateText $ReleaseDate

Write-Host "Preparing $TagName ($ReleaseDate)..."
Assert-CleanWorktree

$branch = Get-CurrentBranch
if ($RepublishExistingTag) {
    Assert-ReleaseTagExistsForRepublish
    Invoke-Preflight
    Invoke-External -Name "Move release tag" -FilePath "git" -ArgumentList @("tag", "-f", "-a", $TagName, "-m", $TagName)
}
else {
    Assert-ReleaseTagAvailable
    Update-Changelog
    Update-Readme
    Update-VersionFiles
    Freeze-ReleasePlan
    Update-DocsIndexes
    Invoke-Preflight

    $releaseFiles = @(
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
    Invoke-External -Name "Stage release files" -FilePath "git" -ArgumentList (@("add") + $releaseFiles)
    Invoke-External -Name "Create release commit" -FilePath "git" -ArgumentList @("commit", "-m", "chore(release): publish $TagName")
    Invoke-External -Name "Create release tag" -FilePath "git" -ArgumentList @("tag", "-a", $TagName, "-m", $TagName)
}

if (-not $Publish) {
    Write-Host ""
    if ($RepublishExistingTag) {
        Write-Host "Prepared local tag move for $TagName."
    }
    else {
        Write-Host "Prepared local release commit and tag $TagName."
    }
    Write-Host "Run with -Publish to push branch/tag, wait for GitHub Actions, validate assets, and record verification."
    return
}

$publishStartedAt = [DateTime]::UtcNow.AddSeconds(-15)
Invoke-External -Name "Push release branch" -FilePath "git" -ArgumentList @("push", "origin", $branch)
if ($RepublishExistingTag) {
    Invoke-External -Name "Force-push release tag" -FilePath "git" -ArgumentList @("push", "--force", "origin", "refs/tags/${TagName}:refs/tags/${TagName}")
}
else {
    Invoke-External -Name "Push release tag" -FilePath "git" -ArgumentList @("push", "origin", $TagName)
}

$run = Wait-ReleaseRun -BranchOrTag $TagName -NotBeforeUtc $publishStartedAt
Write-Host "==> Watch Publish Release run $($run.databaseId)"
& gh run watch $run.databaseId --exit-status
if ($LASTEXITCODE -ne 0) {
    throw "Publish Release workflow failed for run $($run.databaseId)."
}

$metricsJsonPath = Join-Path $env:TEMP "release-metrics-$TagName.json"
$metricsMarkdownPath = Join-Path $env:TEMP "release-metrics-$TagName.md"
$metricsParams = @{
    RunId = [long]$run.databaseId
    OutputJson = $metricsJsonPath
    OutputMarkdown = $metricsMarkdownPath
}
if ($CompareRunId -gt 0) {
    $metricsParams.CompareRunId = $CompareRunId
}
Write-Host "==> Collect release metrics"
& (Join-Path $PSScriptRoot "collect_release_metrics.ps1") @metricsParams | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Release metrics collection failed."
}
$metrics = Get-Content -Raw -LiteralPath $metricsJsonPath | ConvertFrom-Json

$validationJsonPath = Join-Path $env:TEMP "release-validation-$TagName.json"
Write-Host "==> Validate release asset"
$validationParams = @{
    Version = $Version
    ReleaseDate = $ReleaseDate
    OutputJson = $validationJsonPath
}
if (-not $DownloadReleaseAssetForValidation) {
    $validationParams.MetadataOnly = $true
}
& (Join-Path $PSScriptRoot "validate_release_asset.ps1") @validationParams | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Release asset validation failed."
}
$validation = Get-Content -Raw -LiteralPath $validationJsonPath | ConvertFrom-Json

Add-VerificationSummary -Metrics $metrics -Validation $validation
Invoke-External -Name "Check verification diff" -FilePath "git" -ArgumentList @("diff", "--check")
Invoke-External -Name "Stage verification record" -FilePath "git" -ArgumentList @("add", "docs/releases/$TagName-plan.md")
Invoke-External -Name "Commit verification record" -FilePath "git" -ArgumentList @("commit", "-m", "docs(release): record $TagName verification")
Invoke-External -Name "Push verification record" -FilePath "git" -ArgumentList @("push", "origin", $branch)

Write-Host ""
Write-Host "Published $TagName."
Write-Host "Release: $($validation.release_url)"
Write-Host "Actions: $($metrics.url)"
