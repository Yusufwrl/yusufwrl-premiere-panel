<#
  Gelistirici deploy — repo dosyalarini KURULU panele kopyalar.

  NEDEN JUNCTION DEGIL: bu repo OneDrive altinda ve yolunda Turkce karakter + bosluk var
  ("...\Masaüstü\...\Visual Studio\..."). Junction ile baglandiginda CEP'in Chromium'u (CEF)
  paneli acmiyordu; bu yuzden panel ASCII bir yolda AYRI KOPYA olarak duruyor.
  Sonuc: repo'da yapilan degisiklik, bu betik calistirilmadan panele YANSIMAZ.

  Kullaniciya ozel dosyalar (engine-root.txt, diarize-device.txt, sozluk.json, kisiler.json)
  ASLA ezilmez — $include disinda tutulduklari icin kopyalama onlara hic dokunmaz.

  Kullanim:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-dev.ps1
#>
$ErrorActionPreference = "Stop"

$src = $PSScriptRoot
$dst = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yusufwrl.premierepanel"

# Panele giren dosya/klasorler (pack-panel.ps1 ile ayni liste)
$include = @("index.html", "config.json", "update.json", "version.json", ".debug", "js", "jsx", "css", "CSXS")
# Kurulu kopyada varsa DOKUNULMAYACAK dosyalar
$koru = @("engine-root.txt", "diarize-device.txt", "sozluk.json", "kisiler.json")

if (-not (Test-Path $dst)) {
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  Write-Host "Panel klasoru olusturuldu: $dst" -ForegroundColor Yellow
  Write-Host "NOT: PlayerDebugMode gerekiyor - install-dev.ps1'in 1. bolumunu bir kez calistir." -ForegroundColor Yellow
}

# Junction ise: kopyalamaya calismak kaynagi bozar, uyar ve dur.
$item = Get-Item $dst -Force
if ($item.LinkType) {
  throw "Hedef bir $($item.LinkType) (junction/symlink). Bu kurulum kopya bekliyor. Once hedefi kaldir: Remove-Item '$dst' -Force"
}

$kopyalanan = 0
foreach ($i in $include) {
  $p = Join-Path $src $i
  if (-not (Test-Path $p)) { Write-Warning "Bulunamadi, atlandi: $i"; continue }
  Copy-Item $p -Destination $dst -Recurse -Force
  $kopyalanan++
}

# Kullaniciya ozel dosyalar yanlislikla kopyalandiysa geri al (repo'da olmamalilar ama emniyet)
foreach ($k in $koru) {
  $repoK = Join-Path $src $k
  if (Test-Path $repoK) { Write-Warning "$k repo'da duruyor - kurulu kopyaya GONDERILMEDI." }
}

$ver = "?"
try { $ver = (Get-Content (Join-Path $dst "version.json") -Raw | ConvertFrom-Json).version } catch {}

Write-Host ""
Write-Host "Deploy tamam: $kopyalanan oge -> $dst" -ForegroundColor Green
Write-Host "Panel surumu: v$ver"
foreach ($k in $koru) {
  $f = Join-Path $dst $k
  if (Test-Path $f) { Write-Host "Korundu: $k = $((Get-Content $f -Raw).Trim())" -ForegroundColor Cyan }
}
Write-Host ""
Write-Host "Premiere Pro'yu KAPATIP yeniden ac (panel kapat-ac yetmeyebilir)." -ForegroundColor Cyan
