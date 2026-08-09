/*
 * PNG YATAY AYNALAMA — kutuphanesiz, Premiere'e HIC dokunmaz.
 *
 * NEDEN VAR: emoji artik iki tarafa da konuyor (Tofi/Moni sagda, konuklar solda) ve sol
 * kosedeki karakter ekranin DISINA bakiyor. Cozum resmi yatay cevirmek.
 *
 * ⚠ NEDEN PREMIERE'IN "Horizontal Flip" EFEKTI DEGIL: o yol ancak kullanicinin makinesinde,
 * Premiere acikken dogrulanabilirdi (efekt katalogda var mi, adi dile bagli mi, QE klip
 * eslesmesi 150 klipte ne kadar surer — hicbiri olculmedi). Dosya yolu ise burada, gercek
 * 35 PNG ile sinanabiliyor ve sonucu deterministik. Projenin kendi kurali: olculmemis API'de
 * tahmin etme (bkz. CLAUDE.md preset bolumu — ayni ders orada pahaliya ogrenildi).
 *
 * AYNALANAN KOPYA emoji klasorunun ALT KLASORUNE yazilir (<Emoji>\ayna\<ayni ad>.png):
 *   · js/emoji.js tara() alt klasorleri ATLIYOR  -> "ayna" sahte bir karakter uretmez
 *   · js/app.js emojiKanalOzet YOL ONEKI karsilastiriyor -> kopyalar yine "bizim emoji"
 *     sayilir, yani "Emojileri Sil" onlari da temizler ve yabanci klip sanilmazlar.
 * Iki mevcut kural, tek satir ek kod olmadan dogru davraniyor.
 *
 * DESTEK: bit derinligi 8 ve 16 · renk tipi 0/2/3/4/6 · interlace YOK.
 * Desteklenmeyen bir dosyada hata DONER (sessizce bozuk resim uretmez) — cagiran taraf
 * o emojiyi aynalamadan koyar ve SAYAR.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

var IMZA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* AYNA ONBELLEK SURUMU — bu dosyadaki URETIM mantigi degisince ARTIR.
   <Emoji>\ayna\.surum icinde tutulur; farkliysa butun kopyalar yeniden uretilir.
   v1: ilk surum (yalniz IHDR/PLTE/tRNS/IDAT/IEND yaziliyordu)
   v2: sRGB · pHYs · gAMA gibi yan chunk'lar korunuyor (renk ve cozunurluk ozgunle ayni) */
var AYNA_SURUM = 2;

/* CRC32 (PNG belirtimindeki tablo). Bir kez kurulur. */
var _crcTablo = null;
function _crcKur() {
  var t = new Array(256), c, n, k;
  for (n = 0; n < 256; n++) {
    c = n;
    for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
}
function _crc32(buf) {
  if (!_crcTablo) _crcTablo = _crcKur();
  var c = 0xffffffff, i;
  for (i = 0; i < buf.length; i++) c = _crcTablo[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Renk tipine gore kanal sayisi. null = taninmayan tip. */
function _kanalSayisi(renkTipi) {
  if (renkTipi === 0) return 1;   // gri
  if (renkTipi === 2) return 3;   // RGB
  if (renkTipi === 3) return 1;   // palet (indeks)
  if (renkTipi === 4) return 2;   // gri + alfa
  if (renkTipi === 6) return 4;   // RGBA
  return null;
}

function _paeth(a, b, c) {
  var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/* Filtreleri COZ — satir basindaki filtre baytini uygulayip ham piksel dizisi birakir.
   Donus: { ham: Buffer(yukseklik*stride), stride } */
function _filtreCoz(veri, genislik, yukseklik, bpp) {
  var stride = genislik * bpp;
  var ham = Buffer.alloc(stride * yukseklik);
  var kaynakOfs = 0, y, x, filtre, satirBas, ustBas, a, b, c, deger;
  for (y = 0; y < yukseklik; y++) {
    if (kaynakOfs >= veri.length) return null;         // veri kisa — bozuk dosya
    filtre = veri[kaynakOfs++];
    satirBas = y * stride;
    ustBas = satirBas - stride;
    if (kaynakOfs + stride > veri.length) return null;
    for (x = 0; x < stride; x++) {
      deger = veri[kaynakOfs + x];
      a = (x >= bpp) ? ham[satirBas + x - bpp] : 0;    // sol
      b = (y > 0) ? ham[ustBas + x] : 0;               // ust
      c = (x >= bpp && y > 0) ? ham[ustBas + x - bpp] : 0;  // sol-ust
      switch (filtre) {
        case 0: break;
        case 1: deger = (deger + a) & 0xff; break;
        case 2: deger = (deger + b) & 0xff; break;
        case 3: deger = (deger + ((a + b) >> 1)) & 0xff; break;
        case 4: deger = (deger + _paeth(a, b, c)) & 0xff; break;
        default: return null;                          // taninmayan filtre
      }
      ham[satirBas + x] = deger;
    }
    kaynakOfs += stride;
  }
  return { ham: ham, stride: stride };
}

/* Her satirin piksellerini TERSINE cevir. bpp baytlik gruplar halinde — 16 bit ve RGBA
   dahil dogru calisir, cunku bir pikselin butun baytlari birlikte tasiniyor. */
function _satirlariAynala(ham, stride, yukseklik, bpp) {
  var y, i, j, k, tmp, satirBas, adim = bpp;
  var pikselSay = stride / bpp;
  for (y = 0; y < yukseklik; y++) {
    satirBas = y * stride;
    for (i = 0, j = pikselSay - 1; i < j; i++, j--) {
      for (k = 0; k < adim; k++) {
        tmp = ham[satirBas + i * adim + k];
        ham[satirBas + i * adim + k] = ham[satirBas + j * adim + k];
        ham[satirBas + j * adim + k] = tmp;
      }
    }
  }
}

/* Filtre baytlarini geri koy — HEPSI 0 (None).
   Bilerek: sikistirma orani biraz duser (olculdu: dosyalar ~%10-20 buyuyor) ama kod
   dogrulanabilir kaliyor. Emoji PNG'leri bir kez uretilip diskte onbelleklendigi icin
   boyut maliyeti bir defalik. */
function _filtreYaz(ham, stride, yukseklik) {
  var cikti = Buffer.alloc((stride + 1) * yukseklik), y;
  for (y = 0; y < yukseklik; y++) {
    cikti[y * (stride + 1)] = 0;
    ham.copy(cikti, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return cikti;
}

function _chunkYaz(tip, veri) {
  var uzunluk = Buffer.alloc(4);
  uzunluk.writeUInt32BE(veri.length, 0);
  var tipBuf = Buffer.from(tip, "ascii");
  var crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(_crc32(Buffer.concat([tipBuf, veri])), 0);
  return Buffer.concat([uzunluk, tipBuf, veri, crcBuf]);
}

/*
 * Bir PNG'yi yatay aynalayip hedefe yazar.
 * Donus: { ok: bool, hata: string, w, h }
 * ⚠ HATA DURUMUNDA HEDEF DOSYA YAZILMAZ — yarim/bozuk bir PNG birakmak, aynalamamaktan
 * cok daha pahali olurdu (Premiere onu ice aktarir ve ekranda cop cikar).
 */
function aynala(kaynakYol, hedefYol) {
  var ham;
  try { ham = fs.readFileSync(kaynakYol); }
  catch (e) { return { ok: false, hata: "okunamadi: " + (e.message || e) }; }

  var i;
  if (ham.length < 8) return { ok: false, hata: "dosya cok kisa" };
  for (i = 0; i < 8; i++) if (ham[i] !== IMZA[i]) return { ok: false, hata: "PNG imzasi yok" };

  /* ⚠ YAN CHUNK'LAR KORUNUR — ÖLÇÜLDÜ, ATMAK GERÇEK BİR RİSKTİ.
     Kullanicinin 35 emoji dosyasinin HEPSINDE sRGB (renk uzayi) ve pHYs (fiziksel cozunurluk)
     var. Ilk surum yalniz IHDR/PLTE/tRNS/IDAT/IEND yaziyordu; o zaman aynalanan kopya renk
     uzayi ETIKETSIZ kalir ve Premiere onu ozgun dosyadan FARKLI yorumlayabilirdi — yani sol
     emojiler sagdakilerden baska renkte cikardi. Aynalama renk/gamma/cozunurluk bilgisinin
     hicbirini gecersiz kilmiyor, o yuzden hepsi aynen tasiniyor.
     ATILAN IKI CHUNK — bilerek:
       iDOT : Apple'in paralel cozme indeksi; IDAT icindeki satir OFSETLERINI gosteriyor ve
              biz IDAT'i yeniden sikistirdigimiz icin ARTIK GECERSIZ.
       eXIf : icinde Orientation etiketi olabiliyor; yatay cevirmeden sonra yaniltici olur. */
  var ATILAN_CHUNK = { "iDOT": 1, "eXIf": 1 };
  var ofs = 8, ihdr = null, idat = [], yanChunklar = [], tip, uzunluk, veri;
  while (ofs + 8 <= ham.length) {
    uzunluk = ham.readUInt32BE(ofs);
    tip = ham.toString("ascii", ofs + 4, ofs + 8);
    if (ofs + 12 + uzunluk > ham.length) return { ok: false, hata: "chunk tasiyor (bozuk dosya)" };
    veri = ham.slice(ofs + 8, ofs + 8 + uzunluk);
    if (tip === "IHDR") ihdr = veri;
    else if (tip === "IDAT") idat.push(veri);
    else if (tip === "IEND") break;
    else if (!ATILAN_CHUNK[tip]) yanChunklar.push({ tip: tip, veri: veri });   // PLTE, tRNS, sRGB, pHYs, gAMA…
    ofs += 12 + uzunluk;
  }
  /* PLTE ve tRNS'e ayrica erisim: asagidaki renk tipi kontrolu palet varligini soruyor. */
  var plte = null, pi;
  for (pi = 0; pi < yanChunklar.length; pi++) if (yanChunklar[pi].tip === "PLTE") plte = yanChunklar[pi].veri;
  if (!ihdr || ihdr.length < 13) return { ok: false, hata: "IHDR yok" };
  if (!idat.length) return { ok: false, hata: "IDAT yok" };

  var genislik = ihdr.readUInt32BE(0), yukseklik = ihdr.readUInt32BE(4);
  var bitDerinlik = ihdr[8], renkTipi = ihdr[9], sikistirma = ihdr[10],
      filtreYontem = ihdr[11], interlace = ihdr[12];

  if (!genislik || !yukseklik) return { ok: false, hata: "boyut 0" };
  if (sikistirma !== 0 || filtreYontem !== 0) return { ok: false, hata: "bilinmeyen sikistirma/filtre yontemi" };
  /* INTERLACE (Adam7) DESTEKLENMIYOR — 7 ayri gecisin her biri kendi genisliginde ve
     aynalanmasi gecisleri de yeniden duzenlemeyi gerektirirdi. Sessizce yanlis resim
     uretmektense acikca reddet. */
  if (interlace !== 0) return { ok: false, hata: "interlaced PNG desteklenmiyor" };
  /* 8 BITIN ALTI DESTEKLENMIYOR: 1/2/4 bitte bir bayt birden cok piksel tasiyor, aynalama
     bayt degil BIT seviyesinde olurdu. Emoji resimlerinde hic gorulmedi. */
  if (bitDerinlik !== 8 && bitDerinlik !== 16) return { ok: false, hata: bitDerinlik + " bit derinlik desteklenmiyor" };
  var kanal = _kanalSayisi(renkTipi);
  if (kanal === null) return { ok: false, hata: "bilinmeyen renk tipi " + renkTipi };
  if (renkTipi === 3 && bitDerinlik !== 8) return { ok: false, hata: "palet + " + bitDerinlik + " bit desteklenmiyor" };
  if (renkTipi === 3 && !plte) return { ok: false, hata: "palet PNG'sinde PLTE yok" };

  var bpp = kanal * (bitDerinlik / 8);

  var acik;
  try { acik = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e2) { return { ok: false, hata: "IDAT acilamadi: " + (e2.message || e2) }; }

  var coz = _filtreCoz(acik, genislik, yukseklik, bpp);
  if (!coz) return { ok: false, hata: "filtre cozulemedi (bozuk veri)" };

  _satirlariAynala(coz.ham, coz.stride, yukseklik, bpp);

  var yeniVeri;
  try { yeniVeri = zlib.deflateSync(_filtreYaz(coz.ham, coz.stride, yukseklik), { level: 9 }); }
  catch (e3) { return { ok: false, hata: "sikistirilamadi: " + (e3.message || e3) }; }

  /* YAN CHUNK'LAR OZGUN SIRASIYLA ve IDAT'tan ONCE yazilir. Sira PNG belirtiminde onemli
     (PLTE IDAT'tan once olmali; sRGB/gAMA/pHYs de IDAT'tan once). Kaynak dosyada zaten
     hepsi IDAT'tan onceydi (olculdu), yani ozgun sirayi korumak yeterli.
     PLTE/tRNS ayni yoldan tasiniyor: palet renkleri ve seffaflik piksel SIRASINDAN bagimsiz,
     indeksler degismedi. tRNS'i atlamak seffaf emojiyi opak yapardi. */
  var parcalar = [Buffer.from(IMZA), _chunkYaz("IHDR", ihdr)], yc;
  for (yc = 0; yc < yanChunklar.length; yc++)
    parcalar.push(_chunkYaz(yanChunklar[yc].tip, yanChunklar[yc].veri));
  parcalar.push(_chunkYaz("IDAT", yeniVeri));
  parcalar.push(_chunkYaz("IEND", Buffer.alloc(0)));

  try {
    /* ONCE GECICI DOSYAYA, SONRA TASI. Yarida kesilen bir yazma (panel kapanmasi, disk
       dolmasi) gecerli gorunen ama bozuk bir PNG birakirdi ve bir dahaki calistirmada
       "zaten var" diye yeniden uretilmezdi — kalici bozukluk. */
    var gecici = hedefYol + ".tmp";
    fs.writeFileSync(gecici, Buffer.concat(parcalar));
    try { if (fs.existsSync(hedefYol)) fs.unlinkSync(hedefYol); } catch (eD) {}
    fs.renameSync(gecici, hedefYol);
  } catch (e4) { return { ok: false, hata: "yazilamadi: " + (e4.message || e4) }; }

  return { ok: true, hata: "", w: genislik, h: yukseklik };
}

/*
 * Bir emoji dosyasinin AYNALANMIS halini dondurur; yoksa uretir.
 * kok      : emoji klasoru (aynalar kok\ayna altina yazilir)
 * kaynakYol: ozgun PNG
 * Donus    : { yol, uretildi, hata }  — hata doluysa yol BOS, cagiran ozgun resmi kullanir.
 *
 * ONBELLEK TAZELIK KONTROLU: kullanici bir emojiyi yeniden cizerse ayna eskimis kalirdi.
 * Kaynak dosya aynadan YENIYSE yeniden uretilir (mtime karsilastirmasi).
 */
function aynaYolu(kok, kaynakYol) {
  var klasor = path.join(kok, "ayna");
  var hedef = path.join(klasor, path.basename(kaynakYol));
  try {
    if (!fs.existsSync(klasor)) fs.mkdirSync(klasor, { recursive: true });
  } catch (e) {
    /* recursive secenegi eski Node'da yok — tek seviye oldugu icin duz mkdir yeter. */
    try { if (!fs.existsSync(klasor)) fs.mkdirSync(klasor); }
    catch (e2) { return { yol: "", uretildi: false, hata: "ayna klasoru olusturulamadi: " + (e2.message || e2) }; }
  }
  /* ⚠ SURUM DAMGASI — ONBELLEK KODA DA BAGLI, YALNIZ KAYNAK DOSYAYA DEGIL.
     Tazelik ilk surumde yalniz mtime'a bakiyordu: aynalama KODU duzelse bile (ornegin
     sRGB/pHYs chunk'lari artik korunuyor — v2) kaynak PNG'nin mtime'i degismedigi icin eski,
     eksik kopyalar SONSUZA KADAR kullanilmaya devam ederdi. Ikinci kullanicida bu hic fark
     edilmezdi. Surum degisince butun ayna klasoru bir kez yeniden uretilir (11 dosya, ~1 sn). */
  /* ⚠ SURUM DAMGASI ESKIYSE ONBELLEGIN TAMAMI ATILIR — TEK DOSYA DEGIL.
     Ilk halinde damga, ilk dosya uretilirken yaziliyordu; ikinci dosyada damga artik guncel
     okundugu icin o dosya "taze" sayilip ESKI SURUMLE uretilmis kopya donuyordu. Yani
     AYNA_SURUM'u artirmak sol taraftaki 30+ resmin yalnizca BIRINI yeniliyordu — geri kalani
     sonsuza kadar eski kalirdi ve kullanici bunu ancak "bir emoji dogru renkte, otekiler
     degil" diye fark ederdi (fark edebilirse).
     Cozum: damga eskiyse ayna KLASORUNU bir kez tamamen bosalt, damgayi HEMEN yaz. Boylece
     her dosya "hedef yok" dalina duser ve yeni surumle uretilir. Silinen sey yalnizca
     panelin kendi urettigi onbellek — kaynak resimlere dokunulmuyor. */
  var surumYol = path.join(klasor, ".surum");
  var surumTut = false;
  try { surumTut = (String(fs.readFileSync(surumYol, "utf8")).trim() === String(AYNA_SURUM)); }
  catch (eS) { surumTut = false; }
  if (!surumTut) {
    try {
      var eskiler = fs.readdirSync(klasor);
      for (var ei = 0; ei < eskiler.length; ei++) {
        if (!/\.png$/i.test(eskiler[ei])) continue;
        try { fs.unlinkSync(path.join(klasor, eskiler[ei])); } catch (eU) {}
      }
    } catch (eR) {}
    try { fs.writeFileSync(surumYol, String(AYNA_SURUM), "utf8"); } catch (eSw) {}
  }

  var tazele = true;
  try {
    if (fs.existsSync(hedef)) {
      var sk = fs.statSync(kaynakYol), sh = fs.statSync(hedef);
      tazele = !(sh.size > 0 && sh.mtime >= sk.mtime);
    }
  } catch (e3) { tazele = true; }
  if (!tazele) return { yol: hedef, uretildi: false, hata: "" };

  var r = aynala(kaynakYol, hedef);
  if (!r.ok) return { yol: "", uretildi: false, hata: r.hata };
  return { yol: hedef, uretildi: true, hata: "" };
}

module.exports = { aynala: aynala, aynaYolu: aynaYolu };
