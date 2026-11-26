$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Version = if ($env:MINDQUEST_VERSION) { $env:MINDQUEST_VERSION } else { 'v0.0.0' }
$Repository = 'migueljocode/mindquest'
$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($Architecture -ne 'X64') {
    throw "Unsupported architecture: $Architecture. MindQuest currently supports Windows x64."
}

$Archive = 'mindquest-windows-x64.zip'
$ReleaseUrl = "https://github.com/$Repository/releases/download/$Version"
$InstallDir = if ($env:MINDQUEST_INSTALL_DIR) {
    $env:MINDQUEST_INSTALL_DIR
} else {
    Join-Path $env:LOCALAPPDATA 'Programs\MindQuest'
}
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
    $ArchivePath = Join-Path $TempDir $Archive
    $ChecksumsPath = Join-Path $TempDir 'SHA256SUMS'
    Write-Host "Downloading MindQuest $Version for Windows x64..."
    Invoke-WebRequest -Uri "$ReleaseUrl/$Archive" -OutFile $ArchivePath
    Invoke-WebRequest -Uri "$ReleaseUrl/SHA256SUMS" -OutFile $ChecksumsPath

    $ChecksumLine = Get-Content $ChecksumsPath |
        Where-Object { $_ -match '^\s*([a-fA-F0-9]{64})\s+\*?mindquest-windows-x64\.zip$' } |
        Select-Object -First 1
    if (-not $ChecksumLine) {
        throw 'The release checksum file does not contain the Windows archive.'
    }

    $ExpectedHash = [regex]::Match($ChecksumLine, '^[\s]*([a-fA-F0-9]{64})').Groups[1].Value
    $ActualHash = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash
    if ($ActualHash -ne $ExpectedHash) {
        throw 'The downloaded archive failed SHA-256 verification.'
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $ArchivePath -DestinationPath $InstallDir -Force
    Set-Content -Path (Join-Path $InstallDir 'mindquest.cmd') `
        -Value '@echo off', '"%~dp0MindQuest.exe" %*' -Encoding Ascii

    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $PathEntries = @($UserPath -split ';' | Where-Object { $_ })
    if ($PathEntries -notcontains $InstallDir) {
        $UpdatedPath = (@($PathEntries) + $InstallDir) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $UpdatedPath, 'User')
    }
    if (($env:Path -split ';') -notcontains $InstallDir) {
        $env:Path = "$InstallDir;$env:Path"
    }

    Write-Host "Installed MindQuest to $InstallDir"
    Write-Host "Run: mindquest --port 8080 --no-https"
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force
}
