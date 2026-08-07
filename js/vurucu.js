/*
 * Vurucu cümle seçimi — "Tofi Moni video modu".
 *
 * ⚠⚠ GİZLİLİK — PANELİN İNTERNETE ÇIKAN İLK YOLU BURASIDIR. ⚠⚠
 *   Bu modül çalıştığında videonun KONUŞMA METNİ (cue metinleri + zaman damgaları)
 *   makineden ÇIKAR ve HTTPS ile Anthropic sunucusuna (api.anthropic.com) gönderilir.
 *   Ses, görüntü, dosya yolu, proje adı GÖNDERİLMEZ — yalnız düz yazı ve saniye.
 *   Panelin geri kalanı internete veri YOLLAMAZ (js/updater.js yalnızca GitHub'dan
 *   sürüm İNDİRİR, hiçbir şey göndermez). Bu modül çağrılmadıkça hiçbir şey dışarı
 *   çıkmaz: "Tofi Moni video modu" kutusu kapalıyken bu dosya hiç çalıştırılmamalı.
 *   API anahtarı da makinede kalır (anthropic-key.txt) ve yalnız istek başlığına konur.
 *
 * NE YAPAR
 *   (a) İlk `tamSaniye` (varsayılan 60) saniye: HERKESİN konuşması tam altyazılanır.
 *       Sınırda kesilen cümle TAMAMLANIR — cümlenin son cue'su 60. saniyeyi aşsa bile
 *       gösterilir (yarım cümle ekranda kalmaz).
 *   (b) Sonrası: yaklaşık `aralikSn` (20) saniyede BİR, o aralıktaki en vurucu cümle
 *       gösterilir; gerisi yazılmaz.
 *
 * NEDEN HARİCİ LLM: yerel sinyaller ölçüldü ve zayıf çıktı — ünlemli/ünlemsiz cümlelerin
 * tepe ses farkı 0.1 dB, pencerelerin %39'unda hiç ünlem yok. Yani "en yüksek sesli" ya da
 * "ünlemli olan" kuralı vurucu cümleyi bulamıyor. Kullanıcı bunu bilerek harici LLM'e verdi.
 *
 * CUE SİLİNMEZ, YALNIZCA İŞARETLENİR (cue.vurucuGoster = true/false).
 * Sebep: kullanıcı fikrini değiştirince 25 dakikalık GPU işi (Whisper) tekrarlanmasın.
 * Filtreleme SRT yazılırken `gosterilenler(cues)` ile yapılır; `temizle(cues)` işareti kaldırır.
 */
var fs = require("fs");
var path = require("path");
var https = require("https");

var DOSYA = "anthropic-key.txt";        // panel klasöründe; kullanıcı dosyası (gitignore + installer korumaları)
var MODEL = "claude-sonnet-5";          // bu iş için uygun tier: hızlı ve isabetli
var API_HOST = "api.anthropic.com";
var API_YOL = "/v1/messages";
var API_SURUM = "2023-06-01";           // anthropic-version başlığı (sabit, tarih gibi görünse de sürüm etiketi)

/* Varsayılanlar TEK YERDE. Panel opts ile ezebilir; buradaki değerler ölçüme değil
   kullanıcının isteğine dayanıyor (60 sn tam bölüm, ~20 sn'de bir vurucu cümle). */
var VARSAYILAN = {
  tamSaniye: 60,        // ilk kaç saniye tam altyazılansın
  aralikSn: 20,         // sonrasında yaklaşık kaç saniyede bir seçim
  mesafePayi: 5,        // iki seçim arası en az (aralikSn - mesafePayi) saniye
  bosluk: 0.75,         // cue'lar arası bu kadar sessizlik = cümle sınırı (cumleId yoksa)
  maxCue: 40,           // bir "cümle" en fazla bu kadar cue olabilir (sınır sinyali hiç gelmediyse)
  maxSure: 25,          // ve en fazla bu kadar saniye
  parcaCumle: 200,      // bir istekte en fazla kaç cümle
  parcaPencere: 40,     // ve en fazla kaç pencere (cevap uzunluğunu sınırlar)
  zamanAsimiMs: 60000,  // tek isteğin toplam süre tavanı
  deneme: 2,            // 429/5xx/ağ hatasında kaç EK deneme
  maxTokens: 4000,      // cevap yalnız küçük bir JSON; yine de bol pay bırakıldı
  metinSiniri: 220,     // isteğe giden cümle metni bu uzunlukta kırpılır (token bütçesi)
  yapisalCikti: true    // output_config.format ile şemaya zorla (bkz. _govdeKur)
};

/* ---------------------------------------------------------------- iptal
   Panelin diğer uzun işlerindeki desen (bkz. pipeline.js): kullanıcı "İptal"e her
   bastığında sayaç artar; iş başlarken damgasını alır ve her adımda damga değişti mi
   diye bakar. Böylece iptal edilen iş "hata" sanılıp baştan denenmez. */
var _iptalSayaci = 0;
var _aktifIstekler = [];

function iptal() {
  var n = _aktifIstekler.length;
  _iptalSayaci++;
  for (var i = 0; i < _aktifIstekler.length; i++) {
    try { _aktifIstekler[i].destroy(); } catch (e) {}
  }
  _aktifIstekler.length = 0;
  return n;
}
function iptalDamgasi() { return _iptalSayaci; }
/* damga verilmediyse (null/undefined) iptal YOK say. Savunma: çağıran taraf damgayı
   unutursa sayaç 0 ile karşılaştırma "0 !== null" → true verip işi daha başlamadan
   iptal ediyordu (emoji modülünde tam olarak bu oldu). */
function iptalEdildiMi(damga) {
  if (damga === null || damga === undefined) return false;
  return _iptalSayaci !== damga;
}

function _iptalHatasi() { var e = new Error("İptal edildi"); e.iptal = true; return e; }
function _hata(mesaj, ek) {
  var e = new Error(mesaj);
  e.vurucuHata = true;
  if (ek) { for (var k in ek) { if (Object.prototype.hasOwnProperty.call(ek, k)) e[k] = ek[k]; } }
  return e;
}

/* ------------------------------------------------------------- API anahtarı */
function anahtarYolu(extRoot) { return path.join(extRoot, DOSYA); }

/* Anahtarı okur. YOKSA/BOŞSA net hata FIRLATIR — sessizce geçmek ya da "anahtarsız
   deneyip 401 almak" yasak: kullanıcı ne yapması gerektiğini mesajdan anlamalı. */
function anahtarOku(extRoot) {
  var p = anahtarYolu(extRoot);
  var raw = "";
  try {
    if (fs.existsSync(p)) raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    throw _hata("API anahtarı okunamadı (" + DOSYA + "): " + e.message, { anahtarYok: true });
  }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);          // BOM'a dayanıklılık
  /* Kullanıcı anahtarı Not Defteri'nden yapıştırırken satır sonu/boşluk taşır;
     ilk DOLU satırı alıyoruz. Başlığa kaçak boşluk girerse sunucu 401 döner. */
  var satirlar = String(raw).split(/\r?\n/);
  var anahtar = "";
  for (var i = 0; i < satirlar.length; i++) {
    var s = satirlar[i].trim();
    if (s) { anahtar = s; break; }
  }
  /* ⚠ KISALTILMIŞ ANAHTAR TUZAĞI — GERÇEKTEN OLDU (ParsMazi, 7 Ağustos 2026).
     Anthropic anahtarın TAM hâlini yalnız oluşturulduğu anda bir kez gösteriyor; konsol
     listesinde ise "sk-ant-api03-5Ue...2gAA" diye KISALTILMIŞ görünüyor. Kullanıcı listeden
     kopyalayınca ortadaki "..." de geliyor ve sunucu "invalid x-api-key" (401) dönüyor —
     yani anahtar "yanlış" değil, EKSİK. Sebebi mesajdan anlaşılmıyordu: kullanıcı anahtarı
     defalarca kontrol ediyor, hep doğru görünüyor.
     İstek GÖNDERİLMEDEN yakalanıyor: boşuna bekleme ve boşuna "anahtar geçersiz" şüphesi yok. */
  if (anahtar.indexOf("...") !== -1 || anahtar.indexOf("…") !== -1) {
    throw _hata("Anahtar EKSİK: içinde \"...\" var. Anthropic'in listesinde anahtar kısaltılmış " +
                "gösteriliyor; oradan kopyalanan hâli çalışmaz. Yeni bir anahtar oluştur ve " +
                "açılan pencerede gösterilen TAM hâlini yapıştır (o pencere kapanınca bir daha " +
                "gösterilmiyor).", { anahtarYok: true });
  }
  if (anahtar && anahtar.length < 40) {
    throw _hata("Anahtar çok kısa (" + anahtar.length + " karakter) — yarım kopyalanmış olabilir. " +
                "Anthropic'te yeni anahtar oluşturup TAM hâlini yapıştır.", { anahtarYok: true });
  }
  if (!anahtar) {
    throw _hata("Anthropic API anahtarı yok. Panel klasörüne \"" + DOSYA + "\" dosyasını " +
                "koy (içinde tek satır: sk-ant-... ile başlayan anahtar) ya da panelden gir.",
                { anahtarYok: true });
  }
  return anahtar;
}
function anahtarVarMi(extRoot) {
  try { anahtarOku(extRoot); return true; } catch (e) { return false; }
}
/* Paneldeki kutudan kaydetmek için. Anahtar LOG'A YAZILMAZ, yalnızca dosyaya. */
function anahtarYaz(extRoot, deger) {
  var temiz = String(deger == null ? "" : deger).trim();
  var p = anahtarYolu(extRoot);
  if (!temiz) { try { fs.unlinkSync(p); } catch (e) {} return p; }
  fs.writeFileSync(p, temiz + "\n", "utf8");
  return p;
}

/* ------------------------------------------------------------- yardımcılar */
function _sayi(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function _ayar(opts, ad) {
  opts = opts || {};
  var v = opts[ad];
  if (v === undefined || v === null || v === "" || (typeof v === "number" && !isFinite(v))) return VARSAYILAN[ad];
  return v;
}
function _saat(sn) {
  sn = Math.max(0, Math.floor(_sayi(sn)));
  var s = sn % 60, d = Math.floor(sn / 60) % 60, h = Math.floor(sn / 3600);
  function p2(x) { return (x < 10 ? "0" : "") + x; }
  return (h > 0 ? (h + ":") : "") + p2(d) + ":" + p2(s);
}
/* Zaman sırası: panel "Herkes" kaynağında kanalları AYRI yazıya döküp birleştiriyor,
   yani gelen dizi zaman sıralı OLMAYABİLİR. Çağıranın dizisini bozmamak için yalnız
   INDEKS sıralanır; işaretleme özgün nesneler üzerinde yapılır. */
function _zamanSirasi(cues) {
  var sira = [], i;
  for (i = 0; i < cues.length; i++) sira.push(i);
  sira.sort(function (a, b) {
    /* (cues[x] || {}) NEDEN: dizide boş/null bir eleman olursa karşılaştırma ÇÖKERDİ;
       boş cue'lar aşağıda zaten sayılıp atlanıyor, sıralama onlara takılmasın. */
    var fa = _sayi((cues[a] || {}).start), fb = _sayi((cues[b] || {}).start);
    if (fa !== fb) return fa - fb;
    return a - b;                      // eşitlikte özgün sıra (JS sort kararlılığı garanti değil)
  });
  return sira;
}

/* ---------------------------------------------------------------- cümleler
   Seçim CÜMLE birimindedir: bir cümle seçildiyse ona ait BÜTÜN cue'lar gösterilir.
   Cue'lar 2-3 kelimelik parçalar; yarım cümle göstermek kabul edilemez.

   ⚠ TUZAK: pipeline.js cleanPunct() NOKTAYI SİLİYOR (yalnız "!" ve "?" kalıyor), ve
   buildCues süre döngüsü cue.end'i bir sonrakine kadar UZATABİLİYOR — yani hem noktalama
   hem de boşluk sinyali zayıf. Bu yüzden sınır kararında BİRLEŞTİRME yönünde hata
   yapılıyor: sinyal net değilse cümle bölünmez. İki cümleyi tek sayarsak sadece bir
   fazla cümle gösterilir; yanlış bölersek EKRANDA YARIM CÜMLE çıkar — ikincisi kabul
   edilemez. Çağıran cue'lara `cumleId` koyabiliyorsa o kesin bilgidir, ona güvenilir. */

/* cumleId'yi tek biçime indirger; yok/boşsa null döner. Boş dizgi de "yok" sayılır:
   pipeline.js kimliği "<oturum jetonu>:<çağrı no>:<segment>" biçiminde üretir ve asla
   boş bırakmaz — yani boş bir değer ancak başka bir çağırandan gelir, kesin bilgi değildir. */
function _cumleId(cue) {
  var v = cue.cumleId;
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

/* KOMŞULUK sezgisi. NEDEN artık yalnız kimliksiz cue'lar için: cumleId'li cue'lar
   cumleleriCikar içinde DOĞRUDAN kimliğe göre gruplanıyor (oradaki NEDEN'e bak), bu
   fonksiyona hiç uğramıyorlar. Buraya cumleId dalı geri eklenirse KRİTİK hata da geri
   gelir — zaman sıralı listede araya giren başka kanalın cue'su cümleyi ikiye böler. */
function _sinirMi(onceki, cue, bosluk) {
  if (onceki.speaker && cue.speaker && onceki.speaker !== cue.speaker) return true;   // kişi değişti
  if (/[!?…]["'»)\]]*\s*$/.test(String(onceki.text || ""))) return true;              // cümleyi bitiren noktalama
  if (/[.:]\s*$/.test(String(onceki.text || ""))) return true;                        // ham metin geldiyse nokta da sinyal
  return (_sayi(cue.start) - _sayi(onceki.end)) > bosluk;                              // araya sessizlik girdi
}

/* Aşırı uzayan grubu EN BÜYÜK boşluktan böler. Neden gerekli: hiç sınır sinyali gelmeyen
   uzun bir monolog tek "cümle" olur ve 20 saniye kuralı çöker (tek seçim 3 dakika sürer).
   Bölme noktası rastgele değil, en uzun duraklama — orası cümle sınırı olma ihtimali en
   yüksek yer. Kaç kere zorlandığı SAYILIR ve log'a yazılır (sessizce bölmek yasak). */
/* ⚠ enBuyuk NEDEN -Infinity: boşluklar NEGATİF olabiliyor (buildCues cue.end'i bir sonraki
   cue'ya kadar uzatıyor, "Herkes" kaynağında iki kanalın cue'ları da iç içe geçiyor).
   Başlangıç -1 iken tüm boşluklar -1 sn ve altındaysa hiçbiri seçilmiyor, -1 dönüyor ve
   çağıran "bölünecek yer yok" deyip SESSİZCE geçiyordu: 50 cue / 51.5 sn'lik tek blok
   maxCue ve maxSure'yi aştığı hâlde bölünmeden kalıyordu (ölçüldü). -Infinity ile en az
   kötü boşluk her zaman seçilir; 2+ cue'lu her grup mutlaka bölünebilir. */
function _enBuyukBosluk(cues, idxler) {
  var enIyi = -1, enBuyuk = -Infinity;
  var orta = idxler.length / 2;
  for (var i = 1; i < idxler.length; i++) {
    var g = _sayi(cues[idxler[i]].start) - _sayi(cues[idxler[i - 1]].end);
    if (g > enBuyuk) { enBuyuk = g; enIyi = i; continue; }
    /* EŞİTLİKTE ORTAYA EN YAKIN yer seçilir. NEDEN: boşlukların hepsi aynıysa (ölçülen
       negatif-boşluk hâli) hep ilk nokta seçilir ve grup 1 + (n-1) diye SOYULUR —
       50 cue'luk blok 50 tane tek cue'luk "cümle"ye dönerdi. Ortadan bölmek dengeli
       iki parça verir; en uzun duraklama kuralı bozulmaz, yalnız beraberlik çözülür. */
    if (g === enBuyuk && Math.abs(i - orta) < Math.abs(enIyi - orta)) enIyi = i;
  }
  return enIyi;
}

/* cues -> [{id, cueler:[origIdx], bas, bit, metin, speaker}] (zaman sıralı) */
function cumleleriCikar(cues, opts) {
  cues = cues || [];
  var bosluk = _sayi(_ayar(opts, "bosluk"));
  var maxCue = _sayi(_ayar(opts, "maxCue"));
  var maxSure = _sayi(_ayar(opts, "maxSure"));
  var sira = _zamanSirasi(cues);
  var gruplar = [], idHarita = {}, cur = null, i;
  var bosCue = 0;

  /* ⚠ KRİTİK — GRUPLAMA KİMLİĞE GÖRE, KOMŞULUĞA GÖRE DEĞİL.
     Eskiden cumleId varken bile gruplar zaman sıralı listede KOMŞULUKLA kuruluyordu.
     "Herkes" kaynağında iki kanal aynı anda konuşunca bir kanalın cue'su diğerinin
     cümlesinin ORTASINA düşüyor ve tek cümle ikiye bölünüyordu (ölçüldü: A kanalının
     '1:5' cümlesi 100-102 ve 103-104 cue'larıyken araya B'nin 102.2-102.8 cue'su girince
     2 yerine 3 cümle çıktı). Sonucu ağırdı: LLM'e YARIM CÜMLE adayı gidiyordu ve seçilirse
     ekranda yarım cümle kalıyordu — bu modülün başında "kabul edilemez" dediği durum.
     Ayrıca "sınırda kesilen cümle TAMAMLANIR" garantisi de çöküyordu.
     Kimlik çakışma riski yok: pipeline.js önekinde panel oturumu jetonu + çağrı sayacı var,
     yani farklı kanal/oturum aynı kimliği ÜRETEMEZ. */
  for (i = 0; i < sira.length; i++) {
    var idx = sira[i];
    var cue = cues[idx];
    /* Boş/metinsiz cue cümle kurmaz — ama SESSİZCE atlanmaz, sayılır ve çağırana bildirilir. */
    if (!cue || !String(cue.text == null ? "" : cue.text).trim()) { bosCue++; continue; }
    var cid = _cumleId(cue);
    if (cid !== null) {
      /* "c" öneki ŞART: "__proto__"/"constructor" gibi bir kimlik düz nesnede prototip
         alanına çarpar, grup ya kaybolur ya da mevcut sanılırdı. */
      var anahtarAd = "c" + cid;
      if (!Object.prototype.hasOwnProperty.call(idHarita, anahtarAd)) {
        idHarita[anahtarAd] = [];
        gruplar.push(idHarita[anahtarAd]);
      }
      idHarita[anahtarAd].push(idx);
      cur = null;         // kimlikli cue zinciri keser: sonraki KİMLİKSİZ cue buna yapışmasın
      continue;
    }
    if (cur && _sinirMi(cues[cur[cur.length - 1]], cue, bosluk)) cur = null;
    if (!cur) { cur = []; gruplar.push(cur); }
    cur.push(idx);
  }

  // Zorunlu bölme (yukarıdaki yorum): sınır sinyali hiç gelmemiş devasa gruplar.
  var zorlaBolundu = 0, bolunemedi = 0, guvenlik = 0, guvenlikDoldu = false;
  for (i = 0; i < gruplar.length; i++) {
    /* Tavan sonsuz döngüye karşı; çarpıldığında SESSİZ geçilmez, çağırana bildirilir. */
    if (guvenlik >= 5000) { guvenlikDoldu = true; break; }
    var g = gruplar[i];
    if (g.length < 2) continue;
    var sure = _sayi(cues[g[g.length - 1]].end) - _sayi(cues[g[0]].start);
    if (g.length <= maxCue && sure <= maxSure) continue;
    var kes = _enBuyukBosluk(cues, g);
    /* -Infinity düzeltmesinden sonra buraya düşmek teorik olarak imkânsız; yine de
       sessiz geçilmiyor, çünkü buraya düşen grup DEVASA kalıyor ve 20 sn kuralını çökertiyor. */
    if (kes <= 0) { bolunemedi++; continue; }
    gruplar.splice(i, 1, g.slice(0, kes), g.slice(kes));
    zorlaBolundu++; guvenlik++;
    i--;                                          // yeni parçalar da uzun olabilir, tekrar bak
  }

  /* Gruplar artık kimliğe göre kurulduğu için dizideki sıraları zaman sırası DEĞİL
     (ve zorunlu bölme parçaları da yer değiştirebiliyor). Pencere dağıtımı, ilk bölüm
     ve mesafe kuralı zaman sırası varsayar — burada bir kez sıraya sokulur. */
  gruplar.sort(function (a, b) {
    var fa = _sayi(cues[a[0]].start), fb = _sayi(cues[b[0]].start);
    if (fa !== fb) return fa - fb;
    return a[0] - b[0];                           // eşitlikte özgün cue sırası (sort kararlılığı garanti değil)
  });

  var cumleler = [];
  for (i = 0; i < gruplar.length; i++) {
    var gg = gruplar[i], metin = "", j;
    for (j = 0; j < gg.length; j++) metin += (j ? " " : "") + String(cues[gg[j]].text).trim();
    cumleler.push({
      id: cumleler.length + 1,
      cueler: gg,
      bas: _sayi(cues[gg[0]].start),
      bit: _sayi(cues[gg[gg.length - 1]].end),
      metin: metin.replace(/\s+/g, " ").trim(),
      speaker: cues[gg[0]].speaker || null
    });
  }
  /* Sayaçlar dizinin üzerine iliştirilir: bu fonksiyon panelden önizleme için de
     çağrılabiliyor ve atlanan/bölünemeyen her şeyin çağırana ULAŞMASI gerekiyor. */
  cumleler._zorlaBolundu = zorlaBolundu;
  cumleler._bolunemedi = bolunemedi;
  cumleler._guvenlikDoldu = guvenlikDoldu;
  cumleler._bosCue = bosCue;
  return cumleler;
}

/* ---------------------------------------------------------------- pencereler
   Pencere SADECE aday gruplamak için var (LLM'e "şu 20 saniyeden birini seç" demek için).
   Seçimlerin BİRBİRİNE UZAKLIĞI sabit dilime bırakılmaz — sabit dilim, sınırın iki yanındaki
   iki seçimi 2 saniye arayla düşürebiliyor. Gerçek kural aşağıda `_redSebebi`: bir cümle
   seçildikten sonra en az (aralikSn - mesafePayi) saniye geçmeden yeni seçim yapılmaz. */
function _pencereleriKur(cumleler, tamSonu, aralikSn) {
  var kova = {}, sirali = [], i;
  for (i = 0; i < cumleler.length; i++) {
    var c = cumleler[i];
    if (c.bas < tamSonu) continue;                       // ilk bölümde zaten gösterilecek
    var k = Math.floor((c.bas - tamSonu) / aralikSn);
    if (!kova[k]) { kova[k] = { k: k, adaylar: [] }; sirali.push(kova[k]); }
    kova[k].adaylar.push(c);
  }
  sirali.sort(function (a, b) { return a.k - b.k; });
  for (i = 0; i < sirali.length; i++) {
    sirali[i].no = i + 1;                                 // istekte görünecek pencere numarası
    sirali[i].bas = tamSonu + sirali[i].k * aralikSn;
    sirali[i].bit = sirali[i].bas + aralikSn;
  }
  return sirali;
}

/* Pencereleri parçalara böler: bir pencere ASLA ikiye bölünmez (LLM o pencerenin
   adaylarının tamamını görmeden seçim yapamaz). Hem cümle hem pencere sayısı sınırlı:
   pencere sınırı cevabın uzunluğunu (dolayısıyla max_tokens riskini) bağlar. */
function _parcalaraBol(pencereler, parcaCumle, parcaPencere) {
  var parcalar = [], cur = [], curCumle = 0;
  for (var i = 0; i < pencereler.length; i++) {
    var p = pencereler[i], n = p.adaylar.length;
    if (cur.length && (cur.length >= parcaPencere || (curCumle + n) > parcaCumle)) {
      parcalar.push(cur); cur = []; curCumle = 0;
    }
    cur.push(p); curCumle += n;
  }
  if (cur.length) parcalar.push(cur);
  return parcalar;
}

/* ------------------------------------------------------------------- istek */
var SISTEM =
  "Sen bir Türkçe YouTube videosunun altyazılarını sadeleştiren bir editörsün. " +
  "Video, çocuk ve genç izleyiciye yönelik oyun (Minecraft/Roblox) içeriği; konuşmalar arkadaş sohbeti tonunda.\n\n" +
  "GÖREV: Sana numaralı cümleler PENCERE PENCERE verilecek. HER pencereden EN VURUCU tek cümleyi seç.\n" +
  "Vurucu = en komik, en şaşırtıcı, en duygusal, olayı ilerleten ya da tek başına okunduğunda anlamlı olan cümle.\n" +
  "Seçme: anlamsız dolgu (\"şey\", \"yani ya\", \"hı hı\"), yarım kalan cümle, bağlamsız tepki sesi.\n" +
  "Her pencere için bir de YEDEK numara ver (ikinci en iyi); uygun ikinci aday yoksa null.\n\n" +
  "SADECE şu JSON'u döndür, başında/sonunda hiçbir açıklama yazma:\n" +
  "{\"secimler\":[{\"pencere\":1,\"no\":12,\"yedek\":15}]}\n\n" +
  "KURALLAR:\n" +
  "- \"no\" ve \"yedek\" YALNIZCA o pencerede listelenen numaralardan olabilir. Numara uydurma.\n" +
  "- Her pencere için tam bir satır ver, hiçbirini atlama.\n" +
  "- Numaralar tüm video boyunca artarak gider; pencereler arası numara ödünç alma.";

/* Yapısal çıktı şeması: cevabın geçerli JSON olması sunucu tarafında garanti altına alınır.
   (Yine de aşağıdaki KATI ayrıştırıcı duruyor — şema desteklenmezse/kapatılırsa da çalışsın.) */
var SEMA = {
  type: "object",
  properties: {
    secimler: {
      type: "array",
      items: {
        type: "object",
        properties: {
          pencere: { type: "integer" },
          no: { type: "integer" },
          yedek: { anyOf: [{ type: "integer" }, { type: "null" }] }
        },
        required: ["pencere", "no", "yedek"],
        additionalProperties: false
      }
    }
  },
  required: ["secimler"],
  additionalProperties: false
};

function _parcaMetni(parca, metinSiniri) {
  var out = [], i, j;
  for (i = 0; i < parca.length; i++) {
    var p = parca[i];
    out.push("--- PENCERE " + p.no + " (" + _saat(p.bas) + " - " + _saat(p.bit) + ") ---");
    for (j = 0; j < p.adaylar.length; j++) {
      var c = p.adaylar[j];
      var m = c.metin;
      if (m.length > metinSiniri) m = m.slice(0, metinSiniri - 1) + "…";   // token bütçesi
      out.push(c.sira + " [" + _saat(c.bas) + "] " + m);
    }
    out.push("");
  }
  return out.join("\n");
}

function _govdeKur(parca, opts) {
  var govde = {
    model: String(_ayar(opts, "model") || MODEL),
    max_tokens: _sayi(_ayar(opts, "maxTokens")),
    system: SISTEM,
    /* Düşünme KAPALI: bu bir "en iyisini seç" işi, çok adımlı akıl yürütme değil. Açık
       bırakılırsa (Sonnet 5'te varsayılan açıktır) düşünme token'ları max_tokens bütçesini
       yiyip JSON'u ortasından kesebilir — cevap ayrıştırılamaz, koca bir parça çöpe gider.
       ⚠ temperature/top_p/top_k GÖNDERİLMEZ: bu modelde varsayılan dışı değer 400 döndürür. */
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: _parcaMetni(parca, _sayi(_ayar(opts, "metinSiniri"))) }]
  };
  if (_ayar(opts, "yapisalCikti")) {
    govde.output_config = { format: { type: "json_schema", schema: SEMA } };
  }
  return govde;
}

/* Tek HTTPS isteği. Doner: {kod, govde(metin), basliklar} — HTTP hatası da BURADA
   çözülür (reject edilmez), tekrar deneme kararını üst katman verir. */
function _istekAt(anahtar, govdeNesnesi, zamanAsimiMs) {
  return new Promise(function (resolve, reject) {
    var veri = JSON.stringify(govdeNesnesi);
    var req = https.request({
      hostname: API_HOST,
      path: API_YOL,
      method: "POST",
      headers: {
        "x-api-key": anahtar,
        "anthropic-version": API_SURUM,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(veri, "utf8")
      }
    }, function (res) {
      /* setEncoding ŞART: Türkçe karakter iki bayt; parça sınırına denk gelirse
         Buffer'ları düz birleştirmek harfi bozar ("ş" -> "?"). */
      res.setEncoding("utf8");
      var b = "";
      res.on("data", function (d) { b += d; });
      res.on("end", function () { resolve({ kod: res.statusCode, govde: b, basliklar: res.headers || {} }); });
      /* NEDEN sarmalanıyor: ham hata İngilizce ve teknik ("socket hang up", "aborted");
         mesaj doğrudan kullanıcıya gösteriliyor. Ayrıca bitir() çağrılmazsa istek
         _aktifIstekler listesinde asılı kalır ve İptal boşuna destroy dener. */
      res.on("error", function (e) {
        bitir();
        reject(_hata("Yapay zekâ cevabı alınırken bağlantı koptu: " + (e && e.message ? e.message : "bilinmeyen ağ hatası")));
      });
    });
    _aktifIstekler.push(req);
    function bitir() {
      var i = _aktifIstekler.indexOf(req);
      if (i >= 0) _aktifIstekler.splice(i, 1);
      if (sayac) { clearTimeout(sayac); sayac = null; }
    }
    /* Toplam süre tavanı: soket zaman aşımı yalnız "hiç veri gelmiyor" halini yakalar;
       yavaş yavaş veri gelen bir bağlantı sonsuza kadar asılı kalabilir. */
    var sayac = setTimeout(function () {
      sayac = null;
      try { req.destroy(); } catch (e) {}
      bitir();
      reject(_hata("Yapay zekâ isteği zaman aşımına uğradı (" + Math.round(zamanAsimiMs / 1000) + " sn)."));
    }, zamanAsimiMs);
    req.on("error", function (e) {
      bitir();
      reject(_hata("Yapay zekâya bağlanılamadı: " + e.message + " (internet bağlantısını kontrol et)"));
    });
    req.on("close", bitir);
    req.write(veri, "utf8");
    req.end();
  });
}

/* Sunucunun hata gövdesinden okunabilir mesaj çıkar. */
function _apiHataMetni(govde) {
  try {
    var j = JSON.parse(govde);
    if (j && j.error && j.error.message) return String(j.error.message);
  } catch (e) {}
  var t = String(govde || "").replace(/\s+/g, " ").trim();
  return t.length > 200 ? t.slice(0, 200) + "…" : t;
}

/* İptale duyarlı bekleme: 20 saniyelik bir "retry-after" beklerken İptal'e basan
   kullanıcı 20 saniye daha beklemesin diye küçük dilimlerle uyunur. */
function _bekle(ms, damga) {
  return new Promise(function (resolve, reject) {
    var kalan = ms;
    function adim() {
      if (iptalEdildiMi(damga)) return reject(_iptalHatasi());
      if (kalan <= 0) return resolve();
      var dilim = Math.min(250, kalan);
      kalan -= dilim;
      setTimeout(adim, dilim);
    }
    adim();
  });
}

function _tekrarBeklemesi(sonuc, deneme) {
  var ra = sonuc && sonuc.basliklar ? sonuc.basliklar["retry-after"] : null;
  var sn = ra ? parseInt(ra, 10) : NaN;
  if (!isFinite(sn) || sn < 0) sn = Math.pow(2, deneme);        // 1, 2, 4 … saniye
  return Math.min(sn, 20) * 1000;                              // 20 sn tavan (kullanıcı bekliyor)
}

/* Tek parçayı gönderir; geçici hatalarda tekrar dener. Doner: cevabın METNİ.
   Kalıcı hatalarda (401/400) NET Türkçe mesajla reject eder — sessiz geçiş yok. */
/* GÖVDE ÜRETİCİSİ alan genel gönderici. Tekrar deneme, 429/5xx bekleme, iptal damgası,
   şemasız geri düşme — hepsi burada. _parcaGonder ve istekGonder bunun üstünde ince birer
   sarmalayıcı; ikinci bir tüketici (emoji/müzik) çıktığında bu mantık KOPYALANMASIN diye
   ayrıldı. Davranış birebir aynı, yalnız gövdenin nereden geldiği değişti. */
function _gonderGovde(anahtar, govdeYap, opts, damga, log) {
  var deneme = _sayi(_ayar(opts, "deneme"));
  var zamanAsimi = _sayi(_ayar(opts, "zamanAsimiMs"));
  var yapisal = !!_ayar(opts, "yapisalCikti");

  function tur(kalanDeneme, yapisalAcik) {
    if (iptalEdildiMi(damga)) return Promise.reject(_iptalHatasi());
    return _istekAt(anahtar, govdeYap(yapisalAcik), zamanAsimi).then(function (sonuc) {
      if (iptalEdildiMi(damga)) throw _iptalHatasi();
      var kod = sonuc.kod;
      if (kod === 200) return _metinCikar(sonuc.govde);

      var mesaj = _apiHataMetni(sonuc.govde);
      if (kod === 401 || kod === 403) {
        throw _hata("Anthropic API anahtarı reddedildi (HTTP " + kod + "): " + mesaj +
                    " — " + DOSYA + " dosyasındaki anahtarı kontrol et.", { anahtarHatasi: true });
      }
      if (kod === 400) {
        /* Yapısal çıktı (output_config) hesapta desteklenmiyorsa istek 400 döner ve özellik
           tamamen ölür. Bir kez şemasız tekrar denenir — ama SESSİZCE değil, log'a sebebiyle
           yazılır; ayrıştırıcı zaten şemasız cevabı da kaldırabiliyor. */
        if (yapisalAcik && /output_config|format|schema/i.test(mesaj)) {
          log("[vurucu] Yapısal çıktı reddedildi (" + mesaj + ") — şemasız tekrar deneniyor.");
          return tur(kalanDeneme, false);
        }
        throw _hata("Yapay zekâ isteği geçersiz (HTTP 400): " + mesaj);
      }
      var gecici = (kod === 429 || kod === 408 || kod === 409 || kod >= 500);
      if (gecici && kalanDeneme > 0) {
        var ms = _tekrarBeklemesi(sonuc, deneme - kalanDeneme);
        log("[vurucu] HTTP " + kod + " (" + mesaj + ") — " + Math.round(ms / 1000) +
            " sn sonra tekrar denenecek (kalan deneme: " + kalanDeneme + ").");
        return _bekle(ms, damga).then(function () { return tur(kalanDeneme - 1, yapisalAcik); });
      }
      if (kod === 429) throw _hata("Anthropic istek sınırı aşıldı (HTTP 429): " + mesaj + " — biraz bekleyip tekrar dene.");
      throw _hata("Yapay zekâ sunucusu hata verdi (HTTP " + kod + "): " + mesaj);
    }, function (e) {
      if (e && e.iptal) throw e;
      /* İPTAL KONTROLÜ BURADA ŞART: iptal() açık isteği destroy ediyor, bu da düz bir
         soket hatası doğuruyor. Damgaya bakılmazsa geçici ağ hatası sanılıp kullanıcıya
         "1 sn sonra tekrar denenecek" yazılıyordu — hem yanıltıcı hem de iptal edilen iş
         boşuna yeniden deneniyordu. */
      if (iptalEdildiMi(damga)) throw _iptalHatasi();
      if (kalanDeneme > 0) {
        var ms = Math.min(Math.pow(2, deneme - kalanDeneme), 20) * 1000;
        log("[vurucu] " + e.message + " — " + Math.round(ms / 1000) + " sn sonra tekrar denenecek.");
        return _bekle(ms, damga).then(function () { return tur(kalanDeneme - 1, yapisalAcik); });
      }
      throw e;
    });
  }
  return tur(deneme, yapisal);
}

/* Vurucu modun kendi göndericisi — davranış eskisiyle BİREBİR aynı, yalnız gövdeyi
   _gonderGovde'ye bir üretici olarak veriyor. */
function _parcaGonder(anahtar, parca, opts, damga, log) {
  return _gonderGovde(anahtar, function (yapisalAcik) {
    var o = {}, k;
    for (k in opts) { if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k]; }
    o.yapisalCikti = yapisalAcik;
    return _govdeKur(parca, o);
  }, opts, damga, log);
}

/* GENEL İSTEK — başka modüller (emoji, müzik) için. Hazır bir Messages API gövdesi alır;
   tekrar deneme, 429/5xx bekleme, iptal ve şemasız geri düşme buradan MİRAS alınır.
   Bu katmanı kopyalamak yerine paylaşmanın sebebi: retry/iptal mantığı üç kez yazılırsa
   üçü de ayrı ayrı bozulur. Dönüş: cevabın METNİ (ayrıştırma çağırana ait). */
function istekGonder(anahtar, govdeNesnesi, opts, damga, log) {
  return _gonderGovde(anahtar, function (yapisalAcik) {
    var g = {}, k;
    for (k in govdeNesnesi) { if (Object.prototype.hasOwnProperty.call(govdeNesnesi, k)) g[k] = govdeNesnesi[k]; }
    /* 400 sonrası şemasız tekrar denemede output_config ÇIKARILIR — yoksa aynı hatayla
       döner ve tekrar deneme anlamsız olur. */
    if (!yapisalAcik && g.output_config) delete g.output_config;
    return g;
  }, opts, damga, log || function () {});
}

/* Messages API cevabından metni çıkarır. stop_reason "max_tokens" ise JSON yarımdır —
   ayrıştırma hatasını "model saçmaladı" sanmayalım diye sebep ayrıca bildirilir. */
function _metinCikar(govde) {
  var j;
  try { j = JSON.parse(govde); }
  catch (e) { throw _hata("Yapay zekâ cevabı okunamadı (geçersiz JSON gövde)."); }
  if (j && j.type === "error") throw _hata("Yapay zekâ hatası: " + ((j.error && j.error.message) || "bilinmiyor"));
  if (j && j.stop_reason === "refusal") throw _hata("Yapay zekâ bu isteği yanıtlamayı reddetti (stop_reason: refusal).");
  var metin = "", i;
  var blok = (j && j.content) || [];
  for (i = 0; i < blok.length; i++) {
    if (blok[i] && blok[i].type === "text" && blok[i].text) metin += blok[i].text;
  }
  if (j && j.stop_reason === "max_tokens") {
    throw _hata("Yapay zekâ cevabı token sınırına takıldı (max_tokens) — parça çok büyük. " +
                "opts.parcaPencere değerini küçült ya da opts.maxTokens değerini büyüt.");
  }
  if (!metin.trim()) throw _hata("Yapay zekâ boş cevap döndürdü.");
  return metin;
}

/* KATI ayrıştırma: ```json çiti ya da baştaki/sondaki laf temizlenir, sonra JSON.parse.
   Yapıyı doğrulamayan cevap kabul EDİLMEZ (uydurma sonuç üretmek yerine hata). */
function _secimleriAyristir(metin) {
  var t = String(metin).trim();
  t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw _hata("Yapay zekâ cevabında JSON bulunamadı.");
  var j;
  try { j = JSON.parse(t.slice(a, b + 1)); }
  catch (e) { throw _hata("Yapay zekâ cevabı geçerli JSON değil: " + e.message); }
  if (!j || Object.prototype.toString.call(j.secimler) !== "[object Array]") {
    throw _hata("Yapay zekâ cevabında \"secimler\" dizisi yok.");
  }
  var out = [], bozuk = 0;
  for (var i = 0; i < j.secimler.length; i++) {
    var s = j.secimler[i];
    if (!s || typeof s !== "object") { bozuk++; continue; }
    var p = parseInt(s.pencere, 10), n = parseInt(s.no, 10), y = parseInt(s.yedek, 10);
    if (!isFinite(p) || !isFinite(n)) { bozuk++; continue; }   // bozuk satır atlanır ama SAYILIR
    out.push({ pencere: p, no: n, yedek: isFinite(y) ? y : null });
  }
  return { secimler: out, bozuk: bozuk };
}

/* ------------------------------------------------------------------- seçim
   Kural (kullanıcı isteği): bir cümle seçildikten sonra en az (aralikSn - mesafePayi)
   saniye geçmeden yeni seçim yapılmaz. Ayrıca ÜST ÜSTE BİNME yasak: "Herkes" kaynağında
   iki kişi aynı anda konuşabiliyor ve iki cümle zaman olarak çakışabiliyor; tek altyazı
   kanalına yazıldığı için çakışan ikinci cue birincinin üstüne düşer ve metin kaybolur.

   NEDEN "kabul edilir mi" değil de RED SEBEBİ dönüyor: iki farklı red tek sayaca
   ("mesafeIhlali") yazılıyordu; çakışma yüzünden elenen bir seçim log'da "çok yakındı"
   diye görünüyordu. Sebepler ayrı sayılırsa özet gerçeği söyler. */
function _redSebebi(cumle, sonKabul, minAralik) {
  if (!sonKabul) return null;
  if (cumle.bas < sonKabul.bit) return "cakisma";             // zaman olarak çakışıyor
  if ((cumle.bas - sonKabul.bas) < minAralik) return "mesafe";
  return null;
}

/* -------------------------------------------------------------------- API */

/* Karar dizisini cue'lara YAZAR (nesneleri silmez). */
function isaretle(cues, gosterilecek) {
  cues = cues || [];
  for (var i = 0; i < cues.length; i++) {
    if (cues[i]) cues[i].vurucuGoster = !!(gosterilecek && gosterilecek[i]);
  }
  return cues;
}
/* İşaretleri kaldırır — "Tofi Moni modu"nu kapatınca her cue yine gösterilir. */
function temizle(cues) {
  cues = cues || [];
  for (var i = 0; i < cues.length; i++) {
    if (!cues[i]) continue;
    try { delete cues[i].vurucuGoster; } catch (e) { cues[i].vurucuGoster = undefined; }
    try { delete cues[i].vurucuCumle; } catch (e) { cues[i].vurucuCumle = undefined; }
  }
  return cues;
}
/* SRT'ye verilecek liste. İŞARET YOKSA (mod hiç çalışmadıysa) hepsi döner —
   böylece bu modül devrede değilken davranış birebir eskisi gibi kalır. */
function gosterilenler(cues) {
  cues = cues || [];
  var out = [], i, isaretliVar = false;
  for (i = 0; i < cues.length; i++) {
    if (cues[i] && cues[i].vurucuGoster !== undefined) { isaretliVar = true; break; }
  }
  if (!isaretliVar) return cues.slice(0);
  for (i = 0; i < cues.length; i++) if (cues[i] && cues[i].vurucuGoster) out.push(cues[i]);
  return out;
}

/*
 * ANA GİRİŞ.
 *   extRoot : uzantı kökü (anthropic-key.txt burada aranır)
 *   gruplar : [{ad:"A1", cues:[{start, end, text, cumleId?, speaker?}]}, ...]
 *             ⚠ NEDEN kanal kanal DEĞİL de tek çağrı: app.js cue'ları kanal kanal ayrı
 *             dizilerde tutuyor (state.a1Cues, her ch.cues) ve placeCaptions her grubu ayrı
 *             yazıyor. Kanal başına ayrı vurucuSec çağrılsaydı "20 saniyede bir" kuralı her
 *             kanalda AYRI işlerdi: 4 kanallı videoda aynı 20 saniyede 4 altyazı çıkar ve
 *             "seyrek vurucu cümle" etkisi tamamen kaybolurdu. Burada tüm kanallar tek
 *             listede toplanır; mesafe ve çakışma kuralları KANALLAR ARASI işler.
 *   opts    : { tamSaniye:60, aralikSn:20, ... , onLog:function(satir) }
 * Diziler DEĞİŞTİRİLMEZ, cue nesneleri işaretlenir.
 * Doner: Promise<sonuc>; sonuc.gruplar[i] = {ad, toplamCue, gosterilenCue, cues:[gösterilecekler]}.
 *        Hata halinde reject; e.message doğrudan kullanıcıya gösterilebilir.
 */
function vurucuSec(extRoot, gruplar, opts) {
  opts = opts || {};
  var log = (typeof opts.onLog === "function") ? opts.onLog : function () {};
  var damga = iptalDamgasi();

  /* Girdi biçimi DOĞRULANIR: yanlış biçim sessizce "hiç aday yok" sonucu üretip
     videoyu altyazısız bırakmasın (eski imza düz cue dizisi alıyordu, karışabilir). */
  var girisler = [], gi, gj;
  if (Object.prototype.toString.call(gruplar) !== "[object Array]") {
    return Promise.reject(_hata("vurucuSec: ikinci parametre grup dizisi olmalı — [{ad:\"A1\", cues:[...]}, ...]"));
  }
  for (gi = 0; gi < gruplar.length; gi++) {
    var gr = gruplar[gi] || {};
    if (Object.prototype.toString.call(gr.cues) !== "[object Array]") {
      return Promise.reject(_hata("vurucuSec: " + (gi + 1) + ". grupta \"cues\" dizisi yok — " +
                                  "beklenen biçim [{ad:\"A1\", cues:[...]}, ...]"));
    }
    girisler.push({ ad: String(gr.ad == null || gr.ad === "" ? ("Grup " + (gi + 1)) : gr.ad), cues: gr.cues });
  }

  /* Tüm grupların cue'ları TEK düz listede toplanır (nesne REFERANSLARI kopyalanır,
     nesneler klonlanmaz) — böylece işaretleme çağıranın dizilerindeki cue'lara işler
     ve grup listelerini sonda `gosterilenler()` ile geri süzebiliriz. */
  var cues = [];
  for (gi = 0; gi < girisler.length; gi++) {
    for (gj = 0; gj < girisler[gi].cues.length; gj++) cues.push(girisler[gi].cues[gj]);
  }

  var tamSaniye = _sayi(_ayar(opts, "tamSaniye"));
  var aralikSn = Math.max(1, _sayi(_ayar(opts, "aralikSn")));
  var minAralik = Math.max(1, aralikSn - _sayi(_ayar(opts, "mesafePayi")));

  var sonuc = {
    gruplar: [],                 // her grubun kendi filtreli listesi (aşağıda bitir() doldurur)
    gosterilecek: [],            // tüm grupların arka arkaya eklendiği DÜZ listeye göre true/false
    toplamCue: cues.length, gosterilenCue: 0,
    cumleSayisi: 0, tamCumle: 0, adayCumle: 0, secilenCumle: 0,
    zorlaBolunenCumle: 0, bolunemeyenCumle: 0, bosCue: 0,
    pencereSayisi: 0, secimsizPencere: 0, yedekKullanildi: 0, uydurmaNumara: 0,
    mesafeIhlali: 0, cakismaIhlali: 0, bozukSatir: 0,
    parcaToplam: 0, parcaBasarisiz: 0,
    hatalar: [], ozet: ""
  };
  for (var z = 0; z < cues.length; z++) sonuc.gosterilecek.push(false);

  var anahtar;
  try { anahtar = anahtarOku(extRoot); }
  catch (e) { return Promise.reject(e); }

  var cumleler = cumleleriCikar(cues, opts);
  sonuc.cumleSayisi = cumleler.length;
  sonuc.zorlaBolunenCumle = cumleler._zorlaBolundu || 0;
  sonuc.bolunemeyenCumle = cumleler._bolunemedi || 0;
  sonuc.bosCue = cumleler._bosCue || 0;
  if (sonuc.zorlaBolunenCumle) {
    log("[vurucu] " + sonuc.zorlaBolunenCumle + " uzun blok zorla bölündü " +
        "(cümle sonu sinyali yok: noktalama silinmiş ve boşluk yetersiz).");
  }
  /* Aşağıdaki üçü SESSİZ GEÇİLEMEZ: her biri ekranda eksik/aşırı uzun altyazı demek. */
  if (sonuc.bolunemeyenCumle) {
    log("[vurucu] UYARI — " + sonuc.bolunemeyenCumle + " uzun blok bölünemedi (bölünecek boşluk yok): " +
        "bu bloklar tek cümle sayılacak, seçilirlerse çok uzun altyazı çıkar.");
  }
  if (cumleler._guvenlikDoldu) {
    log("[vurucu] UYARI — zorunlu bölme güvenlik tavanına (5000) çarptı; kalan uzun bloklar bölünmedi.");
  }
  if (sonuc.bosCue) {
    log("[vurucu] " + sonuc.bosCue + " cue metni boş olduğu için cümle kurmadı (atlandı).");
  }

  // (a) İlk bölüm: tamSaniye'den ÖNCE başlayan her cümle TAMAMEN gösterilir (cümle bütünlüğü).
  var i, j, c;
  for (i = 0; i < cumleler.length; i++) {
    c = cumleler[i];
    if (c.bas < tamSaniye) {
      c.tamBolum = true; sonuc.tamCumle++;
      for (j = 0; j < c.cueler.length; j++) sonuc.gosterilecek[c.cueler[j]] = true;
    }
  }

  // (b) Sonraki bölüm: adaylar pencerelere dağıtılır, her cümleye küresel numara verilir.
  var pencereler = _pencereleriKur(cumleler, tamSaniye, aralikSn);
  sonuc.pencereSayisi = pencereler.length;
  /* Yalnız `sira` (küresel numara) yazılır. Eskiden bir de haritaNo{} kuruluyordu ama
     hiç okunmuyordu: numara->cümle çözümü seçim döngüsünde PENCEREYE ÖZEL `izin{}` ile
     yapılıyor (başka pencerenin numarası kabul edilmesin diye). Ölü kod silindi. */
  var sayac = 0;
  for (i = 0; i < pencereler.length; i++) {
    for (j = 0; j < pencereler[i].adaylar.length; j++) {
      sayac++;
      pencereler[i].adaylar[j].sira = sayac;
    }
  }
  sonuc.adayCumle = sayac;

  function bitir() {
    isaretle(cues, sonuc.gosterilecek);
    for (var q = 0; q < cues.length; q++) if (sonuc.gosterilecek[q]) sonuc.gosterilenCue++;
    for (q = 0; q < cumleler.length; q++) if (cumleler[q].secildi) cues[cumleler[q].cueler[0]].vurucuCumle = true;
    /* Her grup KENDİ filtreli listesini geri alır: app.js kanal kanal yazıyor, düz liste
       ona yaramaz. İşaret cue NESNESİNDE durduğu için süzme grubun özgün sırasını korur. */
    var grupOzet = [];
    for (q = 0; q < girisler.length; q++) {
      var f = gosterilenler(girisler[q].cues);
      sonuc.gruplar.push({
        ad: girisler[q].ad, toplamCue: girisler[q].cues.length,
        gosterilenCue: f.length, cues: f
      });
      grupOzet.push(girisler[q].ad + " " + f.length + "/" + girisler[q].cues.length);
    }
    sonuc.ozet =
      "Vurucu mod: ilk " + tamSaniye + " sn tam (" + sonuc.tamCumle + " cümle) · " +
      sonuc.pencereSayisi + " pencerede " + sonuc.secilenCumle + " cümle seçildi · " +
      "gösterilen altyazı " + sonuc.gosterilenCue + "/" + sonuc.toplamCue + " · " +
      "parça " + (sonuc.parcaToplam - sonuc.parcaBasarisiz) + "/" + sonuc.parcaToplam + " başarılı";
    if (grupOzet.length) sonuc.ozet += " · gruplar: " + grupOzet.join(", ");
    if (sonuc.secimsizPencere) sonuc.ozet += " · seçimsiz pencere: " + sonuc.secimsizPencere;
    if (sonuc.uydurmaNumara) sonuc.ozet += " · uydurma numara: " + sonuc.uydurmaNumara;
    if (sonuc.bozukSatir) sonuc.ozet += " · geçersiz cevap satırı: " + sonuc.bozukSatir;
    if (sonuc.mesafeIhlali) sonuc.ozet += " · çok yakın olduğu için elenen: " + sonuc.mesafeIhlali;
    if (sonuc.cakismaIhlali) sonuc.ozet += " · öncekiyle çakıştığı için elenen: " + sonuc.cakismaIhlali;
    if (sonuc.bolunemeyenCumle) sonuc.ozet += " · bölünemeyen uzun blok: " + sonuc.bolunemeyenCumle;
    if (sonuc.bosCue) sonuc.ozet += " · boş cue: " + sonuc.bosCue;
    if (sonuc.yedekKullanildi) sonuc.ozet += " · yedeğe düşen: " + sonuc.yedekKullanildi;
    log("[vurucu] " + sonuc.ozet);
    return sonuc;
  }

  if (!pencereler.length) {
    // Video 60 sn'den kısa ya da sonrasında hiç konuşma yok: istek atmaya gerek yok (boşa para/zaman).
    log("[vurucu] " + tamSaniye + ". saniyeden sonra aday cümle yok — yapay zekâya istek gönderilmedi.");
    return Promise.resolve(bitir());
  }

  var parcalar = _parcalaraBol(pencereler, _sayi(_ayar(opts, "parcaCumle")), _sayi(_ayar(opts, "parcaPencere")));
  sonuc.parcaToplam = parcalar.length;
  log("[vurucu] " + sonuc.cumleSayisi + " cümle · " + sonuc.adayCumle + " aday · " +
      sonuc.pencereSayisi + " pencere · " + sonuc.parcaToplam + " istek parçası. Transkript metni Anthropic'e gönderiliyor.");

  var secimHaritasi = {};      // pencere no -> {no, yedek}

  function parcaSirasi(k) {
    if (k >= parcalar.length) return Promise.resolve();
    if (iptalEdildiMi(damga)) return Promise.reject(_iptalHatasi());
    var parca = parcalar[k];
    log("[vurucu] Parça " + (k + 1) + "/" + parcalar.length + " gönderiliyor (" + parca.length + " pencere)…");
    return _parcaGonder(anahtar, parca, opts, damga, log).then(function (metin) {
      var cozum = _secimleriAyristir(metin);
      var gecerli = 0, p;
      /* Bu parçada HANGİ pencerelerin sorulduğu: cevap başka bir parçanın penceresini
         gösterirse KABUL EDİLMEZ. Yoksa 2. parçanın uydurma satırı, 1. parçanın doğru
         seçimini ezip sessizce bozardı. */
      var buParca = {};
      for (p = 0; p < parca.length; p++) buParca["p" + parca[p].no] = true;
      for (p = 0; p < cozum.secimler.length; p++) {
        var s = cozum.secimler[p];
        if (!buParca["p" + s.pencere]) { cozum.bozuk++; continue; }
        secimHaritasi["p" + s.pencere] = { no: s.no, yedek: s.yedek };
        gecerli++;
      }
      sonuc.bozukSatir += cozum.bozuk;
      log("[vurucu] Parça " + (k + 1) + " tamam: " + gecerli + "/" + parca.length + " pencere yanıtlandı" +
          (cozum.bozuk ? (" · " + cozum.bozuk + " satır geçersizdi (atlandı)") : "") + ".");
      return parcaSirasi(k + 1);
    }, function (e) {
      if (e && e.iptal) throw e;
      /* Bir parça düşerse iş bitmez ama SESSİZ de geçilmez: o parçanın pencereleri
         seçimsiz kalır (o ~20 saniyelik bölümlerde hiç altyazı olmaz), sayılır ve yazılır. */
      sonuc.parcaBasarisiz++;
      sonuc.hatalar.push("Parça " + (k + 1) + "/" + parcalar.length + ": " + e.message);
      log("[vurucu] HATA — parça " + (k + 1) + " başarısız (" + parca.length +
          " pencere seçimsiz kalacak): " + e.message);
      return parcaSirasi(k + 1);
    });
  }

  return parcaSirasi(0).then(function () {
    if (iptalEdildiMi(damga)) throw _iptalHatasi();
    if (sonuc.parcaToplam > 0 && sonuc.parcaBasarisiz === sonuc.parcaToplam) {
      throw _hata("Vurucu cümle seçimi yapılamadı — " + sonuc.parcaToplam + " isteğin tamamı başarısız oldu.\n" +
                  sonuc.hatalar.join("\n"), { tumParcalarDustu: true, hatalar: sonuc.hatalar });
    }

    /* Uygulama: pencereler ZAMAN SIRASINDA gezilir; mesafe kuralı burada işletilir.
       Asıl seçim tutmazsa YEDEK denenir — böylece sabit dilim sınırında elenen bir
       seçim koca bir 20 saniyeyi altyazısız bırakmaz.

       ⚠ ZİNCİR İLK BÖLÜMLE TOHUMLANIR. İlk bölümün cümleleri TAMAMEN gösteriliyor ve
       cümle bütünlüğü yüzünden tamSaniye'yi AŞABİLİYOR (58-64 sn'lik cümle ölçüldü).
       sonKabul null başlarsa 1. pencerenin 61. saniyede başlayan adayı koşulsuz kabul
       ediliyor ve 61-64 arası ÇAKIŞIYORDU; tek caption track'e yazılınca çakışan satır
       diğerinin üstüne düşüyor ve metin KAYBOLUYOR.
       bas = -1e9 verilir ki mesafe kuralı (bas farkı) devre dışı kalsın — ilk bölüm bir
       "seçim" değil, yalnız çakışma yasağı için referans; yoksa ilk vurucu cümle
       gereksiz yere elenirdi. */
    var sonKabul = null, enGecBit = null;
    for (var t = 0; t < cumleler.length; t++) {
      if (cumleler[t].tamBolum && (enGecBit === null || cumleler[t].bit > enGecBit)) enGecBit = cumleler[t].bit;
    }
    if (enGecBit !== null) sonKabul = { bas: -1e9, bit: enGecBit };

    for (var w = 0; w < pencereler.length; w++) {
      var pen = pencereler[w];
      var sec = secimHaritasi["p" + pen.no];
      if (!sec) { sonuc.secimsizPencere++; continue; }

      var adaylar = [], q;
      var izin = {};
      /* "n" öneki: sayı anahtarları düz nesnede prototip alanlarıyla karışmasın. */
      for (q = 0; q < pen.adaylar.length; q++) izin["n" + pen.adaylar[q].sira] = pen.adaylar[q];

      /* ⚠ Adayın KAYNAĞI (asıl mı yedek mi) burada taşınır. Eskiden yalnız dizideki
         konuma (q > 0) bakılıyordu: model ASIL numarayı uydurunca yedek adaylar[0]
         oluyor, q === 0 kalıyor ve "yedeğe düşen" sayacı hiç artmıyordu. */
      var listede = [{ no: sec.no, yedek: false }, { no: sec.yedek, yedek: true }];
      for (q = 0; q < listede.length; q++) {
        var no = listede[q].no;
        if (no === null || no === undefined) continue;
        if (!Object.prototype.hasOwnProperty.call(izin, "n" + no)) {
          /* Model bu pencerede olmayan (ya da hiç var olmayan) bir numara döndürdü.
             Uydurma numarayla rastgele cümle seçmek yerine atlanır ve SAYILIR. */
          sonuc.uydurmaNumara++;
          continue;
        }
        adaylar.push({ cumle: izin["n" + no], yedek: listede[q].yedek });
      }
      if (!adaylar.length) { sonuc.secimsizPencere++; continue; }

      var kabul = null;
      for (q = 0; q < adaylar.length; q++) {
        var sebep = _redSebebi(adaylar[q].cumle, sonKabul, minAralik);
        if (!sebep) { kabul = adaylar[q]; break; }
        if (sebep === "cakisma") sonuc.cakismaIhlali++; else sonuc.mesafeIhlali++;
      }
      if (!kabul) { sonuc.secimsizPencere++; continue; }
      if (kabul.yedek) sonuc.yedekKullanildi++;

      kabul.cumle.secildi = true;
      sonuc.secilenCumle++;
      sonKabul = kabul.cumle;
      for (q = 0; q < kabul.cumle.cueler.length; q++) sonuc.gosterilecek[kabul.cumle.cueler[q]] = true;
    }

    if (sonuc.secimsizPencere) {
      log("[vurucu] " + sonuc.secimsizPencere + " pencere seçimsiz kaldı (cevapta yoktu / numara " +
          "uydurmaydı / öncekine çok yakındı / öncekiyle çakışıyordu) — o bölümlerde altyazı olmayacak.");
    }
    return bitir();
  });
}

module.exports = {
  // ana iş
  vurucuSec: vurucuSec,
  iptal: iptal, iptalDamgasi: iptalDamgasi, iptalEdildiMi: iptalEdildiMi,
  // cue işaretleri
  isaretle: isaretle, temizle: temizle, gosterilenler: gosterilenler,
  // yardımcı / önizleme
  cumleleriCikar: cumleleriCikar,
  // genel Claude isteği (emoji/müzik modülleri kullanır — retry/iptal mantığı paylaşılsın)
  istekGonder: istekGonder, metinCikar: _metinCikar, VARSAYILAN_OPTS: VARSAYILAN,
  // anahtar yönetimi (panel kutusu için)
  anahtarOku: anahtarOku, anahtarVarMi: anahtarVarMi, anahtarYaz: anahtarYaz, anahtarYolu: anahtarYolu,
  // sabitler
  DOSYA: DOSYA, MODEL: MODEL, VARSAYILAN: VARSAYILAN
};
