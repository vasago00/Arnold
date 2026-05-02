# Rebuild Arnold health system icons at 1024x1024 with transparent background.
# Goes back to the original Gemini composite (2816x1536) and the dedicated gut
# image (also 2816x1536) — skips the lossy 256x256 intermediate the previous
# crop produced. Result: crisp icons that hold up at any displayed size on
# retina displays.
#
# Pipeline:
#   1. Crop source cell from composite (or use dedicated gut image)
#   2. Detect bounding box of colored content (non-dark pixels)
#   3. Crop tight to bounding box plus 8% padding
#   4. Re-canvas to 1024x1024, transparent background, content centered at 85%
#   5. Save back to arnold-app/src/assets/systems/

Add-Type -AssemblyName System.Drawing

$srcDir = 'C:\Users\Superuser\Arnold'
$gridPath = Join-Path $srcDir 'Health systems.png'
$gutPath  = Join-Path $srcDir 'Gut image.png'
$outDir   = Join-Path $srcDir 'arnold-app\src\assets\systems'

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$canvas = 1024
$bgThreshold = 35

$icons = @(
    @{ name='brain';      col=0; row=0 },
    @{ name='heart';      col=1; row=0 },
    @{ name='bones';      col=2; row=0 },
    @{ name='gut';        col=3; row=0 },   # overridden by gut image below
    @{ name='immune';     col=4; row=0 },
    @{ name='energy';     col=2; row=1 },
    @{ name='longevity';  col=0; row=2 },
    @{ name='sleep';      col=1; row=2 },
    @{ name='metabolism'; col=2; row=2 },
    @{ name='endurance';  col=3; row=2 },
    @{ name='hormones';   col=4; row=2 }
)

function Process-Bitmap($bmp, $name, $outPath, $maskCornerRatio = 0.15) {
    $w = $bmp.Width; $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $bmpData = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $bmpData.Stride
    $bytes = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $bytes, 0, $bytes.Length)
    $bmp.UnlockBits($bmpData)

    # Mask the bottom-right corner where Gemini's watermark sparkle lives.
    # Without this, the bbox extends into the corner and the icon ends up
    # offset toward the upper-left of the canvas.
    $maskW = [int]($w * $maskCornerRatio)
    $maskH = [int]($h * $maskCornerRatio)
    $maskMinX = $w - $maskW
    $maskMinY = $h - $maskH

    # Detect content bounding box
    $minX = $w; $maxX = 0; $minY = $h; $maxY = 0
    for ($y = 0; $y -lt $h; $y++) {
        $rowOff = $y * $stride
        for ($x = 0; $x -lt $w; $x++) {
            # Skip the watermark corner
            if ($x -ge $maskMinX -and $y -ge $maskMinY) { continue }
            $i = $rowOff + $x * 4
            $maxC = [Math]::Max($bytes[$i+2], [Math]::Max($bytes[$i+1], $bytes[$i]))
            if ($maxC -gt $bgThreshold) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -le $minX -or $maxY -le $minY) {
        Write-Host "  WARN: no content detected for $name"
        return
    }
    $contentW = $maxX - $minX + 1
    $contentH = $maxY - $minY + 1
    $pad = [int]([Math]::Max($contentW, $contentH) * 0.08)
    $cropMinX = [Math]::Max(0, $minX - $pad)
    $cropMinY = [Math]::Max(0, $minY - $pad)
    $cropMaxX = [Math]::Min($w - 1, $maxX + $pad)
    $cropMaxY = [Math]::Min($h - 1, $maxY + $pad)
    $cropW = $cropMaxX - $cropMinX + 1
    $cropH = $cropMaxY - $cropMinY + 1

    # Build transparent crop of the colored content at source resolution
    $cropped = New-Object System.Drawing.Bitmap($cropW, $cropH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $croppedData = $cropped.LockBits(
        (New-Object System.Drawing.Rectangle(0, 0, $cropW, $cropH)),
        [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $croppedStride = $croppedData.Stride
    $croppedBytes = New-Object byte[] ($croppedStride * $cropH)
    for ($y = 0; $y -lt $cropH; $y++) {
        $srcRow = ($cropMinY + $y) * $stride
        $dstRow = $y * $croppedStride
        for ($x = 0; $x -lt $cropW; $x++) {
            $si = $srcRow + ($cropMinX + $x) * 4
            $di = $dstRow + $x * 4
            $b = $bytes[$si]
            $g = $bytes[$si+1]
            $r = $bytes[$si+2]
            $maxC = [Math]::Max($r, [Math]::Max($g, $b))
            if ($maxC -le $bgThreshold) {
                $croppedBytes[$di]   = 0
                $croppedBytes[$di+1] = 0
                $croppedBytes[$di+2] = 0
                $croppedBytes[$di+3] = 0
            } else {
                $alpha = if ($maxC -lt ($bgThreshold + 30)) {
                    [byte]([Math]::Min(255, [int](255 * ($maxC - $bgThreshold) / 30)))
                } else { [byte]255 }
                $croppedBytes[$di]   = $b
                $croppedBytes[$di+1] = $g
                $croppedBytes[$di+2] = $r
                $croppedBytes[$di+3] = $alpha
            }
        }
    }
    [System.Runtime.InteropServices.Marshal]::Copy($croppedBytes, 0, $croppedData.Scan0, $croppedBytes.Length)
    $cropped.UnlockBits($croppedData)

    # Compose onto 1024x1024 transparent canvas, content at 85%
    $out = New-Object System.Drawing.Bitmap($canvas, $canvas, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($out)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g2.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g2.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))

    $targetSize = [int]($canvas * 0.85)
    $scale = [Math]::Min($targetSize / $cropW, $targetSize / $cropH)
    $drawW = [int]($cropW * $scale)
    $drawH = [int]($cropH * $scale)
    $drawX = [int](($canvas - $drawW) / 2)
    $drawY = [int](($canvas - $drawH) / 2)

    $g2.DrawImage($cropped, (New-Object System.Drawing.Rectangle($drawX, $drawY, $drawW, $drawH)))
    $g2.Dispose()

    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    $cropped.Dispose()
    $size = (Get-Item $outPath).Length
    Write-Host ("  saved {0} ({1}KB, content {2}x{3} → {4}x{5})" -f $name, [int]($size/1024), $cropW, $cropH, $drawW, $drawH)
}

# Process composite cells (skip gut — handled separately)
Write-Host "Loading composite: $gridPath"
$grid = [System.Drawing.Image]::FromFile($gridPath)
Write-Host ("Composite: {0}x{1}" -f $grid.Width, $grid.Height)
$cellW = [int]($grid.Width / 5)
$cellH = [int]($grid.Height / 3)

foreach ($icon in $icons) {
    if ($icon.name -eq 'gut') { continue }
    $x = $icon.col * $cellW
    $y = $icon.row * $cellH
    Write-Host ("Processing {0} from cell ({1},{2})..." -f $icon.name, $icon.col, $icon.row)
    $cellBmp = New-Object System.Drawing.Bitmap($cellW, $cellH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $cg = [System.Drawing.Graphics]::FromImage($cellBmp)
    $cg.DrawImage($grid,
        (New-Object System.Drawing.Rectangle(0, 0, $cellW, $cellH)),
        (New-Object System.Drawing.Rectangle($x, $y, $cellW, $cellH)),
        [System.Drawing.GraphicsUnit]::Pixel)
    $cg.Dispose()
    $outPath = Join-Path $outDir ("{0}.png" -f $icon.name)
    Process-Bitmap $cellBmp $icon.name $outPath
    $cellBmp.Dispose()
}
$grid.Dispose()

# Process dedicated gut image — pre-crop to square center first, since the
# source is wide (2816x1536) and the watermark sparkle in the BR corner can
# bleed into the bbox even with the corner mask. Square center crop guarantees
# the watermark is excluded and the gut content occupies the whole frame.
Write-Host "Processing gut from dedicated image..."
$gut = [System.Drawing.Bitmap]::FromFile($gutPath)
$gutW = $gut.Width
$gutH = $gut.Height
$squareSize = [Math]::Min($gutW, $gutH)
$squareX = [int](($gutW - $squareSize) / 2)
$squareY = [int](($gutH - $squareSize) / 2)
Write-Host ("  source: {0}x{1}, square crop: ({2},{3}) {4}x{4}" -f $gutW, $gutH, $squareX, $squareY, $squareSize)

# Build the square crop bitmap
$gutSquare = New-Object System.Drawing.Bitmap($squareSize, $squareSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gsg = [System.Drawing.Graphics]::FromImage($gutSquare)
$gsg.DrawImage($gut,
    (New-Object System.Drawing.Rectangle(0, 0, $squareSize, $squareSize)),
    (New-Object System.Drawing.Rectangle($squareX, $squareY, $squareSize, $squareSize)),
    [System.Drawing.GraphicsUnit]::Pixel)
$gsg.Dispose()
$gut.Dispose()

$gutOutPath = Join-Path $outDir 'gut.png'
# Use larger corner mask for gut (0.20) since the square crop may still
# include the sparkle if it's near the inner edge.
Process-Bitmap $gutSquare 'gut' $gutOutPath 0.20
$gutSquare.Dispose()

Write-Host ""
Write-Host "Done. All icons rebuilt at 1024x1024 with transparent background."
Get-ChildItem $outDir -Filter *.png | ForEach-Object { Write-Host ("  {0}  {1}KB" -f $_.Name, [int]($_.Length/1024)) }
