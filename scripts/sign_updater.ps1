# Only the signer child process receives the password. Never put it in argv.
param(
    [Parameter(Mandatory = $true)][string]$File,
    [string]$KeyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH,
    [Security.SecureString]$Password
)

$ErrorActionPreference = "Stop"
$filePath = (Resolve-Path -LiteralPath $File).Path
$privatePath = (Resolve-Path -LiteralPath $KeyPath).Path
$cargo = (Get-Command cargo -CommandType Application -ErrorAction Stop).Source
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $cargo
$info.Arguments = 'tauri signer sign "' + $filePath + '" --private-key-path "' + $privatePath + '"'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.RedirectStandardInput = $true
foreach ($name in @('TAURI_SIGNING_PRIVATE_KEY', 'TAURI_PRIVATE_KEY', 'TAURI_PRIVATE_KEY_PATH', 'TAURI_PRIVATE_KEY_PASSWORD')) {
    $info.EnvironmentVariables.Remove($name)
}
$ownedPassword = $false
$process = $null
try {
    if ($null -eq $Password) {
        # Keep the existing CI environment contract, including empty passwords.
        $Password = New-Object Security.SecureString
        foreach ($character in ([string]$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD).ToCharArray()) {
            $Password.AppendChar($character)
        }
        $ownedPassword = $true
    }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    try {
        $info.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $info.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY_PATH'] = $privatePath
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    if (-not $process.Start()) { throw 'Unable to start updater signer.' }
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    # Do not relay signer errors: malformed secret-key input can appear in them.
    $null = $stdout.GetAwaiter().GetResult()
    $null = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        throw 'Updater signing failed. Check the private-key password and key file.'
    }
    if (-not (Test-Path -LiteralPath "$filePath.sig" -PathType Leaf)) { throw 'Updater signer did not produce a signature.' }
    Write-Host 'Updater signature created.'
}
finally {
    $info.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    $info.EnvironmentVariables.Remove('TAURI_SIGNING_PRIVATE_KEY_PATH')
    if ($process) { $process.Dispose() }
    if ($ownedPassword -and $Password) { $Password.Dispose() }
}
