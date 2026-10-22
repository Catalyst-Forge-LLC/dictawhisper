param([string]$Python = 'python', [switch]$Cpu)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
function RunChecked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Program (exit $LASTEXITCODE)" }
}
RunChecked $Python @('-c', 'import sys; assert sys.version_info[:2] == (3,11), "Bark setup requires Python 3.11; pass -Python with its full path."')
$environment = Join-Path $project '.venv-bark'
if (!(Test-Path -LiteralPath (Join-Path $environment 'Scripts/python.exe'))) {
    RunChecked $Python @('-m', 'venv', $environment)
}
$barkPython = Join-Path $environment 'Scripts/python.exe'
$wheelIndex = if ($Cpu) {'https://download.pytorch.org/whl/cpu'} else {'https://download.pytorch.org/whl/cu128'}
RunChecked $barkPython @('-m', 'pip', 'install', 'torch==2.8.0', '--index-url', $wheelIndex)
RunChecked $barkPython @('-m', 'pip', 'install', '-r', (Join-Path $PSScriptRoot 'requirements-bark.txt'))
RunChecked $barkPython @((Join-Path $PSScriptRoot 'setup_bark.py'), '--model-dir', (Join-Path $project 'data/models/bark-pro'))
RunChecked $barkPython @((Join-Path $PSScriptRoot 'transcribe_bark.py'), '--check')
Write-Output 'Bark Pro installed separately. Restart DictaWhisper to test it from Improve audio & retranscribe.'
