# PremiereExtension — Yusufwrl Altyazı Paneli

Adobe Premiere Pro **CEP uzantısı**. A1 mikrofon kanalındaki Türkçe konuşmayı Faster-Whisper-XXL (large-v3, GPU) ile otomatik **2-3 kelimelik** altyazıya çevirir. Sadece Windows.

## Yapı
- Panel arayüzü: `index.html` + `js/app.js` + `js/pipeline.js` — CEP (CSInterface.js, `--enable-nodejs --mixed-context`).
- Karakter sözlüğü: `js/sozluk.js` — özel isimleri düzeltir (Tofi/Moni/Dora/Mimi/Niko). İki katman: motora `--hotwords` ipucu + transkript sonrası kesin kelime düzeltmesi (zincirlenmiş Türkçe ekler dahil: "Tofilerden"). Liste `sozluk.json`'da (gitignore'lu), panelden düzenlenir.
- Senkron kartı: `js/kisiler.js` (Discord adı → karakter; **liste sırası = ses kanalı sırası**) + `js/hizala.js` (ses hizalama). Liste `kisiler.json`'da (gitignore'lu), panelden düzenlenir.

## Üretim modları (js/app.js)
- **Tek Stil** (`runSingle`) — tek kanal ya da **A1+A2** (birleşik; panel düğmesinin etiketi budur, eski adı "Mix"ti).
- **Konuşmacıya Göre** (`runChannels`) — A2/A3/A4… **her kanal bir kişi** (Craig bot ya da OBS ile kişi başı kayıt).
  Ayrım %100 doğru, üst üste konuşmalar da çıkar. Kanal satırlarında işaret kutusu (oyun sesi/karışık kanal atlanır)
  ve isim alanı var; ikisi de kanal numarasına göre localStorage'da hatırlanır.
  Çakışan konuşmalara greedy katman atanır — katman sayısı sekansın video kanalıyla sınırlanır
  (aşarsa host `lane`'i 0'a kelepçeleyip o kanaldaki klipleri siliyor).
- **Shorts (dikey 1080x1920)** — Tek Stil kartındaki işaret kutusu. Yalnız Tek Stil'de çalışır; açıkken "Konuşmacıya Göre" düğmesi kapanır (dikey karede üst üste katman sığmaz ve Shorts konumlandırması yalnız `addMultiStyleSubtitles` yolunda uygulanır). İki şey değişir:
  1. **Bölme:** `maxWords 2` + `maxChars 16`. Asıl belirleyici karakter sınırı — sadece kelime sayısını düşürmek yetmiyor, "hazır mısınız" gibi soru eki yapışmış iki token 24 karakter ediyor (ölçüldü). `buildCues` artık sınırı **aşmadan önce** bölüyor; yatay çıktı 804 kelimede birebir aynı kaldı.
  2. **Konum:** panel cue dosyasının başına `#SHORTS|<yNorm>|<ölçek>` satırı yazar, host `_dikeyYerlestir` ile MOGRT'nin Y konumunu ve ölçeğini ayarlar. Satır yoksa konuma **hiç dokunulmaz** (yatay davranış aynen sürer). Konum Premiere'de normalize (0-1); piksel modunda dönen bir MOGRT'de dokunulmaz, kullanıcı elle yerleştirir.
  Yükseklik ve boyut panelden kaydırıcıyla ayarlanır (varsayılan %58 / %100), localStorage'da hatırlanır. Sekans yatayken kutu işaretliyse panel uyarır ama engellemez.
- **Diarizasyon (AI konuşmacı tahmini) panelden KALDIRILDI.** Ölçüldü: tek kişilik kayıtta pyannote_v3.1
  4 konuşmacı, reverb_v2 3 konuşmacı, ücretli AssemblyAI 4 konuşmacı buldu (doğrusu 1). Sorun modelde değil,
  karışık kanalda konuşmacıyı tahmin etmenin doğasında. `pipeline.transcribe`'ın `diarize` desteği kodda
  duruyor (eski oturumların geri yüklenmesi ve olası ihtiyaç için), UI'dan erişilmiyor.
- **Altyazı sese hizalanır** (`sesleHizala`, pipeline.js). Motorun kelime damgası konuşma DUYULMADAN önceye düşebiliyor — altyazı beliriyor, sonra kişi konuşuyor. Kullanıcının gerçek kaydında ölçüldü: 664 altyazının 185'i ses yokken başlıyordu (ortanca 0.31 sn, en fazla 1.18 sn). Suçlu panel değil — cue'ların 656/664'ü kendi ilk kelimesiyle birebir aynı anda başlıyor; kaynak motorun damgası. `transcribe` cue'ları kurduktan sonra kanalın WAV'ından enerji zarfı çıkarıp cue başında ses yoksa cue'yu **ileri** kaydırır. Ölçülen etki: erken altyazı **185 → 36**. Kurallar: asla geriye kaydırmaz · en fazla 0.60 sn (daha büyük boşluk muhtemelen yanlış hizalama) · cue'ya 0.35 sn okuma süresi kalmıyorsa dokunmaz. `opts.sesHizala === false` ile kapatılır.
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
- **Altyazı boş video kanalı ister.** host'ta hedef kanal `idx = (videoKanalSayısı - 1) - lane`; en alttaki kanal (idx 0) kullanıcının görüntüsüdür ve **asla kullanılmaz** → `vt >= enÜstLane + 2`. Tek Stil 2, Konuşmacıya Göre 3 video kanalı ister; `videoKanaliYeterMi()` yetmezse yerleştirmeyi durdurup kaç kanal ekleneceğini söyler. Temizlik de yalnız **kendi MOGRT'lerimize** dokunur (`_stilBeyazListe`, cue dosyasındaki `#STILLER|` satırı) — kullanıcının grafikleri ve görüntüsü silinmez.
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
