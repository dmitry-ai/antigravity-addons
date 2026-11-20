# 2026-11-20 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Write UTF-16 IShellLinkW shortcuts in Multi-Account and Upgrade PowerShell installers":
# https://github.com/dmitry-ai/antigravity-addons/issues/64
if (-not ('AntigravityUnicodeShortcut' -as [type])) {
	Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class AntigravityShellLinkCoClass {}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
internal interface IAntigravityShellLinkW {
	void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags);
	void GetIDList(out IntPtr ppidl);
	void SetIDList(IntPtr pidl);
	void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
	void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
	void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
	void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
	void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
	void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
	void GetHotkey(out short pwHotkey);
	void SetHotkey(short wHotkey);
	void GetShowCmd(out int piShowCmd);
	void SetShowCmd(int iShowCmd);
	void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
	void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
	void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
	void Resolve(IntPtr hwnd, int fFlags);
	void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
}

public static class AntigravityUnicodeShortcut {
	public static void Save(string shortcutPath, string targetPath, string arguments, string workingDirectory, string description, string iconPath, int iconIndex, int windowStyle) {
		var link = (IAntigravityShellLinkW)new AntigravityShellLinkCoClass();
		try {
			link.SetPath(targetPath);
			link.SetArguments(arguments ?? string.Empty);
			link.SetWorkingDirectory(workingDirectory ?? string.Empty);
			if (!string.IsNullOrEmpty(description)) {
				link.SetDescription(description);
			}
			if (!string.IsNullOrEmpty(iconPath)) {
				link.SetIconLocation(iconPath, iconIndex);
			}
			if (windowStyle > 0) {
				link.SetShowCmd(windowStyle);
			}
			((IPersistFile)link).Save(shortcutPath, true);
		}
		finally {
			Marshal.FinalReleaseComObject(link);
		}
	}

	public static string[] Read(string shortcutPath) {
		var link = (IAntigravityShellLinkW)new AntigravityShellLinkCoClass();
		try {
			((IPersistFile)link).Load(shortcutPath, 0);
			var target = new StringBuilder(2048);
			var args = new StringBuilder(4096);
			var cwd = new StringBuilder(2048);
			var desc = new StringBuilder(2048);
			var icon = new StringBuilder(2048);
			int iconIndex;
			int showCmd;
			link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
			link.GetArguments(args, args.Capacity);
			link.GetWorkingDirectory(cwd, cwd.Capacity);
			link.GetDescription(desc, desc.Capacity);
			link.GetIconLocation(icon, icon.Capacity, out iconIndex);
			link.GetShowCmd(out showCmd);
			return new string[] {
				target.ToString(),
				args.ToString(),
				cwd.ToString(),
				desc.ToString(),
				icon.Length > 0 ? (icon.ToString() + "," + iconIndex.ToString()) : string.Empty,
				showCmd.ToString()
			};
		}
		finally {
			Marshal.FinalReleaseComObject(link);
		}
	}
}
'@
}

function Save-UnicodeShortcut {
	param(
		[Parameter(Mandatory=$true)][string]$ShortcutPath,
		[Parameter(Mandatory=$true)][string]$TargetPath,
		[string]$Arguments = '',
		[string]$WorkingDirectory = '',
		[string]$Description = '',
		[string]$IconLocation = '',
		[int]$WindowStyle = 1
	)
	$parentDir = Split-Path -Parent $ShortcutPath
	if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
		New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
	}
	$iconPath = ''
	$iconIndex = 0
	if ($IconLocation) {
		$comma = $IconLocation.LastIndexOf(',')
		if ($comma -gt 0 -and [int]::TryParse($IconLocation.Substring($comma + 1), [ref]$iconIndex)) {
			$iconPath = $IconLocation.Substring(0, $comma)
		}
		else {
			$iconPath = $IconLocation
		}
	}
	[AntigravityUnicodeShortcut]::Save($ShortcutPath, $TargetPath, $Arguments, $WorkingDirectory, $Description, $iconPath, $iconIndex, $WindowStyle)
}

function Read-UnicodeShortcut {
	param([Parameter(Mandatory=$true)][string]$ShortcutPath)
	$fields = [AntigravityUnicodeShortcut]::Read($ShortcutPath)
	return [pscustomobject]@{
		TargetPath = $fields[0]
		Arguments = $fields[1]
		WorkingDirectory = $fields[2]
		Description = $fields[3]
		IconLocation = $fields[4]
		WindowStyle = [int]$fields[5]
	}
}
