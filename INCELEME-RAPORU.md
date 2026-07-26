# AutoCut + Altyazı Boru Hattı — Önceliklendirilmiş Bulgu Raporu

> Kaynak: 13-ajanlı çok-perspektifli statik kod incelemesi (6 uzman incelemeci → düşmanca doğrulama → sentez). 52 bulgu doğrulandı/revize edildi. Tekrar edenler birleştirildi.

## ✅ UYGULANDI (2026-07-26) — deploy edildi, Premiere restart + canlı test bekliyor

- **H1** onay mesajı gerçek boşluk sayısı/süresini gösteriyor · **H6** NaN/null zaman damgası guard'ı · **H7** cleanPunct rakam-içi noktalama + kelime-içi tire koruma · **H9** eps = 0.75/fps · **A7** sondaki sessizlik artık kesiliyor · **S4** parseSpeakerIntervals null fallback · **S5** diarize SRT yok uyarısı · **U6** log 200 satırda kırpılıyor
- **A1** tespit ön-filtresi (highpass/lowpass/afftdn, fallback'li) · **A2** tepe-göreli eşik kelepçesi · **A8** asimetrik pay (leadIn/tailOut)
- **S1** CPS + min/max cue süresi · **S2** ardıl cue min boşluğu · **H7** (yukarıda)
- **H4** gerçek silme sayacı (noop ayrımı) · **H5** kesirli fps + drop-frame timecode · **H8** altyazı yerleştirme undo grubu · **H2/H3** senkron-güvenlik koruması (kayıt boşluğunda kesimi atla + overlay uyarısı; **tam uniform-ripple yeniden yazımı canlı teste ertelendi**)

**Not:** Node-tarafı mantık (cleanPunct, buildCues, flattenWords) yerelde test edildi ✓. host.jsx değişiklikleri (razor/ripple/undo) Premiere'de canlı doğrulanmalı. Kalan düşük-öncelikli bulgular (S3, S6–S10, A3–A6, A9, H10, H11, U1, U3–U5, U7, U8) aşağıda duruyor.

---

---

## ⭐ ÖNCE BUNLAR (yüksek değer / düşük efor)

| # | Başlık | Dosya | Neden |
|---|--------|-------|-------|
| 1 | Onay mesajı "2 boşluk" diyor ama tümü kesiliyor | app.js:298-299 | Kullanıcıyı doğrudan yanıltıyor, tek satır düzeltme |
| 2 | CPS / min-max cue süresi hiç yok | pipeline.js:205-206 | Okunamaz altyazı; Node tarafı, ES3 kısıtı yok |
| 3 | Tespit yolunda ön-filtre yok (konuşma bandı) | pipeline.js:301,308 | AutoCut isabetini en çok artıran düşük-eforlu adım |
| 4 | Geçersiz Whisper zaman damgası → bozuk SRT (NaN) | pipeline.js:123 | 3 satır guard, tüm SRT'yi çürütebilir |
| 5 | Ayarlar kalıcı değil (localStorage yok) | app.js | ~15 satır, her açılışta sıfırlanma sinir bozucu |
| 6 | eps=0.04 sabit; FPS'e bağla | host.jsx:510 | Tek satır, komşu klip yanlış silmesini önler |

---

## 1) HATALAR (bug / risk — öncelikli)

### H1. Onay mesajı yalan söylüyor — "2 boşluk" derken tümü kesiliyor
- **Sorun:** Onay "sadece 2 boşluk kesilecek (güvenli test)" der ama `acCuts` dizisinin tamamı host'a yazılır ve autoCut hepsini keser.
- **Konum:** app.js:298 (metin), app.js:299 (`acCuts.map` — slice yok), host.jsx:515 (bayat "İLK TESTTE 2 kesim" yorumu)
- **Öneri:** Metni gerçek veriye bağla — `confirm('Toplam '+acCuts.length+' boşluk kesilecek (~'+Math.round(acLast.totalCut)+' sn). Devam? (Ctrl+Z ile geri alınır)')`. Gerçekten test isteniyorsa `acCuts.slice(0,2)`. host.jsx:515 yorumunu da güncelle.
- **Severity:** high · **Effort:** low

### H2. Track-lokal ripple boş kanalda desenkron üretir
- **Sorun:** `_ripTrack` her kanalı ayrı ripple-siler; bir kanal kesim aralığında boşsa (b-roll, elle kesilmiş ses, altyazı track'i) o kanal kaymaz, diğerleri kayar → desenkron kesim başına birikir. Tek sürekli kayıt akışında sorun yok.
- **Konum:** host.jsx:502-507 (`_ripTrack`), host.jsx:509-513 (`_rippleDeleteRange`)
- **Öneri:** Her cut'tan önce tüm aktif track'lerde `[s,e]`'yi tam içeren klip var mı diye doğrula (`cs<=s+eps && ce>=e-eps`); yoksa o cut'ı atla ve diag'a uyar. En sağlamı: sekans-geneli tek uniform delta ile kaydırma.
- **Severity:** medium (revize) · **Effort:** high

### H3. Altyazı cue zamanları AutoCut sonrası kayar
- **Sorun:** Cue'lar mutlak sekans tick'ine yerleşir; AutoCut sesi sola kaydırınca altyazı track'i sessizlik aralıklarında boş olduğu için kaymaz → tüm MOGRT'ler konuşmayla desenkron. (H2 ile aynı kök.)
- **Konum:** host.jsx:233/259/392/465 (mutlak tick importMGT), host.jsx:556 (ripple)
- **Öneri:** Asıl çözüm H2. Kısa vade: UI'da akışı zorla — **önce AutoCut, sonra altyazı**.
- **Severity:** medium · **Effort:** medium

### H4. Hiçbir klip silinmese de cut "done" sayılır
- **Sorun:** `_ripTrack` eşleşen klip bulamazsa exception atmaz; ardından `done++`. Rapor "N boşluk kesildi" gerçek silinen değil işlenen aralık sayısını gösterir.
- **Konum:** host.jsx:506, 553-557, 564
- **Öneri:** `_ripTrack`/`_rippleDeleteRange` sildiği trackItem sayısını döndürsün; toplam 0 ise cut'ı "noop" say.
- **Severity:** medium · **Effort:** medium

### H5. razor timecode yuvarlanmış tam-sayı FPS ile → kesirli FPS'te kayma
- **Sorun:** `fps=Math.round(...)` (29.97→30). `_secToTC` bu FPS'le TC üretir, `qe.razor` gerçek kesirli FPS'te yorumlar → kesim konumu zamanla artan biçimde sapar.
- **Konum:** host.jsx:523 (fps round), 492-499 (`_secToTC`), 552-555 (razor)
- **Öneri:** Kareyi gerçek FPS ile hesapla (`fpsFrac=254016000000/parseFloat(seq.timebase)`), 29.97/59.94 için drop-frame TC (`;`), 24 için non-drop.
- **Severity:** medium · **Effort:** medium

### H6. Geçersiz Whisper zaman damgası → bozuk SRT (00:00:00,NaN)
- **Sorun:** `flattenWords` `w.start/w.end`'i doğrulamadan push eder; null → NaN, `fmtTime`'da "NaN" üretir (`NaN<0` false olduğu için guard yakalamaz).
- **Konum:** pipeline.js:123, buildCues:205-206, fmtTime:82-84
- **Öneri:** `var st=Number(w.start),en=Number(w.end); if(!isFinite(st)||!isFinite(en)) return;`. Savunma: `fmtTime` başına `if(!isFinite(t)) t=0;`.
- **Severity:** medium · **Effort:** low

### H7. cleanPunct sayı/saat/tarihteki noktalamayı bozuyor
- **Sorun:** Nokta/virgül/iki-nokta koşulsuz boşluğa çevrildiği için `3.5→3 5`, `14:30→14 30`, `1.000→1 000`. Tire kaybı da var (`e-posta→e posta`). Apostrof korunuyor.
- **Konum:** pipeline.js:94
- **Öneri:** Rakam-içi noktalamayı önce placeholder ile koru, cleanPunct uygula, geri yaz. Kelime-içi tireyi koru: `s.replace(/(^|\s)[-—–]+|[-—–]+(\s|$)/g,' ')`.
- **Severity:** medium · **Effort:** low

### H8. Hedef kanal doğrulanmadan temizleniyor + undo grubu yok
- **Sorun:** `addStyled*/addLaned*` çözülen video kanalındaki TÜM klipleri doğrulamadan siler (non-ripple silme **doğru**) ama kanalın altyazı kanalı olduğu doğrulanmaz ve `beginUndoGroup` yok — tek Ctrl+Z ile geri alınamaz (autoCut'ta var, altyazıda yok).
- **Konum:** host.jsx:251-253,333,384,454-457; 229,376
- **Öneri:** Tüm işi undo grubuna sar; silmeden önce klibin başlık/MGT olduğunu `getMGTComponent` ile doğrula.
- **Severity:** medium · **Effort:** medium

### H9. eps=0.04 sabit — yüksek FPS'te komşu kısa klibi silebilir
- **Sorun:** 0.04 sn 60fps'te ~2.4 kare; boşluğa bitişik tam içerilen kısa bir klip (SFX) yanlışlıkla silinebilir.
- **Konum:** host.jsx:510, 506, 494
- **Öneri:** `var eps = 0.75 / fps;` — fps'i `_rippleDeleteRange`'e parametre geçir.
- **Severity:** low · **Effort:** low

### H10. _findClipNear mesafe toleranssız → yanlış klibe yazma
- **Sorun:** Eşik yok; boş olmayan track'te her zaman en yakın klibi döndürür. `overwriteClip` truthy dönüp klip oluşmazsa ilgisiz klibin metni değişir.
- **Konum:** host.jsx:192-202, 338-344
- **Öneri:** Döngü sonuna `if(bd > 0.25*TICKS) return null;`.
- **Severity:** low · **Effort:** low

### H11. assignSpeakers eşiksiz "en yakın aralık" fallback
- **Sorun:** İç eşleşme yoksa mesafe eşiği olmadan en yakın konuşmacı zorlanır; yanlış konuşmacı → sahte bölme / yanlış renk.
- **Konum:** pipeline.js:152-157
- **Öneri:** `bd>0.5` sn ise `words[i].speaker=null`.
- **Severity:** low · **Effort:** low

---

## 2) AUTOCUT İYİLEŞTİRMELERİ

### A1. Tespit yolunda konuşma-bandı ön-filtresi yok  ·  high / low
Ham mix WAV doğrudan `volumedetect`/`silencedetect`'e gidiyor; oyun sızması/hum/rumble tabanı yükseltip boşlukları maskeliyor.
**Öneri (yalnız tespit yolunda, kesime giden sese DOKUNMA):**
`-af "highpass=f=90,lowpass=f=7000,afftdn=nr=12,dynaudnorm=f=250:g=8,silencedetect=noise=<th>dB:d=<min>"`. `buildTimelineAudio`'ya EKLEME (Whisper ile paylaşımlı).

### A2. Global mean-tabanlı tek eşik videolar arası tutarsız  ·  high / medium
`threshold=round(mean - sensitivity)` tüm dosya ortalamasına bağlı; aynı sensitivity farklı videoda farklı anlama gelir. **Öneri:** normalize-sonrası sabit gate, veya `astats` ile gürültü-tabanı persentili (`threshold = floor + margin`).

### A3. silencedetect saf genlik-gate — gerçek VAD çok daha isabetli  ·  high / medium
**Öneri (sıfır bağımlılık):** mevcut Whisper word-timestamp çıktısını yeniden kullan — konuşma dışı aralıkları sessizlik say. Alternatif: WebRTC VAD / Silero VAD (ONNX).

### A4. mixWavs düz toplam — kanal sızmaları birikiyor  ·  medium / medium
**Öneri:** kanal-başı silencedetect/VAD çalıştırıp kesiştir: **boşluk = A1 sessiz VE A2 sessiz**.

### A5. Kesim önizleme yok — "sadece işaretle" (marker) modu ekle  ·  medium / medium
ES3 `markGaps()` ile bulunan boşlukları timeline'a marker olarak koy; UI'da "İşaretle" + "Kes".

### A6. Kesimlerde ses fade yok — tık/pop (özellikle A3)  ·  medium / high
Birleşme noktasına 1-2 karelik constant-power geçiş (`addAudioTransition`, çok-imzalı try/catch) veya Volume>Level keyframe mini fade.

### A7. Trailing (sondaki) sessizlik hiç kesilmiyor  ·  low / low
`e > seqDur-0.03` koşulu sekans sonundaki sessizliği (en çok kırpılmak isteneni) her zaman atlar.
**Öneri:** `e = e > seqDur ? seqDur : e`, yalnız `s>=seqDur || e<=s` ise atla.

### A8. Asimetrik padding (nefes payı / lead-in)  ·  low / low
İki uçtan eşit yerine: `tailOut≈0.06-0.10`, `leadIn≈0.15-0.22` → ilk hece aceleci duyulmasın.

### A9. QE undo tek Ctrl+Z garantisi doğrulanamadı  ·  low / low
Sürüme bağlı; hedef sürümde elle test et, garanti yoksa metni yumuşat.

---

## 3) ALTYAZI İYİLEŞTİRMELERİ

### S1. CPS / min-max cue süresi hiç yok  ·  high / low
Cue süresi = son kelimenin end'i; okuma hızı sınırı yok.
**Öneri (buildCues çıkışında):** `minDur=max(0.8, text.length/17); maxDur=7.0;` clamp — sonraki cue.start'ı aşmadan (S2).

### S2. Ardıl cue'lar arası minimum boşluk garantisi yok  ·  medium / low
S1 min-süre uzatması eklenince overlap riski. **Öneri:** `cue.end = min(hedefEnd, nextStart - 0.08)`.

### S3. _setEndSec sessiz başarısızlık + sonraki cue'ya clamp yok  ·  low / low-med
Dönüş yok, hata yutulur; end tutmazsa MOGRT default süresinde kalır. **Öneri:** başarı döndür + sonraki cue.start'a clamp.

### S4. parseSpeakerIntervals fallback truthy → sessiz çöküş  ·  low / low
`'SPEAKER_?'` truthy olduğu için eşleşme olmazsa tüm bloklar tek konuşmacı sayılır. **Öneri:** fallback `null`.

### S5. diarize istendiği halde SRT yoksa sessizce atlanıyor  ·  low / low
**Öneri:** SRT yoksa log'a uyarı yaz.

### S6. Bayat transcript JSON'u sessizce kullanılabilir  ·  low / low
İptal/kill sonrası artık JSON kalırsa sonraki çökme onu okur. **Öneri:** `run()` öncesi eski çıktıları sil.

### S7. Türkçe soru eki koşulsuz birleşiyor  ·  low / low
Bilinçli; teorik olarak uzun duraklama sonrası "mı" önceki cue'yu uzatabilir. **Öneri (opsiyonel):** boşluk sınırı ekle.

### S8. _shiftUp normalize/piksel sezgisi kırılgan (istifleme)  ·  low / medium
Yalnız "Motion">"position" arar; MOGRT Transform'daysa kaydırmaz. **Öneri:** yüksekliği sekanstan türet, Transform/Position'ı da tara.

### S9. Cue başı Türkçe casing (i/İ) yok  ·  low / low
Opsiyonel: cümle-başı cue'da `toLocaleUpperCase('tr-TR')`.

### S10. word_timestamps mevcut ama cue'da atılıyor (karaoke verisi)  ·  low / high
İleride karaoke için per-kelime start/end'i cue'ya ekle; şu an tüketici yok, acele değil.

---

## 4) UX

### U1. Kes/yerleştirme sırasında iptal yok, butonlar guard'sız  ·  medium / low
`btnAddTimeline` confirm'siz + guard'sız → çift tık aynı cue setini iki kez yerleştirir. **Öneri:** handler başına disabled guard.

### U2. Kes öncesi onayda gerçek özet + "Geri Al" yok  ·  medium / low
(H1 ile aynı kök.) `analyzeSilence` sonucunu sakla, confirm'de "X boşluk, ~Y sn kısalır (eşik ZdB)" göster.

### U3. Ayarlar kalıcı değil  ·  medium / low
`acSens, acMin, selModel, stil` localStorage'a yazılmıyor. **Öneri:** ~15 satır change-listener + init'te oku.

### U4. İlerleme yüzdeleri sabit/uydurma; % regex kaynağı ayırmıyor  ·  medium / medium
`whenLog` her "%" satırını ilerleme sanıp barı zıplatır. **Öneri:** aşamaya bağlı regex, belirsizde indeterminate bar.

### U5. Hatalar alert()/confirm() ile — bloke edici, çift bildirim  ·  medium / medium
Kritik olmayanları inline uyarıya çevir.

### U6. Log alanı sınırsız büyüyor (O(n²) prepend)  ·  low / low
**Öneri:** 200 satırda kırp.

### U7. Erişilebilirlik: for/id, aria-pressed, aria-live yok  ·  low / medium

### U8. Mock önizleme sayıları (142/178) acCuts ile tutarsız  ·  low / low
Kozmetik; yalnız tarayıcı önizleme.

---

**Not — paylaşılan kök nedenler:**
- **H2 ↔ H3:** uniform-ripple düzeltmesi ikisini de kapatır.
- **H1 ↔ U2:** `acLast` (son analiz sonucu) saklamak ikisini de kapatır.
- **Detection zinciri (A1–A4):** tek bir `analyzeSilence` refaktörüyle birlikte ele alınmalı; hiçbiri `buildTimelineAudio`'ya (Whisper paylaşımlı) dokunmamalı.
