<#
  Panel dosyalarini toplar (motoru ve makineye-ozel dosyalari HARIC tutar).
  Iki mod (birlikte de kullanilabilir):
    -Zip   <cikti.zip>   : GitHub Release icin panel.zip uretir
    -Stage <klasor>      : Inno kurucusu icin staging\panel klasorunu doldurur

  Ornek:
    powershell -ExecutionPolicy Bypass -File .\pack-panel.ps1 -Stage .\staging\panel
    powershell -ExecutionPolicy Bypass -File .\pack-panel.ps1 -Zip .\panel.zip
#>
param(
  [string]$Zip,
  [string]$Stage
)
$ErrorActionPreference = "Stop"

# Proje koku = bu betigin bir ust klasoru (installer\ -> PremiereExtension\)
$root = Split-Path -Parent $PSScriptRoot

# Panele giren dosya/klasorler (gelistirme ve makineye-ozel olanlar disarida)
$include = @("index.html", "config.json", "update.json", "version.json", ".debug", "js", "jsx", "css", "CSXS")
$exclude = @("engine-root.txt")

function Copy-Panel($dest) {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  foreach ($i in $include) {
    $p = Join-Path $root $i
    if (Test-Path $p) { Copy-Item $p -Destination $dest -Recurse -Force }
    else { Write-Warning "Bulunamadi, atlandi: $i" }
  }
  foreach ($x in $exclude) {
    Get-ChildItem -Path $dest -Recurse -Filter $x -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

if ($Stage) {
  Copy-Panel $Stage
  Write-Host "staging hazir: $Stage"
}
if ($Zip) {
  $tmp = Join-Path $env:TEMP ("panelpkg_" + [guid]::NewGuid().ToString("N"))
  Copy-Panel $tmp
  if (Test-Path $Zip) { Remove-Item $Zip -Force }
  Compress-Archive -Path (Join-Path $tmp "*") -DestinationPath $Zip -Force
  Remove-Item $tmp -Recurse -Force
  Write-Host "panel.zip olustu: $Zip"
}
if (-not $Stage -and -not $Zip) {
  Write-Host "Kullanim: pack-panel.ps1 -Zip .\panel.zip   veya   -Stage .\staging\panel"
}
