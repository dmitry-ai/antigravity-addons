$ErrorActionPreference = 'Stop'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'A6.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'launch_A6.vbs') + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Antigravity A6 — admin6@mage2.pro; Chrome 6; isolated account'
$chromeShortcut = $shell.CreateShortcut((Join-Path $desktopPath '6.lnk'))
$shortcut.IconLocation = $chromeShortcut.IconLocation
$shortcut.Save()
Write-Output $shortcutPath
