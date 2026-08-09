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
# varsayilan\ = pakete giden HAZIR ICERIK: ogretilmis preset'ler + Track Style dosyalari.
# Panel ilk acilista bunlari kurar (varsa UZERINE YAZMAZ) — bkz. js\app.js varsayilanlariKur.
# Boylece arkadasinda da preset'ler hazir gelir ve stiller Premiere'de gorunur.
$PanelInclude = @("index.html", "config.json", "update.json", "version.json",
                  "js", "jsx", "css", "CSXS", "varsayilan")

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
#
# lisans.json: sifre BIR KERE girilir (kullanicinin acik istegi). Guncelleme ya da
# yeniden kurulum bu dosyayi ezerse arkadas her seferinde sifreyi tekrar girer ve
# sunucuya gereksiz bir aktivasyon daha duser -> BES LISTEDE DE bulunmasi SART.
$PanelUserFiles = @("engine-root.txt", "diarize-device.txt", "sozluk.json",
                    "kisiler.json", "assemblyai-key.txt", "anthropic-key.txt",
                    "presetler.json",
                    "presetler.bak.json",
                    "lisans.json")

# Panele girmemesi NORMAL olan ust duzey ogeler (gelistirme/dagitim/dokuman dosyalari).
# Test-PanelFileList bunlari "unutulmus" saymaz.
# .debug: yalnizca gelistirici kopyasina gider (deploy-dev.ps1). Son kullanici paketinde
#         gereksiz bir DevTools dinleyicisi (localhost:8088) acar, o yuzden burada.
# sunucu: Cloudflare Worker kaynagi (lisans sunucusu). Panele GITMEZ — orasi Cloudflare'de
#         calisiyor ve panelin icinde bir isi yok. Panel yalniz Worker'in ADRESINI biliyor
#         (js/lisans.js SUNUCU_HOST); ADMIN_TOKEN ve diger secret'lar Cloudflare'de durur,
#         hicbiri panele gomulmez.
# testler: surum oncesi denetim paketi (node testler\tumtest.js). Panele GITMEZ — Premiere'de
#          isi yok, yalnizca gelistirme sirasinda calisir. Bu klasoru listeye eklemeyi
#          UNUTTUGUMU testin kendisi yakaladi ("hicbir listede olmayan oge: testler").
$PanelIgnore = @(".git", ".gitignore", ".claude", ".debug", "installer", "KUR.bat",
                 "CLAUDE.md", "DAGITIM.md", "KULLANIM.md", "INCELEME-RAPORU.md",
                 "GELISTIRICI-MODU.reg", "deploy-dev.ps1", "install-dev.ps1", "sunucu",
                 "panel.zip", "TESLIM.md", "testler")

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
