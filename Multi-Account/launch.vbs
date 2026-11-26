' 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
Option Explicit
Dim fso, nodePath, pattern, profile, root, script, sh, cmd, idx, arg
' 2026-11-14
' "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
' https://github.com/dmitry-ai/antigravity-addons/issues/26
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
' 2026-11-19
' "Bridge Upgrade and OAuth renderer attach through main-process WebContents debugger":
' https://github.com/dmitry-ai/antigravity-addons/issues/52
cmd = """" & nodePath & """ """ & script & """ " & profile
For idx = 1 To WScript.Arguments.Count - 1
	arg = Replace(WScript.Arguments(idx), """", "\""")
	cmd = cmd & " """ & arg & """"
Next
sh.Run cmd, 0, False
