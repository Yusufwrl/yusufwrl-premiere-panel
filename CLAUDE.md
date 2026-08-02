# PremiereExtension — Yusufwrl Altyazı Paneli

Adobe Premiere Pro **CEP uzantısı**. A1 mikrofon kanalındaki Türkçe konuşmayı Faster-Whisper-XXL (large-v3, GPU) ile otomatik **2-3 kelimelik** altyazıya çevirir. Sadece Windows.

## Yapı
- Panel arayüzü: `index.html` + `js/app.js` + `js/pipeline.js` — CEP (CSInterface.js, `--enable-nodejs --mixed-context`).
- Karakter sözlüğü: `js/sozluk.js` — özel isimleri düzeltir (Tofi/Moni/Dora/Mimi/Niko). İki katman: motora `--hotwords` ipucu + transkript sonrası kesin kelime düzeltmesi (zincirlenmiş Türkçe ekler dahil: "Tofilerden"). Liste `sozluk.json`'da (gitignore'lu), panelden düzenlenir.

## Üretim modları (js/app.js)
- **Tek Stil** (`runSingle`) — tek kanal ya da **Mix** (A1+A2 birleşik).
- **Konuşmacıya Göre** (`runChannels`) — A2/A3/A4… **her kanal bir kişi** (Craig bot ya da OBS ile kişi başı kayıt).
  Ayrım %100 doğru, üst üste konuşmalar da çıkar. Kanal satırlarında işaret kutusu (oyun sesi/karışık kanal atlanır)
  ve isim alanı var; ikisi de kanal numarasına göre localStorage'da hatırlanır.
  Çakışan konuşmalara greedy katman atanır — katman sayısı sekansın video kanalıyla sınırlanır
  (aşarsa host `lane`'i 0'a kelepçeleyip o kanaldaki klipleri siliyor).
- **Diarizasyon (AI konuşmacı tahmini) panelden KALDIRILDI.** Ölçüldü: tek kişilik kayıtta pyannote_v3.1
  4 konuşmacı, reverb_v2 3 konuşmacı, ücretli AssemblyAI 4 konuşmacı buldu (doğrusu 1). Sorun modelde değil,
  karışık kanalda konuşmacıyı tahmin etmenin doğasında. `pipeline.transcribe`'ın `diarize` desteği kodda
  duruyor (eski oturumların geri yüklenmesi ve olası ihtiyaç için), UI'dan erişilmiyor.
- Üretim sonunda oturum `%ENGINE%\work\oturum_<sekans>.json`'a yazılır; panel açılışında geri yükleme teklif edilir.
- Host katmanı: `jsx/host.jsx` — **ExtendScript (ES3)**: `let`/`const`/arrow/optional-chaining **YOK**. Premiere'i bu dosya sürer.
- Manifest: `CSXS/manifest.xml` — BundleId `com.yusufwrl.premierepanel`, PPRO 14+, CSXS 9.
- Motor harici: `%ENGINE%\Faster-Whisper-XXL` (varsayılan `C:\Users\yusuf\YusufwrlEngine`). Repoya dahil değil, gitignore'lu (~3GB).

## Komutlar (PowerShell)
- **Değişiklikleri panele gönder (her seferinde gerekir): `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-dev.ps1`** — kurulu panel junction değil KOPYA olduğu için repo değişiklikleri kendiliğinden yansımaz. Kullanıcıya özel dosyaları korur.
- İlk kurulum (PlayerDebugMode): `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dev.ps1` (veya `KUR.bat`). ⚠ Bu betik junction kurar — bu yolda CEF'i bozuyor, junction oluşursa kaldırıp `deploy-dev.ps1` kullan.
- Kurulumdan sonra Premiere'i **tamamen kapat-aç** → Window (Pencere) > Extensions > Yusufwrl Premiere.
- Otomatik-güncelleme zip'i: `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\pack-panel.ps1`.
- GitHub sürümü yayınla: `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\publish-github.ps1` (commit + push + release; `gh` kurulu ve girişli).
- Kurulum .exe'si (Inno Setup gerekir): `& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" .\installer\installer.iss` (ISCC PATH'te değildir).

## Tuzaklar
- **Derleme yok** — HTML/JS/JSX düz dosyalar. Dosya değişince paneli kapat-aç (ya da Premiere'i yeniden başlat) → yeniden yüklenir.
- Panel JS'i CEP'in **kendi eski Node'unda** çalışır, sistem Node v24'te değil. ES5 tarzı kal; sadece `require()` ile built-in modüller.
- Sürüm çıkarken `version.json` **ve** `CSXS/manifest.xml` (ExtensionBundleVersion) birlikte artır. `installer.iss` AppVersion ayrı ve ayrıca güncellenir.
- **ffmpeg PATH'e gerekmez** — pipeline.js motorun içindeki `ffmpeg.exe`'yi tam yolla çağırır (Faster-Whisper-XXL kendi ffmpeg'ini getirir). **ffprobe YOK** — akış bilgisi `ffmpeg -i` çıktısından ayrıştırılır (`_probeAudioCount`).
- **Track ≠ ses akışı:** A1/A2/A3 track'i, medya dosyasının 1./2./3. ses akışına eşlenir — bu yalnızca OBS çoklu-kanal kaydında (tek dosya, çok akış) geçerli. Tek akışlı kayıtta ffmpeg `filter_complex` içindeki `[i:a:1]` "matches no streams" ile ÇÖKER (`-map`'in aksine `?` ile opsiyonel yapılamaz). `buildTimelineAudio` akış sayısını ölçüp olmayan akışı istemez.
- `config.json` `%ENGINE%` / `~` token'ları kullanır; makineye özel yol **gömme** (auto-updater config.json'ı ezer). Kullanıcıya/makineye özel dosyalar: `engine-root.txt`, `diarize-device.txt`, `sozluk.json` — gitignore'lu ve **üç yerde birden** korunmalı: `pack-panel.ps1` `$exclude`, `updater.js` `copyDir` skip listesi, `.gitignore`.
- Debug: panel açıkken Chrome/Edge'de `http://localhost:8088` → DevTools (panel HTML/JS). `host.jsx` için VS Code "ExtendScript Debugger".
- **Premiere 2026 (UXP):** CEP panelleri 2026 sürümünde yüklenmeyebilir. Panel görünmüyorsa muhtemel sebep bu; CEP hâlâ Premiere 2024/2025'te çalışır. Uzun vadede UXP'ye taşınması gerekir.
- **Kurulu panel junction DEĞİL, KOPYA:** `%APPDATA%\Adobe\CEP\extensions\com.yusufwrl.premierepanel` ayrı bir klasör (OneDrive + Türkçe karakterli yol CEF'i bozduğu için ASCII yola kopyalanmış). Repo'daki değişiklikler oraya **kopyalanmadan** panele yansımaz — `install-dev.ps1` ya da elle `Copy-Item`. Sürüm numarası güncel görünüp kodun eski olması bu yüzden olur.
- **ExtendScript'e metin geçerken dosya kullan:** `evalScript` string literaline gömülen Türkçe karakter/tırnak/ters bölü kırılgan. Altyazı yerleştirme ve metin düzeltme metni `work` klasöründeki geçici dosyadan okur (`_readFileUTF8`).
- **Motor `--initial_prompt` varsayılanı `auto`** (hazır Türkçe preset). Özel isim ipucu için onu ezme; `--hotwords` ayrı kanaldır ve preset'i bozmaz. `--reprompt` varsayılanı `True` olduğu için ipucu tüm video boyunca taşınır.
