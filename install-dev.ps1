# Yusufwrl Panel - Geliştirici kurulumu
# Bu script:
#  1) Adobe CEP "PlayerDebugMode" flag'ini acar (imzasiz eklenti yuklenebilsin)
#  2) Bu klasoru Premiere'in CEP extensions klasorune baglar (junction)
# Yonetici HAKKI GEREKMEZ - hepsi kullanici hesabinda.

$ErrorActionPreference = "Stop"

# --- 1) PlayerDebugMode (birden fazla CSXS surumu icin) ---
$versions = @("9","10","11","12")
foreach ($v in $versions) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    Write-Host "PlayerDebugMode acildi: CSXS.$v"
}

# --- 2) Junction ile bagla ---
$source = $PSScriptRoot
$extRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
if (-not (Test-Path $extRoot)) { New-Item -ItemType Directory -Path $extRoot -Force | Out-Null }

$target = Join-Path $extRoot "com.yusufwrl.premierepanel"
if (Test-Path $target) {
    Remove-Item $target -Force -Recurse
    Write-Host "Eski baglanti kaldirildi."
}
New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Host "Baglandi: $target  ->  $source"

Write-Host ""
Write-Host "BITTI. Premiere Pro'yu KAPATIP yeniden ac."
Write-Host "Panel: Window (Pencere) > Extensions > Yusufwrl Panel"
