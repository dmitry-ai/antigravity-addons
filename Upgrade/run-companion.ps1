param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$runtimePath = Join-Path $PSScriptRoot 'cdp-companion.js'
Start-Process -FilePath $NodePath -ArgumentList @('"' + $runtimePath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
