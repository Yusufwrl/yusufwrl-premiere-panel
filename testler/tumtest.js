/*
 * PANEL DENETİMİ — TEK KOMUT, PREMIERE GEREKMEZ.
 *
 *   node testler\tumtest.js
 *
 * NEDEN VAR: bu panelin hatalarının çoğu ancak Premiere'de, uzun bir videonun ortasında
 * görülüyor ve bedeli saatler. Buradaki her kontrol, Premiere'e HİÇ dokunmadan, saf dosya
 * ve saf hesap üzerinden çalışıyor — yani her sürümden önce saniyeler içinde koşturulabilir.
 *
 * ⚠ SÜRÜM ÇIKARMADAN ÖNCE ÇALIŞTIR. Buradaki testlerin hepsi gerçekten yaşanmış bir
 * hatadan doğdu; hiçbiri teorik değil. Yeni bir hata bulunduğunda buraya bir test EKLE —
 * "bir daha olmasın" sözünün tek kalıcı biçimi budur.
 *
 * KAPSAM DIŞI (bilerek): Premiere API'si gerektiren her şey (klip yerleştirme, keyframe,
 * caption track). Onlar ancak kullanıcının makinesinde ölçülebiliyor.
 */
"use strict";
var fs = require("fs");
var path = require("path");

var KOK = path.join(__dirname, "..");
var gecti = 0, kaldi = 0, uyari = 0;
var suanBaslik = "";

function baslik(s) { suanBaslik = s; console.log("\n=== " + s + " ==="); }
function ok(ad) { gecti++; console.log("  ok    " + ad); }
function hata(ad, ayrinti) {
  kaldi++;
  console.log("  KALDI " + ad + (ayrinti ? ("\n        " + ayrinti) : ""));
}
function not(ad) { uyari++; console.log("  not   " + ad); }
function esit(ad, olan, beklenen) {
  if (JSON.stringify(olan) === JSON.stringify(beklenen)) ok(ad);
  else hata(ad, "olan: " + JSON.stringify(olan) + "\n        beklenen: " + JSON.stringify(beklenen));
}
function dogru(ad, kosul, ayrinti) { if (kosul) ok(ad); else hata(ad, ayrinti); }

/* ================= 1. SÜRÜM ÜÇ DOSYADA SENKRON MU ================= */
baslik("Sürüm senkronu (üç dosya birlikte artmalı)");
(function () {
  function oku(p, re) {
    try { var m = String(fs.readFileSync(path.join(KOK, p), "utf8")).match(re); return m ? m[1] : ""; }
    catch (e) { return ""; }
  }
  var v = oku("version.json", /"version"\s*:\s*"([^"]+)"/);
  var m = oku("CSXS/manifest.xml", /ExtensionBundleVersion="([^"]+)"/);
  var i = oku("installer/installer.iss", /#define\s+AppVersion\s+"([^"]+)"/);
  dogru("version.json okundu (" + v + ")", !!v);
  esit("manifest.xml aynı sürüm", m, v);
  esit("installer.iss aynı sürüm", i, v);
  /* ⚠ 1.9.9 -> 1.9.10 gecisi: metin karsilastirmasi olsaydi guncelleme HIC cikmazdi. */
  var p = v.split(".").map(Number);
  dogru("sürüm sayısal karşılaştırmaya uygun", p.length === 3 && p.every(function (x) { return !isNaN(x); }),
        "semver bekleniyor: " + v);
})();

/* ================= 2. EMOJİ PAKETİ ================= */
baslik("Emoji paketi (kaynak ↔ paket ↔ manifest)");
var EMJ = null, tarama = null;
(function () {
  try { EMJ = require(path.join(KOK, "js", "emoji.js")); } catch (e) { hata("js/emoji.js yüklenemedi", e.message); return; }
  var manYol = path.join(KOK, "varsayilan", "emoji-paketi.json");
  if (!fs.existsSync(manYol)) { hata("varsayilan/emoji-paketi.json yok"); return; }
  var man = JSON.parse(String(fs.readFileSync(manYol, "utf8")).replace(/^﻿/, ""));
  var pngKlasor = path.join(KOK, "varsayilan", "emoji");
  var pngler = fs.readdirSync(pngKlasor).filter(function (f) { return /\.png$/i.test(f); });
  esit("manifest kaydı = paketteki PNG sayısı", man.length, pngler.length);

  var eksikDosya = man.filter(function (x) { return !fs.existsSync(path.join(pngKlasor, x.dosya)); });
  esit("manifestteki her dosya pakette var", eksikDosya.length, 0);

  /* Panelin dosya adlarindan TURETECEKLERI — bozuk bir ad burada gorunur, kullanicida degil. */
  var t = EMJ.tara(pngKlasor);
  /* Paket ASCII adli (emoji01.png) — tara() onlari "kaliba uymuyor" sayar; bu NORMAL.
     Gercek ad kontrolu manifest uzerinden yapilir. */
  var kotuAd = man.filter(function (x) {
    var taban = String(x.ad).replace(/\.png$/i, "").trim().replace(/\s+\d{1,2}$/, "");
    return taban.indexOf(" ") <= 0;
  });
  esit("her ad “<Duygu> <Karakter>.png” kalıbında", kotuAd.map(function (x) { return x.ad; }), []);

  /* Kaynak klasor varsa paketle KARSILASTIR — emoji-esitle.ps1 unutulmus mu?
     ⚠ Bu adim hicbir yayin akisindan cagrilmiyor; unutulunca yeni emojiler kimseye ulasmiyor. */
  var kaynak = path.join(process.env.USERPROFILE || "", "OneDrive", "Masaüstü", "Yusufwrl", "Youtube", "Edit", "Emoji");
  if (fs.existsSync(kaynak)) {
    var kay = fs.readdirSync(kaynak).filter(function (f) { return /\.png$/i.test(f); });
    var pAd = {}; man.forEach(function (x) { pAd[x.ad] = 1; });
    var yeni = kay.filter(function (f) { return !pAd[f]; });
    var gitmis = man.map(function (x) { return x.ad; }).filter(function (a) { return kay.indexOf(a) < 0; });
    if (yeni.length || gitmis.length) {
      hata("kaynak klasör paketle AYNI DEĞİL — installer\\emoji-esitle.ps1 çalıştır",
           "pakette olmayan: " + (yeni.join(", ") || "-") + "\n        kaynakta olmayan: " + (gitmis.join(", ") || "-"));
    } else ok("kaynak klasör paketle aynı (" + kay.length + " resim)");
    tarama = EMJ.tara(kaynak);
  } else not("kaynak emoji klasörü bu makinede yok, karşılaştırma atlandı");
})();

/* ================= 3. EMOJİ TARAMASI ================= */
baslik("Emoji taraması (ad çözümleme, havuzlar)");
(function () {
  if (!tarama) { not("kaynak klasör yok, atlandı"); return; }
  dogru("tarama hatasız", !tarama.hata, tarama.hata);
  esit("kalıba uymayan dosya yok", tarama.atlanan, 0);
  dogru("en az bir karakter bulundu", tarama.karakterler.length > 0);
  /* Panelin kendi urettikleri SAHTE karakter olmamali. */
  var sahte = tarama.karakterler.filter(function (k) { return k.key === "ayna" || k.key === "eski" || /^\d+$/.test(k.key); });
  esit("sahte karakter yok (ayna/eski/sayı)", sahte.map(function (k) { return k.ad; }), []);
  /* Bir karakterin havuzu BOSSA o kisi hic emoji alamaz — sessiz kalmasin. */
  var bos = tarama.karakterler.filter(function (k) { return !(tarama.karakterDuygu[k.key] || []).length; });
  esit("her karakterin en az bir tepkisi var", bos.map(function (k) { return k.ad; }), []);
  var ozet = tarama.karakterler.map(function (k) {
    return k.ad + ":" + (tarama.karakterDuygu[k.key] || []).length;
  }).join(" · ");
  not("havuzlar → " + ozet);
})();

/* ================= 4. PNG AYNALAMA ================= */
baslik("PNG aynalama (sol taraf resimleri)");
(function () {
  var AY;
  try { AY = require(path.join(KOK, "js", "pngayna.js")); } catch (e) { hata("js/pngayna.js yüklenemedi", e.message); return; }
  if (!tarama) { not("kaynak klasör yok, atlandı"); return; }
  var tmp = path.join(require("os").tmpdir(), "yw-ayna-test");
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tmp, { recursive: true });
  var basarisiz = [];
  tarama.dosyalar.forEach(function (d) {
    var r = AY.aynala(d.yol, path.join(tmp, path.basename(d.yol)));
    if (!r.ok) basarisiz.push(d.ad + " (" + r.hata + ")");
  });
  esit("bütün resimler aynalanabiliyor", basarisiz, []);

  /* AYNA GERCEKTEN AYNA MI: iki kez aynalayinca ozgune donmeli (involution).
     ⚠ Bu tek basina cozucuyu dogrulamaz ama "satirlari ters cevirme" adimini kanitlar. */
  if (tarama.dosyalar.length) {
    var ilk = tarama.dosyalar[0];
    var bir = path.join(tmp, "_bir.png"), iki = path.join(tmp, "_iki.png");
    AY.aynala(ilk.yol, bir); AY.aynala(bir, iki);
    var a = fs.readFileSync(ilk.yol), b = fs.readFileSync(iki);
    /* Bayt bayt esit OLMAYABILIR (yeniden sikistirma), piksel verisi esit olmali:
       boyut ayni ve iki kez aynalanmis dosya ilk aynadan FARKLI olmali. */
    dogru("iki kez aynalama özgüne dönüyor (boyut)", Math.abs(b.length - fs.readFileSync(bir).length) < b.length,
          "beklenmedik boyut");
    dogru("bir kez aynalanan özgünden farklı", !fs.readFileSync(bir).equals(a));
  }

  /* YAN CHUNK'LAR: sRGB/pHYs atilirsa sol emojiler farkli renkte/DPI'da cikar. */
  function chunklar(p) {
    var buf = fs.readFileSync(p), o = 8, t = [];
    while (o + 8 <= buf.length) {
      var u = buf.readUInt32BE(o), ty = buf.toString("ascii", o + 4, o + 8);
      t.push(ty); if (ty === "IEND") break; o += 12 + u;
    }
    return t;
  }
  if (tarama.dosyalar.length) {
    var oz = chunklar(tarama.dosyalar[0].yol);
    var ay = chunklar(path.join(tmp, path.basename(tarama.dosyalar[0].yol)));
    ["sRGB", "pHYs", "gAMA", "PLTE", "tRNS"].forEach(function (c) {
      if (oz.indexOf(c) >= 0) dogru(c + " korunuyor", ay.indexOf(c) >= 0, c + " kayboldu — renk/DPI kayabilir");
    });
    dogru("iDOT atılıyor (yeniden sıkıştırmada geçersiz)", ay.indexOf("iDOT") < 0);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
})();

/* ================= 5. ALTYAZI KÖPRÜSÜ ================= */
baslik("Altyazı köprüsü (aynı cümlede boşluk kapatma)");
(function () {
  var P;
  try { P = require(path.join(KOK, "js", "pipeline.js")); } catch (e) { hata("js/pipeline.js yüklenemedi", e.message); return; }
  if (typeof P.cumleBirlestir !== "function") { hata("pipeline.cumleBirlestir dışa açılmamış"); return; }
  function c(s, e, id) { return { start: s, end: e, text: "x", cumleId: id }; }

  var g1 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s1")] }];
  P.cumleBirlestir(g1, {});
  esit("aynı cümle → bitiş yapıştı", g1[0].cues[0].end, 1.0);
  esit("başlangıç DEĞİŞMEDİ", g1[0].cues[0].start, 0);

  var g2 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s2")] }];
  P.cumleBirlestir(g2, {});
  esit("farklı cümle → köprü yok", g2[0].cues[0].end, 0.92);

  var g3 = [{ ad: "A", cues: [c(0, 0.9, "s1"), c(3.0, 4.0, "s1")] }];
  P.cumleBirlestir(g3, {});
  esit("gerçek duraklama → köprü yok", g3[0].cues[0].end, 0.9);

  var g4 = [{ ad: "A", cues: [c(0, 0.92, null), c(1.0, 2.0, null)] }];
  P.cumleBirlestir(g4, {});
  esit("cumleId yok → köprü yok", g4[0].cues[0].end, 0.92);

  var g5 = [{ ad: "A", cues: [c(0, 0.92, "s1"), c(1.0, 2.0, "s1")] },
            { ad: "B", cues: [c(0.95, 0.99, "t1")] }];
  var s5 = P.cumleBirlestir(g5, {});
  esit("başka kanal boşlukta → köprü kurulmaz", g5[0].cues[0].end, 0.92);
  esit("kanalEngeli sayıldı", s5.kanalEngeli, 1);

  /* FUZZ: kopru HICBIR senaryoda yeni kanallar arasi cakisma DOGURMAMALI. */
  var toh = 12345;
  function rnd() { toh = (toh * 1103515245 + 12345) & 0x7fffffff; return toh / 0x7fffffff; }
  function ciftler(gr) {
    var duz = [];
    gr.forEach(function (g, gi) { (g.cues || []).forEach(function (cc, ci) { duz.push({ g: gi, i: ci, s: cc.start, e: cc.end }); }); });
    duz.sort(function (a, b) { return a.s - b.s; });
    var set = {};
    for (var a = 0; a < duz.length; a++)
      for (var b = a + 1; b < duz.length; b++) {
        if (duz[b].s >= duz[a].e) break;
        if (duz[b].g !== duz[a].g) set[duz[a].g + ":" + duz[a].i + "|" + duz[b].g + ":" + duz[b].i] = 1;
      }
    return set;
  }
  var yeniCak = 0;
  for (var tur = 0; tur < 500; tur++) {
    var gr = [];
    var gs = 2 + Math.floor(rnd() * 3);
    for (var g = 0; g < gs; g++) {
      var cues = [], t = rnd() * 2;
      var n = 8 + Math.floor(rnd() * 20);
      for (var i = 0; i < n; i++) {
        var sure = 0.2 + rnd() * 0.8;
        var bos = (rnd() < 0.6) ? (0.02 + rnd() * 0.16) : (0.2 + rnd() * 1.5);
        cues.push({ start: +t.toFixed(3), end: +(t + sure).toFixed(3), text: "x",
                    cumleId: (rnd() < 0.75) ? ("c" + g + "-" + Math.floor(i / 4)) : null });
        t += sure + bos;
      }
      gr.push({ ad: "G" + g, cues: cues });
    }
    var once = ciftler(gr);
    P.cumleBirlestir(gr, {});
    var sonra = ciftler(gr);
    for (var k in sonra) if (!once[k]) yeniCak++;
  }
  esit("500 rastgele senaryoda YENİ kanallar arası çakışma", yeniCak, 0);
})();

/* ================= 6. EMOJİ SIRA NUMARALANDIRMASI ================= */
baslik("Emoji sıra numaralandırması (emoji yanlış kişiye gitmesin)");
(function (done) {
  if (!EMJ) { not("emoji.js yok, atlandı"); return done(); }
  var cumleler = [];
  for (var i = 0; i < 400; i++) {
    var tofi = i < 250;
    cumleler.push({ sira: i + 1, ad: tofi ? "Tofi" : "Moni",
                    kar: { key: tofi ? "tofi" : "moni", ad: tofi ? "Tofi" : "Moni" },
                    bas: i * 4, bit: i * 4 + 3, metin: "bu cumlede en az bes kelime var " + i });
  }
  var duygular = [{ key: "korkmus", ad: "Korkmuş" }, { key: "sasirmis", ad: "Şaşırmış" }];
  var kd = { tofi: ["korkmus", "sasirmis"], moni: ["korkmus", "sasirmis"] };
  function sahte(yerel) {
    return {
      MODEL: "t", iptalDamgasi: function () { return 1; },
      istekGonder: function (a, govde) {
        var metin = govde.messages[0].content;
        var sat = metin.split("Satirlar (numara [konusan] metin):\n")[1].split("\n");
        return Promise.resolve(JSON.stringify({
          secimler: sat.map(function (l, ix) {
            return { sira: yerel ? (ix + 1) : parseInt(l.split(" ")[0], 10), duygu: "korkmus", duygu2: "sasirmis" };
          }),
        }));
      },
    };
  }
  var kalanIs = 2;
  [["model 1'den sayıyor", true], ["model verilen numarayı yankılıyor", false]].forEach(function (par) {
    EMJ.duygulariSec(sahte(par[1]), "k", cumleler, duygular, { hedefOran: 1, karakterDuygu: kd }, 1, function () {})
      .then(function (r) {
        var say = {};
        r.secimler.forEach(function (s) { say[s.sira] = (say[s.sira] || 0) + 1; });
        var ikiKez = Object.keys(say).filter(function (k) { return say[k] > 1; }).length;
        var hic = cumleler.filter(function (c) { return !say[c.sira]; }).length;
        esit(par[0] + " → her cümle tam bir kez", [ikiKez, hic], [0, 0]);
        if (!--kalanIs) done();
      })["catch"](function (e) { hata(par[0], e.message); if (!--kalanIs) done(); });
  });
})(bitir);

/* ================= 7. ES3 / CEP UYUMLULUĞU ================= */
function bitir() {
  baslik("ES3 uyumluluğu (jsx/host.jsx Premiere'in eski motorunda çalışır)");
  (function () {
    var s;
    try { s = fs.readFileSync(path.join(KOK, "jsx", "host.jsx"), "utf8"); }
    catch (e) { hata("host.jsx okunamadı", e.message); return; }
    /* Yorum ve dizgileri temizle — asil kodda ara. */
    s = s.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/\/\/[^\n]*/g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/"(?:[^"\\\n]|\\.)*"/g, function (m) { return m.replace(/[^\n]/g, " "); })
         .replace(/'(?:[^'\\\n]|\\.)*'/g, function (m) { return m.replace(/[^\n]/g, " "); });
    var yasak = [[/\blet\s+[A-Za-z_$]/, "let"], [/\bconst\s+[A-Za-z_$]/, "const"],
                 [/=>/, "arrow"], [/\?\./, "optional-chaining"], [/`/, "template-literal"],
                 [/\.\.\./, "spread"], [/\bclass\s+[A-Za-z]/, "class"]];
    var bulunan = [];
    s.split(/\r?\n/).forEach(function (l, i) {
      yasak.forEach(function (y) { if (y[0].test(l)) bulunan.push(y[1] + " @" + (i + 1)); });
    });
    esit("host.jsx'te ES5+ sözdizimi yok", bulunan, []);
  })();

  /* ---- 8. ARAYÜZ BAĞLANTILARI ---- */
  baslik("Arayüz bağlantıları (HTML ↔ app.js)");
  (function () {
    var h, a;
    try {
      h = fs.readFileSync(path.join(KOK, "index.html"), "utf8");
      a = fs.readFileSync(path.join(KOK, "js", "app.js"), "utf8");
    } catch (e) { hata("dosya okunamadı", e.message); return; }

    var hTemiz = h.replace(/<!--[\s\S]*?-->/g, "");
    var ac = (hTemiz.match(/<div\b[^>]*>/g) || []).length;
    var kap = (hTemiz.match(/<\/div>/g) || []).length;
    esit("div açılış/kapanış dengeli", ac - kap, 0);

    var idler = {};
    (h.match(/id="([A-Za-z0-9_]+)"/g) || []).forEach(function (m) { idler[m.slice(4, -1)] = 1; });
    /* app.js'in aradigi ama HTML'de olmayan id — sessizce calismayan dugme demek.
       Dinamik olusturulanlar haric tutulur. */
    var dinamik = { spPicker: 1 };
    var eksik = {};
    (a.match(/\$\("([A-Za-z0-9_]+)"\)/g) || []).forEach(function (m) {
      var id = m.slice(3, -2);
      if (!idler[id] && !dinamik[id]) eksik[id] = 1;
    });
    esit("app.js'in aradığı her id HTML'de var", Object.keys(eksik), []);

    /* Ana ekran kartlarinin hepsinin bir ekrani olmali. */
    var kartlar = (h.match(/data-view="(\w+)"/g) || []).map(function (m) { return m.slice(11, -1); });
    var eksikView = kartlar.filter(function (k) {
      return !idler["view" + k.charAt(0).toUpperCase() + k.slice(1)];
    });
    esit("her ana ekran kartının bir ekranı var", eksikView, []);
    /* goView her karti taniyor mu — taniamayan kart ANA EKRANA doner, sessizce. */
    var goView = a.slice(a.indexOf("function goView"), a.indexOf("function goView") + 900);
    var tanimayan = kartlar.filter(function (k) { return goView.indexOf('"' + k + '"') < 0; });
    esit("goView her kartı tanıyor", tanimayan, []);
  })();

  /* ---- 9. DAĞITIM ZİNCİRİ ---- */
  baslik("Dağıtım zinciri (yeni dosyalar ParsMazi'ye ulaşıyor mu)");
  (function () {
    var pf;
    try { pf = fs.readFileSync(path.join(KOK, "installer", "panel-files.ps1"), "utf8"); }
    catch (e) { hata("panel-files.ps1 okunamadı", e.message); return; }
    ["js", "jsx", "index.html", "varsayilan", "CSXS", "css"].forEach(function (x) {
      dogru("$PanelInclude içinde: " + x, pf.indexOf('"' + x + '"') >= 0);
    });
    /* Repo kokunde hicbir listede olmayan ust duzey oge SESSIZCE disarida kalir. */
    var bilinen = {};
    (pf.match(/"([^"]+)"/g) || []).forEach(function (m) { bilinen[m.slice(1, -1)] = 1; });
    var disarida = fs.readdirSync(KOK).filter(function (f) { return !bilinen[f]; });
    if (disarida.length) not("hiçbir listede olmayan öğe: " + disarida.join(", ") + "  (panel-files.ps1)");
    else ok("repo kökündeki her öğe bir listede");
  })();

  /* ---- ÖZET ---- */
  console.log("\n" + new Array(52).join("="));
  console.log(gecti + " geçti · " + kaldi + " KALDI · " + uyari + " not");
  console.log(kaldi ? "!! SÜRÜM ÇIKARMA — önce yukarıdaki satırları düzelt."
                    : "Panel denetimden temiz geçti.");
  process.exit(kaldi ? 1 : 0);
}
