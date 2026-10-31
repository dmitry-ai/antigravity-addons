' 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
' "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
' https://github.com/dmitry-ai/antigravity-addons/issues/12
Option Explicit
Dim sh, fso, script
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Profile A6", 0, False
