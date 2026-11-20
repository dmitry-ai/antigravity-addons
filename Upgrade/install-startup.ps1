# 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Write UTF-16 IShellLinkW shortcuts in Multi-Account and Upgrade PowerShell installers":
# https://github.com/dmitry-ai/antigravity-addons/issues/64
# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Replace ASAR/AST patching with external CDP companion daemon, standalone virtualized Folders tree, and LanguageServer RPC adapter for Antigravity 2.27.0+":
# https://github.com/dmitry-ai/antigravity-addons/issues/10
param([Parameter(Mandatory=$true)][string]$NodePath, [switch]$Remove)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'shortcut.ps1')
$startupDirectory = [Environment]::GetFolderPath('Startup')
if (-not $startupDirectory) {
	$startupDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
}
$shortcutPath = Join-Path $startupDirectory 'Antigravity Tools (CDP).lnk'
if ($Remove) {
	if (Test-Path -LiteralPath $shortcutPath) {
		Remove-Item -LiteralPath $shortcutPath
	}
}
else {
	Save-UnicodeShortcut `
		-ShortcutPath $shortcutPath `
		-TargetPath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
		-Arguments ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'run-companion.ps1') + '" -NodePath "' + $NodePath + '"') `
		-WorkingDirectory $PSScriptRoot `
		-WindowStyle 7 `
		-Description 'Attach CSS and Folders through CDP without modifying Antigravity'
}
Write-Output $shortcutPath
