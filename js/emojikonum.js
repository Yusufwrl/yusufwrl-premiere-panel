/*
 * EMOJİ KONUMU VE ÖLÇEĞİ — saf hesap, Premiere GEREKMEZ.
 *
 * NEDEN AYRI MODÜL: js/app.js tamamen kapalı bir IIFE (dışa hiçbir şey açmıyor), yani
 * emojiKonum `testler/tumtest.js`'ten ÇAĞRILAMIYORDU. Emoji konumu kullanıcı onaylı bir
 * sabite (EMOJI_ORAN = 0.574) ve İKİ KEZ DÖNMÜŞ bir taraf kararına dayanıyor; ölçülemeyen
 * bir değişiklik bu projede en pahalı yer. Emsal: js/pngayna.js ve js/emoji.js — ikisi de
 * saf hesap olduğu için repo içinde gerçek veriyle sınanabiliyor.
 *
 * ⚠ DİKEY (Shorts) KARESİNDE SAĞ VE SOL AYNI NOKTAYA DÜŞÜYORDU — ÖLÇÜLDÜ (11 Ağustos 2026).
 * Eski hâlde ölçü tabanı koşulsuz `seqH` idi. 1080x1920'de:
 *     boyPx  = 1920 * 0.574 = 1102 px   <-- kare 1080 px, emoji KAREDEN GENİŞ
 *     sağ x  = (1080 - 10 - 551) / 1080 = 0.481  -> kelepçe -> 0.5
 *     sol x  = (10 + 551) / 1080        = 0.519  -> kelepçe -> 0.5
 * yani `hesapla(1080,1920,true)` ile `(...,false)` BİREBİR aynı nesneyi döndürüyordu: iki
 * emoji kanalı dikeyde aynı yere çiziyor. Premiere tarafında hiçbir geri okuma bunu
 * yakalayamaz — klipler doğru konuyor, host "ok" diyor; yanlış olan panelin kendi hesabı.
 * Nöbetçisi bu yüzden Premiere'de değil `tumtest.js`'te.
 *
 * ÇÖZÜM: ölçü tabanı `min(seqW, seqH)`. YATAY YOLDA HİÇBİR SAYI DEĞİŞMEZ (w >= h iken
 * min(w,h) = h). Ölçüldü — 1920x1080, 3840x2160 ve 1080x1080'de sağ/sol/y/boyPx birebir
 * eskisiyle aynı; yalnız seqW < seqH iken devreye giriyor (dikeyde sağ 0.708 · sol 0.292,
 * emoji 620 px ve kareye SIĞIYOR).
 *
 * ⚠ `olcekHesapla` ÇAĞRISI DA AYNI TABANI KULLANMAK ZORUNDA (emoji.js'e geçirilen üçüncü
 * argüman). Biri min(w,h), öteki seqH alırsa konum ile BOYUT farklı tabana oturur ve emoji
 * hesaplanan yerin dışına taşar. `taban()` bu yüzden dışa açık.
 */
"use strict";

/* ⚠ KULLANICI ONAYLI, DOKUNMA. Elle ayarlanıp ekran görüntüsüyle onaylandı; ilk denemedeki
   %22 + 54 px "çok küçük ve içeride" diye reddedilmişti. */
var ORAN = 0.574;        // emoji yüksekliği / ölçü tabanı
var BOSLUK_X = 0.005;    // yan kenar boşluğu (tabanın oranı) ≈ 5 px
/* ALT BOŞLUK YOK (kullanıcı isteği): emoji alt kenara DAYANIR. */
var BOSLUK_Y = 0;

/* Ölçü tabanı: karenin KISA kenarı. Yatayda seqH ile özdeş (bkz. dosya başı). */
function taban(seqW, seqH) { return Math.min(seqW, seqH); }

/*
 * seqW/seqH : sekansın kare ölçüsü
 * sag       : true = sağ köşe (kanal sahipleri + A1), false = sol köşe (konuklar)
 * ust       : true = ÜST kenara daya (Shorts: emoji üstte, altyazı altta — kullanıcı isteği)
 *             false/atlanır = ALT kenara daya (yatay videodaki bugünkü davranış)
 * Dönen x/y Premiere'in NORMALİZE (0..1) Position değerleri — piksel DEĞİL (ölçüldü, 26.3.0).
 */
function hesapla(seqW, seqH, sag, ust, orta, oran) {
  var tb = taban(seqW, seqH);
  /* ⚠ ORAN DIŞARIDAN EZİLEBİLİR — Shorts için (kullanıcı: "emoji de full olmalı").
     Yatay videodaki 0.574 kullanıcı onaylı ve DEĞİŞMEZ; dikey karede emoji ekranın
     genişliğini doldurmalı, o yüzden Shorts kendi oranını geçiriyor.
     ⚠ `olcekHesapla` çağrısına AYNI oran verilmek zorunda, yoksa konum bir orana, boyut
     başka orana oturur ve emoji hesaplanan yerin dışına taşar. */
  var kullanilanOran = (typeof oran === "number" && oran > 0) ? oran : ORAN;
  var boyPx = tb * kullanilanOran;
  var yariPx = boyPx / 2;
  var bosX = Math.round(tb * BOSLUK_X), bosY = Math.round(tb * BOSLUK_Y);
  /* ⚠ ORTA — Shorts için (kullanıcı isteği, 11 Ağustos 2026: "emojiler doğru yerde ama tam
     ortada durmalı"). Dikey karede sağ/sol köşe emojiyi kenara itiyor ve dar karede bu
     dengesiz duruyor. `orta` verildiğinde x kilitlenir; sağ/sol ayrımı YALNIZ yatayda
     anlamını korur. ⚠ Ortadayken AYNALAMA da anlamsızlaşır (aynalama "karakter ekranın
     içine baksın" diye vardı) — çağıran taraf onu ayrıca kapatmalı, bu fonksiyon yalnız
     konum döndürür. */
  var x = orta ? 0.5 : (sag ? ((seqW - bosX - yariPx) / seqW) : ((bosX + yariPx) / seqW));
  var y = ust ? ((bosY + yariPx) / seqH) : ((seqH - bosY - yariPx) / seqH);
  /* ⚠ KELEPÇE DURUYOR ama artık ulaşılamaz olmalı: taban min(w,h) olduğu için emoji hiçbir
     karede kareden geniş çıkmıyor. Yine de bırakıldı — ORAN kullanıcı tarafından 1'in
     üstüne çekilirse (klasörden değil koddan) çaprazlamayı yine engeller. Kelepçeye
     GİRİLDİĞİNİ bilmek gerekiyor, çünkü o an sağ ile sol aynı noktaya düşer: `kelepce`
     alanı bu yüzden dönüyor ve çağıran taraf ikinci emoji kanalını kapatabiliyor. */
  var kelepce = false;
  if (!orta) {
    if (sag && x < 0.5) { x = 0.5; kelepce = true; }
    if (!sag && x > 0.5) { x = 0.5; kelepce = true; }
  }
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    boyPx: Math.round(boyPx),
    kelepce: kelepce
  };
}

/* Sağ ve sol GERÇEKTEN farklı yere mi düşüyor? İkinci emoji kanalı ancak bu true iken
   anlamlı — aksi hâlde iki kanal aynı noktaya çizer ve panel bunu fark etmez. */
function taraflarAyriMi(seqW, seqH, ust) {
  return hesapla(seqW, seqH, true, ust).x !== hesapla(seqW, seqH, false, ust).x;
}

module.exports = {
  ORAN: ORAN, BOSLUK_X: BOSLUK_X, BOSLUK_Y: BOSLUK_Y,
  taban: taban, hesapla: hesapla, taraflarAyriMi: taraflarAyriMi
};
