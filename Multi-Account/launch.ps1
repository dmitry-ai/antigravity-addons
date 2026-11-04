# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
# 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
# https://github.com/dmitry-ai/antigravity-addons/issues/20
param([ValidatePattern('^A\d+$')][string]$Profile = 'A6')
$ErrorActionPreference = 'Stop'
$nodePath = 'C:/tools/nodejs/node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) {
	throw "Node.js is missing: $nodePath"
}
& $nodePath (Join-Path $PSScriptRoot 'launcher.js') $Profile
if ($LASTEXITCODE) {
	$dir = if ('A0' -eq $Profile) {'Antigravity'} else {"Antigravity-$Profile"}
	throw "Antigravity $Profile launcher failed (exit $LASTEXITCODE). See $env:APPDATA/$dir/launcher.log"
}
