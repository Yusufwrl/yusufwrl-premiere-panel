<#
  GitHub'a yayinla: repoyu olusturur (ilk sefer), kodu push eder ve panel.zip'i
  version.json'daki surumle release olarak yayinlar.
  GEREKSINIM: once `gh auth login` ile giris yapilmis olmali.

  Kullanim:
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1 -RepoName yusufwrl-premiere-panel -Private

  -Overwrite : tag zaten yayindaysa uzerine yaz. SADECE yarim kalmis bir yayini
               tamamlamak icin. Yeni bir duzeltme yayinlarken KULLANMA - surumu yukselt.
#>
param(
  [string]$RepoName = "yusufwrl-premiere-panel",
  [switch]$Private,
  [switch]$Overwrite
)
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot   # PremiereExtension koku
Set-Location $proj

# ============================================================================
#  0) SURUM ONCESI DENETIM - KIRMIZI VARSA YAYINLAMA
#  GERCEKTEN OLDU (v1.10.5, 11 Agustos 2026): app.js'te bir dizgenin icine gercek
#  satir sonu kacti, dosya ayristirilamaz hale geldi ve BOZUK HALIYLE YAYINLANDI.
#  Belirtisi olduruculdu: panel aciliyor, kartlar gorunuyor, hicbir dugme calismiyor.
#  Daha kotusu: bozuk panel KENDINI GUNCELLEYEMIYOR (guncelleme kontrolu de app.js
#  icinde), yani ikinci kullanici kilitlendi ve elle kurulum gerekti.
#  Denetim elle calistiriliyordu ve o gun sozdizimi kontrolu paket icinde YOKTU.
#  Artik yayin akisi denetimi KENDISI calistiriyor - unutulamaz.
# ============================================================================
Write-Host "Surum oncesi denetim calistiriliyor (node testler\tumtest.js)..."
& node (Join-Path $proj "testler\tumtest.js")
if ($LASTEXITCODE -ne 0) {
  throw "DENETIM KIRMIZI - yayinlanmadi. Yukaridaki KALDI satirlarini duzelt, sonra tekrar dene."
}
Write-Host "Denetim temiz, yayina devam ediliyor."

# gh cagrilarini PS 5.1 "native stderr = hata" tuzagina dusmeden calistirir; $LASTEXITCODE doner
function Invoke-Gh {
  param([Parameter(ValueFromRemainingArguments=$true)]$Args)
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & gh @Args 2>&1 | Out-Null
  $code = $LASTEXITCODE; $ErrorActionPreference = $old; return $code
}

# 0) Giris kontrolu
if ((Invoke-Gh auth status) -ne 0) { throw "GitHub girisi yok. Once: gh auth login" }
$owner = (gh api user -q .login).Trim()
if (-not $owner) { throw "GitHub kullanici adi alinamadi." }
$repo = "$owner/$RepoName"
Write-Host "Hedef repo: $repo" -ForegroundColor Cyan

# 0.5) SURUM KONTROLU - hicbir sey yazmadan/paketlemeden ONCE.
# Neden: surum yukseltilmeden calistirilinca yeni panel.zip ESKI tag'in altina yaziliyor,
# ekrana "Release guncellendi" basiliyordu. Istemci (js\updater.js) "uzak <= yerel" gordugu
# icin kimse guncellemeyi ALMIYOR, sen ise ulastigini saniyordun.
$ver = ""
try { $ver = (Get-Content (Join-Path $proj "version.json") -Raw | ConvertFrom-Json).version } catch {}
if (-not $ver) { throw "version.json okunamadi ya da 'version' alani bos." }

$man = ""
$m = Select-String -LiteralPath (Join-Path $proj "CSXS\manifest.xml") -Pattern 'ExtensionBundleVersion="([^"]+)"' | Select-Object -First 1
if ($m) { $man = $m.Matches[0].Groups[1].Value }

$iss = ""
$m2 = Select-String -LiteralPath (Join-Path $PSScriptRoot "installer.iss") -Pattern '#define\s+AppVersion\s+"([^"]+)"' | Select-Object -First 1
if ($m2) { $iss = $m2.Matches[0].Groups[1].Value }

if ($ver -ne $man -or $ver -ne $iss) {
  throw ("Surum uyusmuyor - ucu de ayni olmali:`n" +
         "  version.json            = $ver`n" +
         "  CSXS\manifest.xml       = $man`n" +
         "  installer\installer.iss = $iss`n" +
         "Duzelt ve tekrar calistir (kolay yol: /surum-yayinla).")
}
Write-Host "Surum: v$ver (version.json + manifest.xml + installer.iss uyumlu)" -ForegroundColor Green

$tag = "v$ver"
$tagVar = ((Invoke-Gh release view $tag) -eq 0)
if ($tagVar -and -not $Overwrite) {
  throw ("$tag zaten yayinda. Once surumu YUKSELT (version.json + CSXS\manifest.xml + " +
         "installer\installer.iss), yoksa kimsenin panelinde guncelleme cikmaz.`n" +
         "Yarim kalan bir yayini tamamliyorsan: -Overwrite ekle.")
}

# 1) update.json'daki repo'yu gercek owner/repo ile guncelle (BOM'suz UTF-8 yaz!)
$upPath = Join-Path $proj "update.json"
$up = Get-Content $upPath -Raw | ConvertFrom-Json
$up.repo = $repo
$json = ($up | ConvertTo-Json -Depth 5)
[System.IO.File]::WriteAllText($upPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "update.json repo -> $repo"

# 2) panel.zip uret (guncel update.json ile)
# DIKKAT: cocuk surecin BASARISIZLIGI ebeveyni durdurmaz. $ErrorActionPreference="Stop"
# cocuga GECMEZ ve $LASTEXITCODE okunmazsa hata sessizce gecilir. Tek kapi Test-Path idi;
# ama pack-panel eski zip'i ancak Copy-Panel BASARIYLA bittikten SONRA siliyor, yani
# paketleme cokerse ESKI panel.zip diskte kaliyor, Test-Path TRUE donuyor ve betik o eski
# zip'i yeni tag'in altina yukluyordu. Sonucu panelde hicbir belirti vermiyor: arkadas
# guncellemeyi goruyor, ESKI kodu indiriyor, updater version.json'a TAG'den gelen yeni
# surumu yaziyor ve panel bir daha ASLA guncelleme almiyor (uzak <= yerel).
# Iki kapi birden: (a) uretim oncesi eskiyi SIL, (b) cikis kodunu kontrol et.
$zip = Join-Path $PSScriptRoot "panel.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "pack-panel.ps1") -Zip $zip
# ⚠ DIZGE ICINDE ASCII DISI KARAKTER KULLANMA (uzun tire, akilli tirnak...). Bu dosya BOM'suz
# UTF-8; Windows PowerShell 5.1 BOM'suz .ps1'i ANSI (cp1254) okuyor ve uzun tirenin (U+2014)
# UTF-8 baytlarindan 0x94 cp1254'te KAPATAN AKILLI TIRNAK oluyor. PowerShell onu gecerli bir
# dizge sonlandirici sayiyor, dizge orada bitiyor ve devami kod olarak ayristiriliyor:
# betik TEK SATIR bile calismadan "Unexpected token" ile oluyordu. Yorum satirlarindaki
# uzun tire zararsiz. Kontrol: [Parser]::ParseFile ile (testler\tumtest.js'te var).
if ($LASTEXITCODE -ne 0) { throw "pack-panel.ps1 basarisiz (cikis kodu $LASTEXITCODE) - panel.zip uretilmedi." }
if (-not (Test-Path $zip)) { throw "panel.zip uretilemedi" }
# Paket GERCEKTEN bu surum mu? Yanlis etiketli paket bagimsiz bir hata, ayni sonucu verir.
# Okuma basarisiz olursa YAYIN DURMAZ (bu bir ek kapi, ana kapi degil) — yalnizca not dusulur.
$zipVer = $null
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  $zf = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $vEntry = $zf.Entries | Where-Object { $_.FullName -eq "version.json" }
    if ($vEntry) {
      $sr = New-Object System.IO.StreamReader($vEntry.Open())
      try { $zipVer = ($sr.ReadToEnd() | ConvertFrom-Json).version } finally { $sr.Dispose() }
    }
  } finally { $zf.Dispose() }
} catch { Write-Host "NOT: zip icindeki surum dogrulanamadi ($($_.Exception.Message))" -ForegroundColor Yellow }
if ($zipVer -and $zipVer -ne $ver) {
  throw "panel.zip icindeki surum ($zipVer) yayinlanan surumden ($ver) FARKLI - paket bayat."
}

# 3) git init + commit (ilk sefer) / degisiklikleri commit
if (-not (Test-Path (Join-Path $proj ".git"))) { git init -b main | Out-Null }
# DIKKAT: burada "2>$null" YOK. PowerShell 5.1'de native bir komutun stderr'ini yonlendirmek
# ciktiyi NativeCommandError'a cevirir; $ErrorActionPreference="Stop" altinda bu, betigi
# tam da zip uretildikten sonra oldururdu (bir pre-commit hook'un tek satirlik uyarisi yeter).
# Cikis kodunu elle yonetiyoruz.
$eskiEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
git add -A
git commit -m "Panel guncelleme + dagitim" | Out-Null
$commitKod = $LASTEXITCODE
$ErrorActionPreference = $eskiEAP
if ($commitKod -ne 0) { Write-Host "Commit edilecek degisiklik yok, devam." -ForegroundColor Yellow }

# 4) Repo yoksa olustur ve push et
if ((Invoke-Gh repo view $repo) -ne 0) {
  if ($Private) { gh repo create $repo --private --source "." --remote origin --push }
  else          { gh repo create $repo --public  --source "." --remote origin --push }
  Write-Host "Repo olusturuldu ve push edildi." -ForegroundColor Green
} else {
  # DIKKAT: burada da "2>$null" YOK — satir 85-88'deki tuzagin ta kendisi. PS 5.1'de
  # $ErrorActionPreference="Stop" altinda native bir komutun stderr'ini yonlendirmek
  # NativeCommandError FIRLATIR ve yonlendirme bunu ENGELLEMEZ. `git remote get-url origin`
  # remote yokken "error: No such remote 'origin'" yaziyor, yani betik tam da o durumu
  # duzeltmek icin yazilmis `git remote add origin` satirina GELMEDEN oluyordu:
  # zip uretilmis, commit atilmis, push ve release HIC yapilmamis halde yarim kaliyordu.
  $eskiEAP2 = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git remote get-url origin 2>&1 | Out-Null
  $hasOrigin = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $eskiEAP2
  if (-not $hasOrigin) { git remote add origin "https://github.com/$repo.git" }
  git push -u origin main
  Write-Host "Degisiklikler push edildi." -ForegroundColor Green
}

# 5) Release olustur ($tag ve $tagVar yukarida, 0.5'te belirlendi)
if ($tagVar) {
  # Buraya yalnizca -Overwrite ile gelinir (yarim kalmis yayini tamamlama).
  gh release upload $tag $zip --clobber
  Write-Host "Release $tag UZERINE YAZILDI (-Overwrite)." -ForegroundColor Yellow
  Write-Host "NOT: Bu surumu daha once alanlar guncelleme gormez." -ForegroundColor Yellow
} else {
  gh release create $tag $zip --title $tag --notes "Panel $tag"
  Write-Host "Release $tag olusturuldu (panel.zip)." -ForegroundColor Green
}

Write-Host ""
Write-Host "BITTI. Arkadasin panelinde bir sonraki acilista otomatik guncelleme cikacak." -ForegroundColor Cyan
Write-Host "Repo: https://github.com/$repo"
