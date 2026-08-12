# Dağıtım — Arkadaşına kurdurma + otomatik güncelleme

Bu panel tek başına değil: **panel + Whisper motoru (~3 GB) + Poetsen One fontu +
PlayerDebugMode** birlikte gerekiyor. `installer\` klasörü bunların hepsini tek bir
`YusufwrlKur.exe` içinde toplar. Panel de her açılışta GitHub'dan **sadece kendi
kodunu** güncelleyebiliyor (motoru tekrar indirmez).

---

## Nasıl çalışıyor (mimari)

- **Taşınabilir yollar:** `config.json` artık `C:\Users\yusuf\...` yerine `%ENGINE%`
  jetonu kullanıyor. Panel açılışta bunu, kurulumda yazılan `engine-root.txt`'ten
  (yoksa `%USERPROFILE%\YusufwrlEngine`'den) gerçek yola çeviriyor
  (`js/pipeline.js` → `loadConfig`). Yani config.json her makinede aynı, kullanıcı
  adı ne olursa olsun çalışıyor.
- **Kurulum:** `installer\installer.iss` (Inno Setup) → paneli CEP klasörüne, motoru
  seçilen yere, fontu per-user kurar, PlayerDebugMode'u açar, `engine-root.txt` yazar.
  Yönetici hakkı gerekmez.
- **Oto-güncelleme:** `js/updater.js` panel açılışta GitHub'ın "latest release"
  sürümünü `version.json`'la kıyaslar; yenisi varsa `panel.zip`'i indirip uzantı
  klasörüne açar, `engine-root.txt`'e dokunmaz, "Premiere'i yeniden başlat" der.
  Repo `update.json` içinde tanımlı.

---

## A) Bir kerelik: kurulum exe'sini üretmek (senin makinende)

1. **Inno Setup 6** kur: https://jrsoftware.org/isdl.php
2. `installer\STAGING-README.txt`'i takip ederek `installer\staging\` klasörünü doldur:
   - `staging\panel\` → panel dosyaları:
     ```bash
     powershell -ExecutionPolicy Bypass -File installer\pack-panel.ps1 -Stage installer\staging\panel
     ```
   - `staging\panel\update.json` içindeki `"repo"`'yu **kendi GitHub deponla** değiştir
     (örn. `yusufwrl/yusufwrl-premiere-panel`).
   - `staging\engine\` → motorunu kopyala:
     ```bash
     robocopy "C:\Users\yusuf\YusufwrlEngine" "installer\staging\engine" /E /XD work
     ```
   - `staging\PoetsenOne-Regular.ttf` → fontu koy.
3. `installer\installer.iss`'e çift tıkla → **Build > Compile**.
   Çıktı: **`installer\YusufwrlKur.exe`**

## B) Arkadaşın ne yapacak

1. `YusufwrlKur.exe`'ye çift tıkla → İleri, İleri, Kur.
2. **Premiere Pro'yu kapatıp yeniden aç.**
3. **Window (Pencere) > Extensions > Yusufwrl Premiere**. Bitti.

> Not: Whisper NVIDIA GPU (CUDA) ile çalışıyor — arkadaşında NVIDIA kart olduğu için
> `config.json` `device: cuda` kalabilir.

---

## C) Otomatik güncelleme — GitHub kurulumu (bir kez)

1. GitHub'da bir repo aç (örn. `yusufwrl-premiere-panel`). Public en kolayı.
2. `update.json`'daki `"repo"`'yu bu repoyla eşleştir (hem projede hem staging'de).
3. İlk sürümü yayınla (aşağıdaki "Güncelleme çıkarma" adımları — tag `v1.1.0`).

## D) Güncelleme çıkarma (her değişiklikte)

Kod değiştirdin, arkadaşında da güncellensin istiyorsun:

1. **Sürümü yükselt — ÜÇ dosyada aynı numara.** (Bu bölüm eskiden "iki dosya" diyordu;
   üçüncüsü unutulunca `publish-github.ps1` denetimi koşturup zip'i ürettikten *sonra*
   "Surum uyusmuyor" diye ölüyordu.)
   - `version.json` → `"version": "1.2.0"`
   - `CSXS/manifest.xml` → `ExtensionBundleVersion="1.2.0"`
   - `installer/installer.iss` → `#define AppVersion "1.2.0"`
   ⚠ Bu üç dosyayı **Edit ile** değiştir. PowerShell'de `Get-Content -Raw` + `Out-File
   -Encoding utf8` çifti Türkçe karakterleri sessizce bozuyor (gerçekten oldu).
2. **Denetimden geçir** — her sürümden önce:
   ```bash
   node testler\tumtest.js
   ```
3. **Yayınla — TEK KOMUT.** Commit + push + zip + release + staging tazeleme, hepsi bunda:
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\publish-github.ps1
   ```
4. Arkadaşın Premiere'i bir dahaki açışında panel "Yeni sürüm v1.2.0 var, güncellensin
   mi?" diye soracak → Evet → indirir, "Premiere'i yeniden başlat" der.

> ⚠ **ELLE zip üretip elle Release açma.** O yol betikteki korumaların hepsini atlıyor:
> sürüm üç dosyada tutuyor mu · tag zaten yayında mı (aynı tag'in altına yazılan yeni zip'i
> kimse ALMAZ, çünkü istemci "uzak ≤ yerel" görür) · zip GERÇEKTEN bu sürüm mü · paketleme
> çöktüyse diskte kalan ESKİ zip yüklenmiş mi · `installer\staging\panel` güncel mi.
> Bunların her biri gerçekten yaşanmış bir hatadan doğdu.

> Motor/font değişmediği sürece güncelleme sadece panel kodunu çeker (birkaç yüz KB).
> Motor değişirse yeni `YusufwrlKur.exe` gönderirsin (nadir olur).

---

## Notlar / tuzaklar

- **Türkçe kullanıcı adı:** Arkadaşının Windows kullanıcı adında `ç ş ğ ı ö ü` varsa,
  kurulumda motor klasörünü `C:\YusufwrlEngine` gibi sade bir yola seç (CEF Türkçe
  yollarda takılabiliyor). `engine-root.txt` bunu otomatik halleder.
- **Font görünmezse:** Poetsen One per-user kuruluyor; nadiren Premiere görmezse
  arkadaşın `.ttf`'e sağ tık > "Tüm kullanıcılar için yükle" yapabilir.
- **Güncelleme sırasında panel açıksa:** dosyalar bir sonraki açılışta devreye girer;
  güncelleme "başarısız" derse paneli kapatıp tekrar açması yeter.
- **Oto-güncellemeyi kapatmak:** `update.json`'daki `repo`'yu placeholder bırak
  (`GITHUB_KULLANICI/REPO-ADI`) → güncelleme kontrolü hiç çalışmaz.
