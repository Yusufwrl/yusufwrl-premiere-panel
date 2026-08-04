/*
 * ExtendScript — Premiere Pro içinde çalışır.
 * Panel (main.js) bu fonksiyonları CSInterface.evalScript ile çağırır.
 */

// JSON string kaçışı. C0 kontrol karakterleri (TAB, satır sonu vb.) ham bırakılırsa panel
// tarafındaki JSON.parse patlar — MOGRT metninde bunlar gerçekten görülebiliyor.
function _jsonEsc(s) {
    if (s === null || s === undefined) return "";
    s = String(s);
    s = s.replace(/\\/g, "\\\\");
    s = s.replace(/"/g, '\\"');
    s = s.replace(/[\r\n]/g, " ");
    s = s.replace(/[\x00-\x1f]/g, " ");   // kalan C0 kontrol karakterleri (TAB vb.)
    return s;
}

// Bağlantı testi
function ping() {
    return "Premiere bağlı: " + app.appName + " " + app.version;
}

// Aktif sekans + seçilen ses kanalının kliplerini JSON olarak döndürür.
// trackIdx: 0 = A1, 1 = A2, 2 = A3 ...
function getA1ClipsJSON(trackIdx) {
    if (trackIdx === undefined || trackIdx === null) trackIdx = 0;
    var seq = app.project.activeSequence;
    if (!seq) return '{"error":"no_sequence"}';
    if (!seq.audioTracks || seq.audioTracks.numTracks <= trackIdx) {
        return '{"error":"no_audio_track"}';
    }
    var track = seq.audioTracks[trackIdx];
    var parts = [];
    for (var i = 0; i < track.clips.numItems; i++) {
        var clip = track.clips[i];
        var mediaPath = "";
        try { mediaPath = clip.projectItem.getMediaPath(); } catch (e) { mediaPath = ""; }
        var startSec = 0, inSec = 0, durSec = 0;
        try { startSec = clip.start.seconds; } catch (e) {}
        try { inSec = clip.inPoint.seconds; } catch (e) {}
        try { durSec = clip.duration.seconds; } catch (e) {}
        parts.push(
            '{"mediaPath":"' + _jsonEsc(mediaPath) + '",' +
            '"timelineStartSec":' + startSec + ',' +
            '"inPointSec":' + inSec + ',' +
            '"durationSec":' + durSec + '}'
        );
    }
    return '{"sequenceName":"' + _jsonEsc(seq.name) + '",' +
           '"clipCount":' + track.clips.numItems + ',' +
           '"clips":[' + parts.join(",") + ']}';
}

/*
 * Sekanstaki SES kanallarını ve her birindeki klip sayısını döndürür.
 * "Ayrı kanal" modu bunu kullanır: hangi kanallarda konuşma var, kaç kanal seçilebilir.
 * Video kanalı sayısı da döner — her ek konuşmacı katmanı bir video kanalı tükettiği için
 * panel "yeterli video kanalın var mı" uyarısını buna göre verir.
 */
function getAudioTracksJSON() {
    var seq = app.project.activeSequence;
    if (!seq) return '{"error":"no_sequence"}';
    var out = [];
    var n = 0;
    try { n = seq.audioTracks.numTracks; } catch (eN) { n = 0; }
    for (var i = 0; i < n; i++) {
        var say = 0;
        try { say = seq.audioTracks[i].clips.numItems; } catch (e) { say = 0; }
        out.push('{"idx":' + i + ',"clips":' + say + '}');
    }
    var vt = 0;
    try { vt = seq.videoTracks.numTracks; } catch (eV) { vt = 0; }
    return '{"videoTracks":' + vt + ',"tracks":[' + out.join(",") + ']}';
}

/* ================= SENKRON KARTI (Craig kayıtlarını yerleştirme) ================= */

// Sekansın ses/video kanal sayısı ve içerik süresi — panel kanal bütçesini buna göre denetler.
function getSequenceInfoJSON() {
    var seq = app.project.activeSequence;
    if (!seq) return '{"error":"no_sequence"}';
    var av = 0, vv = 0, sure = 0;
    try { av = seq.audioTracks.numTracks; } catch (e1) {}
    try { vv = seq.videoTracks.numTracks; } catch (e2) {}
    try { sure = _seqDuration(seq); } catch (e3) {}
    var dolu = [];
    for (var i = 0; i < av; i++) {
        var n = 0;
        try { n = seq.audioTracks[i].clips.numItems; } catch (e4) {}
        dolu.push(n);
    }
    var olcu = _seqOlcu(seq);
    return '{"sequenceName":"' + _jsonEsc(seq.name) + '","audioTracks":' + av +
           ',"videoTracks":' + vv + ',"durationSec":' + sure.toFixed(3) +
           ',"frameWidth":' + olcu.w + ',"frameHeight":' + olcu.h +
           ',"dikey":' + (olcu.h > olcu.w ? "true" : "false") +
           ',"clipCounts":[' + dolu.join(",") + ']}';
}

/* Sekansin kare olcusu. Premiere surumune gore iki farkli yol var; ikisi de tutmazsa
   0 doner ve panel "olcu okunamadi" diye davranir (tahmin ETMEZ - yanlis tahmin
   altyaziyi ekran disina koyar). */
function _seqOlcu(seq) {
    var w = 0, h = 0;
    try { w = parseInt(seq.frameSizeHorizontal, 10) || 0; h = parseInt(seq.frameSizeVertical, 10) || 0; } catch (e1) {}
    if (!w || !h) {
        try {
            var s = seq.getSettings();
            w = parseInt(s.videoFrameWidth, 10) || 0;
            h = parseInt(s.videoFrameHeight, 10) || 0;
        } catch (e2) {}
    }
    return { w: w || 0, h: h || 0 };
}

/* Klip "korunacak ad" ile eslesiyor mu? Once klibin ADINA, tutmazsa MEDYA DOSYASININ adina
   bakar. Tek kritere (klip adi) guvenmek korumayi sessizce delik birakiyordu: panel kirpilmis
   bir kopya yerlestirdiginde (snkkirp_...) ya da Premiere klibi baska adlandirdiginda orijinal
   Craig adi klip adinda gecmiyor, koruma tutmuyor ve az once yerlesen kayit siliniyordu. */
function _klipKoruEslesir(cl, koru) {
    if (!koru) return false;
    var nm = "";
    try { nm = String(cl.name).toLowerCase(); } catch (e1) { nm = ""; }
    if (nm && nm.indexOf(koru) !== -1) return true;
    var mp = "";
    try { mp = String(cl.projectItem.getMediaPath()); } catch (e2) { mp = ""; }
    if (mp) { mp = _basename(mp).toLowerCase(); if (mp && mp.indexOf(koru) !== -1) return true; }
    return false;
}

// Bir ses kanalındaki TÜM klipleri siler (A2'yi boşaltmak için).
// ripple=false ŞART: true olsaydı sonraki klipler sola kayar ve tüm senkron bozulurdu.
function clearAudioTrack(trackIdx, korunacakAd) {
    /* Undo grubu: M klip silmek tek Ctrl+Z ile geri alinabilsin. Grup olmadan her silme ayri
       bir undo adimiydi; kullanici yanlislikla temizledigi kanali geri getirmek icin onlarca
       kez Ctrl+Z'ye basmak zorunda kaliyordu. */
    var _ug = false; try { app.beginUndoGroup("Yusufwrl A2 Temizlik"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var ix = parseInt(trackIdx, 10);
        if (isNaN(ix) || ix < 0 || ix >= seq.audioTracks.numTracks) return "err:A" + (ix + 1) + " kanalı yok";
        var koru = (korunacakAd == null) ? "" : String(korunacakAd).toLowerCase();
        var tr = seq.audioTracks[ix], silinen = 0, korunan = 0;
        /* GUVENLIK: korunacak bir ad verildiyse, once o adin kanalda GERCEKTEN bulundugunu
           dogrula. Bulunamazsa hic silme. Aksi halde ad yanlis uretildiginde (ornegin
           yerlestirilen dosya kirpilmis kopyaysa) koruma sessizce tutmaz ve kanaldaki
           HER SEY silinir — kullanicinin az once yerlesen kaydi dahil. */
        if (koru) {
            var bulundu = false;
            for (var c0 = 0; c0 < tr.clips.numItems; c0++) {
                if (_klipKoruEslesir(tr.clips[c0], koru)) { bulundu = true; break; }
            }
            // Metin düzgün Türkçe: bu dize doğrudan kullanıcıya gösteriliyor, ASCII hâli
            // panelin geri kalanıyla uyumsuz görünüyordu (evalScript DÖNÜŞÜ olduğu için
            // Türkçe karakter sorun çıkarmaz — sorun yalnız evalScript'e metin GEÇERKEN var).
            if (!bulundu) return "err:Korunacak klip (" + korunacakAd + ") A" + (ix + 1) +
                                 " kanalında bulunamadı; güvenlik için hiçbir şey silinmedi.";
        }
        for (var i = tr.clips.numItems - 1; i >= 0; i--) {
            /* korunacakAd verilmisse o kayda ait klip SILINMEZ. Bu olmadan, A2'ye az once
               yerlestirilen Craig klibi de siliniyordu (kullanici "eski karisik sesi temizle"
               derken yeni koyulani kaybediyordu). */
            if (koru && _klipKoruEslesir(tr.clips[i], koru)) { korunan++; continue; }
            try { tr.clips[i].remove(false, false); silinen++; } catch (e1) {}
        }
        return "ok:" + silinen + " klip silindi (A" + (ix + 1) + ")" + (korunan ? (", " + korunan + " korundu") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/*
 * Craig dosyalarını projeye alır, doğru ses kanalına doğru saniyeye yerleştirir ve
 * proje panelinde karakterin rengini verir.
 *
 * Plan dosyası (UTF-8), her satır:  medyaYolu|sesKanalIndeksi|baslangicSaniye|renkIndeksi|ad
 *
 * DİKKAT — bu fonksiyonun kritik incelikleri:
 *  - Zaman SANİYE (Number) olarak verilir. ticks string verilirse klip 0'a düşer.
 *  - overwriteClip kullanılır, insertClip DEĞİL: insert sonraki klipleri sağa iter (senkron bozulur).
 *  - Yerleştirmeden sonra kanalın klip sayısı KONTROL EDİLİR. Kanal tipi uyumsuzsa (saf Mono
 *    kanala stereo klip) Premiere sessizce hiçbir şey yapmıyor; bunu yakalamazsak kullanıcı
 *    "oldu" sanır.
 *  - İçe alınan ses dosyaları Premiere'de otomatik olarak varsayılan bir renk etiketi alır,
 *    bu yüzden setColorLabel her dosya için AÇIKÇA çağrılır.
 */
function senkronUygula(planDosyaPath) {
    /* Undo grubu: N dosyanin yerlestirilmesi + renk etiketleri tek Ctrl+Z ile geri alinabilsin.
       Grup olmadan her klip ayri bir undo adimiydi; yanlis klasor secildiginde kullanicinin
       tek tek onlarca kez geri alma yapmasi gerekiyordu. */
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Senkron"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var raw = _readFileUTF8(planDosyaPath);
        var lines = raw.split(/\r?\n/);
        var isler = [], yollar = [], i;
        for (i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 5) continue;
            var is = { yol: p[0], kanal: parseInt(p[1], 10), bas: parseFloat(p[2]),
                       renk: parseInt(p[3], 10), ad: p.slice(4).join("|") };
            if (isNaN(is.kanal) || isNaN(is.bas)) continue;
            if (is.bas < 0) is.bas = 0;
            isler.push(is); yollar.push(is.yol);
        }
        if (!isler.length) return "err:Plan boş";

        // Öğe arama yardımcıları (import ELEMESİ bunları kullandığı için yukarıda duruyorlar)
        function _norm(s) { return String(s).replace(/\\/g, "/").toLowerCase(); }
        // SADECE medya yolu eşleşmesi. Import elemesinde ad eşleşmesi kullanılmaz: farklı
        // klasördeki aynı adlı (ör. iki Craig kaydında da "1-tofi.m4a") dosya, yenisi hiç
        // import edilmeden eskisiyle karıştırılır ve timeline'a YANLIŞ ses konurdu.
        function _bulYol(yol) {
            var hedef = _norm(yol);
            for (var k = 0; k < bin.children.numItems; k++) {
                var ch = bin.children[k], mp = "";
                try { mp = ch.getMediaPath(); } catch (e) { mp = ""; }
                if (mp && _norm(mp) === hedef) return ch;
            }
            return null;
        }
        function _bul(yol) {
            var r = _bulYol(yol);
            if (r) return r;
            /* yol eşleşmezse dosya adına düş — AMA yalnız BU çalıştırmada import edilenlere bak.
               "Craig Sesleri" bin'i artık yeniden kullanıldığı için içinde önceki kayıtlardan
               kalan AYNI ADLI dosyalar duruyor ("1-tofi.m4a" her Craig kaydında var). Yol
               eşleşmesi herhangi bir sebeple tutmazsa (OneDrive/Türkçe yol, junction, UNC,
               Premiere'in farklı normalize etmesi) ad-fallback ESKİ kaydı döndürüp timeline'a
               YANLIŞ oturumun sesini koyuyordu; hiçbir uyarı da çıkmıyordu. */
            var ad = _basename(yol).replace(/\.[^.]+$/, "").toLowerCase();
            for (var m = 0; m < bin.children.numItems; m++) {
                var c2 = bin.children[m], nm = "", nid2 = "";
                try { nid2 = String(c2.nodeId); } catch (e3) { nid2 = ""; }
                if (nid2 && eskiOgeler["#" + nid2]) continue;   // önceki çalıştırmadan kalma: ada göre EŞLEME
                try { nm = String(c2.name).replace(/\.[^.]+$/, "").toLowerCase(); } catch (e2) {}
                if (nm === ad) return c2;
            }
            return null;
        }

        // 1) Dosyaları kendi bin'ine al
        /* Once MEVCUT "Craig Sesleri" bin'ini ara. Premiere ayni isimde bin olusturmaya izin
           verdigi icin kosulsuz createBin her calistirmada bir kopya daha yaratiyor; proje
           paneli ayni dosyalarin 3-4 kopyasiyla doluyor ve kullanici timeline'dakinin hangisi
           oldugunu ayirt edemiyordu. (ProjectItemType.BIN = 2; sabit yoksa ad eslesmesi yeter.) */
        var root = app.project.rootItem, bin = null, BIN_AD = "Craig Sesleri";
        try {
            for (var b0 = 0; b0 < root.children.numItems; b0++) {
                var ch0 = root.children[b0], ad0 = "", tip0 = 2;
                try { ad0 = String(ch0.name); } catch (eb1) { ad0 = ""; }
                if (ad0 !== BIN_AD) continue;
                try { tip0 = parseInt(ch0.type, 10); } catch (eb2) { tip0 = 2; }
                if (isNaN(tip0)) tip0 = 2;   // tip okunamadi: ad zaten eslesti, bin kabul et
                if (tip0 === 2) { bin = ch0; break; }
            }
        } catch (eb0) { bin = null; }
        /* Seçilen öğe gerçekten gezilebilir bir bin mi? Yukarıda tip okunamazsa öğe koşulsuz
           bin sayılıyor; bin değilse `bin.children` undefined olur ve ilk kullanımı (_bulYol)
           koruma try'ının DIŞINDA olduğu için tüm senkron "err:..." ile iptal olurdu.
           Doğrulanamıyorsa yok say, hemen aşağıdaki createBin'e düş. */
        if (bin) {
            var binOk = false;
            try { binOk = (bin.children != null && bin.children.numItems >= 0); } catch (eb3) { binOk = false; }
            if (!binOk) bin = null;
        }
        if (!bin) { try { bin = root.createBin(BIN_AD); } catch (eb) { bin = null; } }
        if (!bin) bin = root;

        /* Import ÖNCESİ bin içeriğinin fotoğrafı. Bin yeniden kullanıldığı için içinde önceki
           kayıtlardan kalan aynı adlı dosyalar olabiliyor; `_bul`'un ad-fallback'i onlardan
           birini yakalarsa timeline'a yanlış oturumun sesi konur. Fallback yalnız bu
           çalıştırmada import edilenlere bakacak (yol eşleşmesi zaten `_bulYol` ile yapılıyor).
           nodeId okunamazsa o öğe için eski davranış sürer — kötüleştirmez. */
        var eskiOgeler = {};
        try {
            for (var q0 = 0; q0 < bin.children.numItems; q0++) {
                var nid = ""; try { nid = String(bin.children[q0].nodeId); } catch (eq1) { nid = ""; }
                if (nid) eskiOgeler["#" + nid] = true;
            }
        } catch (eq0) {}

        /* Yalnizca projede HENUZ OLMAYAN dosyalari import et — bin yeniden kullanildiginda
           ayni medyanin kopyalari birikmesin. */
        var eksik = [];
        for (i = 0; i < yollar.length; i++) { if (!_bulYol(yollar[i])) eksik.push(yollar[i]); }
        if (eksik.length) {
            try { app.project.importFiles(eksik, true, bin, false); }
            catch (ei) { return "err:Dosyalar projeye alınamadı: " + ei.toString(); }
        }

        var konan = 0, hata = 0, ilkHata = "";
        for (i = 0; i < isler.length; i++) {
            var it = isler[i];
            var pi = _bul(it.yol);
            if (!pi) { hata++; if (!ilkHata) ilkHata = it.ad + ": projede bulunamadı"; continue; }

            // renk etiketi (yerleştirmeden ÖNCE — timeline klibi de renkli doğsun)
            if (!isNaN(it.renk) && it.renk >= 0 && it.renk <= 15) {
                try { pi.setColorLabel(it.renk); } catch (ec) {}
            }

            if (it.kanal < 0 || it.kanal >= seq.audioTracks.numTracks) {
                hata++; if (!ilkHata) ilkHata = it.ad + ": A" + (it.kanal + 1) + " kanalı yok";
                continue;
            }
            var once = 0;
            try { once = seq.audioTracks[it.kanal].clips.numItems; } catch (e3) {}

            /* SADECE kanal seviyesi kullanilir. Sekans seviyesindeki
               seq.overwriteClip(item, time, vIdx, aIdx) bicimi dokumante DEGIL (4 parametreli
               imza insertClip'e ait) ve klibi Premiere'de HEDEFLENMIS kanala koyabiliyor —
               bu da A1'deki OBS mikrofon kaydinin uzerine yazmak demek. */
            var oldu = false;
            try { oldu = seq.audioTracks[it.kanal].overwriteClip(pi, it.bas); } catch (e4) { oldu = false; }

            var sonra = 0;
            try { sonra = seq.audioTracks[it.kanal].clips.numItems; } catch (e6) {}
            if (sonra > once) konan++;
            else {
                hata++;
                if (!ilkHata) ilkHata = it.ad + ": A" + (it.kanal + 1) + " kanalına yerleşmedi " +
                    "(kanal tipi uyumsuz olabilir — Mono kanala stereo klip konamaz)";
            }
        }
        // Hicbiri yerlesmediyse BASARI DONME: panel "ok:" gorunce akisa devam edip
        // A2 temizligini bile teklif ediyordu.
        if (!konan) return "err:Hiçbir ses yerleştirilemedi. " + (ilkHata || "sebep bilinmiyor");
        return "ok:" + konan + " ses yerleştirildi" + (hata ? (", " + hata + " hata | " + ilkHata) : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

function _basename(p) { return String(p).replace(/^.*[\\\/]/, ""); }

// Playhead'i (CTI) verilen saniyeye taşır — konuşmacının ilk göründüğü ana atlamak için.
function seekTo(sec) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var s = parseFloat(sec); if (isNaN(s) || s < 0) s = 0;
        var ticks = Math.round(s * 254016000000);
        seq.setPlayerPosition(String(ticks));
        return "ok";
    } catch (e) { return "err:" + e.toString(); }
}

// SRT'yi projeye alır ve caption track olarak timeline'a (0 anına) ekler.
function addCaptionsToTimeline(srtPath) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";

        var root = app.project.rootItem;
        var before = root.children.numItems;
        app.project.importFiles([srtPath], true, root, false);
        var after = root.children.numItems;

        // İçe alınan caption öğesini bul (dosya adına göre)
        var baseName = _basename(srtPath).replace(/\.[^.]+$/, "");
        var item = null;
        for (var i = root.children.numItems - 1; i >= 0; i--) {
            var ch = root.children[i];
            if (ch && ch.name && ch.name.indexOf(baseName) !== -1) { item = ch; break; }
        }
        if (!item && after > before) item = root.children[root.children.numItems - 1];
        if (!item) return "err:Altyazı öğesi projede bulunamadı";

        // Caption track oluştur (0 anına). Farklı sürümlerde imza değişebilir; sırayla dene.
        if (typeof seq.createCaptionTrack === "function") {
            try { seq.createCaptionTrack(item, "0"); return "ok:Timeline'a eklendi"; }
            catch (e1) {
                try { seq.createCaptionTrack(item, 0); return "ok:Timeline'a eklendi"; }
                catch (e2) {
                    try {
                        var t = new Time(); t.ticks = "0";
                        seq.createCaptionTrack(item, t);
                        return "ok:Timeline'a eklendi";
                    } catch (e3) {
                        return "imported_only:Project panelinde. createCaptionTrack hata: " + e3.toString();
                    }
                }
            }
        }
        return "imported_only:Project panelinde (bu sürümde otomatik yerleştirme yok). Öğeyi timeline'a sürükle.";
    } catch (e) {
        return "err:" + e.toString();
    }
}

function _readFileUTF8(p) {
    var f = new File(p);
    f.encoding = "UTF-8";
    f.open("r");
    var s = f.read();
    f.close();
    return s;
}

function _writeFileUTF8(p, s) {
    try { var f = new File(p); f.encoding = "UTF-8"; f.open("w"); f.write(s); f.close(); return true; }
    catch (e) { return false; }
}

// TrackItem'in tüm bileşen/özelliklerini metne döker (teşhis).
function _dumpTrackItem(ti) {
    var out = [];
    try { ti.setSelected(1, 1); } catch (esel) { out.push("setSelected err: " + esel.toString()); }
    try { out.push("getMGTComponent tipi: " + (typeof ti.getMGTComponent)); } catch (e) {}
    try {
        var mc = ti.getMGTComponent();
        out.push("mgtComp: " + (mc ? "obj" : "null"));
        if (mc && mc.properties) {
            out.push("mgtComp.props: " + mc.properties.numItems);
            for (var m = 0; m < mc.properties.numItems; m++) {
                out.push("  mgt.p" + m + ": " + ("" + (mc.properties[m].displayName || "?")));
            }
        }
    } catch (e) { out.push("mgtComp err: " + e.toString()); }
    try {
        out.push("components: " + ti.components.numItems);
        for (var i = 0; i < ti.components.numItems; i++) {
            var comp = ti.components[i];
            var cn = "?";
            try { cn = "" + (comp.displayName || comp.matchName || "?"); } catch (ee) {}
            out.push("[" + i + "] " + cn);
            try {
                for (var j = 0; j < comp.properties.numItems; j++) {
                    var p = comp.properties[j];
                    var pn = "?";
                    try { pn = "" + (p.displayName || "?"); } catch (e3) {}
                    var extra = "";
                    if (/source text/i.test(pn)) {
                        try {
                            var gv = p.getValue();
                            extra = "  ==VALUE[" + (typeof gv) + "]== " + String(gv).substring(0, 400);
                        } catch (egv) { extra = "  getValue err: " + egv.toString(); }
                    }
                    out.push("    p" + j + ": " + pn + extra);
                }
            } catch (e2) { out.push("    props err: " + e2.toString()); }
        }
    } catch (e) { out.push("components err: " + e.toString()); }
    return out.join("\n");
}

// TrackItem'in metnini olası her yoldan ayarlamayı dener; hangi yolun tuttuğunu döndürür.
function _setTextAllWays(ti, text) {
    try { ti.setSelected(1, 1); } catch (esel) {}
    // 1) getMGTComponent
    try {
        var mc = ti.getMGTComponent();
        if (mc && mc.properties) {
            for (var m = 0; m < mc.properties.numItems; m++) {
                var mp = mc.properties[m];
                var mdn = "" + (mp.displayName || "");
                if (/source text|text|kaynak|yaz|başlık|title|altyaz/i.test(mdn)) {
                    try { mp.setValue(text, true); return "mgt:" + mdn; } catch (e1) {}
                }
            }
            if (mc.properties.numItems === 1) {
                try { mc.properties[0].setValue(text, true); return "mgt:tek"; } catch (e2) {}
            }
        }
    } catch (e) {}
    // 2) components üzerinden
    try {
        for (var i = 0; i < ti.components.numItems; i++) {
            var comp = ti.components[i];
            for (var j = 0; j < comp.properties.numItems; j++) {
                var p = comp.properties[j];
                var dn = "" + (p.displayName || "");
                if (/source text|text|kaynak|yaz|başlık|title|altyaz/i.test(dn)) {
                    try { p.setValue(text, true); return "comp[" + i + "]:" + dn; } catch (e3) {}
                }
            }
        }
    } catch (e) {}
    return "notfound";
}

function _setEndSec(ti, endSec, TICKS) {
    try { var t = new Time(); t.ticks = String(Math.round(endSec * TICKS)); ti.end = t; } catch (e) {}
}

// vTrack'te başlangıcı startSec'e en yakın klibi bulur (yeni yerleştirilen).
function _findClipNear(vTrack, startSec, TICKS) {
    var target = Math.round(startSec * TICKS);
    var best = null, bd = 1e18;
    for (var k = 0; k < vTrack.clips.numItems; k++) {
        var cl = vTrack.clips[k];
        var st = parseFloat(cl.start.ticks);
        var d = Math.abs(st - target);
        if (d < bd) { bd = d; best = cl; }
    }
    return best;
}

// MOGRT değerinden düz metni çıkarır (string ya da {text:...} JSON olabilir).
function _extractText(v) {
    if (typeof v === "string") {
        if (v.charAt(0) === "{") {
            /* ExtendScript ES3'tur ve JSON YERLESIGI GARANTI DEGILDIR. Eskiden burada yalniz
               JSON.parse vardi; JSON tanimsizsa ReferenceError catch'e dusuyor ve fonksiyon
               ham JSON metnini altyazi sanip ekrana basiyordu ("{"text":"selam"}" gibi).
               Once yerlesik denenir, yoksa "text" alani elle ayiklanir. */
            try {
                if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
                    var o = JSON.parse(v);
                    if (o && typeof o.text === "string") return o.text;
                }
            } catch (e) {}
            var m = v.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (m) {
                return m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t")
                           .replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            }
        }
        return v;
    }
    if (v && typeof v.text === "string") return v.text;
    return (v == null) ? "" : ("" + v);
}
// Yerleştirilmiş MOGRT klibinden metni OKUR (renk değiştirirken korumak için).
function _getMGTText(ti) {
    try {
        var mc = ti.getMGTComponent();
        if (mc && mc.properties) {
            for (var m = 0; m < mc.properties.numItems; m++) {
                var mp = mc.properties[m];
                if (/source text|text|kaynak|yaz|başlık|title|altyaz/i.test("" + (mp.displayName || ""))) {
                    try { return _extractText(mp.getValue()); } catch (e1) {}
                }
            }
            if (mc.properties.numItems === 1) { try { return _extractText(mc.properties[0].getValue()); } catch (e2) {} }
        }
    } catch (e) {}
    return null;
}

// Timeline'da SEÇİLİ altyazı (MOGRT) kliplerinin başlangıç saniyelerini JSON dizi döndürür.
// Panel bunları kendi cue listesiyle eşleyip TEMİZ yeniden yerleştirme yapar (importMGT'nin
// komşu klipleri ezme sorununa girmeden).
function getSelectedSubTimes() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "[]";
        var TICKS = 254016000000, out = [];
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            for (var i = 0; i < tr.clips.numItems; i++) {
                var cl = tr.clips[i];
                var sel = false; try { sel = cl.isSelected(); } catch (e) {}
                if (!sel) continue;
                var mc = null; try { mc = cl.getMGTComponent(); } catch (e) {}
                if (!mc) continue; // sadece MOGRT altyazı klipleri
                out.push(parseFloat(cl.start.ticks) / TICKS);
            }
        }
        return "[" + out.join(",") + "]";
    } catch (e) { return "[]"; }
}

/*
 * Timeline'da SEÇİLİ altyazı kliplerinin METNİNİ döndürür (JSON dizi).
 * Panelde "seçili klibin yazısını düzelt" akışı için: önce mevcut metin okunur, kullanıcı
 * düzeltir, sonra setSelectedSubText ile yerine yazılır.
 */
function getSelectedSubText() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "[]";
        var out = [];
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            for (var i = 0; i < tr.clips.numItems; i++) {
                var cl = tr.clips[i];
                var sel = false; try { sel = cl.isSelected(); } catch (e) {}
                if (!sel) continue;
                var mc = null; try { mc = cl.getMGTComponent(); } catch (e2) {}
                if (!mc) continue;
                var t = _getMGTText(cl);
                out.push('"' + _jsonEsc(t == null ? "" : t) + '"');
            }
        }
        return "[" + out.join(",") + "]";
    } catch (e) { return "[]"; }
}

/*
 * Seçili altyazı kliplerinin metnini YERİNDE değiştirir.
 * Klip silinip yeniden import EDİLMEZ — bu yüzden konum, süre ve elle yapılmış her ayar korunur.
 * (Panelde metni düzeltip yeniden yerleştirmek tüm zaman aralığını silip baştan basıyor ve
 *  timeline'da elle yapılan düzenlemeleri yok ediyordu.)
 */
/*
 * Metni DOSYADAN okuyup uygular. Metni evalScript'in string literaline gömmek Türkçe karakter,
 * tırnak ve ters bölü açısından kırılgan; altyazı yerleştirme de aynı sebeple dosya kullanıyor.
 */
function setSelectedSubTextFile(txtPath) {
    var t = "";
    try { t = _readFileUTF8(txtPath); } catch (e) { return "err:Metin dosyası okunamadı"; }
    t = String(t).replace(/[\r\n]+$/, "");
    if (!t) return "err:Metin boş";
    return setSelectedSubText(t);
}

function setSelectedSubText(newText) {
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Metin Düzelt"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        // ÖNCE seçili klipleri topla: _setTextAllWays içindeki setSelected çağrısı seçimi
        // değiştirdiği için, tararken değiştirmek sonraki klipleri kaçırır.
        var hedef = [];
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            for (var i = 0; i < tr.clips.numItems; i++) {
                var cl = tr.clips[i];
                var sel = false; try { sel = cl.isSelected(); } catch (e) {}
                if (!sel) continue;
                var mc = null; try { mc = cl.getMGTComponent(); } catch (e2) {}
                if (mc) hedef.push(cl);
            }
        }
        if (!hedef.length) return "err:Seçili altyazı klibi yok";
        var degisen = 0, atlanan = 0;
        for (var h = 0; h < hedef.length; h++) {
            var yol = _setTextAllWays(hedef[h], newText);
            if (yol && yol !== "notfound") degisen++; else atlanan++;
        }
        // Hiçbiri değişmediyse BAŞARI dönme — panel yeşil tik gösterip kullanıcıyı yanıltıyordu.
        if (!degisen) return "err:Yazı alanı bulunamadı (" + atlanan + " klip). Bu MOGRT'de metin katmanı farklı olabilir.";
        return "ok:" + degisen + " altyazının yazısı değişti" + (atlanan ? (", " + atlanan + " atlandı") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/*
 * (ARTIK KULLANILMIYOR — importMGT komşu klipleri ezdiği için panel-taraflı temiz
 *  yeniden yerleştirmeye geçildi. Referans için bırakıldı.)
 * Timeline'da SEÇİLİ altyazı (MOGRT) kliplerini verilen stille (renkle) değiştirir.
 * Aynı zaman + aynı metin korunur; klip silinip yeni stil aynı yere konur.
 * Yanlış renk/konuşmacı atanan altyazıları yerleştirdikten SONRA düzeltmek için.
 */
function recolorSelected(mogrtPath) {
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Renk Değiştir"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var mf = new File(mogrtPath);
        if (!mf.exists) return "err:Stil dosyası yok: " + mogrtPath;
        var TICKS = 254016000000;
        // PASS 1: SADECE seçili MOGRT kliplerinin bilgisini DEĞER olarak topla (referans TUTMA —
        // timeline değişince eski TrackItem referansı kayıp YANLIŞ klibi siliyordu, bug buydu).
        var jobs = [];
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            for (var i = 0; i < tr.clips.numItems; i++) {
                var cl = tr.clips[i];
                var sel = false; try { sel = cl.isSelected(); } catch (es) {}
                if (!sel) continue;
                var mc = null; try { mc = cl.getMGTComponent(); } catch (em) {}
                if (!mc) continue; // MOGRT değil (video/ses/gameplay) -> ASLA dokunma
                var txt = _getMGTText(cl);
                jobs.push({ startTicks: "" + cl.start.ticks, endSec: parseFloat(cl.end.ticks) / TICKS, text: (txt != null ? txt : ""), vIdx: v });
            }
        }
        if (!jobs.length) return "err:Timeline'da altyazı klibi seçili değil (klibe tıkla, sonra bas)";
        // PASS 2: SADECE seçili MOGRT klipleri kaldır — TERS iterasyon (indeks kaymaz), ripple YOK
        // (false = gap bırak, sonraki klipleri kaydırma/silme). Sadece seçili+MOGRT olanlara dokunur.
        for (var v2 = 0; v2 < seq.videoTracks.numTracks; v2++) {
            var tr2 = seq.videoTracks[v2];
            for (var k = tr2.clips.numItems - 1; k >= 0; k--) {
                var c2 = tr2.clips[k];
                var s2 = false; try { s2 = c2.isSelected(); } catch (e) {}
                if (!s2) continue;
                var m2 = null; try { m2 = c2.getMGTComponent(); } catch (e) {}
                if (!m2) continue;
                try { c2.remove(false, false); } catch (er) {}
            }
        }
        // PASS 3: yeni stili aynı zamana/track'e koy, metni ve süreyi geri yaz.
        var done = 0, failed = 0, firstErr = "";
        for (var j = 0; j < jobs.length; j++) {
            var job = jobs[j];
            var ni = null;
            try { ni = seq.importMGT(mogrtPath, job.startTicks, job.vIdx, -1); }
            catch (e2) { failed++; if (!firstErr) firstErr = "importMGT: " + e2.toString(); continue; }
            if (!ni) ni = _findClipNear(seq.videoTracks[job.vIdx], parseFloat(job.startTicks) / TICKS, TICKS);
            if (!ni) { failed++; continue; }
            if (job.text) _setTextAllWays(ni, job.text);
            _setEndSec(ni, job.endSec, TICKS);
            done++;
        }
        return "ok:" + done + " altyazının rengi değişti" + (failed ? (", " + failed + " hata") : "") + (firstErr ? (" | " + firstErr) : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/*
 * Her altyazı satırını MOGRT stiliyle timeline'a koyar (importMGT ile).
 * İlk klipte MOGRT'nin tüm iç yapısını dosyaya döker (teşhis).
 */
function addStyledSubtitles(cuesFilePath, mogrtPath, vTrackIndex) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var mf = new File(mogrtPath);
        if (!mf.exists) return "err:MOGRT yok: " + mogrtPath;

        var raw = _readFileUTF8(cuesFilePath);
        var lines = raw.split(/\r?\n/);
        var cues = [];
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 3) continue;
            var s = parseFloat(p[0]), e = parseFloat(p[1]);
            if (isNaN(s)) continue;
            cues.push({ s: s, e: e, t: p.slice(2).join("|") });
        }
        if (!cues.length) return "err:cue yok";

        var TICKS = 254016000000;
        var vIdx = vTrackIndex;
        if (vIdx === undefined || vIdx === null || vIdx < 0) vIdx = seq.videoTracks.numTracks - 1;

        // 1) ÖNCE TEK KLİPLE DOĞRULA: metin ayarlanabiliyor mu?
        var t0 = null;
        try { t0 = seq.importMGT(mogrtPath, String(Math.round(cues[0].s * TICKS)), vIdx, -1); }
        catch (e) { return "err:importMGT: " + e.toString(); }
        if (!t0) return "err:importMGT null";
        try {
            var diagDir = new File(cuesFilePath).parent;
            _writeFileUTF8(diagDir.fsName + "/mogrt_props.txt", _dumpTrackItem(t0));
        } catch (ed) {}
        var setInfo = _setTextAllWays(t0, cues[0].t);
        var ok0 = (setInfo.indexOf("mgt:") === 0 || setInfo.indexOf("comp") === 0);
        if (!ok0) {
            try { t0.remove(false, false); } catch (er0) {}
            return "err:Bu MOGRT'de DUZENLENEBILIR METIN YOK (setText=" + setInfo +
                   "). Yaziyi duzenlenebilir alan olacak sekilde yeniden export etmen gerek.";
        }

        // 2) Doğrulandı → hedef kanalı temizle, hepsini yerleştir
        try {
            var vt0 = seq.videoTracks[vIdx];
            for (var k = vt0.clips.numItems - 1; k >= 0; k--) {
                try { vt0.clips[k].remove(false, false); } catch (er) {}
            }
        } catch (ec) {}

        var placed = 0, failed = 0;
        for (var c = 0; c < cues.length; c++) {
            var ti = null;
            try { ti = seq.importMGT(mogrtPath, String(Math.round(cues[c].s * TICKS)), vIdx, -1); }
            catch (e2) { failed++; continue; }
            if (!ti) { failed++; continue; }
            _setTextAllWays(ti, cues[c].t);
            _setEndSec(ti, cues[c].e, TICKS);
            placed++;
        }

        return "ok:" + placed + " eklendi" + (failed ? (", " + failed + " hata") : "") + " | metin: " + setInfo;
    } catch (e) {
        return "err:" + e.toString();
    }
}

/*
 * Seçili yazı grafiğini şablon alıp her altyazı satırı için çoğaltır (MOGRT'siz).
 * Kullanıcı orijinal "Tofi Text Deneme" grafiğine tıklar (seçer), sonra bu çalışır.
 */
function addStyledFromSelected(cuesFilePath, vTrackIndex) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";

        // seçili klibi bul
        var tmpl = null;
        try {
            if (typeof seq.getSelection === "function") {
                var sa = seq.getSelection();
                if (sa && sa.length) tmpl = sa[0];
            }
        } catch (e) {}
        if (!tmpl) {
            for (var v = seq.videoTracks.numTracks - 1; v >= 0 && !tmpl; v--) {
                var tr = seq.videoTracks[v];
                for (var i = 0; i < tr.clips.numItems; i++) {
                    var s = false;
                    try { s = tr.clips[i].isSelected(); } catch (e2) {}
                    if (s) { tmpl = tr.clips[i]; break; }
                }
            }
        }
        if (!tmpl) return "err:Once 'Tofi Text Deneme' yazina TIKLA (sec), sonra bas";

        // teşhis: seçili klibin yapısını dök
        var projItem = null;
        try { projItem = tmpl.projectItem; } catch (e) {}
        try {
            var diagDir = new File(cuesFilePath).parent;
            _writeFileUTF8(diagDir.fsName + "/selected_props.txt",
                "SECILI KLIP:\n" + _dumpTrackItem(tmpl) +
                "\nprojItem: " + (projItem ? (projItem.name || "var") : "null"));
        } catch (ed) {}

        if (!projItem) return "err:Grafik cogaltilamiyor (projectItem yok) | selected_props yazildi";

        // cue oku
        var raw = _readFileUTF8(cuesFilePath);
        var lines = raw.split(/\r?\n/);
        var cues = [];
        for (var k = 0; k < lines.length; k++) {
            var ln = lines[k]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 3) continue;
            var ss = parseFloat(p[0]), ee = parseFloat(p[1]);
            if (isNaN(ss)) continue;
            cues.push({ s: ss, e: ee, t: p.slice(2).join("|") });
        }
        if (!cues.length) return "err:cue yok";

        var TICKS = 254016000000;
        var vIdx = (vTrackIndex === undefined || vTrackIndex === null || vTrackIndex < 0)
                     ? seq.videoTracks.numTracks - 1 : vTrackIndex;
        var vTrack = seq.videoTracks[vIdx];

        // hedef kanalı temizle
        try { for (var q = vTrack.clips.numItems - 1; q >= 0; q--) { try { vTrack.clips[q].remove(false, false); } catch (er) {} } } catch (ec) {}

        var placed = 0, failed = 0, setInfo = "";
        for (var c = 0; c < cues.length; c++) {
            var okc = false;
            try { okc = vTrack.overwriteClip(projItem, cues[c].s); }
            catch (eo) { if (!setInfo) setInfo = "overwrite:" + eo.toString(); }
            var ti = okc ? _findClipNear(vTrack, cues[c].s, TICKS) : null;
            if (!ti) { failed++; continue; }
            var r = _setTextAllWays(ti, cues[c].t);
            if (c === 0) setInfo = "text:" + r;
            _setEndSec(ti, cues[c].e, TICKS);
            placed++;
        }
        return "ok:" + placed + " eklendi, " + failed + " hata | " + setInfo;
    } catch (e) {
        return "err:" + e.toString();
    }
}

/*
 * Çoklu-stil yerleştirme: her cue satırı "startSec|endSec|mogrtPath|metin".
 * Farklı konuşmacılar farklı MOGRT ile timeline'a gelir.
 */
/* TEMIZLIK BEYAZ LISTESI — hedef video kanalinda hangi kliplerin "bizim altyazimiz" sayilip
   silinebilecegini belirler. Iki kaynak:
     1) cue dosyasinin basindaki "#STILLER|Ad1|Ad2|..." satiri — panelin TANIDIGI butun stil
        adlari. Kullanici stili degistirip yeniden basarsa eski kliplerin adi farklidir;
        yalnizca bu calistirmadaki stile bakarsak onlar silinmez ve ekranda CIFT altyazi olur.
     2) bu calistirmada kullanilan MOGRT dosya adlari (baslik satiri gelmese de calissin diye).
   Listede OLMAYAN hicbir klibe dokunulmaz — kullanicinin kendi grafikleri ve goruntusu guvende. */
function _stilBeyazListe(lines, cues) {
    /* Anahtarlar "#" onekiyle tutulur. Duz nesnede "constructor"/"toString"/"valueOf" gibi
       adlar Object.prototype uzerinden HER ZAMAN dogru donerdi; adi tam olarak boyle olan
       bir klip beyaz listede sayilip SILINIRDI. Onek bu tuzagi tamamen kapatir. */
    var ad = {}, i, j, p, b;
    for (i = 0; i < lines.length; i++) {
        if (!lines[i] || lines[i].slice(0, 9) !== "#STILLER|") continue;
        p = lines[i].slice(9).split("|");
        for (j = 0; j < p.length; j++) {
            b = String(p[j]).replace(/^\s+|\s+$/g, "").replace(/\.[^.]+$/, "");
            if (b) ad["#" + b.toLowerCase()] = true;
        }
    }
    for (i = 0; i < cues.length; i++) {
        b = String(cues[i].mg).replace(/\\/g, "/");
        b = b.slice(b.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
        if (b) ad["#" + b.toLowerCase()] = true;
    }
    return ad;
}

// Beyaz liste sorgusu — anahtar oneki tek yerde bilinsin.
function _bizimAltyazimizMi(liste, klipAdi) {
    var n = String(klipAdi == null ? "" : klipAdi).replace(/\.[^.]+$/, "").toLowerCase();
    return n ? (liste["#" + n] === true) : false;
}

function addMultiStyleSubtitles(cuesFilePath, vTrackIndex) {
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Altyazı"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var raw = _readFileUTF8(cuesFilePath);
        var lines = raw.split(/\r?\n/);
        var cues = [];
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 4) continue;
            var s = parseFloat(p[0]), e = parseFloat(p[1]), mg = p[2], txt = p.slice(3).join("|");
            if (isNaN(s) || !mg) continue;
            cues.push({ s: s, e: e, mg: mg, t: txt });
        }
        if (!cues.length) return "err:cue yok";

        var TICKS = 254016000000;
        // vTrackIndex: -1 = en üst kanal, -2 = bir altı, 0+ = doğrudan indeks
        var vIdx;
        if (vTrackIndex === undefined || vTrackIndex === null) vIdx = seq.videoTracks.numTracks - 1;
        else if (vTrackIndex < 0) vIdx = seq.videoTracks.numTracks + vTrackIndex;
        else vIdx = vTrackIndex;
        /* vIdx 0 = en alttaki video kanali = kullanicinin GORUNTUSU. Oraya altyazi basmak
           hem goruntuyu ezer hem de asagidaki temizlik onu siler. 0'a kelepceleme, DUR. */
        if (vIdx < 1) return "err:Altyazı için boş bir video kanalı gerekiyor. Premiere'de " +
                             "görüntünün üstüne bir video kanalı ekleyip tekrar dene.";

        // SADECE basılacak zaman aralığındaki klipleri temizle — parça parça (süre aralığı)
        // yerleştirmede önceki bölümleri silmesin. Aralık = ilk cue başı .. son cue sonu.
        var spanS = cues[0].s, spanE = cues[0].e;
        for (var si = 1; si < cues.length; si++) { if (cues[si].s < spanS) spanS = cues[si].s; if (cues[si].e > spanE) spanE = cues[si].e; }
        /* Yalnizca KENDI altyazilarimizi sil (bu calistirmadaki MOGRT adlari). Eskiden
           aralikta kalan her klip siliniyordu; hedef kanalda kullanicinin bir goruntusu
           varsa o da gidiyordu. */
        var mgAd0 = _stilBeyazListe(lines, cues);
        var korunan0 = 0;
        try {
            var vt0 = seq.videoTracks[vIdx];
            for (var k = vt0.clips.numItems - 1; k >= 0; k--) {
                try {
                    var cl0 = vt0.clips[k], cs0 = cl0.start.seconds, ce0 = cl0.end.seconds;
                    if (!(ce0 > spanS + 0.05 && cs0 < spanE - 0.05)) continue;
                    var nm0 = "";
                    try { nm0 = String(cl0.name); } catch (en0) { nm0 = ""; }
                    if (!_bizimAltyazimizMi(mgAd0, nm0)) { korunan0++; continue; }   // bizim altyazimiz degil
                    cl0.remove(false, false);
                } catch (er) {}
            }
        } catch (ec) {}

        /* SHORTS: cue dosyasinin basindaki "#SHORTS|<yNorm>|<olcek>" satiri. Panel dikey
           sekans icin altyazinin yuksekligini ve olcegini buradan bildirir. Satir yoksa
           (normal yatay video) konuma HIC dokunulmaz — eski davranis aynen surer. */
        var shortsY = -1, shortsOlcek = 0;
        for (var sh = 0; sh < lines.length; sh++) {
            if (!lines[sh] || lines[sh].slice(0, 8) !== "#SHORTS|") continue;
            var sp = lines[sh].slice(8).split("|");
            shortsY = parseFloat(sp[0]);
            shortsOlcek = parseFloat(sp[1]) || 0;
            if (isNaN(shortsY) || shortsY < 0 || shortsY > 1) shortsY = -1;   // bozuk deger: dokunma
            break;
        }

        var placed = 0, failed = 0, firstErr = "", yerlesen = 0;
        for (var c = 0; c < cues.length; c++) {
            var mf = new File(cues[c].mg);
            if (!mf.exists) { failed++; if (!firstErr) firstErr = "MOGRT yok: " + cues[c].mg; continue; }
            var ti = null;
            try { ti = seq.importMGT(cues[c].mg, String(Math.round(cues[c].s * TICKS)), vIdx, -1); }
            catch (e2) { failed++; if (!firstErr) firstErr = "importMGT: " + e2.toString(); continue; }
            if (!ti) { failed++; continue; }
            _setTextAllWays(ti, cues[c].t);
            _setEndSec(ti, cues[c].e, TICKS);
            if (shortsY >= 0) { if (_dikeyYerlestir(ti, shortsY, shortsOlcek)) yerlesen++; }
            placed++;
        }
        if (!placed) return "err:Hiçbir altyazı eklenemedi" + (firstErr ? (" | " + firstErr) : "");
        var shortsNot = "";
        if (shortsY >= 0) {
            shortsNot = yerlesen ? (", " + yerlesen + " dikey konumlandı")
                                 : ", DİKEY KONUMLANDIRILAMADI (MOGRT'de Konum özelliği bulunamadı)";
        }
        return "ok:" + placed + " eklendi" + shortsNot + (korunan0 ? (", " + korunan0 + " klibe dokunulmadı") : "") + (failed ? (", " + failed + " hata") : "") + (firstErr ? (" | " + firstErr) : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/* Sekansin gercek kare yuksekligini okur (1080 varsayilan). Iki farkli API denenir; ikisi de
   yoksa 1080'e duser (eski davranis). */
function _seqHeight(seq) {
    var h = 0;
    try { h = parseInt(seq.frameSizeVertical, 10); } catch (e1) { h = 0; }
    if (!h || isNaN(h) || h < 16) {
        try { h = parseInt(seq.getSettings().videoFrameHeight, 10); } catch (e2) { h = 0; }
    }
    if (!h || isNaN(h) || h < 16) h = 1080;
    return h;
}

// Klibi ekranda yukarı kaydırır (üst üste konuşmada istifleme). Başarılıysa true döner.
// Position özelliğini önce Motion/Vector Motion'da, bulamazsa herhangi bir bileşende arar (S8).
// seqH: sekansin kare yuksekligi. MOGRT'lerde Position NORMALIZE (0-1) geldigi icin pikseli
// bolerken gercek yukseklik sart: 1080 sabiti 4K'da kaymayi iki katina, 720p'de yariya
// dusuruyordu (altyazilar ya karenin ortasina firliyor ya da ic ice giriyordu).
/* Klibin efekt ozelliklerinden birini bulur (Position, Scale...).
   1. tur: adi Motion/Vector Motion olan bilesen; 2. tur: eslesmeyi tasiyan HERHANGI bilesen.
   (Once _shiftUp'in icindeydi; Shorts yerlesimi de ayni aramaya ihtiyac duydugu icin ayrildi.) */
function _bulOzellik(ti, desen) {
    try {
        for (var pass = 0; pass < 2; pass++) {
            for (var j = 0; j < ti.components.numItems; j++) {
                var comp = ti.components[j];
                var cn = "" + (comp.displayName || "");
                if (pass === 0 && !/motion/i.test(cn)) continue;
                try {
                    for (var k = 0; k < comp.properties.numItems; k++) {
                        if (desen.test("" + (comp.properties[k].displayName || ""))) return comp.properties[k];
                    }
                } catch (ep) {}
            }
        }
    } catch (e) {}
    return null;
}

/* SHORTS (dikey 1080x1920) yerlesimi.
   MOGRT'ler 1920x1080 icin tasarlandi; dikey sekansta kendi konumlarinda kalirlarsa
   yanlis yerde (ve tasarim genisligi kare genisliginden buyuk oldugu icin tasmis)
   duruyorlar. Burada altyazinin DIKEY konumu ve olcegi acikca ayarlanir.
     yNorm : 0 = karenin en ustu, 1 = en alti (Premiere Position normalize calisir)
     olcek : yuzde; 0 verilirse olcege HIC dokunulmaz
   X'e dokunulmaz — yatayda ortalama MOGRT'nin kendi tasariminda. */
function _dikeyYerlestir(ti, yNorm, olcek) {
    var oldu = false;
    var posProp = _bulOzellik(ti, /position/i);
    if (posProp) {
        try {
            var pos = posProp.getValue();
            if (pos && pos.length >= 2) {
                /* Premiere bu ozelligi normalize (0-1) tutar. Piksel donen bir yapida
                   normalize deger yazmak altyaziyi sol ust koseye atardi — o durumda
                   dokunmuyoruz, kullanici MOGRT'yi elle konumlandirir. */
                var normMi = (Math.abs(pos[0]) <= 2 && Math.abs(pos[1]) <= 2);
                if (normMi) { posProp.setValue([pos[0], yNorm], true); oldu = true; }
            }
        } catch (e1) {}
    }
    if (olcek > 0) {
        // "Scale Width"/"Scale Height" degil, tek ve uniform olani tercih et.
        var scProp = _bulOzellik(ti, /^\s*scale\s*$/i);
        if (!scProp) scProp = _bulOzellik(ti, /scale/i);
        if (scProp) { try { scProp.setValue(olcek, true); oldu = true; } catch (e2) {} }
    }
    return oldu;
}

function _shiftUp(ti, offsetPx, seqH) {
    if (!offsetPx || offsetPx <= 0) return false;
    seqH = parseInt(seqH, 10);
    if (!seqH || isNaN(seqH) || seqH < 16) seqH = 1080;   // parametre gelmezse eski davranis
    try {
        var posProp = _bulOzellik(ti, /position/i);
        if (!posProp) return false;
        var pos = posProp.getValue();
        if (!pos || pos.length < 2) return false;
        var x = pos[0], y = pos[1];
        // normalize (0-1) mi yoksa piksel mi: küçük değerler normalize kabul edilir
        var norm = (Math.abs(x) <= 2 && Math.abs(y) <= 2);
        var dy = norm ? (offsetPx / (seqH * 1.0)) : offsetPx;
        posProp.setValue([x, y - dy], true);
        return true;
    } catch (e) { return false; }
}

/*
 * İstifli yerleştirme: her cue "start|end|mogrt|lane|metin".
 * lane 0 = en üst kanal (taban konum), lane 1 = bir alt kanal + ekranda yukarı, ...
 * Böylece üst üste konuşmalar çakışmaz ve renkleriyle üst üste dizilir.
 */
function addLanedSubtitles(cuesFilePath, yOffsetPx) {
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Altyazı"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        yOffsetPx = parseFloat(yOffsetPx); if (isNaN(yOffsetPx)) yOffsetPx = 130; // 0 = kayma yok (|| 130 hatasi duzeltildi)
        var raw = _readFileUTF8(cuesFilePath);
        var lines = raw.split(/\r?\n/);
        var cues = [], maxLane = 0;
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 6) continue;
            var s = parseFloat(p[0]), e = parseFloat(p[1]), mg = p[2], lane = parseInt(p[3], 10) || 0, shift = parseFloat(p[4]) || 0, txt = p.slice(5).join("|");
            if (isNaN(s) || !mg) continue;
            if (lane > maxLane) maxLane = lane;
            cues.push({ s: s, e: e, mg: mg, lane: lane, shift: shift, t: txt });
        }
        if (!cues.length) return "err:cue yok";

        var TICKS = 254016000000;
        var top = seq.videoTracks.numTracks - 1;
        var seqH = _seqHeight(seq);   // istifleme kaymasi bu yukseklige gore normalize edilir
        // SADECE basılacak zaman aralığındaki klipleri temizle (parça parça yerleştirme korunur)
        var spanS = cues[0].s, spanE = cues[0].e;
        for (var s8 = 1; s8 < cues.length; s8++) { if (cues[s8].s < spanS) spanS = cues[s8].s; if (cues[s8].e > spanE) spanE = cues[s8].e; }
        /* TEMIZLIK YALNIZ KENDI ALTYAZILARIMIZA: eskiden bu dongu zaman araligindaki HER
           klibi siliyordu. Lane hesabi kullanicinin goruntu kanalina denk geldiginde
           (az video kanali varsa oluyor) 30 dakikalik oyun goruntusu siliniyordu.
           Artik sadece bu calistirmada kullanilan MOGRT adlarina sahip klipler silinir. */
        var mgAdlari = _stilBeyazListe(lines, cues);
        var korunanKlip = 0;
        for (var L = 0; L <= maxLane; L++) {
            var idx = top - L;
            /* idx 0 = en alttaki video kanali = kullanicinin GORUNTUSU. Oraya asla dokunma.
               Panel tarafi zaten yeterli kanal yoksa yerlestirmeyi durduruyor; bu son savunma. */
            if (idx < 1) continue;
            try {
                var vt = seq.videoTracks[idx];
                for (var k = vt.clips.numItems - 1; k >= 0; k--) {
                    try {
                        var clx = vt.clips[k], csx = clx.start.seconds, cex = clx.end.seconds;
                        if (!(cex > spanS + 0.05 && csx < spanE - 0.05)) continue;
                        var nmx = "";
                        try { nmx = String(clx.name); } catch (enx) { nmx = ""; }
                        if (!_bizimAltyazimizMi(mgAdlari, nmx)) { korunanKlip++; continue; }   // bizim altyazimiz degil
                        clx.remove(false, false);
                    } catch (er) {}
                }
            } catch (ec) {}
        }

        var placed = 0, failed = 0, firstErr = "", needShift = 0, shifted = 0;
        for (var c = 0; c < cues.length; c++) {
            /* idx2'yi 0'a KELEPCELEME: 0 = kullanicinin goruntu kanali ve importMGT oraya
               altyazi koyunca goruntuyu ezer. Yeterli kanal yoksa o altyaziyi ATLA. */
            var idx2 = top - cues[c].lane;
            if (idx2 < 1) { failed++; if (!firstErr) firstErr = "yeterli video kanalı yok (en az " + (cues[c].lane + 2) + " gerekiyor)"; continue; }
            var mf = new File(cues[c].mg);
            if (!mf.exists) { failed++; if (!firstErr) firstErr = "MOGRT yok: " + cues[c].mg; continue; }
            var ti = null;
            try { ti = seq.importMGT(cues[c].mg, String(Math.round(cues[c].s * TICKS)), idx2, -1); }
            catch (e2) { failed++; if (!firstErr) firstErr = "importMGT: " + e2.toString(); continue; }
            if (!ti) { failed++; continue; }
            _setTextAllWays(ti, cues[c].t);
            _setEndSec(ti, cues[c].e, TICKS);
            if (cues[c].shift > 0) { needShift++; if (_shiftUp(ti, cues[c].shift, seqH)) shifted++; }
            placed++;
        }
        if (!placed) return "err:Hiçbir altyazı eklenemedi" + (firstErr ? (" | " + firstErr) : "");
        return "ok:" + placed + " eklendi" + (needShift ? (", " + shifted + "/" + needShift + " kaydırıldı") : "") + (korunanKlip ? (", " + korunanKlip + " klibe dokunulmadı") : "") + (failed ? (", " + failed + " hata") : "") + (firstErr ? (" | " + firstErr) : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/*
 * AutoCut: verilen sessiz aralıkları timeline'dan ripple-delete eder (boşluğu kapatır).
 * intervals dosyası: her satır "startSec|endSec".
 * SONDAN BAŞA doğru işlenir ki önceki zamanlar kaymasın.
 */
function _seqDuration(seq) {
    var maxEnd = 0;
    try { for (var v = 0; v < seq.videoTracks.numTracks; v++) { var t = seq.videoTracks[v]; if (t.clips.numItems > 0) { var e = t.clips[t.clips.numItems - 1].end.seconds; if (e > maxEnd) maxEnd = e; } } } catch (er) {}
    try { for (var a = 0; a < seq.audioTracks.numTracks; a++) { var t2 = seq.audioTracks[a]; if (t2.clips.numItems > 0) { var e2 = t2.clips[t2.clips.numItems - 1].end.seconds; if (e2 > maxEnd) maxEnd = e2; } } } catch (er2) {}
    return maxEnd;
}

function _p2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

// Drop-frame timecode (29.97 / 59.94). frame = gerçek kare sayısı, nominal = 30 veya 60.
function _dfTimecode(frame, nominal) {
    var dropPerMin = (nominal >= 59) ? 4 : 2;
    var framesPer10Min = nominal * 600 - dropPerMin * 9;   // 29.97 -> 17982
    var framesPerMin = nominal * 60 - dropPerMin;          // 29.97 -> 1798
    var d = Math.floor(frame / framesPer10Min);
    var mo = frame % framesPer10Min;
    if (mo >= dropPerMin) frame += dropPerMin * 9 * d + dropPerMin * Math.floor((mo - dropPerMin) / framesPerMin);
    else frame += dropPerMin * 9 * d;
    var ff = frame % nominal, rest = Math.floor(frame / nominal);
    var ss = rest % 60, mm = Math.floor(rest / 60) % 60, hh = Math.floor(rest / 3600) % 24;
    return _p2(hh) + ":" + _p2(mm) + ":" + _p2(ss) + ";" + _p2(ff);  // ';' = drop-frame
}

// saniye -> timecode. fpsFrac = GERÇEK (kesirli) fps; 29.97/59.94'te drop-frame üretir.
// Yuvarlanmış tam-sayı fps ile üretmek qe.razor'da zamanla artan kayma yapıyordu (H5).
function _secToTC(sec, fpsFrac) {
    if (!fpsFrac || fpsFrac < 1) fpsFrac = 30;
    var nominal = Math.round(fpsFrac);
    var frame = Math.round(sec * fpsFrac);                 // gerçek kare sayısı
    // tolerans 0.02: 29.97'yi yakalar ama gerçek 30.0'ı (fark 0.03) drop-frame sanmaz
    var isDF = (Math.abs(fpsFrac - 29.97) < 0.02) || (Math.abs(fpsFrac - 59.94) < 0.02);
    if (isDF) return _dfTimecode(frame, nominal);
    var ff = frame % nominal, rest = Math.floor(frame / nominal);
    var ss = rest % 60, mm = Math.floor(rest / 60) % 60, hh = Math.floor(rest / 3600);
    return _p2(hh) + ":" + _p2(mm) + ":" + _p2(ss) + ":" + _p2(ff);
}

/* Bir kanalda [s,e] aralığındaki (ortadaki) klipleri ripple-siler. Silinen klip sayısını döndürür (H4).
   PERFORMANS — bu fonksiyon AutoCut'ın asıl darboğazıydı:
   Kesimler SONDAN BAŞA yapıldığı için (bkz. autoCut'taki ivs.sort) silinecek klip HER ZAMAN
   listenin BAŞINDA oluyor; eski sürüm ise listeyi SONDAN tarıyor ve erken çıkışı yoktu.
   Her kesim kanala net +1 klip eklediğinden tarama uzunluğu kesim sayısıyla birlikte büyüyor:
   1137 boşlukta kanal başına ~649.000 klip ziyareti (5 kanalda ~3,2 milyon, her ziyaret birkaç
   Premiere çağrısı). Ölçülen sonuç: kesim hiç bitmiyordu.
   Artık BAŞTAN taranıyor ve aralığın ötesine geçildiğinde çıkılıyor — kesim başına ~4 ziyaret. */
function _ripTrack(tr, s, e, eps) {
    var cls = tr.clips, n = 0;
    try { n = cls.numItems; } catch (eN) { return 0; }
    if (!n) return 0;                                   // boş kanal: hiç dokunma
    var hit = [], kirildi = false, i, cl, cs, ce;
    for (i = 0; i < n; i++) {
        cl = cls[i];
        try { cs = cl.start.seconds; ce = cl.end.seconds; } catch (er) { continue; }
        if (cs >= s - eps && ce <= e + eps) hit.push(i);
        else if (cs > e + eps) { kirildi = true; break; }   // klipler zaman sıralı: sonrası hep daha geç
    }
    /* Güvenlik ağı: erken çıktık ama HİÇBİR şey bulamadıysak koleksiyon beklendiği gibi sıralı
       olmayabilir. Sessizce eksik silme yapmaktansa (kullanıcı fark etmez, boşluk kesilmemiş olur)
       tam taramaya dön. */
    if (kirildi && !hit.length) {
        for (i = 0; i < n; i++) {
            cl = cls[i];
            try { cs = cl.start.seconds; ce = cl.end.seconds; } catch (er2) { continue; }
            if (cs >= s - eps && ce <= e + eps) hit.push(i);
        }
    }
    // BÜYÜK indeksten küçüğe sil — silme sonrası indeksler kaymasın (eski davranışla birebir aynı).
    var removed = 0;
    for (i = hit.length - 1; i >= 0; i--) {
        try { cls[hit[i]].remove(true, false); removed++; } catch (er3) {}
    }
    return removed;
}
/* eps'i fps'e bağla (H9): 0.75/fps hem razor kare-yuvarlamasını kapsar hem komşu klibi korur.
   doluV/doluA verilirse yalnızca DOLU kanallar taranır (boş kanalda yapacak iş yok). */
function _rippleDeleteRange(seq, s, e, fps, doluV, doluA) {
    var eps = (fps && fps > 0) ? (0.75 / fps) : 0.04, i, removed = 0;
    if (doluV && doluA) {
        for (i = 0; i < doluV.length; i++) removed += _ripTrack(seq.videoTracks[doluV[i]], s, e, eps);
        for (i = 0; i < doluA.length; i++) removed += _ripTrack(seq.audioTracks[doluA[i]], s, e, eps);
        return removed;
    }
    for (i = 0; i < seq.videoTracks.numTracks; i++) removed += _ripTrack(seq.videoTracks[i], s, e, eps);
    for (i = 0; i < seq.audioTracks.numTracks; i++) removed += _ripTrack(seq.audioTracks[i], s, e, eps);
    return removed;
}
/* Kanal kilitli mi? Sürümlere göre isLocked bazen metot bazen alan olabiliyor.
   TANINMAYAN bir değer gelirse "kilitli değil" kabul edilir. Risk asimetrik: yanlış-negatifte
   yalnızca eski davranış sürer, yanlış-pozitifte AutoCut komple ölür — `!!tr.isLocked` ham
   hâliyle bir metot NESNESİ geldiğinde (bazı Adobe host nesnelerinde typeof "function"
   dönmez) her zaman true oluyor ve dolu her kanal "kilitli" sayılıp kesim hiç başlamıyordu. */
function _kanalKilitli(tr) {
    var v = null;
    try {
        if (typeof tr.isLocked === "function") v = tr.isLocked();
        else v = tr.isLocked;
    } catch (e) { return false; }
    if (v === true) return true;
    if (v === false || v === null || v === undefined) return false;
    if (typeof v === "number") return (v !== 0);
    if (typeof v === "string") { v = v.toLowerCase(); return (v === "true" || v === "1"); }
    return false;   // metot nesnesi / bilinmeyen tip: kilit yok say
}

// [s,e] aralığını tek bir klip tam kaplıyor mu? (kayıt sürekliliği kontrolü, H2/H3)
function _trackCovers(tr, s, e, eps) {
    for (var i = 0; i < tr.clips.numItems; i++) {
        var cl = tr.clips[i], cs, ce;
        try { cs = cl.start.seconds; ce = cl.end.seconds; } catch (er) { continue; }
        if (cs <= s + eps && ce >= e - eps) return true;
    }
    return false;
}

// TAM KESME: tüm kanalları razorla + ortadaki parçayı ripple-sil (bulunan tüm boşluklar).
function autoCut(intervalsFilePath) {
    /* Undo grubu artik finally ile kapatiliyor. Eskiden endUndoGroup yalnizca "mutlu yolda"
       cagriliyordu; arada bir hata olursa grup ACIK kaliyor ve kullanicinin bundan sonra
       Premiere'de elle yaptigi her duzenleme ayni gruba yaziliyordu — tek Ctrl+Z saatlerce
       suren isi geri aliyordu. */
    var _ug = false;
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return "err:QE sekansı alınamadı";
        // Kesirli fps'i koru (H5): TC üretimi bununla, eps için yuvarlanmış fps ile.
        var fpsFrac = 30; try { fpsFrac = 254016000000 / parseFloat(seq.timebase); } catch (ef) {}
        var fps = Math.round(fpsFrac);
        var seqDur = _seqDuration(seq);

        // Senkron riski uyarısı (H2/H3): V0 dışında dolu video kanalı (overlay/altyazı) varsa
        // per-track ripple desenkron üretebilir — kullanıcıya belirt.
        var overlay = 0;
        try { for (var vt = 1; vt < seq.videoTracks.numTracks; vt++) { if (seq.videoTracks[vt].clips.numItems > 0) overlay++; } } catch (eov) {}

        var diag = [];
        function pr(x) { diag.push(x); }
        pr("fps: " + fpsFrac.toFixed(4) + " | overlay kanal: " + overlay + " | Sekans süresi ÖNCE: " + seqDur.toFixed(2) + " sn");

        var raw = _readFileUTF8(intervalsFilePath);
        var lines = raw.split(/\r?\n/);
        var ivs = [], skipped = 0;
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            var p = ln.split("|"); if (p.length < 2) continue;
            var s = parseFloat(p[0]), e = parseFloat(p[1]);
            if (isNaN(s) || isNaN(e) || e <= s) continue;
            if (s < 0) { skipped++; continue; }
            if (e > seqDur) e = seqDur;                          // sondaki sessizliği sekans sonuna kelepçele (A7)
            if (e - s < 0.05) { skipped++; continue; }           // GÜVENLİK: geçersiz/çok kısa aralığı atla
            ivs.push({ s: s, e: e });
        }
        if (!ivs.length) return "err:Sekans içinde geçerli boşluk yok (sekans " + seqDur.toFixed(1) + " sn).";
        ivs.sort(function (a, b) { return b.s - a.s; }); // SONDAN BAŞA (zamanlar kaymasın)

        pr("Kesilecek boşluk: " + ivs.length);

        /* KILITLI KANAL DENETIMI: Premiere kilitli kanalda ne razor'a ne de remove'a izin
           veriyor; _ripTrack hatayi yutuyor. Diger kanallar ripple ile sola kayarken kilitli
           kanal yerinde kaliyor — 900 kesimde dakikalarca birikmis, geri donusu zor bir
           desenkron demek (kullanicinin A3 "oyun sesi" kanalini kilitlemesi cok olasi).
           Bu yuzden DOLU + KILITLI kanal varsa hic baslamiyoruz. isLocked() olmayan
           surumlerde cagri try icinde eleniyor ve eski davranis surer. */
        var kilitli = [];
        for (var lv = 0; lv < seq.videoTracks.numTracks; lv++) {
            try { if (seq.videoTracks[lv].clips.numItems > 0 && _kanalKilitli(seq.videoTracks[lv])) kilitli.push("V" + (lv + 1)); } catch (el1) {}
        }
        for (var la = 0; la < seq.audioTracks.numTracks; la++) {
            try { if (seq.audioTracks[la].clips.numItems > 0 && _kanalKilitli(seq.audioTracks[la])) kilitli.push("A" + (la + 1)); } catch (el2) {}
        }
        if (kilitli.length) {
            return "err:Şu kanallar kilitli: " + kilitli.join(", ") +
                   ". Kesim yapılırsa bu kanallar kaymaz, ses görüntüden kayar. " +
                   "Premiere'de kanalın kilit simgesine basıp kilidi aç, sonra tekrar dene.";
        }

        // Tek Ctrl+Z ile geri alınabilsin (destekleniyorsa)
        try { app.beginUndoGroup("Yusufwrl AutoCut"); _ug = true; } catch (eug) {}

        // A1 (audio track 0) sürekli kayıt referansıdır; bir aralığı tam kaplamıyorsa
        // (kayıtta gerçek boşluk) o kesimi atla — desenkron üretme (H2/H3).
        var refTrack = (seq.audioTracks.numTracks > 0) ? seq.audioTracks[0] : null;

        /* DOLU kanalları bir kez tespit et. Boş kanalı razorlamak da taramak da no-op;
           tipik sekansta razor çağrılarının önemli bir kısmı buradan gidiyordu.
           QE track nesneleri de döngü ÖNCESİNDE alınır (her kesimde getTrackAt çağırmak yerine). */
        var doluV = [], doluA = [], qeV = [], qeA = [], di;
        for (di = 0; di < seq.videoTracks.numTracks; di++) {
            try { if (seq.videoTracks[di].clips.numItems > 0) { doluV.push(di); qeV.push(qeSeq.getVideoTrackAt(di)); } } catch (edv) {}
        }
        for (di = 0; di < seq.audioTracks.numTracks; di++) {
            try { if (seq.audioTracks[di].clips.numItems > 0) { doluA.push(di); qeA.push(qeSeq.getAudioTrackAt(di)); } } catch (eda) {}
        }
        pr("Dolu kanal: " + doluV.length + " video + " + doluA.length + " ses (boş kanallar atlanıyor)");

        var t0 = 0; try { t0 = $.hiresTimer; } catch (et) {}
        var tRazor = 0, tRip = 0;
        var done = 0, failed = 0, noop = 0, skippedCover = 0, firstErr = "";
        for (var k = 0; k < ivs.length; k++) {
            var cs = ivs[k].s, ce = ivs[k].e;
            /* _trackCovers ve _secToTC de ic try'in ICINDE: disarida kaldiklarinda biri hata
               atarsa dongu tamamen kirilip disa firliyordu (bir kanal gecersiz kilindiginda
               oluyor). Artik o kesim "hata" sayilip digerlerine devam ediliyor. */
            try {
                if (refTrack && !_trackCovers(refTrack, cs, ce, 0.04)) { skippedCover++; continue; }
                var tcS = _secToTC(cs, fpsFrac), tcE = _secToTC(ce, fpsFrac);
                var m0 = 0; try { m0 = $.hiresTimer; } catch (em) {}
                for (var v = 0; v < qeV.length; v++) { qeV[v].razor(tcS); qeV[v].razor(tcE); }
                for (var a = 0; a < qeA.length; a++) { qeA[a].razor(tcS); qeA[a].razor(tcE); }
                try { tRazor += $.hiresTimer - m0; } catch (em2) {}
                var m1 = 0; try { m1 = $.hiresTimer; } catch (em3) {}
                var rem = _rippleDeleteRange(seq, cs, ce, fps, doluV, doluA);
                try { tRip += $.hiresTimer - m1; } catch (em4) {}
                if (rem > 0) done++; else noop++;              // hiçbir klip silinmediyse "done" sayma (H4)
            } catch (e1) { failed++; if (!firstErr) firstErr = e1.toString(); }
        }
        var durAfter = _seqDuration(seq);
        var tTop = 0; try { tTop = ($.hiresTimer - t0) / 1000000; } catch (et2) {}
        // Faz zamanlaması: bir dahaki yavaşlık şikâyetinde nerede takıldığı ÖLÇÜLEBİLİR olsun.
        pr("Süre: toplam " + tTop.toFixed(1) + " sn | razor " + (tRazor / 1000000).toFixed(1) +
           " sn | ripple-delete " + (tRip / 1000000).toFixed(1) + " sn");
        pr("Sekans süresi SONRA: " + durAfter.toFixed(2) + " sn | done=" + done + " noop=" + noop + " skipCover=" + skippedCover + " failed=" + failed + (firstErr ? " err=" + firstErr : ""));
        try { var dir = new File(intervalsFilePath).parent; _writeFileUTF8(dir.fsName + "/autocut_diag.txt", diag.join("\n")); } catch (ed) {}
        return "ok:" + done + " boşluk kesildi (" + seqDur.toFixed(1) + " → " + durAfter.toFixed(1) + " sn)"
            + (noop ? (", " + noop + " boş geçti") : "")
            + (skippedCover ? (", " + skippedCover + " atlandı (kayıt boşluğu)") : "")
            + (failed ? (", " + failed + " hata") : "")
            + (overlay ? (" | UYARI: " + overlay + " overlay video kanalı var — senkron için AutoCut'ı altyazıdan ÖNCE çalıştır") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

// Projeyi kaydet (kesim/altyazı öncesi güvenlik ağı).
function saveProject() {
    try {
        if (app.project.path) { app.project.save(); return "ok:proje kaydedildi"; }
        return "warn:proje henüz diske kaydedilmemiş (önce Farklı Kaydet)";
    } catch (e) { return "err:" + e.toString(); }
}

// Son kaydedilen sürüme dön = kaydetmeden kapat + diskteki sürümü yeniden aç.
// Kesimden önce otomatik kaydedildiği için bu, son işlemi (kesim/altyazı) geri alır.
function revertToSaved() {
    try {
        var pth = app.project.path;
        if (!pth) return "err:proje kaydedilmemiş — dönülecek sürüm yok";
        var pf = new File(pth);
        if (!pf.exists) return "err:kaydedilmiş proje dosyası bulunamadı";
        app.project.closeDocument(0, 0);   // kaydetmeden kapat (son işlem diske yazılmadıysa iptal olur)
        app.openDocument(pth);             // diskteki (işlem öncesi kaydedilmiş) sürümü aç
        return "ok:kaydedilen sürüme dönüldü";
    } catch (e) { return "err:" + e.toString() + " — proje diskte güvende, gerekirse elle aç"; }
}

// Projedeki en son eklenen öğenin adını döndürür (doğrulama için)
function lastProjectItemName() {
    try {
        var n = app.project.rootItem.children.numItems;
        if (n < 1) return "";
        return app.project.rootItem.children[n - 1].name;
    } catch (e) { return "error:" + e.toString(); }
}
