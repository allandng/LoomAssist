<#
.SYNOPSIS
    Start the LoomAssist backend (FastAPI) on Windows.

.DESCRIPTION
    Creates backend-api\venv if it is missing, installs requirements.txt,
    then runs uvicorn on 127.0.0.1:8000. Idempotent: safe to re-run.

.PARAMETER Reload
    Pass -Reload to enable uvicorn auto-reload (development).

.PARAMETER Port
    TCP port to listen on (default 8000).

.PARAMETER SkipInstall
    Skip `pip install -r requirements.txt` (faster restarts once installed).

.EXAMPLE
    .\run.ps1                # production-style start
    .\run.ps1 -Reload        # dev start with auto-reload
#>
[CmdletBinding()]
param(
    [switch]$Reload,
    [int]$Port = 8000,
    [string]$BindHost = "127.0.0.1",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$venvPython = Join-Path $here "venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "[run.ps1] Creating virtual environment in $here\venv ..."
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        & py -3 -m venv venv
    } else {
        & python -m venv venv
    }
    if (-not (Test-Path $venvPython)) {
        throw "[run.ps1] venv creation failed - is Python 3.13+ installed and on PATH?"
    }
}

if (-not $SkipInstall) {
    Write-Host "[run.ps1] Installing requirements ..."
    & $venvPython -m pip install --upgrade pip --quiet
    & $venvPython -m pip install -r requirements.txt --quiet
}

$uvicornArgs = @("-m", "uvicorn", "main:app", "--host", $BindHost, "--port", "$Port")
if ($Reload) { $uvicornArgs += "--reload" }

Write-Host "[run.ps1] Starting LoomAssist backend on http://$BindHost`:$Port  (reload=$($Reload.IsPresent))"
& $venvPython @uvicornArgs
