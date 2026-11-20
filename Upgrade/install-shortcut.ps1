# 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Write UTF-16 IShellLinkW shortcuts in Multi-Account and Upgrade PowerShell installers":
# https://github.com/dmitry-ai/antigravity-addons/issues/64
# 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
# https://github.com/dmitry-ai/antigravity-addons/issues/6
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shortcut.ps1')
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
	$desktopPath = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders').Desktop
}
$shortcutPath = Join-Path $desktopPath 'Upg.lnk'
$antigravityIcon = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
$iconLocation = if (Test-Path -LiteralPath $antigravityIcon) { $antigravityIcon + ',0' } else { '' }
Save-UnicodeShortcut `
	-ShortcutPath $shortcutPath `
	-TargetPath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
	-Arguments ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'run-upgrade.ps1') + '"') `
	-WorkingDirectory $PSScriptRoot `
	-Description 'Restore Antigravity tools after update' `
	-IconLocation $iconLocation
Write-Host $shortcutPath
