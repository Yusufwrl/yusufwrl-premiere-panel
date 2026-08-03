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
    return '{"sequenceName":"' + _jsonEsc(seq.name) + '","audioTracks":' + av +
           ',"videoTracks":' + vv + ',"durationSec":' + sure.toFixed(3) +
           ',"clipCounts":[' + dolu.join(",") + ']}';
}

// Bir ses kanalındaki TÜM klipleri siler (A2'yi boşaltmak için).
// ripple=false ŞART: true olsaydı sonraki klipler sola kayar ve tüm senkron bozulurdu.
function clearAudioTrack(trackIdx, korunacakAd) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var ix = parseInt(trackIdx, 10);
        if (isNaN(ix) || ix < 0 || ix >= seq.audioTracks.numTracks) return "err:A" + (ix + 1) + " kanalı yok";
        var koru = (korunacakAd == null) ? "" : String(korunacakAd).toLowerCase();
        var tr = seq.audioTracks[ix], silinen = 0, korunan = 0;
        for (var i = tr.clips.numItems - 1; i >= 0; i--) {
            /* korunacakAd verilmisse o ada sahip klip SILINMEZ. Bu olmadan, A2'ye az once
               yerlestirilen Craig klibi de siliniyordu (kullanici "eski karisik sesi temizle"
               derken yeni koyulani kaybediyordu). */
            if (koru) {
                var nm = "";
                try { nm = String(tr.clips[i].name).toLowerCase(); } catch (en) { nm = ""; }
                if (nm && nm.indexOf(koru) !== -1) { korunan++; continue; }
            }
            try { tr.clips[i].remove(false, false); silinen++; } catch (e1) {}
        }
        return "ok:" + silinen + " klip silindi (A" + (ix + 1) + ")" + (korunan ? (", " + korunan + " korundu") : "");
    } catch (e) { return "err:" + e.toString(); }
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

        // 1) Dosyaları kendi bin'ine al
        var root = app.project.rootItem, bin = null;
        try { bin = root.createBin("Craig Sesleri"); } catch (eb) { bin = null; }
        if (!bin) bin = root;
        try { app.project.importFiles(yollar, true, bin, false); }
        catch (ei) { return "err:Dosyalar projeye alınamadı: " + ei.toString(); }

        // 2) İçe alınan öğeleri medya yoluna göre eşle
        function _norm(s) { return String(s).replace(/\\/g, "/").toLowerCase(); }
        function _bul(yol) {
            var hedef = _norm(yol);
            for (var k = 0; k < bin.children.numItems; k++) {
                var ch = bin.children[k], mp = "";
                try { mp = ch.getMediaPath(); } catch (e) { mp = ""; }
                if (mp && _norm(mp) === hedef) return ch;
            }
            // yol eşleşmezse dosya adına düş
            var ad = _basename(yol).replace(/\.[^.]+$/, "").toLowerCase();
            for (var m = 0; m < bin.children.numItems; m++) {
                var c2 = bin.children[m], nm = "";
                try { nm = String(c2.name).replace(/\.[^.]+$/, "").toLowerCase(); } catch (e2) {}
                if (nm === ad) return c2;
            }
            return null;
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
        if (!konan) return "err:Hicbir ses yerlestirilemedi. " + (ilkHata || "sebep bilinmiyor");
        return "ok:" + konan + " ses yerleştirildi" + (hata ? (", " + hata + " hata | " + ilkHata) : "");
    } catch (e) {
        return "err:" + e.toString();
    }
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
        if (v.charAt(0) === "{") { try { var o = JSON.parse(v); if (o && typeof o.text === "string") return o.text; } catch (e) {} }
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
        if (vIdx < 0) vIdx = 0;

        // SADECE basılacak zaman aralığındaki klipleri temizle — parça parça (süre aralığı)
        // yerleştirmede önceki bölümleri silmesin. Aralık = ilk cue başı .. son cue sonu.
        var spanS = cues[0].s, spanE = cues[0].e;
        for (var si = 1; si < cues.length; si++) { if (cues[si].s < spanS) spanS = cues[si].s; if (cues[si].e > spanE) spanE = cues[si].e; }
        try {
            var vt0 = seq.videoTracks[vIdx];
            for (var k = vt0.clips.numItems - 1; k >= 0; k--) {
                try {
                    var cl0 = vt0.clips[k], cs0 = cl0.start.seconds, ce0 = cl0.end.seconds;
                    if (ce0 > spanS + 0.05 && cs0 < spanE - 0.05) cl0.remove(false, false);
                } catch (er) {}
            }
        } catch (ec) {}

        var placed = 0, failed = 0, firstErr = "";
        for (var c = 0; c < cues.length; c++) {
            var mf = new File(cues[c].mg);
            if (!mf.exists) { failed++; if (!firstErr) firstErr = "MOGRT yok: " + cues[c].mg; continue; }
            var ti = null;
            try { ti = seq.importMGT(cues[c].mg, String(Math.round(cues[c].s * TICKS)), vIdx, -1); }
            catch (e2) { failed++; if (!firstErr) firstErr = "importMGT: " + e2.toString(); continue; }
            if (!ti) { failed++; continue; }
            _setTextAllWays(ti, cues[c].t);
            _setEndSec(ti, cues[c].e, TICKS);
            placed++;
        }
        return "ok:" + placed + " eklendi" + (failed ? (", " + failed + " hata") : "") + (firstErr ? (" | " + firstErr) : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

// Klibi ekranda yukarı kaydırır (üst üste konuşmada istifleme). Başarılıysa true döner.
// Position özelliğini önce Motion/Vector Motion'da, bulamazsa herhangi bir bileşende arar (S8).
function _shiftUp(ti, offsetPx) {
    if (!offsetPx || offsetPx <= 0) return false;
    try {
        var posProp = null;
        // 1. tur: adı Motion/Vector Motion olan bileşen; 2. tur: Position'ı olan herhangi bileşen
        for (var pass = 0; pass < 2 && !posProp; pass++) {
            for (var j = 0; j < ti.components.numItems; j++) {
                var comp = ti.components[j];
                var cn = "" + (comp.displayName || "");
                if (pass === 0 && !/motion/i.test(cn)) continue;
                try {
                    for (var k = 0; k < comp.properties.numItems; k++) {
                        if (/position/i.test("" + (comp.properties[k].displayName || ""))) { posProp = comp.properties[k]; break; }
                    }
                } catch (ep) {}
                if (posProp) break;
            }
        }
        if (!posProp) return false;
        var pos = posProp.getValue();
        if (!pos || pos.length < 2) return false;
        var x = pos[0], y = pos[1];
        // normalize (0-1) mi yoksa piksel mi: küçük değerler normalize kabul edilir
        var norm = (Math.abs(x) <= 2 && Math.abs(y) <= 2);
        var dy = norm ? (offsetPx / 1080.0) : offsetPx;
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
        // SADECE basılacak zaman aralığındaki klipleri temizle (parça parça yerleştirme korunur)
        var spanS = cues[0].s, spanE = cues[0].e;
        for (var s8 = 1; s8 < cues.length; s8++) { if (cues[s8].s < spanS) spanS = cues[s8].s; if (cues[s8].e > spanE) spanE = cues[s8].e; }
        for (var L = 0; L <= maxLane; L++) {
            var idx = top - L; if (idx < 0) continue;
            try {
                var vt = seq.videoTracks[idx];
                for (var k = vt.clips.numItems - 1; k >= 0; k--) {
                    try {
                        var clx = vt.clips[k], csx = clx.start.seconds, cex = clx.end.seconds;
                        if (cex > spanS + 0.05 && csx < spanE - 0.05) clx.remove(false, false);
                    } catch (er) {}
                }
            } catch (ec) {}
        }

        var placed = 0, failed = 0, firstErr = "", needShift = 0, shifted = 0;
        for (var c = 0; c < cues.length; c++) {
            var idx2 = top - cues[c].lane; if (idx2 < 0) idx2 = 0;
            var mf = new File(cues[c].mg);
            if (!mf.exists) { failed++; if (!firstErr) firstErr = "MOGRT yok: " + cues[c].mg; continue; }
            var ti = null;
            try { ti = seq.importMGT(cues[c].mg, String(Math.round(cues[c].s * TICKS)), idx2, -1); }
            catch (e2) { failed++; if (!firstErr) firstErr = "importMGT: " + e2.toString(); continue; }
            if (!ti) { failed++; continue; }
            _setTextAllWays(ti, cues[c].t);
            _setEndSec(ti, cues[c].e, TICKS);
            if (cues[c].shift > 0) { needShift++; if (_shiftUp(ti, cues[c].shift)) shifted++; }
            placed++;
        }
        return "ok:" + placed + " eklendi" + (needShift ? (", " + shifted + "/" + needShift + " kaydırıldı") : "") + (failed ? (", " + failed + " hata") : "") + (firstErr ? (" | " + firstErr) : "");
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

        // Tek Ctrl+Z ile geri alınabilsin (destekleniyorsa)
        try { app.beginUndoGroup("Yusufwrl AutoCut"); } catch (eug) {}

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
            if (refTrack && !_trackCovers(refTrack, cs, ce, 0.04)) { skippedCover++; continue; }
            var tcS = _secToTC(cs, fpsFrac), tcE = _secToTC(ce, fpsFrac);
            try {
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
        try { app.endUndoGroup(); } catch (eug2) {}
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
    }
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
