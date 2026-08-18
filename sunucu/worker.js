/*
 * =============================================================================
 *  Yusufwrl Panel — Lisans Sunucusu  (Cloudflare Worker + Workers KV)
 * =============================================================================
 *
 *  NE YAPAR
 *    · Panel ilk açılışta kullanıcıdan bir şifre ister → /aktivasyon'a yollar.
 *    · Şifre doğruysa sunucu o şifreyi O BİLGİSAYARA (HWID) bağlar ve panele bir
 *      "cihaz jetonu" (token) döner. Panel jetonu diskine yazar; bir daha şifre
 *      SORULMAZ.
 *    · Panel her açılışta (en fazla 6 saatte bir) /ping der: "hâlâ geçerli miyim,
 *      ben şu sürümdeyim". Böylece kimin ne zaman girdiğini ve hangi sürümde
 *      olduğunu görebiliyoruz.
 *    · Sen (yönetici) tarayıcıdan  https://<worker>.workers.dev/admin  sayfasını
 *      açıp lisansları görüyor/veriyor/iptal ediyorsun.
 *
 *  ⚠ OFFLINE KURALI — BU SUNUCU PANELİ KİLİTLEYEMEZ.
 *    Panel, internet yoksa ya da bu Worker ölürse AÇILMAYA DEVAM ETMELİ. Kilit
 *    kararını panel yerelde verir (diskteki jeton + HWID eşleşmesi). Buradan
 *    dönen "iptal" cevabı ancak İNTERNET VARKEN ve cevap NET olduğunda işler;
 *    ağ hatası = "sorun bende değil, devam et". Panel tarafında ping hatası ASLA
 *    kilitlenme sebebi olmamalı — arkadaşın montajın ortasında kalmasın.
 *
 *  ⚠ GİZLİ OLAN TEK ŞEY SECRET'LER; Worker URL'i gizli DEĞİL.
 *    Panele yalnız URL gömülür. ADMIN_TOKEN panele ASLA gömülmez — o yalnız
 *    senin tarayıcında durur. URL'i bilen biri en fazla /aktivasyon kapısını
 *    döver, o da şifre tahmini demektir (60 bitlik şifre + hız freni).
 *
 *  KV ANAHTAR ŞEMASI  (binding: LISANS)
 *    lis:<id>        → JSON lisans kaydı (TEK GERÇEK KAYNAK — aşağıdaki şema)
 *    pw:<pwHash>     → "<id>"   (şifreden lisansa gidiş; şifrenin KENDİSİ hiçbir
 *                                yerde yazmaz, yalnız HMAC'i anahtar oluyor)
 *    hw:<hwidHash>   → "<id>"   (bu makine hangi lisansa bağlı — bilgi amaçlı)
 *    log:<tersTs>:<r>→ ""       (değer BOŞ; olay metadata'da — bkz. gunlukYaz)
 *
 *  lis:<id> kaydı:
 *    { id, ad, not, durum:"aktif"|"iptal", maxCihaz, pwHash, pwIlk4,
 *      cihazlar:[ {hwid, kisa, ad, ulke, ilk, son, giris, surum} ],
 *      olusturma, sonGoruldu, sonSurum, toplamGiris, sonYazma }
 *
 *  ⚠ ÜCRETSİZ PLANIN DAR BOĞAZI: GÜNDE 1000 KV YAZMA (okuma 100.000).
 *    Bu yüzden /ping her çağrıda kayda YAZMAZ: son yazmanın üstünden 1 saat
 *    geçmediyse ve sürüm değişmediyse yalnız "ok" döner. 3-5 kullanıcıda bu
 *    zaten devede kulak; ama panel bir hata yüzünden saniyede bir ping atarsa
 *    kotayı yakmasın diye fren burada duruyor.
 */

/* Şifre alfabesi: karıştırılan harfler YOK (0/O ve 1/I ayıklandı).
   Arkadaşına Discord'dan yazıp elle girecek — "O mu sıfır mı" tartışması çıkmasın. */
const ALFABE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 32 karakter
const SIFRE_UZUNLUK = 12;                            // 12 * 5 bit = 60 bit
const PING_YAZMA_ARALIK_MS = 60 * 60 * 1000;         // ping en fazla saatte bir KV yazar
const GUNLUK_TTL_SN = 90 * 24 * 3600;                // olay kaydı 90 gün sonra kendini siler
const GUNLUK_LIMIT = 60;                             // yönetim sayfasında son N olay

export default {
  async fetch(request, env, ctx) {
    try {
      return await yonlendir(request, env, ctx);
    } catch (e) {
      /* Beklenmedik hata: panele ASLA HTML hata sayfası dönme, panel JSON bekliyor. */
      return cevap({ ok: false, hata: "sunucu", mesaj: String((e && e.message) || e) }, 500);
    }
  }
};

/* ------------------------------------------------------------------ yönlendirme */
async function yonlendir(request, env, ctx) {
  const url = new URL(request.url);
  const yol = url.pathname.replace(/\/+$/, "") || "/";
  const met = request.method.toUpperCase();

  /* Sağlık kontrolü. Bilgi SIZDIRMAZ: kaç lisans var, kim var yazmaz. */
  if (yol === "/" && met === "GET") {
    return new Response("Yusufwrl lisans sunucusu calisiyor.\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  }

  /* --- panelin konuştuğu iki kapı --- */
  if (yol === "/aktivasyon" && met === "POST") return aktivasyon(request, env);
  if (yol === "/ping" && met === "POST") return ping(request, env);

  /* --- yönetim (senin tarayıcın) --- */
  if (yol === "/admin" && met === "GET") return adminSayfa();

  if (yol.indexOf("/api/") === 0) {
    /* Yetki kapısı TEK YERDE: aşağıdaki hiçbir uç kendi başına yetki kontrol etmez. */
    if (!(await adminMi(request, env))) {
      /* Hız freni YALNIZ başarısız denemede sayılır: gerçek yönetici hiç takılmaz,
         şifre deneyen 60 saniyede 10 denemeden sonra duvara çarpar.
         ⚠ DÖNÜŞ DEĞERİ KULLANILMAK ZORUNDA. Eskiden yalnız `await hizAsildiMi(...)` çağrılıyor,
         sonucu hiçbir yere atanmıyordu: sayaç artıyor ama duvar HİÇ örülmüyordu, yani yönetici
         anahtarı için sınırsız deneme mümkündü (fren "yazılmış ama çalışmıyor" hâlindeydi).
         Aktivasyon kapısındaki desenin aynısı: aşıldıysa 429 + "cok_deneme". */
      if (await hizAsildiMi(env, "admin:" + istekIp(request))) {
        return cevap({ ok: false, hata: "cok_deneme", mesaj: "Cok fazla deneme. Bir dakika bekle." }, 429);
      }
      return cevap({ ok: false, hata: "yetki", mesaj: "Yonetici anahtari gecersiz." }, 403);
    }
    if (yol === "/api/lisanslar" && met === "GET") return apiListe(env);
    if (yol === "/api/lisans" && met === "GET") return apiTek(env, url.searchParams.get("id"));
    if (yol === "/api/lisans-ekle" && met === "POST") return apiEkle(request, env);
    if (yol === "/api/sifre-yenile" && met === "POST") return apiSifreYenile(request, env);
    if (yol === "/api/durum" && met === "POST") return apiDurum(request, env);
    if (yol === "/api/cihaz-sil" && met === "POST") return apiCihazSil(request, env);
    if (yol === "/api/lisans-sil" && met === "POST") return apiSil(request, env);
    if (yol === "/api/gunluk" && met === "GET") return apiGunluk(env);
  }

  return cevap({ ok: false, hata: "yok", mesaj: "Bilinmeyen adres." }, 404);
}

/* =============================================================== PANEL UÇLARI */

/*
 * POST /aktivasyon
 *   İstek : { sifre, hwid, makine, kullanici, isletim, kaynak, panel }
 *   Cevap : { ok:true, lisansId, ad, imza }  |  { ok:false, hata, mesaj }
 *
 * ⚠ ALAN ADLARI js/lisans.js'E GÖRE — panel önce yazıldı, sunucu ona uyduruldu.
 *   Panel `makine`/`panel` yollar, cevaptan `lisansId`/`imza` okur. Eski adlar
 *   (hwidAd/surum → token/id) de kabul/iade ediliyor ki ileride panel tarafı
 *   değişirse tek taraflı sürüm farkı paneli kırmasın.
 *
 * ⚠ HTTP KODU MESAJI BELİRLİYOR — panel `mesaj` alanını OKUMUYOR, kendi Türkçe
 *   metnini HTTP koduna göre seçiyor (js/lisans.js: 403 = "şifre yanlış",
 *   409 = "başka bilgisayar"). Bu yüzden "cihaz dolu" 403 DEĞİL 409 dönmek
 *   ZORUNDA; 403 dönseydi arkadaş "şifre yanlış" görüp şifreyi tekrar tekrar
 *   yazardı.
 *
 * hata kodları: eksik · kurulum · cok_deneme · sifre · iptal · baskaPc
 */
async function aktivasyon(request, env) {
  if (!env.PEPPER || !env.TOKEN_SECRET) {
    return cevap({ ok: false, hata: "kurulum", mesaj: "Doğrulama şu an yapılamıyor." }, 500);
  }
  const ip = istekIp(request);
  if (await hizAsildiMi(env, "akt:" + ip)) {
    return cevap({ ok: false, hata: "cok_deneme", mesaj: "Çok fazla deneme. Bir dakika bekle." }, 429);
  }

  const g = await govde(request);
  const sifre = sifreNormalize(g.sifre);
  const hwidHam = String(g.hwid || "").trim();
  const surum = String(g.panel || g.surum || "").slice(0, 20);
  const makine = String(g.makine || g.hwidAd || "").slice(0, 60);
  if (sifre.length < 8 || hwidHam.length < 8) {
    return cevap({ ok: false, hata: "eksik", mesaj: "Kod eksik." }, 400);
  }

  /* Şifre KV'de düz metin aranmaz: HMAC'i anahtarın kendisi. Böylece KV listesine
     bakan biri (ya da sızan bir yedek) şifreleri göremez. */
  const pwHash = await hmac(env.PEPPER, "pw|" + sifre);
  const id = await env.LISANS.get("pw:" + pwHash);
  if (!id) return cevap({ ok: false, hata: "sifre", mesaj: "Kod geçersiz." }, 403);

  const kayit = await kayitOku(env, id);
  if (!kayit) return cevap({ ok: false, hata: "sifre", mesaj: "Kod geçersiz." }, 403);
  if (kayit.durum !== "aktif") {
    return cevap({ ok: false, hata: "iptal", mesaj: "Bu kod artık geçerli değil." }, 403);
  }

  const hwid = await sha256hex(hwidHam);   /* ham HWID'i SAKLAMIYORUZ, yalnız özetini */
  const kisa = hwid.slice(0, 8).toUpperCase();
  const ulke = (request.cf && request.cf.country) || "";

  let cihaz = (kayit.cihazlar || []).find((c) => c.hwid === hwid);
  if (!cihaz) {
    if ((kayit.cihazlar || []).length >= (kayit.maxCihaz || 1)) {
      /* Aynı şifreyle ikinci bilgisayar: kullanıcı isteği tam olarak bunu engellemekti.
         Çözüm elimizde: yönetim sayfasından "cihazı sil" → arkadaş yeniden girer.
         ⚠ 409 ŞART — bkz. yukarıdaki "HTTP KODU MESAJI BELİRLİYOR" notu. */
      return cevap({
        ok: false, hata: "baskaPc",
        mesaj: "Bu kod başka bir bilgisayarda kullanılıyor."
      }, 409);
    }
    cihaz = {
      hwid: hwid, kisa: kisa, ad: makine,
      ulke: ulke, ilk: simdi(), son: simdi(), giris: 0, surum: surum
    };
    kayit.cihazlar = (kayit.cihazlar || []).concat([cihaz]);
  }

  cihaz.son = simdi();
  cihaz.giris = (cihaz.giris || 0) + 1;
  if (surum) cihaz.surum = surum;
  if (ulke) cihaz.ulke = ulke;
  if (makine) cihaz.ad = makine;
  /* Kullanıcı adı / Windows sürümü / kimlik kaynağı: "kim kullanıyor" sorusunun
     cevabını zenginleştiriyor, doğrulamada HİÇ kullanılmıyor (yani sahtelenmesi
     bir şey kazandırmaz). */
  if (g.kullanici) cihaz.kullanici = String(g.kullanici).slice(0, 40);
  if (g.isletim) cihaz.isletim = String(g.isletim).slice(0, 60);
  if (g.kaynak) cihaz.kaynak = String(g.kaynak).slice(0, 30);
  kayit.sonGoruldu = simdi();
  kayit.toplamGiris = (kayit.toplamGiris || 0) + 1;
  if (surum) kayit.sonSurum = surum;
  kayit.sonYazma = Date.now();

  await kayitYaz(env, kayit);
  await env.LISANS.put("hw:" + hwid, kayit.id);
  await gunlukYaz(env, "aktivasyon", { ad: kayit.ad, id: kayit.id, cihaz: kisa, surum: surum, ulke: ulke });

  const imza = await tokenUret(env, kayit, hwid);
  return cevap({
    ok: true,
    lisansId: kayit.id, imza: imza, ad: kayit.ad,   /* panelin okuduğu adlar */
    id: kayit.id, token: imza,                      /* eski adlar (uyumluluk) */
    mesaj: "Etkinlestirildi. Bir daha sifre sorulmayacak."
  });
}

/*
 * POST /ping
 *   İstek : { lisansId, hwid, imza, makine, kullanici, panel }
 *   Cevap : HER ZAMAN HTTP 200 + { ok, iptal:true|false, sebep }
 *
 * ⚠⚠ İKİ KURAL, İKİSİ DE js/lisans.js'TEN GELİYOR — DEĞİŞTİRME:
 *   1) CEVAP HEP 200 OLMALI. Panel yalnız `kod === 200 && govde.iptal === true`
 *      dalında iş yapıyor; 403 dönseydi lisansı iptal ettiğimizde panel bunu
 *      HİÇ görmezdi (sessizce çalışmaya devam ederdi).
 *   2) BOŞ İMZA = DOKUNMA. Panelde "usta kodu" ile açılan kurulumun imzası boştur;
 *      onu "geçersiz jeton" sayıp iptal edersek acil durum kapısını kendi elimizle
 *      kaparız.
 *
 * Panel bu cevabı yalnız NET geldiğinde dinler. Ağ hatası / zaman aşımı =
 * "sunucuya ulaşamadım" = panel açılmaya devam eder (offline kuralı).
 */
async function ping(request, env) {
  if (!env.TOKEN_SECRET) return cevap({ ok: false, iptal: false, hata: "kurulum" });

  const g = await govde(request);
  const jeton = String(g.imza || g.token || "").trim();
  if (!jeton) return cevap({ ok: true, iptal: false, sebep: "imzasiz" });

  const c = await tokenCoz(env, jeton);
  if (!c.ok) {
    /* ⚠ BURADA "iptal:true" DÖNDÜRME — ÇALIŞAN BİR KURULUMU KALICI OLARAK ÖLDÜRÜR.
       Jetonun çözülememesinin dört sebebi var ve YALNIZ biri gerçek bir yönetici kararı:
       lisans_yok · cihaz_yok · token_bozuk · token_gecersiz. Cloudflare KV
       eventually-consistent — yazma başka bir bölgeden okunana kadar kısa süre "yok"
       görünebiliyor. O anı yakalayan panel `iptal:true`yu diske yazıyor ve BİR DAHA
       açılmıyor; kullanıcı bunu ancak arkadaşı arayınca öğreniyor.
       Panel zaten kendi tarafında HWID kontrolü yapıyor, yani burada iptal etmenin
       güvenlik kazancı YOK. `kesin` bayrağı olmadan panel bunu yok sayar. */
    return cevap({ ok: false, iptal: false, kesin: false, sebep: c.hata });
  }

  const kayit = c.kayit, cihaz = c.cihaz;

  /* Jeton kopyalanıp başka makineye taşındıysa yakala: gövdedeki HWID jetonunkiyle
     aynı olmalı. (Panel offline'da zaten yerelde aynı kontrolü yapıyor.) */
  if (g.hwid) {
    const h = await sha256hex(String(g.hwid).trim());
    /* Başka makine: panel zaten yerelde aynı kontrolü yapıp kilitleniyor. Buradan kalıcı
       iptal yazdırmak gereksiz — ve jeton bir şekilde yanlış eşleşirse SAHİBİNİ kilitler. */
    if (h !== cihaz.hwid) return cevap({ ok: false, iptal: false, kesin: false, sebep: "baskapc" });
  }
  /* TEK GERÇEK İPTAL: yöneticinin (senin) lisansı "iptal" yapması. `kesin:true` yalnız
     burada dönüyor ve panel yalnız bu bayrakla diske yazıyor. */
  if (kayit.durum !== "aktif") {
    return cevap({ ok: false, iptal: true, kesin: true, sebep: "iptal" });
  }

  const surum = String(g.panel || g.surum || "").slice(0, 20);
  const surumDegisti = !!surum && surum !== cihaz.surum;
  const gecen = Date.now() - (kayit.sonYazma || 0);

  /* KV YAZMA FRENİ — bkz. dosya başındaki 1000 yazma/gün notu. */
  if (gecen > PING_YAZMA_ARALIK_MS || surumDegisti) {
    cihaz.son = simdi();
    cihaz.giris = (cihaz.giris || 0) + 1;
    if (surum) cihaz.surum = surum;
    if (g.makine) cihaz.ad = String(g.makine).slice(0, 60);
    if (g.kullanici) cihaz.kullanici = String(g.kullanici).slice(0, 40);
    kayit.sonGoruldu = simdi();
    kayit.toplamGiris = (kayit.toplamGiris || 0) + 1;
    if (surum) kayit.sonSurum = surum;
    kayit.sonYazma = Date.now();
    await kayitYaz(env, kayit);
    /* Günlüğe HER ping yazılmaz (yazma kotası): yalnız sürüm değişimi ilgi çekici —
       "kim güncellemeyi almış" sorusunun cevabı bu satır. */
    if (surumDegisti) {
      await gunlukYaz(env, "surum", { ad: kayit.ad, id: kayit.id, cihaz: cihaz.kisa, surum: surum });
    }
  }
  return cevap({ ok: true, iptal: false, ad: kayit.ad, durum: "aktif" });
}

/* ============================================================= YÖNETİM UÇLARI */

async function apiListe(env) {
  const liste = [];
  let cursor = undefined;
  /* list() 1000 anahtara kadar tek seferde döner; yine de sayfalama doğru yazıldı. */
  do {
    const r = await env.LISANS.list({ prefix: "lis:", cursor: cursor });
    for (const k of r.keys) {
      const kayit = await kayitOku(env, k.name.slice(4));
      if (kayit) liste.push(disaAc(kayit));
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  liste.sort((a, b) => String(b.sonGoruldu || "").localeCompare(String(a.sonGoruldu || "")));
  return cevap({ ok: true, liste: liste });
}

async function apiTek(env, id) {
  const kayit = await kayitOku(env, id);
  if (!kayit) return cevap({ ok: false, hata: "yok", mesaj: "Lisans bulunamadi." }, 404);
  return cevap({ ok: true, lisans: disaAc(kayit) });
}

async function apiEkle(request, env) {
  if (!env.PEPPER) return cevap({ ok: false, hata: "kurulum", mesaj: "PEPPER secret'i yok." }, 500);
  const g = await govde(request);
  const ad = String(g.ad || "").trim().slice(0, 40);
  if (!ad) return cevap({ ok: false, hata: "eksik", mesaj: "Isim gerekli." }, 400);

  const id = await yeniId(env);
  const sifre = sifreUret();
  const pwHash = await hmac(env.PEPPER, "pw|" + sifre);

  const kayit = {
    id: id, ad: ad, not: String(g.not || "").slice(0, 200),
    durum: "aktif", maxCihaz: Math.max(1, Math.min(10, parseInt(g.maxCihaz, 10) || 1)),
    pwHash: pwHash, pwIlk4: sifre.slice(0, 4),
    cihazlar: [], olusturma: simdi(), sonGoruldu: "", sonSurum: "", toplamGiris: 0, sonYazma: 0
  };
  await kayitYaz(env, kayit);
  await env.LISANS.put("pw:" + pwHash, id);
  await gunlukYaz(env, "lisans-eklendi", { ad: ad, id: id });

  /* Şifre YALNIZ BURADA görünür — KV'de hiçbir zaman düz metin durmaz.
     Kaybedilirse "sifre yenile" bir tıklık iş (cihaz bağı bozulmaz). */
  return cevap({ ok: true, id: id, sifre: sifreGoster(sifre) });
}

async function apiSifreYenile(request, env) {
  /* ⚠ PEPPER KAPISI apiEkle'deki gibi EN BASTA. Eskiden burada yoktu ve hmac() secret'i
     String(secret) ile kullandigi icin PEPPER undefined iken HATA FIRLATMIYOR, anahtar
     olarak duz "undefined" metnini kullaniyordu: islem 200 ile "basarili" gorunuyor, eski
     pw: isaretcisi SILINIYOR ve geri donusu olmuyordu. Aktivasyon tarafi PEPPER yokken 500
     dondugu icin ne eski ne yeni sifre calisiyor — yonetici yesil kutuda yeni sifreyi
     goruyor, arkadas giremiyor ve lisansi elle yeniden olusturmak gerekiyordu.
     Kapi kayitOku'dan da ONCE: ne KV yazmasi ne de eski isaretcinin silinmesi olsun. */
  if (!env.PEPPER) return cevap({ ok: false, hata: "kurulum", mesaj: "PEPPER secret'i yok." }, 500);
  const g = await govde(request);
  const kayit = await kayitOku(env, g.id);
  if (!kayit) return cevap({ ok: false, hata: "yok", mesaj: "Lisans bulunamadi." }, 404);

  const sifre = sifreUret();
  const yeniHash = await hmac(env.PEPPER, "pw|" + sifre);
  const eskiHash = kayit.pwHash;
  kayit.pwHash = yeniHash;
  kayit.pwIlk4 = sifre.slice(0, 4);
  await kayitYaz(env, kayit);
  await env.LISANS.put("pw:" + yeniHash, kayit.id);
  /* Eski işaretçi SİLİNİR, yoksa iki şifre birden çalışırdı. */
  if (eskiHash && eskiHash !== yeniHash) await env.LISANS.delete("pw:" + eskiHash);
  await gunlukYaz(env, "sifre-yenilendi", { ad: kayit.ad, id: kayit.id });

  /* NOT: şifre yenilemek kurulu cihazı DÜŞÜRMEZ — arkadaş çalışmaya devam eder.
     Amaç "şifreyi kaybettim, tekrar yolla" durumu; kovmak için "iptal" var. */
  return cevap({ ok: true, sifre: sifreGoster(sifre) });
}

async function apiDurum(request, env) {
  const g = await govde(request);
  const kayit = await kayitOku(env, g.id);
  if (!kayit) return cevap({ ok: false, hata: "yok", mesaj: "Lisans bulunamadi." }, 404);
  kayit.durum = (g.durum === "iptal") ? "iptal" : "aktif";
  await kayitYaz(env, kayit);
  await gunlukYaz(env, "durum", { ad: kayit.ad, id: kayit.id, durum: kayit.durum });
  return cevap({ ok: true, durum: kayit.durum });
}

async function apiCihazSil(request, env) {
  const g = await govde(request);
  const kayit = await kayitOku(env, g.id);
  if (!kayit) return cevap({ ok: false, hata: "yok", mesaj: "Lisans bulunamadi." }, 404);
  const kisa = String(g.kisa || "").toUpperCase();
  const kalan = [], silinen = [];
  for (const c of (kayit.cihazlar || [])) {
    if (c.kisa === kisa) silinen.push(c); else kalan.push(c);
  }
  kayit.cihazlar = kalan;
  await kayitYaz(env, kayit);
  /* Ters indeks de temizlenir; ayrıca cihaz listeden düşünce O CİHAZIN JETONU
     kendiliğinden geçersizleşir (tokenCoz cihazı bulamaz) — ayrı iptal listesi
     tutmaya gerek yok. */
  for (const c of silinen) await env.LISANS.delete("hw:" + c.hwid);
  await gunlukYaz(env, "cihaz-silindi", { ad: kayit.ad, id: kayit.id, cihaz: kisa });
  return cevap({ ok: true, silinen: silinen.length });
}

async function apiSil(request, env) {
  const g = await govde(request);
  const kayit = await kayitOku(env, g.id);
  if (!kayit) return cevap({ ok: false, hata: "yok", mesaj: "Lisans bulunamadi." }, 404);
  if (kayit.pwHash) await env.LISANS.delete("pw:" + kayit.pwHash);
  for (const c of (kayit.cihazlar || [])) await env.LISANS.delete("hw:" + c.hwid);
  await env.LISANS.delete("lis:" + kayit.id);
  await gunlukYaz(env, "lisans-silindi", { ad: kayit.ad, id: kayit.id });
  return cevap({ ok: true });
}

async function apiGunluk(env) {
  /* Olaylar DEĞER olarak değil METADATA olarak yazıldı: tek list() çağrısı 60 olayı
     birden getiriyor, 60 ayrı okuma yapmıyoruz (Cloudflare'in kendi önerdiği desen). */
  const r = await env.LISANS.list({ prefix: "log:", limit: GUNLUK_LIMIT });
  const olaylar = r.keys.map((k) => k.metadata).filter(Boolean);
  return cevap({ ok: true, olaylar: olaylar });
}

/* ==================================================================== YARDIMCI */

function istekIp(request) {
  return request.headers.get("cf-connecting-ip") || "0.0.0.0";
}

function cevap(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      /* CORS başlığı BİLEREK YOK: paneli CEP'in Node'u çağırıyor (tarayıcı değil),
         CORS'a ihtiyacı yok. "*" koysaydık herhangi bir web sayfası ziyaretçinin
         tarayıcısından bu uçları dövebilirdi. */
      "x-robots-tag": "noindex"
    }
  });
}

async function govde(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

function simdi() { return new Date().toISOString(); }

/* Kayıt okuma/yazma tek yerden geçsin ki anahtar öneki ("lis:") bir daha yazılmasın. */
async function kayitOku(env, id) {
  if (!id) return null;
  const s = String(id).replace(/[^A-Za-z0-9_-]/g, "");
  if (!s) return null;
  return await env.LISANS.get("lis:" + s, "json");
}
async function kayitYaz(env, kayit) {
  await env.LISANS.put("lis:" + kayit.id, JSON.stringify(kayit));
}

/* Yönetim sayfasına giden hâl: pwHash ve ham HWID DIŞARI ÇIKMAZ. */
function disaAc(kayit) {
  return {
    id: kayit.id, ad: kayit.ad, not: kayit.not || "", durum: kayit.durum,
    maxCihaz: kayit.maxCihaz || 1, pwIlk4: kayit.pwIlk4 || "",
    olusturma: kayit.olusturma || "", sonGoruldu: kayit.sonGoruldu || "",
    sonSurum: kayit.sonSurum || "", toplamGiris: kayit.toplamGiris || 0,
    cihazlar: (kayit.cihazlar || []).map((c) => ({
      kisa: c.kisa, ad: c.ad || "", ulke: c.ulke || "",
      ilk: c.ilk || "", son: c.son || "", giris: c.giris || 0, surum: c.surum || ""
    }))
  };
}

async function gunlukYaz(env, tip, veri) {
  /* Anahtar TERS zaman damgalı: KV list() sözlük sırasında döndüğü için en YENİ
     olay en başta gelir; sayfalama/sıralama derdi kalmıyor. */
  const ters = (1e13 - Date.now()).toString().padStart(14, "0");
  const rnd = Math.random().toString(36).slice(2, 8);
  const olay = Object.assign({ t: tip, z: simdi() }, veri || {});
  try {
    await env.LISANS.put("log:" + ters + ":" + rnd, "", {
      expirationTtl: GUNLUK_TTL_SN,       /* 90 gün sonra kendini siler: depolama şişmesin */
      metadata: olay                       /* 1024 bayt sınırı var; bu olaylar ~150 bayt */
    });
  } catch (e) { /* günlük yazılamazsa iş DURMAZ — asıl amaç lisans doğrulamaktı */ }
}

/* ------------------------------------------------------------------ şifre/jeton */

function sifreUret() {
  const b = new Uint8Array(SIFRE_UZUNLUK);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += ALFABE[b[i] % ALFABE.length];
  return s;
}
/* Gösterirken 4'erli gruplama okunaklı olsun diye; doğrulamada tireler atılıyor. */
function sifreGoster(s) { return s.replace(/(.{4})(?=.)/g, "$1-"); }

function sifreNormalize(x) {
  return String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function yeniId(env) {
  for (let i = 0; i < 5; i++) {
    const id = "L" + crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
    if (!(await env.LISANS.get("lis:" + id))) return id;
  }
  return "L" + Date.now().toString(36).toUpperCase();
}

/*
 * JETON = v1.<id>.<hwid8>.<imza>
 *   imza = HMAC-SHA256(TOKEN_SECRET, "v1|id|hwidHash") ilk 32 hex (128 bit)
 * Sunucuda AYRICA SAKLANMAZ: doğrulama = yeniden hesapla + karşılaştır.
 * İptal nasıl oluyor? Cihaz kayıttan silinince tokenCoz cihazı bulamaz → jeton ölür.
 * Yani ayrı bir "iptal listesi" tutmaya gerek yok.
 */
async function tokenUret(env, kayit, hwid) {
  const imza = await hmac(env.TOKEN_SECRET, "v1|" + kayit.id + "|" + hwid);
  return "v1." + kayit.id + "." + hwid.slice(0, 8) + "." + imza.slice(0, 32);
}

async function tokenCoz(env, token) {
  const p = String(token || "").split(".");
  if (p.length !== 4 || p[0] !== "v1") return { ok: false, hata: "token_bozuk" };
  const kayit = await kayitOku(env, p[1]);
  if (!kayit) return { ok: false, hata: "lisans_yok" };
  const cihaz = (kayit.cihazlar || []).find((c) => c.hwid.slice(0, 8) === p[2]);
  if (!cihaz) return { ok: false, hata: "cihaz_yok" };
  const bekle = await tokenUret(env, kayit, cihaz.hwid);
  if (!sabitEsit(bekle, String(token))) return { ok: false, hata: "token_gecersiz" };
  return { ok: true, kayit: kayit, cihaz: cihaz };
}

/* ------------------------------------------------------------------ kripto */

async function hmac(secret, mesaj) {
  const kod = new TextEncoder();
  const anahtar = await crypto.subtle.importKey(
    "raw", kod.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const imza = await crypto.subtle.sign("HMAC", anahtar, kod.encode(String(mesaj)));
  return hex(imza);
}

async function sha256hex(mesaj) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(mesaj)));
  return hex(buf);
}

function hex(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/* Sabit süreli karşılaştırma: normal === ilk farklı karakterde döner ve süre farkından
   anahtar harf harf tahmin edilebilir. Uzunluk farkı sızar, içerik sızmaz. */
function sabitEsit(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let fark = 0;
  for (let i = 0; i < a.length; i++) fark |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return fark === 0;
}

async function adminMi(request, env) {
  const h = request.headers.get("authorization") || "";
  const t = h.replace(/^Bearer\s+/i, "").trim();
  if (!env.ADMIN_TOKEN || t.length < 16) return false;
  return sabitEsit(t, env.ADMIN_TOKEN);
}

/*
 * Hız freni. ratelimit binding'i (wrangler.toml [[ratelimits]]) yoksa ya da hata
 * verirse İŞ DURMAZ — fren olmadan devam eder. Sebep: frenin kendisi yüzünden
 * arkadaşın aktivasyonu patlamasın; fren "olsa iyi olur", "olmazsa olmaz" değil.
 */
async function hizAsildiMi(env, anahtar) {
  if (!env.HIZ || typeof env.HIZ.limit !== "function") return false;
  try {
    const r = await env.HIZ.limit({ key: anahtar });
    return !(r && r.success);
  } catch (e) { return false; }
}

/* ============================================================ YÖNETİM SAYFASI */
/*
 * Tek dosyalık, bağımlılıksız HTML. Yönetici anahtarı SAYFAYA GÖMÜLÜ DEĞİL:
 * kullanıcı bir kere yapıştırıyor, tarayıcının localStorage'ında kalıyor.
 * ⚠ Sayfa içinde ters tırnak (template literal) ve ${ KULLANILMAZ — bu metin zaten
 *   bir template literal'in içinde; ${ yazarsak Worker onu değişken sanır.
 */
function adminSayfa() {
  return new Response(ADMIN_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex"
    }
  });
}

const ADMIN_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Yusufwrl — Lisanslar</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:18px;background:#14161a;color:#e8eaed;font:14px/1.45 "Segoe UI",Arial,sans-serif}
 h1{font-size:18px;margin:0 0 14px}
 .kutu{background:#1c1f25;border:1px solid #2b2f37;border-radius:10px;padding:14px;margin-bottom:14px}
 input,button,select{font:inherit;border-radius:7px;border:1px solid #3a3f49;background:#22262e;color:#e8eaed;padding:7px 10px}
 button{cursor:pointer;background:#2f6df6;border-color:#2f6df6;color:#fff}
 button.gri{background:#2b3038;border-color:#3a3f49;color:#cfd3da}
 button.kirmizi{background:#7a2320;border-color:#8c2b27}
 table{width:100%;border-collapse:collapse}
 th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #2b2f37;vertical-align:top}
 th{color:#9aa2ad;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
 .rozet{display:inline-block;padding:2px 8px;border-radius:20px;font-size:12px}
 .aktif{background:#123d24;color:#5fd68a}.iptal{background:#3d1212;color:#f08b8b}
 .kucuk{color:#9aa2ad;font-size:12px}
 .sifre{font:15px ui-monospace,Consolas,monospace;background:#0f2a17;color:#8ef0ad;padding:10px;border-radius:8px;user-select:all}
 .satir{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style></head><body>
<h1>Yusufwrl panel — lisanslar</h1>

<div class="kutu" id="girisKutu">
  <div class="satir">
    <input id="tok" type="password" placeholder="Yonetici anahtari (ADMIN_TOKEN)" style="min-width:320px">
    <button onclick="girisYap()">Gir</button>
    <span class="kucuk">Anahtar bu tarayicida saklanir, kimseye gitmez.</span>
  </div>
</div>

<div id="panel" style="display:none">
  <div class="kutu">
    <div class="satir">
      <input id="yeniAd" placeholder="Kime? (or: ParsMazi)">
      <input id="yeniNot" placeholder="Not (istege bagli)" style="min-width:220px">
      <select id="yeniCihaz"><option value="1">1 bilgisayar</option><option value="2">2 bilgisayar</option><option value="3">3 bilgisayar</option></select>
      <button onclick="lisansEkle()">Sifre uret</button>
      <button class="gri" onclick="yenile()">Listeyi yenile</button>
      <button class="gri" onclick="cikis()">Cikis</button>
    </div>
    <div id="yeniSifre" style="margin-top:10px"></div>
  </div>

  <div class="kutu"><table id="tablo"><thead><tr>
    <th>Kim</th><th>Durum</th><th>Bilgisayar</th><th>Son giris</th><th>Surum</th><th>Acilis</th><th></th>
  </tr></thead><tbody id="govde"></tbody></table></div>
  <div class="kucuk" style="margin:-6px 0 14px 4px">
    "Acilis" yaklasiktir: ucretsiz kotayi yakmamak icin panel acilislari saatte en fazla bir kez sayilir.
  </div>

  <div class="kutu"><b>Son hareketler</b><div id="gunluk" class="kucuk" style="margin-top:8px"></div></div>
</div>

<script>
var TOK = localStorage.getItem("yw_admin") || "";
function bas(id){ return document.getElementById(id); }
function girisYap(){ TOK = bas("tok").value.trim(); localStorage.setItem("yw_admin", TOK); yenile(); }
function cikis(){ localStorage.removeItem("yw_admin"); location.reload(); }

async function cagir(yol, yontem, govde){
  var s = { method: yontem || "GET", headers: { "authorization": "Bearer " + TOK } };
  if (govde){ s.headers["content-type"] = "application/json"; s.body = JSON.stringify(govde); }
  var r = await fetch(yol, s);
  var j = await r.json().catch(function(){ return { ok:false, mesaj:"Cevap okunamadi" }; });
  /* ⚠ 429 (hiz freni) DALI DA BURAYA DUSMEK ZORUNDA. Fren gercekten calisir hale gelince
     yeni bir sessiz basarisizlik dogdu: cevabin hata alani "cok_deneme" oldugu icin bu kosul
     tutmuyor, cagiranlar da "if (!j.ok) return;" ile sessizce cikiyordu — "Gir" dugmesi hicbir
     sey yapmiyor, ekranda tek satir yazmiyordu. Yonetici, anahtarinin yanlis mi yoksa frene mi
     takildigini anlayamiyordu. */
  if (!j.ok && (j.hata === "yetki" || j.hata === "cok_deneme")){
    bas("panel").style.display="none"; bas("girisKutu").style.display="block";
    alert(j.mesaj || "Anahtar yanlis.");
  }
  return j;
}

function tarih(s){ if(!s) return "-"; var d=new Date(s); return isNaN(d)? "-" : d.toLocaleString("tr-TR"); }

/* ⚠ METIN GOMMEDEN ONCE KACIS. l.ad (yoneticinin yazdigi isim) ve c.ad (panelin gonderdigi
   COMPUTERNAME) hicbir islem gormeden innerHTML'e giriyordu. '<' iceren bir makine adi
   satirin HTML'ini komple bozuyor. */
function esc(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;")
         .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/* ⚠ DUGMELER INLINE onclick DEGIL, VERI OZNITELIGI + TEK DELEGASYON.
   Eskiden id/ad dogrudan bir onclick string literaline gomuluyordu: "Ali'nin PC" gibi tek
   tirnakli bir isimde uretilen onclick GECERSIZ JS oluyor ve tiklamada SESSIZCE hicbir sey
   olmuyordu (konsola bir syntax hatasi duser, sayfada iz yok) — yonetici lisansi iptal
   edemiyor, sebebini de goremiyordu.
   ⚠ Yalnizca HTML kacisi (esc) bu satiri DUZELTMEZDI: tarayici oznitelik degerindeki karakter
   referanslarini handler'i derlemeden ONCE cozuyor, yani &#39; yine ' olup ayni hatayi
   uretirdi. HTML kacisi ile JS-dizgi kacisi ayri katmanlar; tek dogru cozum inline kodu
   birakmak. */
document.addEventListener("click", function(e){
  var b = e.target && e.target.closest ? e.target.closest("button[data-ac]") : null;
  if (!b) return;
  var ac = b.getAttribute("data-ac"), id = b.getAttribute("data-id");
  if (ac === "cihazsil") cihazSil(id, b.getAttribute("data-kisa"));
  else if (ac === "sifre") sifreYenile(id);
  else if (ac === "durum") durum(id, b.getAttribute("data-durum"));
  else if (ac === "sil") lisansSil(id, b.getAttribute("data-ad"));
});

async function yenile(){
  var j = await cagir("/api/lisanslar");
  if (!j.ok) return;
  bas("girisKutu").style.display="none"; bas("panel").style.display="block";
  var g = bas("govde"); g.innerHTML = "";
  var enYeni = "";
  j.liste.forEach(function(l){ if (l.sonSurum > enYeni) enYeni = l.sonSurum; });
  j.liste.forEach(function(l){
    var tr = document.createElement("tr");
    var cih = l.cihazlar.map(function(c){
      return "<div>" + esc(c.ad || "?") + " <span class='kucuk'>#" + esc(c.kisa) + " " + esc(c.ulke||"") +
             "</span> <button class='gri' data-ac='cihazsil' data-id='" + esc(l.id) +
             "' data-kisa='" + esc(c.kisa) + "'>sil</button></div>";
    }).join("") || "<span class='kucuk'>henuz giris yok</span>";
    var eski = l.sonSurum && enYeni && l.sonSurum !== enYeni;
    tr.innerHTML =
      "<td><b>" + esc(l.ad) + "</b><div class='kucuk'>" + esc(l.not||"") + "</div>" +
        "<div class='kucuk'>sifre " + esc(l.pwIlk4) + "&hellip; &middot; " + tarih(l.olusturma) + "</div></td>" +
      "<td><span class='rozet " + (l.durum==="aktif"?"aktif":"iptal") + "'>" + esc(l.durum) + "</span></td>" +
      "<td>" + cih + "</td>" +
      "<td>" + tarih(l.sonGoruldu) + "</td>" +
      "<td>" + esc(l.sonSurum || "-") + (eski ? " <span class='kucuk'>(eski)</span>" : "") + "</td>" +
      "<td>" + esc(l.toplamGiris) + "</td>" +
      "<td class='satir'>" +
        "<button class='gri' data-ac='sifre' data-id='" + esc(l.id) + "'>sifre</button>" +
        "<button class='gri' data-ac='durum' data-id='" + esc(l.id) + "' data-durum='" +
          (l.durum==="aktif"?"iptal":"aktif") + "'>" + (l.durum==="aktif"?"kapat":"ac") + "</button>" +
        "<button class='kirmizi' data-ac='sil' data-id='" + esc(l.id) + "' data-ad='" + esc(l.ad) + "'>sil</button>" +
      "</td>";
    g.appendChild(tr);
  });
  var jl = await cagir("/api/gunluk");
  bas("gunluk").innerHTML = (jl.olaylar||[]).map(function(o){
    return tarih(o.z) + " &middot; " + esc(o.t) + " &middot; " + esc(o.ad||"") + " " + (o.surum? ("("+esc(o.surum)+")") : "");
  }).join("<br>") || "kayit yok";
}

async function lisansEkle(){
  var ad = bas("yeniAd").value.trim();
  if (!ad) return alert("Isim yaz.");
  var j = await cagir("/api/lisans-ekle","POST",{ ad: ad, not: bas("yeniNot").value, maxCihaz: bas("yeniCihaz").value });
  if (!j.ok) return alert(j.mesaj || "Olmadi");
  bas("yeniSifre").innerHTML = "<div class='sifre'>" + esc(j.sifre) + "</div><div class='kucuk'>Bu sifre BIR KERE gorunur — kopyala ve " + esc(ad) + "'e yolla.</div>";
  bas("yeniAd").value=""; bas("yeniNot").value="";
  yenile();
}
async function sifreYenile(id){
  if (!confirm("Yeni sifre uretilsin mi? Eski sifre calismaz, kurulu bilgisayar etkilenmez.")) return;
  var j = await cagir("/api/sifre-yenile","POST",{ id: id });
  /* ELSE DALI SART: eskiden yalniz "if (j.ok)" vardi, basarisizlikta hicbir sey olmuyor ve
     hicbir mesaj cikmiyordu — yonetici dugmeye basip duruyor, sebebini goremiyordu.
     lisansEkle'deki kalibin aynisi. */
  if (!j.ok) return alert(j.mesaj || "Olmadi");
  bas("yeniSifre").innerHTML = "<div class='sifre'>" + esc(j.sifre) + "</div><div class='kucuk'>Yeni sifre — bir kere gorunur.</div>";
}
/* ⚠ ONAY SART: komsu dugmelerin hepsi (sifre / sil / cihaz sil) confirm() ile korunuyordu,
   ucu icinde etkisi EN UZAGA giden "kapat" hicbir sey sormadan POST atiyordu. Yanlis satira
   tiklamanin bedeli asimetrik: karsi taraftaki panel bir daha ACILMAZ ve arkadas montajin
   ortasinda kalir; geri almak icin yoneticinin durumu fark etmesi gerekiyor. */
async function durum(id, d){
  var soru = (d === "iptal")
    ? "Lisans KAPATILSIN mi? Karsi taraftaki panel bir daha acilmaz."
    : "Lisans yeniden ACILSIN mi?";
  if (!confirm(soru)) return;
  await cagir("/api/durum","POST",{ id:id, durum:d }); yenile();
}
async function cihazSil(id, kisa){
  if (!confirm("Bu bilgisayarin baglantisi silinsin mi? Kisi ayni sifreyle yeniden giris yapabilir.")) return;
  await cagir("/api/cihaz-sil","POST",{ id:id, kisa:kisa }); yenile();
}
async function lisansSil(id, ad){
  if (!confirm(ad + " tamamen silinsin mi?")) return;
  await cagir("/api/lisans-sil","POST",{ id:id }); yenile();
}
if (TOK) yenile();
</script>
</body></html>`;
