$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktopPath '6.lnk'))
$profileIconPath = ($shortcut.IconLocation -replace ',-?\d+$', '').Trim('"')
if (-not (Test-Path -LiteralPath $profileIconPath)) { throw "Chrome 6 icon is missing: $profileIconPath" }
$archivePath = Join-Path $env:LOCALAPPDATA 'Programs/antigravity/resources/app.asar'
$archive = [IO.File]::ReadAllBytes($archivePath)
$headerSize = [BitConverter]::ToUInt32($archive, 4)
$jsonSize = [BitConverter]::ToUInt32($archive, 12)
$header = [Text.Encoding]::UTF8.GetString($archive, 16, $jsonSize) | ConvertFrom-Json
$entry = $header.files.'icon.png'
if (-not $entry -or $entry.unpacked) { throw 'The installed Antigravity icon was not found in ASAR' }
$offset = 8 + $headerSize + [long]$entry.offset
if ($offset -lt 0 -or ($offset + $entry.size) -gt $archive.Length) { throw 'Invalid ASAR icon bounds' }
$stream = New-Object IO.MemoryStream
$appImage = $null; $profileIcon = $null; $profileBitmap = $null; $canvas = $null; $graphics = $null; $badge = $null; $badgeGraphics = $null; $brush = $null
try {
	$stream.Write($archive, $offset, $entry.size); $stream.Position = 0
	$appImage = [Drawing.Image]::FromStream($stream)
	$profileIcon = [Drawing.Icon]::new($profileIconPath, 256, 256)
	$profileBitmap = $profileIcon.ToBitmap()
	$canvas = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [Drawing.Graphics]::FromImage($canvas)
	$graphics.Clear([Drawing.Color]::Transparent)
	$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
	$graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
	$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.DrawImage($appImage, [Drawing.Rectangle]::new(0, 0, 256, 256))
	# Chrome's profile badge occupies its lower-right quarter. Clip the exact
	# badge to a circle so no pixels from the Chrome logo enter the new icon.
	$badge = [Drawing.Bitmap]::new(128, 128, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$badgeGraphics = [Drawing.Graphics]::FromImage($badge)
	$badgeGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
	$badgeGraphics.DrawImage($profileBitmap, [Drawing.Rectangle]::new(0, 0, 128, 128), [Drawing.Rectangle]::new($profileBitmap.Width / 2, $profileBitmap.Height / 2, $profileBitmap.Width / 2, $profileBitmap.Height / 2), [Drawing.GraphicsUnit]::Pixel)
	$brush = [Drawing.TextureBrush]::new($badge, [Drawing.Drawing2D.WrapMode]::Clamp)
	$brush.TranslateTransform(128, 128)
	$graphics.FillEllipse($brush, 128, 128, 128, 128)
	$canvas.Save((Join-Path $PSScriptRoot 'A6.png'), [Drawing.Imaging.ImageFormat]::Png)
	$sizes = @(16, 24, 32, 48, 64, 128, 256)
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
		} finally {$memory.Dispose(); $frameGraphics.Dispose(); $frame.Dispose()}
	}
	$output = [IO.File]::Create((Join-Path $PSScriptRoot 'A6.ico'))
	$writer = [IO.BinaryWriter]::new($output)
	try {
		$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
		$position = 6 + 16 * $sizes.Count
		for ($index = 0; $index -lt $sizes.Count; $index++) {
			$dimension = if ($sizes[$index] -eq 256) {0} else {$sizes[$index]}
			$writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
			$writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$index].Length); $writer.Write([uint32]$position)
			$position += $frames[$index].Length
		}
		foreach ($bytes in $frames) {$writer.Write([byte[]]$bytes)}
	} finally {$writer.Dispose(); $output.Dispose()}
	Write-Output (Join-Path $PSScriptRoot 'A6.ico')
} finally {
	foreach ($resource in @($brush, $badgeGraphics, $badge, $graphics, $canvas, $profileBitmap, $profileIcon, $appImage, $stream)) {if ($null -ne $resource) {$resource.Dispose()}}
}
