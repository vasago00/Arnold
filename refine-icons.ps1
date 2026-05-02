# Refine the cropped Arnold health system icons:
#   1. Detect the colored line-art bounding box (non-dark pixels)
#   2. Crop tight to that box plus small padding
#   3. Replace the dark #0b0d12 background with transparency
#   4. Re-canvas to 256x256 with the content centered
#
# Result: each icon is centered, transparent-background PNG that integrates
# cleanly with whatever tile background the UI uses.

Add-Type -AssemblyName System.Drawing

$dir = 'C:\Users\Superuser\Arnold\arnold-app\src\assets\systems'
$canvas = 256

# Pixels are considered "background" if all channels are below this threshold.
# Gemini's #0b0d12 has channels 11,13,18 — using 35 leaves room for JPEG-style
# halos around the line art without including the line art itself.
$bgThreshold = 35

$files = Get-ChildItem $dir -Filter *.png
foreach ($file in $files) {
    Write-Host "Processing: $($file.Name)"
    $src = [System.Drawing.Bitmap]::FromFile($file.FullName)
    $w = $src.Width
    $h = $src.Height

    # Lock the source bitmap for fast pixel scanning
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $bmpData = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $bmpData.Stride
    $bytes = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $bytes, 0, $bytes.Length)
    $src.UnlockBits($bmpData)

    # First pass: bounding box of non-background pixels
    $minX = $w; $maxX = 0; $minY = $h; $maxY = 0
    for ($y = 0; $y -lt $h; $y++) {
        $rowOff = $y * $stride
        for ($x = 0; $x -lt $w; $x++) {
            $i = $rowOff + $x * 4
            $b = $bytes[$i]
            $g = $bytes[$i + 1]
            $r = $bytes[$i + 2]
            if ($r -gt $bgThreshold -or $g -gt $bgThreshold -or $b -gt $bgThreshold) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }

    if ($maxX -le $minX -or $maxY -le $minY) {
        Write-Host "  WARN: no content detected, copying as-is"
        $src.Dispose()
        continue
    }

    $contentW = $maxX - $minX + 1
    $contentH = $maxY - $minY + 1
    Write-Host ("  content bbox: ({0},{1}) {2}x{3}" -f $minX, $minY, $contentW, $contentH)

    # Build transparent target: pad bounding box by 8% of largest dimension
    $pad = [int]([Math]::Max($contentW, $contentH) * 0.08)
    $cropMinX = [Math]::Max(0, $minX - $pad)
    $cropMinY = [Math]::Max(0, $minY - $pad)
    $cropMaxX = [Math]::Min($w - 1, $maxX + $pad)
    $cropMaxY = [Math]::Min($h - 1, $maxY + $pad)
    $cropW = $cropMaxX - $cropMinX + 1
    $cropH = $cropMaxY - $cropMinY + 1

    # Build a transparent crop
    $cropped = New-Object System.Drawing.Bitmap($cropW, $cropH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    for ($y = 0; $y -lt $cropH; $y++) {
        $srcRow = ($cropMinY + $y) * $stride
        for ($x = 0; $x -lt $cropW; $x++) {
            $i = $srcRow + ($cropMinX + $x) * 4
            $b = $bytes[$i]
            $g = $bytes[$i + 1]
            $r = $bytes[$i + 2]
            # Soft alpha: pixels below threshold → fully transparent, brighter
            # pixels keep their alpha proportional to luminance above threshold.
            $maxC = [Math]::Max($r, [Math]::Max($g, $b))
            if ($maxC -le $bgThreshold) {
                # Fully transparent
                $cropped.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
            } else {
                # Keep color, full alpha. Slight feathering for subpixel halos:
                $alpha = if ($maxC -lt ($bgThreshold + 30)) {
                    [int](255 * ($maxC - $bgThreshold) / 30)
                } else { 255 }
                $cropped.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $r, $g, $b))
            }
        }
    }

    # Compose onto a 256x256 transparent canvas, centered, scaled to fit ~85%
    $out = New-Object System.Drawing.Bitmap($canvas, $canvas, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($out)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g2.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    # Clear to fully transparent
    $g2.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

    # Scale the cropped content to ~85% of the canvas while preserving aspect
    $targetSize = [int]($canvas * 0.85)
    $scaleW = $targetSize / $cropW
    $scaleH = $targetSize / $cropH
    $scale = [Math]::Min($scaleW, $scaleH)
    $drawW = [int]($cropW * $scale)
    $drawH = [int]($cropH * $scale)
    $drawX = [int](($canvas - $drawW) / 2)
    $drawY = [int](($canvas - $drawH) / 2)

    $destRect = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawW, $drawH)
    $g2.DrawImage($cropped, $destRect)
    $g2.Dispose()

    # Save (overwrite the original)
    $tmpPath = $file.FullName + '.tmp.png'
    $out.Save($tmpPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    $cropped.Dispose()
    $src.Dispose()

    Move-Item $tmpPath $file.FullName -Force
    $size = (Get-Item $file.FullName).Length
    Write-Host ("  saved {0} ({1} bytes)" -f $file.Name, $size)
}

Write-Host ""
Write-Host "Done. All icons centered, dark background → transparent."
