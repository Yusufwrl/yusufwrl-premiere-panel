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
$zip = Join-Path $PSScriptRoot "panel.zip"
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "pack-panel.ps1") -Zip $zip
if (-not (Test-Path $zip)) { throw "panel.zip uretilemedi" }

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
  $hasOrigin = $false; git remote get-url origin 1>$null 2>$null; if ($LASTEXITCODE -eq 0) { $hasOrigin = $true }
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
