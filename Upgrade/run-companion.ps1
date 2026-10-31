# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
# https://github.com/dmitry-ai/antigravity-addons/issues/10
param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$runtimePath = Join-Path $PSScriptRoot 'cdp-companion.js'
Start-Process -FilePath $NodePath -ArgumentList @('"' + $runtimePath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
