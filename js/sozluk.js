/*
 * Karakter/özel isim sözlüğü — Whisper'ın yanlış yazdığı isimleri düzeltir.
 *
 * İKİ KATMAN:
 *   1) --hotwords: motora "bu isimler geçecek" ipucu verilir (doğru yazma olasılığı artar).
 *      Motorun --reprompt varsayılanı True olduğu için ipucu TÜM video boyunca taşınır.
 *   2) Transkript sonrası kelime bazlı düzeltme (GARANTİ katman): "Toffy'ye" -> "Tofi'ye".
 *      Model ipucuna uymasa bile burada düzelir.
 *
 * Sözlük dosyası: <uzantı kökü>\sozluk.json — YOKSA aşağıdaki VARSAYILAN kullanılır.
 * Bu dosya panel paketine (pack-panel.ps1) girmez ve oto-güncellemede (updater.js) ezilmez,
 * yani kullanıcının kendi eklediği kelimeler güncellemeden sağ çıkar.
 */
var fs = require("fs");
var path = require("path");

var DOSYA = "sozluk.json";

/* Varsayılan karakterler. varyant = Whisper'ın ürettiği YANLIŞ yazımlar (küçük harfle yazılır,
   karşılaştırma zaten küçük harf üzerinden yapılır). Doğru yazımın kendisi otomatik eklenir,
   böylece "tofi" -> "Tofi" (büyük harf düzeltmesi) de yapılır.
   DİKKAT: gerçek Türkçe kelimelere benzeyen varyant EKLEME — masum kelimeler bozulur
   (ör. "mini" -> Mimi, "mani" -> Moni gibi eşleşmeler bilerek listeye alınmadı). */
/* ⚠ PAKET SÜRÜMÜ — VARSAYILAN/BILINEN listesine her EKLEME yaptığında ARTIR.
   Kullanıcının kendi sozluk.json'ı varsa load() varsayılana HİÇ bakmıyor; yani bu listeye
   eklenen bir varyant, sözlüğü bir kez kaydetmiş kullanıcıya ASLA ulaşmaz. Bu tuzağa bu
   projede iki kez düşüldü (emoji PNG'lerinin üzerine yazma kuralı, preset.secili birleştirmesi).
   `paketBirlestir` bu sayıya bakıp eksik varyantları bir kez ekliyor — bkz. aşağısı. */
/* 2 → 3: Tofi'ye "tuffy" varyantı eklendi (12 Ağustos 2026). Bu artış OLMADAN, sözlüğünü
   bir kez kaydetmiş hiç kimseye (ParsMazi dahil) yeni varyant ULAŞMAZ — load() kullanıcının
   kendi sozluk.json'ı varsa VARSAYILAN'a hiç bakmıyor. */
var PAKET_SURUM = 3;

var VARSAYILAN = [
  /* ⚠ "tobi" ParsMazi'nin gerçek kaydından geldi (11 Ağustos 2026): "10'da 9'a Tofi değil
     TOBİ yazıyor". Motor Türkçe dinlerken f/b'yi karıştırıyor ve bu kullanıcıya özel değil —
     ölçüm yerine tahminle uzatmıyoruz, gerçek transkriptte GÖRÜLEN yazımlar ekleniyor. */
  /* ⚠ "tuffy" kullanıcının bildirdiği gerçek yazım (12 Ağustos 2026). Aynı ailedeki
     "toffy" zaten listedeydi; motor o/u sesini de karıştırabiliyor. Tahminle
     uzatılmadı — "tufi", "taffy" gibi GÖRÜLMEMİŞ yazımlar bilerek eklenmedi.
     ⚠ Aynı istekte gelen "Tobi" ve "Toby" ZATEN listedeydi ve ölçüldü: "Tobi gel" →
     "Tofi gel", "Tobiler" → "Tofiler", "Tobi'nin" → "Tofi'nin" hepsi çalışıyor. */
  { ad: "Tofi", varyant: ["toffy", "toffi", "tofy", "tofu", "topi", "toffee", "tofie", "dofi", "to fi",
                          "tobi", "tobby", "toby", "tobe", "to bi", "tuffy"] },
  { ad: "Moni", varyant: ["money", "monny", "mony", "monie", "monnie", "mo ni"] },
  { ad: "Dora", varyant: ["dorra", "doora", "tora", "dorah", "do ra"] },
  { ad: "Mimi", varyant: ["mimmi", "mimy", "mimie", "mimmy", "mi mi"] },
  { ad: "Niko", varyant: ["nico", "nikko", "nicko", "niku", "nikoo", "ni ko"] }
];

/* BİLİNEN İSİMLER — oyun, marka ve süper kahraman adları. Motor Türkçe dinlerken bunları
   kulaktan yazıyor ("maynkraft", "betmen") ve her videoda elle düzeltiliyordu.

   YALNIZ METİN DÜZELTME KATMANINA GİRER, --hotwords'E GİRMEZ. Sebep: motorun kendi --help'i
   hotwords'ün "unsafely cuts into the new tokens space" dediğini yazıyor ve faster-whisper
   listeyi 223 token'da sessizce kesiyor — listeyi şişirmek KULLANICININ kendi karakter
   isimlerini (Tofi/Moni/Dora…) ipucu dışına iter, yani asıl işi bozar.

   KULLANICI HER ZAMAN KAZANIR: buildMap'te bu liste kullanıcı girdilerinden ÖNCE işlenir,
   sonraki anahtar öncekini ezer. Kullanıcı "Batman" için başka bir yazım isterse sözlüğüne
   yazar ve burası geçersiz kalır.

   VARYANT SEÇİM KURALI (üstteki uyarının sıkı hâli): varyant en az 5 harf olacak ve gerçek
   bir Türkçe kelimeye BENZEMEYECEK. Bu yüzden bilerek DIŞARIDA bırakılanlar:
     · Hulk → "halk"  (halk = gerçek Türkçe kelime, masum cümleler bozulurdu)
     · Thor → "tor"   (tor = Türkçe kelime, üstelik 3 harf)
     · Flash → "flaş" (flaş = Türkçe'de yerleşik kelime)
   Liste ÖLÇÜMLE genişletilmeli: bir sonraki gerçek videonun transkriptinde motorun NE yazdığına
   bakıp varyant eklenir. Tahminle uzatmak yanlış düzeltme riskini büyütür. */
var BILINEN = [
  { ad: "Minecraft", varyant: ["maynkraft", "mayn kraft", "minekraft", "maynkraf", "maincraft"] },
  { ad: "Roblox", varyant: ["robloks", "rob loks", "roblocks", "roblox'", "robluks"] },
  { ad: "Spider-Man", varyant: ["spayderman", "spayder man", "spaydırman", "spaydermen", "spider men"] },
  { ad: "Iron Man", varyant: ["ayronman", "ayron man", "ayronmen", "iron men"] },
  { ad: "Batman", varyant: ["betmen", "bet men", "batmen"] },
  { ad: "Superman", varyant: ["sipermen", "süpermen", "super men", "sipirmen"] },
  { ad: "Captain America", varyant: ["kaptan amerika", "keptın amerika", "kapten amerika"] },
  { ad: "Deadpool", varyant: ["detpul", "dedpul", "dead pool", "detpol"] },
  { ad: "Wolverine", varyant: ["vulverin", "wolwerin", "vulwerin", "volverin"] },
  { ad: "Thanos", varyant: ["tanos", "thanoss", "tanoss"] }
];

// Harf sayılan karakterler (Türkçe dahil). Noktalamayı kelimeden ayırmak için.
var RE_HARF = /[A-Za-z0-9ÇçĞğİıŞşÖöÜüÂâÎîÛû]/;
// Apostrof aileleri — "Tofi'ye" gibi eklerin ayracı
var RE_APOS = /['’‘`´]/;

/* Karşılaştırma normali: Türkçe küçük harf + apostrof/şapka temizliği.
   ⚠ DÖRT HARF DE TEK HAVUZDA ('İ','I','ı','i' → 'i'). Eskiden dönüşüm TEK YÖNLÜYDÜ
   ('I'→'ı' yapılıyor ama 'ı'→'i' yapılmıyordu) ve bu, tabloyu ikiye bölüyordu: kullanıcı
   varyantı "ilgas" diye yazınca anahtar 'ilgas' oluyor, Whisper özel ismi büyük harfle
   "Ilgas" yazınca _norm 'ılgas' üretiyor ve ikisi ASLA eşleşmiyordu. Ölçüldü: fixToken('ilgas')
   → 'Ilgaz' ama fixToken('Ilgas') → null; BILINEN listesindeki "iron men" varyantı bu yüzden
   tamamen ölüydü (Whisper özel isimleri büyük harfle yazar). 'I' ile başlayan her karakter
   (Ilgaz, Irmak, Iron) varyantsız kalıyordu ve panel sessizce "0 isim düzeltildi" diyordu.
   kisiler.js aynı sorunu /[İIı]/g → 'i' ile zaten çözmüştü.
   Türkçe ı/i ayrımının kaybı burada zararsız: karşılaştırma serbest metin arasında değil,
   yalnız sözlük varyantlarına karşı yapılıyor. Uzunluk korunur (tek karakter → tek karakter),
   fixToken'ın kok.slice(L) hesabı buna bağlı. Ölçüldü: 46 masum Türkçe kelimede 0 fark. */
function _norm(s) {
  s = String(s).replace(/[İIıi]/g, "i").toLowerCase();
  s = s.replace(/['’‘`´]/g, "");
  return s.replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
}

/* Türkçe çekim ekleri — apostrofsuz yapışık yazımı ("tofiye") yakalamak için.
   Liste dışı bir kalan varsa düzeltme YAPILMAZ; böylece "monitor" -> "Moni"+"tor" olmaz. */
var _EK = (function () {
  var list = ["e", "a", "i", "ı", "u", "ü", "ye", "ya", "yi", "yı", "yu", "yü",
    "de", "da", "te", "ta", "den", "dan", "ten", "tan", "nde", "nda", "nden", "ndan",
    "in", "ın", "un", "ün", "nin", "nın", "nun", "nün", "ni", "nı", "nu", "nü",
    "ne", "na", "le", "la", "yle", "yla", "ile", "ler", "lar", "lere", "lara", "leri", "ları",
    "si", "sı", "su", "sü", "m", "n", "miz", "mız", "niz", "nız", "yiz", "yız",
    "ce", "ca", "ci", "cı", "cu", "cü", "li", "lı", "lu", "lü", "siz", "sız",
    "gil", "gile", "gili", "gilde", "gilden", "yim", "yım", "sin", "sın",
    // ek fiil ve zaman ekleri: "Tofiydi", "Tofiymiş", "Tofiyken", "Tofiyse"
    "ydi", "ydı", "ydu", "ydü", "ymiş", "ymış", "ymuş", "ymüş", "yse", "ysa",
    "yken", "ken", "dir", "dır", "dur", "dür", "tir", "tır", "tur", "tür",
    "ki", "lik", "lık", "luk", "lük", "cik", "cık", "cuk", "cük", "ndeki", "ndaki"];
  /* Object.create(null): düz "{}" nesnesinde arama Object.prototype'a da düşüyor, yani
     _EK["constructor"] / _EK["toString"] doğruymuş gibi cevap veriyordu ve bu kelimeler
     geçerli bir Türkçe ek sanılıyordu. Prototipsiz nesnede yalnızca gerçekten eklenen
     anahtarlar bulunur. */
  var s = Object.create(null); for (var i = 0; i < list.length; i++) s[list[i]] = true; return s;
})();

/* Kalan harfler geçerli bir EK ZİNCİRİ mi? ("lerden" = "ler" + "den")
   Tek ekli biçimler zaten tek adımda çözülüyordu ama "Tofilerden", "Monilerin", "Tofiydi"
   gibi zincirlenmiş — ve tamamen normal — Türkçe yazımlar çözülemiyor, her videoda elle
   düzeltiliyordu.
   İKİ GÜVENLİK SINIRI: (1) zincirin ARA halkaları en az 2 harf olmalı — tek harfli eke izin
   verilirse "mimik" -> "Mimi"+"k" gibi masum kelimeler bozuluyor; (2) en fazla 3 halka. */
function _ekZinciri(kalan, kalanAdim) {
  if (!kalan) return true;
  if (_EK[kalan]) return true;                       // tamamı tek ek (tek harfli olabilir: "m", "n")
  if (kalanAdim <= 0) return false;
  for (var L = Math.min(6, kalan.length - 1); L >= 2; L--) {
    if (_EK[kalan.slice(0, L)] && _ekZinciri(kalan.slice(L), kalanAdim - 1)) return true;
  }
  return false;
}

// Kelimeyi baş-noktalama / gövde / son-noktalama olarak üçe ayırır ("(Toffy'ye," -> "(" + "Toffy'ye" + ",")
function _bol(tok) {
  var s = String(tok), i = 0, j = s.length;
  while (i < j && !RE_HARF.test(s.charAt(i))) i++;
  while (j > i && !RE_HARF.test(s.charAt(j - 1))) j--;
  return { on: s.slice(0, i), govde: s.slice(i, j), son: s.slice(j) };
}

/* Sözlük girdilerinden arama tablosu üretir.
   { tek: {normVaryant: "DoğruAd"}, ikili: {"iki kelime": "DoğruAd"} } — girdi yoksa null.

   TABLOLAR PROTOTİPSİZ (Object.create(null)). Düz "{}" ile kurulduğunda arama
   Object.prototype üzerinden de sonuç dönüyordu: map.tek["constructor"] Object yapıcısını
   veriyor, aşağıdaki "!dogru" kontrolünü geçiyor ve metne birleştirilince altyazıya
   "function Object() { [native code] }" yazılıyordu (ölçüldü). "toString", "valueOf",
   "__proto__" için de aynı tuzak vardı. */
function buildMap(entries) {
  var tek = Object.create(null), ikili = Object.create(null), varMi = false;
  /* BİLİNEN İSİMLER ÖNCE, KULLANICI SÖZLÜĞÜ SONRA. Aşağıdaki döngüde sonraki anahtar
     öncekini ezdiği için çakışmada kullanıcı her zaman kazanır (bkz. BILINEN notu).
     Bu birleştirme yalnız BURADA yapılır — hotwords() bilinen isimleri ALMAZ. */
  entries = BILINEN.concat(entries || []);
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || !e.ad) continue;
    var ad = String(e.ad).trim();
    if (!ad) continue;
    var list = (e.varyant || []).concat([ad]);
    for (var j = 0; j < list.length; j++) {
      var v = _norm(list[j]).replace(/\s+/g, " ").trim();
      if (!v) continue;
      if (v.indexOf(" ") >= 0) ikili[v] = ad;   // "to fi" — model ismi ikiye bölmüşse
      else tek[v] = ad;
      varMi = true;
    }
  }
  return varMi ? { tek: tek, ikili: ikili } : null;
}

/* Tek kelimeyi düzeltir. Değişiklik yoksa null döner.
   Noktalama, apostroflu ek ve yapışık Türkçe ek korunur. */
/* ⚠ EK ÜNLÜSÜ KÖKE UYUMLANIR — YAPIŞIK EK DALINDA ŞART.
   Yapışık ek dalı kökü doğru adla değiştiriyor ama eki motorun YANLIŞ yazdığı gövdeden
   birebir kopyalıyordu. Türkçe'de ek ünlüsü köke göre uyumlanır; kök değişince ek de
   değişmeli. Ölçüldü (gerçek varsayılan sözlük): "tofuyu" → "Tofiyu", "tofunun" → "Tofinun",
   "tofuda" → "Tofida", "torasinda" → "Dorasinda". Ekranda ne konuşmacının söylediği ne de
   doğru Türkçe olan kelimeler çıkıyordu.
   ÇÖZÜM eki ATMAK DEĞİL (o, çalışan 110 vakayı bozuyordu — ölçüldü), ekin ÜNLÜSÜNÜ yeniden
   üretmek. Zincirleme uyum: her halka bir öncekine uyar ("torasinda" → "Dorasında").
   ÖLÇÜM: karakter adlarında 12/12 doğru (Tofiyi · Tofinin · Tofide · Tofiden · Tofiye ·
   Tofile · Tofiler · Nikoya · Nikodan · Nikonun · Monide). Yabancı adlarda 8 değişiklik
   (Batmanin→Batmanın, Batmane→Batmana, Batmanden→Batmandan, Supermane→Supermana…) — hepsi
   yazıma göre doğru ve eski hâl zaten hiçbir kurala uymuyordu.
   ⚠ APOSTROFLU DALA DOKUNULMAZ: "Tofi'ye" yazımında ek zaten kullanıcının/motorun doğru
   yazdığı hâliyle geliyor ve TDK'ya göre yabancı adlarda ek TELAFFUZA uyuyor ("Batman'in");
   orayı uyumlamak doğru yazımı bozardı. */
var _KALIN = "aıou", _INCE = "eiöü";
var _DAR_UYUM   = { "a": "ı", "ı": "ı", "e": "i", "i": "i", "o": "u", "u": "u", "ö": "ü", "ü": "ü" };
var _GENIS_UYUM = { "a": "a", "ı": "a", "o": "a", "u": "a", "e": "e", "i": "e", "ö": "e", "ü": "e" };
/* Türkçe büyük harf eşlemesi: JS toUpperCase 'i' → 'I' verir, Türkçe'de 'İ' olmalı. */
var _BUYUK_UNLU = { "a": "A", "e": "E", "ı": "I", "i": "İ", "o": "O", "ö": "Ö", "u": "U", "ü": "Ü" };
/* ⚠ TÜRKÇE KÜÇÜLTME — ham toLowerCase BURADA KULLANILAMAZ. JS kuralıyla 'I' → 'i' oluyor
   (Türkçe'de 'ı' olmalı) ve 'İ' → 'i' + U+0307 yani İKİ karakter; ikincisi _KALIN/_INCE
   içinde hiç bulunamıyor, ünlü sayılmıyor ve tarama bir önceki ünlüye kayıyor. Kalın/ince
   kararı yanlış olunca ekin TAMAMI yanlış uyumlanır.
   _norm BURADA KULLANILAMAZ: o ı/i'yi tek havuzda topluyor ve tam da bu ayrımı yok ediyor. */
function _trKucuk(c) {
  if (c === "I") return "ı";
  if (c === "İ") return "i";
  return String(c).toLowerCase();
}
function _sonUnlu(s) {
  for (var i = String(s).length - 1; i >= 0; i--) {
    var c = _trKucuk(String(s).charAt(i));
    if (_KALIN.indexOf(c) >= 0 || _INCE.indexOf(c) >= 0) return c;
  }
  return "";
}
/* ⚠ ÜNLÜ UYUMUNA GİRMEYEN EKLER — TDK. Bunlar her kökten sonra AYNI kalır:
     -gil  : "annemgil", "Ayşegil", "dayımgil"   (uyumlansa "gılda" gibi var olmayan ek çıkar)
     -ki   : "yarınki", "akşamki"                (yalnız "bugünkü" istisna)
     -ken  : "koşarken", "bakarken"
     -leyin: "sabahleyin", "akşamleyin"
   Doğrulamayı "_ekZinciri ile sına" diye yapmak YETMİYOR: _norm artık ı/i'yi tek havuzda
   topladığı için "gılda" normalize edilince "gilda" oluyor ve zincir testini geçiyor. */
var _UYUMSUZ_EK = /(gil|ki|ken|leyin)/i;
function _ekUyumla(ek, kokUnlu) {
  if (!kokUnlu || !ek) return ek;
  /* ⚠ UYUMSUZ HALKA EKİN TAMAMINI DEĞİL, ORADAN SONRASINI muaf tutar.
     Eskiden ek içinde "ki/gil/ken/leyin" geçmesi EKİN TAMAMINI uyumlamadan geçiriyordu:
     "tofudaki" → "Tofidaki" (doğrusu "Tofideki") — "-ki" gerçekten uyuma girmez ama ondan
     ÖNCEKİ "-da" girer. Aynı kök üzerinde tutarsızlık görünüyordu: "tofuda" doğru çevriliyor,
     "tofudaki" çevrilmiyordu.
     Şimdi uyumlama uyumsuz halkanın BAŞLADIĞI yerde duruyor: öncesi uyumlanır, halka ve
     sonrası özgün kalır. Ölçüldü: "tofudaki"→"Tofideki" · "tofununki"→"Tofininki" ·
     "dorragilde"→"Doragilde" (korunuyor) · "torandaki"→"Dorandaki" (korunuyor).
     ⚠ Arama büyük/küçük harfe DUYARSIZ ve ÖZGÜN dizge üzerinde: toLowerCase()'lenmiş kopyada
     index aramak 'İ' iki kod birimine açıldığı için kayabilirdi. */
  var kes = String(ek).search(_UYUMSUZ_EK);
  var on = (kes >= 0) ? String(ek).slice(0, kes) : String(ek);
  var arka = (kes >= 0) ? String(ek).slice(kes) : "";
  var out = "", u = kokUnlu, i, c, lc, y;
  for (i = 0; i < on.length; i++) {
    c = on.charAt(i); lc = _trKucuk(c);
    if ("ae".indexOf(lc) >= 0) y = _GENIS_UYUM[u];
    else if ("ıiuü".indexOf(lc) >= 0) y = _DAR_UYUM[u];
    else { out += c; continue; }
    /* ⚠ KASA KORUNUR. Tablolar yalnız küçük harf içeriyor; ünsüzler özgün kasasıyla
       kopyalandığı için BÜYÜK harfli bir ekte sonuç alacalı bir dizgeye dönüşüyordu
       ("TOFULARDAN" → "TofiLeRDeN"). Türkçe büyük harf eşlemesi ayrı tabloda: 'i' → 'İ'. */
    out += (c !== lc && _BUYUK_UNLU[y]) ? _BUYUK_UNLU[y] : y;
    u = y;
  }
  return out + arka;
}

function fixToken(tok, map) {
  if (!map) return null;
  var p = _bol(tok);
  if (!p.govde) return null;

  // apostroflu ek: "Toffy'ye" -> gövde "Toffy", ek "'ye"
  var ai = p.govde.search(RE_APOS);
  var kok = ai >= 0 ? p.govde.slice(0, ai) : p.govde;
  var ek = ai >= 0 ? p.govde.slice(ai) : "";
  var nk = _norm(kok);
  if (!nk) return null;

  var dogru = map.tek[nk];
  // apostrofsuz yapışık ek: "toffiye" -> "toffi" + "ye" (kalan geçerli bir Türkçe ek olmalı)
  if (!dogru && !ek) {
    for (var L = nk.length - 1; L >= 3; L--) {
      var onek = nk.slice(0, L), kalan = nk.slice(L);
      if (map.tek[onek] && _ekZinciri(kalan, 3)) {
        dogru = map.tek[onek];
        /* Ek DOĞRU ADIN son ünlüsüne uyumlanır (bkz. yukarıdaki not) — yanlış gövdeden değil.
           ⚠ UYUMLANMIŞ EK GEÇERLİ Mİ DİYE SINANIR. Türkçe'de her ek ünlü uyumuna girmez:
           "-gil" uyumsuzdur ("annemgil", "Ayşegil"), yani körlemesine uyumlamak "gilde"yi
           "gılda"ya çevirip var olmayan bir ek üretiyordu ("dorragilde" → "Doragılda").
           Uyumlanmış biçim geçerli bir ek zinciri değilse özgün ek olduğu gibi kalır —
           _EK tablosu zaten hangi biçimlerin var olduğunun tek kaynağı. */
        var _hamEk = kok.slice(L);
        var _uyumlu = _ekUyumla(_hamEk, _sonUnlu(dogru));
        ek = _ekZinciri(_norm(_uyumlu), 3) ? _uyumlu : _hamEk;
        break;
      }
    }
  }
  if (!dogru) return null;

  var yeni = p.on + dogru + ek + p.son;
  return (yeni === String(tok)) ? null : yeni;   // zaten doğruysa "düzeltme" sayma
}

/* İKİ KELİME GERÇEKTEN YAN YANA MI? İkili birleştirme eskiden yalnız "dizide komşu mu" ve
   "normalize metinler anahtara uyuyor mu" diye bakıyordu; ARADAKİ ZAMANA ve segment kimliğine
   hiç bakmıyordu. Varsayılan sözlükteki ikili anahtarların çoğu Türkçe'de tek başına geçebilen
   kısa hecelerden oluşuyor ("mi mi", "to fi", "mo ni", "do ra", "ni ko"). Ölçüldü: videonun
   41. saniyesindeki "…geldi mi?" ile 95. saniyesindeki "Mi ne?" tek kelimeye kaynayıp
   {word:"Mimi", start:41.0, end:95.4} oluyordu — 54 saniyelik bir kelime. Sonuç yalnız yanlış
   metin değil: birleşen kelime words[i]'nin seg'ini koruduğu için cue'nun cumleId'si YANLIŞ
   cümleyi gösteriyor, ileri fırlayan end ise buildCues'un boşluk/segment bölmesini o noktada
   devre dışı bırakıyor.
   ⚠ TAVAN İKİ KADEMELİ, TEK SAYI DEĞİL. Tabloda gerçekten AYRI söylenen çok kelimeli adlar
   da var ("kaptan amerika", "dead pool", "iron men", "bet men"); yavaş konuşmada aralarındaki
   boşluk 0.3 sn'yi rahatça aşar ve tek düşük tavan o düzeltmeleri sessizce öldürürdü. Bu yüzden
   iki parçası da <=3 harf olan hece bölünmeleri için 0.30, gerçek çok kelimeli adlar için
   buildCues'un GAP'iyle aynı 0.70 kullanılıyor.
   Zaman alanı yoksa (fixText yolu — düz metinde damga yok) eski davranış aynen korunur. */
var _IKILI_HECE = 0.30, _IKILI_AD = 0.70;
function _ikiliBitisik(w1, w2, na, nb) {
  /* Farklı Whisper segmentleri = farklı cümleler. null ise bilgi yok, engelleme. */
  if (w1.seg != null && w2.seg != null && w1.seg !== w2.seg) return false;
  var bos = Number(w2.start) - Number(w1.end);
  if (!isFinite(bos)) return true;
  /* ⚠ EŞİK 3 DEĞİL 2. Üç harf tavanı "bet men"i (Batman) HECE kovasına düşürüyordu: yorum
     onu açıkça "gerçekten AYRI söylenen çok kelimeli ad" sayıyor ama kod 0.30 sn uyguluyor
     ve 0.40 sn ara ile söylendiğinde birleştirmiyordu (ölçüldü — düzeltme öncesi boşluk ne
     olursa olsun birleşiyordu, yani regresyondu). Gerçek hece bölünmelerinin HEPSİ 2+2:
     to fi · mo ni · do ra · mi mi · ni ko. */
  return bos <= ((na.length <= 2 && nb.length <= 2) ? _IKILI_HECE : _IKILI_AD);
}

/* Whisper kelime listesini (flattenWords çıktısı) YERİNDE düzeltir; düzeltme sayısını döner.
   İkili varyant eşleşirse iki kelime tek kelimede birleşir (zaman damgası genişletilir). */
function fixWords(words, map) {
  if (!map || !words || !words.length) return 0;
  var n = 0;
  for (var i = 0; i < words.length; i++) {
    // önce ikili dene: model ismi bölmüş olabilir ("To" + "fi")
    if (i + 1 < words.length) {
      var a = _bol(words[i].word), b = _bol(words[i + 1].word);
      var na = _norm(a.govde), nb = _norm(b.govde);
      var dogru = map.ikili[na + " " + nb];
      if (dogru && _ikiliBitisik(words[i], words[i + 1], na, nb)) {
        /* ⚠ a.son KORUNUR AMA CÜMLE SINIRI SAYILAN İŞARETLER ATILIR.
           İlk parçanın noktalaması birleşik kelimenin SONUNA taşınıyor; buildCues tam orayı
           okuyup (`/[!?…:]$/` ya da sonda nokta) cue'yu FLUSH ediyor. Yani "To." + "fi"
           birleşince "Tofi." oluyor ve arkasından SAHTE bir cümle sonu doğuyor — ölçüldü:
           maxWords=2 iken "Tofi geldi" olması gereken cue "Tofi" (tek kelime, 0.42 sn) diye
           bölünüyor, yani projenin özellikle savaştığı "yetim tek-kelimelik cue" sınıfı geri
           geliyordu. Ayrıca "To?" + "fi!" → "Tofi?!" oluyordu (cleanPunct ! ve ? korur).
           Virgül/nokta zaten cleanPunct tarafından siliniyor, yani onları taşımanın ölçülen
           kazancı SIFIR; parantez/tırnak gibi zararsız işaretler korunuyor. */
        words[i].word = a.on + dogru + String(a.son).replace(/[.!?…:,]/g, "") + b.son;
        words[i].end = words[i + 1].end;
        words.splice(i + 1, 1);
        n++;
        continue;
      }
    }
    var f = fixToken(words[i].word, map);
    if (f !== null) { words[i].word = f; n++; }
  }
  return n;
}

// Düz metni düzeltir (panelde elle yazılan/düzenlenen satırlar için)
function fixText(text, map) {
  if (!map) return String(text);
  var parcalar = String(text).split(/(\s+)/);
  for (var i = 0; i < parcalar.length; i++) {
    if (/^\s*$/.test(parcalar[i])) continue;
    var f = fixToken(parcalar[i], map);
    if (f !== null) parcalar[i] = f;
  }
  return parcalar.join("");
}

/* Motora verilecek ipucu dizesi: "Tofi, Moni, Dora, Mimi, Niko"
   BURAYA BILINEN LİSTESİNİ EKLEME. --hotwords sınırlı bir token alanı kullanıyor (motorun
   kendi --help'i "unsafely cuts into the new tokens space" diyor, faster-whisper 223 token'da
   sessizce kesiyor); liste şişerse kullanıcının KENDİ karakter isimleri ipucu dışında kalır ve
   asıl iş bozulur. Bilinen isimler yalnız transkript sonrası düzeltmeye girer (bkz. buildMap). */
function hotwords(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var ad = entries[i] && entries[i].ad ? String(entries[i].ad).trim() : "";
    if (ad) out.push(ad);
  }
  return out.join(", ");
}

/* Panel metin kutusu formatı:  DoğruYazım: yanlış1, yanlış2
   Boş satırlar ve '#' ile başlayan satırlar yok sayılır. */
function parseText(text) {
  var out = [], lines = String(text == null ? "" : text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].trim();
    if (!ln || ln.charAt(0) === "#") continue;
    var ix = ln.indexOf(":");
    var ad = (ix >= 0 ? ln.slice(0, ix) : ln).trim();
    if (!ad) continue;
    var vs = (ix >= 0 ? ln.slice(ix + 1) : "").split(/[,;]/);
    var temiz = [];
    for (var j = 0; j < vs.length; j++) { var v = vs[j].trim(); if (v) temiz.push(v); }
    out.push({ ad: ad, varyant: temiz });
  }
  return out;
}
function toText(entries) {
  var out = [];
  entries = entries || [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e || !e.ad) continue;
    out.push(String(e.ad) + ((e.varyant && e.varyant.length) ? ": " + e.varyant.join(", ") : ""));
  }
  return out.join("\n");
}

function defaults() { return JSON.parse(JSON.stringify(VARSAYILAN)); }

function load(extRoot) {
  try {
    var p = path.join(extRoot, DOSYA);
    if (fs.existsSync(p)) {
      var raw = fs.readFileSync(p, "utf8");
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // BOM'a dayanıklılık
      var j = JSON.parse(raw);
      if (j && j.entries && j.entries.length) return j.entries;
      if (j && j.entries) return [];   // kullanıcı bilerek boşalttıysa varsayılana DÖNME
    }
  } catch (e) {}
  return defaults();
}
function save(extRoot, entries) {
  /* ⚠ pkgSurum DA YAZILIR. Yazılmazsa kullanıcı sözlüğü her kaydettiğinde damga siliniyor,
     sonraki açılışta paketBirlestir yeniden çalışıyor ve kullanıcının BİLEREK SİLDİĞİ varyant
     geri geliyordu — "bir kez ekle" sözü ancak damga kalıcıysa tutuluyor. */
  var p = path.join(extRoot, DOSYA);
  entries = entries || [];

  /* ⚠⚠ SİLİNEN VARSAYILAN İSİMLER KAYDEDİLİR — YOKSA HER SÜRÜMDE DİRİLİYORLAR.
     GERÇEK SENARYO (ikinci kullanıcı): ParsMazi "Karakter İsimleri" kutusundan
     Tofi/Moni/Dora/Mimi/Niko satırlarını siliyor ve kendi kadrosunu yazıyor. Sorun çıkmıyor —
     ta ki PAKET_SURUM bir sonraki sürümde artana kadar. O anda paketBirlestir "bu isim
     kullanıcıda YOK" deyip beşini de GERİ EKLİYOR ve sözlük her sürümde yeniden kirleniyor.
     Damga bunu engellemiyor: damga "bir kez çalış" diyor, sürüm artınca yeniden çalışıyor.
     ⚠ pkgSurum'dan ÇIKARIM YAPILAMAZ: save() damgayı koşulsuz yazıyor, yani "damga var =
     birleştirmeden geçmiş" doğru değil. Karar AÇIKÇA kaydedilmek zorunda.
     ⚠ BİRİKTİRİLİR (union): kullanıcı önce Tofi'yi, sonra Moni'yi silerse ikisi de kayıtta
     kalmalı; yalnız son kaydın anlık görüntüsünü yazmak eskisini unuturdu. */
  var silinen = [];
  try {
    var eski = null, ham = "";
    if (fs.existsSync(p)) {
      ham = fs.readFileSync(p, "utf8");
      if (ham.charCodeAt(0) === 0xFEFF) ham = ham.slice(1);
      eski = JSON.parse(ham);
    }
    if (eski && Object.prototype.toString.call(eski.silinenVarsayilanlar) === "[object Array]") {
      silinen = eski.silinenVarsayilanlar.slice();
    }
  } catch (e) { silinen = []; }
  try {
    var varAd = {}, i;
    for (i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].ad) varAd[String(entries[i].ad).toLowerCase()] = 1;
    }
    var kayitli = {};
    for (i = 0; i < silinen.length; i++) kayitli[String(silinen[i]).toLowerCase()] = 1;
    /* ⚠ Liste TAMAMEN boşsa silme kaydı çıkarma: "boşalttım" ayrı bir karar ve
       paketBirlestir onu zaten `bos-birakilmis` dalıyla koruyor. Boş listeden beş
       "silindi" kaydı üretmek, kullanıcı sonra varsayılanlara dönmek isterse onu
       kalıcı olarak engellerdi. */
    if (entries.length) {
      VARSAYILAN.forEach(function (v) {
        var k = String(v.ad).toLowerCase();
        if (!varAd[k] && !kayitli[k]) { silinen.push(v.ad); kayitli[k] = 1; }
      });
    }
  } catch (e2) {}

  fs.writeFileSync(p, JSON.stringify({ pkgSurum: PAKET_SURUM, silinenVarsayilanlar: silinen,
                                       entries: entries }, null, 2), "utf8");
  return p;
}

/* ── PAKETTEKİ YENİ VARYANTLARI KULLANICININ DOSYASINA BİR KEZ EKLE ──
   NEDEN VAR (ParsMazi, 11 Ağustos 2026): panel "Tofi" yerine "Tobi" yazıyordu. Varyantı
   VARSAYILAN'a eklemek tek başına YETMEZ — `load()` kullanıcının sozluk.json'ı varsa
   varsayılana hiç bakmıyor, yani düzeltme sözlüğü bir kez kaydetmiş HİÇ KİMSEYE ulaşmıyor.
   Bu, bu projede üçüncü kez çıkan aynı soru: "yeni hazır içerik MEVCUT kullanıcıya nasıl
   ulaşacak?" (emoji PNG tazeleme ve presetSeciliTazele aynı dersten doğdu).

   KURALLAR — üçü de bilinçli:
   · YALNIZ EKLER, hiçbir şey silmez veya değiştirmez. Kullanıcının kendi isimleri ve
     kendi yazdığı varyantlar olduğu gibi kalır.
   · PAKET_SURUM damgasıyla BİR KEZ çalışır. Damgasız bir birleştirme, kullanıcının bilerek
     sildiği varyantı her açılışta geri getirirdi.
   · Kullanıcı sözlüğü BİLEREK boşalttıysa (entries: []) dokunulmaz — `load()`'daki
     "boşalttıysa varsayılana DÖNME" kuralının aynısı, aksi hâlde o karar delinirdi. */
function paketBirlestir(extRoot) {
  var p = path.join(extRoot, DOSYA), raw, j;
  try {
    if (!fs.existsSync(p)) return { durum: "dosya-yok", eklenen: [] };   // load() zaten varsayılanı verir
    raw = fs.readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    j = JSON.parse(raw);
  } catch (e) { return { durum: "okunamadi", eklenen: [], hata: String((e && e.message) || e) }; }
  if (!j || !j.entries || Object.prototype.toString.call(j.entries) !== "[object Array]")
    return { durum: "bicim", eklenen: [] };
  if (!j.entries.length) return { durum: "bos-birakilmis", eklenen: [] };
  if (Number(j.pkgSurum || 0) >= PAKET_SURUM) return { durum: "guncel", eklenen: [] };

  var eklenen = [], indeks = {}, i;
  for (i = 0; i < j.entries.length; i++) {
    if (j.entries[i] && j.entries[i].ad) indeks[String(j.entries[i].ad).toLowerCase()] = i;
  }
  /* ⚠ KULLANICININ BİLEREK SİLDİĞİ VARSAYILAN İSİMLER GERİ EKLENMEZ.
     save() bu listeyi tutuyor (bkz. oradaki not). Bu kontrol olmadan, kendi kadrosunu yazıp
     Tofi/Moni/Dora/Mimi/Niko'yu silmiş bir kullanıcıda beşi de HER PAKET SÜRÜMÜNDE geri
     geliyordu — "yalnız EKLER, hiçbir şey silmez" kuralı doğruydu ama eklediği şey
     kullanıcının kaldırdığı şeydi. */
  var silinenSet = {};
  try {
    if (Object.prototype.toString.call(j.silinenVarsayilanlar) === "[object Array]") {
      for (i = 0; i < j.silinenVarsayilanlar.length; i++) {
        silinenSet[String(j.silinenVarsayilanlar[i]).toLowerCase()] = 1;
      }
    }
  } catch (eS) {}
  VARSAYILAN.forEach(function (v) {
    var k = String(v.ad).toLowerCase();
    if (indeks[k] === undefined) {
      if (silinenSet[k]) return;                       // bilerek silmiş — diriltme
      j.entries.push({ ad: v.ad, varyant: (v.varyant || []).slice() });
      eklenen.push(v.ad + " (yeni isim)");
      return;
    }
    var mevcut = j.entries[indeks[k]];
    if (!mevcut.varyant) mevcut.varyant = [];
    var gorulen = {}, q;
    for (q = 0; q < mevcut.varyant.length; q++) gorulen[String(mevcut.varyant[q]).toLowerCase()] = 1;
    (v.varyant || []).forEach(function (x) {
      if (!gorulen[String(x).toLowerCase()]) { mevcut.varyant.push(x); eklenen.push(v.ad + ": " + x); }
    });
  });
  j.pkgSurum = PAKET_SURUM;
  try { fs.writeFileSync(p, JSON.stringify(j, null, 2), "utf8"); }
  catch (e2) { return { durum: "yazilamadi", eklenen: eklenen, hata: String((e2 && e2.message) || e2) }; }
  return { durum: "birlestirildi", eklenen: eklenen };
}

module.exports = {
  load: load, save: save, defaults: defaults, paketBirlestir: paketBirlestir,
  PAKET_SURUM: PAKET_SURUM,
  parseText: parseText, toText: toText,
  buildMap: buildMap, fixWords: fixWords, fixToken: fixToken, fixText: fixText,
  hotwords: hotwords, DOSYA: DOSYA,
};
