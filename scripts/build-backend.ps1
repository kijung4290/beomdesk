$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
& (Join-Path $projectRoot '.tools/python311/python.exe') (Join-Path $projectRoot 'build_backend.py')
if($LASTEXITCODE -ne 0){throw 'Backend build failed'}
