<#
  EMOJI PNG'LERINI PAKETE ESITLE.

  NEDEN VAR: emoji ozelligi resimleri kullanicinin kendi klasorunden okuyor
  (…\Youtube\Edit\Emoji) ve o klasor arkadasin makinesinde YOK. Paket olmadan emoji
  ozelligi teslim edildigi gun olu geliyor — üstelik sebebi kullanici icin gorunmez
  ("Emoji klasoru okunamadi").

  ⚠ DOSYA ADLARI PAKETTE ASCII (emoji01.png, emoji02.png…) ve gercek adlar
  emoji-paketi.json'da tutuluyor. Bu, varsayilan\stiller icin zaten uygulanmis ve
  kanitlanmis desen: zip'e Turkce karakterli ad koymak (Compress-Archive / acma
  zincirinde) bozulma riski tasiyor. Emoji adlari AYRICA bilgi tasiyor — panel
  "<Duygu> <Karakter>.png" kalibindan duygu ve karakteri TURETIYOR (js/emoji.js tara),
  yani ad bozulursa emoji sessizce yanlis karaktere baglanir ya da hic gorunmez.
  Panel kurarken gercek adla yaziyor (js/app.js varsayilanlariKur).

  KULLANIM (repo kokunden):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\emoji-esitle.ps1
#>
[CmdletBinding()]
param(
  [string] $Kaynak = (Join-Path $env:USERPROFILE "OneDrive\Masaüstü\Yusufwrl\Youtube\Edit\Emoji")
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$hedefKlasor = Join-Path $repo "varsayilan\emoji"
$manifest = Join-Path $repo "varsayilan\emoji-paketi.json"

if (-not (Test-Path $Kaynak)) { Write-Error "Emoji klasoru yok: $Kaynak" }

# ALT KLASORLER ATLANIR — panel de atliyor (js/emoji.js): Emoji\w icindekiler yalniz
# Tofi'ye ait ve ozyinelemeli alinsa yanlis karakterin yuzu ekrana gelirdi.
$png = Get-ChildItem -Path $Kaynak -Filter *.png -File | Sort-Object Name
if (-not $png) { Write-Error "Klasorde PNG yok: $Kaynak" }

if (Test-Path $hedefKlasor) { Remove-Item $hedefKlasor -Recurse -Force }
New-Item -ItemType Directory -Force $hedefKlasor | Out-Null

$man = @()
$i = 0
foreach ($f in $png) {
  $i++
  $ascii = "emoji{0:d2}.png" -f $i
  Copy-Item $f.FullName (Join-Path $hedefKlasor $ascii) -Force
  $man += [ordered]@{ dosya = $ascii; ad = $f.Name }
}

($man | ConvertTo-Json -Depth 5) | Out-File $manifest -Encoding utf8

$mb = [math]::Round((($png | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Output "Emoji paketi guncellendi: $hedefKlasor"
Write-Output "  $($png.Count) dosya, $mb MB"
Write-Output "  manifest: $manifest"

# Panelin dosya adlarindan tureteceklerini SIMDIDEN goster: bir ad kalibi bozuksa
# (or. sondaki sayi varyant sayilir) burada gorunur, arkadasin makinesinde degil.
$duygular = @{}
$karakterler = @{}
foreach ($m in $man) {
  $taban = [IO.Path]::GetFileNameWithoutExtension($m.ad).Trim()
  if ($taban -match '^(.*\S)\s+(\d{1,2})$') { $taban = $Matches[1] }   # sondaki sayi = varyant
  $k = $taban.LastIndexOf(" ")
  if ($k -le 0) { Write-Output "  UYARI  kaliba uymuyor, panel ATLAR: $($m.ad)"; continue }
  $duygular[$taban.Substring(0, $k).Trim()] = 1
  $karakterler[$taban.Substring($k + 1).Trim()] = 1
}
Write-Output "  karakterler: $(($karakterler.Keys | Sort-Object) -join ', ')"
Write-Output "  duygular   : $(($duygular.Keys | Sort-Object) -join ', ')"
