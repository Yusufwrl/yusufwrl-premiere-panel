<#
  Panel dosya listesi - TEK KAYNAK.

  NEDEN: liste eskiden hem deploy-dev.ps1'de hem pack-panel.ps1'de ayri ayri duruyordu.
  Yeni bir ust duzey klasor (ornek: assets\) eklenip listelerden yalnizca biri
  guncellenirse panel senin makinende calisir ama panel.zip'e girmez -> arkadasindaki
  panel guncelleme sonrasi acilmaz. Artik ikisi de burayi okuyor.

  Bu dosya panele GIRMEZ; sadece gelistirme/dagitim betikleri kullanir.
  Kullanim (dot-source):
    . (Join-Path $PSScriptRoot "panel-files.ps1")          # installer\ icinden
    . (Join-Path $PSScriptRoot "installer\panel-files.ps1") # repo kokunden
#>

# Panele giren ust duzey dosya/klasorler.
# YENI BIR SEY EKLERKEN SADECE BURAYI GUNCELLE.
$PanelInclude = @("index.html", "config.json", "update.json", "version.json",
                  "js", "jsx", "css", "CSXS")

# Kullaniciya/makineye ozel dosyalar: pakete GIRMEZ, kurulu kopyada ASLA ezilmez.
#
# BU BES DOSYA HER YERDE AYNI. Listenin tekrarlandigi YERLER:
#   1) .gitignore
#   2) burasi ($PanelUserFiles)  <- pack-panel.ps1 ($exclude) ve deploy-dev.ps1 ($koru)
#                                   ayri liste TUTMAZ, ikisi de buradan okur
#   3) installer\installer.iss   (Excludes)
#   4) installer\kur.ps1         ($koru)
#   5) js\updater.js             (KULLANICI_DOSYALARI)
# Yeni bir kullanici dosyasi eklerken BESINI birden guncelle.
#
# config.json bu listede DEGIL ve buraya EKLENMEZ: pakete GIRMESI gerekiyor, yoksa temiz
# kurulumda panel hic acilmaz. Guncellemede korunmasi js\updater.js configBirlestir()
# ve installer\kur.ps1'deki birlestirme ile saglaniyor.
$PanelUserFiles = @("engine-root.txt", "diarize-device.txt", "sozluk.json",
                    "kisiler.json", "assemblyai-key.txt", "anthropic-key.txt",
                    "presetler.json",
                    "presetler.bak.json")

# Panele girmemesi NORMAL olan ust duzey ogeler (gelistirme/dagitim/dokuman dosyalari).
# Test-PanelFileList bunlari "unutulmus" saymaz.
# .debug: yalnizca gelistirici kopyasina gider (deploy-dev.ps1). Son kullanici paketinde
#         gereksiz bir DevTools dinleyicisi (localhost:8088) acar, o yuzden burada.
$PanelIgnore = @(".git", ".gitignore", ".claude", ".debug", "installer", "KUR.bat",
                 "CLAUDE.md", "DAGITIM.md", "KULLANIM.md", "INCELEME-RAPORU.md",
                 "GELISTIRICI-MODU.reg", "deploy-dev.ps1", "install-dev.ps1")

# Repo kokunde, hicbir listede olmayan ust duzey oge var mi? (Sessizce disarida kalmasin.)
function Test-PanelFileList {
  param([Parameter(Mandatory = $true)][string]$Root)
  $bilinen = $PanelInclude + $PanelUserFiles + $PanelIgnore
  Get-ChildItem -LiteralPath $Root -Force |
    Where-Object { $bilinen -notcontains $_.Name } |
    ForEach-Object {
      Write-Warning "Listede yok, panele GITMIYOR: $($_.Name)   (duzelt: installer\panel-files.ps1)"
    }
}
