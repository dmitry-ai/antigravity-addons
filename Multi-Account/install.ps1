# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
# 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
# https://github.com/dmitry-ai/antigravity-addons/issues/20
# 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
# https://github.com/dmitry-ai/antigravity-addons/issues/26
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-icon.ps1') | Out-Null
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
	$desktopPath = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders').Desktop
}
$programsPath = [Environment]::GetFolderPath('Programs')
if (-not $programsPath) {
	$programsPath = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
}
$wscriptPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$launchScript = Join-Path $PSScriptRoot 'launch.vbs'
$exeIcon = (Join-Path $env:LOCALAPPDATA 'Programs/antigravity/Antigravity.exe') + ',0'
$dash = [char]0x2014
$shell = New-Object -ComObject WScript.Shell
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'profiles.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($profile in $config.profiles) {
	if ('A0' -ne $profile.id) {
		$shortcutPath = Join-Path $desktopPath ($profile.id + '.lnk')
		$shortcut = $shell.CreateShortcut($shortcutPath)
		$shortcut.TargetPath = $wscriptPath
		$shortcut.Arguments = '"' + $launchScript + '" ' + $profile.id
		$shortcut.WorkingDirectory = $PSScriptRoot
		$shortcut.Description = "Antigravity $($profile.id) $dash $($profile.email); Chrome $($profile.chromeShortcut); isolated account"
		$shortcut.IconLocation = (Join-Path $PSScriptRoot ($profile.id + '.ico')) + ',0'
		$shortcut.Save()
		Write-Output $shortcutPath
	}
	else {
		$targets = @((Join-Path $desktopPath 'A0.lnk'))
		if ($programsPath) {
			$startShortcut = Join-Path $programsPath 'Antigravity.lnk'
			if (Test-Path -LiteralPath $startShortcut) {
				$targets += $startShortcut
			}
		}
		foreach ($target in $targets) {
			$shortcut = $shell.CreateShortcut($target)
			$shortcut.TargetPath = $wscriptPath
			$shortcut.Arguments = '"' + $launchScript + '" A0'
			$shortcut.WorkingDirectory = $PSScriptRoot
			$shortcut.Description = "Antigravity A0 $dash primary account"
			$shortcut.IconLocation = $exeIcon
			$shortcut.Save()
			Write-Output $target
		}
	}
}
