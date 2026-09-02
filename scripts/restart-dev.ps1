param(
    [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$BackendPort = 8000
$FrontendPort = 5174
$BackendUrl = "http://127.0.0.1:$BackendPort"
$FrontendUrl = "http://127.0.0.1:$FrontendPort"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$FrontendRoot = Join-Path $ProjectRoot "frontend"
$ControllerPidPath = Join-Path $ProjectRoot "logs\dev-controller.pid"
$script:DevJobHandle = [IntPtr]::Zero

function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-NpmCommandPath {
    $npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if ($null -eq $npmCommand) {
        $npmCommand = Get-Command "npm" -ErrorAction Stop
    }
    return $npmCommand.Source
}

function Get-ListenerProcessIds {
    param([Parameter(Mandatory = $true)][int]$Port)
    return @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -gt 0 }
    )
}

function Test-BackendProcess {
    param([Parameter(Mandatory = $true)]$Process)
    $commandLine = [string]$Process.CommandLine
    return $commandLine.Contains("backend.main:app")
}

function Test-FrontendProcess {
    param([Parameter(Mandatory = $true)]$Process)
    $commandLine = [string]$Process.CommandLine
    return $commandLine.Contains("--port $FrontendPort") -and
        ($commandLine.Contains("npm") -or $commandLine.Contains("vite"))
}

function Get-DevProcessIds {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][scriptblock]$Matcher
    )

    $processes = @(Get-CimInstance Win32_Process)
    $byId = @{}
    foreach ($processItem in $processes) {
        $byId[[int]$processItem.ProcessId] = $processItem
    }

    $ids = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($listenerId in Get-ListenerProcessIds -Port $Port) {
        [void]$ids.Add([int]$listenerId)
    }
    foreach ($processItem in $processes) {
        if (& $Matcher $processItem) {
            [void]$ids.Add([int]$processItem.ProcessId)
        }
    }

    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($processItem in $processes) {
            $processId = [int]$processItem.ProcessId
            $parentId = [int]$processItem.ParentProcessId
            if ($ids.Contains($parentId) -and -not $ids.Contains($processId)) {
                [void]$ids.Add($processId)
                $changed = $true
            }
        }
    }

    foreach ($seedId in @($ids)) {
        $current = $byId[$seedId]
        while ($null -ne $current) {
            $parentId = [int]$current.ParentProcessId
            if (-not $byId.ContainsKey($parentId)) {
                break
            }
            $parent = $byId[$parentId]
            if (& $Matcher $parent) {
                [void]$ids.Add([int]$parent.ProcessId)
                $current = $parent
                continue
            }
            break
        }
    }

    return @($ids | Where-Object { $_ -ne $PID } | Sort-Object -Unique)
}

function Stop-DevProcesses {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][scriptblock]$Matcher
    )

    $processIds = @(Get-DevProcessIds -Port $Port -Matcher $Matcher)
    if ($processIds.Count -eq 0) {
        Write-Host "No running $Name process found on port $Port."
        return
    }

    Write-Host "Stopping $Name process tree: $($processIds -join ', ')"
    foreach ($processId in $processIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-PreviousController {
    if (-not (Test-Path $ControllerPidPath)) {
        return
    }

    $rawPid = (Get-Content -Path $ControllerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $previousPid = 0
    if (-not [int]::TryParse([string]$rawPid, [ref]$previousPid)) {
        Remove-Item -Path $ControllerPidPath -Force -ErrorAction SilentlyContinue
        return
    }
    if ($previousPid -eq $PID) {
        return
    }

    $previousProcess = Get-Process -Id $previousPid -ErrorAction SilentlyContinue
    if ($null -eq $previousProcess) {
        Remove-Item -Path $ControllerPidPath -Force -ErrorAction SilentlyContinue
        return
    }

    Write-Host "Stopping previous dev controller: $previousPid"
    Stop-Process -Id $previousPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

function Save-ControllerPid {
    $pidDirectory = Split-Path -Parent $ControllerPidPath
    if (-not (Test-Path $pidDirectory)) {
        New-Item -ItemType Directory -Path $pidDirectory | Out-Null
    }
    Set-Content -Path $ControllerPidPath -Value $PID -Encoding ASCII
}

function Clear-ControllerPid {
    if (-not (Test-Path $ControllerPidPath)) {
        return
    }
    $rawPid = (Get-Content -Path $ControllerPidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ([string]$rawPid -eq [string]$PID) {
        Remove-Item -Path $ControllerPidPath -Force -ErrorAction SilentlyContinue
    }
}

function Initialize-KillOnCloseJob {
    if ($script:DevJobHandle -ne [IntPtr]::Zero) {
        return
    }

    if ($null -eq ("DevJobNative" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DevJobNative {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll")]
    public static extern bool SetInformationJobObject(IntPtr hJob, int infoType, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public long Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
}
"@
    }

    $jobHandle = [DevJobNative]::CreateJobObject([IntPtr]::Zero, $null)
    if ($jobHandle -eq [IntPtr]::Zero) {
        throw "Failed to create Windows job object."
    }

    $info = New-Object DevJobNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    $info.BasicLimitInformation.LimitFlags = 0x2000
    $infoSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $infoPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($infoSize)
    try {
        [Runtime.InteropServices.Marshal]::StructureToPtr($info, $infoPointer, $false)
        $ok = [DevJobNative]::SetInformationJobObject($jobHandle, 9, $infoPointer, [uint32]$infoSize)
        if (-not $ok) {
            throw "Failed to set Windows job object kill-on-close mode."
        }
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($infoPointer)
    }

    $script:DevJobHandle = $jobHandle
}

function Add-ProcessToKillOnCloseJob {
    param([Parameter(Mandatory = $true)]$Process)
    Initialize-KillOnCloseJob
    $ok = [DevJobNative]::AssignProcessToJobObject($script:DevJobHandle, $Process.Handle)
    if (-not $ok) {
        Write-Warning "Failed to attach process $($Process.Id) to cleanup job."
    }
}

function Start-ManagedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    Write-Host "Starting $Name..."
    $process = Start-Process -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $WorkingDirectory `
        -NoNewWindow `
        -PassThru
    Add-ProcessToKillOnCloseJob -Process $process
    Write-Host "$Name PID: $($process.Id)"
    return $process
}

function Stop-ManagedProcesses {
    param([object[]]$Processes)

    Write-Host ""
    Write-Host "Stopping managed dev servers..."
    foreach ($process in $Processes) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($script:DevJobHandle -ne [IntPtr]::Zero) {
        [void][DevJobNative]::CloseHandle($script:DevJobHandle)
        $script:DevJobHandle = [IntPtr]::Zero
    }
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Write-Host "$Name is reachable: $Url"
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)

    Write-Warning "$Name did not respond within $TimeoutSeconds seconds: $Url"
}

if (-not (Test-Path $FrontendRoot)) {
    throw "Frontend directory not found: $FrontendRoot"
}
if (-not (Test-CommandExists -Name "python")) {
    throw "python was not found in PATH."
}
if (-not (Test-CommandExists -Name "npm")) {
    throw "npm was not found in PATH."
}

if ($CheckOnly) {
    Write-Host "restart-dev check passed."
    Write-Host "Project root: $ProjectRoot"
    Write-Host "Backend: $BackendUrl"
    Write-Host "Frontend: $FrontendUrl"
    exit 0
}

$managedProcesses = @()
$previousApiBaseUrl = $env:VITE_API_BASE_URL
$previousDistributionTarget = $env:REIMBURSEMENT_DISTRIBUTION_TARGET

try {
    Write-Host "Restarting reimbursement dev servers in this window..."
    Write-Host "Project root: $ProjectRoot"

    Stop-PreviousController
    Save-ControllerPid

    Stop-DevProcesses -Name "backend" -Port $BackendPort -Matcher ${function:Test-BackendProcess}
    Stop-DevProcesses -Name "frontend" -Port $FrontendPort -Matcher ${function:Test-FrontendProcess}

    Start-Sleep -Seconds 1

    $env:REIMBURSEMENT_DISTRIBUTION_TARGET = "zip"
    try {
        $backendProcess = Start-ManagedProcess `
            -Name "backend" `
            -FilePath "python" `
            -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
            -WorkingDirectory $ProjectRoot
    }
    finally {
        if ($null -eq $previousDistributionTarget) {
            Remove-Item Env:\REIMBURSEMENT_DISTRIBUTION_TARGET -ErrorAction SilentlyContinue
        }
        else {
            $env:REIMBURSEMENT_DISTRIBUTION_TARGET = $previousDistributionTarget
        }
    }
    $managedProcesses += $backendProcess

    $env:VITE_API_BASE_URL = $BackendUrl
    $frontendProcess = Start-ManagedProcess `
        -Name "frontend" `
        -FilePath (Get-NpmCommandPath) `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$FrontendPort") `
        -WorkingDirectory $FrontendRoot
    $managedProcesses += $frontendProcess

    Wait-HttpReady -Name "Backend" -Url "$BackendUrl/api/health"
    Wait-HttpReady -Name "Frontend" -Url $FrontendUrl

    Write-Host ""
    Write-Host "Frontend: $FrontendUrl"
    Write-Host "Backend:  $BackendUrl"
    Write-Host ""
    Write-Host "Type q, quit, exit, or stop and press Enter to stop both services."
    Write-Host "Closing this window will also stop both services."

    while ($true) {
        $command = (Read-Host "dev").Trim().ToLowerInvariant()
        if ($command -in @("q", "quit", "exit", "stop")) {
            break
        }
        if ($command -eq "status") {
            Write-Host "backend running:  $(-not $backendProcess.HasExited)"
            Write-Host "frontend running: $(-not $frontendProcess.HasExited)"
            continue
        }
        Write-Host "Unknown command. Use status, q, quit, exit, or stop."
    }
} finally {
    if ($null -eq $previousApiBaseUrl) {
        Remove-Item Env:\VITE_API_BASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:VITE_API_BASE_URL = $previousApiBaseUrl
    }
    if ($null -eq $previousDistributionTarget) {
        Remove-Item Env:\REIMBURSEMENT_DISTRIBUTION_TARGET -ErrorAction SilentlyContinue
    } else {
        $env:REIMBURSEMENT_DISTRIBUTION_TARGET = $previousDistributionTarget
    }
    Stop-ManagedProcesses -Processes $managedProcesses
    Clear-ControllerPid
}
