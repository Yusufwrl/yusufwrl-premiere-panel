<#
  GitHub'a yayinla: repoyu olusturur (ilk sefer), kodu push eder ve panel.zip'i
  version.json'daki surumle release olarak yayinlar.
  GEREKSINIM: once `gh auth login` ile giris yapilmis olmali.

  Kullanim:
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1
    powershell -ExecutionPolicy Bypass -File installer\publish-github.ps1 -RepoName yusufwrl-premiere-panel -Private
#>
param(
  [string]$RepoName = "yusufwrl-premiere-panel",
  [switch]$Private
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
git add -A
git commit -m "Panel guncelleme + dagitim" 2>$null | Out-Null

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

# 5) Release olustur (version.json'daki surum)
$ver = (Get-Content (Join-Path $proj "version.json") -Raw | ConvertFrom-Json).version
$tag = "v$ver"
if ((Invoke-Gh release view $tag) -eq 0) {
  gh release upload $tag $zip --clobber
  Write-Host "Release $tag guncellendi (panel.zip)." -ForegroundColor Green
} else {
  gh release create $tag $zip --title $tag --notes "Panel $tag"
  Write-Host "Release $tag olusturuldu (panel.zip)." -ForegroundColor Green
}

Write-Host ""
Write-Host "BITTI. Arkadasin panelinde bir sonraki acilista otomatik guncelleme cikacak." -ForegroundColor Cyan
Write-Host "Repo: https://github.com/$repo"
