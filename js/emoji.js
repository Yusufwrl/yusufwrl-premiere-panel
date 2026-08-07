/*
 * EMOJI KLASORU TARAYICI — Premiere'e HIC dokunmaz, saf dosya okuma.
 *
 * Klasordeki PNG'ler "<Duygu> <Karakter>.png" kalibinda (ornek: "Korkmus Dora.png").
 * Duygu ve karakter kumesi KLASORDEN TURETILIR, koda gomulmez: kullanici yarin altinci
 * bir duygu cizip koyarsa panel onu kendiliginden gorur.
 *
 * ALT KLASORLER BILEREK ATLANIR (Emoji\w gibi) — yalnizca ana klasordeki PNG'ler taranir.
 * ⚠ DUYGU HAVUZU ARTIK KARAKTER BASINA. Eskiden "bir duygu ancak BUTUN karakterlerde varsa
 * guvenlidir" kurali vardi ve eksik olanlar AI listesinden atiliyordu; kullanicinin gercek
 * klasorunde (Tofi 14 duygu, Dora/Mimi/Moni 5) bu kural Tofi'ye ozel butun duygulari
 * eliyordu. Simdi her karakterin kendi listesi modele ayri bildiriliyor ve model o
 * karakterde OLMAYAN bir duygu secerse panel atip SAYIYOR — yanlis karakterin yuzu yine
 * ekrana gelmiyor ama yeni duygular kullanilabiliyor.
 *
 * OLCEK ICIN BOYUT OKUNUR. Olculdu: Tofi'nin 5 resmi 2000x2000, digerleri 1000x1000.
 * Tek bir sabit olcek kullanmak Tofi'yi ekranda IKI KAT buyuk gosterirdi.
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* Turkce harfleri ASCII'ye indirger. Yapay zekaya duygu adi ASCII gider ve cevabi da
   ASCII beklenir — modelin "Şaşırmış"i harfi harfine geri yazacagina guvenmek kirilgan
   (tek bir noktasiz i cevabi eslesmeyi kacirir). */
function asciiAnahtar(s) {
  const harita = { "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g", "ı": "i", "İ": "i",
                   "ö": "o", "Ö": "o", "ş": "s", "Ş": "s", "ü": "u", "Ü": "u" };
  return String(s).replace(/[çÇğĞıİöÖşŞüÜ]/g, (k) => harita[k]).toLowerCase().trim();
}

/* PNG genislik/yukseklik — kutuphanesiz. PNG basligi sabit: 8 bayt imza + 4 uzunluk +
   4 "IHDR" + 4 genislik + 4 yukseklik. Yani 16. bayttan itibaren iki 32-bit big-endian.
   Okunamazsa null doner ve cagiran taraf varsayilan olcegi kullanir. */
function pngBoyut(dosyaYolu) {
  let fd = null;
  try {
    fd = fs.openSync(dosyaYolu, "r");
    const buf = Buffer.alloc(24);
    if (fs.readSync(fd, buf, 0, 24, 0) < 24) return null;
    if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch (e) { return null; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e2) {} } }
}

/*
 * kok  : emoji klasoru
 * Donus: { hata, dosyalar[], duygular[], karakterler[], matris, karakterDuygu, atlanan }
 *   dosyalar[]    = { yol, ad, duygu, karakter, duyguKey, karakterKey, varyant, w, h }
 *   matris        = { "<duyguKey>|<karakterKey>": [dosya, ...] }  -> VARYANT LISTESI
 *   karakterDuygu = { "<karakterKey>": [duyguKey, ...] }  -> o karakterin GERCEK havuzu
 */
function tara(kok) {
  const sonuc = { hata: "", dosyalar: [], duygular: [], karakterler: [],
                  matris: {}, karakterDuygu: {}, atlanan: 0 };
  if (!kok) { sonuc.hata = "Emoji klasörü seçilmedi"; return sonuc; }

  let girdiler;
  try { girdiler = fs.readdirSync(kok, { withFileTypes: true }); }
  catch (e) { sonuc.hata = "Emoji klasörü okunamadı: " + (e.message || e); return sonuc; }

  const duyguSet = {}, karakterSet = {};
  for (const g of girdiler) {
    // ALT KLASOR ATLANIR (bkz. dosya basindaki not) — sayilir ki kullanici bilsin.
    if (!g.isFile()) { sonuc.atlanan++; continue; }
    if (!/\.png$/i.test(g.name)) { sonuc.atlanan++; continue; }

    let taban = g.name.replace(/\.png$/i, "").trim();
    /* ⚠ SONDAKI SAYI VARYANTTIR, KARAKTER DEGIL — BU TEK DOSYA OZELLIGI KIRDI.
       "Heyecanlı Tofi 2.png" son bosluktan bolununce duygu="Heyecanlı Tofi",
       karakter="2" cikiyordu. Ortaya "2" diye SAHTE bir karakter doguyor ve asagidaki
       "her karakterde var mi" kontrolu 15 duygunun HEPSINI eliyordu — yapay zekaya BOS
       duygu listesi gidiyor, hicbir emoji secilemiyordu (olculdu, 7 Agustos 2026).
       Sondaki sayi ayri tutulur: ayni duygu+karakter icin birden cok resim olabilir ve
       bunlar VARYANT olarak kullanilir (cesitlilik icin degerli). */
    let varyant = 0;
    const vm = taban.match(/^(.*\S)\s+(\d{1,2})$/);
    if (vm) { taban = vm[1]; varyant = parseInt(vm[2], 10) || 0; }

    /* SON bosluktan bolunur: duygu adinda bosluk olabilir ("Cok Mutlu Tofi"), karakter
       adinda olmaz. Bastan bolmek "Cok" duygusu + "Mutlu Tofi" karakteri uretirdi. */
    const k = taban.lastIndexOf(" ");
    if (k <= 0) { sonuc.atlanan++; continue; }         // kalıba uymuyor
    const duygu = taban.slice(0, k).trim();
    const karakter = taban.slice(k + 1).trim();
    if (!duygu || !karakter) { sonuc.atlanan++; continue; }

    const boyut = pngBoyut(path.join(kok, g.name));
    const kayit = { yol: path.join(kok, g.name), ad: taban,
                    duygu, karakter, varyant,
                    duyguKey: asciiAnahtar(duygu), karakterKey: asciiAnahtar(karakter),
                    w: boyut ? boyut.w : 0, h: boyut ? boyut.h : 0 };
    sonuc.dosyalar.push(kayit);
    const mk = kayit.duyguKey + "|" + kayit.karakterKey;
    // VARYANT LISTESI: eskiden ikinci dosya birinciyi SESSIZCE eziyordu.
    if (!sonuc.matris[mk]) sonuc.matris[mk] = [];
    sonuc.matris[mk].push(kayit);
    duyguSet[kayit.duyguKey] = duygu;
    karakterSet[kayit.karakterKey] = karakter;
    if (!sonuc.karakterDuygu[kayit.karakterKey]) sonuc.karakterDuygu[kayit.karakterKey] = [];
    if (sonuc.karakterDuygu[kayit.karakterKey].indexOf(kayit.duyguKey) < 0)
      sonuc.karakterDuygu[kayit.karakterKey].push(kayit.duyguKey);
  }

  if (!sonuc.dosyalar.length) {
    sonuc.hata = "Klasörde “<Duygu> <Karakter>.png” biçiminde dosya yok";
    return sonuc;
  }

  sonuc.duygular = Object.keys(duyguSet).map((k) => ({ key: k, ad: duyguSet[k] }));
  sonuc.karakterler = Object.keys(karakterSet).map((k) => ({ key: k, ad: karakterSet[k] }));

  /* ⚠ "BUTUN KARAKTERLERDE OLMAYAN DUYGUYU AT" KURALI KALDIRILDI — ARTIK HAVUZ KARAKTER
     BASINA. Eski kural, kullanicinin gercek klasorunde (Tofi'nin 14 duygusu, digerlerinin 5'i)
     ya butun Tofi'ye ozel duygulari (Mutlu, Havali, Heyecanli, Kusmus, Sapsal...) eliyor ya
     da — "2" sahte karakteri yuzunden — HEPSINI eliyordu.
     Yerine: her karakterin kendi duygu listesi yapay zekaya AYRI AYRI bildiriliyor
     (duygulariSec) ve model bir karakterde OLMAYAN duygu secerse panel onu atip SAYIYOR.
     Boylece hem yeni duygular kullanilabiliyor hem yanlis karakterin yuzu ekrana gelmiyor. */
  sonuc.duygular.sort((a, b) => String(a.ad).localeCompare(String(b.ad), "tr"));
  sonuc.karakterler.sort((a, b) => String(a.ad).localeCompare(String(b.ad), "tr"));
  return sonuc;
}

/* Emojinin ekranda kaplayacagi yuksekligi hedef orana getiren Scale degeri (yuzde).
   PNG'ler farkli boyutlarda (1000 ve 2000 px olculdu) — sabit olcek Tofi'yi iki kat
   buyuk gosterirdi. oranYukseklik: emoji karenin yuzde kacini kaplasin (0.22 = %22). */
function olcekHesapla(png, sekansYukseklik, oranYukseklik) {
  const h = (png && png.h) ? png.h : 0;
  /* BOYUT OKUNAMADIYSA 100 DÖNME. 100 = PNG'nin gerçek boyutu demek; 2000px'lik bir resim
     1080p karede EKRANI TAMAMEN KAPATIR ve panel bunu "başarılı" sayar. Bilinmeyen boyutta
     hedef orana en yakın tahmin (oran×100) hem güvenli hem küçük tarafta kalır.
     Çağıran taraf zaten h===0 olan dosyayı plana hiç almıyor; bu ikinci bir emniyet. */
  if (!h || !sekansYukseklik) return Math.max(1, Math.round((oranYukseklik || 0.22) * 100));
  const istenen = sekansYukseklik * (oranYukseklik || 0.22);
  const yuzde = (istenen / h) * 100;
  return Math.max(1, Math.round(yuzde * 10) / 10);
}

/* ================= DUYGU SECIMI (Claude) =================
   Konusmaci TAHMIN EDILMEZ — her karakterin ayri ses kanali var, kim konustugu KESIN
   biliniyor. Yapay zekaya yalnizca "bu cumlede belirgin bir duygu var mi, varsa hangisi"
   sorulur. Bu yuzden semada KARAKTER ALANI YOK: model karakter dondurebilseydi halusinasyon
   yuzeyi acilirdi (olmayan bir karaktere emoji istemek gibi).

   ⚠ DUYGUNUN SAHIBI: tetikleyici cumle cogu zaman BASKASININDIR — "Dora: arkanda creeper
   var!" cumlesinde korkan Tofi'dir. Model bu tuzaga dusmesin diye kural acikca yazildi:
   duygu, O SATIRI SOYLEYENIN duygusudur.

   Ses tonu YOK: metinden duygu cikarmanin sinirini kullaniciya bastan soyledik. Sarkazm ve
   abartI kaybolur; bu yuzden model "emin degilsen yok de" diye zorlanir. */
/* ⚠ ISTEMIN ICINDEKI CELISKI BIR KEZ VIDEOYU EMOJISIZ BIRAKTI. Eski hali hem "her 3-4
   cumleden birini isaretle" hem "emin degilsen ISARETLEME" diyordu; ikinci kural birinciyi
   yiyor ve model neredeyse hicbir sey secmiyordu (kullanicinin ilk testinde 1 emoji cikti).
   Buraya yeni bir "dikkatli ol" kurali eklerken bunu hatirla: hacmi kisan her kural
   dogrudan kullanicinin sikayetini besler. */
const SISTEM_DUYGU = [
  "Bir Minecraft/Roblox video kanalinin kurgucususun. Altyazi satirlarini okuyup, hangilerinde",
  "konusanin YUZUNDE belirgin bir duygu olacagini isaretliyorsun; o anlara karakterin tepki",
  "resmi konacak.",
  "",
  "KURALLAR:",
  "1. Duygu, O SATIRI SOYLEYEN kisinin duygusudur. Baskasini korkutan bir cumle soyleyen kisi",
  "   korkmus DEGILDIR.",
  "2. BOL ISARETLE. Bu kanalin uslubu tepki resmi YOGUN. Her istekte sana bir HEDEF SAYI",
  "   verilecek; o sayiya yaklas. Az isaretlemek videoyu duz birakiyor. Hafif bir tepki bile",
  "   (saskinlik, sizlanma, dusunme, rica, tedirginlik) isaretlenmeye deger.",
  "3. KONUSANLAR ARASINDA DENGELI DAGIT. Videoyu ceken kisi en cok konusandir; yalniz ona",
  "   odaklanirsan yan karakterler videoda hic gorunmez. AZ konusan birinin satirlarindan",
  "   ORANSAL OLARAK DAHA COK isaretle — hedef, her karakterin ekranda benzer siklikta",
  "   gorunmesi. (Panel de kendi tarafinda dengeliyor ama asil denge burada kuruluyor.)",
  "4. DUYGU BULMADIGIN SATIRI CEVABA HIC YAZMA. Yalnizca isaretledigin satirlari dondur.",
  "   (Butun satirlari yazmak cevabi gereksiz uzatip yarida kesilmesine yol aciyor.)",
  "5. Yalnizca sana verilen duygu anahtarlarindan birini kullan. Baska kelime yazma.",
  "6. Ses tonunu duymuyorsun, yalniz metni goruyorsun. Iki duygu arasinda kaldiysan EN YAKIN",
  "   olani SEC — 'emin degilim' diye atlama. Yalniz tamamen notr/bilgi veren satirlari",
  "   (koordinat okuma, 'tamam', 'evet', 'orada') bos birak.",
  "7. Duygu kumesi KUCUK (genelde 5 tane). Ayni duygunun tekrar tekrar cikmasi NORMALDIR —",
  "   cesitlilik olsun diye satir ATLAMA.",
  "8. sira alanina SANA VERILEN NUMARAYI yaz — satirin kacinci sirada oldugunu degil.",
  "9. duygu2 alanina IKINCI EN UYGUN duyguyu yaz (duygu'dan FARKLI, ayni konusanin listesinden).",
  "   Panel ayni resmi cok yakinda tekrarlamamak icin gerekirse onu kullanir; uygun bir ikinci",
  "   duygu yoksa bos birak.",
  "10. Cevabin SADECE JSON olsun, aciklama yazma."
].join("\n");

/* PARCA BOYUTU. 25 dakikalik videoda ~1900 altyazi satiri oluyor; hepsini tek istekte
   gondermek girdi tarafinda sorun degil ama CEVAP tarafinda max_tokens'i asip JSON'u
   ortasindan kesiyordu (para odenir, is yapilmaz). vurucu.js ayni sebeple parcaliyor. */
var PARCA = 250;

function _duyguSema(anahtarlar) {
  return {
    type: "object", additionalProperties: false,
    required: ["secimler"],
    properties: {
      secimler: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["sira", "duygu"],
          properties: {
            sira: { type: "integer" },
            duygu: { type: "string", enum: anahtarlar.concat(["yok"]) },
            /* 2. TERCIH — panel AYNI resmi cok yakinda tekrarlamamak icin kullanir.
               required'A EKLEME: model uygun bir ikinci duygu bulamazsa bos birakabilmeli.
               Olculdu: bu alan olmadan cesitlilik kurali hacmi %30 kesiyor (149 -> 104),
               bu alanla %8'de kaliyor (149 -> 137) ve konan her emoji yine modelin
               kendi sectigi iki duygudan biri oluyor. */
            duygu2: { type: "string", enum: anahtarlar.concat(["yok"]) }
          }
        }
      }
    }
  };
}

/* cumleler: [{sira, ad, kar, bas, metin}]  (kar = eslesmis karakter, panel biliyor)
   duygular: tara()'dan gelen [{key, ad}] — TUM duygular
   opts.karakterDuygu: tara()'dan gelen { karakterKey: [duyguKey...] } — karakter basina havuz
   Donus  : { secimler: [{sira, duygu}], hata } */
async function duygulariSec(VUR, anahtar, cumleler, duygular, opts, damga, log) {
  log = log || function () {};
  const anahtarlar = duygular.map((d) => d.key);
  const gecerli = {};
  anahtarlar.forEach((k) => { gecerli[k] = true; });
  const adlar = {};
  duygular.forEach((d) => { adlar[d.key] = d.ad; });
  /* ⚠ HAVUZ KARAKTER BASINA — TEK ORTAK LISTE YETMIYOR. Kullanicinin klasorunde Tofi'nin
     14 duygusu, Dora/Mimi/Moni'nin 5'i var. Tek liste gonderilirse model Dora icin "mutlu"
     secebiliyor ve o dosya YOK; eski cozum (butun karakterlerde olmayan duyguyu at) ise
     Tofi'ye ozel butun duygulari copa atiyordu. Modele her karakterin KENDI listesi
     bildiriliyor, cevabi da panel dogruluyor. */
  const kd = (opts && opts.karakterDuygu) || null;
  let aciklama;
  if (kd) {
    const satirlar = [];
    Object.keys(kd).sort().forEach((kk) => {
      satirlar.push("  " + kk + ": " + kd[kk].map((d) => adlar[d] ? (d + " (" + adlar[d] + ")") : d).join(", "));
    });
    aciklama = "Her konusanin KENDI duygu listesi var. Bir satira YALNIZ o konusanin\n" +
               "listesindeki duygulardan birini verebilirsin:\n" + satirlar.join("\n");
  } else {
    aciklama = "Kullanilabilir duygular: " + duygular.map((d) => d.key + " = " + d.ad).join(" · ");
  }
  /* HEDEF ORAN — cumlelerin yuzde kaci isaretlensin. Modele soyut bir "bol isaretle" demek
     yetmiyor; somut bir SAYI vermek hem olculebilir hem tek noktadan ayarlanabilir yapiyor.
     Panelden geliyor (Az 0.25 / Orta 0.40 / Bol 0.60) — kullanicinin gercek oturumunda
     olculen karsiliklari: ~100 / ~155 / ~220 emoji. */
  const oran = Math.min(0.9, Math.max(0.05, Number((opts && opts.hedefOran) || 0.40)));

  const secimler = [];
  /* sonHata: SEBEBİ EKRANA TAŞIMAK İÇİN. vurucu.js zaten net Türkçe mesaj üretiyor
     ("Anthropic anahtarı geçersiz (401)", "istek sınırı aşıldı (429)"…) ama emoji tarafı
     onu yutup herkese aynı "Yapay zekâ cevabı alınamadı"yı gösteriyordu. Kullanıcı sebebi
     ancak Ayrıntılar log'unu açarsa görüyordu — teknik olmayan biri için o log yok demek. */
  let atilan = 0, hataliParca = 0, karDisi = 0, sonHata = "";
  const parcaSayi = Math.ceil(cumleler.length / PARCA);

  for (let p = 0; p < parcaSayi; p++) {
    const dilim = cumleler.slice(p * PARCA, (p + 1) * PARCA);
    /* Konusan KARAKTER ANAHTARIYLA yazilir (tofi/dora), gorunen adla degil: yukaridaki
       karakter-duygu listesi de ayni anahtarla yazildi, model ikisini ancak boyle eslestirir. */
    const satirlar = dilim.map((c) =>
      c.sira + " [" + ((c.kar && c.kar.key) ? c.kar.key : asciiAnahtar(c.ad)) + "] " +
      String(c.metin || "").slice(0, 160));
    const hedef = Math.max(1, Math.round(dilim.length * oran));

    const govde = {
      model: (opts && opts.model) || VUR.MODEL,
      max_tokens: (opts && opts.maxTokens) || 8000,
      system: SISTEM_DUYGU,
      /* Dusunme KAPALI — vurucu.js'teki ayni gerekce: bu bir secme isi, cok adimli akil
         yurutme degil; acik kalirsa dusunme token'lari butceyi yiyip JSON'u ortadan keser. */
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: _duyguSema(anahtarlar) } },
      messages: [{
        role: "user",
        content: aciklama + "\n\n" +
                 "Bu parcada " + dilim.length + " satir var. HEDEF: yaklasik " + hedef +
                 " satiri isaretle. Bundan cok daha azini isaretlersen video duz kalir.\n\n" +
                 "Satirlar (numara [konusan] metin):\n" + satirlar.join("\n")
      }]
    };

    let metin = "";
    try {
      if (parcaSayi > 1) log("[emoji] parça " + (p + 1) + "/" + parcaSayi + " (" + dilim.length + " satır)…");
      metin = await VUR.istekGonder(anahtar, govde, opts || {}, damga, log);
    } catch (e) {
      /* BIR PARCA DUSERSE TUMU DUSMESIN: kalanlar denenir, eksik acikca bildirilir.
         Iptal ise devam etmenin anlami yok — yukari firlat. */
      if (e && e.iptal) throw e;
      hataliParca++;
      sonHata = String((e && e.message) || e);
      log("[emoji] parça " + (p + 1) + " alınamadı: " + sonHata);
      continue;
    }

    let j = null;
    try { j = JSON.parse(metin); }
    catch (e2) {
      /* Sema reddedilip semasiz tekrar denenmis olabilir — cevap duz metin icinde JSON
         tasiyor olabilir. vurucu.js'teki ayni kurtarma. */
      const m = String(metin).match(/\{[\s\S]*\}/);
      if (m) { try { j = JSON.parse(m[0]); } catch (e3) { j = null; } }
    }
    if (!j || !j.secimler) {
      hataliParca++;
      sonHata = "Yapay zekânın cevabı okunamadı (JSON bozuk)";
      log("[emoji] parça " + (p + 1) + " cevabı okunamadı.");
      continue;
    }

    /* MODEL LISTE DISINA CIKARSA AT. Sema enum kullaniyor ama semasiz geri dusulmus
       olabilir; bilinmeyen bir duygu adi icin dosya yoktur ve sessizce bos klip olurdu. */
    /* Bu parcadaki satirlarin karakterleri — asagidaki "o karakterde var mi" kontrolu icin. */
    const parcaKar = {};
    dilim.forEach((c) => { parcaKar[c.sira] = (c.kar && c.kar.key) ? c.kar.key : asciiAnahtar(c.ad); });
    j.secimler.forEach((s) => {
      const d = asciiAnahtar(s.duygu || "");
      if (!d || d === "yok") return;
      if (!gecerli[d]) { atilan++; return; }
      /* ⚠ DUYGU O KARAKTERDE GERCEKTEN VAR MI? Havuz karakter basina degistigi icin model
         Dora'ya "mutlu" verebiliyor ve o dosya YOK. Panel bunu sonradan "dosya yok" diye
         atlardi ama sebebi gorunmezdi; burada yakalanip AYRI sayiliyor. */
      if (kd) {
        const kk = parcaKar[s.sira];
        if (kk && kd[kk] && kd[kk].indexOf(d) < 0) { karDisi++; return; }
      }
      /* 2. TERCIH AYNI KAPILARDAN GECER: taninmiyorsa, "yok" ise, birinciyle AYNI ise ya da
         o karakterde bulunmuyorsa BOSALTILIR. Yoksa panel var olmayan bir dosyayi arar ve
         emoji "dosya yok" diye sessizce duser — cesitlilik kurali da bosa cikar. */
      let d2 = asciiAnahtar(s.duygu2 || "");
      if (!d2 || d2 === "yok" || d2 === d || !gecerli[d2]) d2 = "";
      if (d2 && kd) {
        const kk2 = parcaKar[s.sira];
        if (kk2 && kd[kk2] && kd[kk2].indexOf(d2) < 0) d2 = "";
      }
      secimler.push({ sira: s.sira, duygu: d, duygu2: d2 });
    });
  }

  if (atilan) log("[emoji] " + atilan + " tanınmayan duygu atıldı.");
  /* Model o karakterde OLMAYAN bir duygu sectiyse sebep gorunur olsun: "az emoji cikti"
     sikayetinin kaynagi bu olabilir ve cozumu kod degil, eksik resmi cizmek. */
  if (karDisi) log("[emoji] " + karDisi + " seçim o karakterde olmayan duyguydu, atıldı.");
  /* SEBEBİ GÖSTER. vurucu.js'in ürettiği mesaj zaten ne yapılacağını söylüyor
     (anahtar geçersiz / kredi bitti / sınır aşıldı); onu yutup genel bir cümle göstermek
     kullanıcıyı çaresiz bırakıyordu. */
  if (hataliParca === parcaSayi) {
    return { secimler: [], hata: sonHata || "Yapay zekâ cevabı alınamadı" };
  }
  return {
    secimler: secimler,
    hata: "",
    /* Eksik parça SESSİZ KALMAZ: kullanıcı "az emoji çıktı" derse sebebi burada. */
    uyari: hataliParca ? (parcaSayi + " parçanın " + hataliParca + " tanesi alınamadı — bazı bölümlerde emoji yok") : ""
  };
}

module.exports = { tara, olcekHesapla, asciiAnahtar, pngBoyut, duygulariSec };
