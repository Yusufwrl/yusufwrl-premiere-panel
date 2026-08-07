<#
  KURULU PANELDEKI PRESETLERI PAKETE ESITLE.

  NEDEN VAR: varsayilan\preset-paketi.json ELLE tutuluyordu ve unutuluyordu. Olculdu
  (7 Agustos 2026): pakette 6 preset varken kurulu panelde 9 vardi — "Emoji Sag Taraf" ve
  "Camera Shake 1" arkadasa HIC gitmiyordu. Daha kotusu panel bunu sessizce basarili
  raporluyor ("Hazir preset'ler kuruldu (6)"), yani eksik oldugu hicbir yerden anlasilmiyordu.

  ⚠ IKI TUZAK:
   1) ConvertTo-Json -Depth 100 SART. Varsayilan derinlik 2'dir; preset yiginlari
      bilesen > parametre > ornek noktalari diye ic ice ve varsayilan derinlikte dosyaya
      "System.Object[]" METNI yazilir — panel onu okur, hata VERMEZ, preset sessizce bozulur.
   2) Dosya adi "presetler.json" OLAMAZ. O ad korunan kullanici dosyasi listesinde ve
      pakete giden ayni adli dosya UC ayri yerde sessizce eleniyor (.gitignore ·
      pack-panel.ps1 · updater.js copyDir). Bu yuzden paketteki ad "preset-paketi.json".

  KULLANIM (repo kokunden):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\preset-esitle.ps1
#>
[CmdletBinding()]
param(
  # Cop/deneme kayitlari pakete girmesin. "w" kullanicinin deneme kaydi.
  [string[]] $Cikar = @("w")
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$kurulu = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yusufwrl.premierepanel\presetler.json"
$hedef = Join-Path $repo "varsayilan\preset-paketi.json"

if (-not (Test-Path $kurulu)) {
  Write-Error "Kurulu panelde presetler.json yok: $kurulu`nOnce Premiere'de en az bir preset ogret."
}

$ham = Get-Content $kurulu -Raw -Encoding UTF8
$obj = $ham | ConvertFrom-Json

$yeni = [ordered]@{}
$atlanan = @()
foreach ($ad in ($obj.PSObject.Properties.Name | Sort-Object)) {
  if ($Cikar -contains $ad) { $atlanan += $ad; continue }
  $yeni[$ad] = $obj.$ad
}

if ($yeni.Count -eq 0) { Write-Error "Pakete girecek preset kalmadi." }

New-Item -ItemType Directory -Force (Split-Path $hedef) | Out-Null
($yeni | ConvertTo-Json -Depth 100) | Out-File $hedef -Encoding utf8

# DOGRULAMA: derinlik tuzagi sessiz oldugu icin yazdiktan sonra GERI OKUNUR.
$kontrol = Get-Content $hedef -Raw -Encoding UTF8
if ($kontrol -match "System\.Object\[\]") {
  Write-Error "Dosyada 'System.Object[]' var - ConvertTo-Json derinligi yetmemis. Paket BOZUK."
}
$geri = $kontrol | ConvertFrom-Json
$sayi = ($geri.PSObject.Properties.Name).Count

Write-Output "Preset paketi guncellendi: $hedef"
Write-Output "  $sayi preset: $(($geri.PSObject.Properties.Name) -join ', ')"
if ($atlanan.Count) { Write-Output "  atlanan: $($atlanan -join ', ')" }

# Bilesen adlarini bildir: 3. parti efekt tasiyan preset arkadasin makinesinde
# "katalogda yok" diyebilir (host yalniz Premiere'in YERLESIK efektlerini ekleyebiliyor).
foreach ($ad in $geri.PSObject.Properties.Name) {
  $bil = @()
  foreach ($b in $geri.$ad.bilesenler) {
    $m = [string]$b.match
    if ($m -and ($m -notmatch "^AE\.ADBE ")) { $bil += "$($b.ad) ($m)" }
  }
  if ($bil.Count) { Write-Output "  UYARI  '$ad' 3. parti efekt tasiyor: $($bil -join ' · ')" }
}
