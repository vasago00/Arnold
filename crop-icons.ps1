# Crop Arnold health system icons from the Gemini composite image.
# Reads "Health systems.png" + "Gut image.png" from C:\Users\Superuser\Arnold,
# extracts each icon as a separate 256x256 PNG into arnold-app/src/assets/systems/.

Add-Type -AssemblyName System.Drawing

$srcDir = 'C:\Users\Superuser\Arnold'
$gridPath = Join-Path $srcDir 'Health systems.png'
$gutPath  = Join-Path $srcDir 'Gut image.png'
$outDir   = Join-Path $srcDir 'arnold-app\src\assets\systems'

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# Layout proportions — derived from the Gemini composite (3 rows, 5+1+5 columns).
# Each icon in the source occupies roughly a 200x200 region with ~20px padding;
# we crop a slightly larger box to give breathing room, then resize to 256.
# Format: [name, colIndex (0-4), rowIndex (0=top, 1=middle, 2=bottom)]
$icons = @(
    @{ name='brain';      col=0; row=0 },
    @{ name='heart';      col=1; row=0 },
    @{ name='bones';      col=2; row=0 },
    @{ name='gut';        col=3; row=0 },   # will be overwritten by gut image
    @{ name='immune';     col=4; row=0 },
    @{ name='energy';     col=2; row=1 },   # bicep, centered in middle row
    @{ name='longevity';  col=0; row=2 },
    @{ name='sleep';      col=1; row=2 },
    @{ name='metabolism'; col=2; row=2 },
    @{ name='endurance';  col=3; row=2 },
    @{ name='hormones';   col=4; row=2 }
)

Write-Host "Loading composite: $gridPath"
$grid = [System.Drawing.Image]::FromFile($gridPath)
Write-Host ("Composite size: {0}x{1}" -f $grid.Width, $grid.Height)

# Each cell: width = imageWidth/5, height = imageHeight/3 (approximately).
$cellW = [int]($grid.Width / 5)
$cellH = [int]($grid.Height / 3)
Write-Host ("Cell size: {0}x{1}" -f $cellW, $cellH)

$outSize = 256

foreach ($icon in $icons) {
    if ($icon.name -eq 'gut') {
        # Skip — handled separately from the dedicated gut image
        continue
    }
    $x = $icon.col * $cellW
    $y = $icon.row * $cellH
    $cropW = $cellW
    $cropH = $cellH

    $sourceRect = New-Object System.Drawing.Rectangle($x, $y, $cropW, $cropH)
    $destRect   = New-Object System.Drawing.Rectangle(0, 0, $outSize, $outSize)
    $bmp = New-Object System.Drawing.Bitmap($outSize, $outSize)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($grid, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $outPath = Join-Path $outDir ("{0}.png" -f $icon.name)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host ("  saved {0} (from {1},{2} {3}x{4})" -f $icon.name, $x, $y, $cropW, $cropH)
}

# Handle gut from dedicated image — use centered crop matching the source
Write-Host "Loading dedicated gut: $gutPath"
$gut = [System.Drawing.Image]::FromFile($gutPath)
Write-Host ("Gut source size: {0}x{1}" -f $gut.Width, $gut.Height)

# Center-crop a square from the gut image (it's a wide rectangle with the
# subject centered)
$gutSize = [Math]::Min($gut.Width, $gut.Height)
$gutX = [int](($gut.Width - $gutSize) / 2)
$gutY = [int](($gut.Height - $gutSize) / 2)
$gutSrc = New-Object System.Drawing.Rectangle($gutX, $gutY, $gutSize, $gutSize)
$gutDst = New-Object System.Drawing.Rectangle(0, 0, $outSize, $outSize)

$bmp = New-Object System.Drawing.Bitmap($outSize, $outSize)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($gut, $gutDst, $gutSrc, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$gutOutPath = Join-Path $outDir 'gut.png'
$bmp.Save($gutOutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  saved gut (from dedicated image)"

$grid.Dispose()
$gut.Dispose()
Write-Host ""
Write-Host "Done. Files written to: $outDir"
Get-ChildItem $outDir -Filter *.png | ForEach-Object { Write-Host ("  {0}  {1} bytes" -f $_.Name, $_.Length) }
