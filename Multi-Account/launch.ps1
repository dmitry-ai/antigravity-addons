# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
param([ValidatePattern('^A\d+$')][string]$Profile = 'A6')
$ErrorActionPreference = 'Stop'
$nodePath = 'C:/tools/nodejs/node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
	throw "Node.js is missing: $nodePath"
}
& $nodePath (Join-Path $PSScriptRoot 'launcher.js') $Profile
if ($LASTEXITCODE) {
	throw "Antigravity $Profile launcher failed (exit $LASTEXITCODE). See $env:APPDATA/Antigravity-$Profile/launcher.log"
}
