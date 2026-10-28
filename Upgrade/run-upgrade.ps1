param([switch]$Check, [switch]$Restore, [switch]$NoPause)
$ErrorActionPreference = 'Stop'
$exitStatus = 1
try {
	$nodeCommand = Get-Command node.exe -ErrorAction Stop
	$nodeVersion = [version](& $nodeCommand.Source -p 'process.versions.node')
	if ([version]'22.12.0' -gt $nodeVersion) {
		throw 'Требуется Node.js 22.12.0 или новее.'
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
				throw 'Не удалось установить зависимости. Проверьте доступ к npm.'
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
	[void](Read-Host 'Нажмите Enter, чтобы закрыть это окно')
}
exit $exitStatus
