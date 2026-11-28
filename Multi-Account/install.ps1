# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
$ErrorActionPreference = 'Stop'
# 2026-11-20
# "Write UTF-16 IShellLinkW shortcuts in Multi-Account and Upgrade PowerShell installers":
# https://github.com/dmitry-ai/antigravity-addons/issues/64
. (Join-Path $PSScriptRoot '..\Upgrade\shortcut.ps1')
# 2026-10-28
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
& (Join-Path $PSScriptRoot 'build-icon.ps1') | Out-Null
$desktopPath = [Environment]::GetFolderPath('Desktop')
# 2026-10-30
# "Extract Antigravity Addons into standalone code and meta (_) repositories, flatten tool directories, and prevent A6 working-directory locks":
# https://github.com/dmitry-ai/antigravity-addons/issues/15
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
# 2026-11-14
# "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
# https://github.com/dmitry-ai/antigravity-addons/issues/26
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'profiles.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($profile in $config.profiles) {
	# 2026-11-28 "Add ProfileRepository and ProfileProvisioner CLI with duplicate checks": https://github.com/dmitry-ai/antigravity-addons/issues/77
	if ($false -eq $profile.enabled) {
		continue
	}
	if ('A0' -ne $profile.id) {
		$shortcutPath = Join-Path $desktopPath ($profile.id + '.lnk')
		Save-UnicodeShortcut `
			-ShortcutPath $shortcutPath `
			-TargetPath $wscriptPath `
			-Arguments ('"' + $launchScript + '" ' + $profile.id) `
			-WorkingDirectory $PSScriptRoot `
			-Description "Antigravity $($profile.id) $dash $($profile.email); Chrome $($profile.chromeShortcut); isolated account" `
			-IconLocation ((Join-Path $PSScriptRoot ($profile.id + '.ico')) + ',0')
		Write-Output $shortcutPath
	}
	else {
		# 2026-11-05
		# "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
		# https://github.com/dmitry-ai/antigravity-addons/issues/20
		$targets = @((Join-Path $desktopPath 'A0.lnk'))
		if ($programsPath) {
			$startShortcut = Join-Path $programsPath 'Antigravity.lnk'
			if (Test-Path -LiteralPath $startShortcut) {
				$targets += $startShortcut
			}
		}
		foreach ($target in $targets) {
			Save-UnicodeShortcut `
				-ShortcutPath $target `
				-TargetPath $wscriptPath `
				-Arguments ('"' + $launchScript + '" A0') `
				-WorkingDirectory $PSScriptRoot `
				-Description "Antigravity A0 $dash primary account" `
				-IconLocation $exeIcon
			Write-Output $target
		}
	}
}
# 2026-11-19
# "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
# https://github.com/dmitry-ai/antigravity-addons/issues/52
$protocolKey = 'HKCU:\Software\Classes\antigravity'
$commandKey = Join-Path $protocolKey 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $protocolKey -Name '(Default)' -Value 'URL:Antigravity Protocol'
Set-ItemProperty -Path $protocolKey -Name 'URL Protocol' -Value ''
$protocolCmd = '"' + $wscriptPath + '" "' + $launchScript + '" A0 "%1"'
Set-ItemProperty -Path $commandKey -Name '(Default)' -Value $protocolCmd
Write-Output $commandKey
