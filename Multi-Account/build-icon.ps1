# 2026-10-11 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Prototype multi-account Antigravity instances A1 and A2 with Windows user isolation, composite profile badge icons, and Chrome OAuth routing":
# https://github.com/dmitry-ai/antigravity-addons/issues/1
# 2026-10-28 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Implement same-user isolated profile A6 with headless file-based token storage, OAuth callback bridge, window-identity badge icon, and sidebar section filters":
# https://github.com/dmitry-ai/antigravity-addons/issues/12
# 2026-11-14 Dmitrii Fediuk https://github.com/dmitrii-fediuk
# "Replace bootstrap.toString() injection with require, deduplicate Electron window hooks, split update-guard.js, and parameterize scripts from profiles.json":
# https://github.com/dmitry-ai/antigravity-addons/issues/26
param([string]$ProfileId = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktopPath = [Environment]::GetFolderPath('Desktop')
if (-not $desktopPath) {
	$desktopPath = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders').Desktop
}
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'profiles.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$profiles = @($config.profiles | Where-Object { 'A0' -ne $_.id -and (-not $ProfileId -or $ProfileId -eq $_.id) })
if (0 -eq $profiles.Count) {
	throw 'No matching secondary profiles in profiles.json'
}
$archivePath = Join-Path $env:LOCALAPPDATA 'Programs/antigravity/resources/app.asar'
$archive = [IO.File]::ReadAllBytes($archivePath)
$headerSize = [BitConverter]::ToUInt32($archive, 4)
$jsonSize = [BitConverter]::ToUInt32($archive, 12)
$header = [Text.Encoding]::UTF8.GetString($archive, 16, $jsonSize) | ConvertFrom-Json
$entry = $header.files.'icon.png'
if (-not $entry -or $entry.unpacked) {
	throw 'The installed Antigravity icon was not found in ASAR'
}
$offset = 8 + $headerSize + [long]$entry.offset
if (0 -gt $offset -or ($offset + $entry.size) -gt $archive.Length) {
	throw 'Invalid ASAR icon bounds'
}
$shell = New-Object -ComObject WScript.Shell
$stream = New-Object IO.MemoryStream
$appImage = $null
try {
	$stream.Write($archive, $offset, $entry.size)
	$stream.Position = 0
	$appImage = [Drawing.Image]::FromStream($stream)
	$sizes = @(16, 24, 32, 48, 64, 128, 256)
	foreach ($profile in $profiles) {
		$shortcut = $shell.CreateShortcut((Join-Path $desktopPath ($profile.chromeShortcut + '.lnk')))
		$profileIconPath = ($shortcut.IconLocation -replace ',-?\d+$', '').Trim('"')
		if (-not (Test-Path -LiteralPath $profileIconPath)) {
			throw "Chrome $($profile.chromeShortcut) icon is missing: $profileIconPath"
		}
		$profileIcon = $null
		$profileBitmap = $null
		$canvas = $null
		$graphics = $null
		$badge = $null
		$badgeGraphics = $null
		$brush = $null
		try {
			$profileIcon = [Drawing.Icon]::new($profileIconPath, 256, 256)
			$profileBitmap = $profileIcon.ToBitmap()
			$canvas = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
			$graphics = [Drawing.Graphics]::FromImage($canvas)
			$graphics.Clear([Drawing.Color]::Transparent)
			$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
			$graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
			$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
			$graphics.DrawImage($appImage, [Drawing.Rectangle]::new(0, 0, 256, 256))
			$badge = [Drawing.Bitmap]::new(128, 128, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
			$badgeGraphics = [Drawing.Graphics]::FromImage($badge)
			$badgeGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
			$badgeGraphics.DrawImage($profileBitmap, [Drawing.Rectangle]::new(0, 0, 128, 128), [Drawing.Rectangle]::new($profileBitmap.Width / 2, $profileBitmap.Height / 2, $profileBitmap.Width / 2, $profileBitmap.Height / 2), [Drawing.GraphicsUnit]::Pixel)
			$brush = [Drawing.TextureBrush]::new($badge, [Drawing.Drawing2D.WrapMode]::Clamp)
			$brush.TranslateTransform(128, 128)
			$graphics.FillEllipse($brush, 128, 128, 128, 128)
			$canvas.Save((Join-Path $PSScriptRoot ($profile.id + '.png')), [Drawing.Imaging.ImageFormat]::Png)
			$frames = @()
			foreach ($size in $sizes) {
				$frame = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
				$frameGraphics = [Drawing.Graphics]::FromImage($frame)
				$memory = New-Object IO.MemoryStream
				try {
					$frameGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
					$frameGraphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
					$frameGraphics.DrawImage($canvas, [Drawing.Rectangle]::new(0, 0, $size, $size))
					$frame.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
					$frames += ,$memory.ToArray()
				}
				finally {
					$memory.Dispose()
					$frameGraphics.Dispose()
					$frame.Dispose()
				}
			}
			$icoPath = Join-Path $PSScriptRoot ($profile.id + '.ico')
			$output = [IO.File]::Create($icoPath)
			$writer = [IO.BinaryWriter]::new($output)
			try {
				$writer.Write([uint16]0)
				$writer.Write([uint16]1)
				$writer.Write([uint16]$sizes.Count)
				$position = 6 + 16 * $sizes.Count
				for ($index = 0; $index -lt $sizes.Count; $index++) {
					$dimension = if (256 -eq $sizes[$index]) { 0 } else { $sizes[$index] }
					$writer.Write([byte]$dimension)
					$writer.Write([byte]$dimension)
					$writer.Write([byte]0)
					$writer.Write([byte]0)
					$writer.Write([uint16]1)
					$writer.Write([uint16]32)
					$writer.Write([uint32]$frames[$index].Length)
					$writer.Write([uint32]$position)
					$position += $frames[$index].Length
				}
				foreach ($bytes in $frames) {
					$writer.Write([byte[]]$bytes)
				}
			}
			finally {
				$writer.Dispose()
				$output.Dispose()
			}
			Write-Output $icoPath
		}
		finally {
			foreach ($resource in @($brush, $badgeGraphics, $badge, $graphics, $canvas, $profileBitmap, $profileIcon)) {
				if ($null -ne $resource) {
					$resource.Dispose()
				}
			}
		}
	}
}
finally {
	foreach ($resource in @($appImage, $stream)) {
		if ($null -ne $resource) {
			$resource.Dispose()
		}
	}
}
