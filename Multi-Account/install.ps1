# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
# 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
# https://github.com/dmitry-ai/antigravity-addons/issues/20
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-icon.ps1') | Out-Null
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
	$desktopPath = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders').Desktop
}
$wscriptPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$exeIcon = (Join-Path $env:LOCALAPPDATA 'Programs/antigravity/Antigravity.exe') + ',0'
$shell = New-Object -ComObject WScript.Shell
$a0Targets = @(
	(Join-Path $desktopPath 'A0.lnk')
)
$programsPath = [Environment]::GetFolderPath('Programs')
if (-not $programsPath) {
	$programsPath = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
}
if ($programsPath) {
	$startShortcut = Join-Path $programsPath 'Antigravity.lnk'
	if (Test-Path -LiteralPath $startShortcut) {
		$a0Targets += $startShortcut
	}
}
foreach ($target in $a0Targets) {
	$s = $shell.CreateShortcut($target)
	$s.TargetPath = $wscriptPath
	$s.Arguments = '"' + (Join-Path $PSScriptRoot 'launch_A0.vbs') + '"'
	$s.WorkingDirectory = $PSScriptRoot
	$s.Description = 'Antigravity A0 — primary account'
	$s.IconLocation = $exeIcon
	$s.Save()
	Write-Output $target
}
$shortcutPath = Join-Path $desktopPath 'A6.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptPath
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch_A6.vbs') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Antigravity A6 — admin6@mage2.pro; Chrome 6; isolated account'
$shortcut.IconLocation = (Join-Path $PSScriptRoot 'A6.ico') + ',0'
$shortcut.Save()
Write-Output $shortcutPath
