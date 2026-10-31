# 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
# https://github.com/dmitry-ai/antigravity-addons/issues/6
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
	$requiredPackages = @('less')
	$missingPackages = @($requiredPackages | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot ('node_modules\' + $_ + '\package.json'))) })
	if (0 -lt $missingPackages.Count) {
		Push-Location -LiteralPath $PSScriptRoot
		try {
			& npm.cmd ci --ignore-scripts --no-audit --no-fund
			if (0 -ne $LASTEXITCODE) {
				throw 'Failed to install dependencies. Check npm access.'
			}
		}
		finally {
			Pop-Location
		}
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
