<#
  Yusufwrl Premiere - Tek tikla kurulum (arkadasin calistiracagi betik).
  Ayni klasorde beklenenler:
    panel\                     (panel dosyalari)
    PoetsenOne-Regular.ttf     (font; yoksa atlanir)
    engine\                    (motor ~3 GB; yoksa ayri kuruldugu varsayilir)
  YONETICI HAKKI GEREKMEZ - hepsi kullanici hesabinda.

  Test icin: -PanelDst / -EngineDst ile hedef klasorler override edilebilir.
#>
param(
  [string]$PanelDst  = (Join-Path $env:APPDATA "Adobe\CEP\extensions\com.yusufwrl.premierepanel"),
  [string]$EngineDst = "",
  [switch]$SkipEngine
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
Write-Host ""
Write-Host "=== Yusufwrl Premiere kuruluyor ===" -ForegroundColor Cyan

# --- Onceki kurulumdan kalan motor yolunu oku (panel silinmeden ONCE) ---
$oncekiEngine = ""
$erfEski = Join-Path $PanelDst "engine-root.txt"
if (Test-Path $erfEski) {
  try { $oncekiEngine = (Get-Content $erfEski -Raw -Encoding UTF8).Trim() } catch {}
}

# --- Motor hedefini belirle ---
if (-not $EngineDst) {
  if ($oncekiEngine -and (Test-Path $oncekiEngine)) {
    # Motor zaten kurulu ve nerede oldugunu biliyoruz. Varsayilana donmek, sadece panel
    # guncelleyen bir pakette (engine\ yok) engine-root.txt'i motorun OLMADIGI bir yola
    # cevirir ve panel tamamen calismaz hale gelirdi. Test-Path ayni zamanda bozuk/eski
    # kayitlari eler (yol yoksa varsayilana dusuluyor).
    $EngineDst = $oncekiEngine
    Write-Host "Mevcut motor klasoru kullanilacak: $EngineDst" -ForegroundColor Cyan
  }
  # Kullanici adinda ASCII-disi (Turkce vb.) karakter varsa CEF takilir -> sade yola kur
  elseif ($env:USERNAME -match '[^\x00-\x7F]') { $EngineDst = "C:\YusufwrlEngine" }
  else { $EngineDst = Join-Path $env:USERPROFILE "YusufwrlEngine" }
}

# --- 1) PlayerDebugMode (imzasiz CEP eklentisi yuklensin) ---
foreach ($v in 9..12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
}
Write-Host "[1/5] PlayerDebugMode acildi (CSXS 9-12)."

# --- 2) Panel -> CEP extensions ---
$panelSrc = Join-Path $here "panel"
if (-not (Test-Path $panelSrc)) { throw "panel\ klasoru bulunamadi: $panelSrc" }
$extRoot = Split-Path $PanelDst -Parent
New-Item -ItemType Directory -Path $extRoot -Force | Out-Null

# KULLANICI DOSYALARINI KURTAR: asagidaki Remove-Item kurulu panelin TAMAMINI siliyor.
# Bu betik "tekrar kurmak icin KUR.bat'a cift tikla" diye tasarlandigindan, korunmazsa
# aylarca doldurulan sozluk.json / kisiler.json her yeniden kurulumda sifirlaniyordu.
# BU BES DOSYA HER YERDE AYNI: .gitignore, installer\panel-files.ps1 ($PanelUserFiles;
# pack-panel.ps1 ve deploy-dev.ps1 listeyi oradan okur), installer\installer.iss (Excludes),
# js\updater.js (KULLANICI_DOSYALARI) ve burasi -> BESINI birden guncelle.
# config.json bu listede DEGIL: pakette gelir, asagida BIRLESTIRILIYOR (bkz. satir ~90).
$koru  = @("engine-root.txt", "diarize-device.txt", "sozluk.json", "kisiler.json",
           "assemblyai-key.txt", "anthropic-key.txt", "presetler.json", "presetler.bak.json",
           "lisans.json")
$yedek = Join-Path $env:TEMP ("panel_koru_" + [guid]::NewGuid().ToString("N"))
$korunan = @()

if (Test-Path $PanelDst) {
  New-Item -ItemType Directory -Path $yedek -Force | Out-Null
  foreach ($k in $koru) {
    $f = Join-Path $PanelDst $k
    if (Test-Path $f) { Copy-Item $f $yedek -Force; $korunan += $k }
  }
  # config.json ayri: geri yazilmiyor, asagida yeni surumle BIRLESTIRILIYOR.
  $cfgVar = Join-Path $PanelDst "config.json"
  if (Test-Path $cfgVar) { Copy-Item $cfgVar $yedek -Force }
  Remove-Item $PanelDst -Recurse -Force
}

# panel\ ICERIGINI hedefe kopyala (panel klasorunu degil)
New-Item -ItemType Directory -Path $PanelDst -Force | Out-Null
Copy-Item (Join-Path $panelSrc "*") -Destination $PanelDst -Recurse -Force

# Kenara alinan kullanici dosyalarini geri koy
foreach ($k in $korunan) {
  $f = Join-Path $yedek $k
  if (Test-Path $f) { Copy-Item $f $PanelDst -Force }
}

# config.json: kullanicinin ayarlari (maxWordsPerCue, device, fontName...) kalsin,
# yeni surumde eklenen anahtarlar da gelsin.
$cfgEski = Join-Path $yedek "config.json"
$cfgYeni = Join-Path $PanelDst "config.json"
if ((Test-Path $cfgEski) -and (Test-Path $cfgYeni)) {
  try {
    $y = Get-Content $cfgYeni -Raw | ConvertFrom-Json
    $e = Get-Content $cfgEski -Raw | ConvertFrom-Json
    $eklenen = 0
    # Bunlar kullanici ayari DEGIL, panelin kendi program yollari (motor klasorunun ic
    # duzeni; hepsi %ENGINE% token'li, makineye ozel yol icermez). Kullanicidaki eski deger
    # korunursa motor duzeni degistiginde yeni surum bunu mevcut kullaniciya ulastiramaz ve
    # panel "motor bulunamadi" der. O yuzden paketteki deger ZORLANIR (-Force).
    $paketten = @("engineExe", "ffmpegExe", "workDir", "stylesDir")
    foreach ($p in $y.PSObject.Properties) {
      if ($paketten -contains $p.Name) {
        $e | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
        continue
      }
      if (($e.PSObject.Properties.Name) -notcontains $p.Name) {
        $e | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value
        $eklenen++
      }
    }
    # BOM'suz UTF-8 yaz: panel dosyayi utf8 okuyor (js/pipeline.js loadConfig)
    [System.IO.File]::WriteAllText($cfgYeni, ($e | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    $korunan += "config.json"
    if ($eklenen) { Write-Host "      config.json: $eklenen yeni ayar eklendi, seninkiler korundu." }
  } catch {
    Write-Host "      config.json birlestirilemedi - paketteki kullanildi." -ForegroundColor Yellow
  }
}

if (Test-Path $yedek) { Remove-Item $yedek -Recurse -Force }
Write-Host "[2/5] Panel kuruldu: $PanelDst"
if ($korunan.Count) {
  Write-Host "      Korunan kisisel dosyalar: $($korunan -join ', ')" -ForegroundColor Cyan
}

# --- 3) Motor -> hedef ---
$engineSrc = Join-Path $here "engine"
if ($SkipEngine) {
  Write-Host "[3/5] Motor atlandi (-SkipEngine)." -ForegroundColor Yellow
} elseif (Test-Path $engineSrc) {
  Write-Host "[3/5] Motor kopyalaniyor (~3 GB, birkac dakika surebilir)..."
  New-Item -ItemType Directory -Path $EngineDst -Force | Out-Null
  $rc = robocopy $engineSrc $EngineDst /E /NFL /NDL /NJH /NJS /NC /NS /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy hatasi (kod $LASTEXITCODE)" }
  Write-Host "      Motor kuruldu: $EngineDst"
} else {
  Write-Host "[3/5] engine\ yok - motoru ayri kurdugun varsayiliyor: $EngineDst" -ForegroundColor Yellow
}

# --- engine-root.txt (panel motoru burada bulur) ---
[System.IO.File]::WriteAllText((Join-Path $PanelDst "engine-root.txt"), $EngineDst)
Write-Host "      engine-root.txt -> $EngineDst"

# --- 4) Font (per-user; Win10 1809+, admin gerekmez) ---
$ttf = Get-ChildItem $here -Filter "*oetsen*.ttf" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ttf) {
  try {
    $fontsDir = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts"
    New-Item -ItemType Directory -Path $fontsDir -Force | Out-Null
    $fdst = Join-Path $fontsDir $ttf.Name
    # Zaten kuruluysa (dosya kilitli olabilir) tekrar kopyalama; kaydi yine de garantiye al
    if (-not (Test-Path $fdst)) { Copy-Item $ttf.FullName $fdst -Force -ErrorAction Stop }
    New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts" `
      -Name "Poetsen One (TrueType)" -Value $fdst -PropertyType String -Force | Out-Null
    Write-Host "[4/5] Poetsen One fontu kuruldu."
  } catch {
    Write-Host "[4/5] Font atlandi (zaten kurulu olabilir)." -ForegroundColor Yellow
  }
} else {
  Write-Host "[4/5] Font dosyasi yok - Poetsen One'i elle kurman gerekebilir." -ForegroundColor Yellow
}

Write-Host "[5/5] BITTI!" -ForegroundColor Green
Write-Host ""
Write-Host "Premiere Pro'yu KAPATIP yeniden ac." -ForegroundColor White
Write-Host "Panel: Window (Pencere) > Extensions > Yusufwrl Premiere"
Write-Host ""
