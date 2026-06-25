param(
    [Parameter(Mandatory = $true)][long]$RunId,
    [long]$CompareRunId = 0,
    [ValidateSet("Json", "Markdown")][string]$Format = "Json",
    [string]$OutputJson = "",
    [string]$OutputMarkdown = ""
)

$ErrorActionPreference = "Stop"

function Assert-GhAvailable {
    & gh --version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI 'gh' is required."
    }
}

function Get-DurationSeconds {
    param($StartedAt, $CompletedAt)
    if (-not $StartedAt -or -not $CompletedAt) {
        return $null
    }
    return [math]::Round((([datetime]$CompletedAt) - ([datetime]$StartedAt)).TotalSeconds, 1)
}

function Get-RunMetrics {
    param([Parameter(Mandatory = $true)][long]$Id)

    $json = & gh run view $Id --json url,createdAt,updatedAt,conclusion,jobs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read GitHub Actions run $Id."
    }
    $run = $json | ConvertFrom-Json
    $jobs = @($run.jobs | ForEach-Object {
        $job = $_
        [ordered]@{
            name = $job.name
            conclusion = $job.conclusion
            started_at = $job.startedAt
            completed_at = $job.completedAt
            duration_seconds = Get-DurationSeconds -StartedAt $job.startedAt -CompletedAt $job.completedAt
            steps = @($job.steps | ForEach-Object {
                [ordered]@{
                    name = $_.name
                    conclusion = $_.conclusion
                    started_at = $_.startedAt
                    completed_at = $_.completedAt
                    duration_seconds = Get-DurationSeconds -StartedAt $_.startedAt -CompletedAt $_.completedAt
                }
            })
        }
    })

    return [ordered]@{
        run_id = $Id
        url = $run.url
        conclusion = $run.conclusion
        created_at = $run.createdAt
        updated_at = $run.updatedAt
        duration_seconds = Get-DurationSeconds -StartedAt $run.createdAt -CompletedAt $run.updatedAt
        jobs = $jobs
    }
}

function Get-StepIndex {
    param($Metrics)
    $index = @{}
    foreach ($job in @($Metrics.jobs)) {
        foreach ($step in @($job.steps)) {
            if ($step.duration_seconds -ne $null -and -not $index.ContainsKey($step.name)) {
                $index[$step.name] = $step.duration_seconds
            }
        }
    }
    return $index
}

function New-Comparison {
    param($Current, $Baseline)
    if (-not $Baseline) {
        return $null
    }
    $baselineSteps = Get-StepIndex -Metrics $Baseline
    $rows = @()
    foreach ($job in @($Current.jobs)) {
        foreach ($step in @($job.steps)) {
            if ($step.duration_seconds -eq $null -or -not $baselineSteps.ContainsKey($step.name)) {
                continue
            }
            $baselineDuration = [double]$baselineSteps[$step.name]
            $currentDuration = [double]$step.duration_seconds
            $rows += [ordered]@{
                step = $step.name
                current_seconds = $currentDuration
                baseline_seconds = $baselineDuration
                delta_seconds = [math]::Round($currentDuration - $baselineDuration, 1)
            }
        }
    }
    return [ordered]@{
        baseline_run_id = $Baseline.run_id
        baseline_url = $Baseline.url
        baseline_duration_seconds = $Baseline.duration_seconds
        total_delta_seconds = [math]::Round(([double]$Current.duration_seconds) - ([double]$Baseline.duration_seconds), 1)
        steps = $rows
    }
}

function Format-Seconds {
    param($Seconds)
    if ($Seconds -eq $null) {
        return ""
    }
    return "$Seconds s"
}

function ConvertTo-MetricsMarkdown {
    param($Metrics)
    $lines = @()
    $lines += "# Release Metrics"
    $lines += ""
    $lines += "- Run: [$($Metrics.run_id)]($($Metrics.url))"
    $lines += "- Conclusion: $($Metrics.conclusion)"
    $lines += "- Total: $(Format-Seconds $Metrics.duration_seconds)"
    if ($Metrics.comparison) {
        $lines += "- Baseline: [$($Metrics.comparison.baseline_run_id)]($($Metrics.comparison.baseline_url))"
        $lines += "- Baseline total: $(Format-Seconds $Metrics.comparison.baseline_duration_seconds)"
        $lines += "- Total delta: $(Format-Seconds $Metrics.comparison.total_delta_seconds)"
    }
    $lines += ""
    $lines += "| Step | Current | Baseline | Delta |"
    $lines += "| --- | ---: | ---: | ---: |"
    if ($Metrics.comparison) {
        foreach ($row in @($Metrics.comparison.steps)) {
            $stepName = $row.step -replace "\|", "\\|"
            $lines += "| $stepName | $(Format-Seconds $row.current_seconds) | $(Format-Seconds $row.baseline_seconds) | $(Format-Seconds $row.delta_seconds) |"
        }
    }
    else {
        foreach ($job in @($Metrics.jobs)) {
            foreach ($step in @($job.steps)) {
                $stepName = $step.name -replace "\|", "\\|"
                $lines += "| $stepName | $(Format-Seconds $step.duration_seconds) |  |  |"
            }
        }
    }
    return ($lines -join [Environment]::NewLine)
}

Assert-GhAvailable

$current = Get-RunMetrics -Id $RunId
$baseline = $null
if ($CompareRunId -gt 0) {
    $baseline = Get-RunMetrics -Id $CompareRunId
}
$comparison = New-Comparison -Current $current -Baseline $baseline
$result = [ordered]@{
    run_id = $current.run_id
    url = $current.url
    conclusion = $current.conclusion
    created_at = $current.created_at
    updated_at = $current.updated_at
    duration_seconds = $current.duration_seconds
    jobs = $current.jobs
    comparison = $comparison
}

$json = $result | ConvertTo-Json -Depth 12
$markdown = ConvertTo-MetricsMarkdown -Metrics $result

if (-not [string]::IsNullOrWhiteSpace($OutputJson)) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutputJson, $json + [Environment]::NewLine, $utf8NoBom)
}
if (-not [string]::IsNullOrWhiteSpace($OutputMarkdown)) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutputMarkdown, $markdown + [Environment]::NewLine, $utf8NoBom)
}

if ($Format -eq "Markdown") {
    Write-Output $markdown
}
else {
    Write-Output $json
}
