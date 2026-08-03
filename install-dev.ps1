# Yusufwrl Panel - Gelistirici ILK kurulumu (KUR.bat bunu cagirir)
# Bu script:
#  1) Adobe CEP "PlayerDebugMode" flag'ini acar (imzasiz eklenti yuklenebilsin)
#  2) deploy-dev.ps1'i cagirip repo dosyalarini kurulu panele KOPYALAR
# Yonetici HAKKI GEREKMEZ - hepsi kullanici hesabinda.
#
# NEDEN ARTIK JUNCTION YOK (eski surum junction kuruyordu):
#  a) Bu repo OneDrive altinda ve yolunda Turkce karakter + bosluk var
#     ("...\Masaustu\...\Visual Studio\..."). Junction ile baglandiginda CEP'in
#     Chromium'u (CEF) paneli hic acmiyor.
#  b) Junction kurmadan once kurulu klasoru komple siliyordu; icindeki sozluk.json,
#     kisiler.json, engine-root.txt gibi KULLANICI DOSYALARI da gidiyordu (yedeksiz).
# Dogru yol: panel ASCII bir yolda AYRI KOPYA olarak durur, deploy-dev.ps1 ile guncellenir.

$ErrorActionPreference = "Stop"

# --- 1) PlayerDebugMode (birden fazla CSXS surumu icin) ---
$versions = @("9","10","11","12")
foreach ($v in $versions) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
    Write-Host "PlayerDebugMode acildi: CSXS.$v"
}

# --- 2) Eski surumlerden kalan junction varsa temizle ---
$extRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
if (-not (Test-Path $extRoot)) { New-Item -ItemType Directory -Path $extRoot -Force | Out-Null }
$target = Join-Path $extRoot "com.yusufwrl.premierepanel"

if (Test-Path $target) {
    $item = Get-Item $target -Force
    if ($item.LinkType) {
        Write-Host "Eski $($item.LinkType) bulundu, kaldiriliyor (repo icerigine dokunulmaz)." -ForegroundColor Yellow
        # Reparse noktasini "bos dizin" gibi sil: hedefteki (repo) dosyalar KESINLIKLE silinmez.
        # try/catch SART: Premiere acikken klasor kilitli olur, .NET cirilciplak bir
        # UnauthorizedAccessException/IOException firlatir ve ErrorActionPreference="Stop"
        # yuzunden betik anlasilmaz bir Ingilizce yigin izi ile olur; panel de ne junction
        # ne kopya, yarim durumda kalir. Turkce ve ne yapmasi gerektigini soyleyen hata ver.
        try { [System.IO.Directory]::Delete($target, $false) }
        catch {
            throw ("Eski baglanti kaldirilamadi: $target`n" +
                   "Premiere Pro acik olabilir. Premiere'i tamamen kapat ve bu betigi tekrar calistir.")
        }
    }
}

# --- 3) Dosyalari kurulu panele kopyala (asil is deploy-dev.ps1'de) ---
$deploy = Join-Path $PSScriptRoot "deploy-dev.ps1"
if (-not (Test-Path $deploy)) { throw "deploy-dev.ps1 bulunamadi: $deploy" }
& $deploy

Write-Host ""
Write-Host "BITTI. Premiere Pro'yu KAPATIP yeniden ac."
Write-Host "Panel: Window (Pencere) > Extensions > Yusufwrl Premiere"
Write-Host ""
Write-Host "NOT: Bundan sonraki degisiklikler icin sadece deploy-dev.ps1 yeter." -ForegroundColor Cyan
