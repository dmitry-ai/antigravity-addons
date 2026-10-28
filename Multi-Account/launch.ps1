param([ValidatePattern('^A\d+$')][string]$Profile = 'A6')
$ErrorActionPreference = 'Stop'
$nodePath = 'C:/tools/nodejs/node.exe'
if (-not (Test-Path -LiteralPath $nodePath)) { throw "Node.js is missing: $nodePath" }
& $nodePath (Join-Path $PSScriptRoot 'launcher.js') $Profile
if ($LASTEXITCODE) { throw "Antigravity $Profile launcher failed (exit $LASTEXITCODE). See $env:APPDATA/Antigravity-$Profile/launcher.log" }
