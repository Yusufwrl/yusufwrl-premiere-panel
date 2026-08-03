<#
  Panel dosyalarini toplar (motoru ve makineye-ozel dosyalari HARIC tutar).
  Iki mod (birlikte de kullanilabilir):
    -Zip   <cikti.zip>   : GitHub Release icin panel.zip uretir
    -Stage <klasor>      : Inno kurucusu icin staging\panel klasorunu doldurur

  Ornek:
    powershell -ExecutionPolicy Bypass -File .\pack-panel.ps1 -Stage .\staging\panel
    powershell -ExecutionPolicy Bypass -File .\pack-panel.ps1 -Zip .\panel.zip

  -WithDebug : .debug dosyasini da pakete koyar. NORMALDE KULLANMA - son kullanicida
               gereksiz yere CEF uzaktan hata ayiklama portunu (localhost:8088) acar.
#>
param(
  [string]$Zip,
  [string]$Stage,
  [switch]$WithDebug
)
$ErrorActionPreference = "Stop"

# Proje koku = bu betigin bir ust klasoru (installer\ -> PremiereExtension\)
$root = Split-Path -Parent $PSScriptRoot

# Dosya listeleri tek kaynaktan gelir (deploy-dev.ps1 ile ayni liste)
. (Join-Path $PSScriptRoot "panel-files.ps1")

# Panele giren dosya/klasorler (gelistirme ve makineye-ozel olanlar disarida)
$include = $PanelInclude
# .debug SON KULLANICI PAKETINE GIRMEZ: paneli calistirmak icin gerekli degil
# (imzasiz yukleme PlayerDebugMode ile saglaniyor), yalnizca DevTools portu acar.
if ($WithDebug) { $include += ".debug" }
# Kullaniciya ozel dosyalar pakete GIRMEZ (kurulumda/guncellemede kullanicininki ezilmesin)
$exclude = $PanelUserFiles

# Listede olmayan yeni bir ust duzey oge var mi? (sessizce disarida kalmasin)
Test-PanelFileList -Root $root

function Copy-Panel($dest) {
  # GUVENLIK: burasi $dest'i SORGUSUZ siliyordu. "-Stage .\staging" gibi tek harflik bir
  # sapma, elle doldurulan 3 GB'lik staging\engine klasorunu da silerdi. Once hedefin
  # gercekten bir panel klasoru oldugunu dogrula.
  if (Test-Path $dest) {
    $tam = (Resolve-Path -LiteralPath $dest).Path
    $ad  = Split-Path $tam -Leaf
    if ($ad -ne "panel" -and $ad -notlike "panelpkg_*") {
      throw "Guvenlik: '$tam' SILINMEDI. Hedef klasorun adi 'panel' olmali (ornek: -Stage .\staging\panel)."
    }
    $yabanci = @(Get-ChildItem -LiteralPath $tam -Force -ErrorAction SilentlyContinue |
                 Where-Object { $_.PSIsContainer -and ($_.Name -eq "engine" -or $_.Name -eq "panel") })
    if ($yabanci.Count) {
      throw "Guvenlik: '$tam' icinde engine\ ya da panel\ var - panel klasoru gibi gorunmuyor, SILINMEDI."
    }
    Remove-Item -LiteralPath $tam -Recurse -Force
  }
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
