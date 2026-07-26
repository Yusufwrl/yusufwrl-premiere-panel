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

# --- Motor hedefini belirle ---
if (-not $EngineDst) {
  # Kullanici adinda ASCII-disi (Turkce vb.) karakter varsa CEF takilir -> sade yola kur
  if ($env:USERNAME -match '[^\x00-\x7F]') { $EngineDst = "C:\YusufwrlEngine" }
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
if (Test-Path $PanelDst) { Remove-Item $PanelDst -Recurse -Force }
# panel\ ICERIGINI hedefe kopyala (panel klasorunu degil)
New-Item -ItemType Directory -Path $PanelDst -Force | Out-Null
Copy-Item (Join-Path $panelSrc "*") -Destination $PanelDst -Recurse -Force
Write-Host "[2/5] Panel kuruldu: $PanelDst"

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
