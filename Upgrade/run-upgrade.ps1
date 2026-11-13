# 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
# https://github.com/dmitry-ai/antigravity-addons/issues/6
# 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Replace Less build pipeline and tracked CSS/style.css with native Chromium CSS concatenated in memory":
# https://github.com/dmitry-ai/antigravity-addons/issues/43
param([switch]$Check, [switch]$Restore, [switch]$NoPause)
$ErrorActionPreference = 'Stop'
$exitStatus = 1
try {
	$nodeCommand = Get-Command node.exe -ErrorAction Stop
	$nodeVersion = [version](& $nodeCommand.Source -p 'process.versions.node')
	if ([version]'22.12.0' -gt $nodeVersion) {
		throw 'Node.js 22.12.0 or newer is required.'
	}
	$argumentsList = @((Join-Path $PSScriptRoot 'upgrade.js'))
	if ($Check) {
		$argumentsList += '--check'
	}
	if ($Restore) {
		$argumentsList += '--restore'
	}
	& $nodeCommand.Source @argumentsList
	$exitStatus = $LASTEXITCODE
}
catch {
	Write-Host $_.Exception.Message -ForegroundColor Red
}
if (-not $NoPause) {
	[void](Read-Host 'Press Enter to close this window')
}
exit $exitStatus
