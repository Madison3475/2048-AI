# 用正斜杠路径重新打包 Cloudflare 部署 zip
# 用法: powershell -ExecutionPolicy Bypass -File tools\make_deploy_zip.ps1
# 注意：不要用 Windows 自带“压缩到 zip”或 Compress-Archive，
# 它们会把子目录写成反斜杠（weights\0000.bin），Cloudflare 解压会丢失整个目录。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$zipPath = Join-Path $root '2048-cloudflare.zip'
if (!(Test-Path -LiteralPath $dist)) {
  Write-Error 'dist 不存在，请先运行 node tools\deploy_build.js'
  exit 1
}
$fs = [System.IO.File]::Create($zipPath)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $dist -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($dist.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
  $fs.Dispose()
}
$size = (Get-Item $zipPath).Length / 1MB
Write-Host ("zip ready: {0} ({1:N1} MiB)" -f $zipPath, $size)
