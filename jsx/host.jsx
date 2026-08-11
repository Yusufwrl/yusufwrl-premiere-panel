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
 * Plan dosyası (UTF-8), her satır:  medyaYolu|sesKanalIndeksi|baslangicSaniye|ad
 *
 * DİKKAT — bu fonksiyonun kritik incelikleri:
 *  - Zaman SANİYE (Number) olarak verilir. ticks string verilirse klip 0'a düşer.
 *  - overwriteClip kullanılır, insertClip DEĞİL: insert sonraki klipleri sağa iter (senkron bozulur).
 *  - Yerleştirmeden sonra kanalın klip sayısı KONTROL EDİLİR. Kanal tipi uyumsuzsa (saf Mono
 *    kanala stereo klip) Premiere sessizce hiçbir şey yapmıyor; bunu yakalamazsak kullanıcı
 *    "oldu" sanır.
 *  - RENK ETIKETI VERILMEZ. Eskiden her klibe setColorLabel ile karakter rengi atanıyordu;
 *    kullanıcı bunu kafa karıştırıcı buldu (Premiere'in kendi etiket renkleriyle çakışıyor).
 */
function senkronUygula(planDosyaPath) {
    /* Undo grubu: N dosyanin yerlestirilmesi tek Ctrl+Z ile geri alinabilsin.
       Grup olmadan her klip ayri bir undo adimiydi; yanlis klasor secildiginde kullanicinin
       tek tek onlarca kez geri alma yapmasi gerekiyordu. */
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Senkron"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var raw = _readFileUTF8(planDosyaPath);
        var lines = raw.split(/\r?\n/);
        var isler = [], yollar = [], i, disRezerve = {};
        for (i = 0; i < lines.length; i++) {
            var ln = lines[i]; if (!ln) continue;
            /* ⚠ "#REZERVE|<kanal>" — YERLESTIRILMEYEN ama DOKUNULMAMASI GEREKEN kanal.
               Oyun sesi satirinin `dosya` alani olmadigi icin plan dosyasina hic yazilmiyordu;
               host o kanali bilmiyor, rezerve edemiyor ve yedek kanal arayisi (plandaki butun
               kanallari atladigi icin) tam da ONA ulasiyordu: kullanicinin oyun sesini elle
               tasiyacagi bos kanala bir Craig kaydi konuyor, kullanici sonradan oyun sesini
               oraya surukleyince arkadasinin sesini sessizce eziyordu.
               Bu satir `isler`/`yollar` listelerine GIRMEZ — bos `yol` alani importFiles'i
               dusururdu. Yalnizca rezervasyon kumesine yazilir. */
            if (ln.indexOf("#REZERVE|") === 0) {
                var rk = parseInt(ln.slice(9), 10);
                if (!isNaN(rk) && rk >= 0) disRezerve["k" + rk] = true;
                continue;
            }
            var p = ln.split("|"); if (p.length < 4) continue;
            var is = { yol: p[0], kanal: parseInt(p[1], 10), bas: parseFloat(p[2]),
                       ad: p.slice(3).join("|") };
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

        /* ⚠ YERLESTIRME BASARISI KLIP SAYISIYLA OLCULEMEZ — KIMLIKLE OLCULUR.
           Eski test `sonra > once` idi ve yalnizca hedef kanal BOSKEN guvenilir. Ama
           senkronUygula tasarim geregi DOLU kanala da yaziyor (A2'de OBS'in karisik Discord
           sesi duruyor; panelin "A2 temizligi" akisi bunun kaniti). Yeni klip mevcut klibi TAM
           ortuyorsa Premiere onu DEGISTIRIYOR, klip sayisi ayni kaliyor (1 -> 1) ve kod bunu
           "kanal tipi uyumsuz" sanip yedek kanal arayisina giriyordu: hem A2'deki eski ses
           gercekten silinmis oluyor hem AYNI kayittan IKINCI bir kopya baska kanala konuyordu
           (timeline'da cift/yankili ses). Yeni klip birden cok klibi orterse sayi DUSER, yani
           "sonra !== once" de yetmez. Tek dogru olcut: istenen zamanda, istenen MEDYADAN bir
           klip gercekten var mi. */
        function _snkKlipVarMi(track, bas, yol) {
            var TOL = 0.05, j, c, cs, mp, hedef = _norm(yol), n = 0;
            try { n = track.clips.numItems; } catch (eN) { return false; }
            for (j = 0; j < n; j++) {
                c = null;
                try { c = track.clips[j]; } catch (eC) { c = null; }
                if (!c) continue;
                cs = -1;
                try { cs = c.start.seconds; } catch (eS) { cs = -1; }
                if (cs < 0 || Math.abs(cs - bas) > TOL) continue;
                mp = "";
                try { mp = c.projectItem.getMediaPath(); } catch (eM) { mp = ""; }
                /* Yol _norm'dan gecirilir: ham dizgi karsilastirmasi OneDrive/Turkce/junction
                   yollarinda yanlis-negatif verip yedek kanal dalini geri acardi. */
                if (mp && _norm(mp) === hedef) return true;
            }
            return false;
        }

        /* ⚠ PLAN HEDEFLERI REZERVE EDILIR — YEDEK ARAYISI SIRADAKININ KANALINI KAPMASIN.
           "Yalniz BOS kanal" kurali yalnizca O ANI olcuyordu, plan capinda rezervasyon yoktu.
           Plan satirlari kanal sirasina gore isleniyor (A2, A3, A4…) ve yedek arayisi HEP
           yukari (it.kanal+1) bakiyor — yani basarisiz bir satirin dustugu bos kanal
           neredeyse her zaman SIRADA BEKLEYEN bir sonraki satirin hedef kanali oluyor. O satir
           geldiginde kanal artik dolu; overwriteClip uzerine yaziyor ve az once yerlesen Craig
           kaydini yok ediyor.
           ⚠ OYUN SESI KANALI DA KAPSANIR — panel onu "#REZERVE|<kanal>" satiriyla bildiriyor
           (bkz. yukaridaki plan ayristirmasi). Oyun sesi satirinin `dosya` alani olmadigi icin
           `yerlesecek` filtresinden eleniyor ve normal bir plan satiri olarak YAZILAMIYOR;
           bos `yol` alanli satir yazmak da yasak (yollar listesine girip importFiles'i
           dusururdu). Ayni yolla kilitli kanallar ve hizalanamayan kayitlarin hedefleri de
           rezerve ediliyor. Bu satir olmadan yedek arayisi (plandaki butun kanallari
           atladigi icin) tam da oyun sesi kanalina ulasiyordu. */
        var rezerve = {}, ri, rk2;
        for (ri = 0; ri < isler.length; ri++) rezerve["k" + isler[ri].kanal] = true;
        // Plan disi rezervasyonlar (oyun sesi kanali) — yukaridaki "#REZERVE|" satirlarindan.
        for (rk2 in disRezerve) if (Object.prototype.hasOwnProperty.call(disRezerve, rk2)) rezerve[rk2] = true;

        /* tasinan: istenen kanal reddedince BASKA kanala konanlar. Sonuc mesajina yaziliyor —
           sessizce baska yere koymak "sesim nerede" sorusunu doguruyordu. */
        var konan = 0, hata = 0, ilkHata = "", tasinan = [];
        for (i = 0; i < isler.length; i++) {
            var it = isler[i];
            var pi = _bul(it.yol);
            if (!pi) { hata++; if (!ilkHata) ilkHata = it.ad + ": projede bulunamadı"; continue; }

            /* RENK ETIKETI VERILMEZ (kullanici istegi). Burada eskiden setColorLabel cagriliyor,
               her Craig klibi karakterin rengiyle isaretleniyordu; Premiere'in kendi etiket
               renkleriyle karisip kafa karistiriyordu. Klipler artik Premiere'in varsayilan
               etiketiyle kaliyor. */

            if (it.kanal < 0 || it.kanal >= seq.audioTracks.numTracks) {
                hata++; if (!ilkHata) ilkHata = it.ad + ": A" + (it.kanal + 1) + " kanalı yok";
                continue;
            }
            /* SADECE kanal seviyesi kullanilir. Sekans seviyesindeki
               seq.overwriteClip(item, time, vIdx, aIdx) bicimi dokumante DEGIL (4 parametreli
               imza insertClip'e ait) ve klibi Premiere'de HEDEFLENMIS kanala koyabiliyor —
               bu da A1'deki OBS mikrofon kaydinin uzerine yazmak demek. */
            try { seq.audioTracks[it.kanal].overwriteClip(pi, it.bas); } catch (e4) {}

            if (_snkKlipVarMi(seq.audioTracks[it.kanal], it.bas, it.yol)) konan++;
            else {
                /* ⚠ KANAL TIPI UYUMSUZ — YEDEK KANAL ARA, PES ETME.
                   Premiere'de her ses kanalinin bir TIPI var (mono/stereo/5.1) ve MONO bir
                   kanala STEREO klip konmuyor; tip sekans kurulurken belirleniyor ve
                   SONRADAN DEGISTIRILEMIYOR. Craig kayitlari stereo, yani kullanicinin
                   sekansi mono kanallarla acilmissa panel hicbir sey yapamiyordu.
                   GERCEKTEN OLDU (ParsMazi, 7 Agustos 2026): 5 sesin 4'u yerlesemedi ve
                   kullaniciya "sekansi yeniden kur" demekten baska yol kalmadi.
                   Artik istenen kanal reddederse ASAGIDAKI BOS kanallar sirayla denenir.
                   YALNIZ BOS KANAL (clips.numItems === 0): dolu bir kanala yazmak
                   kullanicinin baska bir sesini EZERDI — o bedel, yerlesmeyen bir sesten
                   cok daha pahali. Nereye kondugu sonuc mesajina yaziliyor, yoksa kullanici
                   hangi kanalda kim var bilemez. */
                var yBul = -1, y, yOnce, ySonra;
                for (y = it.kanal + 1; y < seq.audioTracks.numTracks && yBul < 0; y++) {
                    // Plandaki BASKA bir kaydin hedefi ya da bu turda yedek olarak kullanilmis
                    // bir kanal ise DOKUNMA — yoksa o kaydin sesi ezilir.
                    if (rezerve["k" + y]) continue;
                    yOnce = -1;
                    try { yOnce = seq.audioTracks[y].clips.numItems; } catch (e7) { yOnce = -1; }
                    if (yOnce !== 0) continue;                     // dolu ya da okunamadi -> DOKUNMA
                    try { seq.audioTracks[y].overwriteClip(pi, it.bas); } catch (e8) {}
                    /* ⚠ BURADA SAYIM TESTI KULLANILIR, KIMLIK TESTI DEGIL — BILEREK.
                       Kimlik testi (_snkKlipVarMi) asil dalda ZORUNLU cunku orada hedef kanal
                       DOLU olabiliyor ve tam ortusen overwrite klip sayisini degistirmiyor.
                       Ama yedek dongusu YALNIZ BOS kanali deniyor (yOnce === 0), yani 0 -> 1
                       artisi yerlesmeyi kusursuz olcuyor ve sayim testi burada yanilmaz.
                       Kimlik testine gecmek yeni bir hata dogurmustu: _snkKlipVarMi tek bir
                       olcute — getMediaPath() dizge esitligine — bagli ve o karsilastirmanin
                       kirilganligi bu dosyada zaten belgeli (OneDrive/Turkce yol, junction,
                       UNC, Premiere'in farkli normalize etmesi; `_bul` icin bu yuzden ad-yedegi
                       var, _snkKlipVarMi'nin oyle bir yedegi YOK). Yanlis-negatifte yBul < 0
                       kaliyor, dongu BIR SONRAKI bos kanali deniyor ve overwriteClip yeniden
                       calisiyor: onceki klip silinmedigi icin timeline'da her turda bir kopya
                       daha birikiyor. Olculdu: 8 kanalli sekansta ayni kayit 6 KEZ konuyor ve
                       host yine de "hicbir ses yerlestirilemedi" donuyor. */
                    ySonra = -1;
                    try { ySonra = seq.audioTracks[y].clips.numItems; } catch (e9) { ySonra = -1; }
                    if (ySonra > yOnce) yBul = y;
                }
                if (yBul >= 0) {
                    konan++;
                    rezerve["k" + yBul] = true;   // yedek de rezerve: sonraki satir buraya yazmasin
                    tasinan.push(it.ad + " -> A" + (yBul + 1));
                } else {
                    hata++;
                    if (!ilkHata) ilkHata = it.ad + ": hiçbir kanala yerleşmedi " +
                        "(kanal tipi uyumsuz — Craig kaydı stereo, sekanstaki kanallar mono; " +
                        "Sequence > Add Tracks ile Track Type 'Standard' kanal ekle)";
                }
            }
        }
        // Hicbiri yerlesmediyse BASARI DONME: panel "ok:" gorunce akisa devam edip
        // A2 temizligini bile teklif ediyordu.
        if (!konan) return "err:Hiçbir ses yerleştirilemedi. " + (ilkHata || "sebep bilinmiyor");
        var msg = "ok:" + konan + " ses yerleştirildi";
        /* Baska kanala tasinanlari SOYLE: kanal tipi uyumsuzlugu yuzunden panel plani
           degistirdi, kullanici tabloya bakip "burada olmaliydi" diye aramasin. */
        if (tasinan.length) msg += " | kanal tipi uymadığı için taşındı: " + tasinan.join(" · ");
        if (hata) msg += " | " + hata + " hata: " + ilkHata;
        return msg;
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

/* PROJEDEKI ALTYAZI STILLERI (Project panelinde "Ag" ikonuyla duran ogeler).
   Premiere'in ExtendScript API'si caption style'i AYRI BIR TIP olarak vermiyor; bu yuzden
   "bin degil + sekans degil + medya dosyasi yok" kuralıyla ayikliyoruz. Yanlis pozitif
   cikabilir (ör. renk matte'i, ayarlama katmani) — liste kullaniciya gosteriliyor, dogrusunu
   o seciyor. Bos liste "stil yok" demek DEGILDIR, "bulamadik" demektir. */
function captionStilleriJSON() {
    try {
        var out = [];
        _stilGez(app.project.rootItem, out, 0);
        return JSON.stringify({ stiller: out });
    } catch (e) { return JSON.stringify({ error: e.toString() }); }
}
function _stilGez(bin, out, derinlik) {
    if (derinlik > 4) return;                      // ic ice bin'de sonsuza gitmesin
    var n = 0; try { n = bin.children.numItems; } catch (e0) { return; }
    for (var i = 0; i < n; i++) {
        var ch = null; try { ch = bin.children[i]; } catch (e1) { continue; }
        if (!ch) continue;
        var t = -1; try { t = ch.type; } catch (e2) {}
        if (t === 2) { _stilGez(ch, out, derinlik + 1); continue; }   // 2 = BIN
        var isSeq = false; try { isSeq = ch.isSequence(); } catch (e3) {}
        if (isSeq) continue;
        var yol = ""; try { yol = String(ch.getMediaPath()); } catch (e4) { yol = ""; }
        if (yol) continue;                          // diskte dosyasi var -> medya, stil degil
        var ad = ""; try { ad = String(ch.name); } catch (e5) {}
        if (ad) out.push(ad);
    }
}
/* ================= VIDEO KANALLARI (emoji icin) =================
   getSequenceInfoJSON video tarafinda yalnizca KANAL SAYISI veriyor; "hangi kanal
   TAMAMEN BOS" sorusu icin klip sayisi gerekiyor. Emoji yerlestirmenin tek guvenlik
   kurali bu: aritmetikle kanal secmek YOK (v1.8.0 felaketi tam olarak oydu), yalnizca
   "clips.numItems === 0" olan kanal kabul edilir. */
function getVideoTracksJSON() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: "no_sequence" });
        var out = [], n = 0, i, tr, kilit;
        try { n = seq.videoTracks.numTracks; } catch (e0) { n = 0; }
        for (i = 0; i < n; i++) {
            tr = null; try { tr = seq.videoTracks[i]; } catch (e1) { continue; }
            kilit = false; try { kilit = !!tr.isLocked(); } catch (e2) {}
            out.push({ idx: i, klip: (function () { try { return tr.clips.numItems; } catch (e3) { return -1; } })(),
                       kilit: kilit });
        }
        return JSON.stringify({ tracks: out });
    } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

/* ================= EMOJI YERLESTIRME =================
   OLCULDU (kullanicinin makinesi, Premiere 26.3.0, 7 Agustos 2026 — emojiTani ciktisi):
     · Sekans 1920x1080; overwriteClip bos video kanalina PNG koyuyor.
     · Premiere still'i VARSAYILAN 5 SANIYE koyuyor. Bu tercih script'ten OKUNAMIYOR.
       Bedeli: 5 sn'den yakin iki emojiden ikincisi birincinin UZERINE yazar. Bu yuzden
       her klip konar konmaz SURESI yazilir ve bir sonraki ancak ondan sonra konur.
     · clip.end YAZILABILIYOR (6.5 sn istendi, 6.5 okundu) — Time.ticks ile.
     · Motion > Position NORMALIZE: [0.5,0.5] = merkez (piksel DEGIL). Yazma tuttu.
     · Motion > Scale yuzde; yazma tuttu.
   GUVENLIK — TEK KURAL: hedef kanal clips.numItems === 0 olmak ZORUNDA. Kanal numarasi
   HESAPLANMAZ, panelden gelir ve burada dogrulanir. v1.8.0 felaketi (kullanicinin
   goruntusunun silinmesi) tam olarak "kanal numarasini hesaplamaktan" cikmisti.
   Plan satiri: yol|kanal|basSn|sureSn|xNorm|yNorm|olcek|ad */
/* SON EMNIYET TAVANI — SERT DUVAR DEGIL. 100'du ve asilirsa activeSequence bile okunmadan
   "err:" donuyordu: 101 satirlik planda TEK emoji bile konmuyor, odenmis API istegi ve
   25 dakikalik GPU isi copa gidiyordu. Panel artik kendi tarafinda 300'e SEYRELTIYOR
   (reddetmiyor) ve plani parcalara bolerek gonderiyor; buradaki sayi yalnizca panel
   tamamen yanlis bir sey gonderirse diye duruyor. */
var EMOJI_TAVAN = 400;
var EMOJI_BIN = "Yusufwrl Emoji";

function _emojiBinBul(root) {
    var i, ch, t;
    try {
        for (i = 0; i < root.children.numItems; i++) {
            ch = root.children[i];
            t = -1; try { t = ch.type; } catch (e0) {}
            if (t !== 2) continue;                       // 2 = BIN
            var ad = ""; try { ad = String(ch.name); } catch (e1) {}
            if (ad === EMOJI_BIN) { try { if (ch.children) return ch; } catch (e2) {} }
        }
    } catch (e) {}
    return null;
}
/* Bin icinde MEDYA YOLUNA gore ara — ada gore degil. Ayni ada sahip iki farkli dosya
   olabilir ve ad eslesmesi yanlis PNG'yi koydurur.
   ⚠ ARTIK CAGRILMIYOR: emoji yolu _binYolHaritasi + _haritadaBul sozlugune gecti (asagi bak).
   Tek seferlik/kucuk aramalar icin duruyor — sozluk kurmanin maliyeti tek arama icin fazla. */
function _binYolBul(bin, yol) {
    var i, ch, p, hedef = String(yol).replace(/\\/g, "/").toLowerCase();
    try {
        for (i = 0; i < bin.children.numItems; i++) {
            ch = bin.children[i];
            p = ""; try { p = String(ch.getMediaPath()); } catch (e0) { p = ""; }
            if (p && p.replace(/\\/g, "/").toLowerCase() === hedef) return ch;
        }
    } catch (e) {}
    return null;
}
/* Bin icindeki TUM medya yollarini bir sozluge doker (kucuk harf, "/" ayrac, "p" onekli).
   NEDEN: _binYolBul bin cocuklarini LINEER tariyor ve plan satiri BASINA cagriliyor —
   200 emoji x 20 PNG = 4000 getMediaPath cagrisi; kanal dogrulamasinda 312 klipli bir
   kanalda 6000+. Sozluk bunu O(1)'e indiriyor.
   "p" oneki ZORUNLU: "__proto__" / "constructor" gibi bir anahtar duz nesnede prototip
   alanina carpar ve sessizce yanlis esler (ayni onek vurucu.js'te ayni sebeple var). */
function _binYolHaritasi(bin) {
    var h = {}, i, ch, p;
    if (!bin) return h;
    try {
        for (i = 0; i < bin.children.numItems; i++) {
            ch = bin.children[i];
            p = ""; try { p = String(ch.getMediaPath()); } catch (e0) { p = ""; }
            if (p) h["p" + p.replace(/\\/g, "/").toLowerCase()] = ch;
        }
    } catch (e) {}
    return h;
}
function _haritadaBul(harita, yol) {
    if (!yol) return null;
    var k = "p" + String(yol).replace(/\\/g, "/").toLowerCase();
    return harita[k] ? harita[k] : null;
}

/* DOSYA ADIYLA ara — yol eslesmesi tutmadiginda SON CARE.
   ⚠ YALNIZ EMOJI BIN'I ICINDE aranir: proje genelinde ad eslesmesi yanlis klibi koydurur
   (bkz. _binYolBul'un basindaki not), ama bu bin'e yalnizca panel yaziyor ve emoji dosya
   adlari ("Korkmus Dora.png") tekil.
   NEDEN VAR: yol eslesmesi tutmazsa dosya "projede yok" sanilir; eski kod da onu YENIDEN
   import ederdi. Bu yedek, tek bir eslesme aksakliginin yuzlerce emojiyi dusurmesini
   ve gereksiz import turlarini engelliyor. */
function _sonIkiParca(yol) {
    /* "C:/a/b/Emoji/ayna/Korkmus Dora.png" -> "ayna/korkmus dora.png"
       "C:/a/b/Emoji/Korkmus Dora.png"      -> "emoji/korkmus dora.png"          */
    var y = String(yol).replace(/\\/g, "/").toLowerCase();
    var p = y.split("/");
    if (p.length < 2) return y;
    return p[p.length - 2] + "/" + p[p.length - 1];
}
function _binAdBul(bin, yol) {
    if (!bin || !yol) return null;
    /* ⚠ SON İKİ PARÇA — YALNIZ DOSYA ADI YETMEZ, AYNA KOPYASI AYNI ADI TASIYOR.
       js/pngayna.js aynayi <Emoji>\\ayna\\ altina AYNI adla yaziyor ("Korkmus Dora.png").
       Yalniz ada bakan bir arama, SAG taraf icin ozgun resmi ararken SOL taraf icin
       uretilmis AYNALANMIS kopyayi bulabiliyordu — emoji ters bakardi ve panel "basarili"
       derdi. Somut senaryo: 1. calistirmada Mimi A3'te (sol, ayna bin'e girer), sonra
       kullanici Emoji ekranindan A1'i Mimi yapar (artik sag, ozgun gerekir); ozgun yol
       bin'de yoksa ad yedegi aynayi dondururdu.
       Ust klasor adini da katmak ikisini kesin ayiriyor ("ayna/..." ile "emoji/...").
       ⚠ Bu fonksiyon zaten YALNIZ emoji bin'i icinde ariyor — proje genelinde ad eslesmesi
       yanlis klibi koydurur (bkz. _binYolBul'un basindaki not). */
    var hedef = _sonIkiParca(yol), i, ch, p;
    try {
        for (i = 0; i < bin.children.numItems; i++) {
            ch = bin.children[i];
            p = ""; try { p = String(ch.getMediaPath()); } catch (e0) { p = ""; }
            if (p && _sonIkiParca(p) === hedef) return ch;
        }
    } catch (e) {}
    return null;
}

/* TUM EMOJI RESIMLERINI TEK SEFERDE ICE AKTAR — PARCA BASINA IMPORT ETME.
   ⚠ ARKADASIN MAKINESINDE KILITLENEN SEY BUYDU (ParsMazi, 8 Agustos 2026): emojiYerlestir
   plan PARCASI basina (40 emoji) calisiyor ve HER CAGRIDA kendi eksik resimlerini import
   ediyordu. 117 emojilik bir planda bu 3 ayri import demek; Premiere `suppressUI=true` olsa
   bile "Import Files" ilerleme penceresi aciyor ve ucuncusu kilitlendi. Kullanici pencereyi
   iptal edince o parcanin 24 emojisi "resim projeye alinamadi" diye dustu.
   Artik panel butun TEKIL yollari BIR KEZ, YERLESTIRMEDEN AYRI bir evalScript turunda
   yukluyor; parcalar bin'de hazir buluyor ve hic import cagirmiyor. Ayri tur olmasi da
   onemli: import ile klip yerlestirme ayni cagriya sikismiyor, Premiere arada nefes aliyor.
   Donus: "ok:<alinan>/<denenen> …"  ·  eslesmeyen kalirsa mesajda SAYILIR (sessiz kalmaz). */
function emojiResimYukle(listeYol) {
    try {
        var ham = _readFileUTF8(listeYol);
        var satirlar = String(ham).split(/\r?\n/), yollar = [], i, s;
        for (i = 0; i < satirlar.length; i++) { s = satirlar[i]; if (s && s.length) yollar.push(s); }
        if (!yollar.length) return "ok:0/0 (liste bos)";
        if (!app.project) return "err:Proje yok";

        var root = app.project.rootItem, bin = _emojiBinBul(root);
        if (!bin) {
            try { bin = root.createBin(EMOJI_BIN); } catch (eB) { bin = null; }
            if (!bin) bin = root;
        }
        var harita = _binYolHaritasi(bin);
        var eksik = [], gorulen = {}, anah;
        for (i = 0; i < yollar.length; i++) {
            anah = "p" + String(yollar[i]).toLowerCase();
            if (gorulen[anah]) continue;
            gorulen[anah] = true;
            if (!_haritadaBul(harita, yollar[i]) && !_binAdBul(bin, yollar[i])) eksik.push(yollar[i]);
        }
        if (!eksik.length) return "ok:0/" + yollar.length + " (hepsi zaten projede)";

        try { app.project.importFiles(eksik, true, bin, false); }
        catch (eI) { return "err:Emoji resimleri ice aktarilamadi: " + eI.toString(); }

        harita = _binYolHaritasi(bin);
        var kalan = 0;
        for (i = 0; i < eksik.length; i++)
            if (!_haritadaBul(harita, eksik[i]) && !_binAdBul(bin, eksik[i])) kalan++;
        var msg = "ok:" + (eksik.length - kalan) + "/" + eksik.length + " resim projeye alindi";
        if (kalan) msg += " | " + kalan + " tanesi alinamadi (dosya yok ya da Premiere reddetti)";
        return msg;
    } catch (e) { return "err:" + e.toString(); }
}

/* HANGI VIDEO KANALI PANELIN EMOJI KATMANI?
   Panel bunu bilemiyordu ve her calistirmada "en ustteki BOS kanal"i seciyordu: ikinci
   basista onceki katman dolu oldugu icin BIR UST kanala IKINCI bir tam set koyuyor, her
   emoji ekranda iki kez ciziliyordu — host uyarmiyordu cunku o kanal gercekten bostu.
   Ustte bos kanal yoksa panel "Add Track ile ekle" diyip tuzagi kullaniciya kurduruyordu.
   OLCULDU (kullanicinin projesi, 7 Agustos 2026): tam boyle bes katman birikmis —
   V6:235 · V7:125 · V8:77 · V9:29 · V10:13 klip.

   ⚠ EMOJI MI DEGIL MI KARARINI BIN VERMIYOR, PANEL VERIYOR — DOSYA YOLUNA gore.
   Eski hal "Yusufwrl Emoji" adli bin'e bakiyordu ve o binde OLMAYAN her klibi kullanicinin
   goruntusu sayiyordu. Ama emojiYerlestir'de `createBin` basarisiz olursa kod `bin = root`a
   dusuyor ve PNG'ler proje KOKUNE import ediliyor; o zaman bin aramasi bos donuyor ve panel
   KENDI koydugu 479 emojiyi yabanci klip saniyor. Sonuc: hem "bos kanal yok" diyor hem
   "Emojileri Sil" o klipleri temizleyemiyor. Yol karsilastirmasi bin'den bagimsiz calisir —
   bin tasinsa, silinse, hic olusmasa bile.
   Donus: { tracks: [{ idx, klip, kilit, yollar: [{y, n}] }] }
     yollar = kanaldaki TEKIL medya yollari ve her birinden kac klip oldugu (emoji katmaninda
     20 PNG var, goruntu kanalinda 1-2 dosya — yani liste kucuk kalir, 479 klip icin bile). */
function emojiKanallariJSON() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ error: "no_sequence" });
        var out = [], n = 0, i, j, tr, kilit, say, c, p, hy, yl, k;
        try { n = seq.videoTracks.numTracks; } catch (e0) { n = 0; }
        for (i = 0; i < n; i++) {
            tr = null; try { tr = seq.videoTracks[i]; } catch (e1) { continue; }
            kilit = false; try { kilit = !!tr.isLocked(); } catch (e2) {}
            say = -1; try { say = tr.clips.numItems; } catch (e3) { say = -1; }
            hy = {}; yl = [];
            for (j = 0; j < say; j++) {
                c = null; try { c = tr.clips[j]; } catch (e4) { c = null; }
                p = ""; try { p = String(c.projectItem.getMediaPath()); } catch (e5) { p = ""; }
                // "p" oneki: "__proto__" gibi bir anahtar duz nesnede prototipe carpar.
                k = "p" + p.replace(/\\/g, "/").toLowerCase();
                if (!hy[k]) { hy[k] = { y: p, n: 0 }; yl.push(hy[k]); }
                hy[k].n++;
            }
            out.push({ idx: i, klip: say, kilit: kilit, yollar: yl });
        }
        return JSON.stringify({ tracks: out });
    } catch (e) { return JSON.stringify({ error: e.toString() }); }
}

function _klipBulZamanda(vt, sn) {
    var i, c, s;
    try {
        for (i = 0; i < vt.clips.numItems; i++) {
            c = vt.clips[i]; s = _zamanSn(c.start);
            if (!isNaN(s) && Math.abs(s - sn) < 0.05) return c;
        }
    } catch (e) {}
    return null;
}
/* devamMi === "1": bu, cok parcali bir yerlestirmenin DEVAM parcasi (bkz. app.js
   EMOJI_PARCA). Tek cagrida 150+ emoji konarken Premiere dakikalarca DONUYOR ve panel
   ilerleme gosteremiyor; plan parcalara bolununce 2. parca "kanal bos degil" diye
   reddediliyordu. Bu bayrak yalnizca o kurali gevsetiyor — kullanicinin goruntusunun
   oldugu kanal HALA reddediliyor (asagida yabanci klip aramasi). */
function emojiYerlestir(planYol, devamMi) {
    try {
        var ham = _readFileUTF8(planYol);
        var satirlar = String(ham).split(/\r?\n/), plan = [], i, p;
        for (i = 0; i < satirlar.length; i++) {
            if (!satirlar[i] || !satirlar[i].length) continue;
            p = satirlar[i].split("|");
            if (p.length < 8) continue;
            plan.push({ yol: p[0], kanal: parseInt(p[1], 10), bas: parseFloat(p[2]),
                        sure: parseFloat(p[3]), x: parseFloat(p[4]), y: parseFloat(p[5]),
                        olcek: parseFloat(p[6]), ad: p[7] });
        }
        if (!plan.length) return "err:Plan bos";
        if (plan.length > EMOJI_TAVAN) return "err:" + plan.length + " emoji cok fazla (tavan " + EMOJI_TAVAN + ") — sikligi azalt";

        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var kanal = plan[0].kanal;
        if (isNaN(kanal) || kanal < 0 || kanal >= seq.videoTracks.numTracks) return "err:V" + (kanal + 1) + " kanali yok";
        var vt = seq.videoTracks[kanal];
        try { if (vt.isLocked()) return "err:V" + (kanal + 1) + " KILITLI — kilidi ac"; } catch (eL) {}
        /* Bin ONCE bulunur (yaratilmadan): asagidaki guvenlik kontrolu kanaldaki kliplerin
           BIZIM emojilerimiz olup olmadigini bu sozlukten ogreniyor. */
        var root = app.project.rootItem, bin = _emojiBinBul(root);
        var harita = _binYolHaritasi(bin);

        /* EMOJI KLASORLERI — plandaki PNG yollarindan turetilir. Asagidaki "devam parcasi"
           kontrolu kanaldaki kliplerin BIZIM emojilerimiz olup olmadigini buradan da
           ogreniyor: bin'e tek basina guvenmek yetmiyor, cunku createBin basarisiz olursa
           PNG'ler proje KOKUNE import ediliyor ve bin aramasi bos donuyor (kullanicinin
           projesinde tam olarak bu oldu — 479 emoji "yabanci klip" sanildi). */
        var klasorler = {}, kk, kd, kf, kust;
        for (i = 0; i < plan.length; i++) {
            kk = String(plan[i].yol).replace(/\\/g, "/").toLowerCase();
            kd = kk.lastIndexOf("/");
            if (kd <= 0) continue;
            kf = kk.slice(0, kd + 1);
            klasorler["k" + kf] = true;
            /* ⚠ "…/ayna/" ISE BIR UST KLASORU DE EKLE. Sol taraftaki karakterlerin resmi
               panelin urettigi AYNALANMIS kopyalar ve <Emoji>\ayna\ altinda duruyor;
               sag taraftakiler kok klasorde. Bu kume plan PARCASI basina kuruluyor (40'lik
               dilimler): bir devam parcasinin 40 satirinin TAMAMI sol taraf olursa (uzun bir
               konuk sohbeti) kume yalniz ayna klasorunu icerir ve onceki parcanin KOK
               klasorden gelen emojilerini "yabanci klip" sayip yerlestirmeyi ORTADA durdurur
               ("V7 kanalinda emoji OLMAYAN 40 klip var"), kullanicida yarim bir emoji
               katmani kalirdi. Bin haritasi normalde bunu yakalar ama createBin basarisiz
               olup PNG'ler proje KOKUNE import edildiginde harita BOS kalir — kullanicinin
               projesinde bir kez gercekten oldu (5 katman / 479 klip). Bu satir tam da o
               ikinci emniyetin aynalama yuzunden delinmesini onluyor. */
            kust = kf.match(/^(.*\/)ayna\/$/);
            if (kust) klasorler["k" + kust[1]] = true;
        }
        function _emojiKlasorde(yol) {
            var y = String(yol).replace(/\\/g, "/").toLowerCase(), a;
            for (a in klasorler) {
                if (!klasorler.hasOwnProperty(a)) continue;
                if (y.indexOf(a.slice(1)) === 0) return true;
            }
            return false;
        }

        /* GUVENLIK KURALI — ILK PARCADA AYNEN ESKISI GIBI, ARITMETIK YOK.
           devam DEGILSE: kanal BOS olmak ZORUNDA (v1.8.0 korumasi — kullanicinin
             goruntusunun silinmesi tam olarak "kanal numarasini hesaplamaktan" cikmisti).
           devam ISE: kanal bos YA DA icindeki HER klip Emoji bin'inden olmali. Bu gevseme
             korumayi ZAYIFLATMIYOR: tek bir yabanci klip varsa hicbir sey yapilmiyor. */
        var devam = (String(devamMi) === "1");
        var mevcut = -1; try { mevcut = vt.clips.numItems; } catch (eN) {}
        if (mevcut < 0) return "err:V" + (kanal + 1) + " kanalinin klipleri okunamadi";
        /* ⚠ sonBitis BURADA tanimlanir ve BIR DAHA tanimlanmaz. Asagidaki yerlestirme
           dongusunde ikinci bir "var sonBitis = -1" olsaydi burada hesaplanan deger
           SESSIZCE ezilirdi (ES3 ikinci var'a hata vermez) ve parcalar arasi cakisma freni
           kagit uzerinde var ama calismaz olurdu. */
        var sonBitis = -1;
        if (mevcut !== 0) {
            if (!devam) return "err:V" + (kanal + 1) + " BOS DEGIL (" + mevcut + " klip var) — emoji ancak bos bir video kanalina konur";
            /* ⚠ TARAMA SONDAN BASLAR VE ERKEN CIKAR — eskiden her devam parcasi kanaldaki
               TUM klipleri bastan geziyordu (O(n^2)). Klipler zaman sirasinda oldugu ve her
               parca oncekinin BITISINDEN sonra yazdigi icin:
                 · en gec biten klip DAIMA sonuncudur -> sonBitis ilk turda bulunur,
                 · onceki parcalarin kliplerini yeniden dogrulamanin bir anlami yok; onlar
                   kendi parcalarinda zaten bu kontrolden gecti.
               Bu yuzden yalnizca SON `_TARA_TAVAN` klip inceleniyor. Tavan EMOJI_PARCA'dan
               (40) buyuk secildi: bir onceki parcanin koydugu her klip kapsam icinde kalsin,
               yani "kullanici arada kanala yabanci bir klip koydu" durumu yine yakalansin.
               ⚠ ILK PARCADA (devam=0) kanal ZATEN BOS olmak zorunda — o kural degismedi,
               yukaridaki `if (!devam) return err` satiri hala kosulsuz. */
            var _TARA_TAVAN = 60;
            var yabanci = 0, ci, cc, cp, ce;
            var _bas = (mevcut > _TARA_TAVAN) ? (mevcut - _TARA_TAVAN) : 0;
            for (ci = mevcut - 1; ci >= _bas; ci--) {
                cc = null; try { cc = vt.clips[ci]; } catch (eC) { cc = null; }
                cp = ""; try { cp = String(cc.projectItem.getMediaPath()); } catch (eCp) { cp = ""; }
                if (cp && (_haritadaBul(harita, cp) || _emojiKlasorde(cp))) {
                    /* PARCALAR ARASI CAKISMA DEVAMLILIGI: fren kanaldaki EN GEC bitisten
                       baslamali. Her cagrida -1'e sifirlansaydi 2. parcanin ilk emojisi
                       1. parcanin sonuncusunun ustune biner ve overwriteClip onu kirpardi. */
                    ce = _zamanSn(cc.end);
                    if (!isNaN(ce) && ce > sonBitis) sonBitis = ce;
                } else yabanci++;
            }
            /* Sayi "son _TARA_TAVAN klip icinde" anlaminda — mesaj bunu ima etmeli, yoksa
               kullanici kanalda toplam o kadar yabanci klip oldugunu sanar. */
            if (yabanci) return "err:V" + (kanal + 1) + " kanalinda emoji OLMAYAN klip var (" +
                                yabanci + " tanesi son " + _TARA_TAVAN + " klipte) — yazilmadi";
        }

        // Bin yoksa yarat. Kosulsuz createBin her calistirmada kopya uretir.
        if (!bin) {
            try { bin = root.createBin(EMOJI_BIN); } catch (eB) { bin = null; }
            if (!bin) bin = root;
        }

        /* Eksik PNG'leri ice aktar — NORMALDE BURASI HIC CALISMAZ.
           ⚠ Resimler artik emojiResimYukle ile TEK SEFERDE, bu cagridan ONCE yukleniyor
           (bkz. o fonksiyonun basindaki not: parca basina import ParsMazi'nin makinesinde
           "Import Files" penceresini kilitliyordu). Burasi yalnizca YEDEK: panel eski
           surumdeyse ya da on yukleme atlandiysa devreye girer.
           Ad yedegi (_binAdBul) once denenir ki yol eslesmesindeki tek bir aksaklik
           gereksiz bir import turu baslatmasin. */
        var eksik = [], gorulen = {}, j;
        for (i = 0; i < plan.length; i++) {
            if (gorulen[plan[i].yol]) continue;
            gorulen[plan[i].yol] = true;
            if (!_haritadaBul(harita, plan[i].yol) && !_binAdBul(bin, plan[i].yol)) eksik.push(plan[i].yol);
        }
        if (eksik.length) {
            try { app.project.importFiles(eksik, true, bin, false); }
            catch (eI) { return "err:Emoji resimleri ice aktarilamadi: " + eI.toString(); }
            // Yeni ogeler haritada YOK — yenile, yoksa hepsi "resim projeye alinamadi" der.
            harita = _binYolHaritasi(bin);
        }

        var ok = 0, hata = [];
        for (i = 0; i < plan.length; i++) {
            var it = plan[i];
            /* CAKISMA FRENI: onceki emoji hala ekrandayken ustune yazma. */
            if (sonBitis > 0 && it.bas < sonBitis - 0.001) {
                hata.push(it.ad + " (onceki emojiyle cakisiyor, atlandi)");
                continue;
            }
            /* Yol eslesmesi tutmazsa ADA gore ara (yalniz emoji bin'i icinde) — tek bir
               eslesme aksakligi yuzunden emojiyi dusurme. */
            var pi = _haritadaBul(harita, it.yol) || _binAdBul(bin, it.yol);
            if (!pi) { hata.push(it.ad + " (resim projeye alinamadi)"); continue; }

            var oncekiSayi = vt.clips.numItems;
            try { vt.overwriteClip(pi, it.bas); }
            catch (eO) { hata.push(it.ad + " (yerlestirilemedi: " + eO.toString() + ")"); continue; }
            if (vt.clips.numItems <= oncekiSayi) { hata.push(it.ad + " (klip olusmadi)"); continue; }

            /* KONAN KLIBI BUL. Plan zaman sirasinda ve sonBitis freni geriye yazmayi
               engelledigi icin yeni klip DAIMA sonuncudur — devam parcasinda kanal dolu
               baslasa bile, cunku o parca oncekinin bitisinden SONRA yaziyor. Zaman
               eslesmesi yalnizca DOGRULAMA. Eskiden yalniz
               zamana bakiliyordu ve 0.05 sn tolerans (23.976 fps'te tek kare 0.042 sn)
               tutmazsa klip ORTADA KALIYORDU: 5 sn'lik, tam ekran, merkezde bir cop klip —
               ustelik sonBitis guncellenmedigi icin sonraki emoji onu bilmiyordu. */
            var ti = null;
            try { ti = vt.clips[vt.clips.numItems - 1]; } catch (eSon) { ti = null; }
            if (ti) {
                var sBas = _zamanSn(ti.start);
                if (isNaN(sBas) || Math.abs(sBas - it.bas) >= 0.05) ti = _klipBulZamanda(vt, it.bas) || ti;
            } else ti = _klipBulZamanda(vt, it.bas);
            if (!ti) {
                /* Klibe hic erisemedik: 5 sn'lik cop birakma, SON klibi kaldirmayi dene. */
                try { vt.clips[vt.clips.numItems - 1].remove(false, false); } catch (eTem) {}
                hata.push(it.ad + " (konan klip bulunamadi, kaldirildi)");
                continue;
            }

            /* SURE — SART. Varsayilan 5 sn birakilirsa sonraki emoji bunun ustune biner. */
            var istenenSon = it.bas + it.sure, sureTuttu = false;
            try {
                var t = new Time(); t.ticks = String(Math.round(istenenSon * TICK_SN));
                ti.end = t;
                sureTuttu = (Math.abs(_zamanSn(ti.end) - istenenSon) < 0.05);
            } catch (eS) { sureTuttu = false; }
            if (!sureTuttu) {
                /* Suresi yazilamayan klip 5 sn kalir ve sonrakini yer — BIRAKMA, SIL. */
                try { ti.remove(false, false); } catch (eR) {}
                hata.push(it.ad + " (suresi yazilamadi, kaldirildi)");
                continue;
            }

            /* KONUM + BOYUT. Yazilamazsa emoji SILINMEZ (ortada durur, kullanici gorur ve
               elle tasiyabilir) ama rapora dusler. */
            var notlar = "";
            /* ⚠ TEK YURUYUS: Position ve Scale ayni "Motion" bileseninde. Eskiden iki ayri
               _paramAraTum cagrisi agaci BASTAN iki kez geziyordu — klip basina ~17 Premiere
               erisimi, 206 emojide ~3.500 gereksiz cagri. */
            var _ps = _paramAraIki(ti, ["Position", "Konum"], ["Scale", "Ölçek", "Olcek"]);
            var pos = _ps[0];
            if (pos) {
                try {
                    pos.setValue([it.x, it.y], true);
                    if (!_statikTuttu(pos, [it.x, it.y])) notlar += " (konum tutmadi)";
                } catch (eP) { notlar += " (konum yazilamadi)"; }
            } else notlar += " (Position yok)";
            /* OLCEK YAZILAMAZSA KLIBI SIL — konum yazilamamasiyla AYNI SEY DEGIL.
               Konum tutmazsa emoji ortada durur (cirkin ama gorunur). Olcek tutmazsa PNG
               kendi boyutunda gelir: 2000px'lik bir resim 1080p karede EKRANI KAPATIR ve
               1.6 sn boyunca video gorunmez. Boyle bir klibi birakmaktansa hic koymamak
               yegdir. */
            var scl = _ps[1];               // yukaridaki tek yuruyusten geldi
            var olcekOk = true;
            if (!isNaN(it.olcek)) {
                if (!scl) olcekOk = false;
                else {
                    try {
                        scl.setValue(it.olcek, true);
                        olcekOk = _statikTuttu(scl, it.olcek);
                    } catch (eSc) { olcekOk = false; }
                }
            }
            if (!olcekOk) {
                try { ti.remove(false, false); } catch (eR2) {}
                hata.push(it.ad + " (olcek yazilamadi — ekrani kaplamasin diye kaldirildi)");
                continue;
            }
            if (notlar) hata.push(it.ad + notlar);
            ok++;
            /* FRENI GERI OKUNAN BITISTEN KUR, istenenden DEGIL. Premiere bitisi KAREYE
               yuvarliyor ve yukari yuvarlarsa gercek bitis istenenden buyuk oluyor; fren
               istenene gore kurulursa sonraki emoji o farkin icine dusup oncekinin son
               karesini kirpar. Emojiler seyrekken gorunmezdi; sure artik CUMLE BOYUNCA
               oldugu ve emojiler arka arkaya gelebildigi icin her emojide olur. */
            var gercekSon = _zamanSn(ti.end);
            sonBitis = (!isNaN(gercekSon) && gercekSon > istenenSon) ? gercekSon : istenenSon;
        }

        if (!ok) return "err:" + (hata.length ? hata[0] : "hicbir emoji konmadi");
        var msg = "ok:" + ok + "/" + plan.length + " emoji kondu (V" + (kanal + 1) + ")";
        if (ok < plan.length) msg += " — " + (plan.length - ok) + " tanesi OLMADI";
        /* HEPSI KONSA BILE UYARI VARSA SOYLE. Eskiden konum/olcek uyarilari "ok:40/40"
           icinde kayboluyor, panel de yesil gosteriyordu (kismi-basari testi yalniz
           "OLMADI" ariyor). 40 klibin 40'inda konum tutmamis olabilir. */
        else if (hata.length) msg += " — " + hata.length + " UYARI";
        if (hata.length) msg += " | " + hata.slice(0, 5).join(" ; ") +
                                (hata.length > 5 ? (" … (+" + (hata.length - 5) + ")") : "");
        return msg;
    } catch (e) { return "err:" + e.toString(); }
}
/* Emoji kanalini TEMIZLE — "begenmedim, tekrar dene" akisi icin.
   YALNIZ verilen kanal ve YALNIZ Emoji bin'inden gelen klipler silinir; kanalda baska bir
   sey varsa hicbir sey yapilmaz (kullanicinin klibini silmek en pahali hata olurdu). */
/* yolDosyasi: satir basina bir MEDYA YOLU — silinecek kliplerin dosyalari. Panel bu listeyi
   emojiKanallariJSON'dan aldigi yollari kendi emoji klasoruyle karsilastirarak uretiyor.
   NEDEN DOSYA: evalScript string literaline gomulen Turkce karakter kirilgan (proje geneli
   kural) ve emoji klasoru "Masaüstü" iceriyor.
   NEDEN BIN'E GUVENILMIYOR: emojiYerlestir'de createBin basarisiz olursa PNG'ler proje
   KOKUNE import ediliyor; bin aramasi bos donuyor ve panel kendi koydugu emojileri yabanci
   klip saniyor — kullanicinin projesinde tam olarak bu oldu (5 katman, 479 klip temizlenemedi).
   Dosya verilmezse eski bin yoluna dusulur (geriye uyumluluk). */
function emojiTemizle(kanalNo, yolDosyasi) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var k = parseInt(kanalNo, 10);
        if (isNaN(k) || k < 0 || k >= seq.videoTracks.numTracks) return "err:V" + (k + 1) + " kanali yok";
        var vt = seq.videoTracks[k];
        var harita = null;
        if (yolDosyasi) {
            harita = {};
            var ham = "", satir, si2;
            try { ham = String(_readFileUTF8(yolDosyasi)); } catch (eF) { ham = ""; }
            satir = ham.split(/\r?\n/);
            for (si2 = 0; si2 < satir.length; si2++) {
                if (!satir[si2] || !satir[si2].length) continue;
                harita["p" + satir[si2].replace(/\\/g, "/").toLowerCase()] = true;
            }
        } else {
            var bin = _emojiBinBul(app.project.rootItem);
            if (!bin) return "ok:0 emoji silindi (Emoji bin'i yok)";
            harita = _binYolHaritasi(bin);
        }
        /* Once DOGRULA: kanaldaki her klip emoji mi? Degilse HIC DOKUNMA. */
        var i, c, p, yabanci = 0, hedefler = [];
        for (i = 0; i < vt.clips.numItems; i++) {
            c = vt.clips[i];
            p = ""; try { p = String(c.projectItem.getMediaPath()); } catch (e0) { p = ""; }
            if (p && _haritadaBul(harita, p)) hedefler.push(c); else yabanci++;
        }
        if (yabanci) return "err:V" + (k + 1) + " kanalinda emoji OLMAYAN " + yabanci + " klip var — silinmedi";
        var silindi = 0;
        for (i = hedefler.length - 1; i >= 0; i--) {
            try { hedefler[i].remove(false, false); silindi++; } catch (e1) {}
        }
        return "ok:" + silindi + " emoji silindi (V" + (k + 1) + ")";
    } catch (e) { return "err:" + e.toString(); }
}

/* ================= TANILAMA: SECILI EMOJI KLIBINE NE OLDU? =================
   Kullanici "emoji Premiere'de solundan kesiliyor" dedi; PNG'ler olculdu ve KESIK DEGIL
   (alfa bounding box: sol kenarda opak piksel yok). Demek ki kirpma Premiere tarafinda —
   ama panel hangi degerin yazildigini GORMUYORDU, yalniz yaziyordu.
   Bu fonksiyon seCili klibin GERCEK durumunu dokumler: medya cozunurlugu, Motion'in butun
   parametreleri (Scale Width / Uniform Scale / Crop* dahil — bunlardan biri kirpiyor olabilir)
   ve klipteki TUM bilesenler (elle eklenmis bir efekt varsa orada gorunur).
   YIKICI DEGIL: hicbir sey yazmaz, yalniz okur. */
function emojiKlipTani() {
    var log = [];
    function y(s) { log.push(String(s)); }
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "HATA: aktif sekans yok";
        var W = 0, H = 0;
        try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (eF) {}
        y("Sekans: " + W + "x" + H);
        var sec = null;
        try { sec = seq.getSelection(); } catch (eS) {}
        if (!sec || !sec.length) return "HATA: timeline'da bir EMOJI klibi sec, sonra tekrar bas";

        var ti = null, i;
        for (i = 0; i < sec.length; i++) { if (!_sesKlibiMi(sec[i])) { ti = sec[i]; break; } }
        if (!ti) return "HATA: secimde video klibi yok";

        var yol = "";
        try { yol = String(ti.projectItem.getMediaPath()); } catch (e1) {}
        y("Klip: " + yol.replace(/^.*[\\\/]/, ""));
        // Medyanin GERCEK cozunurlugu: panel olcegi buna gore hesapliyor (620/2000 = %31).
        try {
            var md = ti.projectItem.getFootageInterpretation();
            if (md) y("Medya yorumu: pixelAspect=" + md.pixelAspectRatio + " frameRate=" + md.frameRate);
        } catch (e2) { y("Medya yorumu okunamadi"); }
        y("Klip suresi: " + (_zamanSn(ti.end) - _zamanSn(ti.start)).toFixed(2) + " sn");

        var c = ti.components, j, ps, k, dn, dv;
        y("--- BILESENLER (" + c.numItems + ") ---");
        for (i = 0; i < c.numItems; i++) {
            var bad = "?", bmatch = "";
            try { bad = String(c[i].displayName); } catch (e3) {}
            try { bmatch = String(c[i].matchName); } catch (e4) {}
            y("[" + i + "] " + bad + "   (" + bmatch + ")");
            try {
                ps = c[i].properties;
                for (j = 0; j < ps.numItems; j++) {
                    dn = ""; try { dn = String(ps[j].displayName || ""); } catch (e5) { continue; }
                    /* Yalniz kirpmayla/konumla ilgili olanlari yaz — tam dokum 60+ satir olur
                       ve panelde okunmaz. */
                    if (!/Position|Scale|Uniform|Anchor|Crop|Opacity|Konum|Ölçek/i.test(dn)) continue;
                    dv = "?";
                    try { dv = JSON.stringify(ps[j].getValue()); } catch (e6) { dv = "okunamadi"; }
                    var kf = "";
                    try { if (ps[j].isTimeVarying()) kf = " [KEYFRAME'LI]"; } catch (e7) {}
                    y("     " + dn + " = " + String(dv).slice(0, 40) + kf);
                }
            } catch (e8) { y("     (parametreler okunamadi)"); }
        }
        return log.join("\n");
    } catch (e) { return "HATA: " + e.toString() + "\n" + log.join("\n"); }
}

/* ================= OLCUM: emoji yerlestirilebiliyor mu? =================
   TEK SEFERLIK TANILAMA (presetTani / captionStilTani deseni). Uretim yolu buna
   GUVENMEZ; amaci, kod yazmadan once su sorulari kullanicinin makinesinde CEVAPLAMAK:
     1. Bos bir video kanalina PNG konabiliyor mu (overwriteClip)?
     2. Premiere still'i kac saniyelik koyuyor (script'ten okunamayan tercih)?
     3. Klibin SURESI yazilabiliyor mu (yoksa yakin emojiler birbirini yer)?
     4. Motion > Position/Scale yazilip GERI OKUNABILIYOR mu, deger NORMALIZE mi piksel mi?
   YIKICI DEGIL: yalniz BOS kanala dokunur ve sonunda koydugu klibi SILER. */
function emojiTani(pngYol) {
    var log = [];
    function y(s) { log.push(String(s)); }
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "HATA: aktif sekans yok";
        y("Premiere: " + app.version);
        var W = 0, H = 0;
        try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (eF) {}
        y("Sekans olcusu: " + W + "x" + H);

        /* BOS video kanali bul — yoksa HICBIR SEY YAPMA. */
        var n = 0, i, tr, hedef = -1;
        try { n = seq.videoTracks.numTracks; } catch (e0) {}
        for (i = 0; i < n; i++) {
            try { tr = seq.videoTracks[i]; } catch (e1) { continue; }
            var kl = false; try { kl = !!tr.isLocked(); } catch (e2) {}
            var ks = -1; try { ks = tr.clips.numItems; } catch (e3) {}
            y("  V" + (i + 1) + ": " + ks + " klip" + (kl ? " (KILITLI)" : ""));
            if (hedef < 0 && ks === 0 && !kl) hedef = i;
        }
        if (hedef < 0) return log.join("\n") + "\nSONUC: BOS video kanali YOK — Premiere'de bir tane ekle (kanal basligina sag tik > Add Track).";
        y("Hedef (bos) kanal: V" + (hedef + 1));

        /* PNG'yi projeye al */
        var kokB = app.project.rootItem, oncekiSayi = 0;
        try { oncekiSayi = kokB.children.numItems; } catch (eC) {}
        try { app.project.importFiles([pngYol], true, kokB, false); }
        catch (eI) { return log.join("\n") + "\nHATA: PNG ice aktarilamadi: " + eI.toString(); }
        var sonraSayi = oncekiSayi;
        try { sonraSayi = kokB.children.numItems; } catch (eC2) {}
        y("Ice aktarma: proje ogesi " + oncekiSayi + " -> " + sonraSayi);
        if (sonraSayi <= oncekiSayi) return log.join("\n") + "\nHATA: PNG proje ogesi olmadi.";
        var pi = null;
        try { pi = kokB.children[sonraSayi - 1]; } catch (eP) {}
        if (!pi) return log.join("\n") + "\nHATA: proje ogesi okunamadi.";

        /* Timeline'a koy */
        var vt = seq.videoTracks[hedef], oncekiKlip = 0;
        try { oncekiKlip = vt.clips.numItems; } catch (eK) {}
        try { vt.overwriteClip(pi, 5); }
        catch (eO) { return log.join("\n") + "\nHATA: overwriteClip patladi: " + eO.toString(); }
        var sonKlip = oncekiKlip;
        try { sonKlip = vt.clips.numItems; } catch (eK2) {}
        y("Yerlestirme: klip " + oncekiKlip + " -> " + sonKlip);
        if (sonKlip <= oncekiKlip) return log.join("\n") + "\nHATA: overwriteClip hata vermedi ama KLIP OLUSMADI.";

        var ti = null;
        try { ti = vt.clips[sonKlip - 1]; } catch (eT) {}
        if (!ti) return log.join("\n") + "\nHATA: konan klip okunamadi.";
        var b = _zamanSn(ti.start), e2s = _zamanSn(ti.end);
        y("Klip: bas=" + b + " sn, bit=" + e2s + " sn, VARSAYILAN SURE=" + (e2s - b) + " sn");

        /* SURE yazilabiliyor mu? (yakin emojiler birbirini yemesin diye sart) */
        var yeniSon = b + 1.5, sureOk = "?";
        try {
            var t = new Time(); t.ticks = String(Math.round(yeniSon * TICK_SN));
            ti.end = t;
            var okunan = _zamanSn(ti.end);
            sureOk = (Math.abs(okunan - yeniSon) < 0.05) ? ("EVET (" + okunan + " sn)") : ("HAYIR (istendi " + yeniSon + ", oldu " + okunan + ")");
        } catch (eS) { sureOk = "HAYIR (" + eS.toString() + ")"; }
        y("Sure yazilabiliyor mu: " + sureOk);

        /* Position / Scale */
        var pos = _paramAraTum(ti, ["Position", "Konum"]);
        var scl = _paramAraTum(ti, ["Scale", "Ölçek", "Olcek"]);
        y("Motion bulundu mu: Position=" + (pos ? "evet" : "HAYIR") + " Scale=" + (scl ? "evet" : "HAYIR"));
        if (pos) {
            var mevcut = null; try { mevcut = pos.getValue(); } catch (eG) {}
            y("Position MEVCUT deger: " + (mevcut ? ("[" + mevcut.join(", ") + "]") : "okunamadi") +
              "  (0..1 ise NORMALIZE, buyuk sayiysa PIKSEL)");
            try {
                pos.setValue([0.80, 0.78], true);
                var geri = pos.getValue();
                y("Position [0.80,0.78] yazildi -> geri okundu: [" + geri.join(", ") + "]");
            } catch (eSp) { y("Position YAZILAMADI: " + eSp.toString()); }
        }
        if (scl) {
            var sm = null; try { sm = scl.getValue(); } catch (eG2) {}
            y("Scale MEVCUT: " + sm);
            try { scl.setValue(25, true); y("Scale 25 yazildi -> geri okundu: " + scl.getValue()); }
            catch (eSs) { y("Scale YAZILAMADI: " + eSs.toString()); }
        }

        /* TEMIZLIK — koydugumuz klibi sil, kanal eski haline donsun. */
        var silindi = "?";
        try { ti.remove(false, false); silindi = (vt.clips.numItems === oncekiKlip) ? "evet" : "HAYIR"; }
        catch (eR) { silindi = "HAYIR (" + eR.toString() + ")"; }
        y("Test klibi silindi mi: " + silindi);
        y("NOT: proje panelindeki PNG ogesi duruyor, elle silebilirsin.");
        return log.join("\n");
    } catch (e) { return log.join("\n") + "\nHATA: " + e.toString(); }
}

/* STILLERI PROJEYE AL — .prtextstyle dosyalarini PROJE OGESI yapar.
   NEDEN GEREKLI: Premiere'de iki ayri sey var ve karistirilmasi kolay —
     · YEREL stil  : Belgeler\Adobe\Common\Assets\Text Styles\*.prtextstyle
                     Yalniz "Style Browser"da gorunur.
     · PROJE stili : proje ogesi. "New caption track > Style" acilir listesi YALNIZ BUNU
                     gosterir.
   Yerel dosyayi kurmak altyazi stili listesinde gormek icin YETMIYOR (kullanici ekran
   goruntusuyle gosterdi: 7 yerel stil kurulu ama listede yalnizca 2 proje ogesi vardi).
   Adobe'nin elle yolu: Style Browser'da stile sag tik > "Set as track style (captions)",
   ya da .prtextstyle'i Project paneline surukle. importFiles o suruklemenin script hali.
   AYNI ADLI OGE VARSA ATLANIR — her cagrida projede kopya birikmesin. */
function stilleriProjeyeAl(klasor) {
    try {
        if (!app.project) return "err:Proje acik degil";
        var kl = new Folder(klasor);
        if (!kl.exists) return "err:Stil klasoru yok: " + klasor;
        var dosyalar = kl.getFiles("*.prtextstyle");
        if (!dosyalar || !dosyalar.length) return "err:Klasorde .prtextstyle yok";

        var root = app.project.rootItem, i, ad, alinacak = [], zaten = 0;
        for (i = 0; i < dosyalar.length; i++) {
            ad = String(dosyalar[i].name).replace(/\.prtextstyle$/i, "");
            /* decodeURI: ExtendScript File.name yolu URI-kodlu verebiliyor
               ("K%C4%B1rm%C4%B1z%C4%B1") ve ad karsilastirmasi tutmuyordu. */
            try { ad = decodeURI(ad); } catch (eD) {}
            /* "Zaten var mi" YALNIZ BIR TAHMIN: stilin proje ogesi olarak adi DOSYA ADI
               olmayabiliyor — stil dosyasinin ICINDE ayri bir ad tasiyor (olculdu:
               "Siyah Text.prtextstyle" dosyasi tarayicida "Beyaz Text" gorunuyor).
               Bu yuzden burasi yalnizca gereksiz kopyayi AZALTMAYA calisir; basarinin
               olcusu DEGILDIR (asagida sayiyla olculuyor). */
            if (_projeOgesiBul(ad)) { zaten++; continue; }
            alinacak.push(dosyalar[i].fsName);
        }
        if (!alinacak.length) return "ok:0 stil eklendi (" + zaten + " zaten projede)";

        /* DOGRULAMA ADLA DEGIL SAYIYLA. importFiles tanimadigi turu sessizce yok
           sayabiliyor, yani "hata gelmedi" yetmez. Ada bakan bir dogrulama ise yukaridaki
           ad uyusmazligi yuzunden CALISAN bir icermeyi "olmadi" diye raporluyordu.
           Kok ogenin sayisi ada bagli degil — once/sonra farki kesin olcu. */
        /* ⚠ TEK TEK ICE AKTAR — HEPSINI BIRDEN DEGIL.
           ParsMazi'nin makinesinde bu cagri PREMIERE'I COKERTTI (7 Agustos 2026). Sebep
           kesin olarak olculemedi (baska makine), ama toplu importFiles cokerse:
             · hangi dosyanin sorunlu oldugu ANLASILMIYOR,
             · o ana kadar eklenenler de kayboluyor,
             · panel hicbir sey loglayamadan Premiere kapaniyor.
           Tek tek gidince her dosyanin adi ONCE gunluge yaziliyor; cokme yine olursa
           gunlugun SON satiri sucluyu gosteriyor. Ayrica bir dosya kabul edilmezse
           digerleri yine de ekleniyor.
           NOT: cokmeyi tamamen ONLEYEMEYIZ — ExtendScript'te bir host cokusu yakalanamaz.
           Bu duzenleme cokmeyi TESHIS EDILEBILIR ve KISMEN ZARARSIZ hale getiriyor. */
        var once = 0; try { once = root.children.numItems; } catch (eC0) { once = -1; }
        var hata = [], j;
        for (j = 0; j < alinacak.length; j++) {
            try { app.project.importFiles([alinacak[j]], true, root, false); }
            catch (eI) { hata.push(String(alinacak[j]).replace(/^.*[\\\/]/, "") + ": " + eI.toString()); }
        }
        var sonra = once; try { sonra = root.children.numItems; } catch (eC1) {}
        var kondu = (once < 0) ? (alinacak.length - hata.length) : (sonra - once);
        if (!kondu && hata.length) return "err:Ice aktarilamadi — " + hata[0];

        if (kondu <= 0) return "err:Premiere bu dosyalari proje ogesi olarak kabul etmedi";
        return "ok:" + kondu + " stil projeye eklendi" + (zaten ? (" (" + zaten + " zaten vardi)") : "");
    } catch (e) { return "err:" + e.toString(); }
}

// Projede ada gore oge arar (stil uygulamak icin).
function _projeOgesiBul(ad) {
    var sonuc = { it: null };
    try { _ogeAra(app.project.rootItem, String(ad), sonuc, 0); } catch (e) {}
    return sonuc.it;
}
function _ogeAra(bin, ad, sonuc, derinlik) {
    if (sonuc.it || derinlik > 4) return;
    var n = 0; try { n = bin.children.numItems; } catch (e0) { return; }
    for (var i = 0; i < n; i++) {
        var ch = null; try { ch = bin.children[i]; } catch (e1) { continue; }
        if (!ch) continue;
        var chAd = ""; try { chAd = String(ch.name); } catch (e2) {}
        if (chAd === ad) { sonuc.it = ch; return; }
        var t = -1; try { t = ch.type; } catch (e3) {}
        if (t === 2) { _ogeAra(ch, ad, sonuc, derinlik + 1); if (sonuc.it) return; }
    }
}
/* NOT: Bir zamanlar burada _captionStilUygula vardı — track'e erişip stil atamayı deneyen
   fonksiyon. KALDIRILDI çünkü dayandığı seq.captionTracks koleksiyonu Premiere'de YOK
   (ölçüldü). Stil adı yalnızca "projede var mı" kontrolü için çözülüyor; uygulamayı
   kullanıcı Premiere'de elle yapıyor. */

/* SRT'yi projeye alır ve caption track olarak timeline'a (0 anına) ekler.
   STİL: srtPath + ".stil" dosyası varsa içindeki ad, oluşan kanala uygulanmaya çalışılır.
   Stil adı parametre yerine DOSYADAN okunuyor — evalScript'in string literaline gömülen
   Türkçe karakter/tırnak kırılgan (panelin her yerinde aynı kural). */
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

        // Stil adi: SRT'nin yanindaki ".stil" dosyasindan (parametre degil dosya — bkz. ustteki not)
        var stilAdi = "";
        try { stilAdi = String(_readFileUTF8(srtPath + ".stil")).replace(/^\s+|\s+$/g, ""); } catch (eS) { stilAdi = ""; }
        var stilItem = null, stilNot = "";
        if (stilAdi) {
            stilItem = _projeOgesiBul(stilAdi);
            if (!stilItem) stilNot = "'" + stilAdi + "' projede bulunamadi";
        }

        /* Caption track olustur (0 anina). Farkli surumlerde imza degisebilir; sirayla dene.

           STIL OTOMATIK ATANAMIYOR — OLCULDU (5 Agustos 2026, Premiere 2026):
             · seq.captionTracks diye bir koleksiyon YOK; track olustuktan sonra ona erisip
               stil atamanin yolu kapali (videoTracks/audioTracks var, caption yok).
             · createCaptionTrack'e stili 3. ve 4. parametre olarak gecirmek de DENENDI,
               stil gelmedi.
           Belgelenmemis imzalara dayanan denemeler KALDIRILDI: tutmuyorlar ve 3. parametre
           baska bir seye (ör. format/dikey bayragi) denk gelirse sessiz bozulma riski var.
           Stil kullanici tarafindan elle veriliyor; panel sonuc mesajinda hangi kanala hangi
           stilin verilecegini yaziyor (bkz. app.js placeCaptions). */
        var olustu = false;
        if (typeof seq.createCaptionTrack === "function") {
            try { seq.createCaptionTrack(item, "0"); olustu = true; }
            catch (e1) {
                try { seq.createCaptionTrack(item, 0); olustu = true; }
                catch (e2) {
                    try {
                        var t = new Time(); t.ticks = "0";
                        seq.createCaptionTrack(item, t);
                        olustu = true;
                    } catch (e3) {
                        return "imported_only:Project panelinde. createCaptionTrack hata: " + e3.toString();
                    }
                }
            }
            if (olustu && stilItem && !stilNot) stilNot = "elle verilecek (Premiere script'ten izin vermiyor)";
        }
        if (!olustu) return "imported_only:Project panelinde (bu sürümde otomatik yerleştirme yok). Öğeyi timeline'a sürükle.";
        return "ok:Timeline'a eklendi" + (stilNot ? " [stil: " + stilNot + "]" : "");
    } catch (e) {
        return "err:" + e.toString();
    }
}

/* ================= TANILAMA: caption track'e stil ATANABILIR MI? =================
   CEVAP: HAYIR. Olculdu, Premiere 26.3.0, 6 Agustos 2026 — kullanicinin makinesinde.
   BULGU (uc yuzey de kapali):
     1. Normal DOM sequence: 15 ozellik / 42 metot. Caption'la ilgili TEK sey
        createCaptionTrack — bir YARATMA metodu. Geri okuma, listeleme, stil verme YOK.
        captionTracks · captions · captionTrack · getCaptionTrackCount · getCaptionTrackAt ·
        setCaptionTrackStyle · captionStyle -> hepsi "undefined".
     2. createCaptionTrack'in 3./4. parametresi (daha once olculdu): stili almiyor,
        HATA DA VERMIYOR — sessizce yok sayiyor.
     3. QE DOM sequence: 27 ozellik / 63 metot. getVideoTrackAt · getAudioTrackAt ·
        addTracks · removeTracks var ama caption gecen TEK metot bile yok. Premiere'in
        kendi ic arayuzu caption track'leri hic tanimiyor.
   SONUC: createCaptionTrack "yaz ve unut" bir cagri. Track olustuktan sonra ona erisim
   yok, dolayisiyla panel stili ATAYAMAZ. Stil kullanici tarafindan elle veriliyor; panel
   sonuc mesajinda hangi track'in kim oldugunu ve hangi stili bekledigini yaziyor.
   BIR DAHA DENEME — dorduncu bir yuzey yok. Tek teorik yol Premiere'in UXP API'si, o da
   panelin CEP'ten UXP'ye tasinmasi demek.

   FONKSIYON NEDEN DURUYOR: yeni bir Premiere surumunde caption API'si genisleyebilir.
   Arayuzden kaldirildi (kalici ozellik degil), DevTools'tan cagrilabilir:
     panel acikken http://localhost:8088 -> Console ->
     new CSInterface().evalScript("captionStilTani()", console.log)
   SALT OKUR: hicbir sey yaratmaz/degistirmez, QE'nin yazma metotlarini CAGIRMAZ (onlar
   Premiere'i cokertebiliyor). */
/* ---- reflect yardimcilari: tanilama fonksiyonlarinin ortak alt yapisi ----
   ExtendScript'in `reflect` nesnesi bir nesnenin GERCEK ozellik/metot listesini verir.
   "Su API var mi" sorusunun dogru cevabi budur: cagirip denemek yaniltici olabiliyor
   (Premiere tanimadigi parametreyi sessizce yutup "ok" donebiliyor), reflect yutmuyor. */
function _refAdlar(kol) {
    var a = [], i;
    if (!kol) return a;
    for (i = 0; i < kol.length; i++) {
        try { a.push(String(kol[i].name)); } catch (e) {}
    }
    a.sort();
    return a;
}
/* Tam liste uzun; gozle taramak hataya acik. Aranan kelimeleri iceren adlari one al. */
function _refIlginc(liste, anahtarlar) {
    var a = [], i, j, s;
    for (i = 0; i < liste.length; i++) {
        s = String(liste[i]).toLowerCase();
        for (j = 0; j < anahtarlar.length; j++) {
            if (s.indexOf(anahtarlar[j]) !== -1) { a.push(liste[i]); break; }
        }
    }
    return a;
}
function _refListele(out, baslik, nesne, anahtarlar) {
    out.push("");
    out.push("=== " + baslik + " ===");
    if (!nesne) { out.push("(nesne yok)"); return; }
    var ps = [], ms = [];
    try {
        ps = _refAdlar(nesne.reflect.properties);
        ms = _refAdlar(nesne.reflect.methods);
    } catch (e) { out.push("reflect okunamadi: " + e.toString()); return; }
    var iP = _refIlginc(ps, anahtarlar), iM = _refIlginc(ms, anahtarlar);
    out.push(">> ILGINC ozellik: " + (iP.length ? iP.join(", ") : "(yok)"));
    out.push(">> ILGINC metot  : " + (iM.length ? iM.join(", ") : "(yok)"));
    out.push("tum ozellikler (" + ps.length + "): " + ps.join(", "));
    out.push("tum metotlar (" + ms.length + "): " + ms.join(", "));
}

function captionStilTani() {
    var out = [];
    var ANAHTAR = ["caption", "style", "subtitle", "track"];
    function yaz(s) { out.push(String(s)); }

    try { yaz("Premiere surum: " + app.version); } catch (eV) { yaz("surum okunamadi"); }

    var seq = null;
    try { seq = app.project.activeSequence; } catch (eS) {}
    if (!seq) {
        yaz("UYARI: aktif sekans yok. Premiere'de bir sekans ac ve tekrar bas.");
        return out.join("\n");
    }

    _refListele(out, "Sequence (normal DOM)", seq, ANAHTAR);

    /* Belgelenmemis ama bazi surumlerde var olabilen adlar — SADECE varlik testi,
       cagirma yok. typeof "undefined" donerse o ad gercekten yok demektir. */
    yaz("");
    yaz("=== Dogrudan varlik testi (sequence) ===");
    var denemeler = ["captionTracks", "captions", "captionTrack", "getCaptionTrackCount",
                     "getCaptionTrackAt", "setCaptionTrackStyle", "captionStyle"];
    var d, tip;
    for (d = 0; d < denemeler.length; d++) {
        try { tip = typeof seq[denemeler[d]]; } catch (eD) { tip = "erisimde hata"; }
        yaz("seq." + denemeler[d] + " -> " + tip);
    }

    /* QE DOM — belgelenmemis ic arayuz. Yalniz reflect okunuyor. */
    try {
        if (typeof app.enableQE === "function") {
            app.enableQE();
            var qs = null;
            try { qs = qe.project.getActiveSequence(); }
            catch (eQ1) { yaz(""); yaz("qe.project.getActiveSequence hata: " + eQ1.toString()); }
            _refListele(out, "QE Sequence", qs, ANAHTAR);
        } else {
            yaz("");
            yaz("app.enableQE yok — QE DOM bu surumde kapali.");
        }
    } catch (eQ) {
        yaz("");
        yaz("QE acilamadi: " + eQ.toString());
    }
    return out.join("\n");
}

/* ================= TANILAMA: SECILI klibe panelden preset/efekt uygulanabilir mi? =========
   HEDEF: kullanici Premiere'de bir klip seciyor, panelde bir dugmeye basiyor, "Pop In" gibi
   bir efekt preseti o klibe uygulaniyor (Effects panelinden surukleme yerine).
   NE BILINIYOR: seq.getSelection() normal DOM'da VAR (captionStilTani dokumunde goruldu),
   yani panel neyin secili oldugunu okuyabiliyor. EKSIK olan, secili klibe preset/efekt
   uygulayan metot.
   BU FONKSIYON UC YERE BAKAR:
     1. Secili TrackItem + components koleksiyonu — DOM'da yazma yolu var mi.
     2. qe.project — QE'de efekt/preset arayan bir metot var mi (or. getVideoEffectByName).
     3. QE TrackItem — klibe efekt EKLEYEN bir metot var mi (or. addVideoEffect).
   Preset'e ozel bir API cikmazsa yedek plan: efekti uygulayip keyframe'leri panelin
   kendisi yazmasi — bunun icin Component.properties yazilabilir olmali, o yuzden
   Component[0] de dokuluyor.
   SALT OKUR. Hicbir sey uygulamaz/degistirmez; QE'nin yazma metotlari CAGRILMAZ. */
function presetTani() {
    var out = [];
    var ANAHTAR = ["preset", "effect", "efekt", "component", "apply", "add", "match", "param", "key"];
    function yaz(s) { out.push(String(s)); }

    try { yaz("Premiere surum: " + app.version); } catch (eV) { yaz("surum okunamadi"); }

    var seq = null;
    try { seq = app.project.activeSequence; } catch (eS) {}
    if (!seq) {
        yaz("UYARI: aktif sekans yok. Premiere'de bir sekans ac ve tekrar bas.");
        return out.join("\n");
    }

    /* --- 1) SECIM: panel neyi goruyor? --- */
    yaz("");
    yaz("=== Secim (seq.getSelection) ===");
    var sec = null;
    try { sec = seq.getSelection(); }
    catch (eSel) { yaz("getSelection HATA: " + eSel.toString()); }
    if (!sec) yaz("getSelection null dondu");
    else {
        yaz("secili oge sayisi: " + sec.length);
        if (!sec.length) {
            yaz("UYARI: timeline'da hicbir klip secili degil.");
            yaz("       Bir klip secip TEKRAR bas — secili klip olmadan asil olcum yapilamaz.");
        } else {
            try { yaz("ilk secili klip: " + sec[0].name); } catch (eN) {}
            _refListele(out, "Secili TrackItem (normal DOM)", sec[0], ANAHTAR);
            /* components = klibe uygulanmis efektler. Buraya EKLEME yolu var mi? */
            try {
                var comp = sec[0].components;
                yaz("");
                yaz("components.numItems: " + comp.numItems);
                _refListele(out, "ComponentCollection", comp, ANAHTAR);
                if (comp.numItems > 0) {
                    _refListele(out, "Component[0] (" + String(comp[0].displayName) + ")", comp[0], ANAHTAR);
                    /* Yedek plan buna dayaniyor: efekt parametreleri yazilabilir mi,
                       keyframe eklenebiliyor mu? */
                    try {
                        var pr = comp[0].properties;
                        yaz("Component[0].properties.numItems: " + pr.numItems);
                        if (pr.numItems > 0)
                            _refListele(out, "ComponentParam[0] (" + String(pr[0].displayName) + ")", pr[0], ANAHTAR);
                    } catch (eP) { yaz("properties okunamadi: " + eP.toString()); }
                }
            } catch (eC) { yaz("components okunamadi: " + eC.toString()); }
        }
    }

    /* --- 2) ve 3) QE DOM --- */
    try {
        if (typeof app.enableQE !== "function") { yaz(""); yaz("app.enableQE yok."); return out.join("\n"); }
        app.enableQE();
        _refListele(out, "qe.project", qe.project, ANAHTAR);

        var qs = qe.project.getActiveSequence();
        /* Ornek bir QE klibi bul — aranan sey METOT LISTESI, hangi klip oldugu onemsiz. */
        var qc = null, t, k, qt, it, ad;
        for (t = 0; t < qs.numVideoTracks && !qc; t++) {
            try { qt = qs.getVideoTrackAt(t); } catch (eT) { continue; }
            for (k = 0; k < 50; k++) {
                it = null;
                try { it = qt.getItemAt(k); } catch (eI) { break; }
                if (!it) break;
                ad = "";
                try { ad = String(it.name); } catch (eAd) { ad = ""; }
                if (ad) { qc = it; break; }
            }
        }
        if (!qc) yaz("(QE'de ornek klip bulunamadi — video kanallarinda klip yok mu?)");
        _refListele(out, "QE TrackItem (ornek klip)", qc, ANAHTAR);
    } catch (eQ) { yaz(""); yaz("QE hata: " + eQ.toString()); }

    return out.join("\n");
}

/* ================= SECILI KLIPLERE ANIMASYON =================
   OLCULDU (Premiere 26.3.0, 6 Agustos 2026 — presetTani dokumu):
     · Kullanicinin .prfpset PRESETLERI script'ten OKUNAMIYOR. Ne normal DOM'da ne
       qe.project'te preset metodu var (getVideoEffectByName/getVideoEffectList VAR,
       preset karsiligi YOK). Kaydedilmis preset dosyasini uygulama yolu kapali.
     · AMA ComponentParam tamamen YAZILABILIR: addKey · setValueAtKey · setTimeVarying ·
       setInterpolationTypeAtKey · removeKey. Keyframe API'sinin tamami acik.
     · Ve her klipte Motion + Opacity bilesenleri ZATEN var — efekt eklemeye gerek yok.
   BU YUZDEN: animasyon preset dosyasindan degil, buradaki koddan uretiliyor.
     Bedeli : kullanici kendi presetini kullanamiyor, animasyon burada tarif ediliyor.
     Kazanci: preset dosyasina bagimli degil — baska makinede, temiz kurulumda calisir.
   QE'nin addVideoEffect'i SIMDILIK GEREKMIYOR (Motion/Opacity hazir geliyor); yeni bir
   animasyon ek efekt isterse o zaman devreye girer. */

/* NOT: burada bir zamanlar _bilesenAra (bileseni ADIYLA bulan) vardi. KALDIRILDI —
   klip turune gore bilesen adlari ve sirasi degistigi icin kirilgandi ve .webp'te
   patladi. Yerine _paramAraTum geldi: parametreyi butun bilesenlerde ariyor. */

/* ComponentParam'da matchName YOK (olculdu) — yalniz displayName ile aranabiliyor. */
function _paramAra(bilesen, adlar) {
    var p = bilesen.properties, i, j, dn;
    for (i = 0; i < p.numItems; i++) {
        dn = "";
        try { dn = String(p[i].displayName || ""); } catch (e) { continue; }
        for (j = 0; j < adlar.length; j++) if (dn === adlar[j]) return p[i];
    }
    return null;
}
/* Keyframe zamani bazi surumlerde saniye (sayi), bazilarinda Time nesnesi bekliyor.
   Ikisi de denenir. DONUS DEGERI SART: hangisinin tuttugu disaridan belli olmuyor ve
   sessizce basarisiz olan bir keyframe "animasyon uygulandi" yalanina donusur. */
var TICK_SN = 254016000000;   // Premiere: 1 saniye = 254016000000 tick

/* Zaman nesnesi TICKS ile kurulur — `seconds` SALT OKUNUR olabiliyor ve sessizce 0
   birakiyor. Sonuc: butun keyframe'ler 0 anina yigiliyor, tek keyframe gibi gorunuyor ve
   animasyon olusmuyordu (kullanici bildirdi: "presette birden fazla, bizimkinde bir tane").
   Ayni sebep "timeline'in basindaki klipte calisiyor, baska yerde calismiyor" belirtisini
   de aciklıyor: 0 ani orada tesadufen dogru yerdi.
   Projenin baska yeri de ticks kullaniyor (addCaptionsToTimeline).
   KURDUKTAN SONRA DOGRULANIR: tutmadiysa null doner ve sayi yolu denenir. */
function _zamanNesnesi(sn) {
    var t = null;
    try {
        t = new Time();
        t.ticks = String(Math.round(sn * TICK_SN));
        var geri = _zamanSn(t);
        if (isNaN(geri) || Math.abs(geri - sn) > 0.01) t = null;
    } catch (e) { t = null; }
    return t;
}
/* ---- KEYFRAME TEMIZLIGI ----
   Basarisiz denemeler klipte COP keyframe birakiyordu: addKey istenen zamani kabul etmeyip
   klip sinirina KIRPIYOR (istisna atmadan). Dort strateji denemesi + iki taban denemesi
   ust uste ayni sinira coktugu icin geriye TEK keyframe kaliyordu — kullanicinin bildirdigi
   "13 keyframe diyor, klipte bir tane var" semptomunun birebir kaynagi.
   snapshot -> dene -> snapshot'ta olmayanlari geri al. */
function _keySnapshot(pr) {
    var a = [], kk = null, q, s;
    try { kk = pr.getKeys(); } catch (e) { return null; }   // null = OKUNAMADI (dokunma)
    if (!kk) return a;
    for (q = 0; q < kk.length; q++) { s = _zamanSn(kk[q]); if (!isNaN(s)) a.push(s); }
    return a;
}
function _keyGeriAl(pr, onceki) {
    if (!onceki) return;                       // snapshot okunamadiysa RISK ALMA
    var tur, kk, q, w, s, eskiVar, silindi;
    /* TAVAN 200 DEGIL: egri ornekleme (baking) ile bir parametreye ORNEK_MAX kadar keyframe
       yazilabiliyor. 200'de durmak, basarisiz bir denemeden sonra klipte yuzlerce COP
       keyframe birakirdi — tam da bu fonksiyonun onlemek icin yazildigi sey. */
    for (tur = 0; tur < ORNEK_MAX + 64; tur++) {   // silme listeyi bozuyor: her turda yeniden oku
        kk = null; try { kk = pr.getKeys(); } catch (e0) { return; }
        if (!kk || !kk.length) return;
        silindi = false;
        for (q = 0; q < kk.length; q++) {
            s = _zamanSn(kk[q]);
            if (isNaN(s)) continue;
            eskiVar = false;
            for (w = 0; w < onceki.length; w++) {
                if (Math.abs(onceki[w] - s) < 0.005) { eskiVar = true; break; }
            }
            if (eskiVar) continue;
            /* removeKey'e getKeys'ten gelen NESNE gecilir: kirpilmis key'in GERCEK zamani
               bizim istedigimizden farkli, istenen zamanla silme iskaliyor. */
            try { pr.removeKey(kk[q]); silindi = true; } catch (e1) {}
            break;
        }
        if (!silindi) return;
    }
}

/* ---- YAZMA STRATEJISI: TAHMIN DEGIL DENEME ----
   Premiere'in keyframe API'si iki noktada belgelenmemis VE sessizce basarisiz oluyor:
     1. ZAMAN BICIMI : addKey duz saniye (sayi) mi bekliyor, Time nesnesi mi?
     2. ZAMAN TABANI : KAYNAK MEDYA zamani mi (clip.inPoint + t), sekans mi, klip-yerel mi?
   Adobe belgeleri kaynak medya zamanini soyluyor (inPoint tabani) ve resim/still ogelerde
   inPoint 3600 sn olabiliyor — bu taban denenmedigi surece HICBIR keyframe dogru yere
   konmuyor, hepsi klip sinirina kirpiliyor.
   ARALIK SARTI SART: geri okuma tek basina TOTOLOJI — addKey ve getKeys ayni tabani
   kullandigi icin yanlis tabanla yazilan key ayni yanlis tabanla geri okunur ve "tuttu"
   sanilir. Ancak okunan zamanin KLIP ARALIGINDA olup olmadigina bakmak ayirt edicidir. */
function _keyDene(pr, sn, bicim, arAlt, arUst) {
    var z = (bicim === "time") ? _zamanNesnesi(sn) : sn;
    if (z === null || z === undefined) return false;
    var snap = _keySnapshot(pr);
    try { pr.addKey(z); } catch (e1) { _keyGeriAl(pr, snap); return false; }
    var kk = null; try { kk = pr.getKeys(); } catch (e2) { _keyGeriAl(pr, snap); return false; }
    var bulundu = false, q, s, w, eski;
    if (kk) {
        for (q = 0; q < kk.length; q++) {
            s = _zamanSn(kk[q]);
            if (isNaN(s) || Math.abs(s - sn) >= 0.02) continue;
            if (s < arAlt - 0.02 || s > arUst + 0.02) continue;   // KLIP ARALIGI SARTI
            /* ⚠ KEY ZATEN ORADAYSA BU BIR OLCUM DEGIL. Aralik sarti yanlis TABANI eliyor ama
               "key zaten vardi" durumunu elemiyordu: snapshot okunuyor olmasina ragmen yalniz
               TEMIZLIK icin kullaniliyor, basari testinde hic sorgulanmiyordu. Sonuc: addKey
               hicbir sey yapmasa bile _keyDene true donuyor.
               Gercek senaryo: kullanici preset'i bir klibe uygular (calisir), begenmez, AYNI
               klibe ikinci kez basar. Ikinci basista parametrede birinci uygulamanin
               keyframe'leri duruyor; ornekleme 30 fps'te key'leri 0.033 sn arayla koydugu ve
               buradaki tolerans 0.02 oldugu icin probe zamani buyuk olasilikla var olan bir
               key'e denk geliyor. Yanlis olcum klip basina BIR KEZ yapilip (strateji.olculdu)
               o klipteki butun parametrelere dayatildigi icin geri alinamiyor ve sonraki butun
               yazimlar sessizce dusuyordu. Kullanicinin gordugu belirti: "ilk seferde oldu,
               ayni klibe tekrar basinca hic olmuyor".
               Tolerans 0.005 = _keyGeriAl'inkiyle AYNI olmali, yoksa "eski" saydigimiz key'i
               geri alma da tutarsiz olur. snap null ise (getKeys okunamadi) eski davranis.
               Yanlis-negatif zararsiz: strateji olculemezse _paramlariYaz'daki aday dongusu
               bicim=null ile calisiyor ve hicbir aday kaybolmuyor — yalniz klip basina bir
               kezlik strateji kazanimi kaybolur. */
            if (snap) {
                eski = false;
                for (w = 0; w < snap.length; w++) {
                    if (!isNaN(snap[w]) && Math.abs(snap[w] - s) < 0.005) { eski = true; break; }
                }
                if (eski) continue;
            }
            bulundu = true; break;
        }
    }
    _keyGeriAl(pr, snap);   // basarili da olsa basarisiz da olsa COP BIRAKMA
    return bulundu;
}
/* adaylar: [{ baz, arAlt, arUst, ad }] — ofs, gercek keyframe'lerin ORTASINA denk gelen
   goreli an. Sabit 0.25 kullanmak yanlisti: capa="son" presetlerinde gercek yazimlar
   NEGATIF ofsetle klibin icine duserken probe klip bitisinin 0.25 sn SONRASINI deniyordu
   (yazmanin ters yonu) ve dort kombinasyon da bosuna basarisiz oluyordu. */
function _stratejiOlc(pr, adaylar, ofs) {
    var bicimler = ["sayi", "time"], b, f, dz, a;
    for (b = 0; b < adaylar.length; b++) {
        a = adaylar[b];
        if (!a || a.baz === null || a.baz === undefined) continue;
        dz = a.baz + ofs;
        if (dz < a.arAlt - 0.001 || dz > a.arUst + 0.001) continue;   // aralik disi: DENEME
        for (f = 0; f < bicimler.length; f++) {
            if (_keyDene(pr, dz, bicimler[f], a.arAlt, a.arUst)) {
                return { baz: a.baz, bicim: bicimler[f], ad: a.ad, arAlt: a.arAlt, arUst: a.arUst };
            }
        }
    }
    return null;
}
/* KEYFRAME INTERPOLASYONU (yumusatma) — best-effort.
   ARASTIRILDI (6 Agustos 2026, Adobe forumu + calisan onayi): Premiere'de keyframe
   interpolasyon tipini OKUYAN bir API YOK — yalniz setInterpolationTypeAtKey (SET) var,
   getInterpolationTypeAtKey (GET) YOK (Adobe calisani dogruladi). Yani kaynak preset'in
   GERCEK egrisi presetOkuJSON'da CEKILEMIYOR; yapabildigimiz tek sey yazarken sabit bir
   yumusatma (Bezier) uygulamak. Cogu pop/zoom preset'i ease'li oldugu icin bu, duz
   lineer'den gozle cok daha yakin durur — ama BIREBIR degil (bir Premiere API siniri).
   GERI OKUMA MUMKUN DEGIL (getter yok) -> basari sayimina KATILMAZ: tutmazsa sessizce
   lineer kalir, keyframe zaten ayri dogrulaniyor (bkz. _yazVeSay). Enum surume bagli
   (2020'de 0/1 disi bug'liydi, 22.x'te duzeldi): Bezier=5, Hold=4. 26.3.0'da test edilmeli. */
var KF_BEZIER = 5;
/* ⚠ "HEPSINE BEZIER" DENENDI VE GERI ALINDI — ARAMA (kullanici olctu, 6 Agustos 2026).
   setInterpolationTypeAtKey(z, 5) TUTUYOR ama tutamaklar (handle) DUZ geliyor: her
   keyframe'de hiz SIFIRA dusuyor, animasyon dur-kalk-dur oluyor. Kullanicinin Effect
   Controls olcumu: kaynak "Velocity: 22,6/second" (keyframe'in icinden AKIYOR), kopya
   "Velocity: 0,0/second" (duruyor) — lineer'den bile kotu. Tutamak degerlerini yazan API
   YOK, yani egri tipini zorlamak cozum degil. Cozum egriyi ORNEKLEMEK (bkz. _egriOrnekle).
   Bu yuzden VARSAYILAN ARTIK "DOKUNMA" (-1): keyframe Premiere'in varsayilaniyla (lineer)
   kalir ve sekli ornek siklig'i tasir. Fonksiyon duruyor: ileride tutamak API'si gelirse
   ya da olculmus bir tip kaydedilirse giris noktasi burasi. */
function _keyInterpUygula(param, z, interp) {
    var tip = (interp === null || interp === undefined) ? -1 : interp;
    if (tip < 0) return;   // -1 = DOKUNMA (varsayilan)
    try { param.setInterpolationTypeAtKey(z, tip, true); } catch (e) {}
}
function _keyEkleD(param, sn, deger, bicim, interp) {
    if (bicim) {
        var z = (bicim === "time") ? _zamanNesnesi(sn) : sn;
        if (z === null || z === undefined) return "zaman kurulamadi";
        try { param.addKey(z); } catch (eA) { return "addKey(" + String(eA) + ")"; }
        try { param.setValueAtKey(z, deger, true); }
        catch (eB) { return "setValueAtKey(" + String(eB) + ")"; }
        _keyInterpUygula(param, z, interp);   // best-effort; basariyi ETKILEMEZ
        return "";
    }
    return _keyEkleDEski(param, sn, deger, interp);
}
function _keyEkleDEski(param, sn, deger, interp) {
    /* Time nesnesi ONCE denenir. Sayi yolu belirsiz: addKey(0.4) bazi surumlerde 0.4
       SANIYE, bazilarinda 0.4 TICK (~0 saniye) demek — ikincisi sessizce her key'i
       basa yigiyor. Time nesnesinde boyle bir belirsizlik yok. */
    var t = _zamanNesnesi(sn);
    /* addKey ile setValueAtKey AYRI degerlendirilir. Eskiden ikisi tek try icindeydi:
       addKey tutup setValueAtKey patlayinca ikisi birden basarisiz sayiliyor, sonra Time
       ile tekrar deneniyor ve bu kez "keyframe zaten var" diye o da patliyordu — sonuc
       "hicbir parametre yazilamadi" iken keyframe'ler aslinda konmustu. */
    var eklendi = null, h1 = "", h2 = "";
    if (t) { try { param.addKey(t); eklendi = t; } catch (e1) { h1 = String(e1); } }
    if (!eklendi) { try { param.addKey(sn); eklendi = sn; } catch (e2) { h2 = String(e2); } }
    if (eklendi === null) return "addKey(" + (h1 || h2 || "zaman kurulamadi") + ")";
    try { param.setValueAtKey(eklendi, deger, true); }
    catch (e3) { return "setValueAtKey(" + String(e3) + ")"; }
    _keyInterpUygula(param, eklendi, interp);   // best-effort; basariyi ETKILEMEZ
    return "";
}
// Yaz VE geri oku. _popIn yolu da artik bunu kullaniyor (eskiden yalniz istisnaya bakiyordu).
function _keyVarMi(param, sn) {
    var kk = null, q, s;
    try { kk = param.getKeys(); } catch (e) { return false; }
    if (!kk) return false;
    for (q = 0; q < kk.length; q++) {
        s = _zamanSn(kk[q]);
        if (!isNaN(s) && Math.abs(s - sn) < 0.02) return true;
    }
    return false;
}
function _keyEkle(param, sn, deger) {
    if (_keyEkleD(param, sn, deger, null) !== "") return false;
    return _keyVarMi(param, sn);
}

/* Parametreyi TUM bilesenlerde ara.
   NEDEN: once "Motion" adli bileseni bulup icinde Scale araniyordu. Bu KIRILDI — klip
   turune gore (resim/.webp, MOGRT, ayarlama katmani) bilesen adlari ve SIRASI degisiyor.
   Olculdu: Ates.webp'te Component[0] Opacity'ydi, Motion degil. Artik bilesenin adina
   hic bakilmiyor, aranan PARAMETRE her bilesende aranıyor — "her seye uygulanabilsin"
   istegi tam olarak bunu gerektiriyor. */
function _paramAraTum(ti, adlar) {
    var c = ti.components, i, p;
    for (i = 0; i < c.numItems; i++) {
        p = null;
        try { p = _paramAra(c[i], adlar); } catch (e) {}
        if (p) return p;
    }
    return null;
}
/* ⚠ IKI PARAMETREYI TEK YURUYUSTE BUL — emoji yerlestirmenin sicak yolu.
   Position ve Scale AYNI "Motion" bileseninde duruyor ama `_paramAraTum` iki kez
   cagrildiginda bilesen/ozellik agaci BASTAN iki kez geziliyordu: klip basina iki tam
   yuruyus (~17 Premiere erisimi) ve 206 emojide ~3.500 gereksiz cagri.
   Burada agac BIR kez geziliyor; bir bilesende iki adin ikisi de aranıyor ve ikisi de
   bulununca erken cikiliyor. Donus: [p1, p2] (bulunamayan null).
   ⚠ Ikisi FARKLI bilesenlerde olsa bile dogru calisir — tarama ikisi de dolana kadar
   surer, yalnizca erken cikis kacar. */
function _paramAraIki(ti, adlar1, adlar2) {
    var c = null, i, p1 = null, p2 = null;
    try { c = ti.components; } catch (eC) { return [null, null]; }
    if (!c) return [null, null];
    var n = 0; try { n = c.numItems; } catch (eN) { return [null, null]; }
    for (i = 0; i < n; i++) {
        var bil = null;
        try { bil = c[i]; } catch (eB) { continue; }
        if (!p1) { try { p1 = _paramAra(bil, adlar1); } catch (e1) {} }
        if (!p2) { try { p2 = _paramAra(bil, adlar2); } catch (e2) {} }
        if (p1 && p2) break;
    }
    return [p1, p2];
}
/* Hata mesaji icin: klipte hangi bilesen VE hangi parametreler var. Tek turda teshis —
   "olmadi" deyip kullaniciyi ikinci bir olcume yollamamak icin. */
function _icerikDokumu(ti) {
    var c = ti.components, a = [], i, j, ps, pa, sat;
    for (i = 0; i < c.numItems; i++) {
        sat = "?";
        try { sat = String(c[i].displayName); } catch (e0) {}
        try {
            ps = c[i].properties; pa = [];
            for (j = 0; j < ps.numItems; j++) {
                try { pa.push(String(ps[j].displayName)); } catch (e1) {}
            }
            if (pa.length) sat += "(" + pa.join("/") + ")";
        } catch (e2) {}
        a.push(sat);
    }
    return a.join(" · ");
}

/* Klibin SEKANSTAKI baslangic saniyesi.
   ÖLÇÜLDÜ (kullanici, 6 Agustos 2026): keyframe zamanlari KLIBE GORE DEGIL SEKANSA gore.
   Kanit: timeline'in basindaki video klibinde Pop In calisti, daha ileride baslayan
   Ates.webp'te "uygulandi" dedi ama gorunmedi — cunku 0..0.4 sn'ye yazilan keyframe'ler
   o klibin ONCESINE dusuyordu. Bu yuzden butun zamanlar bu degerle otelenir. */
function _klipBas(ti) {
    var b = NaN;
    try { b = _zamanSn(ti.start); } catch (e0) {}
    return isNaN(b) ? 0 : b;
}
/* KAYNAK MEDYA baslangici (inPoint). Adobe belgelerine gore ComponentParam keyframe
   zamani KAYNAK MEDYA zamanidir: clip.inPoint.seconds + istenen an. Kirpilmis her klipte
   (AutoCut'tan gecen hepsi) ve resim/still ogelerde (inPoint 3600 sn olabiliyor) bu taban
   sekans zamanindan da klip-yerel sifirdan da FARKLI. Denenmedigi surece hicbir keyframe
   dogru yere konmuyordu. */
function _klipKaynakBas(ti) {
    var b = NaN;
    try { b = _zamanSn(ti.inPoint); } catch (e0) {}
    return isNaN(b) ? 0 : b;
}

function _popIn(ti, sure) {
    var sc = _paramAraTum(ti, ["Scale", "Olcek", "Ölçek", "Uniform Scale"]);
    var opp = _paramAraTum(ti, ["Opacity", "Opaklik", "Opaklık"]);
    /* IKISI DE yoksa gercekten yapacak bir sey yok (ses klibi vb.). Hata mesajina klibin
       ICERIGI yaziliyor: bir sonraki tur icin tahmine gerek kalmasin. */
    if (!sc && !opp) return "olcek/opaklik parametresi yok — icerik: " + _icerikDokumu(ti);

    var t0 = _klipBas(ti);          // klibin sekanstaki baslangici
    var yazildi = 0;
    if (sc) {
        try { sc.setTimeVarying(true); } catch (eT) {}
        /* 0 -> 112 -> 100: klasik "pop". Ortadaki asma (overshoot) olmadan cansiz duruyor. */
        if (_keyEkle(sc, t0, 0)) {
            _keyEkle(sc, t0 + sure * 0.55, 112);
            _keyEkle(sc, t0 + sure, 100);
            yazildi++;
        }
    }
    // Opaklik tek basina da anlamli: olcek yoksa en azindan yumusak giris olur.
    if (opp) {
        try { opp.setTimeVarying(true); } catch (eT2) {}
        if (_keyEkle(opp, t0, 0)) { _keyEkle(opp, t0 + sure * 0.3, 100); yazildi++; }
    }
    if (!yazildi) return "keyframe yazilamadi (zaman birimi tutmadi) — icerik: " + _icerikDokumu(ti);
    return "ok";
}

/* ---- KULLANICININ KENDI PRESETLERI ----
   OLCULDU: qe.project'te preset'e OZEL metot yok. Geriye tek ihtimal kaldi — kullanicinin
   Effects > Presets altina kaydettigi ogelerin, efekt listesine karisiyor olmasi.
   Bu fonksiyon o soruyu cevapliyor: liste kullanicinin preset adlarini iceriyorsa panel
   onlari dogrudan uygulayabilir; icermiyorsa preset yolu kesin kapali demektir. */
function efektListesiJSON() {
    try {
        if (typeof app.enableQE !== "function") return JSON.stringify({ ok: false, hata: "QE bu surumde yok" });
        app.enableQE();
        var lv = null;
        try { lv = qe.project.getVideoEffectList(); }
        catch (e1) { return JSON.stringify({ ok: false, hata: "getVideoEffectList: " + e1.toString() }); }
        if (!lv) return JSON.stringify({ ok: false, hata: "liste bos dondu" });
        var ad = [], i, x, s;
        for (i = 0; i < lv.length; i++) {
            s = "";
            /* Liste bazi surumlerde duz string, bazilarinda .name'li nesne dondurur. */
            try { x = lv[i]; s = (x && x.name) ? String(x.name) : String(x); } catch (e2) { s = ""; }
            ad.push(s);   // BOSLARI DA KORU: sira numarasi ham listeyle birebir kalmali
        }
        /* SIRALAMA YOK — bilerek. Panel efekti ADIYLA degil SIRA NUMARASIYLA istiyor
           (evalScript string literaline Turkce karakter/tirnak gommemek icin), o yuzden
           buradaki sira ham getVideoEffectList() sirasiyla ayni kalmak ZORUNDA.
           Gorunum sirasini panel kendi tarafinda yapiyor. */
        return JSON.stringify({ ok: true, efektler: ad });
    } catch (e) { return JSON.stringify({ ok: false, hata: e.toString() }); }
}

/* DOM'daki secili klibin QE karsiligini bul. QE'de "secili" bilgisi YOK, bu yuzden
   AYNI TRACK + AYNI BASLANGIC ZAMANI ile eslestiriliyor.
   EMIN OLAMAZSA null DONER — yanlis klibe efekt uygulamaktansa hata vermek yegdir;
   yanlis klip sessizce bozulur ve kullanici ancak videoyu izlerken fark eder. */
/* Zaman nesnesinden saniye. QE ve normal DOM ayni alan adini kullanmiyor (.secs / .seconds),
   surumden surume de degisebiliyor — hepsini dene, biri tutsun. */
function _zamanSn(x) {
    var s = NaN, tk;
    if (x === null || x === undefined) return NaN;
    try { s = parseFloat(x.secs); } catch (e0) {}
    if (isNaN(s)) { try { s = parseFloat(x.seconds); } catch (e1) {} }
    /* ticks YEDEGI: `secs`/`seconds` her surumde/nesnede olmayabiliyor. ticks Premiere'in
       kanonik zaman alani (1 sn = 254016000000 tick) ve string olarak geliyor. Bu yedek
       olmadan okunamayan keyframe SESSIZCE atlaniyordu. */
    if (isNaN(s)) {
        try { tk = parseFloat(x.ticks); if (!isNaN(tk)) s = tk / TICK_SN; } catch (e2) {}
    }
    if (isNaN(s)) { try { s = parseFloat(String(x)); } catch (e3) {} }
    return s;
}
function _qeKlipBul(qs, domItem) {
    var ti = -1, bas = NaN, ad = "";
    try { ti = parseInt(domItem.parentTrackIndex, 10); } catch (e0) { return null; }
    if (isNaN(ti)) return null;
    bas = _zamanSn(domItem.start);
    try { ad = String(domItem.name); } catch (e1) { ad = ""; }
    var qt = null;
    try { qt = qs.getVideoTrackAt(ti); } catch (e2) { return null; }
    if (!qt) return null;
    /* TAVAN 500 DEGIL 20000 — ve IKI GECIS.
       ESKI HALI: yalniz ilk 500 klibe bakiliyordu. AutoCut'tan gecen 20 dakikalik videoda
       bir kanalda 500'den fazla klip oluyor ve videonun IKINCI YARISINDAKI klipler
       "QE karsiligi bulunamadi" veriyordu — kullaniciya tamamen rastgele gorunen bir
       davranis ("basinda calisiyor, sonunda calismiyor"). Ustelik eslesme bulunsa bile
       dongu 500 tur donuyordu; 20 kliplik secimde 10.000 gereksiz cagri.
       1. GECIS (hizli): QE ogeleri zaman sirasinda geldigi icin hedefi 0.05 sn'den fazla
          GECINCE dur. Tipik olarak birkac tur.
       2. GECIS (yedek): yalniz 1. gecis bulamazsa ad eslesmesi icin tam tarama. */
    var k, it, s, adAday = null, adSayi = 0, TAVAN = 20000;
    /* 1) Zaman eslesmesi. Tolerans BIR KAREDEN biraz genis (0.05 sn): QE ve DOM
       zamanlari tam ayni tick'e yuvarlanmayabiliyor ve 0.002 sn'lik eski tolerans
       eslesmeyi kacirip efektin hic eklenmemesine yol aciyordu. */
    if (!isNaN(bas)) {
        for (k = 0; k < TAVAN; k++) {
            it = null;
            try { it = qt.getItemAt(k); } catch (e3) { break; }
            if (!it) break;
            s = _zamanSn(it.start);
            if (isNaN(s)) continue;
            if (Math.abs(s - bas) < 0.05) return it;
            if (s > bas + 0.05) break;      // zaman sirasi: bundan sonrasi hep daha ileride
        }
    }
    // 2) Yedek: ayni track'te ayni adli TEK klip varsa o. Birden coksa kullanma.
    if (!ad) return null;
    for (k = 0; k < TAVAN; k++) {
        it = null;
        try { it = qt.getItemAt(k); } catch (e5) { break; }
        if (!it) break;
        var qad = ""; try { qad = String(it.name); } catch (e4) {}
        if (qad === ad) { adAday = it; adSayi++; if (adSayi > 1) return null; }
    }
    return (adSayi === 1) ? adAday : null;
}

/* Efekti/preseti SECILI kliplere uygular (QE addVideoEffect).
   PARAMETRE AD DEGIL SIRA NUMARASI: evalScript string literaline gomulen Turkce
   karakter/tirnak/ters bolu kirilgan (panelin her yerinde ayni kural). Panel yalniz
   sayi gonderiyor, adi host kendi tarafinda okuyor — kodlama riski sifir. */
function efektUygula(sira) {
    // Undo grubu: cok klip secildiyse tek Ctrl+Z hepsini geri alsin.
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Efekt"); _ug = true; } catch (eug) {}
    try {
        var i = parseInt(sira, 10);
        if (isNaN(i) || i < 0) return "err:Gecersiz preset numarasi";
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var sec = null;
        try { sec = seq.getSelection(); } catch (eS) { return "err:Secim okunamadi: " + eS.toString(); }
        if (!sec || !sec.length) return "err:Timeline'da klip secili degil. Bir klip sec ve tekrar bas.";
        if (typeof app.enableQE !== "function") return "err:QE bu surumde yok";
        app.enableQE();

        var lv = null;
        try { lv = qe.project.getVideoEffectList(); } catch (eL) {}
        if (!lv || i >= lv.length) return "err:Preset listede yok — liste degismis olabilir, 'Listeyi Yenile'ye bas";
        var ham = lv[i], ef = null, efAd = "";
        try { efAd = (ham && ham.name) ? String(ham.name) : String(ham); } catch (eN0) {}
        // Liste ogesi zaten efekt nesnesi olabilir; degilse adiyla cozulur.
        if (ham && typeof ham === "object" && ham.name) ef = ham;
        if (!ef) { try { ef = qe.project.getVideoEffectByName(efAd); } catch (eE) {} }
        if (!ef) return "err:'" + efAd + "' cozulemedi (getVideoEffectByName bulamadi)";

        var qs = qe.project.getActiveSequence();
        var ok = 0, hata = [], i, qc, ad, sesAtlandi = 0;
        for (i = 0; i < sec.length; i++) {
            // Bagli ses klibi secime giriyor (Linked Selection) — video efekti alamaz, ATLA.
            if (_sesKlibiMi(sec[i])) { sesAtlandi++; continue; }
            ad = "?"; try { ad = String(sec[i].name); } catch (eN) {}
            qc = _qeKlipBul(qs, sec[i]);
            if (!qc) { hata.push(ad + " -> QE karsiligi bulunamadi (ses klibi ya da eslesmeyen zaman)"); continue; }
            try { qc.addVideoEffect(ef); ok++; }
            catch (eA) { hata.push(ad + " -> " + eA.toString()); }
        }
        if (!ok) return "err:" + (hata[0] || (sesAtlandi ? "yalniz ses klibi secili — video klibi sec" : "uygulanamadi"));
        return "ok:" + ok + " klibe '" + efAd + "' uygulandi" +
               (hata.length ? " | " + hata.length + " klipte OLMADI: " + hata.join(" ; ") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/* ================= PRESET ÖĞREN / TEKRARLA =================
   NEDEN BU YOL: kullanicinin preset dosyalari script'e GORUNMUYOR (olculdu — 148 ogenin
   hepsi yerlesik efekt, kullanicinin 8 preset'i hicbirinde yok). Panel Effects panelinden
   surukleme de YAPAMAZ (CEP'te UI otomasyonu yok).
   AMA: preset bir klibe ELLE uygulandiktan sonra o klibin efekt yigini TAMAMEN okunabiliyor
   (components -> properties -> isTimeVarying/getKeys/getValueAtKey/getValue) ve baska
   kliplere yazilabiliyor. Yani preset'i bir kez surukle, panel ogrensin, sonra sinirsiz
   tekrarlasin. Premiere'in "Paste Attributes"i ile ayni fikir; farki, yigin panelde
   SAKLANIYOR — dugmeye baglanip sonraki videolarda da kullanilabiliyor.
   ZAMAN: keyframe'ler KAYNAK KLIBIN BASINA GORE saklanir (t - klipBas), yazarken HEDEF
   klibin basi eklenir. Sekans zamani dogrudan kopyalanirsa animasyon baska bir klipte
   tamamen yanlis yere duser (bu hata bir kez yasandi, bkz. _klipBas). */
/* ================= EGRI ORNEKLEME (baking) =================
   SORUN: keyframe'in ease/bezier TUTAMAKLARINI Premiere script'e ne okutuyor ne yazdiriyor
   (getInterpolationTypeAtKey YOK — Adobe calisani dogruladi; tutamak/velocity API'si de yok).
   Yani "yumusaklik" kaynaktan TARIF olarak alinamiyor. Kor "hepsi Bezier" denendi: tutamaklar
   duz geldigi icin her keyframe'de hiz sifira dustu (kullanici olctu: kaynak 22,6/sn, kopya
   0,0/sn — dur-kalk).
   COZUM: sekli TARIF etmek yerine SEKLIN KENDISINI tasi. getValueAtTime(t) iki keyframe
   arasinda Premiere'in KENDI interpolasyonunu uygulayip deger donduruyor (Adobe belgesi),
   yani egri OLCULEBILIR. Yogun ornek al -> sadelestir -> hedefe o noktalari yaz. Aradaki
   parcalar lineer olsa da nokta sikligi yavaslama/hizlanmayi gozle ayirt edilemez tasir.
   MALIYET: hedefte keyframe SAYISI kaynaktakinden fazla olur (sadelestirmeyle ~10-30).
   Bilincli takas: kullanici "her seyi alabilmeli" dedi, gorsel sadakat > keyframe sayisi. */
var ORNEK_MAX = 300;    // guvenlik tavani: cok uzun animasyonda ornek patlamasin
/* Sekansin kare hizi. Ornekleme siklig'i buna baglanir (bkz. _egriOrnekle). Okunamazsa
   30'a duser — makul ve guvenli (fazla siklik zarar veriyordu, azlik yalniz hassasiyet). */
function _sekansFps() {
    var f = 0;
    try { f = TICK_SN / parseFloat(app.project.activeSequence.timebase); } catch (e) {}
    if (!(f > 0) || f > 120) f = 30;
    return f;
}
/* Iki degerin ayni olup olmadigi (sayi / sayi dizisi / metin). Ornekleme bicimini
   OLCERKEN kullanilir: bir keyframe zamaninda alinan ornek, o keyframe'in degerine
   esit CIKMALI — cikmiyorsa zaman bicimi yanlistir. */
function _degerAyniMi(a, b, tol) {
    var i, na, nb;
    if (_dizimi(a) && _dizimi(b)) {
        if (a.length !== b.length) return false;
        for (i = 0; i < a.length; i++) {
            if (Math.abs(Number(a[i]) - Number(b[i])) > tol) return false;
        }
        return true;
    }
    if (_dizimi(a) || _dizimi(b)) return false;
    na = Number(a); nb = Number(b);
    if (isNaN(na) || isNaN(nb)) return String(a) === String(b);
    return Math.abs(na - nb) <= tol;
}
function _degerZamanda(pr, sn, bicim) {
    var z = (bicim === "time") ? _zamanNesnesi(sn) : sn;
    if (z === null || z === undefined) return null;
    var v = null;
    try { v = pr.getValueAtTime(z); } catch (e) { return null; }
    return (v === undefined) ? null : v;
}
/* ZAMAN BICIMI OLCUMU — tahmin degil, ve IKI NOKTADA.
   getValueAtTime saniye mi Time nesnesi mi bekliyor belgelenmemis. TEK keyframe'de
   dogrulamak YETMIYOR (denetimde yakalandi): sayi bazi surumlerde TICK olarak yorumlanıyor
   (bkz. _keyEkleDEski notu) ve ilk keyframe t≈0 ise tick yorumu da t=0'a denk gelip
   "tuttu" sanilir. Sonra BUTUN ornekler ≈0 aninda alinir, hepsi ayni deger cikar, egri
   DUZ olur — ve panel "egri alindi" diye BASARILI raporlar (animasyon tamamen kaybolur).
   Bu yuzden DEGERI FARKLI ikinci bir keyframe'de de dogrulanir: tick yanilgisi ikinci
   noktayi tutturamaz. */
function _ornekBicimOlc(pr, klist) {
    var i, a = klist[0], b = null, bic = ["sayi", "time"], f, v1, v2;
    for (i = 1; i < klist.length; i++) {
        if (!_degerAyniMi(klist[i].v, a.v, 0.02)) { b = klist[i]; break; }
    }
    if (!b) return "";      // hepsi ayni deger: orneklenecek egri YOK
    for (f = 0; f < bic.length; f++) {
        v1 = _degerZamanda(pr, a.t, bic[f]);
        if (v1 === null || !_degerAyniMi(v1, a.v, 0.02)) continue;
        v2 = _degerZamanda(pr, b.t, bic[f]);
        if (v2 !== null && _degerAyniMi(v2, b.v, 0.02)) return bic[f];
    }
    return "";
}
function _ornDeger(o, ix) { return _dizimi(o.v) ? Number(o.v[ix]) : Number(o.v); }
/* SADELESTIRME (Douglas-Peucker, yigin tabanli — ES3'te ozyineleme yerine dongu).
   Lineer yaklasimdan sapmasi esigin altinda kalan ornekler ATILIR. Boylece duz bolumler
   2 noktaya iner, kivrimli bolumlerde nokta sikligi korunur: egri ayni, keyframe sayisi
   makul. Esik deger ARALIGINDAN turetilir (Scale %0-112 ile Position 1920px ayni esigi
   kullanamaz). */
function _ornekSadelestir(ham) {
    var n = ham.length;
    if (n <= 2) return ham;
    var boyut = _dizimi(ham[0].v) ? ham[0].v.length : 1;
    var i, c, mn, mx, d, aralik = 0;
    for (c = 0; c < boyut; c++) {
        mn = _ornDeger(ham[0], c); mx = mn;
        for (i = 1; i < n; i++) { d = _ornDeger(ham[i], c); if (d < mn) mn = d; if (d > mx) mx = d; }
        if (mx - mn > aralik) aralik = mx - mn;
    }
    if (!(aralik > 0)) return [ham[0], ham[n - 1]];   // deger hic degismiyor: iki uc yeter
    /* ESIK ARALIGA GORE — MUTLAK TABAN YOK. Sabit 0.05 tabani vardi ve 0..1 araliginda
       calisan parametrelerde (bircok efektin Amount/Mix'i, normalize Position) esik
       araligin %5'ine denk gelip ease egrisini 2-4 noktaya indiriyordu: ozelligin varlik
       sebebi olan yumusaklik tam da orada olurdu. */
    var tol = aralik * 0.004;
    /* UC NOKTALAR HER ZAMAN KORUNUR (tut[0], tut[n-1]) — DEGISMEZ:
       presetOkuJSON'daki kmin/relMin/capa hesaplari orneklerin keyframe'lerle AYNI araligi
       kapsadigina guveniyor. Burasi degistirilirse orasi da gozden gecirilmeli. */
    var tut = [], yig = [[0, n - 1]], par, a, b, enIx, enSap, sap, oran, pay;
    for (i = 0; i < n; i++) tut.push(false);
    tut[0] = true; tut[n - 1] = true;
    while (yig.length) {
        par = yig.pop(); a = par[0]; b = par[1];
        if (b - a < 2) continue;
        enIx = -1; enSap = 0;
        pay = ham[b].t - ham[a].t;
        for (i = a + 1; i < b; i++) {
            oran = (pay > 0) ? (ham[i].t - ham[a].t) / pay : 0;
            sap = 0;
            for (c = 0; c < boyut; c++) {
                d = Math.abs(_ornDeger(ham[i], c) -
                             (_ornDeger(ham[a], c) +
                              (_ornDeger(ham[b], c) - _ornDeger(ham[a], c)) * oran));
                if (d > sap) sap = d;
            }
            if (sap > enSap) { enSap = sap; enIx = i; }
        }
        if (enIx > 0 && enSap > tol) {
            tut[enIx] = true;
            yig.push([a, enIx]); yig.push([enIx, b]);
        }
    }
    var out = [];
    for (i = 0; i < n; i++) if (tut[i]) out.push(ham[i]);
    return out;
}
/* klist: HAM zamanli keyframe listesi. Donus: [{t,v}] ornekler (HAM zaman) ya da null.
   null = ornekleme yapilamadi -> cagiran taraf seyrek keyframe'lere duser (eski davranis). */
function _egriOrnekle(pr, klist) {
    if (!klist || klist.length < 2) return null;
    /* SAYISAL OLMAYAN parametre (enum/metin) ORNEKLENMEZ: _ornekSadelestir Number() ile
       calisiyor, NaN'da butun sapmalar 0 cikiyor ve cok basamakli bir hold animasyonu
       iki uc noktaya coker (basamaklar kaybolur) — seyrek keyframe BIREBIR dogru. */
    var ilkV = _dizimi(klist[0].v) ? klist[0].v[0] : klist[0].v;
    if (isNaN(Number(ilkV))) return null;

    var i, t0 = klist[0].t, t1 = klist[0].t;
    for (i = 1; i < klist.length; i++) {   // getKeys sirali gelmeyebilir
        if (klist[i].t < t0) t0 = klist[i].t;
        if (klist[i].t > t1) t1 = klist[i].t;
    }
    var sure = t1 - t0;
    if (!(sure > 0.0001)) return null;
    var bicim = _ornekBicimOlc(pr, klist);
    if (!bicim) return null;                        // olculemedi: RISK ALMA

    /* ORNEK SIKLIGI = SEKANSIN KARE HIZI. Premiere zaten yalniz kare sinirlarinda
       degerlendiriyor; kare hizinin USTUNDE orneklemek gorsel sadakat KAZANDIRMIYOR, buna
       karsilik ornekler arasi mesafeyi _yazVeSay'in eslestirme toleransinin altina dusurup
       yanlis eslesme ve gereksiz keyframe uretiyordu. */
    var hz = _sekansFps();
    var adet = Math.round(sure * hz);
    if (adet < 4) adet = 4;
    if (adet > ORNEK_MAX) adet = ORNEK_MAX;
    var ham = [], t, v;
    for (i = 0; i <= adet; i++) {
        t = t0 + sure * i / adet;
        if (i === adet) t = t1;                     // yuvarlanma son ornegi disari tasimasin
        v = _degerZamanda(pr, t, bicim);
        /* Tek bir okunamayan ornek egriyi bozar (o an duz cizgi olur) — hepsi ya da hicbiri. */
        if (v === null) return null;
        ham.push({ t: t, v: v });
    }
    /* DUZ CIZGI FRENI: kaynakta deger DEGISIYORKEN ornekler sabit ciktiysa olcum yalan
       soyluyor demektir (or. zaman tick olarak yorumlanip hepsi ayni ana denk geldi).
       Boyle bir "egri" hedefe yazilirsa animasyon TAMAMEN kaybolur ve panel basarili der. */
    var kaynakDegisiyor = false, ornDegisiyor = false;
    for (i = 1; i < klist.length; i++) {
        if (!_degerAyniMi(klist[i].v, klist[0].v, 0.02)) { kaynakDegisiyor = true; break; }
    }
    for (i = 1; i < ham.length; i++) {
        if (!_degerAyniMi(ham[i].v, ham[0].v, 0.02)) { ornDegisiyor = true; break; }
    }
    if (kaynakDegisiyor && !ornDegisiyor) return null;   // seyrek keyframe'e dus
    return _ornekSadelestir(ham);
}
/* Keyframe VE ornek zamanlarini birlikte kaydir — ikisi ayni zaman ekseninde olmali. */
function _zamanKaydir(po, ofs) {
    var listeler = [po.k, po.s], q, l, i;
    for (q = 0; q < listeler.length; q++) {
        l = listeler[q];
        if (!l) continue;
        for (i = 0; i < l.length; i++) l[i].t = l[i].t - ofs;
    }
}

var _okunamayanKey = 0;   // presetOkuJSON: zamani cozulemeyen keyframe sayaci
function presetOkuJSON() {
    _okunamayanKey = 0;
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ ok: false, hata: "Aktif sekans yok" });
        var sec = null;
        try { sec = seq.getSelection(); } catch (eS) {}
        if (!sec || !sec.length) return JSON.stringify({ ok: false, hata: "Once preset'in UYGULANDIGI klibi sec" });

        /* SECIMDEKI ILK VIDEO KLIBI — sec[0] DEGIL. Linked Selection acikken kullanici
           video klibine tiklasa da secimin ilk ogesi SES olabiliyor ve panel bos bir ses
           klibinden ogrenip "keyframe yok" diyordu. */
        var ti = null, si;
        for (si = 0; si < sec.length; si++) {
            if (!_sesKlibiMi(sec[si])) { ti = sec[si]; break; }
        }
        if (!ti) return JSON.stringify({ ok: false, hata: "Yalniz ses klibi secili — preset'in uygulandigi VIDEO klibini sec" });

        var t0 = _klipBas(ti), c = ti.components, out = [], i, j, m, hizAtlandi = 0;
        for (i = 0; i < c.numItems; i++) {
            var cm = null; try { cm = c[i]; } catch (e0) { continue; }
            var comp = { match: "", ad: "", p: [], enabled: true };
            try { comp.match = String(cm.matchName); } catch (e1) {}
            try { comp.ad = String(cm.displayName); } catch (e2) {}
            /* HIZ RAMPASI KAYDEDILMEZ: hizlandirilmis bir klipten ogretilen preset
               uygulandigi HER klibi agir cekim/hizli yapiyordu. */
            if (_hizRampasiMi(comp.ad, comp.match)) { hizAtlandi++; continue; }
            /* fx ac/kapa durumu: kaynakta bilerek KAPATILMIS efekt hedefte de kapali gelsin.
               Okunamazsa varsayilan ACIK (eski kayitlarla geriye uyumlu). */
            try { comp.enabled = (cm.enabled === false) ? false : true; } catch (eEn) {}
            var ps = null; try { ps = cm.properties; } catch (e3) { ps = null; }
            if (ps) {
                for (j = 0; j < ps.numItems; j++) {
                    var pr = null; try { pr = ps[j]; } catch (e4) { continue; }
                    var po = { ad: "", kf: false, ix: j };
                    /* ix = ozellik INDEKSI. Adi BOS olan parametreler var (kullanicinin
                       "Pop In RGB" preset'indeki VR bileseninde iki tane) ve _paramBul
                       ada gore aradigi icin ikisi de AYNI ozellige esleniyor: ikinci kayit
                       birincinin uzerine yaziyordu. Ad bossa indeks kullanilir. */
                    try { po.ad = String(pr.displayName); } catch (e5) {}
                    try { po.kf = !!pr.isTimeVarying(); } catch (e6) {}
                    if (po.kf) {
                        po.k = [];
                        var keys = null; try { keys = pr.getKeys(); } catch (e7) { keys = null; }
                        if (keys) {
                            for (m = 0; m < keys.length; m++) {
                                /* ZAMAN OKUMASI _zamanSn ILE — .secs / .seconds / String,
                                   hepsi denenir. Eskiden yalniz .seconds deneniyordu ve
                                   tutmadiginda keyframe SESSIZCE atlaniyordu: preset
                                   "ogrenildi" gorunuyor ama icinde tek keyframe olmuyordu. */
                                var ts = _zamanSn(keys[m]), dv = null;
                                try { dv = pr.getValueAtKey(keys[m]); } catch (eA) { dv = null; }
                                // HAM zaman saklanir; taban asagida OLCULUP normalize edilir.
                                // Okunamayan keyframe SAYILIR — sessizce kaybolmasin.
                                /* DEGERI okunamayan keyframe de kaydedilmez: v=null olarak
                                   saklanip yazma tarafinda TypeError atiyor ve TUM
                                   presetYaz'i dusuruyordu. Zaman gibi deger de sarttir. */
                                if (isNaN(ts) || dv === null || dv === undefined) _okunamayanKey++;
                                else po.k.push({ t: ts, v: dv });
                            }
                        }
                        // Keyframe'i olan ama okunamayan parametre sessiz gecmesin
                        if (!po.k.length) po.kf = false;
                        /* ZAMAN SIRASINA DIZ: getKeys sirali dondurmeyebiliyor ve yazma
                           tarafi "ilk/son keyframe" ile capa/taban seciyor, _yazVeSay de
                           tek imlecle sirali eslestiriyor. Ornekler zaten sirali; .k'nin
                           sirasiz kalmasi iki yolu birbirinden ayirirdi. */
                        if (po.k.length > 1) {
                            po.k.sort(function (x, y) { return x.t - y.t; });
                        }
                        /* EGRIYI ORNEKLE: ease/yavaslama sekli ancak boyle tasinir
                           (tutamak API'si yok — bkz. _egriOrnekle). Basarisiz olursa
                           po.s hic olusmaz ve yazma tarafi seyrek keyframe'e duser. */
                        if (po.k.length >= 2) {
                            var orn = null;
                            try { orn = _egriOrnekle(pr, po.k); } catch (eOrn) { orn = null; }
                            if (orn && orn.length >= 2) po.s = orn;
                        }
                    }
                    if (!po.kf) { try { po.v = pr.getValue(); } catch (eB) { po.v = null; } }
                    comp.p.push(po);
                }
            }
            out.push(comp);
        }
        /* ZAMAN TABANI — TAHMIN DEGIL OLCUM.
           getKeys() sekans zamani mi klip-yerel zaman mi donduruyor, belgelenmemis ve
           surumden surume degisebilir. Kaynak klip t0'da basliyorsa:
             · keyler t0 civarindaysa  -> SEKANS zamani (t0 cikarilir)
             · keyler 0 civarindaysa   -> KLIP-YEREL zaman (oldugu gibi kalir)
           Yanlis tahminin bedeli: hedef klip baska bir zamandaysa keyframe'ler klibin
           DISINA dusuyor ve "uygulandi" denmesine ragmen hicbir sey gorunmuyor. */
        var kmin = NaN, keySayi = 0, stSayi = 0, ornSayi = 0, egrili = 0, ci, pi, ki, klist, icsel;
        for (ci = 0; ci < out.length; ci++) {
            icsel = _icselMi(out[ci].ad, out[ci].match);
            for (pi = 0; pi < out[ci].p.length; pi++) {
                if (out[ci].p[pi].s && out[ci].p[pi].s.length) {
                    ornSayi += out[ci].p[pi].s.length; egrili++;
                }
                klist = out[ci].p[pi].k || [];
                if (klist.length) {
                    for (ki = 0; ki < klist.length; ki++) {
                        keySayi++;   // TOPLAM keyframe: okuma eksikse tek bakista gorulsun
                        if (isNaN(kmin) || klist[ki].t < kmin) kmin = klist[ki].t;
                    }
                } else if (!icsel && out[ci].p[pi].v !== null && out[ci].p[pi].v !== undefined) {
                    /* UYGULANABILIR STATIK: yalniz dis (preset'in ekledigi) bilesen statigi.
                       Icsel Motion/Opacity statikleri (klip kendi durusu) SAYILMAZ — statik-only
                       preset esiginde 'basarili ama bos' tuzagi acmasin. */
                    stSayi++;
                }
            }
        }
        /* UC ADAYA MESAFE OLC — esik yerine "en yakin taban".
           Eski kural (`t0 > 0.5 && kmin < t0*0.5`) iki delik birakiyordu: 0 < t0 <= 0.5
           penceresinde olcum hic yapilmadan "sekans" varsayiliyor ama t0 yine de
           cikariliyordu (keyler NEGATIF olup hedefte klip oncesine dusuyordu), ve
           t0*0.5 <= kmin < t0 araligi da kaciriliyordu. Ayrica KAYNAK MEDYA tabani
           (inPoint) hic degerlendirilmiyordu — Adobe belgelerinin isaret ettigi taban o. */
        var t0Kaynak = _klipKaynakBas(ti);
        var taban = "sekans", tabanOfs = t0;
        if (!isNaN(kmin)) {
            var dSekans = Math.abs(kmin - t0);
            var dKaynak = Math.abs(kmin - t0Kaynak);
            var dKlip   = Math.abs(kmin - 0);
            if (dKaynak <= dSekans && dKaynak <= dKlip)      { taban = "kaynak"; tabanOfs = t0Kaynak; }
            else if (dKlip <= dSekans && dKlip <= dKaynak)   { taban = "klip";   tabanOfs = 0; }
            else                                             { taban = "sekans"; tabanOfs = t0; }
        }
        // Butun zamanlari KLIP-YEREL hale getir (klibin basindan itibaren saniye).
        for (ci = 0; ci < out.length; ci++) {
            for (pi = 0; pi < out[ci].p.length; pi++) _zamanKaydir(out[ci].p[pi], tabanOfs);
        }

        /* CIPA — animasyon klibin BASINA mi SONUNA mi yapissin?
           Kullanicinin kurali: "Pop In neye atarsam atayim BASINDA baslamali", Out olanlar
           ise sonda. Bunu ada bakarak tahmin etmek kirilgan olurdu (preset adlari degisir);
           OLCULUYOR: keyframe'ler klibin ilk yarisindaysa basa, son yarisindaysa sona
           yapisir. Sona yapisanlarda zamanlar klip SONUNA gore (negatif) saklanir. */
        var t1 = _zamanSn(ti.end);
        var sure = (!isNaN(t1) && t1 > t0) ? (t1 - t0) : 0;
        var relMin = NaN;
        for (ci = 0; ci < out.length; ci++) {
            for (pi = 0; pi < out[ci].p.length; pi++) {
                klist = out[ci].p[pi].k || [];
                for (ki = 0; ki < klist.length; ki++) {
                    if (isNaN(relMin) || klist[ki].t < relMin) relMin = klist[ki].t;
                }
            }
        }
        var capa = "bas";
        if (sure > 0 && !isNaN(relMin) && relMin > sure * 0.5) capa = "son";

        /* ⚠ CIPA PARAMETRE BASINA — YIGIN BASINA DEGIL. (Kullanici bildirdi, 7 Agustos 2026.)
           Bir preset AYNI ANDA hem giris hem cikis animasyonu icerebiliyor: kullanicinin
           yiginda "Transform (Pop In 1)" klibin BASINDA, "Transform (Asagiya Pop Out)"
           klibin SONUNDA. Tek bir yigin capasi ikisine birden hizmet EDEMEZ.
           Olan: relMin butun parametrelerin en erkeni (Pop In'inki, ~0) oldugu icin yigin
           "bas" isaretleniyor, Pop Out'un dinlenme noktasi ILK keyframe olmasi gerekirken
           SON keyframe aliniyor ve dizi-farki TERS isaretli cikiyordu.
           Olculdu: kaynak Position 500,1505.8 -> hedef 500,-505.8 (500 - 1005.8).
           Her parametre kendi keyframe'lerine gore isaretlenir; zamanlari da kendi capasina
           gore kaydirilir. Yigin capasi (yukarida) GERIYE UYUMLULUK icin kaliyor: eski
           kayitlarda p.capa yok, o zaman yigin capasi kullanilir. */
        for (ci = 0; ci < out.length; ci++) {
            for (pi = 0; pi < out[ci].p.length; pi++) {
                var po2 = out[ci].p[pi];
                var kl2 = po2.k || [];
                if (!kl2.length) continue;
                var pMin = NaN, kx;
                for (kx = 0; kx < kl2.length; kx++) {
                    if (isNaN(pMin) || kl2[kx].t < pMin) pMin = kl2[kx].t;
                }
                po2.capa = (sure > 0 && !isNaN(pMin) && pMin > sure * 0.5) ? "son" : "bas";
                if (po2.capa === "son") _zamanKaydir(po2, sure);
            }
        }

        /* NEGATIF kalan zaman = olcum tutmadi. Boyle bir kayit hedefte klip oncesine
           duser ve sessizce hicbir sey yapmaz — KAYDETME, sebebini soyle. */
        if (capa === "bas" && !isNaN(relMin) && relMin < -0.001) {
            return JSON.stringify({ ok: false, hata: "Zaman tabani olculemedi (ilkKey=" + kmin +
                " klipBas=" + t0 + " kaynakBas=" + t0Kaynak + "). Preset'in uygulandigi, " +
                "timeline'in basinda OLMAYAN bir klip secip tekrar dene." });
        }
        var ad = "?"; try { ad = String(ti.name); } catch (eC) {}
        return JSON.stringify({ ok: true, kaynak: ad, taban: taban, capa: capa,
                                keySayi: keySayi, stSay: stSayi, okunamayan: _okunamayanKey,
                                egrili: egrili, ornSay: ornSayi, hizAtlandi: hizAtlandi,
                                olcum: "ilkKey=" + kmin + " klipBas=" + t0 + " kaynakBas=" + t0Kaynak +
                                       " sure=" + sure + " -> " + taban + "/" + capa +
                                       (_okunamayanKey ? (" | OKUNAMAYAN KEY: " + _okunamayanKey) : ""),
                                bilesenler: out });
    } catch (e) { return JSON.stringify({ ok: false, hata: e.toString() }); }
}

/* Bileseni once matchName (dile bagimsiz), tutmazsa displayName ile ara.
   displayName yedegi sart: QE ile eklenen efektin matchName'i kaynaktakiyle birebir
   ayni olmayabiliyor. */
function _sadeAd(s) { return String(s).replace(/\s*\([^()]*\)\s*$/, ""); }
/* Bilesen INDEKSI dondurur (-1 = yok). Indeks sart: ayni klipte AYNI efektten iki tane
   olabiliyor (kullanicinin klibinde "Transform" + "Transform (Pop In 1)" vardi) ve ikisi
   de ayni matchName'i tasiyor. Nesne dondurulunce iki kayit ayni hedefe eslesiyor,
   ikincisinin parametreleri yanlis bilesende aranıp "param-yok" cikiyordu.
   `atla` = daha once kullanilmis indeksler. */
function _bilesenIndexAra(ti, match, ad, atla) {
    var c = null, i, mn, dn, k, gec;
    try { c = ti.components; } catch (e0) { return -1; }
    if (!c) return -1;
    function kullanildi(ix) {
        if (!atla) return false;
        for (k = 0; k < atla.length; k++) if (atla[k] === ix) return true;
        return false;
    }
    var matchVar = false;
    for (i = 0; i < c.numItems; i++) {
        mn = ""; try { mn = String(c[i].matchName); } catch (e1) {}
        if (match && mn === match) {
            matchVar = true;                 // bu turden bilesen KLIPTE VAR
            if (!kullanildi(i)) return i;
        }
    }
    /* matchName ile eslesen bir bilesen VAR ama hepsi kullanilmissa BURADA DUR.
       Ada gore aramaya devam etmek, kaydi BASKA turden bir bilesene yazdiriyordu
       (or. Motion kaydinin Transform'a gitmesi) — yanlis yere yazmaktansa bildirmek yeg. */
    if (matchVar) return -1;
    for (i = 0; i < c.numItems; i++) {
        if (kullanildi(i)) continue;
        dn = ""; try { dn = String(c[i].displayName); } catch (e2) {}
        if (ad && dn === ad) return i;
    }
    /* Son care: parantezli eki atarak karsilastir. Kaynakta "Transform (Pop In 1)",
       hedefe eklenen ise duz "Transform" oluyor — ikisi ayni efekt. */
    if (ad) {
        gec = _sadeAd(ad);
        if (gec && gec !== ad) {
            for (i = 0; i < c.numItems; i++) {
                if (kullanildi(i)) continue;
                dn = ""; try { dn = _sadeAd(c[i].displayName); } catch (e3) {}
                if (dn === gec) return i;
            }
        }
    }
    return -1;
}
/* Klipte bu turden KAC bilesen var? (matchName ONCELIKLI; yoksa parantezsiz ada duser.)
   "Bu efekt var mi" yerine "kac tane var" sorusu, ayni efektten birden coguna izin veren
   tek dogru olcu — bkz. presetYaz'daki ekleme dongusu. */
function _bilesenSay(ti, match, ad) {
    var c = null, i, mn, dn, n = 0, sade = _sadeAd(ad || "");
    try { c = ti.components; } catch (e0) { return 0; }
    if (!c) return 0;
    if (match) {
        for (i = 0; i < c.numItems; i++) {
            mn = ""; try { mn = String(c[i].matchName); } catch (e1) {}
            if (mn === match) n++;
        }
        if (n) return n;          // matchName tuttuysa ad'a hic bakma
    }
    for (i = 0; i < c.numItems; i++) {
        dn = ""; try { dn = _sadeAd(String(c[i].displayName)); } catch (e2) { dn = ""; }
        if (dn && sade && dn === sade) n++;
    }
    return n;
}
function _bilesenAraGenis(ti, match, ad) {
    var ix = _bilesenIndexAra(ti, match, ad, null);
    if (ix < 0) return null;
    try { return ti.components[ix]; } catch (e) { return null; }
}

/* Klibi SIFIRDAN al: aktif sekans yeniden okunur, klip track + nodeId ile bulunur.
   OLCULDU: getSelection() (ve _tazeKlip) BAYAT nesne donduruyor — QE ile efekt
   eklendikten sonra o nesnenin components'inde yeni efekt GORUNMUYOR ("eklendi ama
   okunamadi" hatasi tam olarak buydu). Sekans->track->clips zinciri taze veri veriyor. */
function _klipYenidenBul(trackIdx, nodeId, basSn) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return null;
        var ti = parseInt(trackIdx, 10);
        if (isNaN(ti) || ti < 0 || ti >= seq.videoTracks.numTracks) return null;
        var tr = seq.videoTracks[ti], i, c, nid, s;
        if (nodeId) {
            for (i = 0; i < tr.clips.numItems; i++) {
                c = tr.clips[i];
                nid = ""; try { nid = String(c.nodeId); } catch (e0) {}
                if (nid === nodeId) return c;
            }
        }
        /* nodeId tutmazsa baslangic zamanina dus (bir kareden genis tolerans).
           TEK ADAY SARTI: ayni track'te 0.05 sn icinde birden fazla klip baslangici varsa
           (cok kisa AutoCut kliplerinde mumkun) hangisi oldugu belirsizdir — YANLIS klibe
           yazmaktansa null donmek yegdir (yanlis klip sessizce bozulur). */
        var aday = null, adaySayi = 0;
        for (i = 0; i < tr.clips.numItems; i++) {
            c = tr.clips[i];
            s = _zamanSn(c.start);
            if (!isNaN(s) && !isNaN(basSn) && Math.abs(s - basSn) < 0.05) { aday = c; adaySayi++; }
        }
        if (adaySayi === 1) return aday;
    } catch (e) {}
    return null;
}
/* Hedef klipte olmayan efekti QE ile ekle (yalniz YERLESIK efektler icin calisir —
   preset zaten yerlesik efektlerden kuruludur, o yuzden bu yeterli).
   DONUS: "" = basarili, aksi halde SEBEP metni. Eskiden boolean donuyordu ve uc ayri
   hatayi (efekt katalogda yok / QE klibi bulunamadi / ekleme patladi) ayirt edilemez
   kiliyordu — kullaniciya "eklenemedi" deyip nedenini soylememek teshisi imkansizlastiriyor. */
function _qeEfektEkle(ti, efektAdi) {
    if (!efektAdi) return "efekt adi bos";
    try {
        if (typeof app.enableQE !== "function") return "QE bu surumde yok";
        app.enableQE();
        var ef = null;
        try { ef = qe.project.getVideoEffectByName(String(efektAdi)); } catch (e0) {}
        /* Preset uygulanmis efektin ORNEK adi "Transform (Pop In 1)" gibi olabiliyor —
           Premiere efekt ornegine preset adini ekliyor. Katalogda boyle bir efekt YOK;
           sondaki parantezli eki atip gercek efekt adiyla ("Transform") tekrar dene. */
        if (!ef) {
            var sade = String(efektAdi).replace(/\s*\([^()]*\)\s*$/, "");
            if (sade && sade !== String(efektAdi)) {
                try { ef = qe.project.getVideoEffectByName(sade); } catch (e1) {}
            }
        }
        if (!ef) return "Premiere efekt katalogunda yok";
        var qs = qe.project.getActiveSequence();
        var qc = _qeKlipBul(qs, ti);
        if (!qc) return "klibin QE karsiligi bulunamadi";
        qc.addVideoEffect(ef);
        return "";
    } catch (e) { return e.toString(); }
}

/* NOT: burada _tazeKlip vardi — klibi getSelection()'dan yeniden alan fonksiyon.
   KALDIRILDI, ise yaramadi: getSelection() de ayni bayat nesneleri donduruyor ve efekt
   eklendikten sonra components hala eski goruntuyu veriyordu. Yerine _klipYenidenBul
   geldi (sekans -> videoTracks -> clips zinciri). */
function _dizimi(v) {
    return !!(v && typeof v !== "string" && typeof v.length === "number");
}

/* PARAMETRE ADI ESDEGERLERI — OLCULDU (6 Agustos 2026, kullanicinin klibi).
   Ayni kavram bilesene gore FARKLI adlaniyor:
     · Motion    -> "Scale"
     · Transform -> "Scale Height" + "Scale Width"  (Uniform Scale acikken Effect Controls
       ikisini tek "Scale" satiri olarak GOSTERIYOR ama gercek parametre adlari bunlar)
   Birebir ad eslestirmesi bu yuzden "Scale yok" diyordu. Turkce arayuz ihtimaline karsi
   yerellestirilmis adlar da listede. */
var _PARAM_ESDEGER = {
    "Scale":        ["Scale", "Scale Height", "Ölçek", "Olcek"],
    "Scale Height": ["Scale Height", "Scale", "Ölçek", "Olcek"],
    "Scale Width":  ["Scale Width", "Scale"],
    "Opacity":      ["Opacity", "Opaklık", "Opaklik"],
    "Position":     ["Position", "Konum"],
    "Anchor Point": ["Anchor Point", "Sabit Nokta"],
    "Rotation":     ["Rotation", "Döndürme", "Dondurme"]
};
function _paramBul(ps, ad) {
    var adaylar = _PARAM_ESDEGER[ad] || [ad], k, i, dn;
    for (k = 0; k < adaylar.length; k++) {
        for (i = 0; i < ps.numItems; i++) {
            dn = ""; try { dn = String(ps[i].displayName); } catch (e) {}
            if (dn === adaylar[k]) return ps[i];
        }
    }
    return null;
}
/* HEDEFIN DINLENME DEGERI — animasyon bittiginde durdugu deger.
   `getValue()` parametre ZATEN animasyonluysa OYNATMA KAFASININ oldugu andaki degeri
   donduruyor. Bunun bedeli olculdu: ayni preset ikinci kez uygulaninca sonuc kafanin
   nerede durduguna gore DEGISIYOR ve klip her denemede biraz daha kayiyordu (klasik
   "bazen oluyor bazen olmuyor"). Animasyonluysa deger keyframe'lerden okunur: giris
   (capa='bas') animasyonunda SON key, cikis ('son') ILK key dinlenme noktasidir. */
function _dinlenmeDegeri(pr, capa) {
    var kk = null, i, t, enIx = -1, enT = NaN, tv = false;
    try { tv = !!pr.isTimeVarying(); } catch (e0) { tv = false; }
    if (!tv) { try { return pr.getValue(); } catch (e1) { return null; } }
    try { kk = pr.getKeys(); } catch (e2) { kk = null; }
    if (!kk || !kk.length) { try { return pr.getValue(); } catch (e3) { return null; } }
    for (i = 0; i < kk.length; i++) {
        t = _zamanSn(kk[i]);
        if (isNaN(t)) continue;
        if (enIx < 0) { enIx = i; enT = t; continue; }
        if (capa === "son") { if (t < enT) { enIx = i; enT = t; } }
        else { if (t > enT) { enIx = i; enT = t; } }
    }
    if (enIx >= 0) { try { return pr.getValueAtKey(kk[enIx]); } catch (e4) {} }
    try { return pr.getValue(); } catch (e5) { return null; }
}
/* ESKI KEYFRAME TEMIZLIGI — yalniz BASARILI yazimdan sonra.
   "Uyguladim, begenmedim, baskasini denedim" en sik yapilan sey. Eski keyframe'ler
   silinmedigi icin iki animasyonun key'leri IC ICE kaliyor ve kaynakta HIC olmayan bir
   hareket cikiyordu. Silme SONRA yapilir: once silinseydi basarisiz denemede geri
   getirilemezdi. Yalniz YAZDIGIMIZ ARALIKTA ve bizim zamanlarimizdan hicbirine denk
   gelmeyen key'ler silinir — aralik DISINA DOKUNULMAZ (kullanicinin kendi keyframe'leri
   orada olabilir). */
function _yabanciKeyTemizle(pr, hedefler, tol) {
    if (!hedefler || hedefler.length < 2) return 0;
    var alt = hedefler[0], ust = hedefler[hedefler.length - 1], silinen = 0;
    var tur, kk, i, s, j, yakin, sildi;
    if (!(ust > alt)) return 0;
    for (tur = 0; tur < ORNEK_MAX + 64; tur++) {
        kk = null; try { kk = pr.getKeys(); } catch (e0) { return silinen; }
        if (!kk || !kk.length) return silinen;
        sildi = false;
        for (i = 0; i < kk.length; i++) {
            s = _zamanSn(kk[i]);
            if (isNaN(s) || s < alt - 0.001 || s > ust + 0.001) continue;   // ARALIK DISI: DOKUNMA
            yakin = false;
            for (j = 0; j < hedefler.length; j++) {
                if (Math.abs(hedefler[j] - s) <= tol) { yakin = true; break; }
            }
            if (yakin) continue;
            // removeKey'e getKeys'ten gelen NESNE gecilir (bkz. _keyGeriAl notu).
            try { pr.removeKey(kk[i]); silinen++; sildi = true; } catch (e1) {}
            break;   // silme listeyi bozuyor: yeniden oku
        }
        if (!sildi) return silinen;
    }
    return silinen;
}
/* rapor: bos dizi verilirse BASARISIZLIK SEBEPLERI buraya yazilir. Sebep bildirmeyen bir
   "yazilamadi" mesaji her seferinde yeni bir olcum turu gerektiriyordu. */
/* ICSEL BILESEN MI? Motion / Opacity / Time Remapping her klipte hazir gelir ve KLIBIN
   KENDI DURUSUNU tutar. Bunlarin statik degerlerini kopyalamak, ogretilen klibin konumunu
   hedefe tasiyip klibi yerinden oynatiyordu (kullanici bildirdi).
   Preset'in EKLEDIGI efektlerde (Transform vb.) ise statik degerler preset'in ta kendisi:
   Anchor Point, Uniform Scale, Shutter Angle... bunlar kopyalanmazsa animasyon farkli
   merkezden ve farkli ayarla oynuyor (kullanici iki ekran goruntusuyle gosterdi). */
/* TAM ESLESME — "baslıyor/iceriyor" DEGIL.
   Eski hali `a.indexOf("motion") === 0` idi ve "Motion Tile" / "Motion Blur" gibi GERCEK
   efektleri de icsel sayiyordu: o efektlerin statik parametreleri hic yazilmiyor, preset
   onlar icin sessizce hicbir sey yapmiyordu. Icsel bilesenlerin adi tam olarak bunlardir. */
function _icselMi(ad, match) {
    var a = String(ad || "").toLowerCase(), m = String(match || "").toLowerCase(), i;
    var adlar = ["motion", "opacity", "time remapping", "hareket", "opaklık", "opaklik",
                 "zaman yeniden eşleme", "zaman yeniden esleme"];
    for (i = 0; i < adlar.length; i++) if (a === adlar[i]) return true;
    /* matchName SONEK ile eslesir — TAM esitlik ISE YARAMIYORDU: gercek deger
       "AE.ADBE Motion" (olculdu, kullanicinin klibi), yani "adbe motion" ile tam esit
       degil ve bu satirlar OLU KODDU. Dile bagimsiz koruma yalniz boyle calisiyor.
       Sonek "AE.ADBE Motion Tile"i YAKALAMAZ — ilk duzeltmenin amaci korunur. */
    var mler = ["adbe motion", "adbe opacity", "adbe time remapping"];
    for (i = 0; i < mler.length; i++) {
        if (m.length >= mler[i].length &&
            m.substring(m.length - mler[i].length) === mler[i]) return true;
    }
    return false;
}
/* BLEND MODE kopyalama KALDIRILDI (gercek testte BOZUK cikti — kullanici, 6 Agustos 2026).
   Kaynak "Normal" iken hedefte "Color" oluyordu: Opacity'nin statik enum'unu setValue ile
   yazmak guvenilmez — getValue/setValue enum eslesmesi TUTMUYOR (ve dile bagimli). Boylece
   Opacity yeniden TAM icsel: statikleri (Blend Mode dahil) hic yazilmiyor, kaynak neyse o
   kaliyor. Kullanicinin preset'leri (Pop In/Zoom) zaten Normal blend kullaniyor. Gerekirse
   enum degerleri reflect ile OLCULUP dogru eklenmeli — kor kopyalama ARAMA. */
/* SPATIAL (konum) parametresi mi? Position/Anchor Point hedefe FARK olarak yazilir (klibi
   kaynagin koordinatina sicratmamak icin). Renk de [r,g,b,a] dizi doner ama MUTLAK yazilmali
   — yoksa hedefin mevcut rengine gore kayip bozulur. Ayrimi bu fonksiyon yapar: SADECE
   asagidakiler fark-yolu; diger tum dizi degerler (renk dahil) mutlak. */
function _spatialMi(ad) {
    var a = String(ad || "");
    return a === "Position" || a === "Konum" ||
           a === "Anchor Point" || a === "Sabit Nokta";
}
/* SES KLIBI MI? — Premiere'de "Linked Selection" varsayilan ACIK: kullanici bir video
   klibine tiklayinca BAGLI SES parcasi da secime giriyor. Panel onu ayri bir klip sanip
   AYNI goruntuye efekti IKINCI KEZ ekliyordu (pop iki kat, sebebi gorunmez). Ses klipleri
   video efekti de alamaz. Bu yuzden secimden SUZULUR. */
function _sesKlibiMi(ti) {
    var mt = "";
    try { mt = String(ti.mediaType); } catch (e) { return false; }   // okunamazsa eski davranis
    return mt === "Audio";
}
/* HIZ RAMPASI (Time Remapping) preset'e GIRMEZ — ne okunur ne yazilir.
   Hizlandirilmis bir klipten preset ogretilirse hiz egrisi de kaydediliyor ve uygulanan
   HER klip agir cekim/hizli oluyordu. Kullanici "animasyon" ogretiyor, "hiz" degil. */
function _hizRampasiMi(ad, match) {
    var a = String(ad || "").toLowerCase(), m = String(match || "").toLowerCase();
    return a.indexOf("time remapping") !== -1 || a.indexOf("zaman yeniden") !== -1 ||
           m.indexOf("timeremap") !== -1;
}
/* Parametrenin VARSAYILAN varis degeri (klip "normal" durumdayken). null = boyle bir
   varsayilan yok. D10: preset varisi bu degere esitse hedefin kendi durusuna ORANLANIR. */
function _varsayilanVaris(ad) {
    var a = String(ad || "");
    if (a === "Scale" || a === "Scale Height" || a === "Scale Width" ||
        a === "Ölçek" || a === "Olcek" || a === "Opacity" || a === "Opaklık" || a === "Opaklik") return 100;
    if (a === "Rotation" || a === "Döndürme" || a === "Dondurme") return 0;
    return null;
}
/* setValue SESSIZCE hicbir sey yapabiliyor (salt-okunur/tip uyusmazligi). Statik deger
   artik basari olcutu olabildigi (statik-only preset) icin geri okunur. Bazi parametreler
   geri OKUNAMAZ — o zaman TUTTU say (dokunma), yoksa gecerli yazimlar reddedilir. */
function _statikTuttu(pr, beklenen) {
    var v = null, i, nv;
    try { v = pr.getValue(); } catch (e) { return true; }      // okunamiyorsa engelleme
    if (v === null || v === undefined) return true;
    if (_dizimi(beklenen) && _dizimi(v)) {
        if (v.length !== beklenen.length) return false;
        /* Dizi (cogunlukla RENK [r,g,b,a], 0..1) toleransi GEVSEK: setValue(...,true) UI
           guncellemesinde 8-bit yeniden nicemleme yapabiliyor (0.5 -> 0.502, ~1/255=0.004).
           0.001 sikiligi gecerli renk yazimini "tutmadi" sanip statik-only renk preset'inde
           yanlis-negatif ("HICBIR AYAR YAZILAMADI") uretirdi. 0.02 nicemlemeyi tolere eder,
           gercek basarisizlik (deger hic degismez) bundan cok daha buyuk fark birakir. */
        for (i = 0; i < v.length; i++) {
            if (Math.abs(Number(v[i]) - Number(beklenen[i])) > 0.02) return false;
        }
        return true;
    }
    if (typeof beklenen === "number") {
        nv = Number(v);
        if (isNaN(nv)) return true;                            // enum/string olabilir
        return Math.abs(nv - beklenen) < 0.001;
    }
    return String(v) === String(beklenen);
}
/* adaylar : [{baz, arAlt, arUst, ad}] — denenecek zaman tabanlari (kaynak/sekans/klip)
   sayac   : { kf, st, strateji } — KEYFRAME ve STATIK AYRI sayilir. Eskiden statik
             setValue de "keyframe" sayilip "8 keyframe yazildi" yalanini uretiyordu. */
/* capa      : YIGIN capasi (eski kayitlar icin yedek)
   hedefSure : hedef klibin suresi — parametrenin capasi yigininkinden FARKLIYSA zaman
               tabanini bu kadar oteleriz (bkz. asagidaki delta). */
/* kafaVar (11. arguman, istege bagli): "oynatma kafasina uygula" modu. Verilmezse eski
   davranis birebir korunur — eski cagri yerleri icin ES3'te fazladan parametre sorun degil. */
function _paramlariYaz(hedefBilesen, plist, adaylar, rapor, kaynakAd, statikYaz, strateji, sayac, capa, hedefSure, kafaVar, konumAtla) {
    var ps = null, i, j;
    try { ps = hedefBilesen.properties; } catch (e) { if (rapor) rapor.push("properties-yok"); return 0; }
    if (!ps) { if (rapor) rapor.push("properties-bos"); return 0; }
    for (i = 0; i < plist.length; i++) {
        var kayit = plist[i], pr = null;
        /* ⚠ KONUM ATLAMA: cagiran taraf klibi kendisi konumlandirdiysa preset'in Position/
           Anchor Point'i onu EZMEMELI. Yalniz bu iki parametre atlanir; Scale/Opacity ve
           efekt keyframe'leri aynen yazilir (pop-in + shake calismaya devam eder). */
        if (konumAtla && _spatialMi(kayit.ad)) {
            if (rapor) rapor.push((kayit.ad || "?") + " (konum atlandi - cagiran kendi koydu)");
            continue;
        }
        /* ADI BOS parametrede INDEKSE dus (bkz. presetOkuJSON'daki `ix` notu): ada gore
           arama iki adsiz parametreyi ayni ozellige esliyor ve ikincisi birincinin
           uzerine yaziyordu. Eski kayitlarda `ix` yok -> eski davranis. */
        if (!kayit.ad && typeof kayit.ix === "number") {
            try { if (kayit.ix >= 0 && kayit.ix < ps.numItems) pr = ps[kayit.ix]; } catch (eIx) { pr = null; }
        }
        if (!pr) pr = _paramBul(ps, kayit.ad);
        if (!pr) {
            /* Yalniz "param-yok" demek yetmiyordu: hangi bilesende arandigini ve o bilesende
               NE OLDUGUNU da yaz — yanlis bilesene eslesme bu sayede tek bakista gorulur. */
            if (rapor && kayit.kf && kayit.k && kayit.k.length) {
                var hAd = "?"; try { hAd = String(hedefBilesen.displayName); } catch (eH) {}
                var varOlan = [];
                for (j = 0; j < ps.numItems; j++) { try { varOlan.push(String(ps[j].displayName)); } catch (eV) {} }
                /* KAYNAK bileseni de yaz: kayit yanlis hedefe eslestiyse ("Motion" kaydi
                   "Transform"a gitmis gibi) tek bakista gorulsun. */
                rapor.push(kayit.ad + " yok [kaynak: " + (kaynakAd || "?") +
                           " -> hedef: " + hAd + " (" + varOlan.join("/") + ")]");
            }
            continue;
        }

        /* STATIK DEGER: preset'in EKLEDIGI efektlerde (statikYaz) VE her zaman Blend Mode'da.
           Icsel bilesenlerin (Motion/Opacity) statikleri klibin kendi durusudur — yazilmaz
           ama artik GORUNUR atlanir (sessiz kayip yok). setValue sessizce basarisiz
           olabildigi ve statik artik basari olcutu olabildigi icin GERI OKUNUR. */
        if (!(kayit.kf && kayit.k && kayit.k.length)) {
            if (statikYaz && kayit.v !== null && kayit.v !== undefined) {
                /* YALNIZ SAYI ve SAYI DIZISI yazilir. Metin/enum degerler ATLANIR:
                   enum kopyalama olculdu ve BOZUK cikti (Blend Mode "Normal" -> "Color",
                   bkz. _blendModeMu notu), MOGRT/baslik klibinden ogrenilen preset ise
                   hedef basligin YAZISINI eziyordu (Source Text bir metin parametresi). */
                /* TIP kontrolu — Number() donusumune GUVENME: Number("") === 0 ve isNaN(0)
                   false oldugu icin BOS bir metin (Source Text) "sayisal" sayilip yaziliyor
                   ve hedef basligin YAZISINI siliyordu.
                   BOOLEAN DE YAZILIR: kullanicinin gercek kayitlarinda Uniform Scale,
                   "Use Composition's Shutter Angle" ve Crop>Zoom BOOLEAN. Uniform Scale
                   tam olarak CLAUDE.md'de "kopyalanmadigi icin klip dikeyde eziliyordu"
                   diye yazili parametre — disarida birakmak o hatayi geri getirir.
                   Yasak olan yalniz METIN/enum (bkz. Blend Mode olcumu). */
                var sv = kayit.v;
                var tv0 = _dizimi(sv) ? (typeof sv[0]) : (typeof sv);
                var sayisal = (tv0 === "number" || tv0 === "boolean");
                if (!sayisal) {
                    if (rapor) rapor.push(kayit.ad + " (metin/liste ayari, atlandi)");
                } else {
                    try {
                        pr.setValue(sv, true);
                        if (_statikTuttu(pr, sv)) sayac.st++;
                        else if (rapor) rapor.push(kayit.ad + ":statik yazildi ama tutmadi");
                    } catch (eSv) { if (rapor) rapor.push(kayit.ad + ":setValue " + String(eSv)); }
                }
            } else if (!statikYaz && kayit.v !== null && kayit.v !== undefined && rapor) {
                rapor.push(kayit.ad + " (klip kendi ayari, atlandi)");
            }
            continue;
        }

        /* KONUM GIBI DIZI DEGERLI parametreler (Position, Anchor Point) MUTLAK kopyalanamaz:
           kaynak klibin koordinatlari hedefe yazilirsa klip kaynagin yerine sicrar.
           Cozum: keyframe'ler SON keyframe'e (varis noktasi) gore FARK olarak uygulanir ve
           farklar hedefin KENDI mevcut degerine eklenir. Animasyon ayni, varis hedefin
           kendi yeri. Tek sayili degerlerde (Scale, Opacity, Rotation) mutlak dogru olan
           davranistir — %0'dan %100'e pop, hedefte de %0'dan %100'e olmali. */
        /* DIZI-FARK yolu YALNIZ konum (Position/Anchor) icin — renk de dizi doner ama MUTLAK
           yazilmali (bkz. _spatialMi), yoksa hedefin mevcut rengine gore kayip bozulur.
           Konum farkinda varis noktasi hedefin mevcut yerine oturur: capa='son' (cikis) ise
           varis ILK keyframe, 'bas' (giris) ise SON keyframe'dir. */
        /* YAZILACAK LISTE: ORNEKLER varsa onlar (kaynagin ease/hiz egrisini tasiyan tek yol,
           bkz. _egriOrnekle); yoksa seyrek keyframe'lere dus (eski kayitlar + olcum
           yapilamayan parametreler). */
        var kw = (kayit.s && kayit.s.length >= 2) ? kayit.s : kayit.k;

        /* PARAMETRENIN KENDI CIPASI (bkz. presetOkuJSON'daki po.capa notu). Eski kayitlarda
           yok -> yigin capasina duser (onceki davranis).
           ZAMAN TABANI DELTASI: adaylar[].baz yigin capasina gore kuruldu. Parametrenin
           capasi farkliysa taban bir klip suresi kadar otelenmeli — yoksa cikis animasyonu
           klibin BASINA yazilir. */
        var pCapa = kayit.capa || capa || "bas";
        var hs = (typeof hedefSure === "number" && hedefSure > 0) ? hedefSure : 0;
        var capaDelta = 0;
        if (hs && pCapa !== (capa || "bas")) capaDelta = (pCapa === "son") ? hs : -hs;
        /* ⚠ KAFA MODUNDA ZAMANSAL OTELEME YAPILMAZ — HER PARAMETRE KAFAYA YAPISIR.
           presetYaz kafa modunda zamansal cipayi capaOfs = kafaSn - t0 ile kuruyor; capaDelta
           ise AYRI bir zamansal kaydirma ve presetYaz ona kafa modunda oldugunu soylemiyordu.
           Sonuc: cipasi yigininkinden FARKLI olan her parametre kafanin bir KLIP SURESI
           otesine/berisine yaziliyordu. Kullanicinin gercek yigini tam da karisik (ayni yiginda
           hem "Pop In 1" capa=bas hem "Asagiya Pop Out" capa=son — presetOkuJSON'daki not
           bunu olcumle belgeliyor): 10 dakikalik tek parca gameplay klibinde kafayi 02:00'a
           koyup uygulayinca giris keyframe'leri dogru yere, cikis keyframe'leri 02:00+600 sn'ye
           yani klibin DISINA gidiyor ve Premiere onlari sessizce klip sinirina yigiyordu.
           ⚠ YALNIZ capaDelta sifirlanir; pCapa'ya DOKUNULMAZ. pCapa ayni fonksiyonda zamansal
           OLMAYAN iki karar icin daha kullaniliyor (dizi-fark tabani ve D10 oransal olcek
           kapisi); onu notrlemek 3122-3128'de belgelenmis regresyonu geri getirirdi. */
        if (kafaVar) capaDelta = 0;

        var dizi = _dizimi(kw[0].v) && _spatialMi(kayit.ad);
        var taban = null, mevcut = null, kutu = { ilkHata: "", temizlenen: 0 };
        if (dizi) {
            taban = (pCapa === "son") ? kw[0].v : kw[kw.length - 1].v;
            // DINLENME degeri — setTimeVarying'den ONCE (keyframe acilinca deger degisebiliyor)
            mevcut = _dinlenmeDegeri(pr, pCapa);
            /* taban NULL olabilir (getValueAtKey okunamamis key). _dizimi(taban)
               kontrolu OLMADAN taban.length TypeError atip tum presetYaz'i dusuruyordu. */
            if (!_dizimi(taban) || !_dizimi(mevcut) || mevcut.length !== taban.length) dizi = false;
        }

        /* ORANSAL YAZIM (D10) — KUCULTULMUS/YARI SAYDAM/EGIK klipte sicramayi onler.
           Olcek ve opaklik oldugu gibi kopyalaniyordu: preset %100'de bir klipten
           ogrenildigi icin varis degeri 100. Onu %35'e kucultulmus bir overlay'e
           (Ates.webp gibi) uygulayinca animasyon bitince klip BIRDEN tam ekran oluyordu.
           KURAL DAR — pazarlik konusu degil: yalniz preset'in varisi VARSAYILAN deger ise
           (Scale/Opacity 100, Rotation 0) hedefin kendi durusuna oranlanir. Varis 100 DEGILSE
           (bilerek %50'de biten bir 'look' preset'i) hicbir sey degismez, mutlak yazilir.
           Hedef zaten 100/0 ise formul birebir ayni sonucu verir — yaygin durumda etkisiz. */
        var olcek = null;
        if (!dizi && !_dizimi(kw[0].v)) {
            var varsD = _varsayilanVaris(kayit.ad);
            if (varsD !== null) {
                var varis = Number((pCapa === "son") ? kw[0].v : kw[kw.length - 1].v);
                if (!isNaN(varis) && Math.abs(varis - varsD) < 0.5) {
                    var hd = Number(_dinlenmeDegeri(pr, pCapa));
                    if (!isNaN(hd)) {
                        if (varsD === 100 && hd > 0 && Math.abs(hd - 100) > 0.5) olcek = { oran: hd / 100, ek: 0 };
                        else if (varsD === 0 && Math.abs(hd) > 0.5) olcek = { oran: 0, ek: hd };
                    }
                }
            }
        }

        /* TEK HEDEF — bilerek.
           Bir ara "Scale" kaydi hem Scale Height hem Scale Width'e yaziliyordu: Uniform
           Scale statik degeri kopyalanmadigi icin klip dikeyde eziliyordu ve bu bir
           telafiydi. Uniform Scale artik dogru kopyalandigindan (bkz. statikYaz) gereksiz,
           dahasi zararli: kullanici o kutuyu kaldirirsa Width'teki fazladan keyframe'ler
           kaynakta OLMAYAN bir animasyon uretir. Kaynakta ne varsa o yazilir. */
        var tvHata = "";
        var tvOnce = false; try { tvOnce = !!pr.isTimeVarying(); } catch (eTv) {}
        try { pr.setTimeVarying(true); } catch (e3) { tvHata = String(e3); }
        var snap = _keySnapshot(pr);

        /* Strateji (zaman bicimi + taban) klip basina BIR KEZ olculur; sonra butun
           parametrelerde ayni strateji kullanilir. Olcum yapilamazsa adaylar tek tek
           denenir (asagida). Probe ofseti: gercek keyframe'lerin ORTASI. */
        if (strateji && !strateji.olculdu) {
            strateji.olculdu = true;
            var tIlk = kw[0].t, tSon = kw[kw.length - 1].t;
            var pofs = (tIlk + tSon) / 2;
            if (!pofs) pofs = (tIlk < 0) ? -0.01 : 0.25;
            var s0 = _stratejiOlc(pr, adaylar, pofs);
            if (s0) { strateji.baz = s0.baz; strateji.bicim = s0.bicim; strateji.ad = s0.ad; }
        }

        /* Denenecek sira: olculen strateji varsa once o, sonra kalan adaylar.
           Her denemeden ONCE onceki denemenin cop keyframe'leri geri alinir — yoksa
           yanlis tabandaki kirpilmis keyler klipte kalip "tek keyframe" uretiyordu. */
        var gercek = 0, bi, aday, kullanilanAd = "";
        if (strateji && strateji.bicim) {
            gercek = _yazVeSay(pr, kw, dizi, taban, mevcut, strateji.baz + capaDelta, strateji.bicim, kutu, olcek);
            if (gercek) kullanilanAd = strateji.bicim + "/" + (strateji.ad || "?");
        }
        for (bi = 0; bi < adaylar.length && !gercek; bi++) {
            aday = adaylar[bi];
            if (!aday || (strateji && strateji.bicim && aday.baz === strateji.baz)) continue;
            _keyGeriAl(pr, snap);
            gercek = _yazVeSay(pr, kw, dizi, taban, mevcut, aday.baz + capaDelta,
                               (strateji && strateji.bicim) ? strateji.bicim : null, kutu, olcek);
            if (gercek) kullanilanAd = ((strateji && strateji.bicim) ? strateji.bicim : "oto") + "/" + aday.ad;
        }

        if (gercek) {
            sayac.kf += gercek;
            if (kutu.temizlenen) sayac.temiz += kutu.temizlenen;
            if (!sayac.strateji && kullanilanAd) sayac.strateji = kullanilanAd;
            // Kismi basari da bildirilmeli: 13 key'in 1'i kondugunda animasyon yine olmuyor.
            if (rapor && gercek < kw.length) {
                rapor.push(kayit.ad + ": " + gercek + "/" + kw.length + " keyframe kondu" +
                           (kutu.ilkHata ? " [" + kutu.ilkHata + "]" : ""));
            }
        } else {
            _keyGeriAl(pr, snap);                       // hicbiri tutmadi: COP BIRAKMA
            /* Kronometreyi de geri al — ama YALNIZ girise gore kapaliydiysa ve key
               listesi okunabiliyorsa. Okunamiyorsa dokunma: yazilmis ama dogrulanamamis
               keyframe'leri silmis olabiliriz. */
            if (!tvOnce && snap !== null) { try { pr.setTimeVarying(false); } catch (eT2) {} }
            if (rapor) {
                rapor.push(kayit.ad + ":keyframe KONMADI [" + (kutu.ilkHata || "sessiz") + "]" +
                           (tvHata ? " setTimeVarying(" + tvHata + ")" : ""));
            }
        }
    }
    return sayac.kf;
}

/* DOSYA DUZEYINDE — bilerek. Bu fonksiyon _paramlariYaz'in for govdesinin ICINDE
   tanimliydi; ES3'te blok ici function deklarasyonu TANIMSIZ DAVRANIS ve her turda
   yeniden baglanan closure (kayit/dizi/taban/mevcut/pr) kirilgandi.
   Donus: GERCEKTEN olusan keyframe sayisi. Iki sart birden aranir:
     1. _keyEkleD hatasiz dondu (addKey + setValueAtKey ikisi de tuttu)
     2. Geri okumada hedef zamanda key VAR ve klip araliginda
   Eslesen key TUKETILIR (kk[w] = null): 40 ms'den yakin iki kaynak key ayni gercek key'le
   eslesip sayiyi ikiye katliyordu. */
function _yazVeSay(pr, klist, dizi, taban, mevcut, bazZaman, bicim, kutu, olcek) {
    var y = 0, q, w, kk, sz, hedefZ, vv, na, mm, sonuc = [], hedefler = [];
    for (q = 0; q < klist.length; q++) {
        vv = klist[q].v;
        /* NULL DEGER KORUMASI: getValueAtKey okunamadiginda kayitta v=null kaliyor.
           Korumasiz birakildiginda vv[mm] TypeError atip TUM presetYaz'i dusuruyordu. */
        if (vv === null || vv === undefined) {
            if (!kutu.ilkHata) kutu.ilkHata = "okunamamis keyframe degeri (null)";
            /* hedefler[] `sonuc[]` ile AYNI INDEKSTE kalmak ZORUNDA — atlanan dalda da
               push yapilir. Eskiden atlanip sikisiyordu ve asagidaki dogrulama dongusu
               hedefler[q] ile yanlis zamani okuyup tek imleci gercek key'lerin otesine
               itiyordu: sayim 0'a dusuyor, _keyGeriAl DOGRU yazilmis key'leri siliyor ve
               kullanici "HIC KEYFRAME KONMADI" goruyordu (v=null iceren ESKI kayitlarda). */
            hedefler.push(null); sonuc.push("deger-yok"); continue;
        }
        if (dizi) {
            if (!_dizimi(vv) || vv.length !== taban.length) {
                if (!kutu.ilkHata) kutu.ilkHata = "keyframe degeri beklenen dizi degil";
                hedefler.push(null); sonuc.push("tip-uyusmaz"); continue;   // indeks hizasi SART
            }
            na = [];
            for (mm = 0; mm < taban.length; mm++) na.push(mevcut[mm] + (vv[mm] - taban[mm]));
            vv = na;
        } else if (olcek) {
            /* ORANSAL/TOPLAMSAL yazim (bkz. _paramlariYaz'daki olcek notu): kucultulmus
               ya da yari saydam klipte animasyon hedefin KENDI durusuna gore olceklenir. */
            var nv = Number(vv);
            if (!isNaN(nv)) vv = olcek.oran ? (nv * olcek.oran) : (nv + olcek.ek);
        }
        hedefZ = bazZaman + klist[q].t;
        hedefler.push(hedefZ);
        sonuc.push(_keyEkleD(pr, hedefZ, vv, bicim, klist[q].it));
        if (sonuc[q] !== "" && !kutu.ilkHata) kutu.ilkHata = sonuc[q];
    }
    kk = null; try { kk = pr.getKeys(); } catch (eG) { kk = null; }
    if (!kk) return 0;
    /* TOLERANS VERIDEN TURETILIR — sabit 0.02 ARTIK YANLIS.
       Ornekleme (baking) ile keyframe'ler birbirine cok yakin olabiliyor (kare hizinda:
       30 fps'te 0.033 sn). Sabit 0.02 tolerans ornek araligini asarsa bir ornek KOMSU
       ornegin key'iyle eslesir: sayim yanilir, "N/M keyframe kondu" hayalet uyarisi cikar
       ve setValueAtKey patlayip geride kalan YANLIS DEGERLI key "kondu" diye sayilir.
       Kural: tolerans < ornek araligi / 2. */
    var tol = 0.02, dt, minAr = 0;
    for (q = 1; q < klist.length; q++) {
        dt = Math.abs(klist[q].t - klist[q - 1].t);
        if (dt > 0 && (minAr === 0 || dt < minAr)) minAr = dt;
    }
    if (minAr > 0 && minAr * 0.45 < tol) tol = minAr * 0.45;
    if (tol < 0.002) tol = 0.002;    // tick cozunurlugu + yuvarlama payi
    /* Zamanlar BIR KEZ okunur ve siralanir: eskiden her hedef icin butun key listesi
       _zamanSn ile yeniden taraniyordu (N=300'de ~90.000 cagri, ExtendScript'te saniyeler).
       Iki liste de sirali oldugu icin tek imlecle (p) ilerlemek yeterli. */
    var sk = [];
    for (w = 0; w < kk.length; w++) {
        sz = _zamanSn(kk[w]);
        if (!isNaN(sz)) sk.push(sz);
    }
    sk.sort(function (a, b) { return a - b; });
    var p = 0;
    for (q = 0; q < klist.length; q++) {
        if (sonuc[q] !== "") continue;                       // SART 1
        hedefZ = hedefler[q];
        if (hedefZ === null) continue;
        while (p < sk.length && sk[p] < hedefZ - tol) p++;   // gerideki key'leri tuket
        if (p < sk.length && Math.abs(sk[p] - hedefZ) <= tol) { y++; p++; }   // SART 2
    }
    /* BASARILI yazimdan sonra eski/yabanci keyframe'leri temizle (bkz. _yabanciKeyTemizle).
       y === 0 ise cagiran taraf zaten _keyGeriAl ile her seyi geri aliyor — orada temizlik
       YAPILMAZ, yoksa basarisiz bir denemede kullanicinin kendi key'leri silinirdi.
       BASARISIZ yazimlarin zamanlari da listede KALIR (null'lar haric): addKey tutup
       setValueAtKey patlamis olabilir — orada YANLIS DEGERLI bir key durur, onu da
       "bizim" sayip korumak dogru degil ama silmek de degil; zaman listesinde tutmak
       temizligin o noktayi yabanci sanip silmesini onler. */
    if (y > 0) {
        var tmzList = [], tq;
        for (tq = 0; tq < hedefler.length; tq++) if (hedefler[tq] !== null) tmzList.push(hedefler[tq]);
        var tmz = _yabanciKeyTemizle(pr, tmzList, tol);
        if (tmz && kutu) kutu.temizlenen = (kutu.temizlenen || 0) + tmz;
    }
    return y;
}
/* Panelin yazdigi JSON dosyasindan okur ve SECILI kliplere uygular.
   Metin DOSYADAN geciyor, evalScript string literalinden DEGIL — proje geneli kural. */
/* Animasyonun CIPADAN ITIBAREN uzanimi (klip-yerel), ILERI ve GERI AYRI.
   YAYILIM (mx-mn) DEGIL: sigdirma icin gereken sey, capanin oldugu noktadan animasyonun
   ne kadar UZAGA gittigidir. Cipadan uzakta baslayan bir preset'te (or. keyler 0.5..1.5)
   yayilim 1.0 ama gercek ihtiyac 1.5 — yayilima bakan bir esik sigdirmayi hic
   tetiklemiyor ve son keyframe klip disina dusuyordu.
     capa='bas' -> 0'dan ileriye  : max(t, 0)
     capa='son' -> 0'dan geriye   : max(-t, 0)   (o kayitta zamanlar negatif)

   ⚠ ESKI `_yiginSure` KALDIRILDI — GERI EKLEME. O fonksiyon butun parametrelerin zamanlarini
   TEK bir mn/mx ciftinde topluyor ve yalniz YIGIN capasinin yonune bakiyordu; p.capa'ya
   (parametre basina cipa) hic bakmiyordu. Ama kullanicinin gercek yiginlari KARISIK: ayni
   yiginda hem giris (zamanlar 0..+0.5) hem cikis (zamanlar -0.6..0) parametreleri var.
   veri.capa === "bas" oldugunda eski fonksiyon yalniz max(mx,0) = 0.5 donduruyor, -0.6'lik
   GERI uzanimi hic gormuyordu. Olculen sonuc: 0.55 sn'lik bir AutoCut klibinde 0.5 >
   0.55*0.95 yanlis oldugu icin sigdirma HIC tetiklenmiyor; cikis parametresinin ilk
   keyframe'i klibin BASLANGICINDAN ONCEYE dusuyor, Premiere onu sinira kirpiyor ve cikis
   animasyonu tek keyframe'e cokuyordu — panel yine "uygulandi" diyordu.
   Ters yondeki kucuk tasmalar (or. "son" cipali bir parametrenin pozitif zamani) bilerek
   yok sayiliyor; eski davranis da oyleydi, bu bir gerileme degil.
   ⚠ Fonksiyon SILINDI, "duruyor ama cagrilmiyor" olarak BIRAKILMADI: tam da bu hatanin
   kaynagiydi ve elde durursa yeni bir cagri yeri sessizce ayni hataya duser. */
function _yiginUzanim(veri) {
    var ileri = 0, geri = 0, bi, pi, ki, plist, l, q, pCapa, t;
    for (bi = 0; bi < veri.bilesenler.length; bi++) {
        plist = veri.bilesenler[bi].p || [];
        for (pi = 0; pi < plist.length; pi++) {
            pCapa = plist[pi].capa || veri.capa || "bas";
            for (q = 0; q < 2; q++) {
                l = q ? plist[pi].s : plist[pi].k;
                if (!l) continue;
                for (ki = 0; ki < l.length; ki++) {
                    t = l[ki].t;
                    if (typeof t !== "number" || isNaN(t)) continue;
                    if (pCapa === "son") { if (-t > geri) geri = -t; }
                    else { if (t > ileri) ileri = t; }
                }
            }
        }
    }
    return { ileri: ileri, geri: geri };
}
/* Butun keyframe/ornek zamanlarini K katiyla olcekle (kisa klibe sigdirma). */
function _yiginOlcekle(veri, k) {
    var bi, pi, ki, plist, l, q;
    for (bi = 0; bi < veri.bilesenler.length; bi++) {
        plist = veri.bilesenler[bi].p || [];
        for (pi = 0; pi < plist.length; pi++) {
            for (q = 0; q < 2; q++) {
                l = q ? plist[pi].s : plist[pi].k;
                if (!l) continue;
                for (ki = 0; ki < l.length; ki++) l[ki].t = l[ki].t * k;
            }
        }
    }
}
/* kafaKullan "1" ise animasyon OYNATMA KAFASININ oldugu ana yapisir (klibin basi/sonu
   yerine). Kafa zamanini host KENDISI okur — panelden sayi gecirmek (ondalik bicim,
   evalScript string'i) gereksiz risk. Verilmezse eski davranis aynen korunur. */
/* emojiKanal (istege bagli): verilirse hedef klipler SECIMDEN degil O KANALIN TAMAMINDAN
   alinir — emoji yerlestirmesi kendi kanalindaki butun kliplere preset uygulayabilsin diye.
   Verilmezse davranis birebir eskisi gibi (getSelection). */
/* ⚠ 4. ARGUMAN konumAtla — SHORTS ICIN (kullanici, 11 Agustos 2026: "emoji sag taraf olayi
   olmasin ... tam ortada dursun"). Kullanicinin "Emoji Sag Taraf" preseti YATAY video icin
   ogretilmis ve icinde Position var; Shorts'ta panel emojiyi ortaya koyuyor, preset onu
   SAGA itiyordu. "1" verilince Position/Anchor Point YAZILMAZ, pop-in ve shake gibi
   Scale/Opacity/efekt animasyonlari aynen gecer. */
function presetYaz(jsonYol, kafaKullan, emojiKanal, konumAtla) {
    /* UNDO GRUBU: bir preset onlarca keyframe yaziyor. Grup olmadan Ctrl+Z bunlari TEK TEK
       geri aliyor ve kullanicinin 30-40 kez basmasi gerekiyordu. finally ile kapatiliyor —
       arada hata olursa grup ACIK kalir ve kullanicinin sonraki her duzenlemesi ayni gruba
       yazilir; tek Ctrl+Z saatlerce suren isi geri alirdi (bkz. autoCut'taki ayni not). */
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Preset"); _ug = true; } catch (eug) {}
    try {
        var veri = null;
        try { veri = JSON.parse(_readFileUTF8(jsonYol)); } catch (eR) { return "err:Kayitli preset okunamadi: " + eR.toString(); }
        if (!veri || !veri.bilesenler || !veri.bilesenler.length) return "err:Kayitli preset bos";
        /* Yiginda HIC keyframe yoksa uygulamanin anlami yok — ve dogru mesaj "yeniden ogret".
           Statik degerler artik yazilmadigi icin boyle bir yigin sessizce hicbir sey yapar
           ve kullanici sebebini "hicbir parametre yazilamadi" diye gorurdu. */
        var kfSay = 0, stSay = 0, bi, pi, plist, bIc;
        for (bi = 0; bi < veri.bilesenler.length; bi++) {
            plist = veri.bilesenler[bi].p || [];
            bIc = _icselMi(veri.bilesenler[bi].ad, veri.bilesenler[bi].match);
            for (pi = 0; pi < plist.length; pi++) {
                if (plist[pi].kf && plist[pi].k && plist[pi].k.length) kfSay++;
                else if (!bIc && plist[pi].v !== null && plist[pi].v !== undefined) stSay++;   // uygulanabilir statik (dis bilesen)
            }
        }
        /* Statik-only preset (animasyonsuz look/renk/blur/crop) ARTIK desteklenir: keyframe
           yoksa bile uygulanabilir statik varsa devam. Ikisi de yoksa gercekten yapacak sey
           yok — dogru mesaj 'yeniden ogret'. */
        if (!kfSay && !stSay) return "err:Kayitli preset'te uygulanacak hicbir sey yok (ne keyframe ne statik ayar) — preset'in uygulandigi bir klibi secip YENIDEN OGRET";
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        /* HEDEF KLIPLER — normalde SECIM, emoji yolunda VERILEN KANALIN TAMAMI.
           Emoji klipleri yeni konuyor ve secili degil; kullanicinin kendi presetini
           ("Emoji Sag Taraf": Transform pop giris + asagi kayarak cikis) her emojiye elle
           uygulamasi 150+ tiklama olurdu.
           ⚠ DEGISEN TEK SEY BU DIZININ NASIL KURULDUGU. Asagidaki her sey (_sesKlibiMi,
           _klipBas, _qeKlipBul, _paramlariYaz...) TrackItem uzerinde calisiyor ve
           vt.clips[j] ile getSelection()[i] AYNI tipte nesneler donduruyor — 5-lensli
           denetimden gecmis cekirdege dokunulmuyor. */
        var sec = null;
        if (emojiKanal !== undefined && emojiKanal !== null && String(emojiKanal) !== "") {
            var ek = parseInt(emojiKanal, 10);
            if (isNaN(ek) || ek < 0 || ek >= seq.videoTracks.numTracks) return "err:V" + (ek + 1) + " kanali yok";
            var evt = seq.videoTracks[ek];
            sec = [];
            try { for (var eq = 0; eq < evt.clips.numItems; eq++) sec.push(evt.clips[eq]); } catch (eEq) {}
            if (!sec.length) return "err:V" + (ek + 1) + " kanalinda klip yok";
        } else {
            try { sec = seq.getSelection(); } catch (eS) {}
            if (!sec || !sec.length) return "err:Timeline'da klip secili degil";
        }

        /* HIZ RAMPASI eski kayitlarda olabilir — uygulama aninda da suzulur (bkz.
           _hizRampasiMi). Aksi halde eski bir kayit her klibi agir cekim yapardi. */
        /* NOT: eski `var animSure = _yiginSure(veri);` KALDIRILDI — sigdirma artik iki yonu
           ayri olcen _yiginUzanim ile klip dongusunun icinde hesaplaniyor. */
        var kafaVar = (String(kafaKullan) === "1"), kafaSn = 0;
        if (kafaVar) {
            try { kafaSn = _zamanSn(seq.getPlayerPosition()); } catch (eKf) { kafaSn = NaN; }
            if (isNaN(kafaSn)) return "err:Oynatma kafasinin yeri okunamadi";
        }

        var ok = 0, toplamYaz = 0, toplamStatik = 0, toplamTemiz = 0, hata = [], i, j, sonStrateji = "";
        var sesAtlandi = 0, sigdirildi = 0, kafaDisi = 0, denenen = 0;
        for (i = 0; i < sec.length; i++) {
            // Bagli ses klibi (Linked Selection) — video efekti alamaz, ATLA.
            if (_sesKlibiMi(sec[i])) { sesAtlandi++; continue; }
            denenen++;
            var ti = sec[i], t0 = _klipBas(ti), eksik = [], nedenler = {}, rapor = [];
            /* ZAMAN HESABI — iki ayri soru, ikisi de OGRENIRKEN olculdu:
                 capa  : animasyon klibin BASINA mi SONUNA mi yapisik (bas | son)
                 taban : API keyframe zamanini SEKANS mi KLIP-YEREL mi bekliyor
               Once cipa ile klip ICINDEKI konum bulunur, sonra API tabanina cevrilir.
               Eski kayitlarda alanlar yok -> bas/sekans varsayilir (onceki davranis). */
            var hedefSon = _zamanSn(ti.end);
            var hedefSure = (!isNaN(hedefSon) && hedefSon > t0) ? (hedefSon - t0) : 0;

            /* KAFAYA UYGULA (istege bagli, kafaOfsSn verilirse): animasyon klibin basina
               ya da sonuna degil OYNATMA KAFASININ oldugu ana yapisir — gameplay kaydi
               5-20 dakikalik tek parca oldugu icin vurgu preset'leri ancak boyle
               kullanilabiliyor. Kafa bu klibin ICINDE degilse klip ATLANIR: sessizce klip
               basina dusmek "hepsi ayni yere kondu" surprizi olurdu. */
            var vk = veri, capaOfs;
            if (kafaVar) {
                if (kafaSn < t0 - 0.001 || kafaSn > t0 + hedefSure + 0.001) { kafaDisi++; denenen--; continue; }
                capaOfs = kafaSn - t0;                       // klip-yerel ofset
            } else {
                capaOfs = (veri.capa === "son" && hedefSure > 0) ? hedefSure : 0;
            }

            /* KISA KLIBE SIGDIR: AutoCut'tan cikan klipler 0.2-0.5 sn. 1 sn'lik bir pop
               preset'inin keyframe'lerinin yarisi klip DISINA dusuyor ve Premiere onlari
               hata vermeden klip sinirina YIGIYOR — animasyon yarida kesilip sonunda
               ziplıyor. YALNIZ kucultme yonunde (asla uzatma). capa='son'da zamanlar
               negatif oldugu icin ayni carpim dogru calisir.
               Yigin PAYLASILIYOR: olceklenecekse KOPYASI alinir, yoksa sonraki klipler de
               kuculurdu. */
            /* Kullanilabilir alan CIPANIN YONUNE gore: 'bas' capasinda animasyon capadan
               ILERI, 'son' capasinda GERI uzaniyor. Kafa modunda capa klibin icinde bir
               nokta oldugu icin iki yon farkli miktarda yer birakir. */
            /* ⚠ IKI YON AYRI OLCULUR, KATSAYI IKISININ KUCUGUDUR.
               Eskiden tek bir `kullanSure` vardi ve karisik cipali yiginda yalniz bir yonu
               goruyordu (bkz. _yiginUzanim). Odalar parametrenin ETKIN cipasina gore:
                 · Kafa modunda cipa klibin ICINDE bir nokta -> ileri odasi kafadan klip
                   sonuna, geri odasi kafadan klip basina kadar.
                 · Kafa modu DISINDA capaDelta "son" parametrelerini klip sonuna, "bas"
                   parametrelerini klip basina cipaliyor, yani iki yonun de odasi hedefSure.
               (Yigin capasina gore tek bir oda hesaplamak yanlisti: capa "bas" iken capaOfs=0
               oldugu icin "geri odasi = capaOfs" gibi bir olcut HER geri uzanimda tetiklenip
               katsayiyi sifira cekerdi — butun keyframe'ler tek ana cokerdi.) */
            var uz = _yiginUzanim(veri);
            var ileriOda = kafaVar ? (hedefSure - capaOfs) : hedefSure;
            var geriOda  = kafaVar ? capaOfs : hedefSure;
            var kOl = 1;
            if (uz.ileri > 0 && ileriOda > 0.02 && uz.ileri > ileriOda * 0.95)
                kOl = Math.min(kOl, (ileriOda * 0.9) / uz.ileri);
            if (uz.geri > 0 && geriOda > 0.02 && uz.geri > geriOda * 0.95)
                kOl = Math.min(kOl, (geriOda * 0.9) / uz.geri);
            if (kOl < 1) {
                try {
                    vk = JSON.parse(JSON.stringify(veri));
                    _yiginOlcekle(vk, kOl);
                    sigdirildi++;
                } catch (eKop) { vk = veri; }   // kopyalanamadiysa eski davranis
            }
            var t0Kaynak = _klipKaynakBas(ti);
            /* UC ADAY. Onceden yalniz ikisi vardi (sekans, klip) ve Adobe belgelerinin
               soyledigi KAYNAK MEDYA tabani (inPoint) hic denenmiyordu — kirpilmis
               kliplerde ve resim ogelerinde dogru taban aday kumesinde YOKTU.
               Her adayin klip araligi da tasiniyor: probe'un "tuttu" demesi ancak key
               bu araliga dustuyse gecerli (yoksa geri okuma totoloji olur). */
            var adaySekans = { baz: capaOfs + t0,       arAlt: t0,       arUst: t0 + hedefSure,       ad: "sekans" };
            var adayKaynak = { baz: capaOfs + t0Kaynak, arAlt: t0Kaynak, arUst: t0Kaynak + hedefSure, ad: "kaynak" };
            var adayKlip   = { baz: capaOfs,            arAlt: 0,        arUst: hedefSure,            ad: "klip"   };
            var adaylar = (veri.taban === "klip")   ? [adayKlip, adayKaynak, adaySekans]
                        : (veri.taban === "kaynak") ? [adayKaynak, adaySekans, adayKlip]
                        :                             [adayKaynak, adaySekans, adayKlip];
            // Zaman bicimi + taban KLIP BASINA BIR KEZ olculur (bkz. _stratejiOlc).
            var strateji = { olculdu: false, baz: null, bicim: null, ad: "" };
            var sayac = { kf: 0, st: 0, temiz: 0, strateji: "" };
            var trIdx = -1, nid = "", basSn = _zamanSn(ti.start);
            try { trIdx = parseInt(ti.parentTrackIndex, 10); } catch (eT) {}
            try { nid = String(ti.nodeId); } catch (eNi) {}

            /* IKI GECIS — SART.
               1. gecis: eksik efektlerin HEPSI eklenir.
               2. gecis: klip SIFIRDAN alinip parametreler yazilir.
               Tek gecişte olmuyordu: QE ile eklenen efekt, elimizdeki (bayat) klip
               nesnesinin components'inde gorunmuyor ve "eklendi ama okunamadi" cikiyordu. */
            /* AYNI EFEKTTEN BIRDEN COK — SAYIYLA EKLENIR, TEK TEK "VAR MI" DIYE DEGIL.
               ⚠ Bu bir kez yanlis yazildi ve kullanici bildirdi (7 Agustos 2026): yiginda iki
               Transform vardi (Pop In + Pop Out), hedefe YALNIZ BIRI ekleniyordu.
               Sebep: kayitlar tek tek geziliyordu ve ikinci Transform kaydi, BIRINCI kayit
               icin AZ ONCE EKLENEN Transform'u gorup "zaten var" diyip geciyordu. Indeks
               takibi (varOlanIx) bunu kurtarmiyor cunku o indeks hic push edilmemis oluyor.
               Dogru soru "bu efekt var mi" degil, "bu efektten KAC TANE gerekiyor":
               gereken - mevcut kadar eklenir. Indeks takibine hic gerek kalmaz. */
            var gereken = {}, turSira = [], anah, g, ek;
            for (j = 0; j < vk.bilesenler.length; j++) {
                var b0 = vk.bilesenler[j];
                if (_hizRampasiMi(b0.ad, b0.match)) continue;      // hiz rampasi uygulanmaz
                if (_icselMi(b0.ad, b0.match)) continue;           // Motion/Opacity klipte hazir
                // Ayirici: ad ya da matchName icinde GECMEYECEK bir dizgi olmali.
                anah = String(b0.match || "") + " <> " + _sadeAd(b0.ad || "");
                if (!gereken[anah]) { gereken[anah] = { sayi: 0, ad: b0.ad, match: b0.match }; turSira.push(anah); }
                gereken[anah].sayi++;
            }
            for (j = 0; j < turSira.length; j++) {
                g = gereken[turSira[j]];
                var varOlan = _bilesenSay(ti, g.match, g.ad);
                for (ek = varOlan; ek < g.sayi; ek++) {
                    var n0 = _qeEfektEkle(ti, g.ad);
                    if (n0) { nedenler[g.ad || "?"] = n0; break; }   // katalogda yoksa tekrar deneme
                }
            }
            var taze = _klipYenidenBul(trIdx, nid, basSn) || ti;

            /* Kullanilmis bilesen indeksleri: ayni hedef bileseni iki kayit icin kullanma.
               Klipte ayni efektten iki tane olabiliyor ve ikisi de ayni matchName'i tasiyor. */
            var kullanilan = [];
            for (j = 0; j < vk.bilesenler.length; j++) {
                var b = vk.bilesenler[j];
                if (_hizRampasiMi(b.ad, b.match)) continue;   // hiz rampasi uygulanmaz
                var ix = _bilesenIndexAra(taze, b.match, b.ad, kullanilan);
                if (ix < 0) {
                    var ad0 = b.ad || "?";
                    eksik.push(ad0 + " [" + (nedenler[ad0] || "eklendi ama okunamadi") + "]");
                    continue;
                }
                kullanilan.push(ix);
                /* fx ac/kapa: yalniz kaynakta KAPALI ise dokun (varsayilan acik; eski
                   kayitlarda enabled tanimsiz -> geriye uyumlu). */
                if (b.enabled === false) { try { taze.components[ix].enabled = false; } catch (eEn) {} }
                /* capa HER ZAMAN kayittan gelir — kafa modunda da EZILMEZ.
                   _paramlariYaz'da capa ZAMANSAL yerlesim icin DEGIL, "dinlenme/varis
                   noktasi hangi keyframe" sorusu icin kullaniliyor (spatial taban ve D10
                   olcek kapisi). Zamansal yerlesim zaten capaOfs ile ayri hallediliyor.
                   Ezildiginde: cikis preset'i + kafa birlesiminde spatial taban ters
                   seciliyor (klip kaynagin GITTIGI yere sicriyor) ve D10 kapisi hic
                   acilmiyor (kucultulmus klip animasyon basinda %100'e firliyor). */
                /* 11. arguman kafaVar: kafa modunda parametre capasi ZAMANSAL oteleme
                   uretmesin (bkz. _paramlariYaz'daki capaDelta notu). capa'nin kendisi yine
                   kayittan gelir — yalniz zamansal delta sifirlanir. */
                _paramlariYaz(taze.components[ix], b.p, adaylar, rapor, b.ad,
                              !_icselMi(b.ad, b.match), strateji, sayac, veri.capa, hedefSure, kafaVar,
                              (String(konumAtla) === "1"));
            }
            var ad = "?"; try { ad = String(ti.name); } catch (eN) {}
            toplamYaz += sayac.kf; toplamStatik += sayac.st; toplamTemiz += sayac.temiz;
            if (sayac.strateji) sonStrateji = sayac.strateji;

            /* BASARI OLCUTU KEYFRAME — statik degil.
               Eskiden `if (yaz)` idi ve `yaz` statikleri de sayiyordu: Transform tabanli
               bir presette 8 statik yazilip SIFIR keyframe konsa bile klip "basarili"
               sayiliyor, teshis dali hic calismiyor ve rapordaki "keyframe KONMADI"
               satirlari kullaniciya HIC ulasmiyordu. */
            /* BASARI TURE BAGLI: animasyonlu preset (kfSay>0) icin en az 1 KEYFRAME sart —
               eski anti-maskeleme korunur (statik yazilsa bile key konmadiysa HATA, boylece
               '8 statik yazildi, basarili' yalani uretilmez). Statik-only preset (kfSay==0)
               icin en az 1 STATIK yeterli. */
            var animasyonlu = (kfSay > 0);
            var basarili = animasyonlu ? (sayac.kf > 0) : (sayac.st > 0);
            if (basarili) {
                ok++;
                var uyari = [];
                if (eksik.length) uyari.push("eklenemeyen efekt: " + eksik.join(", "));
                // Kismi basari da gorunsun: 13 key'in 1'i kondugunda animasyon yine olmaz.
                if (rapor.length) uyari.push(rapor.slice(0, 4).join(" ; "));
                if (uyari.length) hata.push(ad + " -> " + uyari.join(" | "));
            } else {
                hata.push(ad + " -> " + (animasyonlu ? "HIC KEYFRAME KONMADI" : "HICBIR AYAR YAZILAMADI") +
                          (sayac.st ? (" (" + sayac.st + " statik deger yazildi)") : "") +
                          (eksik.length ? " | eksik: " + eksik.join(", ") : "") +
                          (rapor.length ? " | SEBEP: " + rapor.slice(0, 4).join(" ; ") : ""));
            }
        }
        if (!ok) {
            if (!denenen && kafaDisi) return "err:Oynatma kafasi secili kliplerin hicbirinin uzerinde degil — kafayi klibin uzerine tasi";
            if (!denenen && sesAtlandi) return "err:Yalniz ses klibi secili — video klibi sec";
            return "err:" + (hata[0] || "uygulanamadi");
        }
        /* SAYILAR DURUST — "kacinda OLMADI" da yazilir.
           Eskiden 20 klipten 1'i tutsa bile mesaj yesil "uygulandi" idi; kullanici eksigi
           ancak render'dan sonra fark ediyordu (en pahali hata). Simdi orani basa koyuyoruz.
           Sayilar GERCEK: her keyframe geri okunarak dogrulandi. Strateji etiketi de
           yaziliyor (or. "time/kaynak") — bir daha bozulursa hangi bicim/tabanla
           calisildigi tek bakista gorulur, tahmin turlarina donulmez. */
        var basSat = "ok:" + ok + "/" + denenen + " klibe uygulandi";
        if (ok < denenen) basSat += " — " + (denenen - ok) + " klipte OLMADI";
        var notlar = [];
        if (sesAtlandi) notlar.push(sesAtlandi + " ses klibi atlandi");
        if (kafaDisi) notlar.push(kafaDisi + " klip kafanin disinda kaldi");
        if (sigdirildi) notlar.push(sigdirildi + " klip kisa oldugu icin animasyon sigdirildi");
        if (toplamTemiz) notlar.push(toplamTemiz + " eski keyframe temizlendi");
        return basSat + " (" + toplamYaz + " keyframe" +
               (toplamStatik ? (" + " + toplamStatik + " statik") : "") +
               (sonStrateji ? (", " + sonStrateji) : "") + ")" +
               (notlar.length ? " | " + notlar.join(" · ") : "") +
               (hata.length ? " | UYARI: " + hata.join(" ; ") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/* Panelden cagrilan giris noktasi. tur: simdilik yalniz "popin".
   Yeni animasyon eklemek = yeni bir _xxx fonksiyonu + buraya bir satir. */
function animasyonUygula(tur, sureSn) {
    // Undo grubu: tek Ctrl+Z butun keyframe'leri geri alsin (bkz. presetYaz notu).
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Animasyon"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var sec = null;
        try { sec = seq.getSelection(); }
        catch (eS) { return "err:Secim okunamadi: " + eS.toString(); }
        if (!sec || !sec.length) return "err:Timeline'da klip secili degil. Bir klip sec ve tekrar bas.";

        var sure = parseFloat(sureSn);
        if (!(sure > 0)) sure = 0.4;
        var ok = 0, hata = [], i, r, ad, sesAtlandi = 0;
        for (i = 0; i < sec.length; i++) {
            /* ⚠ BAGLI SES KLIBI SUZULUR — AYNI HATANIN UCUNCU HALI.
               Premiere'de Linked Selection VARSAYILAN ACIK: video klibine tiklayinca bagli ses
               de getSelection()'a giriyor. efektUygula (1895) ve presetYaz (3025) bu suzgeci
               yillar once eklemis, animasyonUygula'ya HIC eklenmemisti. Ses klibinde Scale/
               Opacity olmadigi icin _popIn "olcek/opaklik parametresi yok — icerik: …" donuyor
               ve panel TEK bir video klibine basildiginda bile "ok:1 klibe uygulandi | 1 klipte
               OLMADI: <ses klibi> -> … <klibin butun bilesen dokumu>" diyordu. Animasyon aslinda
               dogru uygulanmisken kullanici islemi bozuk saniyordu.
               ⚠ Basari mesajina "N ses klibi atlandi" YAZILMAZ: app.js sonucGoster "atlandi"
               alt dizgisini kismi basari sayip SARI basiyor — yani not eklemek tam da
               kaldirdigimiz yanlis uyariyi geri getirirdi. efektUygula'daki gibi sessiz atla;
               sayac yalniz "hic video klibi yoktu" mesajinda kullanilir. */
            if (_sesKlibiMi(sec[i])) { sesAtlandi++; continue; }
            r = "bilinmeyen animasyon: " + tur;
            if (String(tur) === "popin") r = _popIn(sec[i], sure);
            if (r === "ok") { ok++; continue; }
            ad = "?";
            try { ad = String(sec[i].name); } catch (eN) {}
            hata.push(ad + " -> " + r);
        }
        if (!ok && sesAtlandi && !hata.length)
            return "err:Yalniz ses klibi secili — video klibi sec (Linked Selection acikken ses de secime giriyor).";
        if (!ok) return "err:" + (hata[0] || "uygulanamadi");
        return "ok:" + ok + " klibe uygulandi" +
               (hata.length ? " | " + hata.length + " klipte OLMADI: " + hata.join(" ; ") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

/* ⚠ ACILISI SINA, KAPATMAYI GARANTI ET, "null" DIZGISI URETME.
   Eski hali open()'in donusune bakmiyordu: ExtendScript'te File.open() basarisiz olunca
   false doner ve acilmamis dosyada read() icerik yerine null verir. Fonksiyon bunu ayirt
   etmedigi icin cagiranlar String(null) === "null" ile calisiyordu. Somut sonucu
   addCaptionsToTimeline'da gorunuyordu: panel ".stil" dosyasini ARTIK HIC YAZMIYOR (bkz.
   CLAUDE.md), yani o okuma her altyazi yerlestirmesinde var olmayan bir dosyaya gidiyor ve
   basari mesajina HER KANAL icin "[stil: 'null' projede bulunamadi]" ekleniyordu — gercek bir
   stil sorunu bu surekli gurultunun icinde ayirt edilemezdi. presetYaz'da ise okunamayan
   dosya JSON.parse("null") -> null olup "Kayitli preset bos" YANLIS teshisini uretiyordu
   (dogrusu "okunamadi").
   ⚠ BOS DIZGI DONDURULMEZ, HATA FIRLATILIR: "dosya okunamadi" ile "dosya bos" ayrimi
   cagiranlar icin onemli (plan/liste okuyan yerler bos dosyayi "Plan bos" diye bildiriyor).
   Zaten .stil ve emoji yolu okumalarinin hepsi try/catch icinde — orada sessizce "" oluyor.
   try/finally handle sizintisini da kapatiyor (ES3'te try/finally var). */
function _readFileUTF8(p) {
    var f = new File(p);
    f.encoding = "UTF-8";
    if (!f.exists) throw new Error("dosya yok: " + p);
    if (!f.open("r")) throw new Error("dosya acilamadi: " + p);
    var s = "";
    try { s = f.read(); } finally { try { f.close(); } catch (eC) {} }
    return (s === null || s === undefined) ? "" : String(s);
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


/* ⚠ ARTIK PANELDEN CAGRILMIYOR (v1.8.1). Oyun sesini kullanici Premiere'de ELLE tasiyor;
   panel yalnizca yerlesim tablosunda "buraya tasi" der.
   NEDEN: kullanicinin OBS kaydi COKLU-AKISLI (A1/A2/A3 = ayni dosyanin 1./2./3. akisi) ve
   asagidaki 1. maddedeki kontrol bu durumda tasimayi HER SEFERINDE reddediyordu — yani
   ozellik pratikte hic calismiyordu, sadece "Oyun sesi tasinamadi" hatasi uretiyordu.
   SILINMEDI cunku TEK AKISLI kayitta (oyun sesi ayri dosyaya kaydedilirse) guvenle calisir;
   kullanici OBS duzenini degistirirse app.js'ten yeniden baglanabilir. */
/* BIR SES KANALINDAKI TUM KLIPLERI BASKA KANALA TASIR.
   Premiere'de "klibi baska kanala tasi" API'si YOKTUR; tek yol ayni projectItem'i hedef
   kanala overwriteClip ile koyup kaynaktakini silmektir. Bu bir KOPYALAMA oldugu icin
   iki tehlike var, ikisi de burada kapatiliyor:

   1) COKLU-AKISLI KAYIT: OBS tek dosyaya birden cok ses akisi yazdiginda A1/A2/A3
      AYNI projectItem'in 1./2./3. akisidir — kanal konumu klibin KIMLIGIDIR. Boyle bir
      klibi baska kanala koyarsak Premiere VARSAYILAN eslemeyi kullanir ve hedefe oyun
      sesi degil MIKROFON duser. Dosya yolu ayni oldugu icin dogrulama da yakalayamaz.
      Bu yuzden kaynak klibin medya dosyasi baska bir kanalda da geciyorsa TASIMA YAPILMAZ.
   2) DOGRULANMAMIS SILME: yerlestirme basarisiz olursa kaynak silinmemeli. Once hedefe
      konur, sayi ve medya yolu dogrulanir; tutmazsa YENI konanlar geri alinir ve kaynak
      oldugu gibi birakilir.

   Klibe uygulanmis efektler ve ses seviyesi anahtar kareleri KOPYALANMAZ — panel bunu
   kullaniciya onay ekraninda soyler. */
/* Bir kanalda baslangici startSec'e EN YAKIN klibi bulur. kanalTasi yeni yerlestirdigi
   klibi boyle buluyor (overwriteClip yerlestirdigi klibi dondurmuyor). */
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

function kanalTasi(kaynakIdx, hedefIdx) {
    var _ug = false; try { app.beginUndoGroup("Yusufwrl Kanal Tasi"); _ug = true; } catch (eug) {}
    try {
        var seq = app.project.activeSequence;
        if (!seq) return "err:Aktif sekans yok";
        var n = seq.audioTracks.numTracks;
        var ki = parseInt(kaynakIdx, 10), hi = parseInt(hedefIdx, 10);
        if (isNaN(ki) || isNaN(hi)) return "err:Kanal numarasi gecersiz";
        if (ki === hi) return "ok:0 klip tasindi (zaten dogru kanalda)";
        if (ki < 0 || ki >= n) return "err:A" + (ki + 1) + " kanali yok";
        if (hi < 0 || hi >= n) return "err:A" + (hi + 1) + " kanali yok. Premiere'de " +
                                       (hi + 1 - n) + " ses kanali ekle (panel ekleyemiyor).";
        var kay = seq.audioTracks[ki], hed = seq.audioTracks[hi];
        var adet = kay.clips.numItems;
        if (!adet) return "ok:0 klip tasindi (A" + (ki + 1) + " bos)";
        if (hed.clips.numItems > 0) return "err:A" + (hi + 1) + " bos degil (" +
                                          hed.clips.numItems + " klip var). Once orayi bosalt.";

        var TICKS = 254016000000, i, j;

        // --- kaynak kliplerin bilgisi ---
        var bilgi = [];
        for (i = 0; i < adet; i++) {
            var c = kay.clips[i], yol = "";
            try { yol = String(c.projectItem.getMediaPath()); } catch (e1) { yol = ""; }
            if (!yol) return "err:A" + (ki + 1) + " kanalindaki bir klibin medya dosyasi okunamadi " +
                            "(ic ice sekans / birlestirilmis klip olabilir). Tasima yapilmadi.";
            bilgi.push({ pi: c.projectItem, yol: yol,
                         bas: parseFloat(c.start.ticks), son: parseFloat(c.end.ticks),
                         inT: parseFloat(c.inPoint.ticks) });
        }

        /* --- COKLU-AKIS KONTROLU --- kaynak medyalari baska bir ses kanalinda da var mi? */
        for (i = 0; i < n; i++) {
            if (i === ki) continue;
            var tr = seq.audioTracks[i];
            for (j = 0; j < tr.clips.numItems; j++) {
                var y2 = "";
                try { y2 = String(tr.clips[j].projectItem.getMediaPath()); } catch (e2) { y2 = ""; }
                if (!y2) continue;
                for (var b = 0; b < bilgi.length; b++) {
                    if (bilgi[b].yol === y2) {
                        return "err:A" + (ki + 1) + " ile A" + (i + 1) + " AYNI dosyadan geliyor " +
                               "(coklu-akisli kayit). Boyle bir klip baska kanala tasinirsa yanlis " +
                               "ses akisi yerlesir; tasima YAPILMADI. Oyun sesini elle tasi ya da " +
                               "Klip > Degistir > Ses Kanallari ile eslemesini degistir.";
                    }
                }
            }
        }

        // --- hedefe yerlestir ---
        var konan = 0, tasHata = "";
        for (i = 0; i < bilgi.length; i++) {
            var bi = bilgi[i];
            /* ⚠ YERLESTIRME GERCEKTEN OLDU MU — KLIP SAYISIYLA OLC, overwriteClip'IN DONUSUNE
               GUVENME. Eskiden donus `oldu` degiskenine ataniyor ama HIC OKUNMUYORDU (proje bu
               donuse bilerek guvenmiyor, ayni sey snkYerlestir'de de var). Yerlestirme
               basarisiz oldugunda _findClipNear'in "yeterince yakin" esigi olmadigi icin
               (bd = 1e18 ile basliyor) kanalda BIR ONCEKI turda konmus klip varsa `yeni` O
               klibi gosteriyor ve hemen asagidaki iki satir YANLIS klibin kirpma noktalarini
               eziyor, ustelik konan++ da calisiyordu. Dogrulama turu tutarsizligi yakalayip
               her seyi geri aldigi icin veri kaybi olmuyor ama kullanici sebepsiz bir
               "Tasima dogrulanamadi" hatasi goruyor ve gercek sebep hicbir yere yazilmiyordu.
               _findClipNear'a mesafe esigi EKLENMEDI: sayi tabanli kontrol varken gereksiz ve
               yanlis secilmis bir esik (Premiere'in kare yuvarlamasi 24 fps'de ~0.021 sn)
               GECERLI bir yerlestirmeyi de null yapip calisan tasimayi bozardi. */
            var tOnce = 0;
            try { tOnce = hed.clips.numItems; } catch (eN1) { tOnce = 0; }
            try { hed.overwriteClip(bi.pi, bi.bas / TICKS); } catch (e3) {}
            var tSonra = 0;
            try { tSonra = hed.clips.numItems; } catch (eN2) { tSonra = 0; }
            if (tSonra <= tOnce) {
                /* `bilgi` kayitlarinda `ad` alani YOK ({pi,yol,bas,son,inT}) — yol'dan turet,
                   yoksa mesaj her zaman "klip N" yedegine dusuyordu. */
                tasHata = (_basename(bi.yol) || "klip " + (i + 1)) + ": hedef kanala yerlesmedi " +
                          "(kanal tipi uyumsuz olabilir)";
                break;
            }
            var yeni = _findClipNear(hed, bi.bas / TICKS, TICKS);
            if (!yeni) break;
            // in/out ve bitisi orijinaline esitle (klip kirpilmis olabilir)
            try { var tin = new Time(); tin.ticks = String(Math.round(bi.inT)); yeni.inPoint = tin; } catch (e4) {}
            try { var ten = new Time(); ten.ticks = String(Math.round(bi.son)); yeni.end = ten; } catch (e5) {}
            konan++;
        }

        /* --- DOGRULA ---
           Sayi ve medya yolu YETMEZ: oyun sesinin butun parcalari zaten AYNI dosyadan
           geliyor, yani yol kontrolu her zaman gecer. Klip yanlis saniyeye konsa ya da
           kirpma korunmasa bile "dogrulandi" der ve kaynak silinirdi.
           Bu yuzden her klibin BASLANGIC, BITIS ve IN noktasi teker teker karsilastirilir.
           Tolerans 1 kare (~1/24 sn) degil, tam esitlik yerine kucuk bir tick payi:
           Premiere zaman degerlerini kareye yuvarlayabiliyor. */
        var TOL = TICKS / 100;   // 0.01 sn
        var saglam = (konan === bilgi.length && hed.clips.numItems === bilgi.length);
        if (saglam) {
            for (i = 0; i < bilgi.length; i++) {
                var bek = bilgi[i], esles = null;
                for (j = 0; j < hed.clips.numItems; j++) {
                    var hc = hed.clips[j], y3 = "";
                    try { y3 = String(hc.projectItem.getMediaPath()); } catch (e6) { y3 = ""; }
                    if (y3 !== bek.yol) continue;
                    if (Math.abs(parseFloat(hc.start.ticks) - bek.bas) > TOL) continue;
                    esles = hc; break;
                }
                if (!esles) { saglam = false; break; }
                if (Math.abs(parseFloat(esles.end.ticks) - bek.son) > TOL) { saglam = false; break; }
                var ihn = 0;
                try { ihn = parseFloat(esles.inPoint.ticks); } catch (e9) { ihn = bek.inT; }
                if (Math.abs(ihn - bek.inT) > TOL) { saglam = false; break; }
            }
        }
        if (!saglam) {
            // geri al: yeni konanlari temizle, kaynak oldugu gibi kalsin
            for (i = hed.clips.numItems - 1; i >= 0; i--) { try { hed.clips[i].remove(false, false); } catch (e7) {} }
            /* GERCEK SEBEP YAZILIR: "(konan/toplam)" tek basina yaniltici — yerlestirme
               dongusu ortada kirildiysa sebebi (kanal tipi uyumsuz) yalnizca tasHata biliyor
               ve kullanici eskiden onu hicbir yerde goremiyordu. */
            return "err:Tasima dogrulanamadi (" + konan + "/" + bilgi.length + ")" +
                   (tasHata ? " — " + tasHata : "") +
                   ". Hicbir sey silinmedi, kanallar eski halinde.";
        }

        // --- dogrulandi: kaynagi bosalt ---
        var silinen = 0;
        for (i = kay.clips.numItems - 1; i >= 0; i--) {
            try { kay.clips[i].remove(false, false); silinen++; } catch (e8) {}
        }
        return "ok:" + konan + " klip A" + (ki + 1) + " -> A" + (hi + 1) + " tasindi" +
               (silinen !== konan ? (", DIKKAT: kaynakta " + (bilgi.length - silinen) + " klip silinemedi") : "");
    } catch (e) {
        return "err:" + e.toString();
    } finally { if (_ug) { try { app.endUndoGroup(); } catch (eug2) {} } }
}

// Yerleştirilmiş MOGRT klibinden metni OKUR (renk değiştirirken korumak için).

// Timeline'da SEÇİLİ altyazı (MOGRT) kliplerinin başlangıç saniyelerini JSON dizi döndürür.
// Panel bunları kendi cue listesiyle eşleyip TEMİZ yeniden yerleştirme yapar (importMGT'nin
// komşu klipleri ezme sorununa girmeden).

/*
 * Timeline'da SEÇİLİ altyazı kliplerinin METNİNİ döndürür (JSON dizi).
 * Panelde "seçili klibin yazısını düzelt" akışı için: önce mevcut metin okunur, kullanıcı
 * düzeltir, sonra setSelectedSubText ile yerine yazılır.
 */

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


/*
 * (ARTIK KULLANILMIYOR — importMGT komşu klipleri ezdiği için panel-taraflı temiz
 *  yeniden yerleştirmeye geçildi. Referans için bırakıldı.)
 * Timeline'da SEÇİLİ altyazı (MOGRT) kliplerini verilen stille (renkle) değiştirir.
 * Aynı zaman + aynı metin korunur; klip silinip yeni stil aynı yere konur.
 * Yanlış renk/konuşmacı atanan altyazıları yerleştirdikten SONRA düzeltmek için.
 */

/*
 * Her altyazı satırını MOGRT stiliyle timeline'a koyar (importMGT ile).
 * İlk klipte MOGRT'nin tüm iç yapısını dosyaya döker (teşhis).
 */

/*
 * Seçili yazı grafiğini şablon alıp her altyazı satırı için çoğaltır (MOGRT'siz).
 * Kullanıcı orijinal "Tofi Text Deneme" grafiğine tıklar (seçer), sonra bu çalışır.
 */

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

// Beyaz liste sorgusu — anahtar oneki tek yerde bilinsin.


/* Sekansin gercek kare yuksekligini okur (1080 varsayilan). Iki farkli API denenir; ikisi de
   yoksa 1080'e duser (eski davranis). */

// Klibi ekranda yukarı kaydırır (üst üste konuşmada istifleme). Başarılıysa true döner.
// Position özelliğini önce Motion/Vector Motion'da, bulamazsa herhangi bir bileşende arar (S8).
// seqH: sekansin kare yuksekligi. MOGRT'lerde Position NORMALIZE (0-1) geldigi icin pikseli
// bolerken gercek yukseklik sart: 1080 sabiti 4K'da kaymayi iki katina, 720p'de yariya
// dusuruyordu (altyazilar ya karenin ortasina firliyor ya da ic ice giriyordu).
/* Klibin efekt ozelliklerinden birini bulur (Position, Scale...).
   1. tur: adi Motion/Vector Motion olan bilesen; 2. tur: eslesmeyi tasiyan HERHANGI bilesen.
   (Once _shiftUp'in icindeydi; Shorts yerlesimi de ayni aramaya ihtiyac duydugu icin ayrildi.) */

/* SHORTS (dikey 1080x1920) yerlesimi.
   MOGRT'ler 1920x1080 icin tasarlandi; dikey sekansta kendi konumlarinda kalirlarsa
   yanlis yerde (ve tasarim genisligi kare genisliginden buyuk oldugu icin tasmis)
   duruyorlar. Burada altyazinin DIKEY konumu ve olcegi acikca ayarlanir.
     yNorm : 0 = karenin en ustu, 1 = en alti (Premiere Position normalize calisir)
     olcek : yuzde; 0 verilirse olcege HIC dokunulmaz
   X'e dokunulmaz — yatayda ortalama MOGRT'nin kendi tasariminda. */


/*
 * İstifli yerleştirme: her cue "start|end|mogrt|lane|metin".
 * lane 0 = en üst kanal (taban konum), lane 1 = bir alt kanal + ekranda yukarı, ...
 * Böylece üst üste konuşmalar çakışmaz ve renkleriyle üst üste dizilir.
 */

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

/* ── SHORTS OLCUMU — "videodan ozet Shorts uret" karti icin API kesfi ───────────────
   NEDEN VAR: panel bugune kadar HIC sequence YARATMADI; hep app.project.activeSequence
   uzerinde calisti. Shorts karti yeni bir DIKEY sekans acip secilen kesitleri oraya
   kopyalamak zorunda ve bunun yapilabilir olup olmadigi bu projede HIC olculmedi.
   Bu projenin en pahali dersi "belgelenmemis API'de tahmin etme" (caption stil atama
   ucuncu yuzeye kadar denenip kapandi, preset dosyasi okuma da oyle) — o yuzden kart
   yazilmadan ONCE olculuyor.

   ALTI SORUYU CEVAPLAR:
     1. Yeni sekans yaratilabiliyor mu?      app.project.createNewSequence / ...FromClips
     2. Sekansin olcusu (1080x1920) ayarlanabiliyor mu?  sequence.getSettings/setSettings
     3. Kaynak videodan KESIT alinabiliyor mu?           projectItem.createSubClip
     4. Klip yeni sekansa konabiliyor mu?                videoTracks[i].overwriteClip
     5. Klibin in/out noktasi yazilabiliyor mu?          trackItem.inPoint/outPoint setter
     6. Yeni sekans AKTIF yapilabiliyor mu?              openSequence / activeSequence setter
        (6 sart: altyazi ve emoji kodunun tamami activeSequence'a yaziyor.)

   ⚠ SALT OKUR. Hicbir sekans yaratmaz, hicbir klip koymaz, hicbir ayar degistirmez —
   yalnizca reflect dokumu alir. Yazma denemeleri kullanicinin projesinde iz birakirdi. */
function shortsTani() {
    var out = [];
    var ANAHTAR = ["sequence", "subclip", "clip", "preset", "setting", "point", "duration",
                   "insert", "overwrite", "create", "open", "active", "scale", "frame", "size"];
    function yaz(s) { out.push(String(s)); }

    try { yaz("Premiere surum: " + app.version); } catch (eV) { yaz("surum okunamadi"); }

    /* --- 1) app.project: sekans yaratma metotlari --- */
    var proj = null;
    try { proj = app.project; } catch (eP) {}
    _refListele(out, "app.project (SEKANS YARATMA)", proj, ANAHTAR);
    yaz("");
    yaz(">> SORU 1 — sekans yaratma metotlari tek tek:");
    var yaratAdlar = ["createNewSequence", "createNewSequenceFromClips", "newSequence",
                      "openSequence", "deleteSequence"];
    var qi;
    for (qi = 0; qi < yaratAdlar.length; qi++) {
        var v = "yok";
        try { v = (typeof proj[yaratAdlar[qi]]); } catch (eQ) { v = "hata"; }
        yaz("   app.project." + yaratAdlar[qi] + " = " + v);
    }
    try { yaz("   app.project.sequences.numSequences = " + proj.sequences.numSequences); }
    catch (eS0) { yaz("   sequences okunamadi: " + eS0.toString()); }

    /* --- 2) aktif sekans + ayarlari --- */
    var seq = null;
    try { seq = proj.activeSequence; } catch (eS) {}
    if (!seq) {
        yaz("");
        yaz("UYARI: aktif sekans yok — Premiere'de bir sekans acip tekrar bas.");
        return out.join("\n");
    }
    _refListele(out, "activeSequence", seq, ANAHTAR);
    yaz("");
    yaz(">> SORU 2 — sekans ayarlari (olcuyu 1080x1920 yapabilir miyiz):");
    var ayar = null;
    try { ayar = seq.getSettings(); yaz("   getSettings() CALISTI"); }
    catch (eG) { yaz("   getSettings() YOK/hata: " + eG.toString()); }
    if (ayar) {
        _refListele(out, "sequence.getSettings()", ayar, ANAHTAR);
        try { yaz("   mevcut olcu: " + ayar.videoFrameWidth + "x" + ayar.videoFrameHeight); }
        catch (eA) { yaz("   videoFrameWidth/Height okunamadi: " + eA.toString()); }
    }
    try { yaz("   setSettings tipi = " + (typeof seq.setSettings)); } catch (eSS) {}

    /* --- 3/5) ilk VIDEO klibi: kesit alma ve in/out --- */
    var ti = null, vt, ci;
    try {
        for (vt = 0; vt < seq.videoTracks.numTracks && !ti; vt++) {
            for (ci = 0; ci < seq.videoTracks[vt].clips.numItems; ci++) {
                ti = seq.videoTracks[vt].clips[ci]; break;
            }
        }
    } catch (eT) {}
    yaz("");
    if (!ti) {
        yaz(">> SORU 3/5 ATLANDI: sekansta hic video klibi yok.");
    } else {
        _refListele(out, "TrackItem (ornek video klibi)", ti, ANAHTAR);
        yaz("");
        yaz(">> SORU 5 — klibin in/out noktasi YAZILABILIR mi (salt okunur mu):");
        var alanlar = ["inPoint", "outPoint", "start", "end", "duration"];
        var ai2;
        for (ai2 = 0; ai2 < alanlar.length; ai2++) {
            var oku = "?", tip = "?";
            try { oku = String(ti[alanlar[ai2]].seconds); tip = "Time"; }
            catch (eI) { try { oku = String(ti[alanlar[ai2]]); tip = typeof ti[alanlar[ai2]]; } catch (eI2) { oku = "okunamadi"; } }
            yaz("   " + alanlar[ai2] + " = " + oku + "  (" + tip + ")");
        }
        var pi = null;
        try { pi = ti.projectItem; } catch (ePi) {}
        _refListele(out, "ProjectItem (KESIT ALMA)", pi, ANAHTAR);
        yaz("");
        yaz(">> SORU 3 — kesit alma metotlari tek tek:");
        var kesitAdlar = ["createSubClip", "setInPoint", "setOutPoint", "getInPoint",
                          "getOutPoint", "clearInPoint", "clearOutPoint"];
        var ki;
        for (ki = 0; ki < kesitAdlar.length; ki++) {
            var kv = "yok";
            try { kv = (typeof pi[kesitAdlar[ki]]); } catch (eK) { kv = "hata"; }
            yaz("   projectItem." + kesitAdlar[ki] + " = " + kv);
        }
    }

    /* --- 4) video kanaline yerlestirme --- */
    yaz("");
    yaz(">> SORU 4 — video kanalina yerlestirme metotlari:");
    try {
        var v0 = seq.videoTracks[0];
        var yerAdlar = ["overwriteClip", "insertClip", "appendClip"];
        var yi;
        for (yi = 0; yi < yerAdlar.length; yi++) {
            var yv = "yok";
            try { yv = (typeof v0[yerAdlar[yi]]); } catch (eY) { yv = "hata"; }
            yaz("   videoTracks[0]." + yerAdlar[yi] + " = " + yv);
        }
        _refListele(out, "VideoTrack", v0, ANAHTAR);
    } catch (eV0) { yaz("   videoTracks[0] okunamadi: " + eV0.toString()); }

    /* --- 6) yeni sekansi aktif yapma --- */
    yaz("");
    yaz(">> SORU 6 — yeni sekansi AKTIF yapma (altyazi/emoji kodu activeSequence'a yaziyor):");
    try { yaz("   app.project.openSequence tipi = " + (typeof proj.openSequence)); } catch (eO) {}
    try { yaz("   activeSequence yazilabilir mi (sequenceID okunuyor): " + String(seq.sequenceID)); }
    catch (eSid) { yaz("   sequenceID okunamadi: " + eSid.toString()); }

    /* --- QE tarafi: sekans yaratma orada olabilir --- */
    var qe0 = null;
    try { if (typeof qe === "undefined") app.enableQE(); qe0 = qe.project; } catch (eQE) {}
    _refListele(out, "qe.project (SEKANS YARATMA yedegi)", qe0, ANAHTAR);

    return out.join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════════════
   SHORTS SEKANSI KURMA — kaynak videodan secilen araliklari kesip yeni bir DIKEY
   sekansa arka arkaya dizer.

   PLAN DOSYASI BICIMI (UTF-8, satir satir — emoji/senkron planlariyla ayni desen):
     #OLCU|1080|1920           <- hedef kare olcusu
     <basSn>|<bitSn>           <- SEKANS zamani (panelin cue'lari bu eksende)
     ...

   DONUS: JSON tek satir. Panel her sayiyi GERI OKUNMUS degerden alir, kendi varsayimindan
   DEGIL — kesitlerin gercek [bas,bit] listesi "kesitler" alaninda doner.

   ⚠⚠ OLCULMUS TUZAKLAR — hepsi kod icinde isaretli:
   1. createNewSequence KULLANILMAZ: bos preset yolu verilince kullaniciya DIALOG aciyor ve
      iptalde HATA VERMEDEN null donuyor (11 Agustos 2026'da kullanicinin makinesinde olculdu).
      createNewSequenceFromClips preset istemiyor.
   2. createSubClip KAYNAK MEDYA zamani ister, SEKANS zamani DEGIL. Iki bagimsiz kayma var:
      klibin inPoint'i (still ogede 3600 sn olabiliyor) ve AutoCut'in ripple-delete'i.
      Ayni sinif hata preset tarafinda 20 turluk hata avina mal oldu (_klipKaynakBas).
   3. setSettings IKI YUZEY basiyor (getSettings().videoFrameWidth ve frameSizeHorizontal);
      panelin butun geometrisi _seqOlcu uzerinden geliyor ve o IKINCISINE bakiyor. Ikisi de
      dogrulanir.
   4. overwriteClip kullanilir, insertClip DEGIL (proje kurali, yukarida yazili) ve her
      yerlestirmeden sonra bitis GERI OKUNUR — Premiere kareye yuvarluyor, 5 kesitte ~0.16 sn
      birikiyor ve bu cumleBirlestir kopru esigi (0.15) buyuklugunde.
   5. Basarisiz her daldan cikmadan once yaratilan sekans SILINIR ve kaynak sekans geri
      acilir — panelin butun kartlari activeSequence'a nisan aliyor.
   ══════════════════════════════════════════════════════════════════════════════════ */

/* Bir TrackItem'in KAYNAK MEDYA zamanini verir: sekans zamani -> medya zamani.
   ⚠ TUZAK 2'nin cozumu. clip.start sekans ekseninde, clip.inPoint medya ekseninde. */
function _shortsMedyaZamani(ti, seqSn) {
    var inP = _zamanSn(ti.inPoint), bas = _zamanSn(ti.start);
    return inP + (seqSn - bas);
}

/* Verilen SEKANS zamanini iceren V1 klibini bulur (yoksa null).
   AutoCut'tan gecmis timeline'da V1 tek klip DEGIL, yuzlerce klip. */
function _shortsKlipBul(seq, seqSn) {
    var vt, ci, c;
    for (vt = 0; vt < seq.videoTracks.numTracks; vt++) {
        for (ci = 0; ci < seq.videoTracks[vt].clips.numItems; ci++) {
            c = seq.videoTracks[vt].clips[ci];
            if (seqSn >= _zamanSn(c.start) && seqSn < _zamanSn(c.end)) return c;
        }
    }
    return null;
}

function shortsSekansKur(planYol) {
    var proj = app.project;
    var kaynakSeq = null, kaynakID = "", yeni = null, altlar = [];
    function jsonHata(m) {
        /* TEMIZLIK: yarim sekansi sil, kaynagi geri ac. Panelin butun kartlari
           activeSequence'a nisan aliyor — yanlis sekansta birakmak en pahali sonuc. */
        try { if (yeni) proj.deleteSequence(yeni); } catch (eD) {}
        try { if (kaynakID) proj.openSequence(kaynakID); } catch (eO) {}
        return '{"error":"' + _jsonEsc(String(m)) + '"}';
    }
    try { kaynakSeq = proj.activeSequence; } catch (e0) {}
    if (!kaynakSeq) return '{"error":"Aktif sekans yok"}';
    try { kaynakID = String(kaynakSeq.sequenceID); } catch (e1) {}

    /* --- PLANI OKU --- */
    var ham = "";
    try { ham = _readFileUTF8(planYol); } catch (e2) { return jsonHata("Plan okunamadi: " + e2.toString()); }
    if (!ham) return jsonHata("Plan dosyasi bos");
    var satirlar = String(ham).split(/\r?\n/);
    var hedefW = 1080, hedefH = 1920, istenen = [], i, s, p;
    for (i = 0; i < satirlar.length; i++) {
        s = String(satirlar[i]);
        if (!s) continue;
        if (s.indexOf("#OLCU|") === 0) {
            p = s.split("|");
            if (p.length >= 3) { hedefW = parseInt(p[1], 10); hedefH = parseInt(p[2], 10); }
            continue;
        }
        if (s.charAt(0) === "#") continue;
        p = s.split("|");
        if (p.length < 2) continue;                 // bozuk satir sessizce atlanmaz: asagida sayilir
        var b = parseFloat(p[0]), t = parseFloat(p[1]);
        if (!isFinite(b) || !isFinite(t) || t <= b) continue;
        istenen.push({ bas: b, bit: t });
    }
    if (!istenen.length) return jsonHata("Planda gecerli kesit yok");
    if (istenen.length > 12) return jsonHata("Plan cok uzun (" + istenen.length + " kesit)");

    /* --- ALT KLIPLERI URET (kesitler) --- */
    var bin = null;
    try {
        bin = _binBulYarat(proj.rootItem, "Yusufwrl Shorts");
    } catch (eB) { bin = null; }
    /* ⚠⚠ BIR KESIT TEK BIR KLIBE SIGMAK ZORUNDA DEGIL — GERCEK HATA (11 Agustos 2026).
       Ilk surum kesitin yalnizca BASLADIGI klibi buluyor ve o klibin sinirlarini dayatiyordu;
       kullanicinin AutoCut'tan gecmis timeline'inda V1 yuzlerce klip ve 12 saniyelik bir kesit
       3-4 klibe yayiliyor. Belirti: "Kesit 1 klip sinirlarinin disina dusuyor
       (kaynak 0.00-7.35, klip 0.00-7.33)" — 0.02 saniyelik tasma yuzunden ozellik hic calismadi.
       ⚠ COZUM TOLERANSI BUYUTMEK DEGIL: kesit, ortustugu HER klip icin ayri bir alt klibe
       bolunur ve parcalar arka arkaya dizilir. AutoCut aradaki sessizligi zaten kesmis
       oldugu icin sonuc kesintisiz akar.
       ⚠ PANEL, ISTEDIGI DEGIL GERCEKLESEN araligi kullanmak zorunda: kesit klip sinirinda
       kirpilirsa altyazi kaydirmasi da o kirpilmis araliktan hesaplanmali, yoksa cue'lar
       yanlis yere duser (kullanicinin ilk denemesinde altyazinin yarisi eksik geldi). */
    var parcaSay = 0;
    for (i = 0; i < istenen.length; i++) {
        var kes = istenen[i];
        /* Kesitle ortusen TUM klipler, zaman sirasiyla. */
        var kesParca = [], vtx, cix, cc, ortakBas, ortakBit;
        for (vtx = 0; vtx < kaynakSeq.videoTracks.numTracks; vtx++) {
            for (cix = 0; cix < kaynakSeq.videoTracks[vtx].clips.numItems; cix++) {
                cc = kaynakSeq.videoTracks[vtx].clips[cix];
                ortakBas = Math.max(kes.bas, _zamanSn(cc.start));
                ortakBit = Math.min(kes.bit, _zamanSn(cc.end));
                if (ortakBit - ortakBas > 0.05) {          // 0.05 sn altindaki kirinti alinmaz
                    kesParca.push({ klip: cc, bas: ortakBas, bit: ortakBit });
                }
            }
            if (kesParca.length) break;                   // ilk dolu video kanali yeter
        }
        if (!kesParca.length) {
            return jsonHata("Kesit " + (i + 1) + " (" + kes.bas.toFixed(1) +
                            " sn) hicbir klibe denk gelmiyor — kesit zamanlari bayat olabilir, " +
                            "AutoCut'tan sonra altyaziyi yeniden uret");
        }
        kesParca.sort(function (a, b) { return a.bas - b.bas; });
        /* GERCEKLESEN kaynak araligi: ilk parcanin basi, son parcanin bitisi. */
        var gercekBas = kesParca[0].bas, gercekBit = kesParca[kesParca.length - 1].bit;
        var pj;
        for (pj = 0; pj < kesParca.length; pj++) {
            var pr = kesParca[pj];
            var srcBas = _shortsMedyaZamani(pr.klip, pr.bas);
            var srcBit = _shortsMedyaZamani(pr.klip, pr.bit);
            /* ⚠ AYIRT EDICI KONTROL DURUYOR ama artik KIRPARAK: parca zaten klip icinden
               turetildigi icin tasma ancak kare yuvarlamasindan gelir. Geri okuma tek basina
               totoloji oldugu icin bu kontrol kalmak zorunda. */
            var klipIn = _zamanSn(pr.klip.inPoint), klipSure = _zamanSn(pr.klip.duration);
            if (srcBas < klipIn) srcBas = klipIn;
            if (srcBit > klipIn + klipSure) srcBit = klipIn + klipSure;
            if (srcBit - srcBas < 0.05) continue;         // yuvarlama sonrasi eridi
            var pi = null;
            try { pi = pr.klip.projectItem; } catch (eP) {}
            if (!pi) return jsonHata("Kesit " + (i + 1) + ": klibin proje ogesi okunamadi");
            var alt = null;
            parcaSay++;
            try { alt = pi.createSubClip("YW_S" + parcaSay, srcBas, srcBit, 1, 1, 1); }
            catch (eS2) { return jsonHata("Kesit " + (i + 1) + " olusturulamadi: " + eS2.toString()); }
            if (!alt) return jsonHata("Kesit " + (i + 1) + " olusturulamadi (bos dondu)");
            var gercekSure = -1;
            try {
                var ip = alt.getInPoint(), op = alt.getOutPoint();
                gercekSure = _zamanSn(op) - _zamanSn(ip);
            } catch (eR) { gercekSure = -1; }
            var istenenSure = srcBit - srcBas;
            if (gercekSure >= 0 && Math.abs(gercekSure - istenenSure) > 0.15) {
                return jsonHata("Kesit " + (i + 1) + " suresi tutmadi (istenen " +
                                istenenSure.toFixed(2) + " sn, olusan " + gercekSure.toFixed(2) + " sn)");
            }
            try { if (bin) alt.moveBin(bin); } catch (eM) {}
            /* kesitNo: bu alt klip HANGI kesite ait — Shorts eksenindeki kesit sinirlarini
               parcalardan geri kurmak icin sart. */
            altlar.push({ oge: alt, sure: (gercekSure > 0 ? gercekSure : istenenSure), kesitNo: i });
        }
        istenen[i].gercekBas = gercekBas;
        istenen[i].gercekBit = gercekBit;
    }
    if (!altlar.length) return jsonHata("Hicbir kesit olusturulamadi");

    /* --- YENI SEKANS (TUZAK 1: FromClips, preset istemiyor) --- */
    var ad = "Shorts " + _shortsSayac(proj);
    try { yeni = proj.createNewSequenceFromClips(ad, [altlar[0].oge]); }
    catch (eN) { return jsonHata("Sekans yaratilamadi: " + eN.toString()); }
    if (!yeni) return jsonHata("Sekans yaratilamadi (bos dondu)");

    /* Kaynak olcusu — Scale hesabi icin. createNewSequenceFromClips sekansi kaynak
       medyanin olcusuyle doguruyor, yani BEDAVA olculuyor. 1920x1080 VARSAYILMAZ. */
    var kaynakOlcu = _seqOlcu(yeni);
    if (!kaynakOlcu.w || !kaynakOlcu.h) return jsonHata("Kaynak olcusu okunamadi");

    /* --- DIKEY YAP (TUZAK 3: IKI YUZEY de dogrulanir) --- */
    try {
        var ayar = yeni.getSettings();
        ayar.videoFrameWidth = hedefW;
        ayar.videoFrameHeight = hedefH;
        yeni.setSettings(ayar);
    } catch (eSet) { return jsonHata("Sekans olcusu ayarlanamadi: " + eSet.toString()); }
    var ay2 = null;
    try { ay2 = yeni.getSettings(); } catch (eG2) {}
    var olcu2 = _seqOlcu(yeni);
    if (!ay2 || Number(ay2.videoFrameWidth) !== hedefW || Number(ay2.videoFrameHeight) !== hedefH) {
        return jsonHata("Sekans olcusu TUTMADI (getSettings: " +
                        (ay2 ? (ay2.videoFrameWidth + "x" + ay2.videoFrameHeight) : "okunamadi") + ")");
    }
    if (olcu2.w !== hedefW || olcu2.h !== hedefH) {
        return jsonHata("Sekans olcusu TUTMADI (frameSize: " + olcu2.w + "x" + olcu2.h + ")");
    }

    /* --- KALAN KESITLERI DIZ (TUZAK 4: overwriteClip + GERI OKUNAN bitis) --- */
    var vt0 = null;
    try { vt0 = yeni.videoTracks[0]; } catch (eV) {}
    if (!vt0) return jsonHata("Yeni sekansin video kanali okunamadi");
    var imlec = 0, parcaSinir = [];
    try { imlec = _zamanSn(vt0.clips[0].end); } catch (eE) { imlec = altlar[0].sure; }
    parcaSinir.push({ bas: 0, bit: imlec, kesitNo: altlar[0].kesitNo });
    for (i = 1; i < altlar.length; i++) {
        try { vt0.overwriteClip(altlar[i].oge, imlec); }
        catch (eW) { return jsonHata("Parca " + (i + 1) + " yerlestirilemedi: " + eW.toString()); }
        var yeniSon = -1;
        try {
            var sonKlip = vt0.clips[vt0.clips.numItems - 1];
            yeniSon = _zamanSn(sonKlip.end);
        } catch (eRd) { yeniSon = -1; }
        if (yeniSon <= imlec) {
            return jsonHata("Parca " + (i + 1) + " kondu ama timeline uzamadi (" +
                            imlec.toFixed(2) + " -> " + yeniSon.toFixed(2) + ")");
        }
        parcaSinir.push({ bas: imlec, bit: yeniSon, kesitNo: altlar[i].kesitNo });
        imlec = yeniSon;                       // ⚠ ISTENEN degil GERI OKUNAN degerden
    }
    if (vt0.clips.numItems !== altlar.length) {
        return jsonHata("Beklenen " + altlar.length + " parca, timeline'da " +
                        vt0.clips.numItems + " klip var");
    }
    /* Parcalari KESITE gore birlestir: panel altyaziyi kesit bazinda haritaliyor.
       Her kesit icin Shorts eksenindeki [bas,bit] ve KAYNAK eksenindeki gerceklesen
       [kaynakBas,kaynakBit] birlikte doner — panel kendi varsayimini DEGIL bunu kullanir. */
    var gercekKesitler = [], kn;
    for (kn = 0; kn < istenen.length; kn++) {
        var ilk = -1, son = -1, pz;
        for (pz = 0; pz < parcaSinir.length; pz++) {
            if (parcaSinir[pz].kesitNo !== kn) continue;
            if (ilk < 0) ilk = parcaSinir[pz].bas;
            son = parcaSinir[pz].bit;
        }
        if (ilk < 0) continue;                 // bu kesitten hic parca konmadi
        gercekKesitler.push({
            bas: ilk, bit: son,
            kaynakBas: (istenen[kn].gercekBas !== undefined ? istenen[kn].gercekBas : istenen[kn].bas),
            kaynakBit: (istenen[kn].gercekBit !== undefined ? istenen[kn].gercekBit : istenen[kn].bit)
        });
    }

    /* --- TAM EKRAN OLCEGI (kullanici karari: %68 kirpma kabul edildi) --- */
    var olcek = Math.max(hedefW / kaynakOlcu.w, hedefH / kaynakOlcu.h) * 100;
    var olcekOk = 0, olcekHata = "";
    for (i = 0; i < vt0.clips.numItems; i++) {
        try {
            var ti2 = vt0.clips[i];
            var par = _paramAra(_bilesenAra(ti2, "AE.ADBE Motion"), ["Scale", "Olcek", "Ölçek"]);
            if (!par) { olcekHata = "Motion/Scale bulunamadi"; continue; }
            par.setValue(olcek, true);
            var geri = -1;
            try { geri = Number(par.getValue()); } catch (eGv) { geri = -1; }
            if (geri >= 0 && Math.abs(geri - olcek) < 0.5) olcekOk++;
            else olcekHata = "Scale yazildi ama geri okunamadi/tutmadi";
        } catch (eSc) { olcekHata = eSc.toString(); }
    }

    /* --- SES KANALI SAYISI (TUZAK: arkadaslarin sesi gelmeyebilir) --- */
    var sesKanal = 0, sesKlip = 0;
    try {
        sesKanal = yeni.audioTracks.numTracks;
        for (i = 0; i < sesKanal; i++) sesKlip += yeni.audioTracks[i].clips.numItems;
    } catch (eA) {}

    /* --- AKTIF YAP (altyazi/emoji kodunun tamami activeSequence'a yaziyor) --- */
    var yeniID = "";
    try { yeniID = String(yeni.sequenceID); } catch (eI2) {}
    try { proj.openSequence(yeniID); } catch (eOp) { return jsonHata("Yeni sekans acilamadi: " + eOp.toString()); }
    var aktifAd = "";
    try { aktifAd = String(proj.activeSequence.name); } catch (eAk) {}
    if (aktifAd !== ad) return jsonHata("Yeni sekans AKTIF olmadi (aktif: " + aktifAd + ")");

    var kes2 = [], q;
    for (q = 0; q < gercekKesitler.length; q++) {
        kes2.push('{"bas":' + gercekKesitler[q].bas.toFixed(3) +
                  ',"bit":' + gercekKesitler[q].bit.toFixed(3) +
                  ',"kaynakBas":' + gercekKesitler[q].kaynakBas.toFixed(3) +
                  ',"kaynakBit":' + gercekKesitler[q].kaynakBit.toFixed(3) + '}');
    }
    return '{"ok":true,"seqId":"' + _jsonEsc(yeniID) + '","ad":"' + _jsonEsc(ad) +
           '","kaynakId":"' + _jsonEsc(kaynakID) + '","w":' + olcu2.w + ',"h":' + olcu2.h +
           ',"sure":' + imlec.toFixed(3) + ',"kesitler":[' + kes2.join(",") + ']' +
           ',"olcek":' + olcek.toFixed(2) + ',"olcekOk":' + olcekOk +
           ',"olcekHata":"' + _jsonEsc(olcekHata) + '"' +
           ',"sesKanal":' + sesKanal + ',"sesKlip":' + sesKlip + '}';
}

/* Ayni adda sekans birikmesin — "Shorts 1", "Shorts 2"... ⚠ SABIT AD KULLANMA: hem
   capBasildi_<id> hem oturum_<sekans>.json ayni adda carpisir. */
function _shortsSayac(proj) {
    var n = 1, i, ad;
    try {
        for (i = 0; i < proj.sequences.numSequences; i++) {
            ad = String(proj.sequences[i].name);
            if (ad.indexOf("Shorts ") === 0) {
                var no = parseInt(ad.substring(7), 10);
                if (isFinite(no) && no >= n) n = no + 1;
            }
        }
    } catch (e) {}
    return n;
}

/* Bin bul ya da yarat. ⚠ createBin BASARISIZ olabilir ve kod koke duser — emoji tarafinda
   tam bu oldu (479 PNG proje kokune import edildi ve panel kendi kliplerini "yabanci"
   sandi). Burada kok'e dusmek zararsiz: alt klipler yine calisir, yalniz dagink olur. */
function _binBulYarat(root, ad) {
    var i, it;
    try {
        for (i = 0; i < root.children.numItems; i++) {
            it = root.children[i];
            if (it.type === 2 && String(it.name) === ad) return it;
        }
    } catch (e) {}
    try { return root.createBin(ad); } catch (e2) { return null; }
}

/* Bilesen adiyla ara (matchName SONEK ile — gercek deger "AE.ADBE Motion", olculdu). */
function _bilesenAra(ti, matchSonek) {
    var i, c, mn;
    try {
        for (i = 0; i < ti.components.numItems; i++) {
            c = ti.components[i];
            mn = ""; try { mn = String(c.matchName); } catch (e) { mn = ""; }
            if (mn && mn.substring(mn.length - matchSonek.length) === matchSonek) return c;
            if (String(c.displayName) === "Motion") return c;
        }
    } catch (e2) {}
    return null;
}

/* ── SHORTS DENEMESI — "listede var" ile "gercekten calisiyor" AYRI SEYLER ─────────
   shortsTani() metotlarin VARLIGINI olctu. Ama bu projede tam da o fark pahaliya patladi:
   createCaptionTrack'in 3./4. parametresi listede duruyordu, cagriliyordu, HATA DA
   VERMIYORDU — sessizce yok sayiyordu ("denedim, olmus gorunuyor" tuzagi). O yuzden Shorts
   karti yazilmadan once her adim GERCEKTEN denenir ve sonucu GERI OKUNUR.

   ⚠ BU FONKSIYON YAZAR: test sekansi yaratir, olcusunu degistirir, kesit koyar. Sonunda
   HEPSINI SILER. Kaynak sekans en sonda geri acilir — kullanici baska bir sekansa
   dusmus bulmasin.

   YEDI ADIM, HER BIRI GERI OKUNUR (yazip geri okumadan "oldu" denmez). */
function shortsDene() {
    var out = [];
    function yaz(s) { out.push(String(s)); }
    var proj = app.project;
    var temizSekans = [], i;

    yaz("=== SHORTS GERCEK DENEME ===");
    try { yaz("Premiere: " + app.version); } catch (e0) {}

    var kaynakSeq = null;
    try { kaynakSeq = proj.activeSequence; } catch (e1) {}
    if (!kaynakSeq) { yaz("HATA: aktif sekans yok."); return out.join("\n"); }
    var kaynakAd = "";
    try { kaynakAd = String(kaynakSeq.name); } catch (e2) {}
    yaz("kaynak sekans: " + kaynakAd);

    var ti = null, pi = null, vt, ci;
    try {
        for (vt = 0; vt < kaynakSeq.videoTracks.numTracks && !ti; vt++) {
            for (ci = 0; ci < kaynakSeq.videoTracks[vt].clips.numItems; ci++) {
                ti = kaynakSeq.videoTracks[vt].clips[ci]; break;
            }
        }
        if (ti) pi = ti.projectItem;
    } catch (e3) {}
    if (!pi) { yaz("HATA: sekansta video klibi yok — Shorts kaynagi da olmazdi."); return out.join("\n"); }
    try { yaz("kaynak klip: " + pi.name); } catch (e4) {}

    /* --- ADIM 1: createNewSequenceFromClips (preset dosyasi GEREKMEZ) --- */
    yaz("");
    yaz(">> ADIM 1 - createNewSequenceFromClips");
    var s1 = null;
    try {
        s1 = proj.createNewSequenceFromClips("YW_TEST_1", [pi]);
        if (s1) {
            temizSekans.push(s1);
            yaz("   OK - sekans olustu: " + s1.name);
            yaz("   olcu: " + s1.frameSizeHorizontal + "x" + s1.frameSizeVertical);
        } else { yaz("   BOS dondu (null)"); }
    } catch (e5) { yaz("   HATA: " + e5.toString()); }

    /* --- ADIM 2: createNewSequence (preset ister mi) --- */
    yaz("");
    yaz(">> ADIM 2 - createNewSequence (imza denemesi)");
    var s2 = null;
    try { s2 = proj.createNewSequence("YW_TEST_2", ""); yaz("   iki argumanla CALISTI"); }
    catch (e6) {
        yaz("   iki argumanla HATA: " + e6.toString());
        try { s2 = proj.createNewSequence("YW_TEST_2"); yaz("   tek argumanla CALISTI"); }
        catch (e7) { yaz("   tek argumanla da HATA: " + e7.toString()); }
    }
    if (s2) {
        temizSekans.push(s2);
        try { yaz("   olcu: " + s2.frameSizeHorizontal + "x" + s2.frameSizeVertical); } catch (e8) {}
    }

    /* --- ADIM 3: setSettings ile 1080x1920 — GERI OKUNUR --- */
    yaz("");
    yaz(">> ADIM 3 - setSettings ile DIKEY yapma (1080x1920)");
    var hedef = s1 || s2;
    if (!hedef) { yaz("   ATLANDI (sekans yaratilamadi)"); }
    else {
        try {
            var ayar = hedef.getSettings();
            yaz("   once: " + ayar.videoFrameWidth + "x" + ayar.videoFrameHeight);
            ayar.videoFrameWidth = 1080;
            ayar.videoFrameHeight = 1920;
            hedef.setSettings(ayar);
            var ayar2 = hedef.getSettings();
            yaz("   sonra: " + ayar2.videoFrameWidth + "x" + ayar2.videoFrameHeight);
            yaz("   frameSize ozelliginden: " + hedef.frameSizeHorizontal + "x" + hedef.frameSizeVertical);
            yaz("   >>> TUTTU MU: " +
                ((Number(ayar2.videoFrameWidth) === 1080 && Number(ayar2.videoFrameHeight) === 1920) ? "EVET" : "HAYIR"));
        } catch (e9) { yaz("   HATA: " + e9.toString()); }
    }

    /* --- ADIM 4: createSubClip (kesit alma) --- */
    yaz("");
    yaz(">> ADIM 4 - createSubClip (kesit alma)");
    var alt = null;
    try { alt = pi.createSubClip("YW_TEST_KESIT", 2, 7, 1, 1, 1); yaz("   sayi argumanla CALISTI"); }
    catch (eA) {
        yaz("   sayi argumanla HATA: " + eA.toString());
        try { alt = pi.createSubClip("YW_TEST_KESIT", "2", "7", 1, 1, 1); yaz("   string argumanla CALISTI"); }
        catch (eB) { yaz("   string argumanla da HATA: " + eB.toString()); }
    }
    if (alt) {
        try { yaz("   kesit adi: " + alt.name); } catch (eC0) {}
        try {
            var ib = alt.getInPoint(), ob = alt.getOutPoint();
            yaz("   in=" + ((ib && ib.seconds !== undefined) ? ib.seconds : ib) +
                " out=" + ((ob && ob.seconds !== undefined) ? ob.seconds : ob));
        } catch (eC) { yaz("   in/out okunamadi: " + eC.toString()); }
    }

    /* --- ADIM 5: insertClip ile arka arkaya dizme --- */
    yaz("");
    yaz(">> ADIM 5 - kesitleri arka arkaya dizme (insertClip)");
    if (!hedef) { yaz("   ATLANDI (sekans yok)"); }
    else {
        try {
            var vt0 = hedef.videoTracks[0];
            var oncekiSay = vt0.clips.numItems;
            var kaynakOge = alt || pi;
            vt0.insertClip(kaynakOge, 0);
            var sonraSay = vt0.clips.numItems;
            yaz("   klip sayisi: " + oncekiSay + " -> " + sonraSay);
            yaz("   >>> insertClip ISE YARADI MI: " + (sonraSay > oncekiSay ? "EVET" : "HAYIR"));
            if (sonraSay > 0) {
                var k0 = vt0.clips[0];
                yaz("   ilk klip: " + k0.name + " start=" + k0.start.seconds + " end=" + k0.end.seconds);
            }
        } catch (eE) { yaz("   HATA: " + eE.toString()); }
    }

    /* --- ADIM 6: openSequence ile aktif yapma --- */
    yaz("");
    yaz(">> ADIM 6 - yeni sekansi AKTIF yapma (altyazi/emoji kodu activeSequence'a yaziyor)");
    if (!hedef) { yaz("   ATLANDI"); }
    else {
        try {
            proj.openSequence(hedef.sequenceID);
            var akt = "";
            try { akt = String(proj.activeSequence.name); } catch (eF) {}
            yaz("   openSequence sonrasi aktif: " + akt);
            yaz("   >>> AKTIF OLDU MU: " + (akt === String(hedef.name) ? "EVET" : "HAYIR"));
        } catch (eG) { yaz("   HATA: " + eG.toString()); }
    }

    /* --- ADIM 7: autoReframe / clone / createSubsequence — YALNIZ VARLIK --- */
    yaz("");
    yaz(">> ADIM 7 - autoReframeSequence (CAGRILMADI: dakikalarca surebilir)");
    try { yaz("   autoReframeSequence tip: " + (typeof kaynakSeq.autoReframeSequence)); } catch (eH) {}
    try { yaz("   createSubsequence tip: " + (typeof kaynakSeq.createSubsequence)); } catch (eI) {}
    try { yaz("   clone tip: " + (typeof kaynakSeq.clone)); } catch (eJ) {}

    /* --- TEMIZLIK --- */
    yaz("");
    yaz(">> TEMIZLIK");
    try { proj.openSequence(kaynakSeq.sequenceID); yaz("   kaynak sekans geri acildi"); }
    catch (eK) { yaz("   kaynak sekans geri acilamadi: " + eK.toString()); }
    for (i = 0; i < temizSekans.length; i++) {
        try { proj.deleteSequence(temizSekans[i]); yaz("   silindi: test sekansi " + (i + 1)); }
        catch (eL) { yaz("   SILINEMEDI (elle sil): test sekansi " + (i + 1) + " - " + eL.toString()); }
    }
    yaz("");
    yaz("BITTI. Proje panelinde YW_TEST ile baslayan bir sey kaldiysa elle silebilirsin.");
    return out.join("\n");
}
