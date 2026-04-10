Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[setup] $Message"
}

function Find-CommandPath {
  param(
    [string[]]$Candidates
  )

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  return $null
}

function Find-NpmPath {
  $candidates = @(
    'npm.cmd',
    'C:\Program Files\nodejs\npm.cmd',
    'npm'
  )

  return Find-CommandPath -Candidates $candidates
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $combined = @($machinePath, $userPath) -join ';'
  if (-not [string]::IsNullOrWhiteSpace($combined)) {
    $env:Path = $combined
  }
}

function Invoke-WingetCommand {
  param(
    [string[]]$Arguments
  )

  $wingetPath = Find-CommandPath @('winget')
  if (-not $wingetPath) {
    throw 'WinGet was not found.'
  }

  $output = & $wingetPath @Arguments 2>&1
  $exitCode = $LASTEXITCODE

  return [pscustomobject]@{
    Output = @($output)
    ExitCode = $exitCode
  }
}

function Install-WithWinget {
  param(
    [string]$PackageId,
    [string]$DisplayName
  )

  $wingetPath = Find-CommandPath @('winget')
  if (-not $wingetPath) {
    throw "$DisplayName is missing and WinGet was not found. Install WinGet/App Installer or install $DisplayName manually, then run .\setup.cmd again."
  }

  Write-Step "Installing $DisplayName with WinGet ($PackageId)"
  $arguments = @(
    'install',
    '--exact',
    '--id', $PackageId,
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--silent'
  )

  $result = Invoke-WingetCommand -Arguments $arguments
  if ($result.ExitCode -ne 0) {
    $outputText = ($result.Output -join [Environment]::NewLine).Trim()
    $hasSourceError = $outputText -match 'Failed when opening source\(s\)' -or
      $outputText -match 'source reset'

    if ($hasSourceError) {
      Write-Step "WinGet source error detected while installing $DisplayName. Resetting sources and retrying once."
      $resetResult = Invoke-WingetCommand -Arguments @('source', 'reset', '--force')
      if ($resetResult.ExitCode -ne 0) {
        $resetOutput = ($resetResult.Output -join [Environment]::NewLine).Trim()
        throw "WinGet source reset failed while installing $DisplayName.`n$resetOutput"
      }

      $result = Invoke-WingetCommand -Arguments $arguments
    }
  }

  if ($result.ExitCode -ne 0) {
    $finalOutput = ($result.Output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($finalOutput)) {
      throw "WinGet failed to install $DisplayName ($PackageId)."
    }

    throw "WinGet failed to install $DisplayName ($PackageId).`n$finalOutput"
  }

  Refresh-ProcessPath
}

function Set-EnvValue {
  param(
    [hashtable]$Map,
    [string]$Key,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }

  $Map[$Key] = $Value
}

function Get-EnvValueOrDefault {
  param(
    [hashtable]$Map,
    [string]$Key,
    [string]$DefaultValue
  )

  if ($Map.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($Map[$Key])) {
    return $Map[$Key]
  }

  return $DefaultValue
}

function Read-EnvFile {
  param([string]$Path)

  $map = [ordered]@{}

  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      continue
    }

    $name, $value = $line -split '=', 2
    $map[$name.Trim()] = $value.Trim()
  }

  return $map
}

function Start-WebUi {
  param(
    [string]$RepoRoot,
    [string]$NpmPath,
    [string]$WebHost,
    [string]$WebPort
  )

  Write-Step "Starting web UI server"
  $startInfo = @{
    FilePath = $NpmPath
    ArgumentList = @('run', 'web-ui')
    WorkingDirectory = $RepoRoot
    WindowStyle = 'Normal'
  }
  Start-Process @startInfo | Out-Null

  $url = "http://${WebHost}:${WebPort}"
  Start-Sleep -Seconds 2
  Write-Step "Opening $url"
  Start-Process $url | Out-Null
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

Write-Step "Repository root: $repoRoot"

Refresh-ProcessPath

$envPath = Join-Path $repoRoot '.env'
$existingEnv = Read-EnvFile $envPath

$nodePath = Find-CommandPath @('node')
$npmPath = Find-NpmPath
$ffmpegPath = Find-CommandPath @(
  $env:FFMPEG_PATH,
  $existingEnv['FFMPEG_PATH'],
  'C:\ffmpeg\bin\ffmpeg.exe',
  'ffmpeg'
)
$ffprobePath = Find-CommandPath @(
  $env:FFPROBE_PATH,
  $existingEnv['FFPROBE_PATH'],
  'C:\ffmpeg\bin\ffprobe.exe',
  'ffprobe'
)
$whisperPath = Find-CommandPath @(
  $env:WHISPER_COMMAND_PATH,
  $existingEnv['WHISPER_COMMAND_PATH'],
  (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3.14-64\Scripts\whisper.exe'),
  'whisper'
)

if (-not $nodePath) {
  Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
  $nodePath = Find-CommandPath @('node', 'C:\Program Files\nodejs\node.exe')
  $npmPath = Find-NpmPath
}

if (-not $npmPath) {
  Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -DisplayName 'Node.js LTS'
  $nodePath = Find-CommandPath @('node', 'C:\Program Files\nodejs\node.exe')
  $npmPath = Find-NpmPath
}

if (-not $nodePath) {
  throw "Node.js 20+ is required but was not found after installation. Reopen PowerShell and run .\setup.cmd again."
}

if (-not $npmPath) {
  throw "npm was not found after Node.js installation. Reopen PowerShell and run .\setup.cmd again."
}

if (-not $ffmpegPath) {
  Install-WithWinget -PackageId 'Gyan.FFmpeg' -DisplayName 'ffmpeg'
  $ffmpegPath = Find-CommandPath @(
    $env:FFMPEG_PATH,
    $existingEnv['FFMPEG_PATH'],
    'C:\ffmpeg\bin\ffmpeg.exe',
    'ffmpeg'
  )
  $ffprobePath = Find-CommandPath @(
    $env:FFPROBE_PATH,
    $existingEnv['FFPROBE_PATH'],
    'C:\ffmpeg\bin\ffprobe.exe',
    'ffprobe'
  )
}

if (-not $ffprobePath) {
  Install-WithWinget -PackageId 'Gyan.FFmpeg' -DisplayName 'ffmpeg'
  $ffmpegPath = Find-CommandPath @(
    $env:FFMPEG_PATH,
    $existingEnv['FFMPEG_PATH'],
    'C:\ffmpeg\bin\ffmpeg.exe',
    'ffmpeg'
  )
  $ffprobePath = Find-CommandPath @(
    $env:FFPROBE_PATH,
    $existingEnv['FFPROBE_PATH'],
    'C:\ffmpeg\bin\ffprobe.exe',
    'ffprobe'
  )
}

if (-not $ffmpegPath) {
  throw "ffmpeg was not found after installation. Reopen PowerShell and run .\setup.cmd again."
}

if (-not $ffprobePath) {
  throw "ffprobe was not found after ffmpeg installation. Reopen PowerShell and run .\setup.cmd again."
}

$envMap = [ordered]@{}

if (Test-Path -LiteralPath $envPath) {
  Write-Step "Updating existing .env"
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      continue
    }

    $name, $value = $line -split '=', 2
    $envMap[$name.Trim()] = $value.Trim()
  }
} else {
  Write-Step "Creating .env"
}

Set-EnvValue $envMap 'FFMPEG_PATH' $ffmpegPath
Set-EnvValue $envMap 'FFPROBE_PATH' $ffprobePath
Set-EnvValue $envMap 'WHISPER_COMMAND_PATH' $whisperPath
Set-EnvValue $envMap 'WEB_UI_HOST' (Get-EnvValueOrDefault $envMap 'WEB_UI_HOST' '127.0.0.1')
Set-EnvValue $envMap 'WEB_UI_PORT' (Get-EnvValueOrDefault $envMap 'WEB_UI_PORT' '3000')
Set-EnvValue $envMap 'WEB_UI_WORKSPACE_ROOT' (Get-EnvValueOrDefault $envMap 'WEB_UI_WORKSPACE_ROOT' '.tmp-web-ui')

$envLines = @(
  "# Generated by scripts/setup.ps1",
  "FFMPEG_PATH=$($envMap['FFMPEG_PATH'])",
  "FFPROBE_PATH=$($envMap['FFPROBE_PATH'])",
  "WHISPER_COMMAND_PATH=$($envMap['WHISPER_COMMAND_PATH'])",
  "WEB_UI_HOST=$($envMap['WEB_UI_HOST'])",
  "WEB_UI_PORT=$($envMap['WEB_UI_PORT'])",
  "WEB_UI_WORKSPACE_ROOT=$($envMap['WEB_UI_WORKSPACE_ROOT'])"
)

Set-Content -LiteralPath $envPath -Value $envLines -Encoding UTF8
Write-Step "Wrote .env"

Write-Step "Installing npm dependencies"
& $npmPath install
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed."
}

Write-Step "Setup complete"
Write-Host ""
$whisperDisplay = $whisperPath
if (-not $whisperDisplay) {
  $whisperDisplay = 'not found (optional)'
}
Write-Host "Detected tools:"
Write-Host "  node:    $nodePath"
Write-Host "  npm:     $npmPath"
Write-Host "  ffmpeg:  $ffmpegPath"
Write-Host "  ffprobe: $ffprobePath"
Write-Host "  whisper: $whisperDisplay"
Write-Host ""
if (-not $whisperPath) {
  Write-Host "Whisper was not found. Subtitle generation from uploaded media will need either:"
  Write-Host "  - an uploaded script.whisper.srt file, or"
  Write-Host "  - Whisper installed and available later via WHISPER_COMMAND_PATH or PATH"
  Write-Host ""
}
Write-Host "Starting web UI automatically..."
Start-WebUi -RepoRoot $repoRoot -NpmPath $npmPath -WebHost $envMap['WEB_UI_HOST'] -WebPort $envMap['WEB_UI_PORT']
