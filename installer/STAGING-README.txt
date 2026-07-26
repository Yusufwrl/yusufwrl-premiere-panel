========================================================================
  YusufwrlKur.exe DERLEMEDEN ONCE  ->  staging\ klasorunu doldur
========================================================================

installer\ klasorunun icinde su yapiyi olustur:

  installer\
    installer.iss
    pack-panel.ps1
    staging\
      panel\                      <- panel dosyalari (asagidaki komut doldurur)
      engine\                     <- motor + stiller (elle kopyala)
        Faster-Whisper-XXL\       (faster-whisper-xxl.exe, ffmpeg.exe, _models\, _xxl_data\ ...)
        styles\                   (tofi text.mogrt vb.)
      PoetsenOne-Regular.ttf      <- Poetsen One fontu (Google Fonts'tan indir)

------------------------------------------------------------------------
1) panel\ klasorunu doldur (otomatik):
------------------------------------------------------------------------
   installer\ icinde PowerShell ac ve calistir:

     powershell -ExecutionPolicy Bypass -File .\pack-panel.ps1 -Stage .\staging\panel

   (config.json/update.json/version.json dahil tum panel dosyalarini kopyalar;
    motoru ve engine-root.txt'i haric tutar.)

   ONEMLI: staging\panel\update.json icindeki "repo" degerini KENDI GitHub
   deponla degistir (ornek: yusufwrl/yusufwrl-premiere-panel). Yoksa
   oto-guncelleme kapali kalir.

------------------------------------------------------------------------
2) engine\ klasorunu doldur (elle, ~3 GB):
------------------------------------------------------------------------
   Kendi motorunu oldugu gibi kopyala:

     robocopy "C:\Users\yusuf\YusufwrlEngine" ".\staging\engine" /E /XD work

   (/XD work = gecici ses/SRT klasorunu haric tutar; gerekmez.)

------------------------------------------------------------------------
3) Fontu koy:
------------------------------------------------------------------------
   PoetsenOne-Regular.ttf dosyasini staging\ icine koy.
   (Zaten sistemde kuruluysa: C:\Windows\Fonts icinden kopyalayabilirsin.)

------------------------------------------------------------------------
4) Derle:
------------------------------------------------------------------------
   - Inno Setup 6 kur: https://jrsoftware.org/isdl.php
   - installer.iss dosyasina cift tikla -> Inno Setup acilir -> Build > Compile
     (veya komut: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss)
   - Cikti: installer\YusufwrlKur.exe   <- arkadasina verecegin dosya

NOT: Motoru exe'ye gommek istemiyorsan (exe ~3 GB olur), installer.iss'teki
     "staging\engine\*" satirini sil; motoru ayri (Drive/WeTransfer) gonder,
     arkadasin C:\Users\<ad>\YusufwrlEngine icine acsin.
