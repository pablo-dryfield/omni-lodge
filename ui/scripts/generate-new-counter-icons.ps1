param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\public\icons\new-counter")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc([System.Drawing.RectangleF]::new($X, $Y, $diameter, $diameter), 180, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($X + $Width - $diameter, $Y, $diameter, $diameter), 270, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter), 0, 90)
  $path.AddArc([System.Drawing.RectangleF]::new($X, $Y + $Height - $diameter, $diameter, $diameter), 90, 90)
  $path.CloseFigure()
  return $path
}

function New-CounterIcon {
  param(
    [int]$Size,
    [string]$FileName
  )

  $scale = $Size / 512.0
  $bitmap = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  try {
    $canvas = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
      $canvas,
      [System.Drawing.ColorTranslator]::FromHtml("#0284c7"),
      [System.Drawing.ColorTranslator]::FromHtml("#0a1f44"),
      45.0
    )
    try {
      $graphics.FillRectangle($background, $canvas)
    } finally {
      $background.Dispose()
    }

    $softWhite = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(20, 255, 255, 255))
    $softBlue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(30, 56, 189, 248))
    try {
      $graphics.FillEllipse($softWhite, -20.0 * $scale, -30.0 * $scale, 184.0 * $scale, 184.0 * $scale)
      $graphics.FillEllipse($softBlue, 330.0 * $scale, -54.0 * $scale, 276.0 * $scale, 276.0 * $scale)
    } finally {
      $softWhite.Dispose()
      $softBlue.Dispose()
    }

    $shadowPath = New-RoundedRectanglePath (94.0 * $scale) (126.0 * $scale) (324.0 * $scale) (292.0 * $scale) (46.0 * $scale)
    $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(62, 2, 6, 23))
    try {
      $graphics.FillPath($shadowBrush, $shadowPath)
    } finally {
      $shadowBrush.Dispose()
      $shadowPath.Dispose()
    }

    $cardPath = New-RoundedRectanglePath (94.0 * $scale) (110.0 * $scale) (324.0 * $scale) (292.0 * $scale) (46.0 * $scale)
    $cardBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    try {
      $graphics.FillPath($cardBrush, $cardPath)
    } finally {
      $cardBrush.Dispose()
      $cardPath.Dispose()
    }

    $rowColors = @("#bae6fd", "#dbeafe", "#e0f2fe")
    $dotColors = @("#0284c7", "#2563eb", "#0369a1")
    $rowWidths = @(184.0, 136.0, 164.0)
    $rowY = @(158.0, 220.0, 279.0)
    for ($index = 0; $index -lt 3; $index++) {
      $rowPath = New-RoundedRectanglePath (132.0 * $scale) ($rowY[$index] * $scale) ($rowWidths[$index] * $scale) (26.0 * $scale) (13.0 * $scale)
      $rowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($rowColors[$index]))
      $dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($dotColors[$index]))
      try {
        $graphics.FillPath($rowBrush, $rowPath)
        $graphics.FillEllipse($dotBrush, 337.0 * $scale, ($rowY[$index] - 4.0) * $scale, 34.0 * $scale, 34.0 * $scale)
      } finally {
        $rowBrush.Dispose()
        $dotBrush.Dispose()
        $rowPath.Dispose()
      }
    }

    $plusBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#059669"))
    try {
      $graphics.FillEllipse($plusBrush, 310.0 * $scale, 300.0 * $scale, 144.0 * $scale, 144.0 * $scale)
    } finally {
      $plusBrush.Dispose()
    }

    $plusPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(3.0, 22.0 * $scale))
    $plusPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $plusPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    try {
      $graphics.DrawLine($plusPen, 382.0 * $scale, 334.0 * $scale, 382.0 * $scale, 410.0 * $scale)
      $graphics.DrawLine($plusPen, 344.0 * $scale, 372.0 * $scale, 420.0 * $scale, 372.0 * $scale)
    } finally {
      $plusPen.Dispose()
    }

    $outputPath = Join-Path $OutputDirectory $FileName
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Generated $outputPath"
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-CounterIcon -Size 96 -FileName "icon-96.png"
New-CounterIcon -Size 180 -FileName "apple-touch-icon-180.png"
New-CounterIcon -Size 192 -FileName "icon-192.png"
New-CounterIcon -Size 512 -FileName "icon-512.png"
New-CounterIcon -Size 512 -FileName "icon-maskable-512.png"
