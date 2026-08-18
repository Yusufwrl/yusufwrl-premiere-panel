<#
  MOTORU TESLIME HAZIRLA — gereksizleri atip temiz bir kopya cikarir.

  Motor (Faster-Whisper-XXL + modeller) panele DAHIL DEGIL: ~9,5 GB ve gitignore'lu.
  Arkadasa Drive/WeTransfer ile ayrica gidiyor. Bu betik ATILACAKLARI ayikliyor:

    _models\faster-whisper-medium   1,43 GB  -> config.json "large-v3" kullaniyor, medium HIC
                                               cagrilmiyor. Olculdu.
    _models\reverb-diarization-v2   0,77 GB  -> diarizasyon v1.8.0'da TAMAMEN KALDIRILDI
                                               (tek kisilik kayitta 3 konusmaci buluyordu).
    work\                                    -> gecici WAV/JSON artiklari, kullaniciya ozel.

  9,47 GB  ->  ~7,27 GB  (2,2 GB tasarruf)

  ⚠ ATILMAYACAKLAR (elle temizlemeye kalkma):
    _models\faster-whisper-large-v3  2,88 GB  panelin kullandigi TEK model
    _xxl_data                        4,28 GB  motorun kendi calisma dosyalari
    ffmpeg.exe                       0,08 GB  panel ffmpeg'i BURADAN cagiriyor (PATH'te aramaz)

  KULLANIM (repo kokunden):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\motor-hazirla.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\motor-hazirla.ps1 -Hedef "D:\TeslimMotor"

  Sonra: cikan klasoru Drive'a yukle, paylasim linkini arkadasina ver. O da C: altina
  "YusufwrlEngine" adiyla acar. Panel motoru orada bulamazsa kurulum sihirbazinda yolu sorar.
#>
[CmdletBinding()]
param(
  [string] $Kaynak = (Join-Path $env:USERPROFILE "YusufwrlEngine"),
  [string] $Hedef  = (Join-Path $env:USERPROFILE "Desktop\YusufwrlEngine-teslim")
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Kaynak)) { Write-Error "Motor klasoru yok: $Kaynak" }

function GBoyut($yol) {
  if (-not (Test-Path $yol)) { return 0 }
  $s = (Get-ChildItem $yol -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  return [math]::Round(($s / 1GB), 2)
}

$once = GBoyut $Kaynak
Write-Output "Kaynak : $Kaynak  ($once GB)"
Write-Output "Hedef  : $Hedef"
Write-Output ""
Write-Output "Kopyalaniyor (birkac dakika surebilir)..."

# robocopy: buyuk dosyalarda Copy-Item'dan cok daha hizli ve surdurulebilir.
# /XD = dislanan KLASORLER · /XF = dislanan DOSYALAR (ad bazli, hangi derinlikte olursa olsun)
# /NFL /NDL = dosya/klasor listesini basma (9 GB'lik ciktiyi konsola dokmesin)
# ayna/eski/.panel-emoji.json = PANELIN URETTIGI ONBELLEK. Teslim RAR'ina girerse arkadasa
#   senin ayna kopyalarin + senin ESKI resimlerin + senin dosya boyutlarini iceren iz dosyan
#   gider. Kirilmiyor (tara() alt klasorleri atliyor) ama gereksiz ve yaniltici.
# ⚠ .panel-emoji.json bir DOSYA, klasor degil: yorum ucunun de dislandigini soyluyordu ama
#   listede yoktu ve /XD zaten yalnizca klasor disliyor -> iz dosyasi HER teslimde gidiyordu.
#   Dosya icin /XF sart; ayri liste bu yuzden var.
$dislanan      = @("work", "faster-whisper-medium", "reverb-diarization-v2", ".cache", "ayna", "eski")
$dislananDosya = @(".panel-emoji.json")
$argv = @($Kaynak, $Hedef, "/E", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NP", "/XD") + $dislanan + @("/XF") + $dislananDosya
& robocopy @argv | Out-Null

# robocopy cikis kodlari: 0-7 basari (8+ hata). Bunu bilmeyen "hata var" saniyor.
if ($LASTEXITCODE -ge 8) { Write-Error "robocopy hata verdi (kod $LASTEXITCODE)" }

$sonra = GBoyut $Hedef
Write-Output ""
Write-Output "BITTI.  $once GB  ->  $sonra GB   (tasarruf: $([math]::Round($once - $sonra, 2)) GB)"

# Panelin ARADIGI dosyalar gercekten geldi mi? Eksigini burada gormek, arkadasin
# makinesinde "motor bulunamadi" hatasi almaktan iyidir.
$sart = @(
  @{ yol = "Faster-Whisper-XXL\faster-whisper-xxl.exe"; ad = "motor exe" },
  @{ yol = "Faster-Whisper-XXL\ffmpeg.exe";             ad = "ffmpeg" },
  @{ yol = "Faster-Whisper-XXL\_models\faster-whisper-large-v3"; ad = "large-v3 modeli" },
  @{ yol = "Faster-Whisper-XXL\_xxl_data";              ad = "motor verisi" }
)
Write-Output ""
$eksik = 0
foreach ($s in $sart) {
  $p = Join-Path $Hedef $s.yol
  if (Test-Path $p) { Write-Output "  OK      $($s.ad)" }
  else { Write-Output "  EKSIK   $($s.ad)  ($($s.yol))"; $eksik++ }
}
if ($eksik) { Write-Output "`n⚠ $eksik parca eksik — kaynak klasoru kontrol et." }
else { Write-Output "`nHazir. Bu klasoru Drive'a yukleyip linkini paylasabilirsin." }
