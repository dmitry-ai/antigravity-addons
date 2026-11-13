' 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
' "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
' https://github.com/dmitry-ai/antigravity-addons/issues/26
Option Explicit
Dim fso, nodePath, pattern, profile, root, script, sh
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
profile = "A6"
If 0 < WScript.Arguments.Count Then
	profile = WScript.Arguments(0)
End If
Set pattern = New RegExp
pattern.Pattern = "^A\d+$"
If Not pattern.Test(profile) Then
	Err.Raise 5, "launch.vbs", "Invalid Antigravity profile: " & profile
End If
nodePath = "C:\tools\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then
	nodePath = "node.exe"
End If
root = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(root, "launcher.js")
sh.Run """" & nodePath & """ """ & script & """ " & profile, 0, False
