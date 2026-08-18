<#
  GitHub'a yayinla: repoyu olusturur (ilk sefer), kodu push eder ve panel.zip'i
  version.json'daki surumle release olarak yayinlar.
  GEREKSINIM: once `gh auth login` ile giris yapilmis olmali.

  Kullanim:
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1 -RepoName yusufwrl-premiere-panel -Private

  -Overwrite : tag zaten yayindaysa uzerine yaz. SADECE yarim kalmis bir yayini
               tamamlamak icin. Yeni bir duzeltme yayinlarken KULLANMA - surumu yukselt.

  -GeriDonusOnayla : yayindaki en yuksek surumden KUCUK/ESIT bir surum cikarmaya izin ver.
               Normalde bu yasak, cunku panel guncellemeleri SAYISAL karsilastiriyor
               (js\updater.js cmpVer) ve "uzak <= yerel" olan bir yayin kimsenin
               panelinde GORUNMEZ - betik yine de "BITTI" derdi. Bilincli bir geri
               donus yapiyorsan bu anahtari ekle (bkz. CLAUDE.md, v1.15.0 / v1.9.21 notu).
#>
param(
  [string]$RepoName = "yusufwrl-premiere-panel",
  [switch]$Private,
  [switch]$Overwrite,
  [switch]$GeriDonusOnayla
)
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot   # PremiereExtension koku
Set-Location $proj

# gh cagrilarini PS 5.1 "native stderr = hata" tuzagina dusmeden calistirir; $LASTEXITCODE doner
function Invoke-Gh {
  param([Parameter(ValueFromRemainingArguments=$true)]$Args)
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & gh @Args 2>&1 | Out-Null
  $code = $LASTEXITCODE; $ErrorActionPreference = $old; return $code
}

# Invoke-Gh ciktiyi yutuyor; --json okumak icin ciktiyi da dondurur.
function Invoke-GhOut {
  param([Parameter(ValueFromRemainingArguments=$true)]$Args)
  $old = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  $out = (& gh @Args 2>&1 | Out-String)
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  return (New-Object psobject -Property @{ Kod = $code; Cikti = $out })
}

# js\updater.js cmpVer'in BIREBIR ayni mantigi: major.minor.patch SAYISAL karsilastirma.
# Metin karsilastirmasi olsaydi 1.9.9 -> 1.9.10 gecisi "kucuk" gorunurdu.
# Donus: 1 = a buyuk, -1 = b buyuk, 0 = esit.
function Compare-Surum {
  param([string]$a, [string]$b)
  $pa = ($a -replace '^[vV]', '').Split('.')
  $pb = ($b -replace '^[vV]', '').Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    $sa = "0"; if ($i -lt $pa.Count -and $pa[$i]) { $sa = $pa[$i] }
    $sb = "0"; if ($i -lt $pb.Count -and $pb[$i]) { $sb = $pb[$i] }
    $na = 0; $nb = 0
    [void][int]::TryParse(($sa -replace '[^0-9].*$', ''), [ref]$na)
    [void][int]::TryParse(($sb -replace '[^0-9].*$', ''), [ref]$nb)
    if ($na -gt $nb) { return 1 }
    if ($na -lt $nb) { return -1 }
  }
  return 0
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

# 0.6) SURUM GERCEKTEN EN BUYUK MU?
# Yukaridaki kapi yalnizca AYNI etiketin yayinda olup olmadigina bakiyordu. Daha YUKSEK
# numarali bir surum zaten yayindaysa fark etmiyordu - ama panel guncellemesi SAYISAL
# karsilastiriyor (js\updater.js cmpVer: "uzak <= yerel" ise guncelleme TEKLIF ETMIYOR),
# yani dusuk numarali bir yayin HICBIR kullaniciya ulasmaz. Betik yine de "BITTI" der ve
# gelistirici surumun cikip ulastigini sanir. Bu gercekten yasandi: CLAUDE.md'nin en
# ustunde "surum numarasi 1.15.0 ama kod v1.9.21" notu tam bu tuzagin yara izidir.
$enYuksek = ""
$rlSonuc = Invoke-GhOut release list --repo $repo --limit 100 --json "tagName,isDraft"   # TIRNAK SART: tirnaksizken PowerShell bunu IKI argumana boluyor ve gh reddediyor
if ($rlSonuc.Kod -eq 0) {
  # Cikti stderr ile karismis olabilir; JSON dizisini icinden ayikla.
  $jm = [regex]::Match($rlSonuc.Cikti, '\[[\s\S]*\]')
  if ($jm.Success) {
    try {
      foreach ($r in ($jm.Value | ConvertFrom-Json)) {
        # Taslak (draft) yayinlar API'de "latest" olarak gorunmez, panele hic ulasmaz.
        if ($r.isDraft) { continue }
        if (-not $r.tagName) { continue }
        if (-not $enYuksek -or (Compare-Surum $r.tagName $enYuksek) -gt 0) { $enYuksek = $r.tagName }
      }
    } catch {
      Write-Host "NOT: yayindaki surum listesi cozulemedi - geri donus kapisi calismadi." -ForegroundColor Yellow
    }
  }
} else {
  # Repo henuz yoksa (ilk yayin) release list basarisiz olur; karsilastiracak sey de yok.
  # ⚠ AMA gh'in GERCEK ciktisini da yaz: bu dal bir kez, tirnaksiz --json yuzunden HER ZAMAN
  # calisiyordu ve kapinin bozuk oldugu tam da bu masum notun altinda saklaniyordu.
  # Sebebi gormeden "repo yeni olabilir" demek, sessiz basarisizligin ta kendisi.
  Write-Host "NOT: yayindaki surumler okunamadi - geri donus kapisi ATLANDI." -ForegroundColor Yellow
  Write-Host ("     gh cikti: " + ($rlSonuc.Cikti -replace "\s+", " ")) -ForegroundColor Yellow
}

if ($enYuksek) {
  $kars = Compare-Surum $ver $enYuksek
  if ($kars -le 0) {
    if (-not $GeriDonusOnayla) {
      throw ("Yayindaki en yuksek surum $enYuksek; cikarmak istedigin surum v$ver.`n" +
             "Panel guncellemeleri SAYISAL karsilastiriyor (js\updater.js cmpVer), yani bu " +
             "yayin HICBIR kullanicinin panelinde GORUNMEZ - bosuna yayinlamis olursun.`n" +
             "Surumu $enYuksek'ten BUYUK yap (version.json + CSXS\manifest.xml + " +
             "installer\installer.iss birlikte).`n" +
             "Bilincli bir geri donus yapiyorsan: -GeriDonusOnayla ekle.")
    }
    Write-Host "UYARI: v$ver, yayindaki $enYuksek surumunden buyuk DEGIL." -ForegroundColor Yellow
    Write-Host "       -GeriDonusOnayla verildi: bu paket mevcut kullanicilara OTOMATIK ULASMAZ." -ForegroundColor Yellow
  } else {
    Write-Host "Yayindaki en yuksek surum: $enYuksek  ->  yeni surum v$ver (buyuk, tamam)" -ForegroundColor Green
  }
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
  # ONCE DOGRULA, SONRA MUJDELE. Cocuk surecin basarisizligi ebeveyni durdurmaz ve
  # $ErrorActionPreference="Stop" native komutlara GECMEZ: kontrol yokken betik repo hic
  # olusmamisken "olusturuldu" yazip release adimina geciyordu.
  if ($LASTEXITCODE -ne 0) { throw "gh repo create basarisiz (cikis kodu $LASTEXITCODE) - repo olusturulmadi, kod push edilmedi." }
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
  # ⚠ CIKIS KODU KONTROLU SART. git push basarisiz olsa bile (reddedilen push, kimlik
  # dogrulama, uzak dal ilerlemis) betik devam edip "push edildi" ve sonunda "BITTI"
  # yaziyordu: GitHub'da yeni kod YOK, gelistirici ise surumun ciktigini saniyordu.
  # Push ile release'in AYRI kalmasi ayrica en kotu durumu uretir: release panel.zip'i
  # tasir ama repodaki kaynak eski kalir.
  if ($LASTEXITCODE -ne 0) {
    throw ("git push basarisiz (cikis kodu $LASTEXITCODE) - degisiklikler GitHub'a GITMEDI, " +
           "release olusturulmadi.`nYukaridaki git ciktisini oku; duzeltip betigi tekrar calistir.")
  }
  Write-Host "Degisiklikler push edildi." -ForegroundColor Green
}

# 5) Release olustur ($tag ve $tagVar yukarida, 0.5'te belirlendi)
if ($tagVar) {
  # Buraya yalnizca -Overwrite ile gelinir (yarim kalmis yayini tamamlama).
  gh release upload $tag $zip --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload basarisiz (cikis kodu $LASTEXITCODE) - panel.zip YUKLENMEDI." }
  Write-Host "Release $tag UZERINE YAZILDI (-Overwrite)." -ForegroundColor Yellow
  Write-Host "NOT: Bu surumu daha once alanlar guncelleme gormez." -ForegroundColor Yellow
} else {
  gh release create $tag $zip --title $tag --notes "Panel $tag"
  # ⚠ ONCE DOGRULA, SONRA MUJDELE. Kontrol yokken gh basarisiz olsa bile ekranda yesil
  # "Release olusturuldu" ve "BITTI" yaziyordu: GitHub'da release YOK, hicbir panel
  # guncelleme gormuyor ve sebebi hicbir yerde gorunmuyordu.
  if ($LASTEXITCODE -ne 0) {
    throw ("gh release create basarisiz (cikis kodu $LASTEXITCODE) - $tag release'i OLUSMADI, " +
           "guncelleme kimseye ulasmaz.`nYukaridaki gh ciktisini oku; duzeltip tekrar calistir " +
           "(yarim kalmissa: -Overwrite).")
  }
  Write-Host "Release $tag olusturuldu (panel.zip)." -ForegroundColor Green
}

# SON KAPI: release GERCEKTEN yayinda mi ve panel.zip icinde mi?
# Cikis kodu 0 donmesi yetmiyor - "BITTI" yazmadan once yayinin varligini GERI OKUYORUZ.
# Bu betigin butun bedeli sessiz basarisizlikta: gelistirici surumun ciktigini sanip
# beklemeye baslar, kullanicilar ise hicbir sey gormez.
$dogrula = Invoke-GhOut release view $tag --repo $repo --json "tagName,assets"   # TIRNAK SART (bkz. yukaridaki not)
if ($dogrula.Kod -ne 0) {
  throw "Release $tag yayinda GORUNMUYOR (gh release view basarisiz). Yayin tamamlanmadi."
}
if ($dogrula.Cikti -notmatch 'panel\.zip') {
  throw ("Release $tag var ama icinde panel.zip YOK. Panel guncellemesi asset'i adiyla ariyor " +
         "(update.json 'asset'), yani guncelleme cikmaz. Tekrar calistir: -Overwrite")
}
Write-Host "Dogrulandi: $tag yayinda ve panel.zip iceriyor." -ForegroundColor Green

Write-Host ""
Write-Host "BITTI. Arkadasin panelinde bir sonraki acilista otomatik guncelleme cikacak." -ForegroundColor Cyan
Write-Host "Repo: https://github.com/$repo"
