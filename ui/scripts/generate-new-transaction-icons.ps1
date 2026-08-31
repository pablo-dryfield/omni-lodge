param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\public\icons\new-transaction")
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

function New-TransactionIcon {
  param(
    [int]$Size,
    [string]$FileName,
    [switch]$Maskable
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
      [System.Drawing.ColorTranslator]::FromHtml("#2563eb"),
      [System.Drawing.ColorTranslator]::FromHtml("#0a1f44"),
      45.0
    )
    try {
      $graphics.FillRectangle($background, $canvas)
    } finally {
      $background.Dispose()
    }

    $softWhite = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(16, 255, 255, 255))
    $softBlue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(28, 96, 165, 250))
    try {
      $graphics.FillEllipse($softWhite, -0.0 * $scale, -4.0 * $scale, 184.0 * $scale, 184.0 * $scale)
      $graphics.FillEllipse($softBlue, 318.0 * $scale, 16.0 * $scale, 276.0 * $scale, 276.0 * $scale)
    } finally {
      $softWhite.Dispose()
      $softBlue.Dispose()
    }

    if ($Maskable) {
      $safeContentScale = 0.72
      $safeOffset = ($Size * (1 - $safeContentScale)) / 2
      $graphics.TranslateTransform($safeOffset, $safeOffset)
      $graphics.ScaleTransform($safeContentScale, $safeContentScale)
    }

    $shadowPath = New-RoundedRectanglePath (86.0 * $scale) (151.0 * $scale) (340.0 * $scale) (240.0 * $scale) (48.0 * $scale)
    $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(58, 2, 6, 23))
    try {
      $graphics.FillPath($shadowBrush, $shadowPath)
    } finally {
      $shadowBrush.Dispose()
      $shadowPath.Dispose()
    }

    $walletPath = New-RoundedRectanglePath (86.0 * $scale) (133.0 * $scale) (340.0 * $scale) (240.0 * $scale) (48.0 * $scale)
    $walletBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    try {
      $graphics.FillPath($walletBrush, $walletPath)
    } finally {
      $walletBrush.Dispose()
      $walletPath.Dispose()
    }

    $slotPath = New-RoundedRectanglePath (126.0 * $scale) (184.0 * $scale) (176.0 * $scale) (30.0 * $scale) (15.0 * $scale)
    $slotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#bfdbfe"))
    try {
      $graphics.FillPath($slotBrush, $slotPath)
    } finally {
      $slotBrush.Dispose()
      $slotPath.Dispose()
    }

    $pocketPath = New-RoundedRectanglePath (292.0 * $scale) (226.0 * $scale) (134.0 * $scale) (86.0 * $scale) (30.0 * $scale)
    $pocketBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#1d4ed8"))
    try {
      $graphics.FillPath($pocketBrush, $pocketPath)
      $graphics.FillEllipse([System.Drawing.Brushes]::White, 320.0 * $scale, 257.0 * $scale, 24.0 * $scale, 24.0 * $scale)
    } finally {
      $pocketBrush.Dispose()
      $pocketPath.Dispose()
    }

    $plusBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#059669"))
    try {
      $graphics.FillEllipse($plusBrush, 310.0 * $scale, 300.0 * $scale, 144.0 * $scale, 144.0 * $scale)
    } finally {
      $plusBrush.Dispose()
    }

    $plusPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [Math]::Max(4.0, 22.0 * $scale))
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
New-TransactionIcon -Size 96 -FileName "icon-96.png"
New-TransactionIcon -Size 180 -FileName "apple-touch-icon-180.png"
New-TransactionIcon -Size 192 -FileName "icon-192.png"
New-TransactionIcon -Size 512 -FileName "icon-512.png"
New-TransactionIcon -Size 512 -FileName "icon-maskable-512.png" -Maskable
