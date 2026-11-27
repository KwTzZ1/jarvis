# Génère launcher\jarvis.ico (plusieurs tailles, images PNG intégrées).
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot 'jarvis.ico'
$sizes = 256, 64, 48, 32, 24, 16

function New-IconPng([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)

    # Fond arrondi sombre
    $r = [single]($s * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($s - $r - 1, 0, $r, $r, 270, 90)
    $path.AddArc($s - $r - 1, $s - $r - 1, $r, $r, 0, 90)
    $path.AddArc(0, $s - $r - 1, $r, $r, 90, 90)
    $path.CloseFigure()
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 6, 14, 26))
    $g.FillPath($bg, $path)

    $cyan = [System.Drawing.Color]::FromArgb(255, 0, 229, 255)
    $c = $s / 2.0

    # Halo
    $halo = New-Object System.Drawing.Drawing2D.GraphicsPath
    $hr = $s * 0.30
    $halo.AddEllipse([single]($c - $hr), [single]($c - $hr), [single]($hr * 2), [single]($hr * 2))
    $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $halo
    $pgb.CenterColor = [System.Drawing.Color]::FromArgb(150, 0, 229, 255)
    $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 229, 255))
    $g.FillPath($pgb, $halo)

    # Anneau extérieur (arcs)
    $w1 = [single]([Math]::Max(1.5, $s * 0.06))
    $pen1 = New-Object System.Drawing.Pen $cyan, $w1
    $ro = $s * 0.36
    $rect = New-Object System.Drawing.RectangleF ([single]($c - $ro)), ([single]($c - $ro)), ([single]($ro * 2)), ([single]($ro * 2))
    foreach ($start in 10, 100, 190, 280) { $g.DrawArc($pen1, $rect, $start, 70) }

    # Anneau intérieur
    if ($s -ge 32) {
        $pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 0, 229, 255)), ([single]([Math]::Max(1, $s * 0.025)))
        $ri = $s * 0.24
        $g.DrawEllipse($pen2, [single]($c - $ri), [single]($c - $ri), [single]($ri * 2), [single]($ri * 2))
    }

    # Coeur lumineux
    $rc = $s * 0.12
    $core = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 200, 250, 255))
    $g.FillEllipse($core, [single]($c - $rc), [single]($c - $rc), [single]($rc * 2), [single]($rc * 2))

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$images = foreach ($s in $sizes) { , (New-IconPng $s) }

$fs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $len = $images[$i].Length
    $dim = if ($s -ge 256) { 0 } else { $s }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
    $offset += $len
}
foreach ($img in $images) { $bw.Write($img) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($out, $fs.ToArray())
Write-Host "Icône créée : $out"
