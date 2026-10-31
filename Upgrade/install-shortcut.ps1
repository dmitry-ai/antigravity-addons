# 2026-10-13 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Build unified Upgrade tool (Upg), module registry (tool.json), Less stylesheet build pipeline, and verification runner after Antigravity 2.23.0 update":
# https://github.com/dmitry-ai/antigravity-addons/issues/6
$ErrorActionPreference = 'Stop'
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
	$desktopPath = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders').Desktop
}
$shortcutPath = Join-Path $desktopPath 'Upg.lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'run-upgrade.ps1') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Restore Antigravity tools after update'
$antigravityIcon = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
if (Test-Path -LiteralPath $antigravityIcon) {
	$shortcut.IconLocation = $antigravityIcon + ',0'
}
$shortcut.Save()
Write-Host $shortcutPath
