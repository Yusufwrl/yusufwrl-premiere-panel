# PremiereExtension — Yusufwrl Altyazı Paneli

Adobe Premiere Pro **CEP uzantısı**. A1 mikrofon kanalındaki Türkçe konuşmayı Faster-Whisper-XXL (large-v3, GPU) ile otomatik **2-3 kelimelik** altyazıya çevirir. Sadece Windows.

## Yapı
- Panel arayüzü: `index.html` + `js/app.js` + `js/pipeline.js` — CEP (CSInterface.js, `--enable-nodejs --mixed-context`).
- Karakter sözlüğü: `js/sozluk.js` — özel isimleri düzeltir (Tofi/Moni/Dora/Mimi/Niko). İki katman: motora `--hotwords` ipucu + transkript sonrası kesin kelime düzeltmesi (zincirlenmiş Türkçe ekler dahil: "Tofilerden"). Liste `sozluk.json`'da (gitignore'lu), panelden düzenlenir.
- Senkron kartı: `js/kisiler.js` (Discord adı → karakter; **liste sırası = ses kanalı sırası**) + `js/hizala.js` (ses hizalama). Liste `kisiler.json`'da (gitignore'lu), panelden düzenlenir.

## Altyazı üretimi (js/app.js)
**TEK YOL: Premiere'in kendi altyazı kanalı.** Panel cue'ları SRT'ye yazar, `addCaptionsToTimeline` onu içe alıp caption track oluşturur. MOGRT yolu (renkli/animasyonlu, altyazı başına bir klip) **v1.8.0'da tamamen kaldırıldı** — 20 dakikalık videoda ~1000 klip üretip Premiere'i kilitliyordu. Görünüm (yazı tipi, renk, kontur, konum) Premiere'de bir kez ayarlanır: altyazıya tıkla → Essential Graphics → **Track Style → Create Style**.
- Bunun bedeli: **animasyon yok** ve **tek stil** (karaktere göre renk imkânsız — bir caption track'in tek stili olur). Kullanıcı bunu bilerek seçti.
- Kaldırılanlar: stil seçici, "Konuşmacıya Göre" ve "Renk Değiştir" modları, katman/lane mantığı, `videoKanaliYeterMi`, `stackShifter`, Shorts konum kaydırıcıları, host'taki `addMultiStyleSubtitles`/`addLanedSubtitles`/`addStyledSubtitles`/`recolorSelected` ve MOGRT yardımcıları (~900 satır).
- **Altyazı artık video kanalı TÜKETMİYOR** — "en alt video kanalı silinir" sınıfı hataların tamamı ortadan kalktı.
- **Kaynak Ses** seçenekleri: A1 · A2 · A3 · A1+A2 · **Herkes**. "Herkes" eski "Konuşmacıya Göre"nin yerini alır: klip içeren her kanal AYRI yazıya dökülür (üst üste konuşmalar karışmaz, doğruluk yüksek), sonuç `placeCaptions` içinde zaman sırasına dizilip tek caption track'e yazılır.
- **Shorts** kutusu duruyor ama artık yalnız **kelime bölmesini** değiştiriyor: `maxWords 2` + `maxChars 16` (uzunluğa göre 1, en fazla 2 kelime). Konum/boyut Premiere'in altyazı stilinden ayarlanır.
- **Altyazı sese hizalanır** (`sesleHizala`, pipeline.js). Motorun kelime damgası konuşma DUYULMADAN önceye düşebiliyor. Kullanıcının gerçek kaydında ölçüldü: 664 altyazının 185'i ses yokken başlıyordu (ortanca 0.31 sn, en fazla 1.18 sn); suçlu panel değil (656/664 cue kendi ilk kelimesiyle birebir aynı anda başlıyor), kaynak motorun damgası. Cue başında ses yoksa cue **ileri** kaydırılır. Ölçülen etki: **185 → 36**. Kurallar: asla geriye kaydırmaz · en fazla 0.60 sn · cue'ya 0.35 sn okuma süresi kalmıyorsa dokunmaz. `opts.sesHizala === false` ile kapatılır.
- **Diarizasyon (AI konuşmacı tahmini) KALDIRILDI.** Ölçüldü: tek kişilik kayıtta pyannote_v3.1 4, reverb_v2 3, ücretli AssemblyAI 4 konuşmacı buldu (doğrusu 1). Eski diarizasyonlu oturumlar geri yüklenirken A1+A2 tek listeye birleştirilir.
- Üretim sonunda oturum `%ENGINE%\work\oturum_<sekans>.json`'a yazılır; panel açılışında geri yükleme teklif edilir.

## Senkron kartı (Craig kayıtları)
Discord'da Craig bot'un kişi başına ayrı aldığı kayıtları (`1-yusufwrl.m4a`) otomatik hizalar ve doğru kanala koyar. Diarizasyonun yerini alır — ayrım %100 doğru.
- **Kanal kuralı:** A1 = videoyu çeken (OBS mikrofonu, dokunulmaz) · A2 = Tofi/Moni'den diğeri · sonra `kisiler.json` **sırasıyla** kalan karakterler · **en son oyun sesi**. Videoda olmayan karakter kanal harcamaz, alttakiler yukarı kayar (Sage+Niko yoksa oyun sesi A5). Çekenin Craig kaydı **timeline'a konmaz**, yalnızca hizalama referansıdır.
- **Oyun sesini panel TAŞIR** (`kanalTasi`): kopyala-doğrula-sil. Kaynak medya başka bir ses kanalında da geçiyorsa (çoklu-akışlı OBS kaydı: A1/A2/A3 aynı dosyanın 1./2./3. akışı) taşıma **reddedilir** — yeniden yerleştirilen klibe varsayılan eşleme düşer ve hedefe oyun sesi değil mikrofon gider. Doğrulanmadan kaynak silinmez; efekt/ses seviyesi anahtar kareleri kopyalanmaz.
- **Timeline renk etiketi YOK** (kullanıcı iptal etti). `setColorLabel` çağrısı kaldırıldı, plan dosyası biçimi `yol|kanal|başlangıç|ad`.
- Hizalama enerji zarfı çapraz korelasyonu (`js/hizala.js`): kaba 200 ms → ince 20 ms, Pearson r. **Güvenilirlik sinyali korelasyon değil, medyan tutarlılığıdır** — tek başına r doğru eşleşmeyi yanlıştan ayıramıyor (ölçüldü). `tutarlilikKontrol` diğerlerinden sapan kaymayı işaretler.
- Her karakterin her videoda olması gerekmez — eksik karakter normaldir, hata değil. Aynı kişiye iki dosya düşerse (Craig `_2` eki) ilki ana kayıt, kalanlar "(2. kayıt)" etiketiyle ayrı kanala gider.
- Premiere'de **ses kanalı ekleme API'si yok** — kanal yetmezse panel uyarır, kullanıcı elle ekler. Yerleştirme yalnızca `audioTracks[i].overwriteClip(item, saniye)` ile yapılır; sekans düzeyindeki 4 parametreli biçim hedef kanalı garanti etmez ve A1'i ezebilir.
- Host katmanı: `jsx/host.jsx` — **ExtendScript (ES3)**: `let`/`const`/arrow/optional-chaining **YOK**. Premiere'i bu dosya sürer.
- Manifest: `CSXS/manifest.xml` — BundleId `com.yusufwrl.premierepanel`, PPRO 14+, CSXS 9.
- Motor harici: `%ENGINE%\Faster-Whisper-XXL` (varsayılan `C:\Users\yusuf\YusufwrlEngine`). Repoya dahil değil, gitignore'lu (~3GB).

## AutoCut (sessizlik kesme)
Konuşma olmayan boşlukları bulup timeline'dan ripple-delete eder. **Boşluk = işaretli kanalların HİÇBİRİNDE konuşma yok** demek.
- **Kanallar sabit DEĞİL, tahmin de yapılmaz.** Panel klip içeren tüm ses kanallarını listeler; varsayılan **hepsi işaretli**. Asimetrik risk: bir kanalı yanlışlıkla dışarıda bırakmak o kişinin konuşmasını sildirir, içeride bırakmak yalnızca "boşluk bulunamadı" dedirtir. Seçim `yw.acCh2_<idx>`'te hatırlanır — kanal numaralarının ANLAMI değiştiği için eski `acCh` anahtarı bilerek terk edildi.
- Eskiden A1+A2 **sabitti**; Senkron kartı arkadaşları A4+'ya koyduğu için onların sesi analize hiç girmiyor, yalnız A4'te biri konuşurken o bölüm boşluk sayılıp **kesiliyordu**. Yeni kanal eklerken bu tuzağı hatırla.
- Bir kanalın sesi hazırlanamazsa analiz düşmez ama **sessizce de geçilmez** — log'a "ATLANDI" düşer, çünkü o kanaldaki konuşma kesilir.
- Kesim maliyeti boşluk SAYISIYLA büyür: "En kısa boşluk" 0.1 sn binlerce kesim üretip saatlerce sürebilir; 0.3 sn neredeyse aynı kazancı çok daha hızlı verir.

## Komutlar (PowerShell)
- **Değişiklikleri panele gönder (her seferinde gerekir): `powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy-dev.ps1`** — kurulu panel junction değil KOPYA olduğu için repo değişiklikleri kendiliğinden yansımaz. Kullanıcıya özel dosyaları korur.
- İlk kurulum (PlayerDebugMode): `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dev.ps1` (veya `KUR.bat`). ⚠ Bu betik junction kurar — bu yolda CEF'i bozuyor, junction oluşursa kaldırıp `deploy-dev.ps1` kullan.
- Kurulumdan sonra Premiere'i **tamamen kapat-aç** → Window (Pencere) > Extensions > Yusufwrl Premiere.
- Otomatik-güncelleme zip'i: `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\pack-panel.ps1`.
- GitHub sürümü yayınla: `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\publish-github.ps1` (commit + push + release; `gh` kurulu ve girişli).
- Kurulum .exe'si (Inno Setup gerekir): `& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" .\installer\installer.iss` (ISCC PATH'te değildir).

## Tuzaklar
- **Altyazı artık video kanalı KULLANMIYOR.** v1.8.0 öncesinde her altyazı bir MOGRT klibiydi ve `idx = (videoKanalSayısı - 1) - lane` hesabı yanlış kanala denk gelince kullanıcının görüntüsünü siliyordu; katman bütçesi, `_stilBeyazListe` beyaz listesi ve `#STILLER|` başlığı bu yüzden vardı. Caption track'e geçişle bu mekanizmaların **tamamı kaldırıldı**. Yeni kod video kanalına hiç dokunmuyor — buraya bir daha lane/katman mantığı eklemeden önce bu tarihi hatırla.
- **Derleme yok** — HTML/JS/JSX düz dosyalar. Dosya değişince paneli kapat-aç (ya da Premiere'i yeniden başlat) → yeniden yüklenir.
- Panel JS'i CEP'in **kendi eski Node'unda** çalışır, sistem Node v24'te değil. ES5 tarzı kal; sadece `require()` ile built-in modüller.
- Sürüm çıkarken `version.json` **ve** `CSXS/manifest.xml` (ExtensionBundleVersion) birlikte artır. `installer.iss` AppVersion ayrı ve ayrıca güncellenir.
- **ffmpeg PATH'e gerekmez** — pipeline.js motorun içindeki `ffmpeg.exe`'yi tam yolla çağırır (Faster-Whisper-XXL kendi ffmpeg'ini getirir). **ffprobe YOK** — akış bilgisi `ffmpeg -i` çıktısından ayrıştırılır (`_probeAudioCount`).
- **Track ≠ ses akışı:** A1/A2/A3 track'i, medya dosyasının 1./2./3. ses akışına eşlenir — bu yalnızca OBS çoklu-kanal kaydında (tek dosya, çok akış) geçerli. Tek akışlı kayıtta ffmpeg `filter_complex` içindeki `[i:a:1]` "matches no streams" ile ÇÖKER (`-map`'in aksine `?` ile opsiyonel yapılamaz). `buildTimelineAudio` akış sayısını ölçüp olmayan akışı istemez.
- `config.json` `%ENGINE%` / `~` token'ları kullanır; makineye özel yol **gömme** (auto-updater config.json'ı ezer). Program yolları (motor/ffmpeg) kullanıcı ayarı DEĞİLDİR — `updater.js` `configBirlestir()` onları yeni sürümden zorla alır, yoksa güncelleme sonrası eski yol kalıp motor bulunamaz.
- **Kullanıcı dosyaları:** `engine-root.txt`, `diarize-device.txt`, `sozluk.json`, `kisiler.json`, `assemblyai-key.txt`. Liste artık **tek kaynakta**: `installer/panel-files.ps1` → `$PanelUserFiles` (`pack-panel.ps1` ve `deploy-dev.ps1` bunu okur). Ayrıca **elle tutulan üç kopya** var: `.gitignore`, `installer/installer.iss` `Excludes`, `installer/kur.ps1` `$koru`, ve `js/updater.js` `copyDir` skip listesi. Yeni bir kullanıcı dosyası eklerken `panel-files.ps1` + bu üçü/dördü güncellenir.
  ⚠ `config.json` bu listeye **AİT DEĞİL** — `installer.iss` `Excludes`'a eklenirse temiz kurulumda panel hiç açılmaz.
- Debug: panel açıkken Chrome/Edge'de `http://localhost:8088` → DevTools (panel HTML/JS). `host.jsx` için VS Code "ExtendScript Debugger".
- **Premiere 2026 (UXP):** CEP panelleri 2026 sürümünde yüklenmeyebilir. Panel görünmüyorsa muhtemel sebep bu; CEP hâlâ Premiere 2024/2025'te çalışır. Uzun vadede UXP'ye taşınması gerekir.
- **Kurulu panel junction DEĞİL, KOPYA:** `%APPDATA%\Adobe\CEP\extensions\com.yusufwrl.premierepanel` ayrı bir klasör (OneDrive + Türkçe karakterli yol CEF'i bozduğu için ASCII yola kopyalanmış). Repo'daki değişiklikler oraya **kopyalanmadan** panele yansımaz — `install-dev.ps1` ya da elle `Copy-Item`. Sürüm numarası güncel görünüp kodun eski olması bu yüzden olur.
- **ExtendScript'e metin geçerken dosya kullan:** `evalScript` string literaline gömülen Türkçe karakter/tırnak/ters bölü kırılgan. Altyazı yerleştirme ve metin düzeltme metni `work` klasöründeki geçici dosyadan okur (`_readFileUTF8`).
- **Motor `--initial_prompt` varsayılanı `auto`** (hazır Türkçe preset). Özel isim ipucu için onu ezme; `--hotwords` ayrı kanaldır ve preset'i bozmaz. `--reprompt` varsayılanı `True` olduğu için ipucu tüm video boyunca taşınır.
