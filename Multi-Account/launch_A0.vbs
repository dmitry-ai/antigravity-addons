' 2026-11-05 Dmitrii Fediuk https://github.com/dmitrii-fediuk
' "Implement cross-profile auto-update guard (M-2) and unified main-process bootstrap for A0 and A6":
' https://github.com/dmitry-ai/antigravity-addons/issues/20
Option Explicit
Dim sh, fso, script
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "launch.ps1")
sh.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Profile A0", 0, False
