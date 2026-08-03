<#
  Gelistirici deploy — repo dosyalarini KURULU panele kopyalar.

  NEDEN JUNCTION DEGIL: bu repo OneDrive altinda ve yolunda Turkce karakter + bosluk var
  ("...\Masaüstü\...\Visual Studio\..."). Junction ile baglandiginda CEP'in Chromium'u (CEF)
  paneli acmiyordu; bu yuzden panel ASCII bir yolda AYRI KOPYA olarak duruyor.
  Sonuc: repo'da yapilan degisiklik, bu betik calistirilmadan panele YANSIMAZ.

  Kullaniciya ozel dosyalar (bkz. installer\panel-files.ps1 -> $PanelUserFiles: engine-root.txt,
  diarize-device.txt, sozluk.json, kisiler.json, assemblyai-key.txt) ASLA ezilmez —
  $include disinda tutulduklari icin kopyalama onlara hic dokunmaz.

  Kullanim:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-dev.ps1
#>
$ErrorActionPreference = "Stop"

$src = $PSScriptRoot
$dst = Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yusufwrl.premierepanel"

# Dosya listeleri tek kaynaktan gelir; pack-panel.ps1 de ayni dosyayi okur.
# (Eskiden liste iki betikte kopyaydi: birini guncelleyip digerini unutmak, panelin
#  sende calisip arkadasinda acilmamasi demekti.)
. (Join-Path $PSScriptRoot "installer\panel-files.ps1")

# Panele giren dosya/klasorler + gelistirmede lazim olan .debug (localhost:8088 DevTools).
# .debug bilerek yalnizca burada; son kullanici paketine girmiyor (bkz. pack-panel.ps1).
$include = $PanelInclude + ".debug"
# Kurulu kopyada varsa DOKUNULMAYACAK dosyalar
$koru = $PanelUserFiles

# Listede olmayan yeni bir ust duzey oge var mi? (panele gitmeden unutulmasin)
Test-PanelFileList -Root $src

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
  # Klasorleri once sil, sonra kopyala: Copy-Item -Recurse mevcut klasore BIRLESTIRIYOR,
  # yani repodan silinmis bir dosya kurulu kopyada kaliyordu (eski kodun calismaya devam
  # etmesi, "surum guncel ama davranis eski" tuzagi). Kullanici dosyalari kokte durdugu
  # icin ($koru) bu silme onlara dokunmaz.
  if (Test-Path $p -PathType Container) {
    $hedefAlt = Join-Path $dst $i
    if (Test-Path $hedefAlt) {
      # Premiere acikken dosya kilitli olabilir: silinemezse eski davranisa (uzerine
      # yazma) don, paneli yarim birakma.
      try { Remove-Item -LiteralPath $hedefAlt -Recurse -Force -ErrorAction Stop }
      catch { Write-Warning "$i eski hali silinemedi (Premiere acik olabilir), uzerine yaziliyor." }
    }
  }
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
  # ICERIK BASILMAZ: bu liste artik assemblyai-key.txt (API anahtari) ve sozluk/kisiler.json
  # (uzun JSON) iceriyor. Sadece kisa yol dosyalarinin degeri gosterilir.
  if (Test-Path $f) {
    if ($k -in @("engine-root.txt", "diarize-device.txt")) {
      Write-Host "Korundu: $k = $((Get-Content $f -Raw).Trim())" -ForegroundColor Cyan
    } else {
      Write-Host "Korundu: $k" -ForegroundColor Cyan
    }
  }
}
Write-Host ""
Write-Host "Premiere Pro'yu KAPATIP yeniden ac (panel kapat-ac yetmeyebilir)." -ForegroundColor Cyan
