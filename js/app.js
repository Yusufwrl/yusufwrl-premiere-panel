/* Yusufwrl Altyazı — panel mantığı (Tek Stil + Konuşmacıya Göre) */
(function () {
  "use strict";
  var CEP = (typeof window.__adobe_cep__ !== "undefined");
  var cs = null, pipeline = null, cfg = null, path = null, fs = null, extRoot = "";
  var SP_COLORS = ["#4b8bff", "#35c26a", "#e0a63a", "#b06dfc", "#3fc6c6", "#ff7ac2", "#e5544b", "#9ac44b",
    "#ff8c42", "#6c5ce7", "#f9ca24", "#48dbfb"];
  var fileCounter = 0;

  var state = { mode: "single", genMode: "single", track: "0", running: false, cancelled: false, styles: [],
    acRunning: false, acCancelled: false,   // AutoCut kendi bayrakları: altyazı işiyle karışmasın
    cuesStale: false,            // AutoCut kesimi yapıldı ama altyazılar kesim ÖNCESİ zamanlarda

    singleCues: [], a1Cues: [], a2Cues: [], speakers: [], singleStyle: "",
    dict: [], dictMap: null,     // karakter isimleri sözlüğü (Tofi/Moni/…) + arama tablosu
    channels: [],                // "ayrı kanal" modu: her ses kanalı bir kişi
    kanalTarandi: false,         // "Kanalları Tara" çalıştı mı (boş sonuç ile hiç taranmamışı ayırmak için)
    kisiler: [],                 // Discord adı -> karakter + renk (Senkron kartı)
    /* A1 isim kutusunun CANLI referansı. Arkadaş kanallarında karşılığı ch.adInput var;
       A1'de yoktu ve adı yalnız lsGet ile DİSKTEN okunuyordu — kullanıcı yazıp henüz başka
       bir yere tıklamadıysa (change olayı çıkmadıysa) değer sessizce düşüyordu. Emoji
       karakteri bu addan geldiği için bedeli emojisiz bir video. */
    a1AdInput: null };

  function $(id) { return document.getElementById(id); }
  // Turkce kucuk harf: duz toLowerCase "I"->"i" verir; Turkcede I->i, İ->i olmali.
  // Stil adi eslesmesinde onemli: "MİMİ.mogrt" duz toLowerCase ile "mi̇mi̇" olur ve renk tutmaz.
  function trLower(s) { return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase(); }
  // Ayar kalıcılığı (localStorage) — panel her açılışta son ayarları hatırlar.
  /* ⚠ BOŞ ANAHTAR = "KİMLİK BİLİNMİYOR" — OKUMA DA YAZMA DA YAPILMAZ.
     Sekansa özel anahtar üreten yardımcılar (emojiKanalKarAnahtar, emojiEsleAnahtar) sekans
     henüz okunmadıysa "" dönüyor; boş anahtarla devam etmek "yw." adlı TEK bir kutuya bütün
     projelerin seçimini yazmak demekti — sekansa-özel olmanın amacını tersine çeviren şey. */
  function lsGet(k, d) { if (!k) return d; try { var v = localStorage.getItem("yw." + k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { if (!k) return; try { localStorage.setItem("yw." + k, v); } catch (e) {} }
  function persistSelect(id) { var el = $(id); if (!el) return; el.addEventListener("change", function () { lsSet(id, el.value); }); }
  function restoreSelect(id) { var el = $(id); if (!el) return; var sv = lsGet(id, null); if (sv == null) return;
    for (var i = 0; i < el.options.length; i++) { if (el.options[i].value === sv) { el.value = sv; return; } } }

  // ---------- Temalı modal (native confirm/alert yerine) ----------
  /* TEK SIRA (kuyruk): bütün modaller aynı #modal DOM'unu paylaşıyor. İki soru üst üste
     açılırsa (panel açılışında "oturum geri yüklensin mi" + "yeni sürüm kurulsun mu")
     ikincisi birincinin yazısını EZİYOR ama iki çağrının da düğme dinleyicileri açık kalıyordu:
     tek tıklama, kullanıcının hiç görmediği soruyu da onaylıyordu. Artık çağrılar sıraya girer;
     sonraki modal ancak öncekine cevap verilince açılır. */
  var _modalKuyruk = Promise.resolve();
  function uiModal(opts) {
    var p = _modalKuyruk.then(function () { return _modalGoster(opts); });
    _modalKuyruk = p["catch"](function () {});   // bir modal patlarsa kuyruk tıkanmasın
    return p;
  }
  function _modalGoster(opts) {
    return new Promise(function (resolve) {
      var m = $("modal");
      if (!m) { resolve(opts.confirm ? window.confirm(opts.msg) : (window.alert(opts.msg), true)); return; }
      var card = m.querySelector(".modal-card");
      $("modalTitle").textContent = opts.title || (opts.confirm ? "Onay" : "Bilgi");
      $("modalMsg").textContent = opts.msg || "";
      $("modalOk").textContent = opts.ok || (opts.confirm ? "Devam" : "Tamam");
      $("modalCancel").textContent = opts.cancel || "İptal";
      if (opts.confirm) card.classList.remove("alert"); else card.classList.add("alert");
      m.hidden = false;
      function cleanup() { m.hidden = true;
        $("modalOk").removeEventListener("click", onOk); $("modalCancel").removeEventListener("click", onCancel);
        m.removeEventListener("mousedown", onBack); document.removeEventListener("keydown", onKey); }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      function onBack(e) { if (e.target === m) { cleanup(); resolve(false); } }
      function onKey(e) { if (e.key === "Escape") { cleanup(); resolve(false); } else if (e.key === "Enter") { cleanup(); resolve(true); } }
      $("modalOk").addEventListener("click", onOk); $("modalCancel").addEventListener("click", onCancel);
      m.addEventListener("mousedown", onBack); document.addEventListener("keydown", onKey);
      try { $("modalOk").focus(); } catch (e) {}
    });
  }
  function uiConfirm(msg, title) { return uiModal({ confirm: true, msg: msg, title: title }); }
  function uiAlert(msg, title) { return uiModal({ confirm: false, msg: msg, title: title }); }
  /* Ham ffmpeg/whisper hatalarını anlaşılır Türkçeye çevirir. Kullanıcı yazılımcı değil;
     "ffmpeg.exe çıkış kodu 4294967274 … Invalid argument" ekranı ne olduğunu da ne yapılacağını
     da anlatmıyor. Çeviri bulunamazsa ham mesajın İLK satırı gösterilir (ekranı kaplamasın);
     teknik dökümün tamamı her durumda "Ayrıntılar" altında durmaya devam eder. */
  var _HATA_CEVIRI = [
    [/matches no streams|Stream specifier/i,
      "Seçtiğin ses kanalı bu videoda yok gibi görünüyor. Kaynak Ses'ten başka bir kanal (A1/A2) dene."],
    /* ENOENT kuralı, "No such file" kuralının ÜSTÜNDE olmalı: Node'un kendi ENOENT metni
       ("ENOENT: no such file or directory, mkdir 'C:\\…'") içinde "no such file" geçiyor ve
       alttaki medya kuralı her seferinde önce eşleşiyordu. Sonuç: motor klasörü taşınınca
       kullanıcı "klip çevrimdışı" mesajı görüp saatlerce Premiere'de klip bağlantısı arıyordu. */
    [/ENOENT/i,
      "Bir dosya ya da klasör bulunamadı. Motor klasörü (YusufwrlEngine) taşınmış ya da silinmiş " +
      "olabilir — kurulum klasöründeki engine-root.txt içindeki yolu kontrol et."],
    [/No such file|could not find codec|Invalid data found|does not contain any stream/i,
      "Medya dosyası okunamadı. Klip çevrimdışı (offline) olabilir — Premiere'de sağ tık > Link Media."],
    [/out of memory|cudaErrorMemoryAllocation|CUBLAS_STATUS_ALLOC/i,
      "GPU belleği yetmedi. Model'i “medium” yap ya da açık olan ağır programları kapat."],
    [/cudnn|cublas|CUDA driver|no kernel image|\.dll/i,
      "Ekran kartı sürücüsü sorunu. Sürücüyü güncelle; sorun sürerse Model'i “medium” yap."],
    [/ENAMETOOLONG/i,
      "Bu sekansta çok fazla klip var. Süre aralığı vererek videoyu parça parça işle."],
    [/JSON üretilemedi/i,
      "Yapay zekâ motoru sonuç üretemedi. Seçili kanalda konuşma olduğundan emin ol, sonra tekrar dene."]
  ];
  function friendlyError(e) {
    var ham = String((e && e.message) || e || "");
    for (var i = 0; i < _HATA_CEVIRI.length; i++) if (_HATA_CEVIRI[i][0].test(ham)) return _HATA_CEVIRI[i][1];
    var ilk = ham.split("\n")[0];
    return ilk.length > 140 ? ilk.slice(0, 140) + "…" : ilk;
  }
  /* Premiere (host.jsx) sonuçları için ikinci çeviri katmanı. host bazı hataları ham
     ExtendScript istisnasıyla döndürüyor, CEP de host çökerse sadece "EvalScript error."
     yazıyor; ikisi de kullanıcıya olduğu gibi gösteriliyordu ve ne olduğunu anlatmıyordu.
     Ham metin her durumda "Ayrıntılar" altındaki log'da durmaya devam eder. */
  var _HOST_CEVIRI = [
    [/MOGRT yok|importMGT/i,
      "Stil dosyası (.mogrt) bulunamadı ya da açılamadı. Stil klasörünü kontrol et " +
      "(Motion Graphics Templates) ya da panelde başka bir stil seç."],
    [/EvalScript error/i,
      "Premiere komutu çalıştırılamadı. Paneli kapatıp yeniden aç (Pencere > Uzantılar), sonra tekrar dene."],
    [/Aktif sekans yok/i, "Aktif sekans yok. Önce Premiere'de bir sekans aç."],
    [/proje henüz diske kaydedilmemiş/i,
      "Proje henüz diske kaydedilmemiş. Premiere'de Dosya > Kaydet yapıp tekrar dene (Geri Al bunu gerektirir)."]
  ];
  function hostMesaj(r) {
    var s = String(r == null ? "" : r);
    for (var i = 0; i < _HOST_CEVIRI.length; i++) if (_HOST_CEVIRI[i][0].test(s)) return _HOST_CEVIRI[i][1];
    return s.replace(/^[a-z_]+:/, "");
  }
  function trimLog(s) { var lines = String(s).split("\n"); return (lines.length > 200 ? lines.slice(0, 200) : lines).join("\n"); }
  function logLine(msg) { var el = $("log"); var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  function setPill(id, on) { var el = $(id); el.classList.remove("on", "off"); el.classList.add(on ? "on" : "off"); }
  // ---------- İlerleme (yüzde + tahmini süre + bitti/hata durumu) ----------
  // _pg.max: yüzde geri gitmesin (monotonik). _pg.transT0: transkripsiyon başlangıç zamanı (ETA için).
  // _pg.etaNot: ETA'nın neyi ölçtüğünü söyleyen ek ("(bu kanal)"), aşağıda anlatılıyor.
  var _pg = { base: "", max: 0, transT0: 0, totalSec: 0, etaNot: "" };   // totalSec: ilerlemeyi zaman damgasindan hesaplamak icin
  function _fmtEta(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return "~" + m + ":" + (s < 10 ? "0" : "") + s; }
  function setProgress(pct, label, eta) {
    var box = $("progressBox"); box.hidden = false; box.classList.remove("done", "error");
    var sp = $("spinner"); if (sp) sp.hidden = false;
    var bd = $("progressBadge"); if (bd) bd.hidden = true;
    if (label != null) _pg.base = label;
    var lbl = $("progressLabel"); lbl.textContent = "";
    lbl.appendChild(document.createTextNode(_pg.base || ""));
    // ETA her zaman O ANKİ transkripsiyonu ölçer. Çok kanallı üretimde bu, işin tamamı değil
    // sadece o kanaldır — etiket bunu açıkça yazmazsa kullanıcı 25 dakikalık işi 5 sanıyordu.
    if (eta) { var e = document.createElement("span"); e.className = "prog-eta"; e.textContent = "  " + eta + " kaldı" + (_pg.etaNot || ""); lbl.appendChild(e); }
    if (pct >= 0) {
      if (pct < _pg.max) pct = _pg.max; else _pg.max = pct;   // geri gitmesin
      $("progressFill").style.width = pct + "%"; $("progressPct").textContent = Math.round(pct) + "%";
    }
  }
  function progressReset(label) {
    _pg.base = label || ""; _pg.max = 0; _pg.transT0 = 0; _pg.totalSec = 0; _pg.etaNot = "";
    var box = $("progressBox"); box.hidden = false; box.classList.remove("done", "error");
    $("spinner").hidden = false; var bd = $("progressBadge"); if (bd) bd.hidden = true;
    $("progressLabel").style.color = ""; $("progressLabel").textContent = _pg.base;
    $("progressFill").style.width = "0%"; $("progressPct").textContent = "0%";
  }
  function progressBusy(label) {
    var box = $("progressBox"); box.hidden = false; box.classList.remove("done", "error");
    $("spinner").hidden = false; var bd = $("progressBadge"); if (bd) bd.hidden = true;
    $("progressLabel").style.color = ""; if (label != null) { _pg.base = label; $("progressLabel").textContent = label; }
  }
  function progressDone(label) {
    var box = $("progressBox"); box.hidden = false; box.classList.add("done"); box.classList.remove("error");
    $("spinner").hidden = true; var bd = $("progressBadge"); if (bd) { bd.hidden = false; bd.textContent = "✓"; bd.className = "prog-badge ok"; }
    _pg.max = 100; $("progressFill").style.width = "100%"; $("progressPct").textContent = "100%";
    $("progressLabel").style.color = "var(--good)"; $("progressLabel").textContent = label || "Bitti";
  }
  function progressFail(label, kind) {
    var box = $("progressBox"); box.hidden = false; box.classList.add("error"); box.classList.remove("done");
    $("spinner").hidden = true; var bd = $("progressBadge"); if (bd) { bd.hidden = false; bd.textContent = "✕"; bd.className = "prog-badge bad"; }
    $("progressLabel").style.color = (kind === "warn") ? "var(--warn)" : "var(--bad)"; $("progressLabel").textContent = label || "Hata";
  }
  // Whisper transkripsiyon yüzdesini (0-100) genel ilerlemeye [lo,hi] eşler + kalan süreyi tahmin eder.
  function transProgress(rawPct, lo, hi) {
    if (rawPct < 0) return;
    var overall = lo + (hi - lo) * (rawPct / 100), eta = "";
    if (_pg.transT0 && rawPct >= 2 && rawPct < 99) {
      var el = (Date.now() - _pg.transT0) / 1000;
      if (el > 1.5) eta = _fmtEta(el * (100 - rawPct) / rawPct);   // doğrusal tahmin
    }
    setProgress(overall, null, eta);
  }
  function esPath(p) { return String(p).replace(/\\/g, "\\\\"); }
  /* izle (isteğe bağlı): uzun süren çağrılarda saniyede bir çağrılan NÖBETÇİ.
     ⚠ ZAMAN AŞIMI DEĞİL — promise ASLA terk edilmiyor, yalnızca "hâlâ bekliyoruz" bilgisi
     dışarı veriliyor. Sebep ölçüldü: `cs.evalScript` geri çağrısı gelmezse `await` sonsuza
     kadar bekler ve panel son yazdığı metinde donar. İkinci kullanıcıda tam bu oldu — emoji
     yerleştirme "155/206"da kaldı, Görev Yöneticisi'nde Premiere %0,3 CPU (hesaplamıyor,
     ekranda açılmış bir pencereyi bekliyor: "Save Project — Saving project: Untitled.prproj").
     Panel donmuş Premiere ile çalışan Premiere'i BİRBİRİNDEN AYIRT EDEMİYORDU.
     ⚠ NEDEN ZAMAN AŞIMI DEĞİL: Premiere gerçekten bir pencerede kilitliyse evalScript
     çağrıları host tarafında SIRAYA giriyor. Zaman aşımıyla vazgeçip akışa devam etmek
     sonraki çağrıyı da dondurur — panel bu kez ilerleme sayısı bile olmayan bir adımda
     ("preset uygulanıyor…") donar ve hâlâ sırada bekleyen bir çağrının okuyacağı geçici plan
     dosyası silinmiş olur. Yani zaman aşımı teşhisi İYİLEŞTİRMİYOR, kötüleştiriyor.
     Nöbetçide bu risk yok: pencere kapandığı anda her şey kaldığı yerden doğru devam eder. */
  function evalES(code, izle) {
    return new Promise(function (res) {
      if (!cs) { res('{"error":"no_cep"}'); return; }
      var bitti = false, t0 = Date.now(), sayac = null;
      if (typeof izle === "function") {
        sayac = setInterval(function () {
          if (bitti) return;
          try { izle(Math.round((Date.now() - t0) / 1000)); } catch (eIz) {}
        }, 1000);
      }
      cs.evalScript(code, function (r) {
        bitti = true;
        if (sayac) { try { clearInterval(sayac); } catch (eC) {} }
        res(r);
      });
    });
  }
  function speakerColor(i) { return SP_COLORS[i % SP_COLORS.length]; }
  function fmtShort(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  /* Motor çıktısından ilerleme yüzdesi. Motor varsayılan ayarda HİÇ yüzde basmıyor — çubuk
     %45'te donup kalıyordu. Bunun yerine bastığı segment zaman damgaları ("[01:07.000 --> …")
     okunup toplam süreye oranlanır.
     (--print_progress eklemek daha kolay olurdu ama o bayrak CANLI TRANSKRİPT akışını kapatıyor;
      yanlış kanal seçtiğini işlem sürerken fark etmenin tek yolu o akış.) */
  function whenLog(line) {
    var s = String(line).trim();
    if (s) logLine(s.length > 80 ? s.slice(-80) : s);
    var re = /(\d+)%/g, m, last = -1;
    while ((m = re.exec(s)) !== null) last = +m[1];    // en son yüzdeyi al (tqdm \r ile üst üste yazar)
    if (last >= 0) return last;
    if (_pg.totalSec > 0) {
      var tre = /\[(?:(\d+):)?(\d+):(\d+)(?:\.\d+)?\s*-->/g, t, sonSn = -1;
      while ((t = tre.exec(s)) !== null) sonSn = (t[1] ? (+t[1]) * 3600 : 0) + (+t[2]) * 60 + (+t[3]);
      if (sonSn >= 0) return Math.max(0, Math.min(99, Math.round(sonSn / _pg.totalSec * 100)));
    }
    return -1;
  }

  /* ---------- kaynak ses ----------
     MOD SEÇİCİ KALDIRILDI. Artık tek yol var: altyazı Premiere'in kendi altyazı kanalına
     yazılıyor. MOGRT (renkli/animasyonlu) yolu, "Konuşmacıya Göre" ve "Renk Değiştir"
     tamamen kalktı — bir altyazı kanalının tek stili olduğu için renk ayrımı zaten
     mümkün değil. Kanal başına yazıya dökme değeri KAYBOLMADI: "Herkes" kaynağı olarak
     duruyor (her kanal ayrı dökülür, sonuç tek listede birleşir). */
  function modGorunumUygula() {
    // Kanal listesi yalnız "Herkes" kaynağında anlamlı.
    var kb = $("kanalBox"); if (kb) kb.hidden = (state.track !== "herkes");
    $("result").hidden = !allCues().length;
  }
  var trackBtns = document.querySelectorAll("#segTrack .seg-btn");
  for (var j = 0; j < trackBtns.length; j++) trackBtns[j].addEventListener("click", function (ev) {
    document.querySelector("#segTrack .seg-btn.active").classList.remove("active");
    this.classList.add("active"); state.track = this.dataset.track; lsSet("track", state.track);
    modGorunumUygula();
    /* "Herkes"e İLK KEZ geçildiğinde kanalları kendiliğinden tara — kullanıcı "Kanalları
       Tara" adımını atlayıp doğrudan "Altyazı Oluştur"a basınca hata alıyordu.
       Yalnız GERÇEK tıklamada: restoreSegs() açılışta bu düğmeyi programla tıklıyor ve
       o sırada başlayan tarama, geri yüklenen oturumla yarışıyordu. */
    if (ev && ev.isTrusted && state.track === "herkes" && CEP && !state.running && !state.kanalTarandi) {
      // scanChannels async: hata FIRLATMAZ, promise'i reddeder — düz try/catch yakalayamaz.
      try { var pTara = scanChannels(); if (pTara && pTara["catch"]) pTara["catch"](function () {}); } catch (eTara) {}
    }
  });
  // Kaydedilmiş mod/track'i geri yükle (buton tıklaması ile — panelleri de senkronlar)
  function restoreSegs() {
    // mod seçici kaldırıldı; yalnız kaynak ses hatırlanır
    var st = lsGet("track", null);
    var bt = st ? document.querySelector('#segTrack .seg-btn[data-track="' + st + '"]') : null;
    /* ESKİ SEÇİM MİGRASYONU. A3 ("2") ve A1+A2 ("mix") kaldırıldı. Kayıtlı değer düğmeyi
       bulamayınca eskiden `if (bt)` sessizce atlıyordu: panel uyarısız A1'e düşüyor, kullanıcı
       "her zamanki ayarım duruyor" sanıp üretime basıyor ve arkadaşların sesi hiç yazıya
       dökülmüyordu — bunu ancak 20-30 dakikalık GPU işinin SONUNDA fark ediyordu.
       Artık değer temizlenir ve kullanıcıya ne olduğu söylenir. */
    if (st && !bt) {
      logLine("Kaynak Ses seçimin (" + (st === "mix" ? "A1+A2" : "A" + (parseInt(st, 10) + 1)) +
              ") kaldırıldı — A1'e alındı. Arkadaşların da yazıya dökülsün istiyorsan “Herkes” seç.");
      lsSet("track", "0");
      bt = document.querySelector('#segTrack .seg-btn[data-track="0"]');
    }
    /* bt.click() burada isTrusted=false üretir; düğme dinleyicisindeki "Herkes'e ilk geçişte
       otomatik tara" bloğu ev.isTrusted istediği için tetiklenmez — mevcut yarış koruması bozulmaz. */
    if (bt) bt.click();
  }

  // ---------- kart menüsü navigasyonu ----------
  function goView(name) {
    var all = document.querySelectorAll(".view");
    for (var i = 0; i < all.length; i++) { all[i].classList.remove("active"); all[i].setAttribute("hidden", ""); }
    var id = name === "altyazi" ? "viewAltyazi" : name === "autocut" ? "viewAutocut"
           : name === "senkron" ? "viewSenkron" : name === "ayarlar" ? "viewAyarlar"
           : name === "preset" ? "viewPreset" : name === "emoji" ? "viewEmoji" : "viewHome";
    var el = $(id); el.removeAttribute("hidden"); el.classList.add("active");
    $("backBtn").hidden = (id === "viewHome");
    var c = document.querySelector(".content"); if (c) c.scrollTop = 0;
    // Süre aralığı menüleri aktif sekansın uzunluğuna göre — sekans değişmiş olabilir
    if (name === "altyazi") { try { refreshRangeOptions(); } catch (e) {} }
    /* Preset listesi Premiere'in efekt kataloğuna bağlı: kullanıcı arada yeni preset
       kaydetmiş olabilir, görünüm her açıldığında tazelenir. async — hata FIRLATMAZ,
       promise'i reddeder; düz try/catch yakalamaz, o yüzden .catch ile susturuluyor. */
    if (name === "preset") { try { efektleriYukle()["catch"](function () {}); } catch (e) {} }
    /* AutoCut kanal listesi de sekansa bağlı: görünüm her açıldığında tazelenir, yoksa
       kullanıcı Senkron'la yeni kanallar ekledikten sonra eski listeyi görüyor.
       async: hata FIRLATMAZ, promise'i reddeder — düz try/catch yakalayamaz. */
    if (name === "autocut") {
      try { var pAc = acKanallariTara(true); if (pAc && pAc["catch"]) pAc["catch"](function () {}); } catch (e) {}
    }
    /* EMOJİ EKRANI HER AÇILIŞTA TAZELENİR: kanal listesi, isimler ve emoji klasörü arada
       değişmiş olabilir (kullanıcı Altyazı'da isim yazar, Senkron'da kanal ekler). Bayat bir
       liste göstermek, bu ekranın var olma sebebini — "kimin hangi kanalda olduğunu GÖR" —
       ortadan kaldırırdı. */
    if (name === "emoji") { try { emojiKanalKarCiz(); } catch (e) {} }
  }
  var toolCards = document.querySelectorAll(".tool-card");
  for (var tcx = 0; tcx < toolCards.length; tcx++) toolCards[tcx].addEventListener("click", function () { goView(this.dataset.view); });
  $("backBtn").addEventListener("click", function () { goView("home"); });

  // ---------- stiller ----------
  function preselect(sel, nameLike) {
    for (var i = 0; i < sel.options.length; i++) if (trLower(sel.options[i].textContent).indexOf(trLower(nameLike)) >= 0) { sel.selectedIndex = i; return true; }
    return false;
  }

  // ---------- transkript ----------
  // Konuşmacı düzeltme seçici: bir satırın noktasına tıklayınca konuşmacıları renkli
  // yuvarlaklarla gösterir; birine tıklayınca o satırı O konuşmacıya (renge) atar.
  // Model kesin olmadığı yerleri elle düzeltmek için (örn. 0:54 aslında Moni).
  function _pickerOutside(e) { var p = $("spPicker"); if (p && !p.contains(e.target)) closeSpeakerPicker(); }
  function closeSpeakerPicker() { var p = $("spPicker"); if (p) p.remove(); document.removeEventListener("mousedown", _pickerOutside); }
  function openSpeakerPicker(dotEl, cue) {
    closeSpeakerPicker();
    if (!state.speakers.length) return;
    var pop = document.createElement("div"); pop.id = "spPicker";
    pop.style.cssText = "position:absolute;z-index:60;background:var(--surface-solid,#1d1829);border:1px solid var(--border-strong,#5a49a8);border-radius:9px;padding:7px;display:flex;flex-wrap:wrap;gap:6px;box-shadow:0 8px 24px rgba(0,0,0,.55);max-width:220px";
    state.speakers.forEach(function (sp, i) {
      var col = speakerColor(i);
      var chip = document.createElement("button");
      chip.type = "button"; chip.title = "Konuşmacı " + (i + 1); chip.textContent = String(i + 1);
      chip.style.cssText = "width:27px;height:27px;border-radius:50%;border:2px solid " + (cue.speaker === sp.id ? "#fff" : "transparent") + ";background:" + col + ";color:#fff;font-weight:700;font-size:12px;cursor:pointer;line-height:1";
      chip.addEventListener("click", function () {
        cue.speaker = sp.id; if (cue._ref) cue._ref.speaker = sp.id;
        dotEl.style.background = col; closeSpeakerPicker();
        saveSession();   // elle yapılan konuşmacı düzeltmesi de kalıcı olsun
      });
      pop.appendChild(chip);
    });
    document.body.appendChild(pop);
    var r = dotEl.getBoundingClientRect();
    var w = pop.offsetWidth || 200;
    pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + "px";
    pop.style.top = (r.bottom + 4) + "px";
    setTimeout(function () { document.addEventListener("mousedown", _pickerOutside); }, 0);
  }

  function renderTranscript(cues, colorMap) {
    $("segCount").textContent = cues.length;
    var box = $("transcript"); box.innerHTML = "";
    cues.forEach(function (c) {
      var row = document.createElement("div"); row.className = "tr-row";
      if (colorMap) {
        var d = document.createElement("div"); d.className = "tr-sp"; d.style.background = (c.speaker && colorMap[c.speaker]) || "#666";
        /* A2 satırları elle düzeltilebilir (A1 = tek kişi, sen; değiştirilmez).
           state.speakers KOŞULU ŞART: "Konuşmacıya Göre" (kanal) modunda konuşmacı listesi boş
           olduğu için openSpeakerPicker ilk satırında sessizce dönüyor. Nokta yine de imleç
           değiştirip "tıkla" diyordu; tıklayınca hiçbir şey açılmıyor, uyarı da çıkmıyordu. */
        if (c.speaker && c.speaker !== "__A1__" && state.speakers.length) {
          d.style.cursor = "pointer"; d.title = "Konuşmacıyı/rengi değiştir";
          (function (dot, cue) { dot.addEventListener("click", function (ev) { ev.stopPropagation(); openSpeakerPicker(dot, cue); }); })(d, c);
        }
        row.appendChild(d);
      }
      var t = document.createElement("div"); t.className = "tr-time"; t.textContent = fmtShort(c.start);
      t.style.cursor = "pointer"; t.title = "Bu ana git (Premiere)";
      (function (sec) { t.addEventListener("click", function () { evalES("seekTo(" + sec + ")"); }); })(c.start);
      row.appendChild(t);
      var x = document.createElement("div"); x.className = "tr-text"; x.textContent = c.text;
      x.contentEditable = "true"; x.spellcheck = false;
      (function (cue, node) {
        node.addEventListener("blur", function () {
          var v = node.textContent.replace(/\s+/g, " ").trim();
          if (v && v !== cue.text) {
            cue.text = v; if (cue._ref) cue._ref.text = v;   // _ref: konuşmacı/kanal modunda asıl listeye köprü
            saveSession();                                    // elle düzeltmeler de kalıcı olsun
          } else if (!v) node.textContent = cue.text;
        });
        node.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); node.blur(); } });
      })(c, x);
      row.appendChild(x);
      box.appendChild(row);
    });
    $("result").hidden = false;
  }
  // Transkript kutusunu mevcut üretim moduna göre yeniden çizer
  // (sözlük sonradan uygulandığında da kullanılır).
  function redrawTranscript() {
    if (state.genMode === "channels") {
      var cc = { "__A1__": "#e5544b" };
      var hepsi = state.a1Cues.map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: "__A1__", _ref: c }; });
      aktifKanallar().forEach(function (ch, i) {
        /* Renk KANAL NESNESİNDEN okunur. Eskiden burada aktif kanalların sırası (i) kullanılıyordu
           ama kanal listesindeki nokta TÜM dolu kanalların sırasına göre boyanıyordu; bir kanalın
           işareti kaldırılınca iki taraf kayıyor ve transkriptteki yeşil satırlar başka birine
           aitmiş gibi görünüyordu. */
        var id = "__CH" + ch.idx + "__"; cc[id] = ch.renk || speakerColor(i);
        ch.cues.forEach(function (c) { hepsi.push({ start: c.start, end: c.end, text: c.text, speaker: id, _ref: c }); });
      });
      hepsi.sort(function (a, b) { return a.start - b.start; });
      renderTranscript(hepsi, cc);
      return;
    }
    if (state.genMode === "speaker") {
      var color = {}; state.speakers.forEach(function (s, i) { color[s.id] = speakerColor(i); });
      color["__A1__"] = "#e5544b";
      var all = state.a1Cues.map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: "__A1__", _ref: c }; })
        .concat(state.a2Cues.map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: c.speaker, _ref: c }; }));
      all.sort(function (a, b) { return a.start - b.start; });
      renderTranscript(all, color);
    } else renderTranscript(state.singleCues, null);
  }

  // ---------- KARAKTER İSİMLERİ (sözlük) ----------
  // İki yerde kullanılır: (1) motora --hotwords ipucu, (2) transkript sonrası KESİN düzeltme.
  // Liste <uzantı kökü>\sozluk.json'da saklanır; oto-güncelleme bu dosyayı ezmez.
  var SZ = null;                 // js/sozluk.js modülü (CEP dışında yüklenemez)
  var _dictSonMetin = "";        // blur'da gereksiz kayıt yapmamak için
  function dictStatus(msg, renk) {
    var el = $("dictStatus"); if (!el) return;
    el.textContent = msg || ""; el.style.color = renk || "var(--muted)";
  }
  function dictRefresh() {
    state.dictMap = SZ ? SZ.buildMap(state.dict) : null;
    var b = $("dictBadge"); if (b) b.textContent = state.dict.length;
  }
  function dictFill() {
    var ta = $("dictText");
    if (ta && SZ) { ta.value = SZ.toText(state.dict); _dictSonMetin = ta.value; }
    dictRefresh();
  }
  /* Metin kutusunu okur, kaydeder ve MEVCUT altyazı listesine de uygular — yani yanlış bir
     isim görünce sözlüğe ekleyip anında düzeltebilirsin, videoyu baştan işlemeye gerek yok. */
  function dictApply(kaydet) {
    var ta = $("dictText"); if (!ta) return;
    if (!SZ) { dictStatus("Önizleme modunda kaydedilmez.", "var(--warn)"); return; }
    state.dict = SZ.parseText(ta.value);
    _dictSonMetin = ta.value;
    dictRefresh();
    if (kaydet) {
      try { SZ.save(extRoot, state.dict); }
      catch (e) { dictStatus("✕ Kaydedilemedi: " + (e.message || e), "var(--bad)"); return; }
    }
    var n = 0;
    if (state.dictMap) {
      /* ⚠ KANAL CUE'LARI DA LISTEYE GIRER. "Herkes" modunda cue'lar IKI yerde durur:
         A1 icin state.a1Cues, diger her ses kanali icin state.channels[i].cues. dictApply
         yalnizca singleCues/a1Cues/a2Cues'u geziyordu — yani sozluk duzeltmesi ARKADASLARIN
         altyazisina HIC ulasmiyordu (state.a2Cues diarizasyon kaldirildigindan beri zaten
         her zaman bos, pratikte tek gercek liste A1'inki). Oysa dictApply'in var olma sebebi
         tam olarak "uretilmis altyaziyi yeniden GPU'ya sokmadan duzeltmek": kullanici Dora'nin
         satirlarinda "Toffy" gorup sozluge ekliyor, panel "✓ Kaydedildi" diyor, metin
         degismiyor ve 25 dakikalik GPU isi bosuna tekrarlaniyordu.
         aktifKanallar() DEGIL state.channels: isareti kaldirilmis kanalin eski altyazisi da
         ekranda duruyor ve o da duzelmeli. */
      var listeler = [state.singleCues, state.a1Cues, state.a2Cues];
      for (var kx = 0; kx < (state.channels || []).length; kx++) {
        var kc = state.channels[kx];
        if (kc && kc.cues && kc.cues.length) listeler.push(kc.cues);
      }
      for (var li = 0; li < listeler.length; li++) {
        for (var ci = 0; ci < listeler[li].length; ci++) {
          var yeni = SZ.fixText(listeler[li][ci].text, state.dictMap);
          if (yeni !== listeler[li][ci].text) { listeler[li][ci].text = yeni; n++; }
        }
      }
    }
    if (n) { if (!$("result").hidden) redrawTranscript(); saveSession(); }
    dictStatus("✓ Kaydedildi — " + state.dict.length + " karakter" +
      (n ? ", mevcut altyazıda " + n + " satır düzeltildi" : ""), "var(--good)");
  }
  if ($("dictSave")) $("dictSave").addEventListener("click", function () { dictApply(true); });
  if ($("dictText")) $("dictText").addEventListener("blur", function () {
    if (SZ && this.value !== _dictSonMetin) dictApply(true);   // "Kaydet"e basmayı unutursan kaybolmasın
  });
  if ($("dictReset")) $("dictReset").addEventListener("click", async function () {
    if (!SZ) { dictStatus("Önizleme modunda kaydedilmez.", "var(--warn)"); return; }
    if (!(await uiConfirm("Sözlük varsayılan karakterlere (Tofi, Moni, Dora, Mimi, Niko) dönecek.\nKendi eklediklerin silinir.\n\nDevam?", "Varsayılanlar"))) return;
    state.dict = SZ.defaults(); dictFill();
    try { SZ.save(extRoot, state.dict); dictStatus("✓ Varsayılanlar yüklendi.", "var(--good)"); }
    catch (e) { dictStatus("✕ Kaydedilemedi: " + (e.message || e), "var(--bad)"); }
  });

  // transcribe() ortak seçenekleri — model/sansür + karakter sözlüğünün iki katmanı
  /* ================= SHORTS (dikey video) =================
     Dikey karede (1080x1920) satır yatayın ~yarısı kadar dar. İki şey değişir:
       1) Altyazı kısalır — kelime uzunluğuna göre 1, en fazla 2 kelime.
          Asıl belirleyici KARAKTER sınırı; sadece kelime sayısını 2'ye çekmek yetmiyor,
          "arkadaşlar hazır mısınız" gibi iki uzun token 24 karakter ediyor (ölçüldü).
       2) MOGRT'ler yatay için tasarlandığı için dikey karede yanlış yerde kalıyor;
          host'a yükseklik ve ölçek bildirilir (cue dosyasındaki "#SHORTS|" satırı).
     Sadece TEK STİL'de anlamlıdır: dikey karede üst üste katman zaten sığmaz. */
  var SHORTS_MAX_KELIME = 2;
  var SHORTS_MAX_KARAKTER = 16;

  function shortsAcik() { var c = $("chkShorts"); return !!(c && c.checked); }
  /* Cue dosyasının başına giden satır. Shorts kapalıysa BOŞ döner ve host konuma
     hiç dokunmaz — yatay videolarda eski davranış birebir sürer. */

  /* Sekans gerçekten dikey mi? Kutu işaretli ama sekans yataysa (ya da tersi) altyazı
     yanlış yere gider. Engellemiyoruz — kullanıcı bilerek yapıyor olabilir — ama söylüyoruz. */
  async function shortsSekansKontrol() {
    var u = $("shortsUyari"); if (!u) return;
    if (!shortsAcik()) { u.hidden = true; return; }
    var bilgi = null;
    try { bilgi = JSON.parse(await evalES("getSequenceInfoJSON()")); } catch (e) { bilgi = null; }
    if (!bilgi || bilgi.error || !bilgi.frameWidth || !bilgi.frameHeight) {
      u.hidden = false;
      u.textContent = "Sekans ölçüsü okunamadı — Shorts konumlandırması yine de uygulanacak.";
      return;
    }
    if (bilgi.dikey) { u.hidden = true; return; }
    u.hidden = false;
    u.textContent = "⚠ Bu sekans " + bilgi.frameWidth + "x" + bilgi.frameHeight +
      " (yatay). Shorts işaretli olduğu için altyazı dikey videoya göre konulacak — " +
      "yatay videoda yanlış yerde durur. Dikey bir sekansta çalıştığından emin ol.";
  }

  /* Shorts açıkken "Konuşmacıya Göre" kapatılır: dikey karede üst üste katmanlar sığmıyor
     ve Shorts konumlandırması yalnız Tek Stil yolunda (addMultiStyleSubtitles) uygulanıyor.
     Kullanıcı o moddayken kutuyu işaretlerse Tek Stil'e geçirilir. */

  function wireShorts() {
    var c = $("chkShorts"); if (!c) return;
    var ay = $("shortsAyar");
    /* Shorts artık YALNIZCA kelime bölmesini değiştiriyor (uzunluğuna göre 1, en fazla 2).
       Konum/boyut kaydırıcıları KALDIRILDI: altyazı Premiere'in kendi altyazı kanalına
       gidiyor ve konumu o kanalın stili belirliyor — panel oraya karışamaz. */
    function gorunum() { if (ay) ay.hidden = !c.checked; }
    function sekansKontrolSessiz() {
      // async: hata FIRLATMAZ, promise'i reddeder — düz try/catch yakalayamaz.
      try { var pk = shortsSekansKontrol(); if (pk && pk["catch"]) pk["catch"](function () {}); } catch (e) {}
    }
    c.checked = lsGet("shorts", "0") === "1";
    gorunum();
    if (c.checked && CEP) sekansKontrolSessiz();
    c.addEventListener("change", function () {
      lsSet("shorts", c.checked ? "1" : "0");
      gorunum(); sekansKontrolSessiz();
    });
  }

  /* ---------- TOFI MONI VİDEO MODU (vurucu cümle seçimi) ----------
     Kutu işaretliyken altyazı SEYRELİR: ilk 1 dakika herkesin konuşması tam yazılır (cümle
     bitmediyse 1 dakikayı aşar), sonrasında ~20 saniyede bir yalnız o aralığın en vurucu
     cümlesi yazılır. Seçimi js/vurucu.js yapıyor ve o modül Claude API'sine gidiyor —
     PANELİN İNTERNETE ÇIKTIĞI TEK YER BURASI. Kutu kapalıyken hiçbir istek gönderilmez.
     Yerel sinyallerle (ses zirvesi, ünlem, konuşma hızı) denemedik değil: kullanıcının kendi
     kaydında ölçüldü ve zayıf çıktı — ünlemli/ünlemsiz cümlede tepe ses farkı 0.1 dB,
     pencerelerin %39'unda hiç ünlem yok, konuşma hızı ters işaretli. */
  var VUR = null;
  var EMJ = null;                // js/emoji.js — emoji klasörü tarayıcı (Premiere'e dokunmaz)
  var AYNA = null;               // js/pngayna.js — sol taraf emojileri için yatay ayna (saf dosya işi)
  /* Emoji eşleme onayı — OTURUMLUK, diske YAZILMAZ. Anahtar sekans kimliği, değer eşlemenin
     imzası. Bilerek localStorage değil: sekans adları projeler arası tekrar ediyor ve kalıcı
     bir onay, başka bir projenin kararıyla bu videonun sorusunu susturabilirdi. */
  var _emojiEslemeOnay = {};
  /* Emoji yerleştirme iptali. Parça SINIRINDA okunuyor (bkz. emojiEkle döngüsü): çalışan bir
     evalScript kesilemez — o Premiere'in elinde — ama sıradaki parça hiç başlatılmaz. */
  var _emojiIptal = false;
  function vurucuAcik() { var c = $("chkVurucu"); return !!(c && c.checked); }

  /* ---------- ASLA ÜST ÜSTE GELMESİN ----------
     Her karakter kendi caption track'inde olduğu için Premiere hepsini AYNI ANDA çiziyor ve
     aynı anda konuşanların yazısı üst üste biniyor. Panel önce bitişi kırpar (bedava, senkron
     bozulmaz); kırpma yetmezse bu kutu açıkken alt sıradaki karakterin cue'su gizlenir.
     VARSAYILAN AÇIK: kullanıcı bunu açıkça istedi ("asla üst üste yazı gelmemeli") ve gerçek
     verisinde bedel düşük çıktı — 233 altyazıda 12 gizleme (%5), hiçbiri kendi sesi değil.
     KUTU HTML'DE HİÇ YOKSA (yeni app.js + eski index.html — bu projede belgelenmiş bir
     senaryo, kurulu panel junction değil KOPYA) true dönülür ama SÖYLENİR: metin düşüren bir
     davranışın kullanıcının göremediği bir yerde sessizce açık kalması yasak. */
  function cakismaGizle() {
    var c = $("chkCakisma");
    if (c) return !!c.checked;
    logLine("UYARI: “Asla üst üste gelmesin” kutusu bulunamadı (index.html eski) — " +
            "gizleme AÇIK varsayıldı, altyazı düşebilir.");
    return true;
  }

  function wireCakisma() {
    var c = $("chkCakisma"); if (!c) return;
    c.checked = (lsGet("cakismaGizle", "1") === "1");
    c.addEventListener("change", function () { lsSet("cakismaGizle", c.checked ? "1" : "0"); });
  }

  function wireVurucu() {
    var c = $("chkVurucu"); if (!c) return;
    var ay = $("vurucuAyar"), not = $("vurucuAnahtarNot");
    function gorunum() {
      if (ay) ay.hidden = !c.checked;
      if (!not) return;
      var varMi = false;
      try { varMi = !!(CEP && VUR && VUR.anahtarVarMi(extRoot)); } catch (e) { varMi = false; }
      if (varMi) { not.textContent = "✓ Yapay zekâ anahtarı kayıtlı."; not.style.color = "var(--good)"; }
      else {
        not.textContent = "⚠ Yapay zekâ anahtarı yok — Ayarlar'dan ekle, yoksa bu mod çalışmaz " +
                          "(altyazı tam hâliyle eklenir).";
        not.style.color = "var(--warn)";
      }
    }
    c.checked = (lsGet("vurucu", "0") === "1");
    c.addEventListener("change", function () { lsSet("vurucu", c.checked ? "1" : "0"); gorunum(); });
    gorunum();
  }

  /* API anahtarı kutusu (Ayarlar). Anahtarın KENDİSİ hiç ekrana yazılmaz — panel açıkken
     ekranda duran bir API anahtarı gereksiz risk (ekran kaydı, omuz üstü). Yalnız "kayıtlı"
     bilgisi ve son 4 hane gösterilir. */
  function wireApiKey() {
    var inp = $("apiKeyText"), sv = $("apiKeySave"), cl = $("apiKeyClear"), st = $("apiKeyStatus");
    if (!inp || !sv) return;
    function durum(msg, renk) { if (st) { st.textContent = msg || ""; st.style.color = renk || "var(--muted)"; } }
    function tazele() {
      if (!CEP || !VUR) { durum("önizleme modu"); return; }
      var k = "";
      try { k = VUR.anahtarOku(extRoot); } catch (e) { k = ""; }
      if (k) { inp.placeholder = "kayıtlı (••••" + k.slice(-4) + ") — değiştirmek için yeni anahtar yaz"; durum("✓ kayıtlı", "var(--good)"); }
      else { inp.placeholder = "sk-ant-…"; durum("anahtar yok", "var(--warn)"); }
    }
    sv.addEventListener("click", function () {
      if (!CEP || !VUR) { durum("Premiere'de çalışır", "var(--warn)"); return; }
      var v = String(inp.value || "").trim();
      if (!v) { durum("boş — yazılmadı", "var(--warn)"); return; }
      try { VUR.anahtarYaz(extRoot, v); inp.value = ""; tazele(); durum("✓ kaydedildi", "var(--good)"); }
      catch (e) { durum("yazılamadı: " + (e.message || e), "var(--bad)"); }
    });
    if (cl) cl.addEventListener("click", function () {
      if (!CEP || !VUR) return;
      try { VUR.anahtarYaz(extRoot, ""); } catch (e) {}
      inp.value = ""; tazele(); durum("silindi");
    });
    tazele();
  }

  /* PRESET BÖLÜMÜ — #viewPreset (host.jsx: efektListesiJSON · efektUygula · animasyonUygula).
     İki ayrı yol var, ikisi de burada:
       1. Premiere'in efekt/preset listesi — kullanıcı kendi preset'lerini BİR KEZ işaretler,
          düğme olurlar. **Liste KLASÖR BİLGİSİ VERMİYOR** (`getVideoEffectList` düz bir
          dizi), yani "yusufwrl bin'indekiler" diye otomatik süzmek MÜMKÜN DEĞİL — bin'i
          kullanıcı bir kez seçerek söylüyor, panel `preset.secili`de hatırlıyor.
       2. Panelin kendi yazdığı animasyon (Pop In) — preset dosyasından bağımsız,
          keyframe'leri host.jsx üretiyor, her zaman çalışır. */
  var _efektler = [];        // ham liste — DİZİDEKİ SIRA host'a gönderilen anahtar
  var _presetSecili = [];    // kullanıcının düğmeye çıkardığı adlar (localStorage)

  /* İLK AÇILIŞ VARSAYILANI — kullanıcının Premiere'deki "Yusufwrl" bin'indeki preset
     adları (kullanıcı bin'in ekran görüntüsünü verdi, 6 Ağustos 2026). Bin sırası korundu.
     Bu adlar Premiere'in efekt listesinde YOKSA düğmeler devre dışı + "(listede yok)"
     görünür — yani preset'lerin API'ye görünüp görünmediği sorusunu da bu liste cevaplar. */
  var PRESET_VARSAYILAN = [
    "Aşağıya Pop Out", "Cinematic Border In", "Cinematic Border Out",
    "Pop In 1", "Pop In RGB", "Yukarıya Pop In", "Zoom In Center", "Zoom Out Center"
  ];
  /* "Hiç yazılmamış" ile "boşaltılmış" AYRI: kullanıcı bütün düğmeleri kaldırdıysa
     varsayılanlar geri gelmemeli, yoksa sildiği düğmeler her açılışta dirilir. */
  function presetSeciliOku() {
    var ham = lsGet("preset.secili", "");
    if (!ham) return PRESET_VARSAYILAN.slice(0);
    try { var a = JSON.parse(ham); return (a && a.length) ? a : []; }
    catch (e) { return PRESET_VARSAYILAN.slice(0); }
  }
  function presetSeciliYaz() { lsSet("preset.secili", JSON.stringify(_presetSecili)); }

  /* ÖĞRETİLMİŞ AMA KARTI OLMAYAN PRESET'LERİ LİSTEYE AL — KENDİ KENDİNİ ONARAN ADIM.
     ⚠ KULLANICININ GÖRDÜĞÜ HATA TAM OLARAK BUYDU (8 Ağustos 2026, ekran görüntüsüyle):
     `presetler.json`'ında "Emoji Sağ Taraf" ve "Camera Shake 1" öğretilmiş olarak duruyordu
     ama ekranda KARTLARI YOKTU — yani erişilemez bir kayıt. Sebep varsayilanlariKur'un preset
     bloğunun "kullanıcının kendi presetler.json'ı varsa HİÇ çalışma" kuralı: o blok aynı
     zamanda paket adlarını `preset.secili`ye ekliyordu, dolayısıyla pakete SONRADAN eklenen
     hiçbir preset mevcut kullanıcıya ulaşmıyordu. Emoji resimlerindeki "üzerine yazma"
     tuzağının birebir aynısı — aynı hatanın iki ayrı yerdeki hâli.
     ÇÖZÜM PAKETE DEĞİL VERİYE BAKIYOR: öğretilmiş bir yığının kartı yoksa o yığın kullanılamaz
     demektir, kartı geri koy. Bu, paket büyüdükçe kendiliğinden doğru kalır.
     "Bilerek kaldırdığım kart geri geliyor" durumu OLUŞMAZ: presetKaldir hem adı hem yığını
     birlikte siliyor (bkz. orası), yani kartsız yığın yalnız bu hatadan doğabiliyor. */
  function presetSeciliTazele() {
    var yig = {}, ad, eklenen = [];
    try { yig = presetYiginlar() || {}; } catch (e) { return; }
    for (ad in yig) {
      if (!Object.prototype.hasOwnProperty.call(yig, ad)) continue;
      if (_presetSecili.indexOf(ad) === -1) { _presetSecili.push(ad); eklenen.push(ad); }
    }
    if (!eklenen.length) return;
    presetSirala();
    presetSeciliYaz();
    logLine("Öğretilmiş ama kartı olmayan preset'ler listeye eklendi: " + eklenen.join(", "));
  }
  function efektSira(ad) {
    for (var i = 0; i < _efektler.length; i++) if (_efektler[i] === ad) return i;
    return -1;
  }
  function durumYaz(msg, renk) {
    var st = $("animStatus");
    if (st) { st.textContent = msg || ""; st.style.color = renk || "var(--muted)"; }
  }
  /* Host'tan gelen sonucu tek yerden yorumla: "ok:" ile başlamayan her şey hatadır.
     Host kısmi başarıyı da "ok:" içinde bildiriyor ("N klipte OLMADI"), o yüzden mesajın
     TAMAMI gösteriliyor — yarısı uygulanmış bir işi "başarılı" diye yutmak en kötüsü. */
  function sonucGoster(etiket, r) {
    logLine(etiket + ": " + r);
    if (r.indexOf("ok:") !== 0) { durumYaz(r.replace(/^err:/, ""), "var(--bad)"); return; }
    /* KISMİ BAŞARI YEŞİL DEĞİL SARI. Host "3/20 klibe uygulandı — 17 klipte OLMADI" diyor;
       bunu yeşil göstermek, render'dan sonra fark edilen en pahalı hataya davetiye. */
    var govde = r.slice(3);
    var kismi = (govde.indexOf("OLMADI") !== -1) || (govde.indexOf("UYARI") !== -1) ||
                (govde.indexOf("öğretilmiş kayıt YOK") !== -1) ||
                /* Atlanan klipler de YEŞİL görünmemeli: host "kafanin disinda"/"atlandi"
                   diyen klipleri paydadan düşürüyor, yani "1/1 uygulandı" yazıp 4 klibi
                   sessizce atlayabilir. */
                (govde.indexOf("kafanin disinda") !== -1) || (govde.indexOf("atlandi") !== -1);
    durumYaz((kismi ? "⚠ " : "✓ ") + govde, kismi ? "var(--warn)" : "var(--good)");
  }
  /* PRESET ADI → PANELİN KENDİ ANİMASYONU.
     ÖLÇÜLDÜ (6 Ağustos 2026): kullanıcının preset'leri Premiere'in script kataloglarının
     HİÇBİRİNDE yok — `getVideoEffectList` 148 öğe döndürdü ve hepsi yerleşik efekt.
     Yani preset dosyalarını uygulamanın yolu kapalı; kullanıcının her preset'i tek tek
     panel animasyonu olarak host.jsx'te YENİDEN YAZILIYOR. Bu tablo o eşlemedir.
     Yeni bir tanesini yazınca buraya bir satır eklenir. */
  var PRESET_ANIM = { "Pop In 1": "popin" };

  /* ÖĞRENİLMİŞ YIĞIN — preset'in bir klipten okunmuş hali (bileşenler + parametreler +
     keyframe'ler). Preset dosyaları script'e görünmediği ve panel Effects panelinden
     sürükleme yapamadığı için TEK gerçek yol bu: kullanıcı bir kez elle uygular, panel
     klipten okur, sonra sınırsız tekrarlar. */
  /* ÖĞRENİLMİŞ YIĞINLAR DOSYADA — localStorage'da DEĞİL.
     Sebep: her preset için kullanıcı Premiere'de elle bir sürükleme yapıyor; bu veri
     pahalı ve BAŞKA KAYNAĞI YOK. localStorage CEF'in önbelleğinde durur (panel klasöründe
     değil), yani kullanıcı dosyaları korumasının dışında kalır ve Premiere sürüm
     yükseltmesinde/önbellek temizliğinde sessizce gider. `presetler.json` ise beş listede
     korunuyor (bkz. CLAUDE.md — Kullanıcı dosyaları). */
  /* ---------- HAZIR İÇERİK KURULUMU (varsayilan\ klasörü) ----------
     Amaç: panel BAŞKA BİR MAKİNEDE de dolu gelsin — arkadaş kurunca preset'ler öğretilmiş,
     Track Style'lar Premiere'de görünür olsun.
     İKİ KURAL:
       1. ÜZERİNE ASLA YAZMA. Kullanıcının kendi presetleri/stilleri varsa dokunulmaz;
          yalnızca EKSİK olan konur. (presetler.json zaten korunan dosya listesinde.)
       2. Sessiz kalma. Ne kurulduğu log'a yazılır.
     Stil dosyaları pakette ASCII adla (stil01.prtextstyle) durur ve gerçek adları
     stiller.json'dan okunur — zip'e Türkçe dosya adı koymak bozulma riski taşıyor. */
  function belgelerAdayKlasorleri() {
    var h = process.env.USERPROFILE || process.env.HOME || "";
    if (!h) return [];
    return [path.join(h, "Documents"), path.join(h, "Belgeler"),
            path.join(h, "OneDrive", "Documents"), path.join(h, "OneDrive", "Belgeler")];
  }
  /* Premiere'in Track Style klasörü. Windows'ta "Belgeler" OneDrive'a yönlendirilmiş
     olabiliyor ve adı dile göre değişiyor — bu yüzden adaylar taranır ve İÇİNDE Adobe\Common
     OLAN tercih edilir (Premiere'in gerçekten kullandığı yol odur). */
  function stilKlasoruBul() {
    var adaylar = belgelerAdayKlasorleri(), i, p;
    for (i = 0; i < adaylar.length; i++) {          // 1. tercih: Adobe\Common zaten var
      p = path.join(adaylar[i], "Adobe", "Common");
      try { if (fs.existsSync(p)) return path.join(p, "Assets", "Text Styles"); } catch (e) {}
    }
    for (i = 0; i < adaylar.length; i++) {          // 2. tercih: Belgeler klasörü var
      try { if (fs.existsSync(adaylar[i])) return path.join(adaylar[i], "Adobe", "Common", "Assets", "Text Styles"); } catch (e2) {}
    }
    return "";
  }
  function varsayilanlariKur() {
    if (!CEP) return;
    /* ⚠ LİSANS KAPISININ ARKASINDA. Bu fonksiyon wirePreset() üzerinden çağrılıyor ve
       wirePersistence() lisans kapısı çözülmeden SENKRON olarak çalışıyor; kontrol
       olmasaydı kod hiç girilmeden preset'ler kullanıcının presetler.json'una ve Track
       Style'lar Belgeler klasörüne kurulurdu — yani kilitli panel içeriği teslim ederdi.
       LIS yoksa (tarayıcı önizlemesi / lisans modülü olmayan eski kurulum) eski davranış
       sürer: kurulum yapılır. */
    try {
      if (LIS && LIS.durumOku && LIS.durumOku(extRoot).durum !== "acik") return;
    } catch (eLk) {}
    var kok = path.join(extRoot, "varsayilan");
    try { if (!fs.existsSync(kok)) return; } catch (e0) { return; }

    // 1) Preset'ler — yalnız kullanıcının hiç kaydı yoksa
    try {
      var hedef = presetDosyaYolu();
      if (!fs.existsSync(hedef)) {
        /* DOSYA ADI BİLEREK "presetler.json" DEĞİL — ADI DEĞİŞTİRME.
           Korunan kullanıcı dosyalarını atlayan üç mekanizma da adı KLASÖR FARK ETMEKSİZİN
           eşliyor (.gitignore · pack-panel.ps1 · updater.js copyDir). Aynı adı kullanınca
           paketteki hazır dosya üçünde de sessizce eleniyor ve arkadaşın panelinde
           preset'ler boş geliyordu. Farklı ad bu sınıfın tamamını kökten çözüyor —
           üstelik ARKADAŞTAKİ ESKİ updater.js için de çalışır (güncellemeyi onun
           makinesindeki eski kod yapıyor, bizim düzeltmemiz ona sonra ulaşıyor). */
        var kaynak = path.join(kok, "preset-paketi.json");
        if (fs.existsSync(kaynak)) {
          fs.writeFileSync(hedef, fs.readFileSync(kaynak));
          _presetYigin = null;   // yeniden okunsun
          var ad = Object.keys(presetYiginlar());
          logLine("Hazır preset'ler kuruldu (" + ad.length + "): " + ad.join(", "));
          /* ⚠ İLK KURULUMDA PAKET ADLARI TEK KAYNAK — PRESET_VARSAYILAN İLE BİRLEŞTİRME.
             Eskiden presetSeciliOku() çağrılıyordu; localStorage boşken o PRESET_VARSAYILAN
             döndürüyor ve paket adları ONUN ÜSTÜNE ekleniyordu. PRESET_VARSAYILAN eski bir
             TAHMİN listesi (kullanıcının bin ekran görüntüsünden yazılmıştı) ve içinde artık
             var olmayan adlar duruyor — ParsMazi'de tam olarak bu oldu: 8 paket preset'i
             yerine 10 kart çıktı, ikisi ("Cinematic Border Out", "Zoom Out Center") hiçbir
             kayda karşılık gelmiyordu ve basınca boş uygulanıyordu. Kullanıcı bunu
             "preset'ler eski gelmiş" diye bildirdi — gerçek sebep buydu.
             Kullanıcının KENDİ seçimi varsa (localStorage dolu) ona dokunulmuyor. */
          var seciliHam = lsGet("preset.secili", "");
          if (!seciliHam) {
            _presetSecili = ad.slice(0);
          } else {
            _presetSecili = presetSeciliOku();
            ad.forEach(function (a) { if (_presetSecili.indexOf(a) === -1) _presetSecili.push(a); });
          }
          presetSeciliYaz();
        }
      }
    } catch (e1) { logLine("Hazır preset kurulamadı: " + (e1.message || e1)); }

    /* 2) TRACK STYLE'LAR — KENDİ FONKSİYONUNDA.
       ⚠ İÇİNDEKİ `return`'LER EMOJİ KURULUMUNU ÖLDÜRÜYORDU. Bu blok üç yerde `return`
       ediyor (stiller.json yok · liste boş · Belgeler klasörü bulunamadı) ve hepsi
       varsayilanlariKur'un TAMAMINDAN çıkıyordu — yani 3. adım (46 emoji PNG'sinin kurulumu)
       hiç çalışmıyordu. stilKlasoruBul yalnız dört adayı deniyor (Documents · Belgeler ·
       OneDrive\Documents · OneDrive\Belgeler); Belgeler klasörü başka bir sürücüye
       taşınmış ya da iş/okul OneDrive'ı olan bir makinede BOŞ dönüyor.
       Sonuç: o kullanıcıda emojiler HİÇ kurulmuyordu ve tek iz katlanmış log'daki
       "Track Style klasörü bulunamadı" satırıydı. İkinci kullanıcının "emoji gelmedi"
       şikâyetinin en olası sebebi buydu.
       Fonksiyona alınca `return` yalnız STİL adımından çıkıyor; emoji adımı her hâlükârda
       çalışıyor. ⚠ Buraya yeni bir adım eklerken aynı tuzağa düşme: adımlar birbirinden
       BAĞIMSIZ olmalı. */
    (function stilleriKur() {
    try {
      var manYol = path.join(kok, "stiller.json");
      if (!fs.existsSync(manYol)) return;
      var man = JSON.parse(String(fs.readFileSync(manYol, "utf8")).replace(/^﻿/, ""));
      if (!man || !man.length) return;
      var klasor = stilKlasoruBul();
      if (!klasor) { logLine("Track Style klasörü bulunamadı — stiller kurulmadı."); return; }
      pipeline.ensureDir(klasor);
      var kondu = [], sBasarisiz = 0;
      man.forEach(function (s) {
        try {
          var src = path.join(kok, "stiller", s.dosya), dst = path.join(klasor, s.ad);
          if (!fs.existsSync(src) || fs.existsSync(dst)) return;   // ÜZERİNE YAZMA
          fs.writeFileSync(dst, fs.readFileSync(src));
          kondu.push(s.ad.replace(/\.prtextstyle$/i, ""));
        } catch (eS) { sBasarisiz++; }   // sessiz yutma: aşağıda sayılıp bildiriliyor
      });
      /* ⚠ MESAJ "Text > Track Style altında görünür" DEMİYOR — o yanlış yere yolluyordu.
         Premiere'in Style listesi yalnız PROJE öğelerini gösteriyor; stiller Belgeler
         klasörüne kurulsa bile listede çıkmıyor. Doğru adım "Stilleri projeye ekle"
         düğmesi (v1.9.2 tam bu yüzden eklenmişti). */
      if (kondu.length) logLine("Track Style kuruldu (" + kondu.length + "): " + kondu.join(", ") +
                                " — Premiere'de görünmesi için Altyazı ekranındaki " +
                                "“Stilleri projeye ekle” düğmesine bas (her yeni projede bir kez).");
      /* ⚠ YAZILAMAYAN STİL SESSİZ KALMAZ — `kondu` bloğundan BAĞIMSIZ satır.
         Her dosyanın hatası boş catch'e gidiyordu ve `kondu` boş kalınca tek bir log satırı
         bile çıkmıyordu: "hepsi zaten kuruluydu" ile "hiçbiri yazılamadı" ayırt edilemiyordu.
         Belgeler klasörü OneDrive tarafından kilitliyse 6 stilin hiçbiri yazılmıyor, kullanıcı
         Premiere'de hazır stilleri bulamıyor ve ne kendisi ne destek veren sebebi görebiliyor.
         Emoji adımı bu deseni (eBasarisiz sayacı) zaten kullanıyor — burada eksikti. */
      if (sBasarisiz) logLine("⚠ Track Style: " + sBasarisiz + " stil dosyası YAZILAMADI (" + klasor +
                              ") — klasör salt okunur ya da OneDrive tarafından kilitli olabilir.");
      else if (!kondu.length) logLine("Track Style: hepsi zaten kurulu.");
    } catch (e2) { logLine("Track Style kurulamadı: " + (e2.message || e2)); }
    })();

    /* 3) EMOJİ RESİMLERİ — motor kökü altına, yalnız o dosya YOKSA.
       Paket içinde adlar ASCII (emoji01.png…), gerçek adlar emoji-paketi.json'da: zip'e
       Türkçe karakterli ad koymak bozulma riski taşıyor ve emoji adı BİLGİ taşıyor —
       panel "<Duygu> <Karakter>.png" kalıbından duygu ve karakteri türetiyor, ad bozulursa
       emoji sessizce yanlış karaktere bağlanır. Stiller için kanıtlanmış aynı desen. */
    try {
      /* ⚠ HEDEF, PANELİN GERÇEKTEN OKUDUĞU KLASÖR OLMALI. Eskiden koşulsuz
         emojiKlasorVarsayilan() (motor kökü altı) kullanılıyordu; ama emoji ÖZELLİĞİ
         #emojiKlasor kutusundaki yoldan okuyor. İkisi ayrışabiliyor ve ayrışınca kurulum
         bir klasöre gidiyor, okuma başkasından oluyor — panel "kuruldu" diyor, kullanıcı
         "güncelleme gelmedi" diyor ve ikisi de haklı. ParsMazi'de bu gerçek bir risk:
         motor RAR'ı "-teslim" ekiyle açıldığı için makinesinde İKİ motor klasörü var.
         Kayıtlı seçim varsa O kullanılır; yoksa eskisi gibi motor kökü altı. */
      var eMan = path.join(kok, "emoji-paketi.json");
      if (fs.existsSync(eMan)) {
        var eList = JSON.parse(String(fs.readFileSync(eMan, "utf8")).replace(/^﻿/, ""));
        var eHedef = String(lsGet("emoji.klasor", "")).trim() || emojiKlasorVarsayilan();
        if (eList && eList.length && eHedef) {
          pipeline.ensureDir(eHedef);
          /* eBasarisiz: OneDrive/antivirüs kilidi, salt okunur dosya, disk dolu… Eskiden
             `catch (eE) {}` bunları SAYISIZ yutuyordu: 46 resmin 6'sı kurulamasa panel yine
             "kuruldu (40)" diyordu ve o 6 tepki yapay zekâ listesine hiç girmiyordu. */
          var eKondu = 0, eVar = 0, eYeni = 0, eKorunan = 0, eYedek = 0, eBasarisiz = 0, eYeniAd = [];
          /* ⚠ "DOSYA VARSA HİÇ DOKUNMA" KURALI BİR GÜNCELLEMEYİ SESSİZCE YUTUYORDU.
             Kural yeni AD eklemek için doğruydu (kullanıcının kendi resimlerini ezmesin) ama
             AYNI ADLA DÜZELTİLMİŞ bir resmi kimseye ulaştırmıyordu. Gerçekte oldu: kullanıcı
             8 Tofi resmini yeniden kaydetti (CLAUDE.md'de yazan "sol kenarı kesik" sorunu) —
             ne sürüm çıkarmak ne yeniden kurmak o düzeltmeyi motor klasörüne taşıyordu, çünkü
             dosya adları aynıydı. Panel "zaten kurulu (30)" deyip geçiyordu.
             ÇÖZÜM — panelin KENDİ kurduğu dosyaların kaydını tut (.panel-emoji.json: ad→boyut):
               · hedefte yok            → kur
               · boyut aynı             → zaten güncel, dokunma
               · boyut farklı + kaydımızdaki boyutla eşleşiyor (yani kurduğumuzdan beri
                 DEĞİŞTİRİLMEMİŞ)       → paketteki yeni hâliyle TAZELE
               · boyut farklı + kaydımızla da uyuşmuyor (kullanıcı elle değiştirmiş) → KORU
             Kayıt dosyası hiç yoksa (bu sürümden önce kurulmuş panel) dosyalar "bizim" sayılır:
             emoji klasörü panelin yönettiği bir önbellek, kullanıcının kaynak klasörü ise
             Youtube\Edit\Emoji. Tazelenen her ad log'a ADIYLA yazılır — sessiz değişiklik yok.
             Ad başında NOKTA var: js/emoji.js tara() yalnız *.png okuduğu için zaten atlanırdı,
             nokta ayrıca kullanıcının klasörde "bu ne?" demesini engelliyor. */
          var izYol = path.join(eHedef, ".panel-emoji.json"), iz = {}, izVarMi = false, izK;
          try {
            if (fs.existsSync(izYol)) iz = JSON.parse(String(fs.readFileSync(izYol, "utf8")).replace(/^﻿/, "")) || {};
          } catch (eIz) { iz = {}; }
          for (izK in iz) { if (Object.prototype.hasOwnProperty.call(iz, izK)) { izVarMi = true; break; } }
          eList.forEach(function (x) {
            try {
              var src = path.join(kok, "emoji", x.dosya), dst = path.join(eHedef, x.ad);
              if (!fs.existsSync(src)) return;
              var sBoy = fs.statSync(src).size;
              if (!fs.existsSync(dst)) {
                fs.writeFileSync(dst, fs.readFileSync(src));
                iz[x.ad] = sBoy; eKondu++; return;
              }
              var dBoy = fs.statSync(dst).size;
              if (dBoy === sBoy) { eVar++; iz[x.ad] = sBoy; return; }   // içerik zaten aynı
              if (izVarMi && iz[x.ad] !== dBoy) { eKorunan++; return; } // kullanıcı elle değiştirmiş
              /* ⚠ İZ DOSYASI YOKKEN (bu sürümden ÖNCE kurulmuş HER panel) "bizim mi, kullanıcının
                 mı" ayrımı yapılamıyor — o yüzden üzerine yazılıyor. Bu, düzeltilmiş resimlerin
                 herkese ulaşması için gerekli AMA kullanıcının kendi çizdiği bir resmi de
                 götürebilir. ParsMazi'de emoji klasörü "kaynak klasör" gibi kullanılıyor
                 olabilir (panel o yolu kendisi yazıp "Emoji klasörü" diye gösteriyor), yani
                 varsayım yalnız geliştiricinin makinesinde güvenli.
                 ÇÖZÜM: ezmeden ÖNCE eskisini <Emoji>\eski\ altına al. Alt klasör olduğu için
                 emoji taraması onu görmez (tara() yalnız ana klasörü okur) ve kullanıcı
                 isterse elle geri koyabilir. Bir defalık, 30 dosyalık bir yedek. */
              if (!izVarMi) {
                try {
                  var yKlasor = path.join(eHedef, "eski");
                  if (!fs.existsSync(yKlasor)) fs.mkdirSync(yKlasor);
                  var yHedef = path.join(yKlasor, x.ad);
                  if (!fs.existsSync(yHedef)) fs.writeFileSync(yHedef, fs.readFileSync(dst));
                  eYedek++;
                } catch (eY) {}
              }
              fs.writeFileSync(dst, fs.readFileSync(src));
              iz[x.ad] = sBoy; eYeni++;
              if (eYeniAd.length < 8) eYeniAd.push(x.ad.replace(/\.png$/i, ""));
            } catch (eE) { eBasarisiz++; }
          });
          /* ── PAKETTEN ÇIKARILMIŞ DOSYALARI TOPLA (yeniden adlandırma artığı) ──
             ⚠ SESSİZ HAYALET DUYGU SORUNU: kullanıcı bir emojiyi yeniden adlandırınca paket
             yeni adı getiriyor ama ESKİ ad hedefte kalıyordu (kur yalnız ekliyor, hiç
             silmiyordu). Panel duygu kümesini KLASÖRDEN türettiği için silinmiş olması
             gereken duygu hâlâ listede duruyor ve yapay zekâya seçenek olarak gidiyor —
             kullanıcı temizlik yapıyor, panel temizliği geri alıyor.
             SİLMEK YERİNE TAŞI: <Emoji>\eski\ altına alınır (alt klasör olduğu için tara()
             görmez) ve kullanıcı isterse geri koyar. Yalnız ŞU ÜÇÜ birden doğruysa taşınır:
               1) izde var  → o dosyayı PANEL kurmuştu, kullanıcının kendi resmi değil
               2) boyutu izdekiyle aynı → kurduğumuzdan beri DEĞİŞTİRİLMEMİŞ
               3) paketin yeni listesinde yok → gerçekten çıkarılmış
             Üçünden biri tutmazsa dosyaya DOKUNULMAZ. */
          var paketAd = {}, eskiye = [], izAd;
          eList.forEach(function (x) { paketAd[x.ad] = 1; });
          for (izAd in iz) {
            if (!Object.prototype.hasOwnProperty.call(iz, izAd)) continue;
            if (paketAd[izAd]) continue;                       // hâlâ pakette
            try {
              var esk = path.join(eHedef, izAd);
              if (!fs.existsSync(esk)) { delete iz[izAd]; continue; }
              if (fs.statSync(esk).size !== iz[izAd]) continue;  // kullanıcı değiştirmiş → dokunma
              var eKla = path.join(eHedef, "eski");
              if (!fs.existsSync(eKla)) fs.mkdirSync(eKla);
              var eHed = path.join(eKla, izAd);
              if (fs.existsSync(eHed)) fs.unlinkSync(eHed);
              fs.renameSync(esk, eHed);
              delete iz[izAd];
              eskiye.push(izAd.replace(/\.png$/i, ""));
            } catch (eEs) {}
          }
          if (eskiye.length) logLine("Emoji: paketten çıkarılmış " + eskiye.length +
                                     " resim “eski” klasörüne taşındı (" + eskiye.join(", ") +
                                     ") — yeniden adlandırılmış olabilirler.");
          try { fs.writeFileSync(izYol, JSON.stringify(iz), "utf8"); } catch (eIw) {}
          if (eYeni) logLine("Emoji resimleri TAZELENDİ (" + eYeni + "): " + eYeniAd.join(", ") +
                             (eYeni > eYeniAd.length ? " …" : "") + " — düzeltilmiş hâlleri kuruldu." +
                             (eYedek ? (" Eskileri " + path.join(eHedef, "eski") + " klasörüne alındı.") : ""));
          if (eKorunan) logLine("Emoji: " + eKorunan + " resim elle değiştirilmiş, korundu (paketteki hâli yazılmadı).");
          if (eBasarisiz) logLine("⚠ Emoji: " + eBasarisiz + " resim KURULAMADI (klasör yazılamıyor olabilir — " +
                                  "OneDrive kilidi, antivirüs ya da salt okunur klasör). Bu tepkiler videoda hiç çıkmaz.");
          /* Ayarı da doldur: kullanıcı klasörü elle bulmak zorunda kalmasın. Kayıtlı bir
             seçim VARSA dokunulmaz — kendi klasörünü seçmiş olabilir. */
          if (eKondu && !lsGet("emoji.klasor", "")) lsSet("emoji.klasor", eHedef);
          if (eKondu) logLine("Emoji resimleri kuruldu (" + eKondu + "): " + eHedef);
          else if (eVar) logLine("Emoji resimleri zaten kurulu (" + eVar + ").");
        }
      }
    } catch (e3) { logLine("Emoji resimleri kurulamadı: " + (e3.message || e3)); }
  }

  /* ── EMOJİ KLASÖRÜ DURUMU — "güncelleme geldi ama yeni emojiler yok" SESSİZ KALMASIN ──
     ⚠ NEDEN VAR: panel emoji resimlerini bir klasöre KURUYOR, emoji özelliği ise başka bir
     kutudan (#emojiKlasor) OKUYOR. İkisi ayrışırsa kurulum bir yere gider, okuma başka
     yerden olur ve panel hiçbir şey söylemez — kullanıcı "güncelleme gelmedi" der, panel
     "kuruldu" der, ikisi de haklıdır. ParsMazi'de bu somut bir risk: motor RAR'ı "-teslim"
     ekiyle açıldığı için makinesinde İKİ motor klasörü var.
     Bu satır paneldeki resim sayısını PAKETTEKİ sayıyla yan yana koyuyor; tutmuyorsa
     "Emojileri Yeniden Kur" düğmesi tek tıkla çözüyor. */
  function emojiPaketSayisi() {
    try {
      var m = path.join(extRoot, "varsayilan", "emoji-paketi.json");
      if (!fs.existsSync(m)) return 0;
      var j = JSON.parse(String(fs.readFileSync(m, "utf8")).replace(/^﻿/, ""));
      return (j && j.length) || 0;
    } catch (e) { return 0; }
  }
  function emojiKlasorDurumYaz() {
    var el = $("emojiKlasorDurum"); if (!el) return;
    function yaz(m, renk) { el.textContent = m; el.style.color = renk || "var(--muted)"; }
    var kok = String(($("emojiKlasor") || {}).value || "").trim();
    if (!kok) { yaz("Emoji klasörü seçilmedi.", "var(--warn)"); return; }
    if (!EMJ) { yaz("emoji.js yüklenemedi — paneli yeniden kur.", "var(--bad)"); return; }
    var t = null;
    try { t = EMJ.tara(kok); } catch (e) { t = null; }
    if (!t || t.hata) { yaz("Klasör okunamadı: " + ((t && t.hata) || "bilinmeyen hata"), "var(--bad)"); return; }
    var paketSay = emojiPaketSayisi();
    var ozet = t.dosyalar.length + " resim · " + t.karakterler.length + " karakter (" +
               t.karakterler.map(function (k) { return k.ad; }).join(", ") + ") · " +
               t.duygular.length + " tepki";
    if (paketSay && t.dosyalar.length < paketSay) {
      yaz("⚠ " + ozet + " — pakette " + paketSay + " resim var, " + (paketSay - t.dosyalar.length) +
          " tanesi bu klasörde YOK. “Emojileri Yeniden Kur”a bas.", "var(--warn)");
    } else {
      yaz("✓ " + ozet + (paketSay ? (" · paketle uyumlu") : ""), "var(--muted)");
    }
  }

  var _presetYigin = null;
  var _presetKurtarildi = "";   // yedekten kurtarıldıysa açılışta kullanıcıya SÖYLENİR
  function presetDosyaYolu() { return path.join(extRoot, "presetler.json"); }
  function presetYedekYolu() { return path.join(extRoot, "presetler.bak.json"); }
  /* Tek dosyayı oku ve DOĞRULA. null = kullanılamaz (yok/boş/bozuk/yanlış tip). */
  function presetDosyaOku(p) {
    try {
      if (!fs.existsSync(p)) return null;
      // BOM temizliği (sozluk.js/kisiler.js'te olan koruma burada eksikti)
      var ham = String(fs.readFileSync(p, "utf8")).replace(/^﻿/, "");
      if (!ham) return null;
      var j = JSON.parse(ham);
      /* TİP DOĞRULAMASI ŞART: `JSON.parse("[]") || {}` diziyi geçiriyordu. Diziye adlı
         özellik eklemek yasal ama JSON.stringify onları ATIYOR — yazma "başarılı"
         döner, dosyada hâlâ `[]` kalır, panel "öğrenildi" der, açılışta hiçbir şey yok. */
      if (j && typeof j === "object" && Object.prototype.toString.call(j) !== "[object Array]") return j;
      return null;
    } catch (e) { return null; }
  }
  function presetYiginlar() {
    if (_presetYigin) return _presetYigin;
    _presetYigin = {};
    if (!CEP) return _presetYigin;
    var ana = presetDosyaOku(presetDosyaYolu());
    if (ana) {
      _presetYigin = ana;
    } else {
      /* Ana dosya yok/bozuk → YEDEKTEN kurtar. Sessizce boş başlamak, tek bir yeni
         öğretmeyle kalan presetleri kalıcı silmek demekti. */
      /* Kurtarma adayları sırayla: .bak → .bak.yeni → .tmp. Son ikisi yarıda kalmış bir
         yazmadan artakalan ama SAĞLAM olabilen dosyalar (bkz. presetYiginlarYaz). */
      var yed = presetDosyaOku(presetYedekYolu()) ||
                presetDosyaOku(presetYedekYolu() + ".yeni") ||
                presetDosyaOku(presetDosyaYolu() + ".tmp");
      if (yed) {
        _presetYigin = yed;
        _presetKurtarildi = "presetler.json okunamadı — YEDEKTEN kurtarıldı (" +
                            Object.keys(yed).length + " preset).";
        logLine(_presetKurtarildi);
      } else if (fs.existsSync(presetDosyaYolu())) {
        logLine("presetler.json beklenen biçimde değil ve yedek de yok — sıfırdan başlanıyor.");
      }
    }
    /* localStorage'da kalmış eski kayıtları BİR KEZ taşı — feature ilk sürümünde oraya
       yazıyordu. ÖNEK TARAMASI ŞART: eskiden yalnız 8 varsayılan ad taranıyordu, oysa
       kullanıcı serbest ad ekleyebiliyor ve varsayılanı yeniden adlandırabiliyor —
       o kayıtlar sessizce kayboluyordu. */
    var tasindi = 0, bozuk = 0, k, anahtar, ad, eski;
    try {
      for (k = 0; k < localStorage.length; k++) {
        anahtar = localStorage.key(k);
        if (!anahtar || anahtar.indexOf("yw.presetYigin.") !== 0) continue;
        ad = anahtar.slice("yw.presetYigin.".length);
        if (!ad || _presetYigin[ad]) continue;
        eski = localStorage.getItem(anahtar);
        if (!eski) continue;
        try { _presetYigin[ad] = JSON.parse(eski); tasindi++; } catch (e2) { bozuk++; }
      }
    } catch (e3) {}
    if (tasindi) { presetYiginlarYaz(); logLine(tasindi + " öğrenilmiş preset dosyaya taşındı."); }
    if (bozuk) logLine(bozuk + " eski preset kaydı okunamadı (bozuk JSON).");
    return _presetYigin;
  }
  function presetYiginlarYaz() {
    if (!CEP) return false;
    /* ATOMİK YAZMA + YEDEK. presetler.json panelin EN PAHALI verisi: her preset için
       Premiere'de elle bir sürükleme yaptın, başka kaynağı YOK. Eskiden tek hamlede
       üzerine yazılıyordu — yazma yarıda kalırsa (OneDrive kilidi, Premiere çökmesi)
       dosya boşalıyor, panel hiçbir uyarı vermeden hepsini "öğretilmemiş" gösteriyor ve
       tek bir yeni öğretme kalanları kalıcı siliyordu.
       Sıra: önce .tmp'ye yaz → mevcut dosyayı .bak'a al → tmp'yi rename ile üzerine koy. */
    var p = presetDosyaYolu(), tmp = p + ".tmp", bak = presetYedekYolu(), bakYeni = bak + ".yeni";
    try {
      fs.writeFileSync(tmp, JSON.stringify(_presetYigin), "utf8");
      if (fs.existsSync(p)) {
        /* SIRA KRİTİK: eski dosyayı önce GEÇİCİ bir yedeğe al, sonra ANA dosyayı kur,
           yedeği en son yerine koy. Böylece hiçbir anda "ne ana dosya ne yedek" durumu
           oluşmaz. (Önceki sıralamada bak silinip rename patlarsa ikisi birden gidebiliyordu
           — OneDrive kilidi tam bu tür kısmi başarıları üretir.) */
        try { if (fs.existsSync(bakYeni)) fs.unlinkSync(bakYeni); } catch (eY0) {}
        fs.renameSync(p, bakYeni);
        fs.renameSync(tmp, p);
        try { if (fs.existsSync(bak)) fs.unlinkSync(bak); } catch (eB0) {}
        try { fs.renameSync(bakYeni, bak); } catch (eB1) {}
      } else {
        fs.renameSync(tmp, p);
      }
      return true;
    } catch (e) {
      /* GERİ AL: ana dosya taşındıktan sonra patlandıysa eskisini YERİNE KOY. Bu olmadan,
         henüz .bak oluşmamışken (temiz kurulumdan sonraki İLK yazma) veri yalnız
         .bak.yeni + .tmp içinde kalıyor ve panel sessizce sıfırdan başlıyordu. */
      try { if (!fs.existsSync(p) && fs.existsSync(bakYeni)) fs.renameSync(bakYeni, p); } catch (eG) {}
      /* tmp yalnız ana dosya SAĞLAMSA silinir — ana dosya yoksa elimizdeki en yeni
         sağlam veri odur, silmek kalıcı kayıp olurdu. */
      try { if (fs.existsSync(p) && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (eT) {}
      logLine("presetler.json YAZILAMADI: " + (e.message || e));
      return false;
    }
  }
  function presetYiginOku(ad) {
    var y = presetYiginlar()[ad];
    return y ? JSON.stringify(y) : "";
  }
  function presetOgrenilmis(ad) { return !!presetYiginlar()[ad]; }
  /* Kartlar <div> — `disabled` özelliği yok. Çift tıkta iki kez uygulanmasın diye bayrak
     kullanılıyor; kartın kendisi de tıklamaya kapatılıyor. */
  var _presetMesgul = false;

  async function presetOgren(ad, kart) {
    /* ÜZERİNE YAZMA ONAYI — kayıt PAHALI (elle sürükleme) ve geri dönüşü yok.
       Yanlış klip seçiliyken öğretmek çalışan bir preset'i sessizce siliyordu. */
    if (presetOgrenilmis(ad)) {
      var devam = await uiConfirm("“" + ad + "” zaten öğretilmiş.\n\nTimeline'da SEÇİLİ klipten yeniden öğrenilsin mi?\nEski kayıt silinir.", "Yeniden öğret");
      if (!devam) { durumYaz("vazgeçildi"); return; }
    }
    _presetMesgul = true;
    if (kart) kart.style.pointerEvents = "none";
    durumYaz("“" + ad + "” öğreniliyor…");
    /* try/FINALLY ŞART: kilit ve pointerEvents temizliği eskiden try'ın DIŞINDAYDI ve
       aradaki bir erken `return` ikisini de atlıyordu. _presetMesgul açık kalınca
       presetUygulaAd girişteki `if (_presetMesgul) return;` ile SESSİZCE dönüyor —
       panel bir daha hiçbir preset uygulamıyordu ("basıyorum bir şey olmuyor"). */
    try {
      var d = JSON.parse(String(await evalES("presetOkuJSON()")));
      if (!d || !d.ok) { durumYaz((d && d.hata) ? d.hata : "klip okunamadı", "var(--bad)"); return; }

      /* Keyframe sayımı YAZMADAN ÖNCE. Eskiden önce diske yazılıyor, uyarı sonra
         veriliyordu: keyframe'siz bir okuma ÇALIŞAN kaydı hem bellekte hem diskte
         eziyordu ve geri dönüş yoktu. */
      var kf = 0, i, j;
      for (i = 0; i < d.bilesenler.length; i++)
        for (j = 0; j < (d.bilesenler[i].p || []).length; j++)
          if (d.bilesenler[i].p[j].kf) kf++;
      var st = d.stSay || 0;   // uygulanabilir statik ayar (renk/blur/crop/blend — animasyonsuz preset)

      logLine("Öğrenildi: " + ad + " ← " + d.kaynak + " · " + d.bilesenler.length +
              " bileşen · " + kf + " animasyonlu parametre · " + st + " statik ayar · TOPLAM " +
              (d.keySayi || 0) + " keyframe · eğri: " + (d.egrili || 0) + " parametre / " +
              (d.ornSay || 0) + " nokta · zaman tabanı: " + (d.taban || "sekans") +
              (d.olcum ? " (" + d.olcum + ")" : ""));

      /* Hem keyframe hem statik BOŞ ise HİÇ KAYDETME (yanlış klip seçilmiş olabilir):
         eski kayıt varsa onu korur (ezmez); yoksa boş/uygulanamaz bir yığını diske yazıp
         "öğrenilmiş görünen ama uygulanamayan buton" bırakmaz. */
      if (!kf && !st) {
        durumYaz(presetOgrenilmis(ad)
          ? "⚠ HİÇ keyframe/ayar okunamadı — ESKİ KAYIT KORUNDU. Preset'in uygulandığı klibi seç."
          : "⚠ Bu klipte uygulanabilir keyframe/ayar yok — preset gerçekten bu klibe uygulandı mı? (Kaydedilmedi)",
          "var(--warn)");
        return;
      }
      /* `taban` ve `capa` ŞART: biri API'nin zaman tabanı ölçümü, diğeri animasyonun
         klip başına mı sonuna mı yapışacağı (bkz. presetOkuJSON). */
      var yiginlar = presetYiginlar(), onceki = yiginlar[ad];
      yiginlar[ad] = { bilesenler: d.bilesenler,
                       taban: d.taban || "sekans", capa: d.capa || "bas" };
      if (!presetYiginlarYaz()) {
        // Disk yazılamadıysa BELLEĞİ DE geri al — yoksa bozuk nesne sonradan diske işlenir.
        if (onceki) yiginlar[ad] = onceki; else delete yiginlar[ad];
        durumYaz("DİSKE YAZILAMADI — kayıt yapılmadı", "var(--bad)");
        return;
      }
      var basarili = (kf || st);
      var ozet = kf ? ((d.keySayi || 0) + " keyframe") : (st + " statik ayar");
      var hizNot = d.hizAtlandi ? " · hız rampası kopyalanmadı (bilerek)" : "";
      var mesaj, renk;
      if (basarili && d.okunamayan) {
        // Eksik yakalama artık SESSİZ değil — kullanıcı eksik preseti onlarca klibe uygulamasın.
        mesaj = "✓ “" + ad + "” öğrenildi ama " + d.okunamayan +
                " keyframe OKUNAMADI (eksik olabilir)" + hizNot;
        renk = "var(--warn)";
      } else if (basarili) {
        /* Eğri ölçümü ayrıca yazılır: yavaşlama/hızlanma ancak örnekleme yapıldıysa taşınır
           (bkz. host.jsx _egriOrnekle). 0 ise animasyon düz kopyalanacak demektir. */
        mesaj = "✓ “" + ad + "” öğrenildi (" + d.kaynak + " · " + ozet +
                (d.egrili ? (" · eğri alındı: " + d.egrili + " parametre") : " · eğri ALINAMADI (düz kopyalanır)") +
                hizNot + ") — artık karta basıp uygulayabilirsin";
        renk = "var(--good)";
      } else {
        mesaj = "⚠ “" + ad + "” kaydedildi ama uygulanacak bir şey bulunamadı — preset gerçekten o klibe uygulanmış mı?";
        renk = "var(--warn)";
      }
      durumYaz(mesaj, renk);
      presetBtnlarCiz();
    } catch (e) {
      durumYaz("hata: " + (e.message || e), "var(--bad)");
    } finally {
      _presetMesgul = false;
      if (kart) kart.style.pointerEvents = "";
    }
  }

  /* kafaya=true: animasyon klibin başına değil OYNATMA KAFASININ olduğu ana yapışır
     (gameplay klibinin ortasına zoom punch). Sağ tık menüsünden geliyor. */
  async function presetUygulaAd(ad, kart, kafaya) {
    if (_presetMesgul) return;
    if (!CEP) { durumYaz("Premiere'de çalışır", "var(--warn)"); return; }

    var yigin = presetYiginOku(ad);
    var sira = efektSira(ad);
    var anim = PRESET_ANIM[ad] || "";
    if (!yigin && sira < 0 && !anim) {
      /* Boş karta basmak artık ÇIKMAZ değil: doğrudan öğretmeyi teklif et.
         (Eski akışta "üstteki kutuyu işaretle" deniyordu; kutu 8 kartlık gridin altında
         ve dar dock'ta ekran dışında kalabiliyordu.) */
      var ogrenelim = await uiConfirm("“" + ad + "” henüz boş.\n\nTimeline'da SEÇİLİ klipten öğrenilsin mi?\n(Preset'i o klibe önce Premiere'de elle uygulamış olmalısın.)", "Öğret");
      if (ogrenelim) await presetOgren(ad, kart);
      else durumYaz("“" + ad + "” henüz öğretilmedi — karta sağ tık → “Bu klipten öğret”", "var(--warn)");
      return;
    }
    _presetMesgul = true;
    if (kart) kart.style.pointerEvents = "none";
    durumYaz(ad + " uygulanıyor…");
    var yol = "";
    try {
      var r;
      if (yigin) {
        /* Yığın DOSYADAN geçiyor, evalScript string literalinden DEĞİL: metin uzun ve
           Türkçe karakterli, gömülürse kırılır (proje geneli kural).
           Geçici dosya PANEL klasörüne yazılır, motorun work'üne DEĞİL: motor kurulu
           değilse preset özelliği motorla ilgisiz bir hatayla patlıyordu. */
        yol = path.join(extRoot, "preset_gecici.json");
        fs.writeFileSync(yol, yigin, "utf8");
        r = String(await evalES('presetYaz("' + esPath(yol) + '", "' + (kafaya ? "1" : "0") + '")'));
      } else if (sira >= 0) {
        r = String(await evalES("efektUygula(" + sira + ")"));
        // Hangi yolun çalıştığı SÖYLENİR: öğretilmiş kayıt yokken "başarılı" demek yanıltıcı.
        if (r.indexOf("ok:") === 0) r += " | (Premiere'in hazır efekti — öğretilmiş kayıt YOK)";
      } else {
        r = String(await evalES('animasyonUygula("' + anim + '", 0.4)'));
        if (r.indexOf("ok:") === 0) r += " | (panelin kendi animasyonu — öğretilmiş kayıt YOK)";
      }
      sonucGoster(ad, r);
    } catch (e) {
      durumYaz("hata: " + (e.message || e), "var(--bad)");
    } finally {
      // finally ŞART — bkz. presetOgren'deki not: kilit açık kalırsa panel kilitleniyor.
      if (yol) { try { fs.unlinkSync(yol); } catch (eU) {} }
      _presetMesgul = false;
      if (kart) kart.style.pointerEvents = "";
    }
  }

  /* PRESET'İN TERSİNİ ÜRET (giriş → çıkış).
     Bin'indeki her animasyonun iki hali var (Pop In / Pop Out, Zoom In / Zoom Out) ve şu an
     her biri için ayrı ayrı klibe sürükleyip ayrı ayrı öğretmek gerekiyor — aynı iş iki kez.
     Oysa çıkış, girişin zamanda tersinden başka bir şey değil.
     host.jsx'e HİÇ dokunulmuyor; matematik uyumlu: presetYaz capa="son" iken
     capaOfs=hedefSüre kullanıyor ve _paramlariYaz spatial tabanı capa="son" iken kw[0].v'den
     alıyor — negatiflenmiş listede kw[0] tam olarak animasyonun DURAĞAN hali.
     ⚠ AMA ÇEVİRME İKİ KATMANLI: yığın çıpası (kopya.capa) TEK BAŞINA YETMEZ, PARAMETRE
     BAŞINA çıpa (p.capa) da çevrilmek zorunda — host onu yığın çıpasının ÖNÜNDE okuyor.
     Bu ilk sürümde atlanmıştı ve üretilen çıkış preseti keyframe'leri klibin DIŞINA yazıp
     "HIC KEYFRAME KONMADI" veriyordu; ayrıntı aşağıdaki döngüde.
     Orijinalin ÜSTÜNE ASLA yazılmaz: ters yığın bozuk çıkarsa kullanıcı onu orijinal sanıp
     uygulayabilirdi. */
  function presetTersiUret(ad) {
    var y = presetYiginlar()[ad];
    if (!y) { durumYaz("“" + ad + "” önce öğretilmeli", "var(--warn)"); return; }
    var yeniAd = ad + " (çıkış)";
    if (_presetSecili.indexOf(yeniAd) !== -1) { durumYaz("“" + yeniAd + "” zaten var", "var(--warn)"); return; }
    var kopya;
    try { kopya = JSON.parse(JSON.stringify(y)); }
    catch (e) { durumYaz("kopyalanamadı: " + (e.message || e), "var(--bad)"); return; }

    var bi, pi, q, l, ki, plist, sayi = 0;
    for (bi = 0; bi < (kopya.bilesenler || []).length; bi++) {
      plist = kopya.bilesenler[bi].p || [];
      for (pi = 0; pi < plist.length; pi++) {
        for (q = 0; q < 2; q++) {
          l = q ? plist[pi].s : plist[pi].k;
          if (!l || !l.length) continue;
          for (ki = 0; ki < l.length; ki++) { l[ki].t = -l[ki].t; sayi++; }
          // Zamanlar negatiflendi → sıra TERSİNE döndü; artan zamana göre yeniden diz.
          l.sort(function (a, b) { return a.t - b.t; });
        }
        /* ⚠ PARAMETRE BASINA ÇIPA DA ÇEVRİLİR — yığın çıpasını çevirmek YETMEZ.
           host.jsx çıpayı artık parametre başına saklıyor (presetOkuJSON her keyframe'li
           parametreye p.capa yazıyor) ve _paramlariYaz onu YIĞIN çıpasının ÖNÜNDE okuyor
           (yığın çıpası yalnız p.capa'sı olmayan ESKİ kayıtlar için yedek). Yalnız
           kopya.capa çevrilince ters kayıtta her parametre hâlâ "bas", yığın ise "son"
           oluyordu: presetYaz capaOfs = hedefSure alıyor, _paramlariYaz capaDelta = -hs
           uyguluyor, ikisi birbirini götürüyor ve taban yine t0 kalıyor — ama zamanlar
           negatif olduğu için keyframe'ler klibin BAŞLANGICINDAN ÖNCEYE düşüyor ve
           _keyDene'nin aralık kontrolünden geçemiyordu. Panel yeşil "üretildi" diyor,
           karta basınca "HIC KEYFRAME KONMADI" çıkıyordu.
           Alan YOKSA dokunma: eski kayıtlar çevrilmiş yığın çıpasına düşsün.
           Ek fayda: karışık çıpalı yığınlar (bir parametre "bas", diğeri "son" — gerçek
           bir senaryo) da artık doğru çevriliyor; eski kod onları da bozuyordu. */
        if (plist[pi].capa === "son") plist[pi].capa = "bas";
        else if (plist[pi].capa === "bas") plist[pi].capa = "son";
      }
    }
    if (!sayi) { durumYaz("“" + ad + "” animasyon içermiyor — tersi üretilemez", "var(--warn)"); return; }
    kopya.capa = (y.capa === "son") ? "bas" : "son";

    var yiginlar = presetYiginlar();
    yiginlar[yeniAd] = kopya;
    if (!presetYiginlarYaz()) { delete yiginlar[yeniAd]; durumYaz("DİSKE YAZILAMADI", "var(--bad)"); return; }
    if (_presetSecili.indexOf(yeniAd) === -1) { _presetSecili.push(yeniAd); presetSeciliYaz(); }
    presetBtnlarCiz();
    durumYaz("✓ “" + yeniAd + "” üretildi — bir klipte deneyip doğrula", "var(--good)");
  }

  /* Sıralama HER ZAMAN alfabetik (Türkçe): kullanıcı kartın yerini ezberliyor, ekleme
     yaptıkça sıra oynarsa yanlış karta basar. */
  function presetSirala() {
    _presetSecili.sort(function (a, b) {
      try { return String(a).localeCompare(String(b), "tr"); }
      catch (e) { return a < b ? -1 : (a > b ? 1 : 0); }
    });
  }

  async function presetKaldir(ad) {
    /* ONAY ŞART: menüde "Yeniden adlandır"ın hemen altında ve öğretilmiş yığını da siliyor
       — o yığın elle yapılmış bir sürüklemenin tek kaydı. */
    if (presetOgrenilmis(ad)) {
      var em = await uiConfirm("“" + ad + "” kaldırılsın mı?\n\nÖĞRETİLMİŞ kaydı da silinir; yeniden öğretmen gerekir.", "Kaldır");
      if (!em) { durumYaz("vazgeçildi"); return; }
    }
    var k = _presetSecili.indexOf(ad);
    if (k !== -1) _presetSecili.splice(k, 1);
    presetSeciliYaz();
    // Öğrenilmiş yığın da gitsin — adı olmayan yığın dosyada çöp olarak birikirdi.
    var y = presetYiginlar();
    if (y[ad]) { delete y[ad]; presetYiginlarYaz(); }
    presetBtnlarCiz();
    durumYaz("“" + ad + "” kaldırıldı");
  }

  function presetAdDegistir(eski, yeni) {
    yeni = String(yeni || "").trim();
    if (!yeni || yeni === eski) { presetBtnlarCiz(); return; }
    if (_presetSecili.indexOf(yeni) !== -1) {
      durumYaz("“" + yeni + "” zaten var", "var(--warn)"); presetBtnlarCiz(); return;
    }
    var k = _presetSecili.indexOf(eski);
    if (k !== -1) _presetSecili[k] = yeni;
    presetSeciliYaz();
    /* Öğrenilmiş yığın ADLA anahtarlanıyor — ad değişince yığın da TAŞINMALI, yoksa kart
       yeniden "öğretilmemiş" görünür ve kullanıcının elle yaptığı sürükleme boşa gider. */
    var y = presetYiginlar();
    if (y[eski]) { y[yeni] = y[eski]; delete y[eski]; presetYiginlarYaz(); }
    presetBtnlarCiz();
    durumYaz("“" + eski + "” → “" + yeni + "”");
  }

  // Kartın yerine geçen ad kutusu — ayrı bir modal açmaya değmez.
  function presetAdDuzenle(kart, ad) {
    kart.innerHTML = "";
    var inp = document.createElement("input");
    inp.type = "text"; inp.className = "pc-ad"; inp.value = ad; inp.spellcheck = false;
    kart.appendChild(inp);
    inp.focus(); inp.select();
    var bitti = false;
    function kaydet() { if (bitti) return; bitti = true; presetAdDegistir(ad, inp.value); }
    function vazgec() { if (bitti) return; bitti = true; presetBtnlarCiz(); }
    inp.addEventListener("keydown", function (e) {
      if (e.keyCode === 13) { e.preventDefault(); kaydet(); }
      else if (e.keyCode === 27) { e.preventDefault(); vazgec(); }
    });
    inp.addEventListener("blur", kaydet);
    // Kutuya tıklamak kartı "uygula" diye tetiklemesin
    inp.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  /* ---- sağ tık menüsü ---- */
  var _ctxEl = null;
  function ctxKapat() {
    if (_ctxEl && _ctxEl.parentNode) _ctxEl.parentNode.removeChild(_ctxEl);
    _ctxEl = null;
  }
  function ctxAc(x, y, ogeler) {
    ctxKapat();
    var m = document.createElement("div"); m.className = "ctx-menu";
    ogeler.forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = o.ad;
      if (o.tehlike) b.className = "tehlike";
      /* Menü işleyicileri async olabiliyor (uiConfirm bekliyorlar). Dönen Promise
         yakalanmazsa hata SESSİZCE konsola düşer, kullanıcı hiçbir şey görmez ve iş
         yarım kalır. Panelin her yerindeki "hata kullanıcıya söylenir" kuralı burada da
         geçerli olmalı. */
      b.addEventListener("click", function (ev) {
        ev.stopPropagation(); ctxKapat();
        try {
          var pr = o.calistir();
          if (pr && typeof pr["catch"] === "function") {
            pr["catch"](function (e) { durumYaz("hata: " + (e && (e.message || e)), "var(--bad)"); });
          }
        } catch (e) { durumYaz("hata: " + (e && (e.message || e)), "var(--bad)"); }
      });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    /* Konum ancak DOM'a girdikten sonra ölçülebiliyor; ekran dışına taşmasın diye
       yerleştirme burada yapılıyor. */
    var g = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - g.width - 4)) + "px";
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - g.height - 4)) + "px";
    _ctxEl = m;
  }
  document.addEventListener("click", ctxKapat);
  // Kart dışına sağ tıklanınca da kapansın (kartın kendi işleyicisi stopPropagation yapar)
  document.addEventListener("contextmenu", ctxKapat);

  function presetBtnlarCiz() {
    var box = $("presetBtnlar"); if (!box) return;
    box.innerHTML = "";
    presetSirala();
    if (!_presetSecili.length) {
      var p = document.createElement("p");
      p.className = "note"; p.style.margin = "0";
      p.textContent = "Preset yok — aşağıdan oluştur.";
      box.appendChild(p);
      return;
    }
    _presetSecili.forEach(function (ad) {
      var kart = document.createElement("div");
      /* "ÖĞRETİLMİŞ" GÖRÜNÜMÜ YALNIZ GERÇEK KAYDA BAĞLI.
         Eskiden yedek yollar (Premiere'in yerleşik efekti / panelin kaba Pop In'i) da kartı
         dolu gösteriyordu: presetler.json kaybolsa panel sessizce kaba animasyonu uygulayıp
         "başarılı" diyor, kart hâlâ öğretilmiş görünüyordu. */
      var ogr = presetOgrenilmis(ad);
      var yedekVar = (efektSira(ad) >= 0 || !!PRESET_ANIM[ad]);
      kart.className = "preset-card" + (ogr ? "" : " pc-bos");
      kart.textContent = ad;
      kart.title = ogr ? "Seçili klip(ler)e uygula (sağ tık: kafaya uygula / tersini oluştur)"
                       : (yedekVar ? "Öğretilmedi — basarsan Premiere'in hazır efekti uygulanır. Sağ tık → “Bu klipten öğret”"
                                   : "Henüz öğretilmedi — sağ tık → “Bu klipten öğret”");
      kart.addEventListener("click", function () { presetUygulaAd(ad, kart); });
      /* SAĞ TIK = tüm yönetim. Sol tık HER ZAMAN uygular — eski "öğretme modu" kutusu
         kaldırıldı: kartlar iki modda da BİREBİR aynı görünüyordu ve yanlış modun bedeli
         asimetrikti (yanlışlıkla uygulamak zararsız/Ctrl+Z, yanlışlıkla öğrenmek saatlerce
         emeği yanlış klipten okunan bir yığınla değiştiriyordu). */
      kart.addEventListener("contextmenu", function (e) {
        e.preventDefault(); e.stopPropagation();
        var ogr = presetOgrenilmis(ad);
        var ogeler = [
          { ad: "Bu klipten öğret", calistir: function () { presetOgren(ad, kart); } }
        ];
        if (ogr) {
          ogeler.push({ ad: "Oynatma kafasına uygula", calistir: function () { presetUygulaAd(ad, kart, true); } });
          ogeler.push({ ad: "Tersini oluştur (çıkış)", calistir: function () { presetTersiUret(ad); } });
        }
        ogeler.push({ ad: "Yeniden adlandır", calistir: function () { presetAdDuzenle(kart, ad); } });
        ogeler.push({ ad: "Kaldır", tehlike: true, calistir: function () { presetKaldir(ad); } });
        ctxAc(e.clientX, e.clientY, ogeler);
      });
      box.appendChild(kart);
    });
  }

  /* Yerleşik efekt listesi ARAYÜZDE GÖRÜNMÜYOR — yalnız sessiz bir yedek yol için okunuyor:
     kullanıcı bir preset'e yerleşik bir efektin adını verirse (ör. "Gaussian Blur") kart
     öğretilmeden de çalışsın. Kullanıcının kendi preset'leri bu listede YOK (ölçüldü). */
  async function efektleriYukle() {
    if (!CEP) return;
    var hata = "";
    try {
      var d = JSON.parse(String(await evalES("efektListesiJSON()")));
      _efektler = (d && d.ok && d.efektler) ? d.efektler : [];
      if (d && !d.ok) hata = String(d.hata || "bilinmeyen");
    } catch (e) { _efektler = []; hata = e.message || String(e); }
    if (hata) logLine("Efekt listesi alınamadı: " + hata);
    presetBtnlarCiz();
  }

  /* "Stilleri projeye ekle" — yerel .prtextstyle dosyalarını PROJE ÖĞESİ yapar.
     Premiere'in "New caption track > Style" listesi yalnız proje öğelerini gösteriyor;
     bilgisayara kurulu yerel stiller orada çıkmıyor (bkz. host.jsx stilleriProjeyeAl). */
  function wireStilProje() {
    var b = $("btnStilProje"), d = $("stilProjeDurum");
    if (!b) return;
    function yaz(m, renk) { if (d) { d.textContent = m || ""; d.style.color = renk || "var(--muted)"; } }
    b.addEventListener("click", async function () {
      if (!CEP) { yaz("Premiere'de çalışır", "var(--warn)"); return; }
      var klasor = stilKlasoruBul();
      if (!klasor || !fs.existsSync(klasor)) { yaz("Stil klasörü bulunamadı", "var(--bad)"); return; }
      b.disabled = true; yaz("ekleniyor…");
      try {
        var r = String(await evalES('stilleriProjeyeAl("' + esPath(klasor) + '")'));
        logLine("Stilleri projeye ekle: " + r);
        if (r.indexOf("ok:") === 0) yaz("✓ " + r.slice(3), "var(--good)");
        else yaz(r.replace(/^err:/, ""), "var(--bad)");
      } catch (e) { yaz("hata: " + (e.message || e), "var(--bad)"); }
      finally { b.disabled = false; }
    });
  }

  /* ================= EMOJİ: PLAN ÜRETİMİ =================
     Yapay zekâ yalnız DUYGUyu söyler; geri kalan her şey ölçülmüş veriden gelir:
       · KİM konuşuyor  → kanal (kesin, tahmin yok)
       · NEREYE         → konuşana göre sağ alt / sol alt
       · NE KADAR       → sabit süre (Premiere'in 5 sn varsayılanı yazılarak ezilir)
       · NE BÜYÜKLÜKTE  → PNG'nin gerçek boyutundan (Tofi 2000px, diğerleri 1000px) */
  /* ÖLÇÜLER KULLANICININ ELLE AYARLADIĞI KLİPTEN ALINDI (7 Ağustos 2026, ekran görüntüsü):
     Dora (1000px) · Scale 62 · Position 1603,3 / 766,2 · sekans 1920x1080
       → ekranda 620 px = kare yüksekliğinin %57'si
       → köşeye ~5 px kala (kenara yapışık, "Techy" tarzı büyük tepki resmi)
     Eski varsayılanlar (%22, 54 px boşluk) çok küçük ve içeride kalıyordu. */
  /* SÜRE SABİT DEĞİL — EMOJİ O CÜMLE BOYUNCA EKRANDA KALIR (kullanıcı isteği, 7 Ağustos 2026:
     "emojiler o cümle boyunca kalmalı ayrıca sabit sürede gelmemeli"). Eskiden herkes 1.6 sn
     kalıyordu; kısa bir "Ay!" ile uzun bir cümle aynı süre duruyordu ve tepki resmi konuşmanın
     ortasında kayboluyordu. Cümlenin `bas`/`bit` bilgisi zaten elimizde (VUR.cumleleriCikar).
     ÖLÇÜLDÜ (kullanıcının oturumu): cümleler 0.80-6.41 sn, ortanca 3.52 · 0.8 sn altında hiç
     cümle yok · 8 sn üzerinde de yok. Taban ve tavan bu yüzden sadece EMNİYET: taban göz
     kırpmasını, tavan da tek bir uzun cümlenin ekranı işgal etmesini engelliyor. */
  /* ⚠ TABAN 0.6 → 1.2 (kullanıcı isteği, 8 Ağustos 2026: "emojilerin süresi çok kısa olmasın,
     1 saniye gelmeden gidiyo"). Asıl kol aşağıdaki EMOJI_MIN_KELIME; bu taban yalnız o
     filtreden geçmiş kısa bir cümlenin de göz kırpması gibi durmasını engelliyor.
     Emoji cümlenin bitişini AŞABİLİR — bilerek: tepki resmi konuşma bittikten sonra bir an
     daha ekranda kalır, doğal görünen budur. Çakışma freni (EMOJI_GAP) uzamış süreyi zaten
     `sonBitis` üzerinden görüyor, yani bir sonraki emoji üstüne binmez; host tarafındaki fren
     de geri OKUNAN bitişten kuruluyor. Tabanı büyütmenin bedeli emoji sayısında değil,
     yalnız aralarındaki mesafede. */
  var EMOJI_MIN_SURE = 1.2;
  var EMOJI_MAX_SURE = 10.0;
  /* EN AZ KAÇ KELİMELİK CÜMLEYE EMOJİ KONUR (kullanıcı isteği, 8 Ağustos 2026: "cümle 3
     kelimelikse garip duruyo, 1 saniye gelmeden gidiyo — en az 5 kelimelik cümlelerde olsun").
     ⚠ ELEME YAPAY ZEKÂ ÇAĞRISINDAN **ÖNCE** (emojiCumleleriTopla içinde). Bu projede tam bu
     hata bir kez yapıldı: karakter eşleştirmesi plan döngüsündeydi ve cümlelerin %52'si
     modele gidip PARASI ÖDENDİKTEN sonra atılıyordu. Kısa cümle modele hiç gitmiyor —
     hem ucuz, hem de hedef sayı (hedefOran) gerçekten yerleştirilebilir cümleler üzerinden
     hesaplandığı için "Bol emoji" seçeneği sözünü tutuyor.
     Kelime sayısı boşluktan sayılır; cue metni cleanPunct'tan geçtiği için noktalama yok. */
  var EMOJI_MIN_KELIME = 5;
  /* İKİ EMOJİ ARASI EN AZ BOŞLUK. Artık süre değişken olduğu için fren "başlangıçlar arası
     mesafe" değil "önceki emojinin BİTİŞİ" üzerinden çalışıyor — sabit süre varsayımına
     dayanan eski EMOJI_ARA (2.2) bu yüzden kaldırıldı.
     ⚠ SIFIR YAPMA: host her klip konar konmaz süresini yazıyor ve bir sonraki ancak ondan
     sonra konabiliyor (host.jsx `sonBitis` freni); kare yuvarlaması yukarı giderse çakışan
     emoji EZİLMEZ ama SESSİZCE ATILIR ve her çalıştırma sarıya döner. 0.08 ≈ iki kare payı. */
  var EMOJI_GAP = 0.08;
  var EMOJI_ORAN = 0.574;      // emoji yüksekliği / kare yüksekliği — KULLANICI ONAYLADI, DOKUNMA
  var EMOJI_BOSLUK_X = 0.005;  // SAĞ kenar boşluğu (kare yüksekliğinin oranı) ≈ 5 px
  /* ALT BOŞLUK YOK (kullanıcı isteği, 7 Ağustos 2026: "aşağıda boşluk kalıyo çok az, o
     küçücük yer kapanıcak şekilde aşağı indirebilir miyiz"). Emoji kareyi alt kenara dayanır.
     ⚠ BU HER RESİMDE BOŞLUĞU BİTİRMEZ: bazı PNG'lerin KENDİ altında şeffaf pay var —
     ölçüldü (alfa bounding box): çoğu dosyada %0 (yani resim alt kenara dayalı, panel 0
     yapınca tam oturuyor) ama Çok Mutlu/Havalı/Mızmızlanan/Heyecanlı Tofi 2 → %10.9,
     Şaşırmış Moni → %12.2, Şaşırmış Mimi → %3.1. O dosyalarda kalan boşluk resmin kendi
     boşluğudur; çözümü kod değil, resmi alt kenara dayalı yeniden kaydetmek. */
  var EMOJI_BOSLUK_Y = 0;
  /* Bir evalScript'te kaç emoji. Klip başına 12-15 ExtendScript↔Premiere turu var ve tek
     çağrı boyunca Premiere'in arayüzü DONUYOR; 150 emoji tek seferde gitseydi kullanıcı ne
     kadar kaldığını göremez, "kilitlendi" sanıp Premiere'i öldürebilirdi. */
  var EMOJI_PARCA = 40;
  /* Plandaki en fazla emoji (host tavanı 400). Aşılırsa REDDEDİLMEZ, eşit aralıkla
     SEYRELTİLİR: host'un eski davranışı (plan > 100 ise tek emoji koymadan "err:") ödenmiş
     API isteğini ve 25 dakikalık GPU işini çöpe atıyordu. */
  var EMOJI_PANEL_TAVAN = 300;

  /* ── ÇEŞİTLİLİK: aynı resim üst üste çıkmasın (kullanıcı isteği, 7 Ağustos 2026) ──
     Bir emoji dosyası (duygu+karakter) TEKRAR kullanılmadan önce araya
       (i) 4 BAŞKA karakterin emojisi  VE  (ii) 2 tane AYNI karakterin FARKLI duygulu emojisi
     girmeli. İkisi de YERLEŞTİRME SAYISI sayar.
     ⚠ "4 FARKLI KARAKTER" DİYE SAYMA — ölçüldü, özelliği öldürüyor: klasörde emojisi olan
     yalnız 4 karakter var, "4 farklı BAŞKA karakter" hiçbir zaman sağlanamaz (194 → 29 emoji).
     PENCERE = 4+2 = 6: kuralın istediği en az ara bu kadar. Daha eskiye bakmanın bilgi değeri
     yok, zararı var (dengesiz kadroda sonsuza kadar kilitler) — ayrıca tarama O(6) kalıyor. */
  var CES_BASKA = 4;
  var CES_AYNI = 2;
  var CES_PENCERE = CES_BASKA + CES_AYNI;

  /* KARAKTER DENGESİ — ELEME DEĞİL SEÇİM (kullanıcı isteği: "kızlarda da görünsün, sadece
     Tofi'ye odaklanmasın"). Çakışma freni aynı anda zaten TEK emoji bırakıyor; bugün o
     aralıktaki EN ERKEN aday alınıyordu, artık o ana kadar EN AZ emoji almış karakterinki
     tercih ediliyor. Aynı sayıda emoji konur, yalnız KİMİN emojisi olduğu değişir.
     ⚠ KOTA/ELEME DENENDİ VE PAHALI ÇIKTI (ölçüldü, 448 cümle): "son 4 emojide aynı
     karakterden en fazla 2" kuralı Tofi payını %55 → %38 indiriyor ama emojiyi 165 → 69
     düşürüyor (-%58). Sebep yapısal: Tofi cümlelerin YARISI, elenince yerine koyacak cümle
     yok. Seçim yaklaşımında kayıp %5-10.
     Ölçülen etki (Bol sıklık): Tofi %49 → %40 · Dora 26 → 27 · Mimi 24 → 25 · emoji 207 → 187.
     Orta sıklıkta etki küçük (%55 → %54) çünkü aynı pencerede nadiren iki aday oluyor —
     denge asıl olarak yapay zekânın karakter başına dengeli işaretlemesinden geliyor
     (bkz. js/emoji.js SISTEM_DUYGU 3. kural). */
  /* ⚠ 3.0 → 2.2 (kullanıcı isteği, 9 Ağustos 2026: "emojileri biraz daha artıralım").
     Bu pencere emoji sayısının ASIL kolu: EMOJI_SIKLIK'i tek başına yükseltmek doyuma
     giriyor, çünkü aynı 3 sn'lik gruptan taraf başına yalnız BİR aday konuyor. Gerçek
     oturumda ölçüldü (251 cue / 33 uygun cümle): oran 0.90'da pencere 3.0 → 24 emoji,
     2.2 → 26 emoji. Oran + pencere birlikte: 22 → 26 (+%18).
     ⚠ DAHA AŞAĞI İNDİRME (2.0 ve altı) kazancı hızla azaltıyor — üst sınırı artık pencere
     değil çakışma freni (EMOJI_GAP) ve emojinin cümle boyunca ekranda kalması koyuyor. */
  var EMOJI_SECIM_PENCERE = 2.2;

  /* ── HANGİ KARAKTER HANGİ TARAFTA (kullanıcı kararı, 8 Ağustos 2026) ──
     "Tofi ve Moni her zaman emoji sağda olacak, diğer karakterler diğer tarafa."
     Tofi ve Moni KANAL SAHİPLERİ (Minecraft ve Roblox kanalları); videoyu hangisi çekerse
     çeksin ikisi de sağ alt köşede, konuklar (Dora, Mimi, Sage, Niko…) sol alt köşede.
     ⚠ BU LİSTE BİLEREK KODDA — duygu/karakter kümesinin aksine (o klasörden türetiliyor)
     "kanalın sahibi kim" bilgisi dosya adlarından ÇIKARILAMAZ. Kadro değişirse tek satır.
     Anahtarlar ASCII (EMJ.asciiAnahtar çıktısıyla aynı kural): "Tofi"/"TOFİ"/"tofi" hepsi tutar. */
  var EMOJI_SAG_KARAKTER = { "tofi": 1, "moni": 1 };
  /* ⚠ İKİNCİ KURAL — A1 (VİDEOYU ÇEKEN) HER ZAMAN SAĞDA, adı ne olursa olsun.
     Yalnız liste olsaydı, kadrosunda ne Tofi ne Moni bulunan bir kullanıcıda (ParsMazi ya da
     ileride kadro değişirse) HİÇBİR karakter listede olmaz, hepsi sola düşer ve hepsi
     aynalanırdı: videoyu çekenin kendi yüzü sol köşede ve TERS, sağ köşe hiç kullanılmaz.
     Panelde bunu düzeltecek bir ayar yok — kaynak dosya düzenlemek gerekirdi, ki ikinci
     kullanıcının yapamayacağı tek şey bu. Rol kuralı kadrodan bağımsız doğru davranıyor;
     Tofi/Moni listesi onun üzerine binen kullanıcı isteği (ikisi de, çekmeseler bile sağda). */
  function emojiSagMi(karKey, a1Mi) {
    return !!a1Mi || !!EMOJI_SAG_KARAKTER[String(karKey || "")];
  }

  /* Konum: NORMALİZE (ölçüldü — [0.5,0.5] merkez, piksel DEĞİL).
     Kenar boşluğu iki eksende AYRI hesaplanır: x kareyi genişliğe, y yüksekliğe böler;
     tek bir oran 16:9 karede emojiyi köşeye eşit uzaklıkta bırakmaz.
     Doğrulama (sağ): 1920x1080'de x=0.836 / y=0.708 çıkıyor; kullanıcının elle ayarlayıp
     onayladığı klip 1603,3/766,2 yani 0.835/0.709 — 0.002 içinde örtüşüyor.
     ⚠ `sag` PARAMETRESİ GERİ GELDİ. 7 Ağustos'ta "hepsi sağda" denip tümden kaldırılmıştı
     ("dal yoksa yanlış taraf da geçilemez"); 8 Ağustos'ta kullanıcı iki taraf istedi. Tarafı
     artık ÇAĞIRAN SEÇMİYOR — emojiSagMi(karakter) belirliyor, yani "yanlış taraf" ancak
     yukarıdaki listeyi bozarak geçilebilir. Sol x, sağ x'in kare merkezine göre TAM AYNASI
     (solX = 1 - sağX), çünkü iki kenar boşluğu da aynı `bosX` değerinden hesaplanıyor. */
  function emojiKonum(seqW, seqH, sag) {
    var boyPx = seqH * EMOJI_ORAN;                 // emoji ekranda bu kadar yüksek
    var yariPx = boyPx / 2;
    var bosX = Math.round(seqH * EMOJI_BOSLUK_X), bosY = Math.round(seqH * EMOJI_BOSLUK_Y);
    var x = sag ? ((seqW - bosX - yariPx) / seqW) : ((bosX + yariPx) / seqW);
    var y = (seqH - bosY - yariPx) / seqH;
    /* ⚠ DİKEY (Shorts) SEKANSTA TARAFLAR YER DEĞİŞTİREBİLİYORDU. Ölçek kare YÜKSEKLİĞİNE
       bağlı (EMOJI_ORAN); 1080x1920'de emoji 1102 px oluyor, yani kareden GENİŞ. O zaman
       "sağ" formülü 0.481, "sol" formülü 0.519 veriyor — sağdaki soldan solda kalıyor ve
       tarafSay sayımı da ters okuyor. Kelepçe iki tarafın ÇAPRAZLAMASINI engelliyor;
       yatay videoda hiçbir şeyi değiştirmiyor (orada sağ 0.836, sol 0.164 çıkıyor).
       NOT: dikey sekansta emojinin kareyi taşması AYRI ve ESKİ bir konu — bu kelepçe onu
       çözmez, yalnız "hangi taraf" bilgisini dürüst tutar. Shorts'ta emoji hiç ölçülmedi. */
    if (sag && x < 0.5) x = 0.5;
    if (!sag && x > 0.5) x = 0.5;
    return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  }

  /* Tarama sonucunda bir karakter anahtarını bul (yoksa null). Eşleşme ASCII üzerinden:
     "Tofi", "tofi", "TOFİ" hepsi tutar. */
  function emojiKarakterAra(tarama, key) {
    if (!key) return null;
    for (var i = 0; i < tarama.karakterler.length; i++) {
      if (tarama.karakterler[i].key === key) return tarama.karakterler[i];
    }
    return null;
  }

  /* Cümleleri kanal kanal toplar VE karakteri BURADA eşleştirir.
     ⚠ EŞLEŞTİRME YAPAY ZEKÂ ÇAĞRISINDAN ÖNCE OLMAK ZORUNDA. Eskiden plan döngüsündeydi:
     eşleşmeyen kanalın bütün cümleleri modele gidiyor, PARASI ÖDENİYOR, cevabı geliyor ve
     sonra çöpe atılıyordu. Kullanıcının gerçek oturumunda ölçüldü — 465 cümlenin 240'ı
     (%52) böyle atılıyordu ve PARCA=250 yüzünden 1 yerine 2 istek gidiyordu.
     Dönüş: { liste, elle }
       liste = [{sira, ad, kar, bas, bit, metin}] — kar = eşleşmiş karakter nesnesi
       elle  = [{ad, cumle, karar}] — klasörde karşılığı OLMAYAN adlar; karar boşsa kullanıcı
               henüz seçmemiş demektir (o zaman AI'ya istek HİÇ gitmez). */
  /* Cümledeki kelime sayısı. Metin cleanPunct'tan geçtiği için noktalama yok — boşluktan
     saymak yeterli ve tek bir kurala bağlı kalıyor (pipeline'daki _kelimeSay dışa açık değil,
     kopyalamak yerine burada tek satırlık karşılığı tutuluyor). */
  function emojiKelimeSay(s) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t ? t.split(" ").length : 0;
  }

  /* "A1", "A4" gibi KANAL KODLARI bir KİMLİK DEĞİLDİR — bir videoda Tofi, ötekinde Moni.
     Bu adlar için kaydedilmiş bir emoji eşleşmesine ASLA güvenilmez (bkz. emojiCumleleriTopla).
     Aynı ders panelde iki kez alındı: AutoCut'ta `acCh` → `acCh2_` göçü ve emoji eşleşmesinin
     numara yerine ADLA saklanması. Bu, o kuralın kaçırılan üçüncü hâliydi. */
  function emojiYerTutucuAd(anahtar) { return /^a\d+$/.test(String(anahtar || "")); }

  /* SEKANS KİMLİĞİ — "bu aynı video mu" sorusunun cevabı.
     ⚠ Yalnız sekans ADI YETMİYOR: Premiere'in varsayılan adları ("Video Sequence",
     "Sequence 01") projeler arası tekrar ediyor, yani başka bir videonun kararı bu videoya
     sızabiliyordu. Süre de eklenince iki farklı videonun aynı kimliğe düşmesi pratikte
     imkânsızlaşıyor. AutoCut süreyi değiştirirse kimlik de değişir ve soru bir kez daha
     sorulur — bedeli tek tık, karşılığı yanlış karakterle geçen bir video. */
  /* ⚠ SEKANS HENÜZ OKUNMADIYSA BOŞ DÖNER — "sekans_0" PROJELER ARASI ORTAK ANAHTAR ÜRETİYORDU.
     _oturum {name:"", end:0} ile başlıyor ve yalnız offerSessionRestore (açılışta, ASENKRON)
     ya da saveSessionAuto (üretimden SONRA) içinde doluyor. Ama goView Emoji ekranı her
     açıldığında emojiKanalKarCiz() çağırıyor ve o da bu kimlikle localStorage'a YAZIYOR:
     kullanıcı panel açılır açılmaz Emoji kartına tıklayıp "A1 → Tofi" seçerse kayıt
     `emoji.kanalKar.sekans_0.0`'a gidiyordu — yani tam da tasarımın engellemeye çalıştığı
     projeler-arası ortak anahtar. Üretimden sonra kimlik gerçek değere dönünce seçim
     "kaybolmuş" görünüyor; ikinci bir projede ise ÖNCEKİ projenin seçimi menüde çıkıyordu.
     Boş kimlikte artık ne okunuyor ne yazılıyor (aşağıdaki iki yardımcı boş anahtar döner). */
  function sekansKimlik() {
    if (!_oturum || !_oturum.name) return "";
    /* Süre kimliğe KATILIR: Premiere'in varsayılan adları ("Video Sequence") projeler arası
       tekrar ediyor. A1 okunamayan dalda clipsEnd yok ama sekans süresi (seqDur) elde —
       onu kullan, yoksa kimlik "<ad>_0"a çöker ve koruma kalkardı. */
    var sn = (_oturum.end > 0) ? Math.round(_oturum.end)
                               : ((_oturum.seqDur > 0) ? Math.round(_oturum.seqDur) : 0);
    return String(_oturum.name) + "_" + sn;
  }

  /* Emoji eşleşme kaydının anahtarı — İKİ FARKLI ÖMÜR.
       GERÇEK AD ("dora")   → KALICI: kadro sabit, Dora her videoda Dora.
       KANAL KODU ("a1")    → SEKANSA ÖZEL: o kod bir videoda Tofi, ötekinde Moni demek.
     ⚠ OKUMA VE YAZMA AYNI FONKSİYONU KULLANMAK ZORUNDA. Bir tarafı kalıcı, öteki tarafı
     sekansa özel anahtar kullanırsa kullanıcı seçim yapar, panel onu bulamaz ve HER BASIŞTA
     aynı soruyu sorar — çıkmaz sokak. (Tam bu hata bu pakette bir kez yazıldı ve yakalandı.) */
  function emojiEsleAnahtar(anahtar) {
    if (!emojiYerTutucuAd(anahtar)) return "emoji.esle." + anahtar;
    var k = sekansKimlik();
    return k ? ("emoji.esleV." + k + "." + anahtar) : "";   // kimlik yoksa kalıcılık YOK
  }

  /* ── KANAL → KARAKTER: AÇIK, GÖRÜNÜR, SEKANSA ÖZEL ──
     (kullanıcı isteği, 9 Ağustos 2026: "karakterleri sese göre seçmiş olalım, ona göre doğru
     eklesin timeline'a — yoksa görseldeki gibi yanlışlar oluyor".)
     Varsayılan hâlâ KANAL ADINDAN türetilir (Altyazı ekranındaki isim kutuları); bu liste
     onu EZEBİLİR ve asıl değeri şu: eşleşme artık basmadan ÖNCE ekranda görünüyor.
     ⚠ ANAHTAR SEKANSA ÖZEL. Kanal numarasının anlamı kadroya göre değişiyor (A4 bir videoda
     Sage, ötekinde Niko) — kalıcı saklamak sonraki videoda SESSİZCE yanlış yüzü koyardı.
     Aynı ders panelde iki kez alındı: AutoCut'ta acCh → acCh2_ göçü ve emoji eşleşmesinin
     numara yerine ADLA saklanması. */
  function emojiKanalKarAnahtar(idx) {
    var k = sekansKimlik();
    return k ? ("emoji.kanalKar." + k + "." + idx) : "";   // kimlik yoksa kalıcılık YOK
  }
  function emojiKanalKarOku(idx) { return String(lsGet(emojiKanalKarAnahtar(idx), "")); }

  /* Ekranda listelenecek kanallar: A1 her zaman + yazıya dökülen kanallar.
     Dönüş: [{idx, ad, klip}] — idx 0 = A1. */
  function emojiKanalListesi() {
    /* ALTYAZI SAYISI DA TAŞINIR — asıl merak edilen bu. Klip sayısı "bu kanalda ses var mı"
       der; emoji ise CÜMLEDEN çıkıyor, yani yazıya dökülmemiş bir kanal klip dolu olsa bile
       hiç emoji alamaz. Sıfır görünce kullanıcı sebebi anında anlıyor ("bu kanalı yazıya
       dökmemişim") ve boşuna karakter seçmeye çalışmıyor.
       Tek kaynak (A1/A2) modunda cue'lar singleCues'ta durur — o dal da sayılır. */
    function say(cues) { return (cues && cues.length) ? cues.length : 0; }
    var tekKaynak = (state.genMode !== "channels");
    var a1Say = tekKaynak ? (state.track === "1" ? 0 : say(state.singleCues)) : say(state.a1Cues);
    var out = [{ idx: 0, ad: a1Adi(), klip: -1, cue: a1Say }];
    try {
      if (tekKaynak && state.track === "1") {
        out.push({ idx: 1, ad: String(lsGet("kanalAd.1", "")).trim(), klip: -1, cue: say(state.singleCues) });
      } else {
        aktifKanallar().forEach(function (ch) {
          out.push({ idx: ch.idx, ad: kanalAdi(ch),
                     klip: (ch.clips != null ? ch.clips : -1), cue: say(ch.cues) });
        });
      }
    } catch (e) {}
    return out;
  }

  function emojiKanalKarCiz() {
    var box = $("emojiKanalKar"); if (!box) return;
    var durum = $("emojiKanalDurum");
    function dyaz(m, renk) { if (durum) { durum.textContent = m || ""; durum.style.color = renk || "var(--muted)"; } }
    box.innerHTML = "";
    if (!EMJ) { dyaz("emoji.js yüklenemedi — paneli yeniden kur.", "var(--bad)"); return; }
    var kok = String(lsGet("emoji.klasor", "")).trim() || emojiKlasorVarsayilan();
    var tarama = EMJ.tara(kok);
    if (tarama.hata) { dyaz(tarama.hata + "  (Ayarlar → Duygu Emojileri)", "var(--bad)"); return; }

    var kanallar = emojiKanalListesi();
    /* Kanal listesi yalnız "Herkes" modunda dolar; tek kaynakta A1 satırı yine görünür ve
       kullanıcı oradan seçebilir — "adını yaz ama kutu başka ekranda" çıkmazı olmasın. */
    var karakterler = tarama.karakterler.slice().sort(function (a, b) {
      return String(a.ad).localeCompare(String(b.ad), "tr");
    });
    var cozulen = [];
    kanallar.forEach(function (k) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap";
      var et = document.createElement("span");
      et.className = "dict-status";
      et.style.cssText = "min-width:190px";
      et.textContent = "A" + (k.idx + 1) + (k.idx === 0 ? " (senin mikrofonun)" : "") +
                       (k.ad ? (" · " + k.ad) : " · (isimsiz)") +
                       (k.cue > 0 ? (" · " + k.cue + " altyazı")
                                  : (k.klip >= 0 ? (" · " + k.klip + " klip · ALTYAZI YOK") : " · altyazı yok"));
    /* Altyazısı olmayan kanal SOLGUN gösterilir: emoji cümleden çıkıyor, o kanal karakter
       seçilse bile hiç emoji alamaz. Renk, kullanıcının boşuna uğraşmasını engelliyor. */
      if (!(k.cue > 0)) et.style.opacity = "0.55";
      var sar = document.createElement("div"); sar.className = "select";
      var sel = document.createElement("select");
      function opt(v, t) { var o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
      /* OTOMATİK = kanal adından türet (eski davranış). Kullanıcı bir şey seçmediyse bu. */
      var kendi = emojiKarakterAra(tarama, EMJ.asciiAnahtar(k.ad || ""));
      opt("", "otomatik" + (kendi ? (" → " + kendi.ad) : " → eşleşmedi"));
      karakterler.forEach(function (c) { opt(c.key, c.ad); });
      opt("__yok__", "emoji yok");
      /* ⚠ KAYITLI SEÇİM ARTIK LİSTEDE YOKSA MENÜ BOŞ GÖRÜNÜYORDU. Kullanıcı klasörden bir
         karakteri kaldırınca <option> da kalkıyor, `sel.value = <yok olan>` selectedIndex'i
         -1 yapıyor ve kutu tamamen boş çiziliyordu — neyin uygulanacağı ekrandan okunamıyor.
         Dahası kayıt localStorage'da KALIYOR: resimler sonradan geri gelirse (ya da
         "Emojileri Yeniden Kur" paketten getirirse) unutulmuş seçim sessizce diriliyordu.
         Şimdi geçersiz kayıt TEMİZLENİP "otomatik"e düşülüyor. */
      var kayitliSecim = emojiKanalKarOku(k.idx);
      if (kayitliSecim && kayitliSecim !== "__yok__" && !emojiKarakterAra(tarama, kayitliSecim)) {
        logLine("Emoji: A" + (k.idx + 1) + " için kayıtlı karakter (" + kayitliSecim +
                ") klasörde yok — seçim temizlendi, otomatiğe düşüldü.");
        lsSet(emojiKanalKarAnahtar(k.idx), "");
        kayitliSecim = "";
      }
      sel.value = kayitliSecim;
      (function (idx) {
        sel.addEventListener("change", function () {
          lsSet(emojiKanalKarAnahtar(idx), sel.value);
          emojiKanalKarCiz();      // özet satırı hemen tazelensin
        });
      })(k.idx);
      sar.appendChild(sel);
      row.appendChild(et); row.appendChild(sar);
      box.appendChild(row);

      var secim = sel.value;
      var son = secim === "__yok__" ? null : (secim ? emojiKarakterAra(tarama, secim) : kendi);

      /* ── O KARAKTERİN KAÇ RESMİ VAR (kullanıcı isteği, 9 Ağustos 2026: "kimin kaç tane
         emojisi kullanılabilir olduğu yazsın, düzgün import edilmiş mi ve videoda
         kullanılacak mı bilelim").
         Sayı = o karakterin klasördeki TOPLAM dosyası (varyantlar dahil), yani gerçekten
         ekrana çıkabilecek resim sayısı. Çeşitlilik kuralı bu havuzla sınırlı: havuz küçükse
         "aynı resim çok yakında tekrar etti" diye emoji ELENİYOR. 0 ise o kanal hiç emoji
         alamaz — kırmızı, çünkü sebebi (resim yok) ancak burada görülebilir. */
      var resimSay = 0;
      if (son) {
        (tarama.karakterDuygu[son.key] || []).forEach(function (d) {
          var vl = tarama.matris[d + "|" + son.key];
          resimSay += (vl && vl.length) ? vl.length : 0;
        });
      }
      var sy = document.createElement("span");
      sy.className = "dict-status";
      sy.style.cssText = "min-width:104px";
      if (secim === "__yok__") { sy.textContent = "emoji yok"; sy.style.opacity = "0.55"; }
      else if (!son) { sy.textContent = "karakter seçilmedi"; sy.style.color = "var(--warn)"; }
      else if (!resimSay) { sy.textContent = "0 resim!"; sy.style.color = "var(--bad)"; }
      else sy.textContent = resimSay + " resim · " + (tarama.karakterDuygu[son.key] || []).length + " tepki";
      row.appendChild(sy);

      cozulen.push({ idx: k.idx, ad: k.ad, kar: son, yok: secim === "__yok__", resim: resimSay });
    });

    /* ÖZET: kullanıcı basmadan önce tek bakışta görsün. Eşleşmeyen varsa SARI. */
    var eksik = cozulen.filter(function (x) { return !x.kar && !x.yok; });
    /* ÖZET SATIRI resim sayısını da taşır: "A2→Moni(13)". Kullanıcı tek bakışta hem kimin
       hangi kanalda olduğunu hem o kişinin kaç resmi olduğunu görüyor — "düzgün import
       edilmiş mi" sorusunun cevabı bu sayı. */
    var satir = cozulen.map(function (x) {
      return "A" + (x.idx + 1) + "→" + (x.yok ? "yok" : (x.kar ? (x.kar.ad + "(" + x.resim + ")") : "?"));
    }).join(" · ");
    var resimsiz = cozulen.filter(function (x) { return x.kar && !x.resim; });
    if (eksik.length) {
      dyaz("⚠ " + satir + "  —  " + eksik.length + " kanalın karakteri seçilmedi; " +
           "yanındaki menüden seç (ya da “emoji yok” de).", "var(--warn)");
    } else if (resimsiz.length) {
      /* Karakter seçili ama o karakterin klasörde hiç resmi yok — kanal sessizce emojisiz
         kalırdı. Sebep genelde eksik import ya da yanlış adlandırılmış dosya. */
      dyaz("⚠ " + satir + "  —  " + resimsiz.map(function (x) { return x.kar.ad; }).join(", ") +
           " için klasörde HİÇ resim yok; o kanal(lar) emoji almaz. " +
           "Ayarlar → “Emojileri Yeniden Kur”u dene.", "var(--bad)");
    } else {
      dyaz("✓ " + satir + "  ·  klasörde toplam " + tarama.dosyalar.length + " resim, " +
           tarama.karakterler.length + " karakter, " + tarama.duygular.length + " tepki çeşidi.",
           "var(--muted)");
    }
  }

  function emojiCumleleriTopla(tarama) {
    /* yokSay: "emoji yok" denen kanal sayısı. Sayılmazsa, bütün kanallar işaretliyken panel
       "Önce altyazı oluştur" diyordu — ekranda 800 altyazı dururken 25 dakikalık GPU işini
       tekrar etmeye yolluyordu. */
    var liste = [], elle = [], kisaAtilan = 0, yokSay = 0;

    /* a1 = bu kanal SENİN mikrofonun mu. Çağıran taraf biliyor; emojiEkle bunu "bu videoyu
       gerçekten X mi çekti" onayını YALNIZ A1 için sormak üzere kullanıyor. Adı karşılaştırıp
       tahmin etmek kırılgan olurdu (A1'in adı arkadaşınkiyle aynı olabilir). */
    function ekle(ad, cues, a1, yerTutucu, kanalIdx) {
      if (!cues || !cues.length) return;
      ad = String(ad || "").trim();
      /* ⚠ ADI BOŞ A1 "sen"E DÜŞMÜYOR, "A1" OLUYOR. Eski varsayılan "sen" idi ve emoji
         klasöründe öyle bir karakter olmadığı için A1'in bütün cümleleri sessizce
         eleniyordu (%48). "A1" adı da klasörde yok — ama bu SESSİZ bir eleme değil,
         aşağıdaki eşleştirme satırına düşüyor: kullanıcı "A1 (223 cümle) → Tofi" diye
         bir kez seçiyor ve iş bitiyor. Böylece ne sessiz düşüş kalıyor ne de "adını yaz
         ama kutu şu an gizli" çıkmazı (kanal listesi yalnız Herkes modunda görünüyor). */
      /* ⚠ YER TUTUCU ÇAĞIRANDAN GELİR. Sabit "A1" idi ve Kaynak Ses = A2 dalında adı boş
         olan ARKADAŞ kanalı da "A1" oluyordu — yani senin karakterine bağlanıyordu. */
      if (!ad) ad = yerTutucu || "A1";

      /* CUE DEĞİL CÜMLE. Kelime tavanı her zaman 2 olduğu için tek cue "arkanda creeper"
         gibi bir parça; yapay zekâya bunu vermek hem duygu seçimini kötüleştirir hem de
         satır sayısını (dolayısıyla cevabı) 5-6 katına çıkarır. vurucu.js'in cümle
         toplayıcısı zaten yüklü ve cumleId'ye göre birleştiriyor — onu kullan. */
      var cumleler = null;
      try { if (VUR && VUR.cumleleriCikar) cumleler = VUR.cumleleriCikar(cues); } catch (e) { cumleler = null; }
      var kayitlar = [];
      if (cumleler && cumleler.length) {
        cumleler.forEach(function (c) {
          var m = String(c.metin || "").trim();
          if (m) kayitlar.push({ ad: ad, bas: c.bas, bit: c.bit, metin: m });
        });
      } else {
        // Yedek: cümle toplayıcı yoksa cue'ları olduğu gibi kullan (eski davranış).
        cues.forEach(function (c) {
          var m = String(c.text || c.metin || "").trim();
          if (m) kayitlar.push({ ad: ad, bas: c.start, bit: c.end, metin: m });
        });
      }
      if (!kayitlar.length) return;

      /* ── EMOJİ EKRANINDAKİ AÇIK SEÇİM HER ŞEYİN ÖNÜNDE ──
         Kullanıcı "bu kanalda kim konuşuyor"u orada elle seçtiyse ad eşleşmesine hiç
         bakılmaz. Bu, ekranı süs olmaktan çıkaran satır: gördüğü şey gerçekten uygulanıyor.
         "__yok__" = bu kanal bilerek emojisiz (o karakterin resmi hiç olmayabilir). */
      var anahtar = EMJ.asciiAnahtar(ad);
      var elSecim = (kanalIdx != null) ? emojiKanalKarOku(kanalIdx) : "";
      if (elSecim === "__yok__") { yokSay++; return; }
      if (elSecim) {
        var elKar = emojiKarakterAra(tarama, elSecim);
        if (elKar) {
          var oncekiSayEl = kayitlar.length;
          kayitlar = kayitlar.filter(function (k) { return emojiKelimeSay(k.metin) >= EMOJI_MIN_KELIME; });
          kisaAtilan += (oncekiSayEl - kayitlar.length);
          if (!kayitlar.length) return;
          kayitlar.forEach(function (k) { k.kar = elKar; k.a1 = !!a1; liste.push(k); });
          return;
        }
        /* Seçilen karakter klasörden silinmişse seçim GEÇERSİZ — sessizce ada düşme, aşağıdaki
           normal yol çalışsın ve gerekirse eşleştirme satırı çıksın. */
      }
      var kar = emojiKarakterAra(tarama, anahtar);       // dosya adıyla birebir tutuyor mu
      if (!kar) {
        /* Klasörde karşılığı yok → kullanıcının BİR KEZ verdiği karara bak.
           ⚠ ANAHTAR ADIN KENDİSİ, KANAL NUMARASI DEĞİL: kanal numarasının anlamı kadroya
           göre değişiyor (AutoCut'ta acCh → acCh2_ göçünün sebebi buydu) ve numarayla
           saklarsak sonraki videoda A4 başka biri olur, panel SESSİZCE yanlış karakterin
           yüzünü koyar. */
        /* ⚠ KANAL KODUNA KAYITLI EŞLEŞME OKUNMAZ — "MONİ ÇEKTİ AMA TOFİ ÇIKTI" HATASININ
           İKİ SEBEBİNDEN BİRİ TAM OLARAK BUYDU. A1'in isim kutusu boşken ad "A1"e düşüyor,
           anahtar "emoji.esle.a1" oluyor ve bu kayıt VİDEODAN VİDEOYA taşınıyordu: kullanıcı
           bir kez "A1 → Tofi" dedikten sonra videoyu Moni çekse bile emojiEkle'deki bekleme
           kapısı (`if (!e.karar)`) hiç tetiklenmiyor, panel SESSİZCE Tofi'nin yüzünü koyuyordu.
           Tek iz katlanmış Ayrıntılar log'undaki bir satırdı, yani pratikte görünmez.
           Artık kanal kodunun kararı SEKANSA ÖZEL bir anahtarda tutuluyor (emojiEsleAnahtar):
           bu videoda bir kez seçilir, sonraki videoya TAŞINMAZ. Doğru çözüm yine A1 kutusuna
           adını yazmak; a1Adi() bunu Senkron kartındaki "kim çekiyor"dan da okuyabiliyor. */
        var kayit = String(lsGet(emojiEsleAnahtar(anahtar), ""));
        if (kayit && kayit !== "__yok__") {
          kar = emojiKarakterAra(tarama, kayit);
          if (!kar) kayit = "";                          // kayıtlı karakter klasörden silinmiş
        }
        elle.push({ ad: ad, cumle: kayitlar.length, karar: kayit });
        if (!kayit) return;                              // karar YOK → AI'ya gitmesin
        if (kayit === "__yok__") return;                 // bilerek emojisiz (resmi gerçekten yok)
      }
      /* ── KISA CÜMLELERİ AT — YAPAY ZEKÂYA GİTMEDEN ──
         Kullanıcı: "cümle 3 kelimelikse garip duruyo, 1 saniye gelmeden gidiyo."
         Eleme MODELE GİTMEDEN önce olmalı: gönderilip sonra atılan cümlenin parası ödenmiş
         olur — bu projede aynı hata bir kez yapıldı (cümlelerin %52'si plan döngüsünde
         eleniyordu).
         ⚠ AMA KARAKTER ÇÖZÜLDÜKTEN SONRA SAYILIR. Eleme yukarıdayken, emoji resmi hiç
         OLMAYAN ("emoji yok" işaretli) bir kanalın kısa cümleleri de sayıya giriyordu:
         durum satırı "40 kısa cümle elendi" diyor, kullanıcı 5 kelime eşiğini suçluyor,
         gerçek sebep ise o karakterin resminin olmaması oluyordu. Artık yalnız GERÇEKTEN
         emoji alacak kanalların kısaları sayılıyor. */
      var oncekiSay = kayitlar.length;
      kayitlar = kayitlar.filter(function (k) { return emojiKelimeSay(k.metin) >= EMOJI_MIN_KELIME; });
      kisaAtilan += (oncekiSay - kayitlar.length);
      if (!kayitlar.length) return;

      kayitlar.forEach(function (k) { k.kar = kar; k.a1 = !!a1; liste.push(k); });
    }

    /* KARAKTER ADI KANALDAN GELİR — ayrı bir "senin karakterin" ayarı YOK. */
    if (state.genMode === "channels") {
      ekle(a1Adi(), state.a1Cues, true, "A1", 0);
      aktifKanallar().forEach(function (ch) { ekle(kanalAdi(ch), ch.cues, false, "A" + (ch.idx + 1), ch.idx); });
    } else if (state.track === "1") {
      /* ⚠ KAYNAK SES = A2 → BU SENİN SESİN DEĞİL, ARKADAŞLARIN KARIŞIK KANALI.
         Eskiden bu dal da `a1Adi()` ile çağrılıyordu: A2'de konuşan Dora'nın 300 cümlesi
         SENİN karakterine bağlanıyor, bütün emojiler senin yüzün oluyordu — üstelik yeni
         taraf kuralıyla hepsi sağa gidip hiç aynalanmıyordu. Daha kötüsü: A1 kimlik kapısı
         "A1 (senin mikrofonun): Tofi → Tofi" diye gösterip "bu videoyu Tofi mi çekti?"
         diye soruyordu; cevap gerçekten "evet" olduğu için kullanıcı onaylıyor ve panel
         yanlışı İMZALIYORDU. Artık A2'nin kendi adı kullanılıyor ve a1 bayrağı YOK.
         Ad yoksa "A2" yer tutucusuna düşer → eşleştirme satırı çıkar, kullanıcı bir kez seçer
         (o seçim sekansa özel, bkz. emojiEsleAnahtar) ya da "emoji yok" der. */
      ekle(String(lsGet("kanalAd.1", "")).trim(), state.singleCues, false, "A2", 1);
    } else {
      /* TEK KAYNAK A1: cue'lar singleCues'ta, a1Cues BOŞ. Bu dal olmadan emoji
         "önce altyazı oluştur" diyordu — oysa altyazı ekranda duruyordu. */
      ekle(a1Adi(), state.singleCues, true, "A1", 0);
    }

    liste.sort(function (a, b) { return a.bas - b.bas; });
    /* ⚠ SIRA NUMARASI ZAMAN SIRALAMASINDAN SONRA VERİLİR. Eskiden numara kanal sırasında
       veriliyor, liste sonra zamana göre sıralanıyordu: 250'lik parçada modele "1, 224,
       2, 361…" diye zıplayan numaralar gidiyordu. Model numarayı değil SIRAYI yankılarsa
       cevap sessizce BAŞKA cümlelere denk gelir. */
    for (var i = 0; i < liste.length; i++) liste[i].sira = i + 1;
    return { liste: liste, elle: elle, kisa: kisaAtilan, yokSay: yokSay };
  }

  /* EŞLEŞMEYEN AD SATIRLARI — yalnız gerektiğinde. Hepsi tutuyorsa kutu gizli kalır:
     #trackStilBox'ın 7 kanallı kadroda ekranı 7 boş seçiciyle doldurma hatası
     tekrarlanmasın diye satır sayısı = çözülmemiş sorun sayısı.
     ⚠ SEÇİM KAYDEDİLİNCE OTOMATİK YENİDEN DENENMEZ: yapay zekâ çağrısı PARA harcıyor,
     tetiğini hep kullanıcı çekmeli. */
  function emojiEsleSatirlariCiz(elle, tarama) {
    var box = $("emojiEsleBox"); if (!box) return;
    box.innerHTML = "";
    if (!elle || !elle.length) { box.hidden = true; return; }
    box.hidden = false;
    // HER ZAMAN ALFABETİK (panel geneli kural) — kullanıcı seçeneğin yerini ezberliyor.
    var karakterler = tarama.karakterler.slice().sort(function (a, b) {
      return String(a.ad).localeCompare(String(b.ad), "tr");
    });
    elle.forEach(function (e) {
      var anahtar = EMJ.asciiAnahtar(e.ad);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap";
      var et = document.createElement("span");
      et.className = "dict-status";
      et.textContent = e.ad + " (" + e.cumle + " cümle) →";
      var sar = document.createElement("div"); sar.className = "select";
      var sel = document.createElement("select");
      function opt(v, t) { var o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
      opt("", "hangi karakter?");
      karakterler.forEach(function (k) { opt(k.key, k.ad); });
      /* "emoji yok" KALICI BİR SEÇENEK: bir karakterin resmi gerçekten olmayabilir (Sage) ve
         kullanıcının çizmekten başka çaresi yok. Bir kez işaretlensin, bir daha sorulmasın —
         preset.secili'nin adlarla saklanmasıyla aynı desen. */
      opt("__yok__", "emoji yok");
      sel.value = e.karar || "";
      /* ⚠ YAZMA, OKUMAYLA AYNI ANAHTAR FONKSİYONUNU KULLANIR (emojiEsleAnahtar). Kanal
         kodları ("A1") sekansa özel, gerçek adlar kalıcı. İkisi ayrışırsa kullanıcı seçim
         yapar ama panel bulamaz ve aynı soruyu sonsuza kadar sorar. */
      sel.addEventListener("change", function () { lsSet(emojiEsleAnahtar(anahtar), sel.value); });
      sar.appendChild(sel);
      row.appendChild(et); row.appendChild(sar);
      box.appendChild(row);
    });
  }

  /* ── EMOJİ SIKLIĞI ARTIK SABİT — SEÇİCİ KALDIRILDI (kullanıcı isteği, 8 Ağustos 2026:
        "az/orta/bol seçeneğine gerek yok, her zaman bol olsun, hatta bolden biraz fazla —
        videoda emoji olması iyi oluyor").
     Değer yapay zekâya "cümlelerin yaklaşık şu kadarını işaretle" diye gidiyor (hedefOran).

     ⚠ TAVANI YAPAY ZEKÂ BELİRLEMİYOR: emoji cümle boyunca ekranda kaldığı için asıl üst
     sınırı çakışma freni (EMOJI_GAP) ve SEÇİM PENCERESİ koyuyor. Bu yüzden oranı tek başına
     yükseltmek doyuma giriyor — kol İKİSİ birden çevrilmeli.

     ⚠ ESKİ NOT ("0.75 seçildi çünkü üstü boşa gidiyor, 0.85 tek emoji bile eklemiyor")
     TEK KANALLI dönemde ölçülmüştü. İki emoji kanalına (sol+sağ) geçildikten sonra yeniden
     ölçüldü — kullanıcının gerçek oturumu, 251 cue / 5 grup / 33 emojiye uygun cümle,
     plan döngüsü birebir canlandırılarak:
        oran\pencere    3.0 sn      2.2 sn
        0.75            22          24
        0.90            24          **26**
        0.95            26          28
     9 Ağustos 2026'da kullanıcı "emojileri biraz daha artıralım" dedi → **0.90 + 2.2 sn**
     seçildi: 22 → 26 emoji (+%18). 0.95'e çıkmak +%27 verirdi ama "biraz daha" isteğini aşar
     ve her emoji Premiere'de ~15 API turu demek (bkz. yerleştirme maliyeti). */
  var EMOJI_SIKLIK = 0.90;
  function emojiOran() { return EMOJI_SIKLIK; }

  /* EMOJİ PRESET SEÇİCİSİ — yalnız GERÇEKTEN öğrenilmiş yığınlar listelenir.
     Öğrenilmemiş bir adı listeye koymak "uyguladım ama hiçbir şey olmadı" üretirdi
     (preset kartındaki aynı kural: kayıtsız ad devre dışı gösterilir). */
  /* tazele = true → listeyi YENİDEN kur (Yenile düğmesi / lisans açıldıktan sonra).
     ⚠ ESKİ HÂLİ SEÇENEKLERİ TEMİZLEMİYOR, yalnız appendChild ile EKLİYORDU. İkinci çağrıda
     her preset ikinci kez listeye giriyordu; üstelik fonksiyon bir kez, AÇILIŞTA çağrıldığı
     için (a) lisans kilitliyken preset'ler henüz kurulmamış olduğundan menü ParsMazi'nin İLK
     oturumunda BOŞ kalıyor, (b) kullanıcı Preset ekranında bir preset öğretse menüde hiç
     görünmüyor, (c) sildiği preset ölü ad olarak menüde kalıyordu.
     _tazele dinleyiciyi de bir kez bağlar — her tazelemede yenisini eklemek, tek bir
     değişiklikte localStorage'a N kez yazardı. */
  var _emojiPresetBagli = false;
  function wireEmojiPreset(tazele) {
    var s = $("emojiPreset"); if (!s) return;
    var yig = {}; try { yig = presetYiginlar() || {}; } catch (e) { yig = {}; }
    var adlar = [], k;
    for (k in yig) if (Object.prototype.hasOwnProperty.call(yig, k)) adlar.push(k);
    adlar.sort(function (a, b) { return String(a).localeCompare(String(b), "tr"); });
    /* Listeyi baştan kur: ilk seçenek ("animasyon yok") korunur, kalanı silinir. */
    while (s.options.length > 1) s.remove(1);
    adlar.forEach(function (ad) {
      var o = document.createElement("option");
      o.value = ad; o.textContent = ad;
      s.appendChild(o);
    });
    var kayit = lsGet("emoji.preset", "");
    // Kayıtlı ad artık listede yoksa (preset silinmiş) sessizce "yok"a düş.
    s.value = (kayit && yig[kayit]) ? kayit : "";
    if (_emojiPresetBagli) return;
    _emojiPresetBagli = true;
    s.addEventListener("change", function () { lsSet("emoji.preset", s.value); });
  }

  /* EMOJİ Mİ DEĞİL Mİ — KARARI PANEL VERİR, DOSYA YOLUNA GÖRE.
     Host artık her kanalın TEKİL medya yollarını döndürüyor; burada her yol emoji klasörünün
     altında mı diye bakılıp `emoji` / `yabanci` klip sayıları hesaplanıyor.
     ⚠ ESKİDEN BİN'E BAKILIYORDU VE BU GERÇEK BİR HATAYA YOL AÇTI: `emojiYerlestir` içinde
     `createBin` başarısız olursa kod `bin = root`'a düşüyor ve PNG'ler proje KÖKÜNE import
     ediliyor; o zaman "Yusufwrl Emoji" bin'i hiç oluşmuyor, bin araması boş dönüyor ve panel
     KENDİ koyduğu emojileri kullanıcının görüntüsü sanıyor. Kullanıcının projesinde ölçüldü:
     5 katmanda 479 emoji birikmiş, panel hiçbirini tanımıyor, "Emojileri Sil" temizleyemiyor
     ve "boş kanal yok" diyor. Yol karşılaştırması bin'den bağımsız çalışır.
     Emoji klasörünün ALT klasörleri de emoji sayılır (Emoji\w) — onlar da bizim koyduğumuz. */
  function emojiKanalOzet(ek, kok) {
    var kk = String(kok || "").replace(/\\/g, "/").toLowerCase();
    if (kk && kk.charAt(kk.length - 1) !== "/") kk += "/";
    (ek.tracks || []).forEach(function (t) {
      var e = 0, y = 0;
      (t.yollar || []).forEach(function (o) {
        var py = String(o.y || "").replace(/\\/g, "/").toLowerCase();
        if (kk && py && py.indexOf(kk) === 0) { e += o.n; o.emoji = true; }
        else y += o.n;
      });
      t.emoji = e; t.yabanci = y;
    });
    return ek;
  }
  /* Silinecek medya yollarını dosyaya yaz — host onu okuyup YALNIZ o klipleri siler.
     Dosya kullanmanın sebebi proje geneli kural: evalScript string literaline gömülen Türkçe
     karakter kırılgan ve emoji klasörü "Masaüstü" içeriyor. */
  function emojiYolListesiYaz(ek, idx) {
    var yollar = [];
    (ek.tracks || []).forEach(function (t) {
      if (t.idx !== idx) return;
      (t.yollar || []).forEach(function (o) { if (o.emoji && o.y) yollar.push(o.y); });
    });
    if (!yollar.length) return "";
    var p = path.join(extRoot, "emoji_sil.txt");
    fs.writeFileSync(p, yollar.join("\n"), "utf8");
    return p;
  }

  /* ANA İŞ: karakteri eşleştir → duyguları seç → planı kur → timeline'a PARÇA PARÇA koy. */
  async function emojiEkle() {
    var dur = $("emojiDurum");
    /* ⚠ AYRI DEĞİŞKEN, `uyarilar` DİZİSİ DEĞİL. Yapay zekâ parçalarından bir kısmı ağ hatası
       yüzünden düşerse emoji.js bunu `uyari` alanında bildiriyor ("8 parçanın 3 tanesi
       alınamadı — bazı bölümlerde emoji yok") ama tüketici onu YALNIZ log'a yazıyordu ve
       sonuç mesajının "kısmi" kararı bu alana hiç bakmıyordu: plan küçük çıkar ama plandaki
       her şey konarsa panel YEŞİL "✓ 118/118 emoji kondu" diyordu. Videonun ortasındaki 10
       dakikada hiç emoji yok ve kullanıcı sebebini hiçbir yerde göremiyordu.
       ⚠ `uyarilar` dizisine push ETMEK ÇÖKERTİR: o dizi çok aşağıda (plan yerleştirme
       bloğunda) `var uyarilar = []` ile kuruluyor; buradan erişilse hoisting yüzünden değeri
       `undefined` olur ve "Cannot read property 'push' of undefined" ile emoji özelliği HER
       çalıştırmada tamamen çökerdi. */
    var secUyari = "";
    function yaz(m, renk) { if (dur) { dur.textContent = m || ""; dur.style.color = renk || "var(--muted)"; } }
    if (!CEP) { yaz("Premiere'de çalışır", "var(--warn)"); return; }
    if (!EMJ || !VUR) { yaz("Emoji modülü yüklenemedi — paneli yeniden kur", "var(--bad)"); return; }

    var kok = String(($("emojiKlasor") || {}).value || "").trim();
    var tarama = EMJ.tara(kok);
    if (tarama.hata) { yaz(tarama.hata, "var(--bad)"); return; }

    /* 1) EŞLEŞTİRME — YAPAY ZEKÂDAN ÖNCE. Eşleşmeyen kanalın cümlesi modele HİÇ gitmez;
       ölçüldü: eskiden 465 cümlenin 240'ının parası boşa ödeniyordu. */
    var top = emojiCumleleriTopla(tarama);
    emojiEsleSatirlariCiz(top.elle, tarama);
    var bekAd = [];
    top.elle.forEach(function (e) { if (!e.karar) bekAd.push(e.ad + " (" + e.cumle + " cümle)"); });
    if (bekAd.length) {
      /* Karar verilmemiş ad varken İSTEK GÖNDERME: deterministik, eşik ayarlamaya gerek yok
         ve karar bir kez verilince bir daha araya girmiyor. */
      yaz("Şu adların emoji resmi yok: " + bekAd.join(", ") +
          " — hemen aşağıdan karakterini seç (ya da “emoji yok” de), sonra tekrar bas.",
          "var(--warn)");
      return;
    }
    top.elle.forEach(function (e) {
      logLine("Emoji eşleştirme: " + e.ad + " → " +
              (e.karar === "__yok__" ? "emoji YOK (" + e.cumle + " cümle atlandı)" : e.karar));
    });

    var cumleler = top.liste;
    /* KISA CÜMLE ELEMESİ SESSİZ KALMAZ: emoji sayısı doğrudan bununla düşüyor ve sebebini
       bilmeyen kullanıcı başka yerde arar (sıklık artık sabit, çevrilecek bir kol yok). */
    if (top.kisa) logLine("Emoji: " + top.kisa + " cümle " + EMOJI_MIN_KELIME +
                          " kelimeden kısa olduğu için elendi — yapay zekâya hiç gitmedi.");
    if (!cumleler.length) {
      /* ÜÇ BAMBAŞKA SEBEP, ÜÇ AYRI MESAJ. "Önce altyazı oluştur" demek, altyazısı ekranda
         duran kullanıcıyı 25 dakikalık GPU işini tekrar etmeye yollardı.
         ⚠ SIRA ÖNEMLİ: "emoji yok" işareti kısa cümle elemesinden ÖNCE sorulur. Ters sırada,
         resmi olmayan bir karakter yüzünden boş kalan listede panel "hepsi kısa cümle" deyip
         kullanıcıyı 5 kelime eşiğini kurcalamaya yolluyordu. */
      yaz((top.elle.length || top.yokSay)
            ? "Bütün kanallar “emoji yok” işaretli — yukarıdaki listeden en az birine karakter seç."
            : (top.kisa
                ? ("Emoji konacak cümle kalmadı: " + top.kisa + " cümlenin hepsi " + EMOJI_MIN_KELIME +
                   " kelimeden kısa. Kısa cümlede emoji göz kırpması gibi duruyordu, o yüzden eleniyor.")
                : "Önce altyazı oluştur — emoji altyazı metninden seçiliyor"), "var(--warn)");
      return;
    }

    /* ANAHTAR KONTROLÜ BAŞTA. Sonda yapılırsa kullanıcı işin sonunda "anahtar yok" görür. */
    /* ⚠ AUTOCUT SONRASI BAYATLIK FRENI — ALTYAZIDA VARDI, EMOJIDE YOKTU.
       AutoCut boşlukları kesince timeline dakikalarca kısalıyor ama elde duran cue'lar eski
       zamanlarda kalıyor. placeCaptions bunu soruyor (cuesStale), emojiEkle ise hiç okumuyordu:
       panel önce yapay zekâya PARA ödüyor, sonra 300'e kadar PNG'yi kesim ÖNCESI zamanlara
       koyuyordu — hepsi kesilen süre kadar kaymış, tek uyarı yok. Aynı ekrandaki komşu düğme
       aynı durumda soruyor; emojinin sormaması tutarsızlıktı. */
    if (state.cuesStale) {
      var devamBayatE = await uiConfirm(
        "Bu altyazılar AutoCut kesiminden ÖNCE üretildi.\n\n" +
        "Kesim timeline'ı kısalttığı için emojiler de altyazılar gibi KAYAR — dakikalarca olabilir.\n\n" +
        "Doğrusu altyazıyı yeniden üretmek. Yine de devam edeyim mi?", "Emoji");
      if (!devamBayatE) { yaz("İptal edildi — altyazıyı yeniden üret, sonra emoji ekle.", "var(--warn)"); return; }
    }

    var anahtar = "";
    try { anahtar = VUR.anahtarOku(extRoot); }
    catch (e) { yaz("Yapay zekâ anahtarı yok — Ayarlar'dan ekle (emoji duyguyu ondan seçiyor)", "var(--bad)"); return; }

    /* ── A1 KİMLİK KAPISI — "MONİ ÇEKTİ AMA TOFİ ÇIKTI" HATASININ SON HALKASI ──
       Üç katmanlı korumanın üçüncüsü: (1) kanal koduna kayıtlı eşleşme artık okunmuyor,
       (2) Senkron kartındaki "kim çekiyor" seçimi kanal isimlerini yazıyor, (3) burada
       kullanıcıya BİR KEZ gösterilip onaylatılıyor.
       NEDEN GEREKLİ: A1'in adı localStorage'da (kanalAd.0) videodan videoya taşınıyor ve
       panel bunun HÂLÂ GEÇERLİ olup olmadığını hiçbir yerden bilemiyor — Moni'nin videosunda
       geçen ayki "Tofi" değeri sessizce doğru sanılıyordu. Ölçülemeyen bir şeyi tahmin etmek
       yerine SOR (aynı desen: capBasildi_<sekans> ve cuesStale onayları).
       SEKANS BAŞINA BİR KEZ: aynı videoda ikinci basışta soru tekrarlanmaz. Emoji özelliği
       para harcıyor ve 300 klip koyuyor; tek bir onay satırı, render'dan sonra fark edilen
       yanlış yüzden çok daha ucuz. */
    /* ⚠ KAPI A1'E DEĞİL EŞLEMENİN TAMAMINA BAĞLI. Önce yalnız A1 kaydına bakıyordu ve
       A1'den hiç cümle gelmediği durumlarda (adı "emoji yok" işaretli · A1 klipsiz ·
       A1'in bütün cümleleri yeni 5-kelime filtresine takıldı) kapı SESSİZCE devre dışı
       kalıyordu — üstelik tam da isimlerin bayat olduğu senaryoda. Artık cümle varsa
       eşleme her zaman gösteriliyor, A1 sorusu yalnız üstüne ekleniyor.
       HAFIZA OTURUMLUK (localStorage DEĞİL): anahtar sekans adına bağlıydı ve Premiere'in
       varsayılan adları ("Video Sequence") projeler arası tekrar ettiği için başka bir
       projenin onayı bu videoda soruyu susturabiliyordu — kapının önlemek için var olduğu
       hatanın ta kendisi. Panel kapanınca soru yeniden sorulur; emoji seyrek basılan ve
       para harcayan bir düğme, tek onay ucuz. */
    var a1Kayit = null, aq;
    for (aq = 0; aq < cumleler.length; aq++) { if (cumleler[aq].a1) { a1Kayit = cumleler[aq]; break; } }
    var esleme = [], gorulenAd = {}, sayimAd = {};
    cumleler.forEach(function (c) {
      var anh = c.ad + " → " + (c.kar ? c.kar.ad : "?");
      sayimAd[anh] = (sayimAd[anh] || 0) + 1;
      if (!gorulenAd[anh]) { gorulenAd[anh] = 1; esleme.push({ s: anh, a1: !!c.a1 }); }
    });
    var eslemeImza = esleme.map(function (e) { return (e.a1 ? "*" : "") + e.s; }).join(" | ");
    /* Kimlik bilinmiyorsa (sekans henüz okunmadı) hafıza KULLANILMAZ — soru her seferinde
       sorulur. Boş anahtarla saklamak, farklı sekansların onaylarını tek kutuda birleştirirdi. */
    var eslemeKimlik = sekansKimlik();
    if (!eslemeKimlik || _emojiEslemeOnay[eslemeKimlik] !== eslemeImza) {
      var satirlar = esleme.map(function (e) {
        return (e.a1 ? "  A1 (senin mikrofonun):  " : "  ") + e.s + "   (" + sayimAd[e.s] + " cümle)";
      });
      var soru = (a1Kayit && a1Kayit.kar)
        ? ("Bu videoyu " + a1Kayit.kar.ad + " mi çekti?\n\n" +
           "Değilse “Hayır” de ve hemen bu ekrandaki “Bu videoda kim hangi kanalda?” " +
           "listesinden A1'in karakterini seç, sonra Emoji Ekle'ye tekrar bas.")
        : ("Eşleşme doğru mu?\n\n(A1'den emoji alacak cümle çıkmadı. İsimler Altyazı " +
           "ekranındaki kanal listesinden geliyor.)");
      var onayA1 = await uiConfirm("Emoji karakterleri şöyle eşleşti:\n\n" + satirlar.join("\n") +
                                   "\n\n" + soru, "Emoji");
      if (!onayA1) {
        /* ⚠ MESAJ KULLANICININ BULUNDUĞU EKRANI GÖSTERİR. Eskiden Altyazı ekranındaki isim
           kutusunu tarif ediyordu; o kutu Kaynak Ses "Herkes" değilken EKRANDA HİÇ YOK ve
           kullanıcı çıkmaza giriyordu. Düzeltmenin doğru yeri artık bu ekranda. */
        yaz("İptal edildi — yukarıdaki kanal listesinden doğru karakterleri seç, sonra tekrar bas.",
            "var(--warn)");
        return;
      }
      if (eslemeKimlik) _emojiEslemeOnay[eslemeKimlik] = eslemeImza;
    }

    /* 2) HEDEF KANAL — ÖNCE MEVCUT EMOJİ KATMANINI SOR.
       ⚠ İKİNCİ BASIŞ TUZAĞI: panel eskiden her çalıştırmada "en üstteki BOŞ kanal"ı
       seçiyordu. İlk çalıştırmadan sonra o kanal dolu olduğu için ikinci basış BİR ÜST
       kanala İKİNCİ bir tam set koyuyor, her emoji ekranda iki kez çiziliyordu — host
       uyarmıyordu, çünkü o kanal gerçekten boştu. Üstte boş kanal yoksa da panel "Add Track
       ile ekle" diyerek tuzağı kullanıcıya kendi eliyle kurdurtuyordu. */
    var kanal = -1, kanal2 = -1, temizlenecekler = [], ek = null, enUstDolu = -1;
    try {
      /* ⚠ Bu fonksiyon host.jsx'te. host.jsx yalnız PREMIERE AÇILIRKEN yükleniyor — paneli
         kapat-aç yetmez. Eski host'ta fonksiyon tanımsız olduğu için JSON.parse patlar ve
         aşağıdaki catch'e düşer; mesaj bu yüzden "Premiere'i kapat-aç" diyor. */
      ek = JSON.parse(String(await evalES("emojiKanallariJSON()")));
      if (ek.error) { yaz("Sekans okunamadı: " + ek.error, "var(--bad)"); return; }
      emojiKanalOzet(ek, kok);          // emoji/yabanci sayıları YOLA göre burada hesaplanır
      var i, t;
      /* EN ÜSTTEKİ *YABANCI* KLİP — yani kullanıcının gerçek görüntüsü. Kendi emoji
         katmanımız bu hesaba GİRMEZ: girseydi ikinci çalıştırmada emoji katmanı "dolu
         kanal" sayılıp hedef bir üste kayardı ve tuzak geri gelirdi. */
      for (i = 0; i < ek.tracks.length; i++) if (ek.tracks[i].yabanci > 0) enUstDolu = ek.tracks[i].idx;
      /* Sadece emoji içeren kanalların HEPSİ temizlenir (birden çok katman birikmiş
         olabilir — eski davranış tam olarak bunu üretiyordu). */
      for (i = 0; i < ek.tracks.length; i++) {
        t = ek.tracks[i];
        if (t.emoji > 0 && t.yabanci === 0 && !t.kilit) temizlenecekler.push(t.idx);
      }
      /* HEDEF: yeniden kullanılabilir bir emoji katmanı, ama YALNIZ görüntünün ÜSTÜNDEYSE.
         ⚠ Bu kontrol düşerse emoji kullanıcının görüntüsünün ARKASINA gider; panel
         "başarılı" der ve kullanıcı ancak videoyu izlerken fark eder.
         EN ALTTAKİ uygun katman seçilir: üstte birikmiş katmanlar zaten temizleniyor ve
         kanal numarasını gereksiz yukarı taşımanın anlamı yok. */
      for (i = 0; i < temizlenecekler.length; i++) {
        if (temizlenecekler[i] > enUstDolu) { kanal = temizlenecekler[i]; break; }
      }
      if (kanal < 0) {
        for (i = 0; i < ek.tracks.length; i++) {
          t = ek.tracks[i];
          if (t.idx > enUstDolu && t.klip === 0 && !t.kilit) { kanal = t.idx; break; }
        }
      }
      /* ── İKİNCİ EMOJİ KANALI: SOL TARAF İÇİN ──
         (kullanıcı isteği, 9 Ağustos 2026: "Tofi konuşurken Mimi cevap verirse sol tarafa
         da aynı anda emoji gelebilsin".)
         ⚠ NEDEN İKİ KANAL ŞART: host emojiYerlestir klipleri overwriteClip ile koyuyor ve
         AYNI video kanalında zamanda örtüşen iki klip birbirini EZER. Sol ve sağ ekranda
         farklı yerlerde ama TIMELINE'da aynı anda; yani ancak ayrı kanallarda yan yana
         durabilirler.
         İkinci kanal bulunamazsa özellik SESSİZCE DÜŞMEZ: tek kanal moduna dönülür (fren
         yine ortak olur, yani eski davranış) ve sonuç mesajında SÖYLENİR. Kullanıcıya
         "Add Track ile bir kanal daha ekle" demek, yarısı ezilmiş bir emoji katmanından iyidir. */
      for (i = 0; i < ek.tracks.length; i++) {
        t = ek.tracks[i];
        if (t.idx === kanal) continue;
        if (t.idx > enUstDolu && !t.kilit &&
            (t.klip === 0 || (t.emoji > 0 && t.yabanci === 0))) { kanal2 = t.idx; break; }
      }
    } catch (e2) {
      /* En olası sebep host.jsx'in eski olması (emojiKanallariJSON yeni eklendi ve host
         yalnız Premiere açılırken yükleniyor) — tahmin ettirme, SÖYLE. */
      yaz("Video kanalları okunamadı: " + (e2.message || e2) +
          " — paneli kapatıp aç. Sürmüyorsa Ayrıntılar log'una bak — sebep genelde kilitli kanal, emoji klasörü yolu ya da proje bin'i.", "var(--bad)");
      logLine("Emoji: emojiKanallariJSON okunamadı — " + (e2.message || e2));
      return;
    }
    if (kanal < 0) {
      /* SEBEBİ ÖLÇÜP SÖYLE, KULLANICIYA TAHMİN ETTİRME. Kullanıcı ekranında boş kanal
         görürken panel "boş kanal yok" derse, ikisinden hangisinin yanıldığını ancak
         panelin GÖRDÜĞÜ sayılar ayırır: kanal kilitli olabilir, klip sayısı okunamamış
         olabilir (klip "?"), ya da mesaj kullanıcı kanalı eklemeden önceki denemeden
         kalmış olabilir. */
      var dokum = [], di, dt;
      for (di = 0; di < ((ek && ek.tracks) || []).length; di++) {
        dt = ek.tracks[di];
        dokum.push("V" + (dt.idx + 1) + ":" + (dt.klip < 0 ? "?" : dt.klip) +
                   (dt.kilit ? " KİLİTLİ" : "") + (dt.emoji ? " (" + dt.emoji + " emoji)" : ""));
      }
      yaz("Görüntünün ÜSTÜNDE boş video kanalı yok — kanal başlığına sağ tık → Add Track. " +
          "Panelin gördüğü: " + dokum.join(" · ") +
          " | en üst dolu: V" + (enUstDolu + 1), "var(--warn)");
      logLine("Emoji kanal dökümü: " + dokum.join(" · ") + " | en üst dolu kanal: V" + (enUstDolu + 1));
      return;
    }

    var btn = $("btnEmojiEkle"); if (btn) btn.disabled = true;
    /* İptal düğmesi yalnız iş sürerken görünür; bayrak her çalıştırmada sıfırlanır. */
    _emojiIptal = false;
    var _btnIptal = $("btnEmojiIptal"); if (_btnIptal) _btnIptal.hidden = false;
    yaz("duygular seçiliyor… (" + cumleler.length + " cümle)");
    try {
      /* 3) DUYGU SEÇİMİ. İPTAL DAMGASI ŞART — null GEÇİLMEZ (iptalEdildiMi "sayaç !== damga"
         diye bakıyor ve sayaç 0 ile başlıyor: null geçilirse her istek gönderilmeden
         "İptal edildi" ile reddediliyordu). */
      /* karakterDuygu ŞART: havuz karakter başına değişiyor (Tofi 14 duygu, diğerleri 5).
         Geçilmezse model bir karakterde olmayan duyguyu seçer ve o cümle sessizce düşer. */
      var sec = await EMJ.duygulariSec(VUR, anahtar, cumleler, tarama.duygular,
                                       { hedefOran: emojiOran(), karakterDuygu: tarama.karakterDuygu },
                                       VUR.iptalDamgasi(), logLine);
      if (sec.hata) { yaz(sec.hata, "var(--bad)"); return; }
      if (sec.uyari) { secUyari = sec.uyari; logLine("Emoji UYARI: " + sec.uyari); }
      var isaret = sec.secimler.length;
      logLine("Emoji: yapay zekâ " + isaret + " cümlede duygu buldu (" + cumleler.length + " cümle içinden).");

      /* 4) PLAN. Karakter zaten eşleşmiş (c.kar); burada yalnız aralık freni + dosya bulma. */
      var indeks = {}; cumleler.forEach(function (c) { indeks[c.sira] = c; });
      var seqW = 1920, seqH = 1080;
      try {
        var si = JSON.parse(String(await evalES("getSequenceInfoJSON()")));
        // Alan adları getSequenceInfoJSON'daki gibi: frameWidth/frameHeight
        if (si && si.frameWidth > 0 && si.frameHeight > 0) { seqW = si.frameWidth; seqH = si.frameHeight; }
      } catch (eS) {}
      /* İKİ KONUM: Tofi/Moni sağ alt, konuklar sol alt (bkz. EMOJI_SAG_KARAKTER).
         Karakter başına hesaplamaya gerek yok — yalnız iki değer var, döngüde seçiliyor. */
      var konSag = emojiKonum(seqW, seqH, true);
      var konSol = emojiKonum(seqW, seqH, false);

      /* SOL TARAF RESİMLERİ YATAY AYNALANIR — karakter ekranın DIŞINA değil İÇİNE baksın.
         Ayna kopyaları <emoji klasörü>\ayna\ altında ÖNBELLEKLENİR: ilk çalıştırmada üretilir
         (ölçüldü: 1000px resim ~100 ms, 2000px ~280 ms), sonrasında hazır. Kaynak resim
         yeniden kaydedilirse mtime karşılaştırmasıyla kendiliğinden tazelenir.
         ⚠ ÜRETİLEMEZSE EMOJİ DÜŞMEZ: özgün resim aynalanmadan konur ve sayılır. Ters bakan
         bir emoji, hiç olmayan emojiden iyidir — ama sessiz kalmaz, sonuç mesajına yazılır. */
      /* ⚠ HATA SAYIMI EMOJİ BAŞINA DEĞİL DOSYA BAŞINA. Emoji sayarsak sayı iki yerden
         şişiyordu: (a) aynı dosya planda onlarca kez geçiyor, (b) plan tavana takılıp
         SEYRELTİLİYOR ve seyreltilen emojiler de sayılmış oluyordu. Kullanıcıya gösterilen
         her sayı gerçekten olan bir şeyi saymalı — "3 resim aynalanamadı" doğrulanabilir,
         "47 emoji aynalanamadı" değil. */
      var aynaBellek = {}, aynaHataDosya = {}, aynaHataAd = "";
      function aynaHataSay() {
        var n = 0, k;
        for (k in aynaHataDosya) if (Object.prototype.hasOwnProperty.call(aynaHataDosya, k)) n++;
        return n;
      }
      function aynaliYol(yol) {
        if (!AYNA) { aynaHataDosya[yol] = 1; aynaHataAd = "pngayna.js yüklenemedi"; return yol; }
        if (aynaBellek[yol] !== undefined) return aynaBellek[yol] || yol;
        var r;
        try { r = AYNA.aynaYolu(kok, yol); } catch (eAy) { r = { yol: "", hata: (eAy.message || eAy) }; }
        if (!r || !r.yol) {
          aynaBellek[yol] = "";
          aynaHataDosya[yol] = 1;
          if (!aynaHataAd) aynaHataAd = String((r && r.hata) || "bilinmeyen sebep");
          logLine("Emoji aynalanamadı: " + yol + " → " + ((r && r.hata) || "?"));
          return yol;
        }
        aynaBellek[yol] = r.yol;
        if (r.uretildi) logLine("Emoji aynası üretildi: " + r.yol);
        return r.yol;
      }

      var plan = [], planSag = [], planAyna = [], sonBitisSag = -999, sonBitisSol = -999;
      /* tarafDolu: aynı pencerede o TARAF zaten dolduğu için denenmeyen aday. Ayrı sayaç şart —
         `yakin`e katılsaydı iki taraflı seçimin gerçekten çalışıp çalışmadığı log'da görünmezdi. */
      var atlanan = { yakin: 0, dosyaYok: 0, boyutYok: 0, tarafDolu: 0 };
      var sureTop = 0, kisaltilan = 0, varyantSay = {}, tarafSay = { sag: 0, sol: 0 };
      /* KAÇ FARKLI RESİM KULLANILDI — "45 emojim var ama projede 24 tane görüyorum, kalanı
         kullanmıyor mu?" sorusunun cevabı (kullanıcı sordu, 8 Ağustos 2026).
         Cevap çoğu zaman masum: videoda OLMAYAN karakterin resmi kullanılamaz. Ama panel
         bunu hiç söylemiyordu, yani kullanıcı ancak proje penceresindeki öğe sayısına bakıp
         tahmin edebiliyordu. Artık kullanılan çeşit, BU KADRODA kullanılabilir olanla
         birlikte yazılıyor — oran düşükse gerçekten bakılacak bir şey var demektir. */
      var kullanilanDosya = {}, duyguSay = {};

      /* ÇEŞİTLİLİK SAYAÇLARI + İKİ KLAMP.
         ⚠ HER İKİ EŞİK DE KLAMPLANMAK ZORUNDA — yoksa kural KENDİ KENDİNİ KİLİTLİYOR
         (ikisi de gerçek 22 dk'lık oturumda ölçüldü):
         · Planda TEK karakter varsa (Kaynak Ses = A1) "4 başka karakter" ASLA sağlanamaz →
           her dosya videoda BİR KEZ kullanılabilir: 94 → 14 emoji. Klampla 93.
         · Duygu havuzu 2 olan bir karakterde "2 aynı-farklı" asla sağlanamaz → o karakter
           videoda toplam 2 emoji alır (herkeste 2 duygu olsa 148 → 8). Klampla 64.
         Kullanıcı klasöre resim ekleyerek havuzu büyütüyor; bu senaryolar teorik DEĞİL. */
      var planKar = {}, planKarSay = 0;
      sec.secimler.forEach(function (s) {
        var pc = indeks[s.sira];
        if (pc && pc.kar && !planKar[pc.kar.key]) { planKar[pc.kar.key] = 1; planKarSay++; }
      });
      var cesGerekBaska = (planKarSay >= 2) ? CES_BASKA : 0;
      var konmus = [];                        // PLANA GİREN emojiler: {k: karakterKey, d: duyguKey}
      var cesit = { atlandi: 0, ikinci: 0 };

      /* true = bu dosya ŞU AN kullanılamaz. Geriye YALNIZ pencere kadar tarar; aynı dosyaya
         çarpınca karar verir, iki koşul da dolunca erken çıkar. */
      function cesitIhlal(karKey, duygu) {
        var havuz = (tarama.karakterDuygu && tarama.karakterDuygu[karKey]) || [];
        var gerekAyni = Math.min(CES_AYNI, Math.max(0, havuz.length - 1));
        var baska = 0, ayni = 0, i, x;
        var alt = Math.max(0, konmus.length - CES_PENCERE);
        for (i = konmus.length - 1; i >= alt; i--) {
          x = konmus[i];
          if (x.k === karKey && x.d === duygu) return !(baska >= cesGerekBaska && ayni >= gerekAyni);
          if (x.k !== karKey) baska++; else ayni++;
          if (baska >= cesGerekBaska && ayni >= gerekAyni) return false;
        }
        return false;                         // pencere içinde hiç kullanılmamış
      }

      /* Adayları tek diziye al (indeks araması bir kez) ve ZAMANA göre sırala. */
      var adaylar = [];
      sec.secimler.forEach(function (s) {
        var ac = indeks[s.sira];
        if (ac) adaylar.push({ s: s, c: ac });
      });
      adaylar.sort(function (a, b) { return a.c.bas - b.c.bas; });
      var karSay = {};                        // karakter -> plana giren emoji sayısı (denge için)

      /* Bir adayı plana koymayı dener. true = kondu, false = elendi (sebep sayaçlara yazıldı). */
      function denePlanaEkle(s, c) {
        /* ÇEŞİTLİLİK — sıra: (1) yapay zekânın duygusu, (2) yapay zekânın 2. tercihi, (3) ATLA.
           ⚠ KÖR DEĞİŞTİRME YOK: karakterin havuzundan "en uzun süredir kullanılmayan"ı seçmek
           hacmi kurtarıyor (-%1) ama emojilerin %35-44'ünü modelin SEÇMEDİĞİ duyguyla
           gösteriyor (ölçüldü) — duygu doğruluğu için ödenen isteği çöpe atmak olurdu.
           Sadece-atla politikası da ölçüldü: -%30 hacim, yani "az emoji" şikâyetini geri
           getiriyor. 2. tercihle kayıp -%8'de kalıyor. */
        /* ── ÇEŞİT TERCİHİ: İKİSİ DE UYUYORSA AZ KULLANILMIŞ OLANI AL ──
           (kullanıcı isteği, 8 Ağustos 2026: "genel olarak tüm emojileri kullanmaya çalışsın,
           farklı olmaları daha eğlenceli — ama tabii ki cümlelere uyuyorsa".)
           ⚠ FİT KAYBI YOK, ve bu şart: seçilen iki duygunun İKİSİNİ de yapay zekâ TAM BU
           CÜMLE İÇİN seçti (duygu = en uygun, duygu2 = ikinci en uygun). Yani "uymayan ama
           kullanılmamış" bir resme geçmiyoruz — yalnızca ikisi de uyuyorken beraberliği
           çeşitlilik lehine bozuyoruz.
           ⚠ KÖR DEĞİŞTİRME HÂLÂ YASAK: karakterin havuzundan "en uzun süredir kullanılmayan"ı
           seçmek denenmişti ve emojilerin %35-44'ünü modelin SEÇMEDİĞİ duyguyla gösteriyordu
           (ölçüldü) — burada aday kümesi yalnız modelin verdiği İKİ duygu. */
        var birinci = s.duygu;
        var ikinci = (s.duygu2 && s.duygu2 !== birinci) ? s.duygu2 : "";
        var ihlal1 = cesitIhlal(c.kar.key, birinci);
        var ihlal2 = ikinci ? cesitIhlal(c.kar.key, ikinci) : true;
        var duygu;
        if (!ihlal1 && !ihlal2) {
          var say1 = duyguSay[c.kar.key + "|" + birinci] || 0;
          var say2 = duyguSay[c.kar.key + "|" + ikinci] || 0;
          if (say2 < say1) { duygu = ikinci; cesit.ikinci++; } else duygu = birinci;
        } else if (!ihlal1) duygu = birinci;
        else if (!ihlal2) { duygu = ikinci; cesit.ikinci++; }
        else { cesit.atlandi++; return false; }
        /* matris artık VARYANT LİSTESİ: aynı duygu+karakter için birden çok resim olabilir
           ("Heyecanlı Tofi.png" + "Heyecanlı Tofi 2.png"). Eskiden ikincisi birinciyi
           sessizce eziyordu; şimdi sırayla dönülüyor — aynı duygu tekrar geldiğinde farklı
           resim çıkıyor, yani çeşitlilik bedava artıyor. */
        var vList = tarama.matris[duygu + "|" + c.kar.key];
        if (!vList || !vList.length) { atlanan.dosyaYok++; return false; }
        var vAnah = duygu + "|" + c.kar.key;
        var vSira = varyantSay[vAnah] || 0;
        var png = vList[vSira % vList.length];
        /* Boyutu okunamayan PNG'yi ALMA: ölçek doğru hesaplanamaz ve resim ekranı
           kaplayabilir. Sessizce atlanmaz, sayılır ve log'a yazılır.
           ⚠ varyantSay bu kontrolden SONRA artar: plana girmeyen aday varyant sırasını
           ilerletmemeli (eski kodda ilerletiyordu — zararsızdı ama yanlıştı). */
        if (!png.h) { atlanan.boyutYok++; return false; }
        varyantSay[vAnah] = vSira + 1;
        /* EMOJİ CÜMLE BOYUNCA KALIR. Taban/tavan yalnız emniyet — ölçülen cümlelerin hepsi
           zaten bu aralıkta (0.80-6.41 sn). Tavana çarpan varsa SAYILIR, sessiz kalmaz. */
        var sure = c.bit - c.bas;
        if (!isFinite(sure) || sure < EMOJI_MIN_SURE) sure = EMOJI_MIN_SURE;
        if (sure > EMOJI_MAX_SURE) { sure = EMOJI_MAX_SURE; kisaltilan++; }
        /* TARAF: Tofi/Moni sağda, konuklar solda. Soldakinin resmi aynalanır — HOST'A EK BİR
           ALAN GİTMİYOR, ayna kararı dosya YOLUNA gömülü. Böylece host.jsx (ES3) hiç
           değişmiyor ve plan satırının 8 alanlı biçimi olduğu gibi kalıyor. */
        var sagMi = emojiSagMi(c.kar.key, c.a1);
        /* ⚠ GRUPTAN SEÇİLEN ADAY KENDİ TARAFINDA UYGUN OLMAK ZORUNDA. Ana döngü grubu
           İLK adayın frenine göre açıyor; grup içinden başka bir taraf seçilirse o tarafın
           freni ayrıca kontrol edilmeli, yoksa aynı kanalda üst üste binen iki klip doğar
           ve host ikincisini sessizce atar. */
        if (c.bas < (kanal2 < 0 ? sonBitisSag : (sagMi ? sonBitisSag : sonBitisSol)) + EMOJI_GAP) {
          atlanan.yakin++; return false;
        }
        var kon = sagMi ? konSag : konSol;
        var pngYol = sagMi ? png.yol : aynaliYol(png.yol);
        plan.push([pngYol, (sagMi || kanal2 < 0) ? kanal : kanal2, c.bas.toFixed(3), sure.toFixed(3),
                   kon.x, kon.y, EMJ.olcekHesapla(png, seqH, EMOJI_ORAN),
                   png.duygu + " " + png.karakter].join("|"));
        /* ⚠ TARAF VE AYNA BİLGİSİ PLANA PARALEL DİZİLERDE. Plan satırından geri çıkarım
           YAPILMIYOR: x alanına bakmak dikey sekansta (iki taraf da 0.5'e kelepçelenince)
           yanlış okuyor, yol dizgisinde "/ayna/" aramak da kırılgan. Diziler seyreltmede
           planla BİRLİKTE süzülüyor, böylece kullanıcıya gösterilen sayılar gerçekten
           timeline'a konan emojileri sayıyor. */
        planSag.push(!!sagMi);
        planAyna.push(!sagMi && !aynaBellek[png.yol]);   // sol ama aynası üretilememiş
        kullanilanDosya[png.yol] = 1;                    // kaç FARKLI resim kullanıldı (rapor)
        /* ⚠ konmus.push BÜTÜN ELEMELERDEN SONRA, plan.push ile AYNI yerde: plana girmeyen bir
           aday çeşitlilik penceresini yememeli. (Hemen üstteki varyantSay sayacı bu hatayı
           yapıyor — boyutu okunamayan dosya da varyant sırasını ilerletiyor; zararsız ama
           örnek alınmamalı.) */
        konmus.push({ k: c.kar.key, d: duygu });
        /* Karakter+duygu başına kullanım sayacı — yukarıdaki "az kullanılmışı tercih et"
           kararı buna bakıyor. konmus penceresi yalnız SON 6'ya bakıyor, bu ise VİDEO
           BOYUNCA sayıyor: çeşitlilik kuralı "üst üste gelmesin", bu ise "hepsi kullanılsın". */
        duyguSay[c.kar.key + "|" + duygu] = (duyguSay[c.kar.key + "|" + duygu] || 0) + 1;
        karSay[c.kar.key] = (karSay[c.kar.key] || 0) + 1;
        /* ⚠ FREN TARAF BAŞINA. İki kanal varken sol ve sağ birbirini engellemez —
           "Tofi konuşurken Mimi cevap verdi" durumunda ikisi de ekrana gelir. Tek kanal
           moduna düşüldüyse (kanal2 < 0) ikisi de AYNI freni paylaşır, yani eski davranış. */
        if (kanal2 < 0) { sonBitisSag = c.bas + sure; sonBitisSol = sonBitisSag; }
        else if (sagMi) sonBitisSag = c.bas + sure;
        else sonBitisSol = c.bas + sure;
        sureTop += sure;
        return true;
      }

      /* ANA DÖNGÜ — ÇAKIŞMA FRENİ + KARAKTER DENGESİ.
         Çakışma freni aynı anda zaten TEK emoji bırakıyor. Eskiden o aralıktaki EN ERKEN
         aday alınıyordu; artık aynı SEÇİM PENCERESİ içindeki adaylar bir grup sayılıp
         gruptan o ana kadar EN AZ emoji almış karakterinki tercih ediliyor. Emoji SAYISI
         neredeyse aynı kalır, yalnız kimin emojisi olduğu dengelenir. */
      /* ── KONUK HEDEFİ: HER 2 CÜMLEDEN 1'İ ──
         `karCumleSay` = o karakterin kaç ADAY cümlesi var (yapay zekânın işaretledikleri).
         `emojiAcik` = hedefin ne kadar altında kaldığı. Kanal sahiplerinde (Tofi/Moni ve A1)
         hedef YOK — onlar zaten çok konuşuyor; hedef koymak konuğun önüne geçmelerine yol
         açardı. Açık negatifse 0 sayılır, yani hedefi tutturan konuk sıradan sıraya döner. */
      var EMOJI_KONUK_HEDEF = 0.5;
      var karCumleSay = {}, a1Kar = {};
      adaylar.forEach(function (x) {
        var kk = x.c.kar.key;
        karCumleSay[kk] = (karCumleSay[kk] || 0) + 1;
        /* A1 rolü karakter anahtarına TAŞINIR: kota kuralı ile fren kuralı aynı
           sınıflandırmayı kullanmak zorunda (aşağıya bak). OR'lama, aynı karakter hem A1 hem
           başka bir kanalda görünürse onu "sahip" tarafına düşürüp emojiFren ile tutarlı kalır. */
        a1Kar[kk] = a1Kar[kk] || !!x.c.a1;
      });
      function emojiAcik(karKey) {
        /* ⚠ A1 ROLÜ HESABA KATILMAK ZORUNDA. emojiSagMi iki kuraldan oluşuyor: (a) sahiplik
           listesi (Tofi/Moni), (b) A1 rolü. Burada ikinci argüman sabit `false` geçiliyordu,
           yani YALNIZ liste kuralı çalışıyordu — oysa emojiFren aynı soruyu `c.a1` ile
           soruyor. Sonuç: A1'in karakteri listede değilse AYNI karakter fren tarafında
           "kanal sahibi", kota tarafında "konuk" sayılıyordu. Konuk kotası aday cümle
           sayısıyla çarpıldığı için en çok konuşan A1 en büyük "açık" değerini alıyor ve
           grup sıralamasında sürekli öne geçiyordu — özelliğin engellemek için yazıldığı
           şeyin tam tersi. Kadrosunda ne Tofi ne Moni olan ikinci kullanıcıda (ParsMazi)
           "kızlarda da görünsün" diye eklenen denge, emojilerin çoğunu A1'e yiyordu. */
        if (emojiSagMi(karKey, a1Kar[karKey])) return 0;
        var hedef = (karCumleSay[karKey] || 0) * EMOJI_KONUK_HEDEF;
        var acik = hedef - (karSay[karKey] || 0);
        return acik > 0 ? acik : 0;
      }

      /* Bir adayın tabi olduğu fren: kendi tarafınınki. */
      function emojiFren(c) {
        if (kanal2 < 0) return sonBitisSag;
        return emojiSagMi(c.kar.key, c.a1) ? sonBitisSag : sonBitisSol;
      }
      var ai = 0, aj, grup, gi, t0;
      while (ai < adaylar.length) {
        /* Aday KENDİ tarafının frenine bakar. Grup kurulurken de aynı kural geçerli:
           bir pencerede sağ dolu ama sol boşsa, soldaki aday hâlâ konabilir. */
        if (adaylar[ai].c.bas < emojiFren(adaylar[ai].c) + EMOJI_GAP) { atlanan.yakin++; ai++; continue; }
        t0 = adaylar[ai].c.bas; aj = ai; grup = [];
        while (aj < adaylar.length && adaylar[aj].c.bas < t0 + EMOJI_SECIM_PENCERE) {
          grup.push(adaylar[aj]); aj++;
        }
        /* ── KONUK ÖNCELİĞİ: HER 2 CÜMLEDEN 1'İ ──
           (kullanıcı isteği, 9 Ağustos 2026: "Tofi/Moni dışındaki kızlar için, uyuşuyorsa
           emoji her zaman kullanılmaya çalışılsın, 2 cümlede 1 kesin olsun".)
           Konuklar (Dora, Mimi…) az konuşuyor; aynı pencerede kanal sahibiyle yarışınca
           videoda az görünüyorlardı. Artık sıralama ham sayıya değil **AÇIĞA** bakıyor:
           açık = (o karakterin cümlesi × hedef) − şimdiye kadar konan. Hedefin altındaki
           konuk her zaman öne geçiyor.
           ⚠ FİT KAYBI YOK: sıra yalnızca AYNI PENCEREDEKİ adaylar arasında değişiyor ve
           adayların hepsini yapay zekâ zaten işaretledi. Uymayan bir cümle öne çekilmiyor.
           ⚠ KANAL SAHİBİNE HEDEF KONMUYOR: onlar zaten çok konuşuyor, hedef koymak konuğun
           önüne geçmelerine yol açardı. */
        grup.sort(function (a, b) {
          var ka = a.c.kar.key, kb = b.c.kar.key;
          var aa = emojiAcik(ka), ab = emojiAcik(kb);
          if (aa !== ab) return ab - aa;          // açığı BÜYÜK olan önce (hedefin altındaki konuk)
          var fa = karSay[ka] || 0, fb = karSay[kb] || 0;
          if (fa !== fb) return fa - fb;          // az emoji almış karakter önce
          return a.c.bas - b.c.bas;               // eşitse en erken
        });
        /* ⚠ BAYRAK TARAF BAŞINA — AYNI PENCEREDE HEM SAĞ HEM SOL KONABİLMELİ.
           Eski hâlde tek bir `kondu` vardı: gruptan İLK başarılı yerleştirmede döngü duruyor,
           hemen ardından `ai = aj` ile pencerenin GERİ KALAN adayları atlanıyordu. Yani
           denePlanaEkle içindeki fren ve emojiFren taraf başına ayrılmış olmasına rağmen o
           frenlere hiç ULAŞILMIYOR, soldaki aday ikinci kanala konabilecekken denenmeden
           düşüyordu. Hemen üstteki yorumun ("Tofi konuşurken Mimi cevap verdi durumunda ikisi
           de ekrana gelir") tarif ettiği davranışı döngü uygulamıyordu: v1.9.17'nin iki emoji
           kanalı oluşuyor, sonuç mesajı "V7 sağ · V8 sol" diyor, ama 3 sn içindeki karşılıklı
           konuşmada ikinci emoji hiç çıkmıyordu.
           kanal2 < 0 iken (tek kanal) İKİ BAYRAK BİRLİKTE kurulur — yoksa aynı kanala üst
           üste klip konardı. */
        var konduSag = false, konduSol = false, gSag;
        for (gi = 0; gi < grup.length && !(konduSag && konduSol); gi++) {
          gSag = emojiSagMi(grup[gi].c.kar.key, grup[gi].c.a1);
          if (gSag ? konduSag : konduSol) { atlanan.tarafDolu++; continue; }
          if (denePlanaEkle(grup[gi].s, grup[gi].c)) {
            if (kanal2 < 0) { konduSag = true; konduSol = true; }
            else if (gSag) konduSag = true;
            else konduSol = true;
          }
        }
        ai = (aj > ai) ? aj : (ai + 1);
      }

      if (!plan.length) { yaz("Uygun emoji çıkmadı (aralık/dosya eşleşmedi) — Ayrıntılar'a bak", "var(--warn)"); return; }
      /* TAVAN AŞILIRSA REDDETME, SEYRELT. Host'un eski davranışı (plan > 100 → "err:") tek
         emoji koymadan bütün işi çöpe atıyordu. */
      if (plan.length > EMOJI_PANEL_TAVAN) {
        var hamSay = plan.length, adim = hamSay / EMOJI_PANEL_TAVAN, ix, kx;
        var seyrek = [], seyrekSag = [], seyrekAyna = [];
        for (ix = 0; ix < EMOJI_PANEL_TAVAN; ix++) {
          kx = Math.floor(ix * adim);
          /* ⚠ ÜÇ DİZİ AYNI İNDEKSLE SÜZÜLÜR. Yalnız plan seyreltilseydi taraf ve ayna
             sayıları ham plana ait kalır, kullanıcıya timeline'da olmayan emojiler
             raporlanırdı (300 klip konarken "450 resim aynalanamadı" gibi). */
          seyrek.push(plan[kx]); seyrekSag.push(planSag[kx]); seyrekAyna.push(planAyna[kx]);
        }
        plan = seyrek; planSag = seyrekSag; planAyna = seyrekAyna;
        logLine("Emoji: " + hamSay + " aday vardı, tavan " + EMOJI_PANEL_TAVAN + " — eşit aralıkla seyreltildi.");
      }
      /* TARAF VE AYNA SAYIMI SEYRELTMEDEN SONRA, PARALEL DİZİLERDEN. */
      var aynasizKondu = 0;
      tarafSay.sag = 0; tarafSay.sol = 0;
      for (var tz = 0; tz < plan.length; tz++) {
        if (planSag[tz]) tarafSay.sag++; else tarafSay.sol++;
        if (planAyna[tz]) aynasizKondu++;
      }
      /* ÇEŞİT RAPORU: kaç FARKLI resim kullanıldı / bu kadroda kullanılabilir kaç resim vardı.
         Payda kasıtlı olarak KLASÖRÜN TAMAMI DEĞİL: videoda olmayan karakterin resmi zaten
         kullanılamaz, onu paydaya koymak her videoda haksız bir "az kullanıyor" izlenimi
         verirdi. Kadro = konuşan ve karakteri eşleşen herkes (cumleler'den). */
      var kadroKar = {}, uygunDosya = 0, kkk;
      cumleler.forEach(function (c) { if (c.kar) kadroKar[c.kar.key] = 1; });
      for (kkk in kadroKar) {
        if (!Object.prototype.hasOwnProperty.call(kadroKar, kkk)) continue;
        (tarama.karakterDuygu[kkk] || []).forEach(function (d) {
          var vl = tarama.matris[d + "|" + kkk];
          uygunDosya += (vl && vl.length) ? vl.length : 0;
        });
      }
      var kullanilanSay = 0, kdk;
      for (kdk in kullanilanDosya) if (Object.prototype.hasOwnProperty.call(kullanilanDosya, kdk)) kullanilanSay++;
      logLine("Emoji planı: " + plan.length + " emoji · ort. süre " +
              (plan.length ? (sureTop / plan.length).toFixed(1) : "0") + " sn (cümle boyunca) · " +
              tarafSay.sag + " sağda, " + tarafSay.sol + " solda (soldakiler yatay aynalandı).");
      logLine("Emoji çeşidi: " + kullanilanSay + " farklı resim kullanıldı · bu kadroda " +
              uygunDosya + " resim kullanılabilirdi (klasörde toplam " + tarama.dosyalar.length + ") · " +
              "kadro: " + Object.keys(kadroKar).join(", ") + ".");
      logLine("Emoji atlanan: " + atlanan.yakin + " öncekiyle çakışıyor, " +
              atlanan.tarafDolu + " o pencerede kendi tarafı zaten doluydu, " +
              atlanan.dosyaYok + " dosya yok, " + atlanan.boyutYok + " boyut okunamadı." +
              (kisaltilan ? (" " + kisaltilan + " uzun cümle " + EMOJI_MAX_SURE + " sn'ye kırpıldı.") : ""));
      logLine("Emoji çeşitlilik: " + cesit.atlandi + " atlandı (aynı resim çok yakındı), " +
              cesit.ikinci + " tanesinde yapay zekânın 2. duygusu kullanıldı · kural: araya " +
              cesGerekBaska + " başka karakter + " + CES_AYNI + " aynı karakterin farklı emojisi" +
              (cesGerekBaska === 0 ? " (planda tek karakter — 'başka karakter' koşulu uygulanamıyor)" : "") + ".");

      /* 5) ESKİ KATMANLARI TEMİZLE. Aynı kanalı yeniden kullanıyoruz; temizlemeden yazmak
         host'un ilk-parça kuralına (kanal BOŞ olmalı) takılırdı — bilerek: sessizce üst üste
         binmektense yüksek sesle durmak yeğdir. Birden çok katman birikmişse hepsi gider. */
      var tsil, silYol, rt;
      for (tsil = 0; tsil < temizlenecekler.length; tsil++) {
        silYol = emojiYolListesiYaz(ek, temizlenecekler[tsil]);
        rt = String(await evalES('emojiTemizle(' + temizlenecekler[tsil] +
                                 (silYol ? ',"' + esPath(silYol) + '"' : "") + ')'));
        try { if (silYol) fs.unlinkSync(silYol); } catch (eSu) {}
        logLine("Emoji: eski katman temizlendi (V" + (temizlenecekler[tsil] + 1) + ") → " + rt);
        /* ⚠ İKİ HEDEF KANAL DA KORUNUR. Kontrol yalnız `=== kanal` idi; ikinci emoji kanalı
           (kanal2) sonradan eklendi ama guard güncellenmemişti. kanal2 temizlenemezse içinde
           eski emoji klipleri kalıyor, yerleştirmede o kanalın İLK parçası host'un
           "kanal BOŞ olmalı" kuralına takılıp "V<n> BOŞ DEĞİL" ile reddediliyor ve kullanıcı
           ödenmiş bir yapay zekâ isteğinden sonra hiç emoji alamıyordu. Erken ve net dur. */
        if (rt.indexOf("ok:") !== 0 &&
            (temizlenecekler[tsil] === kanal || temizlenecekler[tsil] === kanal2)) {
          yaz("Eski emoji katmanı temizlenemedi (V" + (temizlenecekler[tsil] + 1) + "): " +
              rt.replace(/^err:/, ""), "var(--bad)"); return;
        }
      }

      /* 5.5) RESİMLERİ TEK SEFERDE PROJEYE AL — YERLEŞTİRMEDEN AYRI BİR ÇAĞRIDA.
         ⚠ ARKADAŞIN MAKİNESİNDE KİLİTLENEN ŞEY BUYDU (ParsMazi, 8 Ağustos 2026): host
         plan PARÇASI başına (40 emoji) kendi eksik resimlerini import ediyordu. 117 emojilik
         bir plan 3 parça, yani ÜÇ ayrı import demek; Premiere `suppressUI=true` verilse bile
         "Import Files" ilerleme penceresi açıyor ve üçüncüsü kilitlendi. Kullanıcı pencereyi
         iptal edince o parçanın 24 emojisi "resim projeye alınamadı" diye düştü.
         Artık bütün TEKİL yollar bir kez burada yükleniyor; parçalar bin'de hazır buluyor.
         AYRI ÇAĞRI OLMASI DA ÖNEMLİ: import ile klip yerleştirme aynı evalScript turuna
         sıkışmıyor, Premiere ikisinin arasında nefes alıyor.
         Yükleme başarısızsa DURULUR: eksik resimle devam etmek, yarısı boş bir emoji
         katmanı bırakır ve sebebi kullanıcıya görünmez. */
      var uniqYol = {}, uniqListe = [];
      plan.forEach(function (satir) {
        var y = String(satir).split("|")[0];
        if (y && !uniqYol[y]) { uniqYol[y] = 1; uniqListe.push(y); }
      });
      if (uniqListe.length) {
        var impYol = path.join(extRoot, "emoji_import.txt");
        try {
          fs.writeFileSync(impYol, uniqListe.join("\n"), "utf8");
          yaz("resimler projeye alınıyor… (" + uniqListe.length + " dosya)");
          var ri = String(await evalES('emojiResimYukle("' + esPath(impYol) + '")'));
          logLine("Emoji resim yükleme (" + uniqListe.length + " tekil dosya): " + ri);
          try { fs.unlinkSync(impYol); } catch (eIu) {}
          /* ⚠ İKİ FARKLI BAŞARISIZLIK, İKİ FARKLI DAVRANIŞ — KARIŞTIRMA:
             "err:" → yeni fonksiyon çalıştı ama resimleri alamadı. DUR: eksik resimle devam
                      etmek yarısı boş bir emoji katmanı bırakır ve sebebi görünmez.
             başka   → fonksiyon HİÇ YOK (host.jsx eski). host.jsx yalnız PREMIERE AÇILIRKEN
                      yükleniyor, paneli kapat-aç yetmiyor; yani güncellemeden sonra Premiere'i
                      tam kapatmayan herkes buraya düşer. Burada DURMAK, çalışan bir özelliği
                      kullanılamaz yapardı — host'un kendi yedek import dalı devreye girer,
                      eski davranışla devam edilir. Sessiz kalmaz, log'a yazılır. */
          if (ri.indexOf("err:") === 0) {
            yaz("Emoji resimleri projeye alınamadı: " + ri.replace(/^err:/, "") +
                " — Premiere'de bir Import penceresi açık kaldıysa kapat ve tekrar bas.", "var(--bad)");
            return;
          }
          if (ri.indexOf("ok:") !== 0) {
            logLine("Emoji ön yükleme yapılamadı (host.jsx eski olabilir — Premiere'i TAMAMEN " +
                    "kapatıp aç). Resimler eski yoldan, parça parça alınacak. Dönen: " + ri);
          }
        } catch (eImp) {
          /* Host eskiyse (emojiResimYukle yok) yerleştirme yine çalışır: host'taki YEDEK
             import dalı devreye girer. Sessiz geçme, söyle. */
          logLine("Emoji ön yükleme atlandı (host eski olabilir): " + (eImp.message || eImp));
        }
      }

      /* 6) PARÇA PARÇA YERLEŞTİR. Tek evalScript boyunca Premiere DONUYOR ve ilerleme
         gösterilemiyordu; 40'lık parçalarda hem panel ilerlemeyi yazıyor hem Premiere
         nefes alıyor. Parça SÜRESİ log'a yazılıyor — bu maliyet hiç ölçülmemişti. */
      var yol = path.join(extRoot, "emoji_plan.txt");
      var kondu = 0, uyarilar = [], parcaHata = "", p, dilim, t0, r, m, u;
      /* ⚠ BAŞLAMADAN ÖNCE NE OLACAĞINI SÖYLE. Yerleştirme sırasında Premiere DONUK görünüyor
         (her parça tek bir evalScript) ve kullanıcı bunu "kilitlendi" sanıp Premiere'i
         öldürüyordu — ikinci kullanıcıda tam bu oldu. Emoji başına ~30 Premiere komutu var;
         200+ emojilik bir planda iş dakikalarca sürer ve bu NORMALDİR. */
      /* ⚠ PLAN KANALA GÖRE AYRILIR. host emojiYerlestir tek kanala yazıyor (plan[0].kanal)
         ve ilk parçada o kanalın BOŞ olmasını şart koşuyor; iki kanalın satırları
         karışırsa ikinci kanal "dolu" görünür ve yerleştirme durur. Her kanal kendi
         parçalarıyla, kendi "ilk parça" bayrağıyla gider.
         ⚠⚠ BU BLOK `_parcaToplam` HESABININ ÜSTÜNDE KALMAK ZORUNDA — ALTINA ALMA.
         v1.9.20'de tam tersi sıradaydı ve emoji özelliği HER makinede, HER çalıştırmada
         "Cannot read properties of undefined (reading 'length')" ile çöküyordu: `var`
         hoisting'i `kgAnah`'ı fonksiyon başına taşıyor ama DEĞERİNİ atamıyor, yani bildirim
         satırına gelmeden `kgAnah` = undefined. Hata plan üretildikten ve yapay zekâ isteğinin
         PARASI ödendikten SONRA patlıyordu, yani en pahalı yerde. Aynı tuzak bu fonksiyonun
         başında (`uyarilar` dizisi) zaten yazılıydı; uyarı yazmak yetmedi, nöbetçi testi
         `testler\tumtest.js`'e eklendi. */
      var kanalGrup = {}, kgAnah = [];
      plan.forEach(function (satir) {
        var kn = String(satir).split("|")[1];
        if (!kanalGrup[kn]) { kanalGrup[kn] = []; kgAnah.push(kn); }
        kanalGrup[kn].push(satir);
      });
      var _parcaToplam = 0, _kg;
      for (_kg = 0; _kg < kgAnah.length; _kg++)
        _parcaToplam += Math.ceil(kanalGrup[kgAnah[_kg]].length / EMOJI_PARCA);
      logLine("Emoji yerleştirme başlıyor: " + plan.length + " emoji · " + _parcaToplam +
              " parça. Premiere bu sırada DONUK görünecek — bu normal, dokunma. " +
              "Durdurmak istersen “İptal” (süren parça bitince durur).");
      var kgi, kgPlan;
      for (kgi = 0; kgi < kgAnah.length; kgi++) {
      kgPlan = kanalGrup[kgAnah[kgi]];
      for (p = 0; p < kgPlan.length; p += EMOJI_PARCA) {
        /* İPTAL — parça sınırında güvenli: her parça kendi içinde tamamlanıyor ve sonraki
           parça kanalın gerçek durumunu yeniden okuyor. ⚠ İptal ZATEN DONMUŞ bir evalScript'i
           kurtarmaz (o Premiere'in elinde); sonraki parçanın hiç başlamamasını sağlar. */
        if (_emojiIptal) { parcaHata = "kullanıcı iptal etti"; break; }
        dilim = kgPlan.slice(p, p + EMOJI_PARCA);
        fs.writeFileSync(yol, dilim.join("\n"), "utf8");
        var _parcaNo = Math.floor(p / EMOJI_PARCA) + 1;
        yaz("emoji yerleştiriliyor… " + kondu + "/" + plan.length);
        t0 = Date.now();
        /* ⚠ NÖBETÇİ: bu çağrı sürerken durum satırı CANLI kalır. Eskiden "155/206" yazısı
           parça boyunca (dakikalarca) donuk duruyordu; Premiere bir pencere açıp kilitlense
           panel bunu hiçbir şekilde belli etmiyordu — kullanıcı "takıldı" deyip Premiere'i
           öldürüyordu. 60 saniyeden sonra ekranda ne yapması gerektiği yazıyor. */
        r = String(await evalES(
          'emojiYerlestir("' + esPath(yol) + '","' + (p ? "1" : "0") + '")',
          function (sn) {
            var m0 = "emoji yerleştiriliyor… " + kondu + "/" + plan.length +
                     " · parça " + _parcaNo + " (" + sn + " sn)";
            if (sn >= 60) {
              yaz(m0 + " · ⚠ Premiere yanıt vermiyor olabilir — ekranda açık bir pencere " +
                  "(Save Project / Import) var mı? Kapatınca kaldığı yerden devam eder.", "var(--warn)");
            } else yaz(m0);
          }));
        logLine("Emoji parça " + (Math.floor(p / EMOJI_PARCA) + 1) + " (" + dilim.length +
                " emoji, " + Math.round((Date.now() - t0) / 100) / 10 + " sn): " + r);
        if (r.indexOf("ok:") !== 0) {
          /* Bu KANAL durdu; hangi kanal olduğunu da yaz, yoksa "V8 BOŞ DEĞİL" mesajı hangi
             tarafa ait belli olmuyor. */
          parcaHata = (parcaHata ? parcaHata + " ; " : "") + "V" + (parseInt(kgAnah[kgi], 10) + 1) +
                      ": " + r.replace(/^err:/, "");
          break;
        }
        m = r.match(/^ok:(\d+)\//); if (m) kondu += parseInt(m[1], 10);
        u = r.indexOf(" | "); if (u !== -1) uyarilar.push(r.slice(u + 3));
      }
      /* ⚠ BİR KANALIN ÇÖKMESİ ÖTEKİNİN GEÇERLİ İŞİNİ ÖLDÜRMEZ — `break` DEĞİL `continue`.
         Eski hâlde iç döngüden çıkan hata dış döngüyü de kırıyordu. Kanal grupları plandaki
         İLK satırın kanalına göre sıralandığı için, videonun ilk emojisi SOL taraftaysa önce
         kanal2 deneniyor: o kanal (önceki çalıştırmadan kalan klipler yüzünden) "BOŞ DEĞİL"
         derse SAĞ taraftaki 150 emoji de hiç konmuyor ve ödenmiş yapay zekâ isteği çöpe
         gidiyordu. Artık öteki kanal denenir, hata mesajı yine kullanıcıya çıkar. */
      }
      try { fs.unlinkSync(yol); } catch (eU) {}

      /* DÜRÜST SONUÇ: kısmi başarı SARI (preset kartındaki sonucGoster ile aynı kural).
         150 emojiden 5'i kondu deyip yeşil göstermek, render'dan sonra fark edilen en pahalı
         hata olurdu.
         ⚠ YAPAY ZEKÂNIN İŞARETLEME SAYISI DURUM SATIRINDA. Sıklığın tek ayar kolu bu sayı;
         yalnız Ayrıntılar log'unda kalsaydı kullanıcı "az geldi" der ama hangi kolun
         çevrileceği bilinemezdi. */
      /* 7) PRESET — emojiler konduktan SONRA, o kanalın TAMAMINA tek çağrıda.
         Kullanıcının "Emoji Sağ Taraf" preset'i tam bunun için öğretilmiş: Transform ile
         pop giriş + klip sonunda aşağı kayarak çıkış. Panelin yazdığı konum/ölçek EZİLMEZ —
         panel MOTION bileşenine yazıyor, preset ise Motion/Opacity'yi "içsel" sayıp hiç
         dokunmuyor; preset'in kendi Position/Scale'i ayrı bir Transform katmanında ve
         dinlenme değerleri nötr (Position [0.5,0.5], Scale 100).
         Yerleştirme başarısız olduysa preset denenmez: boş kanala uygulamak anlamsız. */
      var presetAd = String((($("emojiPreset") || {}).value) || "");
      var presetNot = "";
      if (kondu && presetAd) {
        var pYigin = "";
        try { pYigin = presetYiginOku(presetAd); } catch (ePy) { pYigin = ""; }
        if (!pYigin) presetNot = " | “" + presetAd + "” öğretilmemiş, uygulanmadı";
        else {
          var pYol = path.join(extRoot, "emoji_preset.json");
          try {
            fs.writeFileSync(pYol, pYigin, "utf8");
            yaz("preset uygulanıyor: " + presetAd + "…");
            /* ⚠ PRESET HER İKİ EMOJİ KANALINA DA UYGULANIR. İki kanala geçtikten sonra
               yalnız birine uygulamak, sol taraftaki emojileri animasyonsuz bırakırdı —
               kullanıcı bunu ancak videoyu izlerken fark ederdi. */
            /* ⚠ SAĞ DAL DA KOŞULLU — sol dalla SİMETRİK. Plan satırlarının kanalı
               `(sagMi || kanal2 < 0) ? kanal : kanal2` diye seçiliyor; tarafSay.sag === 0 ve
               kanal2 >= 0 iken `kanal` track'ine HİÇ klip konmuyor ve host haklı olarak
               "V<n> kanalinda klip yok" diyor. Panel bunu presetNot'a "UYGULANMADI" diye
               yazıp sonucu SARI yapıyordu — oysa konan her emojiye preset uygulanmıştı.
               `kanal2 < 0` şartı ZORUNLU: tek kanal modunda planın HEPSİ `kanal`'a gidiyor
               ve tarafSay.sag 0 olsa bile bu dal çalışmak zorunda. */
            var prSag = "ok:(kanal yok)";
            if (tarafSay.sag > 0 || kanal2 < 0) {
              prSag = String(await evalES('presetYaz("' + esPath(pYol) + '","0","' + kanal + '")'));
              logLine("Emoji preset (" + presetAd + ") V" + (kanal + 1) + " → " + prSag);
            }
            var prSol = "ok:(kanal yok)";
            if (kanal2 >= 0 && tarafSay.sol > 0) {
              prSol = String(await evalES('presetYaz("' + esPath(pYol) + '","0","' + kanal2 + '")'));
              logLine("Emoji preset (" + presetAd + ") V" + (kanal2 + 1) + " → " + prSol);
            }
            var pr = (prSag.indexOf("ok:") === 0 && prSol.indexOf("ok:") === 0) ? "ok:" : (prSag.indexOf("ok:") === 0 ? prSol : prSag);
            presetNot = (pr.indexOf("ok:") === 0)
              ? (" | preset: " + presetAd)
              : (" | preset UYGULANMADI: " + pr.replace(/^err:/, "").slice(0, 60));
          } catch (ePr) { presetNot = " | preset hatası: " + (ePr.message || ePr); }
          try { fs.unlinkSync(pYol); } catch (ePu) {}
        }
      }

      /* AYNALANAMAYAN RESİM KISMİ BAŞARI SAYILIR: emoji ekranda ama TERS bakıyor — kullanıcı
         bunu ancak videoyu izlerken fark ederdi, yeşil "başarılı" yalan olurdu.
         ⚠ Ölçüt PLANA GİREN emoji (aynasizKondu), üretimi denenen dosya değil: seyreltmede
         elenen bir emoji yüzünden sarı uyarı çıkmamalı. Dosya sayısı ayrıca log'da. */
      var aynaHata = aynaHataSay();
      var kismi = (kondu < plan.length) || uyarilar.length > 0 || !!parcaHata || aynasizKondu > 0 ||
                  !!secUyari ||   // yapay zekâ parçalarının bir kısmı düştü — plan zaten eksik doğdu
                  (presetNot.indexOf("UYGULANMADI") !== -1) || (presetNot.indexOf("öğretilmemiş") !== -1);
      /* Kanal özeti GERÇEKTEN kullanılan kanalları söyler: hepsi sol taraftaysa `kanal`
         boş kalıyor ve onu "sağ" diye raporlamak kullanıcıyı boş bir track'e bakmaya
         yolluyordu (preset dalındaki aynı asimetri). */
      var kanalOzet = [];
      if (tarafSay.sag > 0 || kanal2 < 0) kanalOzet.push("V" + (kanal + 1) + (kanal2 >= 0 ? " sağ" : ""));
      if (kanal2 >= 0 && tarafSay.sol > 0) kanalOzet.push("V" + (kanal2 + 1) + " sol");
      var msg = kondu + "/" + plan.length + " emoji kondu (" + (kanalOzet.join(" · ") || "kanal yok") + ")";
      /* ⚠ TEK KANALA DÜŞÜLDÜYSE SÖYLE. Sessiz kalırsa kullanıcı "aynı anda iki emoji"
         beklerken alamaz ve sebebini hiçbir yerde göremez. */
      if (kanal2 < 0 && tarafSay.sol > 0)
        msg += " · ⚠ ikinci boş video kanalı yoktu — sol ve sağ AYNI ANDA çıkamıyor " +
               "(kanal başlığına sağ tık → Add Track ile bir kanal daha ekle)";
      if (parcaHata) msg += " — DURDU: " + parcaHata;
      else if (kondu < plan.length) msg += " — " + (plan.length - kondu) + " tanesi OLMADI";
      msg += " · " + tarafSay.sag + " sağda, " + tarafSay.sol + " solda";
      /* ÇEŞİT DURUM SATIRINDA: "projede 24 öğe var ama 45 emojim var" sorusu bir daha
         proje penceresine bakılarak tahmin edilmesin. Payda bu KADRODA kullanılabilir olan. */
      msg += " · " + kullanilanSay + "/" + uygunDosya + " farklı resim kullanıldı";
      msg += " · yapay zekâ " + cumleler.length + " cümlenin " + isaret + "'ini işaretledi";
      /* KISA CÜMLE ELEMESİ DURUM SATIRINDA: "eskisi kadar emoji çıkmadı" hissinin sebebi bu
         ve ayarlanabilir kol Sıklık DEĞİL — kullanıcı bunu bilmeli. */
      if (top.kisa) msg += " · " + top.kisa + " kısa cümle (" + EMOJI_MIN_KELIME +
                           " kelimeden az) baştan elendi";
      /* ÇEŞİTLİLİK YÜZÜNDEN DÜŞEN SAYI SESSİZ KALMAZ: kullanıcı "az emoji" derse ne
         yapacağını bilmeli.
         ⚠ MESAJ ARTIK "Sıklık'ı artır" DEMİYOR — o seçici kaldırıldı (sıklık sabit 0.75).
         Çeşitlilik kuralına takılmanın gerçek çaresi o karaktere YENİ RESİM çizmek: kural
         "aynı resim çok yakında tekrar etmesin" diyor, yani havuz küçükse tıkanıyor. */
      if (cesit.atlandi) msg += " · " + cesit.atlandi + " tanesi çeşitlilik kuralına takıldı (o karaktere yeni tepki resmi eklersen artar)";
      if (aynasizKondu) msg += " · ⚠ " + aynasizKondu + " emoji AYNALANMADAN kondu (ters bakıyor, " +
                               aynaHata + " resim çevrilemedi): " + (aynaHataAd || "sebep bilinmiyor");
      msg += presetNot;
      /* Yapay zekâ tarafındaki kayıp EKRANDA: "az emoji çıktı" şikâyetinin sebebi burada ve
         gizli log'da kalmamalı (aynı hata `hata` alanı için bir kez düzeltilmişti). */
      if (secUyari) msg += " · ⚠ " + secUyari;
      if (uyarilar.length) msg += " | " + uyarilar.slice(0, 2).join(" ; ");
      /* Her emoji ayrı bir işlem = plan uzunluğu kadar geri-alma adımı. Kullanıcı refleksle
         Ctrl+Z'ye basarsa hem yüzlerce basış gerekir hem kendi geçmişini ezer. */
      msg += " · geri almak için Ctrl+Z değil “Emojileri Sil”";
      yaz((kismi ? "⚠ " : "✓ ") + msg, kismi ? "var(--warn)" : (kondu ? "var(--good)" : "var(--bad)"));
    } catch (e3) {
      yaz("hata: " + (e3.message || e3), "var(--bad)");
      logLine("Emoji hatası: " + (e3.stack || e3.message || e3));
    } finally {
      if (btn) btn.disabled = false;
      /* İptal düğmesi iş bitince kaybolur ve bir sonraki çalıştırma için tazelenir. */
      var _bi = $("btnEmojiIptal");
      if (_bi) { _bi.hidden = true; _bi.disabled = false; }
      _emojiIptal = false;
    }
  }

  /* EMOJİ ÖLÇÜM KARTI — geçici. Emoji özelliği yazılmadan önce Premiere'in gerçek
     davranışını ölçer (still süresi, süre yazılabiliyor mu, konum piksel mi 0-1 mi).
     DevTools'a gerek kalmasın diye düğmeye bağlandı. Ölçüm bitince kart da bu kod da
     kaldırılacak. */
  /* EMOJİ KLASÖRÜ = MOTOR KÖKÜ ALTI. ⚠ Eskiden GELİŞTİRİCİNİN kendi masaüstü yolu
     gömülüydü (…\OneDrive\Masaüstü\Yusufwrl\Youtube\Edit\Emoji); başka bir makinede o
     klasör YOK ve emoji özelliği teslim edildiği gün "Emoji klasörü okunamadı" ile ölü
     geliyordu — üstelik sebebi kullanıcı için görünmez.
     Motor kökü doğru yer: ASCII (CEF Türkçe karakterli yolda takılıyor), kullanıcının
     kurulumda seçtiği yer, ve panel klasörünün DIŞINDA — ne güncelleme ne yeniden kurulum
     dokunuyor. Paket açılırken resimler oraya kuruluyor (bkz. varsayilanlariKur). */
  function emojiKlasorVarsayilan() {
    try { if (cfg && cfg._engineRoot) return path.join(cfg._engineRoot, "Emoji"); } catch (e) {}
    var h = (typeof process !== "undefined" && process.env)
          ? (process.env.USERPROFILE || process.env.HOME || "") : "";
    return h ? path.join(h, "YusufwrlEngine", "Emoji") : "";
  }
  function wireEmojiTest() {
    var inp = $("emojiKlasor"), bSec = $("btnEmojiKlasor"), bTest = $("btnEmojiTest");
    var dur = $("emojiTestDurum"), cik = $("emojiTestCikti");
    /* ⚠ ERKEN DÖNÜŞ YALNIZ KLASÖR KUTUSUNA BAKAR. Eskiden `!bTest` de vardı: #btnEmojiTest
       kodun kendi yorumunda "geçici, ölçüm bitince kaldırılacak" diye işaretli bir ölçüm
       düğmesi. O silinirse Emoji Ekle · Emojileri Sil · Yenile · Yeniden Kur · animasyon
       menüsü — HİÇBİRİ bağlanmıyor, düğmeler görünüyor ama basınca hiçbir şey olmuyordu. */
    if (!inp) return;
    inp.value = lsGet("emoji.klasor", "") || emojiKlasorVarsayilan();
    inp.addEventListener("change", function () {
      lsSet("emoji.klasor", inp.value.trim());
      emojiKlasorDurumYaz();          // klasör değişince sayılar hemen tazelensin
    });
    function yaz(m, renk) { if (dur) { dur.textContent = m || ""; dur.style.color = renk || "var(--muted)"; } }
    emojiKlasorDurumYaz();            // açılışta durumu göster (eksik varsa hemen görünsün)

    if (bSec) bSec.addEventListener("click", function () {
      if (!CEP) { yaz("Premiere'de çalışır", "var(--warn)"); return; }
      try {
        if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
          var r = window.cep.fs.showOpenDialogEx(false, true, "Emoji klasörünü seç", inp.value || "");
          if (r && r.data && r.data.length) {
            inp.value = r.data[0]; lsSet("emoji.klasor", inp.value); emojiKlasorDurumYaz();
          }
        }
      } catch (e) { yaz("klasör seçilemedi: " + (e.message || e), "var(--bad)"); }
    });

    /* EMOJİLERİ YENİDEN KUR — "güncelleme geldi ama yeni emojiler yok"un tek tıklık çaresi.
       varsayilanlariKur zaten açılışta çalışıyor ama YALNIZ kayıtlı klasöre yazıyor; kutuda
       başka bir yol duruyorsa (ya da kullanıcı klasörü sonradan değiştirdiyse) kurulum oraya
       hiç ulaşmıyordu. Bu düğme önce kutudaki yolu KAYDEDİYOR, sonra kurulumu çalıştırıyor —
       yani hedefi kullanıcının gördüğü klasör yapıyor. Eksikleri ekler, düzeltilmişleri
       tazeler, kullanıcının kendi resimlerine dokunmaz (bkz. .panel-emoji.json izi). */
    var bKur = $("btnEmojiKur");
    if (bKur) bKur.addEventListener("click", function () {
      var durEl = $("emojiKlasorDurum");
      var yol = String(inp.value || "").trim();
      if (!yol) {
        if (durEl) { durEl.textContent = "Önce emoji klasörünü seç."; durEl.style.color = "var(--warn)"; }
        return;
      }
      lsSet("emoji.klasor", yol);
      if (durEl) { durEl.textContent = "kuruluyor…"; durEl.style.color = "var(--muted)"; }
      bKur.disabled = true;
      try {
        var oncekiSay = 0;
        try { var t0 = EMJ ? EMJ.tara(yol) : null; oncekiSay = (t0 && !t0.hata) ? t0.dosyalar.length : 0; } catch (eT) {}
        varsayilanlariKur();
        var sonSay = 0;
        try { var t1 = EMJ ? EMJ.tara(yol) : null; sonSay = (t1 && !t1.hata) ? t1.dosyalar.length : 0; } catch (eT2) {}
        logLine("Emojiler yeniden kuruldu: " + oncekiSay + " → " + sonSay + " resim (" + yol + ")");
      } catch (eK) {
        logLine("Emojiler yeniden kurulamadı: " + (eK.message || eK));
        if (durEl) { durEl.textContent = "kurulamadı: " + (eK.message || eK); durEl.style.color = "var(--bad)"; }
        bKur.disabled = false; return;
      }
      bKur.disabled = false;
      emojiKlasorDurumYaz();
    });

    /* "Senin karakterin" seçicisi KALDIRILDI: karakter adı artık kanal listesinden geliyor
       (A1 satırının da isim kutusu var). Aynı bilgiyi iki yerde sormak kafa karıştırıyordu. */

    /* wireEmojiSiklik() KALDIRILDI — sıklık seçicisi yok, değer sabit (bkz. EMOJI_SIKLIK). */
    wireEmojiPreset();
    /* Emoji ekranındaki "Yenile": kanal listesi + klasör durumu birlikte tazelenir.
       Kullanıcı Altyazı'da isim değiştirip ya da Senkron'la kanal ekleyip buraya dönebiliyor. */
    var bYen = $("btnEmojiYenile");
    if (bYen) bYen.addEventListener("click", function () {
      /* ⚠ ÜÇÜNÜ BİRDEN TAZELE. Eskiden yalnız kanal listesi + klasör durumu çağrılıyordu ve
         klasör durumu #emojiKlasorDurum'a yazıyor — o eleman AYARLAR ekranında, yani
         kullanıcı Emoji ekranındayken uyarıyı GÖREMİYORDU ("6 resim bu klasörde yok" başka
         bir ekrana düşüyordu). Animasyon menüsü de bir kez, açılışta doluyordu: kullanıcı
         Preset ekranında bir preset öğretip buraya gelince menüde YOKTU ve "Yenile" onu
         tazelemiyordu; sildiği preset ise ölü ad olarak menüde kalıyordu. */
      try { emojiKanalKarCiz(); } catch (e) {}
      try { emojiKlasorDurumYaz(); } catch (e2) {}
      try { wireEmojiPreset(true); } catch (e3) {}
    });
    var bEkle = $("btnEmojiEkle"), bSil = $("btnEmojiSil"), bIptal = $("btnEmojiIptal");
    if (bEkle) bEkle.addEventListener("click", function () {
      emojiEkle().catch(function (e) { logLine("Emoji hatası: " + (e.message || e)); });
    });
    /* ⚠ İPTAL YALNIZ SIRADAKİ PARÇAYI ENGELLER. Çalışan bir evalScript kesilemez (o
       Premiere'in elinde); bu yüzden düğme "durduruluyor…" diyor, "durduruldu" demiyor. */
    if (bIptal) bIptal.addEventListener("click", function () {
      _emojiIptal = true;
      bIptal.disabled = true;
      var d3 = $("emojiDurum");
      if (d3) { d3.textContent = "iptal ediliyor… (süren parça bitince duracak)"; d3.style.color = "var(--warn)"; }
      logLine("Emoji: kullanıcı iptal etti — sıradaki parça başlatılmayacak.");
    });
    if (bSil) bSil.addEventListener("click", async function () {
      var d2 = $("emojiDurum");
      function y2(m, renk) { if (d2) { d2.textContent = m || ""; d2.style.color = renk || "var(--muted)"; } }
      if (!CEP) { y2("Premiere'de çalışır", "var(--warn)"); return; }
      try {
        /* HANGİ KANALDA EMOJİ VAR — host SAYIYOR, panel tahmin etmiyor.
           ⚠ Eskiden panel KLİP İÇEREN HER video kanalını deniyordu (kullanıcının görüntü
           kanalı dahil) ve host'un haklı reddini uyarı diye gösteriyordu: başarılı bir
           silmede bile "✓ 100 emoji silindi | V1 kanalinda emoji OLMAYAN 312 klip var"
           çıkıp mesaj sarıya dönüyordu. Her seferinde tetiklenen uyarı kurt masalına döner
           ve GERÇEK karışık-kanal uyarısı onun içinde kaybolur. */
        var kok2 = String(($("emojiKlasor") || {}).value || "").trim();
        if (!kok2) { y2("Önce emoji klasörünü seç — hangi kliplerin emoji olduğu ondan anlaşılıyor", "var(--warn)"); return; }
        var ek = JSON.parse(String(await evalES("emojiKanallariJSON()")));
        if (ek.error) { y2("Sekans okunamadı: " + ek.error, "var(--bad)"); return; }
        emojiKanalOzet(ek, kok2);        // emoji/yabanci YOLA göre (bin'e güvenilmiyor)
        var silinen = 0, engel = [], i, t, r, sy;
        for (i = 0; i < (ek.tracks || []).length; i++) {
          t = ek.tracks[i];
          if (t.emoji <= 0) continue;                    // hiç emoji yok → hiç deneme
          if (t.yabanci > 0) {
            /* GERÇEK uyarı: kanalda hem emoji hem başka klip var, host zaten dokunmaz. */
            engel.push("V" + (t.idx + 1) + ": " + t.emoji + " emoji + " + t.yabanci +
                       " başka klip — karışık, dokunulmadı");
            continue;
          }
          sy = emojiYolListesiYaz(ek, t.idx);
          r = String(await evalES('emojiTemizle(' + t.idx + (sy ? ',"' + esPath(sy) + '"' : "") + ')'));
          try { if (sy) fs.unlinkSync(sy); } catch (eSu2) {}
          logLine("emojiTemizle V" + (t.idx + 1) + ": " + r);
          if (r.indexOf("ok:") === 0) silinen += (parseInt(r.slice(3), 10) || 0);
          else engel.push(r.replace(/^err:/, ""));
        }
        if (silinen) y2((engel.length ? "⚠ " : "✓ ") + silinen + " emoji silindi" +
                        (engel.length ? (" | " + engel.join(" ; ")) : ""),
                        engel.length ? "var(--warn)" : "var(--good)");
        else if (engel.length) y2("⚠ " + engel.join(" ; "), "var(--warn)");
        else y2("Silinecek emoji bulunamadı", "var(--muted)");
        logLine("Emoji silme: " + silinen + " klip");
      } catch (e) { y2("hata: " + (e.message || e), "var(--bad)"); }
    });

    /* SEÇİLİ EMOJİ KLİBİNİ İNCELE — "emoji kesiliyor / yanlış yerde" sorusunun tek adımlık
       cevabı. Panel klibe Position/Scale YAZIYOR ama yazdığını geri OKUMUYORDU; kırpmanın
       panelden mi (yanlış değer) Premiere'den mi (kendi ayarı / elle eklenmiş efekt) geldiği
       ancak klibin gerçek durumunu okuyunca ayrılır. */
    var bTani = $("btnEmojiKlipTani");
    if (bTani) bTani.addEventListener("click", async function () {
      if (!CEP) { yaz("Premiere'de çalışır", "var(--warn)"); return; }
      bTani.disabled = true; yaz("okunuyor…");
      try {
        var rt = String(await evalES("emojiKlipTani()"));
        var ta = $("emojiTestCikti");
        if (ta) { ta.value = rt; ta.style.display = "block"; }
        logLine("Emoji klip tanılama:\n" + rt);
        yaz(rt.indexOf("HATA") === 0 ? rt.split("\n")[0] : "✓ okundu — aşağıdaki kutuya bak",
            rt.indexOf("HATA") === 0 ? "var(--warn)" : "var(--good)");
      } catch (e) { yaz("hata: " + (e.message || e), "var(--bad)"); }
      finally { bTani.disabled = false; }
    });

    bTest.addEventListener("click", async function () {
      if (!CEP) { yaz("Premiere'de çalışır", "var(--warn)"); return; }
      var kok = String(inp.value || "").trim();
      if (!kok) { yaz("Önce emoji klasörünü seç", "var(--warn)"); return; }
      if (!EMJ) { yaz("emoji.js yüklenemedi — deploy-dev.ps1 çalıştır ve Premiere'i yeniden başlat", "var(--bad)"); return; }

      var t = EMJ.tara(kok);
      if (t.hata) { yaz(t.hata, "var(--bad)"); return; }
      logLine("Emoji taraması: " + t.dosyalar.length + " dosya · " +
              t.duygular.map(function (d) { return d.ad; }).join(", ") + " · " +
              t.karakterler.map(function (c) { return c.ad; }).join(", ") +
              (t.atlanan ? (" · " + t.atlanan + " öğe atlandı (alt klasör/uygunsuz ad)") : ""));

      bTest.disabled = true; yaz("ölçülüyor…");
      try {
        /* Test resmi: dosya adı Türkçe karakterli olabilir, evalScript literaline gömmek
           yerine esPath ile kaçırılıyor (proje geneli kural). */
        var r = String(await evalES('emojiTani("' + esPath(t.dosyalar[0].yol) + '")'));
        if (cik) { cik.value = r; cik.style.display = "block"; }
        logLine("--- emojiTani ---\n" + r);
        yaz("✓ ölçüm bitti — aşağıdaki metni Claude'a ilet", "var(--good)");
      } catch (e) {
        yaz("hata: " + (e.message || e), "var(--bad)");
      } finally { bTest.disabled = false; }
    });
  }

  function wirePreset() {
    /* HAZIR İÇERİK KURULUMU — kartlar çizilmeden ÖNCE: yeni kurulumda preset'ler dolu
       gelsin, boş kart görünüp sonradan dolmasın. Kendi kaydı olanda hiçbir şey yapmaz. */
    try { varsayilanlariKur(); } catch (eVk) { logLine("Hazır içerik kurulamadı: " + (eVk.message || eVk)); }
    _presetSecili = presetSeciliOku();
    /* Kartlar ÇİZİLMEDEN ÖNCE: öğretilmiş ama listede olmayan preset'ler eklensin, yoksa
       kullanıcı erişemediği bir kaydın varlığını hiç öğrenemiyor. */
    presetSeciliTazele();
    presetBtnlarCiz();

    /* Yedekten kurtarma olduysa kullanıcı BİLMELİ (log'a gömmek yetmez): kurtarılan kayıt
       son öğrettiğini içermiyor olabilir.
       presetYiginlar() BURADA ZORLA çağrılır: kart listesi boşsa presetBtnlarCiz erken
       dönüp dosyayı hiç okumuyor ve kurtarma uyarısı hiç tetiklenmiyordu. */
    try { presetYiginlar(); } catch (ePy) {}
    if (_presetKurtarildi) durumYaz("⚠ " + _presetKurtarildi, "var(--warn)");

    var yeniAd = $("presetYeniAd"), ekle = $("btnPresetEkle");
    function presetEkle() {
      var ad = String((yeniAd && yeniAd.value) || "").trim();
      if (!ad) { durumYaz("bir ad yaz", "var(--warn)"); return; }
      if (_presetSecili.indexOf(ad) !== -1) { durumYaz("“" + ad + "” zaten var", "var(--warn)"); return; }
      _presetSecili.push(ad);
      presetSeciliYaz(); presetBtnlarCiz();
      if (yeniAd) yeniAd.value = "";
      durumYaz("“" + ad + "” eklendi — karta sağ tık → “Bu klipten öğret”", "var(--good)");
    }
    if (ekle) ekle.addEventListener("click", presetEkle);
    if (yeniAd) yeniAd.addEventListener("keydown", function (e) {
      if (e.keyCode === 13) { e.preventDefault(); presetEkle(); }
    });

    efektleriYukle();
  }

  function trOpts(extra) {
    /* Model ve sansür artık panelde seçilmiyor: her zaman en doğru model (config.json'daki
       large-v3) ve tam sansür kullanılır. Seçenek sunmak fayda getirmiyordu — hızlı model
       Türkçe'de belirgin kötü, sansürü kapatmak da YouTube için istenmiyor. */
    var o = { model: cfg.model || "large-v3", language: cfg.language, diarize: false,
      censor: "all",
      hotwords: SZ ? SZ.hotwords(state.dict) : "", dictMap: state.dictMap };
    /* KELİME TAVANI HER ZAMAN 2 (kullanıcı isteği): ekranın altındaki Minecraft hotbar'ını
       aşacak uzunlukta satır istenmiyor. Eskiden yalnız Shorts'ta 2'ydi, normal videoda
       config.json'daki değer (3) geçerliydi.
       TAVAN KODDA ZORLANIR, config.json'a GÜVENİLMEZ: updater.js configBirlestir kullanıcının
       mevcut maxWordsPerCue değerini koruyor — config dosyasını değiştirmek kurulu panele hiç
       ulaşmaz ve "yaptım ama değişmedi" denir.
       DİKKAT: kelime tavanını düşürmek cue'ları kısaltır ve tek başına yapılırsa ses hizalamasını
       KÖTÜLEŞTİRİR (ölçüldü: sessizde başlayan cue 90 → 138). pipeline.js'deki sesleHizala bu
       yüzden aynı pakette onarıldı — cue kaydırılırken bitişi de birlikte taşınıyor. */
    o.maxWords = 2;
    // Shorts: dikey karede satır dar — karakter sınırı da daralır (kelime tavanı zaten 2).
    if (shortsAcik()) { o.maxChars = SHORTS_MAX_KARAKTER; }
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }


  // ---------- klip okuma ----------
  async function getClips(trackIdx) {
    var raw = await evalES("getA1ClipsJSON(" + trackIdx + ")");
    var data; try { data = JSON.parse(raw); } catch (e) { throw new Error("Sekans okunamadı: " + raw); }
    if (data.error === "no_sequence") throw new Error("Aktif sekans yok. Önce bir sekans aç.");
    if (data.error === "no_audio_track") throw new Error("A" + (trackIdx + 1) + " kanalı sekansta yok.");
    if (!data.clips || !data.clips.length) throw new Error("A" + (trackIdx + 1) + " kanalında ses klibi yok.");
    return data;
  }

  // ---------- Süre aralığı (opsiyonel) ----------
  /* Açılır menüler sekansın gerçek uzunluğuna göre 30 saniyelik adımlarla doldurulur.
     Eskiden serbest metin kutusuydu ve "1:00-2:00" gibi yanlış yazımlar sessizce tüm videoyu
     işletiyordu; menüden geçersiz değer seçilemediği için o hata sınıfı tamamen kalktı. */
  function fillRangeOptions(sure) {
    var s1 = $("rangeStart"), s2 = $("rangeEnd");
    if (!s1 || !s2 || !(sure > 0)) return;
    var eskiS = s1.value, eskiE = s2.value, adim = 30;
    s1.innerHTML = ""; s2.innerHTML = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "baştan"; s1.appendChild(o0);
    var o1 = document.createElement("option"); o1.value = ""; o1.textContent = "sona kadar"; s2.appendChild(o1);
    for (var t = adim; t < sure; t += adim) {
      var a = document.createElement("option"); a.value = String(t); a.textContent = fmtShort(t); s1.appendChild(a);
      var b = document.createElement("option"); b.value = String(t); b.textContent = fmtShort(t); s2.appendChild(b);
    }
    // sekans sonu tam adıma denk gelmiyorsa bitiş için son bir seçenek daha
    if (sure % adim > 1) { var son = document.createElement("option"); son.value = String(Math.floor(sure)); son.textContent = fmtShort(sure); s2.appendChild(son); }
    /* ⚠ LİSTEDE OLMAYAN DEĞER ATAMAK SELECT'İ BOŞALTIR. `<select>`'e karşılığı olmayan bir
       value atamak selectedIndex'i -1 yapar ve kutu tamamen BOŞ çizilir. Seçenekler sekans
       süresine göre üretiliyor (30 sn adımlarla), yani daha KISA bir sekansa geçildiğinde
       büyük değerler listeden düşüyor: kullanıcı 10 dk'lık sekansta 2:00→5:00 seçip 3 dk'lık
       başka bir sekansa geçince bitiş kutusu boş çiziliyor, getRange() null dönüyor ve panel
       5 dakikalık aralık yerine TÜM videoyu işliyordu — 20-30 dakikalık GPU işi, kullanıcı
       ekranda ne seçili olduğunu göremeden. refreshRangeOptions her goView("altyazi")
       çağrısında çalıştığı için bu yola sık giriliyor.
       Panelin kendi kodu bu tuzağı BAŞKA İKİ YERDE zaten biliyor (restoreSelect ve
       emojiKanalKarCiz) — burada yoktu.
       BİTİŞ kutusu düşürülmez, KELEPÇELENİR: sekans sonu zaten bir seçenek olarak ekleniyor,
       "5:00 yok → 3:00'e çek" hem daha az sürpriz hem kullanıcının niyetine daha yakın. */
    function _secVar(sel, v) {
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) return true;
      return false;
    }
    function _geriKoy(sel, v, ucAd, kelepce) {
      if (!v) { sel.value = ""; return; }
      if (_secVar(sel, v)) { sel.value = v; return; }
      if (kelepce && sel.options.length > 1) {
        var sonSec = sel.options[sel.options.length - 1];
        sel.value = sonSec.value;
        logLine("Süre aralığı " + ucAd + " (" + fmtShort(+v) + ") bu sekansta yok — " +
                sonSec.textContent + " değerine çekildi.");
        return;
      }
      sel.value = "";
      logLine("Süre aralığı " + ucAd + " (" + fmtShort(+v) + ") bu sekansta yok — temizlendi.");
    }
    _geriKoy(s1, eskiS, "başlangıcı", false);
    _geriKoy(s2, eskiE, "bitişi", true);
  }
  // Sekans süresini okuyup menüleri doldurur (panel açılışında ve her üretim sonrası)
  async function refreshRangeOptions() {
    if (!CEP || !cfg) return;
    try { var d = await getClips(0); fillRangeOptions(clipsEnd(d.clips)); } catch (e) {}
  }
  // Panel girdilerinden aralık okur. İkisi de boşsa null (= tüm video).
  function getRange() {
    var sv = String(($("rangeStart") && $("rangeStart").value) || "");
    var ev = String(($("rangeEnd") && $("rangeEnd").value) || "");
    if (!sv && !ev) return null;
    var start = sv ? parseFloat(sv) : 0;
    var end = ev ? parseFloat(ev) : Infinity;
    if (!isFinite(start) || start < 0) start = 0;
    if (isFinite(end) && end <= start) end = Infinity; // geçersiz bitiş -> sona kadar
    return { start: start, end: end };
  }
  function clipsInRange(clips, range) {
    if (!range) return clips;
    return clips.filter(function (c) {
      var s = c.timelineStartSec || 0, e = s + (c.durationSec || 0);
      return e > range.start && s < range.end;
    });
  }
  // Klipleri (opsiyonel aralıkla) 16kHz WAV'a çevirir. { wav, offset, cleanup[] } döner.
  // offset = cue zamanlarına eklenecek saniye (kırpma başlangıcı).
  async function prepAudio(clips, trackIdx, name) {
    var range = getRange();
    var used = clipsInRange(clips, range);
    if (range && !used.length) throw new Error("Seçilen süre aralığında bu kanalda konuşma yok.");
    var stamp = Date.now();
    var wav = path.join(cfg.workDir, name + "_" + stamp + ".wav");
    await pipeline.buildTimelineAudio(used, cfg.ffmpegExe, wav, logLine, trackIdx);
    if (!range) return { wav: wav, offset: 0, cleanup: [wav], dur: clipsEnd(used) };
    var wav2 = path.join(cfg.workDir, name + "_r_" + stamp + ".wav");
    await pipeline.trimWav(wav, wav2, range.start, range.end, cfg.ffmpegExe);
    logLine("[aralık] " + fmtShort(range.start) + (isFinite(range.end) ? " → " + fmtShort(range.end) : " → son"));
    return { wav: wav2, offset: range.start, cleanup: [wav, wav2], dur: Math.max(0, Math.min(clipsEnd(used), range.end) - range.start) };
  }
  /* prepAudioMix KALDIRILDI — "A1+A2" kaynak seçeneği kalktı (gerekçe: index.html segTrack notu).
     Tek çağıranı runSingle'ın isMix dalıydı.
     DİKKAT: pipeline.js'teki mixWavs SİLİNMEZ — AutoCut analizinde kanal seslerini birleştirmek
     için hâlâ kullanılıyor. cleanupFiles'ın "single_mix0_*" deseni de duruyor ki eski
     çalıştırmalardan kalan geçici WAV'lar temizlenebilsin. */
  function offsetCues(cues, off) {
    if (off) for (var i = 0; i < cues.length; i++) { cues[i].start += off; cues[i].end += off; }
    return cues;
  }
  function cleanupFiles(list) { for (var i = 0; i < list.length; i++) { try { fs.unlinkSync(list[i]); } catch (e) {} } }
  /* Panel açılışında ESKİ geçici dosyaları temizle. İptal/hata durumunda cleanupFiles hiç
     çalışmadığı için work klasöründe 60+ MB artık birikiyordu (tek bir WAV 44 MB olabiliyor).
     Sadece panelin ürettiği geçici desenler silinir; oturum dosyaları ve kullanıcının kendi
     dosyaları (A1.json/A1.wav gibi) ASLA dokunulmaz. */
  function cleanupOldTemp() {
    try {
      var simdi = Date.now(), gun = 24 * 3600 * 1000;
      /* Önek + (opsiyonel ara ek) + 13 haneli zaman damgası. Ara ek şart: en büyük artıklar
         "single_r_<stamp>.wav", "single_mix0_<stamp>.wav", "a1_r_<stamp>.wav" gibi adlarda ve
         eski desen (önekten hemen sonra rakam) bunları hiç yakalamıyordu.
         oturum_*.json ve kullanıcının kendi dosyaları desende YOK. */
      /* Damgadan SONRA sayaç gelebilir: writeCuesMulti "mcues_<damga>_<sayaç>.txt" yazıyor ve
         eski desen (damgadan hemen sonra nokta bekliyordu) bunları hiç yakalamıyordu — her
         "Timeline'a Ekle" work klasöründe kalıcı bir dosya bırakıyordu.
         snkref/snkplan da eklendi (senkron iptal edilirse finally çalışmayabiliyor).
         snkkirp EKLENMEZ: o dosya artık work'te değil, kullanıcının medya klasöründe ve
         timeline'daki klibin MEDYASI — silinirse klip "Media Offline" olur. */
      var desen = /^(single|a1|a2|ch\d+|acv\d|acvoice|mcues|laned|chan|cuts|cap|sub|cues|fixtext|snkref\d|snkplan|hiz_ref|hiz_hed)_[a-z0-9]*_?\d{10,}(_\d+)?\./;
      var files = fs.readdirSync(cfg.workDir), silinen = 0, bayt = 0;
      for (var i = 0; i < files.length; i++) {
        if (!desen.test(files[i])) continue;
        var fp = path.join(cfg.workDir, files[i]);
        try {
          var st = fs.statSync(fp);
          if (simdi - st.mtimeMs > gun) { bayt += st.size; fs.unlinkSync(fp); silinen++; }
        } catch (e) {}
      }
      if (silinen) logLine("Temizlik: " + silinen + " eski geçici dosya silindi (" + Math.max(1, Math.round(bayt / 1048576)) + " MB).");
    } catch (e) {}
  }

  // ---------- TEK STİL ----------
  async function runSingle() {
    state.genMode = "single";
    setProgress(8, "Sekans okunuyor…");
    pipeline.ensureDir(cfg.workDir);
    // Tek kaynak artık yalnız A1 ya da A2 — "A1+A2" seçeneği kalktığı için dallanma da kalktı.
    var trackIdx = parseInt(state.track, 10);
    var data = await getClips(trackIdx);
    logLine(data.sequenceName + " · " + data.clips.length + " klip");
    setProgress(20, "Ses hazırlanıyor…");
    var prep = await prepAudio(data.clips, trackIdx, "single");
    setProgress(45, "Yazıya dökülüyor (GPU)…");
    _pg.transT0 = Date.now(); _pg.totalSec = prep.dur || 0;
    var cues = await pipeline.transcribe(cfg, prep.wav, function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, 45, 95); }, trOpts());
    offsetCues(cues, prep.offset);
    cleanupFiles(prep.cleanup);
    state.singleCues = cues; state.a1Cues = []; state.a2Cues = []; state.speakers = [];
    renderTranscript(cues, null);
    progressDone("Bitti — " + cues.length + " altyazı hazır");
    await saveSessionAuto();
  }

  /* ================= AYRI KANAL MODU =================
     Arkadaşların sesleri A2/A3/A4… kanallarında AYRI AYRI duruyorsa, konuşmacıyı yapay zekâya
     tahmin ettirmeye gerek yok: her kanal ayrı yazıya dökülür ve kimin konuştuğu %100 kesindir.
     Üstelik ÜST ÜSTE konuşmalar da doğru çıkar — karışık tek kanalda bu fiziksel olarak mümkün
     değil, çünkü Whisper tek metin akışı üretir ve aynı anda konuşan ikisinden biri metne hiç
     girmez. Diarizasyon (pyannote) Discord kaydında %75-90 isabetli; bu mod onu tamamen aradan
     çıkarır. */
  async function scanChannels() {
    if (!CEP) { uiAlert("Önizleme modu — Premiere'de kanallar taranır."); return; }
    /* ÜRETİM SÜRERKEN TARAMA YOK: renderChannelMap state.channels'ı sıfırdan kuruyor, ama
       çalışan runChannels döngüsü ESKİ nesnelere yazıyor. Ortada basılırsa o andan sonra biten
       kanalların altyazıları öksüz nesnelere gidiyor; ekranda ve oturum dosyasında yok oluyor
       (ölçüldü: 15 dakikalık GPU işi sessizce kayboluyordu). */
    if (state.running) {
      uiAlert("Altyazı üretimi sürerken kanal listesi yenilenemez — biten kanalların altyazıları kaybolur.\n\n" +
              "Üretim bitince (ya da İptal edince) tekrar dene.", "Kanal tarama");
      return;
    }
    var raw = await evalES("getAudioTracksJSON()");
    var d; try { d = JSON.parse(raw); } catch (e) { uiAlert("Sekans okunamadı: " + raw, "Kanal tarama"); return; }
    if (d.error === "no_sequence") { uiAlert("Aktif sekans yok. Önce bir sekans aç.", "Kanal tarama"); return; }
    state.kanalTarandi = true;   // tarandı ama boş çıktı -> runChannels farklı (doğru) mesaj versin
    renderChannelMap(d.tracks || [], d.videoTracks || 0);
    logLine("Kanallar: " + (d.tracks || []).map(function (t) { return "A" + (t.idx + 1) + "(" + t.clips + ")"; }).join(" ") +
            " · " + (d.videoTracks || 0) + " video kanalı");
    var secili = aktifKanallar();
    if (secili.length) logLine("Yazıya dökülecek: " + secili.map(kanalAdi).join(", "));
  }
  /* ---------- ALTYAZI STİLİ SEÇİCİLERİ KALDIRILDI (kullanıcı isteği, 2026-08-06) ----------
     Vaktiyle burada kanal başına bir "Track Style" seçici vardı (#trackStilBox). Kaldırıldı
     çünkü HİÇBİR ZAMAN stil UYGULAMIYORDU: Premiere ExtendScript'te caption track'e erişip
     stil atamanın yolu kapalı (üç API yüzeyi de ölçüldü, bkz. CLAUDE.md). Seçicinin tek işi
     üretim sonunda "C1 (sen) → Pink Text" diye bir TALİMAT metni yazdırmaktı; buna karşılık
     7 kanallı bir kadroda ekranı 7 satır boş seçiciyle dolduruyordu.
     Yerine ne var: sonuç mesajı hangi karakterin kaçıncı altyazı kanalına yazıldığını zaten
     söylüyor ("C1 sen · C2 Dora"). Kullanıcı stili Premiere'de Track Style'dan kendi veriyor.
     Not: host.jsx'teki `captionStilleriJSON` ve `addCaptionsToTimeline`'ın ".stil" dosyası
     okuması artık ÇAĞRILMIYOR — dokunulmadı (çalışan altyazı yolunu kurcalamamak için),
     panel o dosyayı hiç yazmadığı için sessizce devre dışı. */

  // list = [{idx, clips, style?, cues?}] — taramadan ya da kaydedilmiş oturumdan gelir
  function renderChannelMap(list, videoTracks) {
    var box = $("kanalRows"); if (!box) return;
    /* Üretilmiş altyazıları KORU. Yeniden tarama (ya da kutuyu kapatıp açma) sadece kanal
       listesini ve stilleri tazelemeli; 30 dakikalık işlemin sonucunu silmemeli. Tarama
       verisinde cues alanı olmadığı için önceki cue'lar kanal numarasına göre geri bağlanır. */
    var eski = {};
    state.channels.forEach(function (c) {
      // Stil seçici kaldırıldı — yalnız cue'lar korunur.
      if (c.cues && c.cues.length) eski[c.idx] = { cues: c.cues };
    });
    box.innerHTML = ""; state.channels = []; state.a1AdInput = null;
    var uyari = $("kanalUyari");
    // A1 = sen; arkadaş kanalları A2'den başlar ve içinde klip olmalı
    var dolu = list.filter(function (t) { return t.idx >= 1 && t.clips > 0; });

    /* A1 (sen) SATIRI — ERKEN DÖNÜŞTEN ÖNCE, HER DURUMDA ÇİZİLİR.
       ⚠ Eskiden "A2 ve sonrasında klip yok" dalı buraya gelmeden `box.innerHTML = …` yazıp
       return ediyordu; A1'in isim kutusu o dalda HİÇ oluşmuyordu. Emoji özelliği o kutuyu
       okuyor ve boş bulunca senin cümlelerinin TAMAMI eleniyordu (kullanıcının gerçek
       oturumunda 465 cümlenin 223'ü, %48 — üstelik en çok konuşan kanal).
       İşaret kutusu YOK: A1 her zaman yazıya dökülür.
       A1 DE İSİM ALIR — arkadaş kanallarıyla aynı kutu, aynı anahtar deseni (kanalAd.0).
       Ayrı bir "senin karakterin" ayarı bilerek yok: kullanıcı "bu zaten kanaldan belli
       olmalı" dedi ve haklı. */
    var a1Row = document.createElement("div"); a1Row.className = "sp-row";
    var a1Info = document.createElement("div"); a1Info.className = "sp-info";
    var a1Ad = document.createElement("input");
    a1Ad.type = "text"; a1Ad.className = "kanal-ad"; a1Ad.spellcheck = false;
    a1Ad.placeholder = "A1 — senin adın (Tofi / Moni)";
    a1Ad.value = lsGet("kanalAd.0", "");
    a1Ad.addEventListener("change", function () { lsSet("kanalAd.0", a1Ad.value.trim()); });
    var a1Sm = document.createElement("div"); a1Sm.className = "sp-sample";
    a1Sm.textContent = "senin mikrofonun · her zaman yazıya dökülür · emoji karakterin de bu";
    a1Info.appendChild(a1Ad); a1Info.appendChild(a1Sm); a1Row.appendChild(a1Info);
    /* NOT: burada bir zamanlar stil seçici vardı, kaldırıldı. Sebep: her karakter kendi altyazı
       kanalını alıyor ve kullanıcı stilleri Premiere'de elle verecek — hangi track'e ne
       vereceğini tek bir listede yan yana görmesi, satırlara dağılmasından daha kolay. */
    box.appendChild(a1Row);
    state.a1AdInput = a1Ad;          // canlı okuma için (bkz. a1Adi)

    if (!dolu.length) {
      /* UYARI SATIRI A1'İ EZMEZ — innerHTML ile yazmak yukarıdaki kutuyu silerdi. */
      var uyP = document.createElement("p");
      uyP.className = "note"; uyP.style.margin = "8px 0 0"; uyP.style.color = "var(--warn)";
      uyP.textContent = "A2 ve sonrasında ses klibi yok. Arkadaşların seslerini ayrı ayrı " +
                        "A2, A3, A4… kanallarına yerleştir.";
      box.appendChild(uyP);
      if (uyari) uyari.hidden = true;
      return;
    }

    dolu.forEach(function (t, i) {
      var row = document.createElement("div"); row.className = "sp-row";
      var onceki = eski[t.idx];

      /* İŞLENSİN Mİ? — OBS kaydı zaten A1/A2/A3'ü kullanıyor olabilir (mikrofon, karışık Discord,
         oyun sesi); Craig dosyaları bunların üstüne gelir. İşaretsiz kanal yazıya DÖKÜLMEZ:
         oyun sesini Whisper'a vermek hem dakikalar kaybettiriyor hem saçma altyazı üretiyor.
         Seçim kanal numarasına göre hatırlanır — bir kere ayarla, sonraki videolarda hazır gelsin. */
      var chk = document.createElement("input");
      chk.type = "checkbox"; chk.className = "kanal-chk"; chk.title = "Bu kanalı yazıya dök";
      /* İŞARET KUTUSU HATIRLANMIYOR — AutoCut'takiyle aynı sebep: kanal numarasının ANLAMI
         kadroya göre değişiyor (oyun sesi 3 arkadaşla A5, 4 arkadaşla A6). Kayıtlı "A5'i
         atla" tercihi sonraki videoda bir ARKADAŞI atlar ve o kişi hiç yazıya dökülmez.
         Oturumdan gelen değer (t.aktif) korunur; yoksa işaretli başlar. */
      chk.checked = (t.aktif != null) ? !!t.aktif : true;
      (function (ix, c, r) {
        function yansit() { if (c.checked) r.classList.remove("kanal-pasif"); else r.classList.add("kanal-pasif"); }
        c.addEventListener("change", function () {
          yansit();                                  // kaydedilmiyor, bkz. yukarıdaki not
        });
        yansit();
      })(t.idx, chk, row);
      row.appendChild(chk);

      // Renk BİR KEZ burada belirlenir ve kanal nesnesine yazılır; transkript de aynı değeri
      // kullanır (bkz. redrawTranscript) — iki taraf birbirinden kaymasın.
      var renk = speakerColor(i);
      var dot = document.createElement("div"); dot.className = "sp-dot"; dot.style.background = renk; row.appendChild(dot);

      var info = document.createElement("div"); info.className = "sp-info";
      // Kanala isim ver ("Dora") — hangi rengin kim olduğu karışmasın, isim de hatırlanır
      var adInp = document.createElement("input");
      adInp.type = "text"; adInp.className = "kanal-ad"; adInp.spellcheck = false;
      adInp.placeholder = "A" + (t.idx + 1) + " — isim yaz";
      adInp.value = t.ad || lsGet("kanalAd." + t.idx, "");
      (function (ix, el) {
        el.addEventListener("change", function () {
          lsSet("kanalAd." + ix, el.value.trim());
        });
      })(t.idx, adInp);
      var sm = document.createElement("div"); sm.className = "sp-sample";
      sm.textContent = "A" + (t.idx + 1) + " · " + t.clips + " klip" +
        (onceki && onceki.cues.length ? (" · " + onceki.cues.length + " altyazı hazır") : "");
      info.appendChild(adInp); info.appendChild(sm); row.appendChild(info);

      // Bu satırda yalnız "yazıya dökülsün mü" işareti ve kanalın adı var.
      box.appendChild(row);
      /* `renk` ALANI ŞART: transkript satırlarındaki renk noktası kanal nesnesinden okunuyor
         (`ch.renk || speakerColor(i)`). Alan hiç yazılmadığı için her kanal yedek renge
         düşüyordu ve kanal listesindeki nokta ile transkriptteki nokta birbirini tutmuyordu. */
      state.channels.push({ idx: t.idx, clips: t.clips, aktifChk: chk, adInput: adInp,
                            renk: renk,
                            cues: t.cues || (onceki ? onceki.cues : []) });
    });
    /* VİDEO KANALI UYARISI KALDIRILDI. v1.8.0 öncesinde her altyazı bir MOGRT klibiydi ve
       video kanalı tüketiyordu; "en az 3 video kanalı gerekir" uyarısı o dönemden kalmaydı.
       Altyazı artık Premiere'in kendi caption track'ine yazılıyor ve video kanalına HİÇ
       dokunmuyor — uyarı yanlış bilgi verip kullanıcıyı gereksiz kanal eklemeye yolluyordu.
       `videoTracks` parametresi imzada KALIYOR: çağıranlar hâlâ geçiyor ve ileride gerçek bir
       video kanalı kontrolü gerekirse buradan okunur. */
    if (uyari) uyari.hidden = true;
  }
  // Kanalin gorunen adi: kullanici isim yazdiysa o, yoksa "A4"
  /* A1'in (senin) adı — arkadaş kanallarıyla AYNI desen: önce CANLI input, yoksa disk.
     ⚠ "sen" VARSAYILANI BİLEREK YOK. Eskiden `lsGet("kanalAd.0") || "sen"` idi ve emoji
     klasöründe "sen" diye bir karakter olmadığı için A1'in bütün cümleleri sessizce
     eleniyordu. Boş dönerse çağıran taraf kullanıcıya SÖYLEYECEK — emsal: restoreSegs,
     kayıtlı kaynak seçimini bulamayınca sessizce A1'e düşmüyor, söylüyor. */
  function a1Adi() {
    var el = state.a1AdInput;
    var ad = el ? String(el.value).trim() : "";
    if (ad) return ad;
    ad = String(lsGet("kanalAd.0", "")).trim();
    if (ad) return ad;
    /* SON ÇARE: Senkron kartındaki "Videoyu kim çekiyor?" seçimi (yw.snkCeken).
       Kaynak Ses A1/A2 iken kanal listesi hiç ÇİZİLMİYOR (modGorunumUygula #kanalBox'ı yalnız
       "Herkes"te gösteriyor), yani state.a1AdInput null kalıyor ve kanalAd.0 hiç dolmamış
       olabilir. O durumda panelin elindeki tek gerçek bilgi bu seçici. Boş dönerse çağıran
       taraf kullanıcıya SÖYLÜYOR — sessizce bir karaktere düşmek yasak. */
    try { return String(lsGet("snkCeken", "")).trim(); } catch (e) { return ""; }
  }

  /* Senkron planındaki karakterleri kanal isimlerine yaz (localStorage + canlı kutular).
     Plan zaten "hangi kanalda kim olacak"ın tek doğru kaynağı; emoji ve altyazı tarafı da
     kanal isimlerinden okuyor. İki kaynağın ayrı ayrı elle doldurulması "Moni çekti ama Tofi
     çıktı" hatasını üretiyordu.
     ATLANANLAR: oyun sesi (karakter değil), eşleşmeyen dosya ("?"), ve boş ad. "(2. kayıt)"
     eki SİLİNİR — o kanalda konuşan yine aynı karakter, emoji eşleşmesi ekle takılmasın. */
  function kanalAdlariniPlandanYaz(plan) {
    if (!plan || !plan.length) return;
    var yazilan = [];
    plan.forEach(function (p) {
      if (!p || p.oyun || p.bilinmeyen) return;
      var ad = String(p.karakter || "").replace(/\s*\(\s*\d+\.\s*kayıt\s*\)\s*$/i, "").trim();
      if (!ad || ad === "?") return;
      var kn = p.kanal;
      if (!(kn >= 0)) return;
      lsSet("kanalAd." + kn, ad);
      /* Canlı kutu da güncellensin: kullanıcı Altyazı ekranına döndüğünde ne olduğunu
         GÖRSÜN. Yalnız localStorage yazmak sessiz bir değişiklik olurdu. */
      if (kn === 0) { if (state.a1AdInput) state.a1AdInput.value = ad; }
      else {
        state.channels.forEach(function (c) {
          if (c && c.idx === kn && c.adInput) c.adInput.value = ad;
        });
      }
      yazilan.push("A" + (kn + 1) + "=" + ad);
    });
    if (yazilan.length) snkLog("Kanal isimleri plandan yazıldı: " + yazilan.join(" · ") +
                               " (emoji karakterleri de bu isimlerden seçiliyor)");
  }

  function kanalAdi(ch) {
    var ad = (ch && ch.adInput) ? String(ch.adInput.value).trim() : "";
    return ad || ("A" + ((ch ? ch.idx : 0) + 1));
  }
  // Yazıya dökülecek kanallar (işareti kaldırılanlar atlanır)
  function aktifKanallar() {
    return state.channels.filter(function (c) { return !c.aktifChk || c.aktifChk.checked; });
  }

  async function runChannels() {
    /* ÖN KOŞULLAR ÖNCE: eskiden state ilk satırda boşaltılıyor, hata SONRA atılıyordu —
       "Kanalları Tara"ya basmadan buraya gelen kullanıcı, Tek Stil'de ürettiği ve elle
       düzelttiği 400 satırlık listeyi bir hata mesajı uğruna kaybediyordu. */
    if (!state.channels.length) {
      throw new Error(state.kanalTarandi
        // Kullanıcıya VAR OLMAYAN bir düğme tarif etme: "A1+A2" düğmesi ve "Tek Stil" sekmesi
        // artık yok. Kalan seçenekler: A1 · A2 · Herkes.
        ? "A2 ve sonrasındaki kanallarda ses klibi yok. “Herkes” her arkadaşın AYRI kanalda " +
          "olmasını ister; tek karışık kanalın varsa Kaynak Ses'i “A2” yap."
        : "Önce “Kanalları Tara” butonuna bas ve kanallara stil ata.");
    }
    var islenecek = aktifKanallar();
    if (!islenecek.length) throw new Error("Hiç kanal seçilmedi. Arkadaşların bulunduğu kanalları işaretle.");

    state.genMode = "channels";
    state.singleCues = []; state.a2Cues = []; state.speakers = [];
    // Önceki üretimin cue'larını temizle — döngü ortasında hata olursa yeni A1 ile eski
    // kanal altyazıları karışık kalıyordu. Yalnız İŞLENECEK kanallar temizlenir: işareti
    // kaldırılmış kanalın eski altyazısı boşuna silinmesin.
    islenecek.forEach(function (c) { c.cues = []; });
    var atlanan = state.channels.length - islenecek.length;
    if (atlanan) logLine(atlanan + " kanal işaretsiz, atlanıyor (oyun sesi/karışık kanal).");
    pipeline.ensureDir(cfg.workDir);
    var pay = 85 / (1 + islenecek.length);
    // ETA yalnız o anki kanalın transkripsiyonunu ölçüyor; etiket bunu söylesin.
    _pg.etaNot = " (bu kanal)";

    setProgress(8, "A1 (sen) okunuyor…");
    var a1 = await getClips(0);
    /* Ses hazırlama (ffmpeg) uzun bir timeline'da dakikalarca sürebiliyor. Eskiden bu sürede
       etiket "yazıya dökülüyor" diyordu ve yüzde hiç kımıldamıyordu — kullanıcı panel dondu
       sanıp Premiere'i kapatıyordu. Her kanalın ses hazırlığı artık kendi adımını gösterir. */
    setProgress(9, "A1 sesi hazırlanıyor…");
    var prep1 = await prepAudio(a1.clips, 0, "a1");
    setProgress(10, "A1 yazıya dökülüyor…");
    _pg.transT0 = Date.now(); _pg.totalSec = prep1.dur || 0;
    state.a1Cues = offsetCues(await pipeline.transcribe(cfg, prep1.wav,
      function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, 10, 10 + pay); }, trOpts()), prep1.offset);
    cleanupFiles(prep1.cleanup);
    logLine("A1: " + state.a1Cues.length + " satır");

    for (var i = 0; i < islenecek.length; i++) {
      var ch = islenecek[i];
      var lo = 10 + pay * (i + 1), hi = 10 + pay * (i + 2);
      var loTr = lo + pay * 0.15;   // ilk %15 ses hazırlama, kalanı transkripsiyon
      setProgress(lo, kanalAdi(ch) + " sesi hazırlanıyor…");
      var data = await getClips(ch.idx);
      var prep = await prepAudio(data.clips, ch.idx, "ch" + ch.idx);
      setProgress(loTr, kanalAdi(ch) + " yazıya dökülüyor…");
      _pg.transT0 = Date.now(); _pg.totalSec = prep.dur || 0;
      ch.cues = offsetCues(await pipeline.transcribe(cfg, prep.wav,
        (function (a, b) { return function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, a, b); }; })(loTr, hi),
        trOpts()), prep.offset);
      cleanupFiles(prep.cleanup);
      logLine(kanalAdi(ch) + ": " + ch.cues.length + " satır");
      // Konuşma çıkmayan kanal muhtemelen oyun sesi/müzik — kullanıcı işareti kaldırsın
      if (!ch.cues.length) {
        logLine("UYARI: " + kanalAdi(ch) + " kanalında konuşma bulunamadı. Oyun sesi/müzik kanalıysa " +
                "işaretini kaldır — bir sonraki üretim daha hızlı biter.");
      }
    }
    redrawTranscript();
    var toplam = state.a1Cues.length;
    islenecek.forEach(function (c) { toplam += c.cues.length; });
    progressDone("Bitti — " + (1 + islenecek.length) + " kanal, " + toplam + " satır");
    await saveSessionAuto();
  }

  /* ================= OTURUM KAYDETME =================
     Panel kapanınca (ya da Premiere yeniden başlayınca) tüm altyazı listesi uçuyordu:
     Renk Değiştir sekmesi kullanılamaz hale geliyor, elle düzeltilen onlarca satır kayboluyor
     ve 30 dakikalık videoyu baştan işlemek dakikalar sürüyordu. Ayarlar zaten kaydediliyordu
     ama asıl değerli veri kaydedilmiyordu.
     AutoCut sonrası timeline zamanları kaydığı için içerik süresi de yazılır; fark varsa
     geri yüklerken uyarılır — yanlış zamanlı listeyle çalışmak sessiz hataya yol açar. */
  var _oturum = { name: "", end: 0 };
  function clipsEnd(clips) {
    var e = 0;
    for (var i = 0; i < (clips || []).length; i++) {
      var x = (clips[i].timelineStartSec || 0) + (clips[i].durationSec || 0);
      if (x > e) e = x;
    }
    return e;
  }
  function sessionPath(seqName) {
    var guv = String(seqName || "sekans").replace(/[^A-Za-z0-9ğüşıöçĞÜŞİÖÇ_ -]/g, "_").slice(0, 60);
    return path.join(cfg.workDir, "oturum_" + guv + ".json");
  }
  function saveSession() {
    if (!CEP || !cfg || !_oturum.name) return;
    try {
      var veri = {
        sequence: _oturum.name, seqEnd: _oturum.end, genMode: state.genMode, savedAt: Date.now(),
        /* A1'İN ADI DA OTURUMA GİRER. Arkadaş kanallarının adı zaten kaydediliyordu (aşağıda
           channels[].ad), A1'inki kaydedilmiyordu; tek kaynağı localStorage'dı ve o CEF
           önbelleğinde duruyor — panel klasöründe değil, koruma listelerinin dışında (aynı
           gerekçe CLAUDE.md'de presetler.json için yazılı). Panel yeniden kurulunca adın
           sessizce gider ve emoji özelliği bir sonraki videoda yine "A1'e adını yaz" der. */
        a1Ad: a1Adi(),
        singleCues: state.singleCues, a1Cues: state.a1Cues, a2Cues: state.a2Cues,
        speakers: state.speakers.map(function (s) {
          return { id: s.id, sample: s.sample, start: s.start, style: s.styleSel ? s.styleSel.value : "" };
        }),
        channels: state.channels.map(function (c) {
          /* `style` alanı oturuma YAZILMIYOR: stil zaten localStorage'da kanal numarasına
             göre duruyor (kanalStil.<idx>, kanalAd.<idx> ile aynı mantık) ve oturumdan
             bağımsız olarak sonraki videolarda da hazır gelmeli. */
          return { idx: c.idx, clips: c.clips,
                   ad: c.adInput ? c.adInput.value : "", aktif: c.aktifChk ? c.aktifChk.checked : true,
                   cues: c.cues };
        })
      };
      /* ATOMİK YAZ + YEDEK. Bu fonksiyon çok sık çağrılıyor (her satır düzeltmesi, her
         konuşmacı/renk değişikliği). Doğrudan üstüne yazarken Premiere çökerse ya da OneDrive
         dosyayı kilitlerse dosya YARIM kalıyor; panel açılışta JSON.parse patlayınca sessizce
         vazgeçiyordu ve kullanıcı yedeğinin olduğunu bile bilmiyordu.
         Önce .tmp'ye yaz → eskisini .bak'a kopyala → yerine taşı. (copyFileSync CEP'in eski
         Node'unda olmayabilir; read+write ile yapılıyor.) */
      var p = sessionPath(_oturum.name), json = JSON.stringify(veri), tmp = p + ".tmp";
      fs.writeFileSync(tmp, json, "utf8");
      try { if (fs.existsSync(p)) fs.writeFileSync(p + ".bak", fs.readFileSync(p)); } catch (eBak) {}
      try { fs.renameSync(tmp, p); }
      catch (eRen) {                       // hedef kilitliyse rename patlar — son çare doğrudan yaz
        fs.writeFileSync(p, json, "utf8");
        try { fs.unlinkSync(tmp); } catch (eTmp) {}
      }
    } catch (e) { logLine("Oturum kaydedilemedi: " + (e.message || e)); }
  }
  // Üretim sonunda çağrılır: sekans kimliğini öğrenip oturumu yazar
  /* ⚠ OTURUM KAYDI A1'E BAĞLI OLAMAZ — VE SESSİZ DÜŞEMEZ.
     Eskiden ilk iş `getClips(0)` çağrılıyordu; o fonksiyon A1 için üç ayrı durumda throw
     ediyor ("A1 kanalı sekansta yok", "A1 kanalında ses klibi yok", "no_sequence") ve
     TAMAMEN BOŞ catch hiçbir iz bırakmadan bütün gövdeyi (_oturum.name ataması + saveSession
     + başarı log'u) atlatıyordu. Panel Kaynak Ses = A2'yi desteklediği hâlde oturum kaydı
     A1'in dolu olmasına bağlıydı ve bu hiçbir yerde yazmıyordu: kullanıcı A2'de 25 dakikalık
     GPU işiyle 800 satır üretiyor, "Bitti" yazısını görüyor, satırları elle düzeltiyor,
     paneli kapatıyor — açtığında ne geri yükleme sorusu geliyor ne de work klasöründe oturum
     dosyası var. Tüm iş ve düzeltmeler kayıp, sebep görünmez.
     Sekans KİMLİĞİ artık kaynaktan bağımsız okunuyor (getSequenceInfoJSON); getClips yalnız
     "seqEnd" (kayma tespiti) için deneniyor ve başarısızlığı kaydı ENGELLEMİYOR. */
  async function saveSessionAuto() {
    if (!CEP || !cfg) return;
    var seqAdi = "", seqSure = 0;
    try {
      var si = JSON.parse(String(await evalES("getSequenceInfoJSON()")));
      if (si && si.sequenceName) seqAdi = String(si.sequenceName);
      if (si && si.durationSec > 0) seqSure = Number(si.durationSec);
    } catch (eSi) {}
    try {
      var d = await getClips(0);
      _oturum.name = d.sequenceName || seqAdi;
      _oturum.end = clipsEnd(d.clips);
      _oturum.seqDur = seqSure;   // her iki dalda da yazılır: bayat değer kalmasın
    } catch (e) {
      if (!seqAdi) {
        logLine("Oturum KAYDEDİLEMEDİ — sekans adı okunamadı: " + (e.message || e));
        return;
      }
      /* A1 boş/yok: ad elimizde, kayıt yapılır. seqEnd 0 kalır — geri yüklemedeki
         "timeline kaymış mı" kontrolü o durumda kendiliğinden atlanıyor (o.seqEnd && …).
         ⚠ AMA SEKANS SÜRESİ ELDE: sekansKimlik() süreyi kimliğe katıyor ve tek sebebi
         Premiere'in varsayılan adlarının ("Video Sequence") projeler arası TEKRAR ETMESİ.
         end=0 bırakmak kimliği "<ad>_0"a çökertip tam da o korumayı kaldırıyordu — iki
         farklı projenin emoji kanal→karakter seçimi aynı anahtarı paylaşırdı.
         seqDur AYRI alan: `end` semantiği clipsEnd(A1), durationSec ise sekansın tamamı;
         karıştırılırsa geri yüklemedeki kayma kontrolü yanlış pozitif üretir. */
      _oturum.name = seqAdi; _oturum.end = 0; _oturum.seqDur = seqSure;
      logLine("A1 okunamadı (" + (e.message || e) + ") — oturum yine de kaydediliyor.");
    }
    saveSession();
    logLine("Oturum kaydedildi — panel kapansa da liste durur.");
  }
  function restoreSession(o) {
    state.genMode = o.genMode || "single";
    /* A1 adını oturumdan geri koy (localStorage silinmiş ya da başka makineye taşınmış
       olabilir). renderChannelMap'ten ÖNCE olmak ZORUNDA: kutu değerini lsGet ile dolduruyor. */
    if (o.a1Ad) lsSet("kanalAd.0", String(o.a1Ad).trim());
    state.singleCues = o.singleCues || [];
    state.a1Cues = o.a1Cues || [];
    state.a2Cues = o.a2Cues || [];
    state.speakers = []; state.channels = [];
    if (state.genMode === "channels" && (o.channels || []).length) {
      renderChannelMap(o.channels, 0);   // 0 = bilinmiyor; sahte değer uyarıyı kalıcı bastırıyordu
      state.kanalTarandi = true;         // liste dolu geldi; "önce tara" demeye gerek yok
    } else if (state.genMode === "speaker") {
      /* ESKİ "Konuşmacıya Göre" (diarizasyon) oturumu. O mod kaldırıldı; cue'lar A1+A2
         olarak tek listede birleştirilir — metin ve zamanlar korunur, yalnız konuşmacı
         ayrımı (renk) düşer. Bu oturumu tamamen reddetmek 30 dakikalık işi çöpe atardı. */
      state.singleCues = (o.a1Cues || []).concat(o.a2Cues || []);
      state.singleCues.sort(function (a, b) { return a.start - b.start; });
      state.a1Cues = []; state.a2Cues = []; state.speakers = [];
      state.genMode = "single";
      logLine("Eski konuşmacı ayrımlı oturum tek listeye birleştirildi (" + state.singleCues.length + " altyazı).");
    }
    redrawTranscript();
    modGorunumUygula();
    progressDone("Kaydedilmiş oturum geri yüklendi — " + allCues().length + " altyazı");
  }
  /* Oturum dosyasını okur; ana dosya bozuksa .bak yedeğine düşer.
     Eskiden parse hatasında SESSİZCE dönülüyordu: ne log, ne uyarı — kullanıcı 30 dakikalık
     işi baştan yapıyor ve panelin oturum kaydettiğinden şüphe ediyordu. */
  function oturumOku(seqName) {
    var p = sessionPath(seqName);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, "utf8")); }
      catch (e) { logLine("Kaydedilmiş oturum dosyası okunamadı (bozuk olabilir): " + p); }
    }
    if (fs.existsSync(p + ".bak")) {
      try {
        var y = JSON.parse(fs.readFileSync(p + ".bak", "utf8"));
        logLine("Oturumun YEDEĞİ kullanıldı (" + p + ".bak) — son birkaç düzeltme eksik olabilir.");
        return y;
      } catch (e2) { logLine("Oturum yedeği de okunamadı: " + p + ".bak"); }
    }
    return null;
  }
  function kayitliOturumVarMi() {
    try {
      if (!CEP || !cfg || !_oturum.name) return false;
      var p = sessionPath(_oturum.name);
      return fs.existsSync(p) || fs.existsSync(p + ".bak");
    } catch (e) { return false; }
  }
  async function offerSessionRestore() {
    if (!CEP || !cfg) return;
    var d;
    try { d = await getClips(0); } catch (e) { return; }     // sekans yoksa sessizce çık
    _oturum.name = d.sequenceName; _oturum.end = clipsEnd(d.clips);
    var o = oturumOku(d.sequenceName);
    if (!o) return;
    var toplam = (o.singleCues || []).length + (o.a1Cues || []).length + (o.a2Cues || []).length;
    (o.channels || []).forEach(function (c) { toplam += (c.cues || []).length; });
    if (!toplam) return;
    var kaymis = o.seqEnd && Math.abs(o.seqEnd - _oturum.end) > 1.0;
    var dk = Math.round((Date.now() - (o.savedAt || 0)) / 60000);
    var ne = dk < 60 ? (dk + " dakika") : dk < 1440 ? (Math.round(dk / 60) + " saat") : (Math.round(dk / 1440) + " gün");
    var msg = "Bu sekans için kaydedilmiş " + toplam + " altyazı var (" + ne + " önce).\n\n" +
      (kaymis ? "⚠ DİKKAT: sekansın uzunluğu o zamandan beri değişmiş (muhtemelen AutoCut yapıldı).\n" +
                "Altyazı zamanları KAYMIŞ olabilir.\n\n" : "") +
      "Geri yüklensin mi?";
    if (!(await uiConfirm(msg, "Kaydedilmiş oturum"))) return;
    restoreSession(o);
  }

  // ---------- yerleştirme ----------
  /* TEMİZLİK BEYAZ LİSTESİ — host, altyazı basmadan önce hedef kanaldaki ESKİ altyazıları
     siler. Bunu "adı bizim altyazımıza benziyor mu" diye yapar; hangi adların bize ait
     olduğunu buradan öğrenir.
     Neden bu çalıştırmadaki stil YETMİYOR: kullanıcı stili değiştirip yeniden basarsa eski
     kliplerin adı farklıdır, beyaz listeye girmez ve silinmez — ekranda ÇİFT altyazı olur.
     Bu yüzden panelin tanıdığı BÜTÜN stil adları gönderilir. Kullanıcının kendi
     grafikleri (stil klasöründe olmayan) listede olmadığı için asla silinmez. */

  function showResult(r) {
    var ham = String(r);
    logLine("Premiere sonucu: " + ham);           // ham metin her zaman Ayrıntılar'da kalsın
    if (ham.indexOf("ok:") !== 0) { var m = hostMesaj(ham); progressFail("⚠ " + m, "warn"); uiAlert(m, "Sonuç"); return; }
    /* KISMİ BAŞARI da "ok:" ile başlıyor ("ok:0 eklendi, 412 hata | MOGRT yok: …").
       Sadece öneke bakmak yeşil ✓ gösteriyordu; kullanıcı altyazıların yarısının eklenmediğini
       fark etmeden montaja devam ediyordu. */
    var hm = ham.match(/(\d+)\s*hata/);
    var hataSayisi = hm ? parseInt(hm[1], 10) : 0;
    var msg = ham.replace(/^ok:/, "");
    if (hataSayisi) {
      progressFail("⚠ " + msg, "warn");
      // Tanıdık bir sebep varsa (ör. MOGRT bulunamadı) anlaşılır açıklamayı da ekle
      var ceviri = hostMesaj(ham), ek = (ceviri === msg) ? "" : "\n\n" + ceviri;
      // /g şart: host mesajı birden çok "|" ile bölünmüş olabiliyor ("… | metin: …")
      uiAlert("Bazı altyazılar eklenemedi:\n\n" + msg.replace(/\s*\|\s*/g, "\n\n") + ek, "Sonuç");
      return;
    }
    /* GİZLENEN / ÜST ÜSTE KALAN / BOŞ KALAN KANAL "hata" DEĞİL ama sessiz de geçilemez.
       Yukarıdaki hata dalı kullanılamaz: o "Bazı altyazılar eklenemedi" diyor, oysa gizlenen
       altyazı eklenemedi değil BİLEREK eklenmedi — yanlış açıklama yanlış teşhise yollar.
       Modal bilerek yok: her basışta pencere açmak yıldırır (büyük kayıp zaten yerleştirmeden
       ÖNCE onay soruyor), sayı sonuç çubuğunda duruyor. */
    if (/altyazı gizlendi|ÜST ÜSTE kaldı|altyazı kalmadı/.test(ham)) { progressFail("⚠ " + msg, "warn"); return; }
    progressDone("Bitti — " + msg);
  }

  // Timeline'a yerleştirir; ham sonuç metnini döndürür (null = iptal, zaten uyarıldı).
  /* KAÇ VİDEO KANALI GEREKİYOR?
     host tarafında altyazının gittiği kanal  idx = (videoKanalSayısı - 1) - lane.
     En alttaki kanal (idx 0) kullanıcının GÖRÜNTÜSÜ ve asla kullanılmamalı, yani idx >= 1:
        (vt - 1) - enUstLane >= 1   =>   vt >= enUstLane + 2
     Sayı okunamazsa yerleştirme YAPILMAZ: yanlış tahminin bedeli, silinen görüntü.
     Dönüş: kanal sayısı (yeterliyse) ya da 0 (yetersiz — kullanıcı zaten uyarıldı). */

  /* ---------- YERLEŞTİRME: HER SES KANALI KENDİ ALTYAZI KANALINA ----------
     Eskiden üç yol vardı (placeSingle MOGRT dalı, placeSpeaker, placeChannels) ve her
     altyazı ayrı bir MOGRT klibi oluyordu: 20 dakikalık videoda ~1000 klip, Premiere
     kasıyordu. O yol v1.8.0'da kalktı; altyazı artık Premiere'in kendi altyazı kanalına
     yazılıyor ve video kanalı TÜKETMİYOR — katman bütçesi / görüntü silme sınıfı hataların
     tamamı bu yüzden ortadan kalktı. Buraya lane/katman mantığı geri EKLEME.

     NEDEN TEK DEĞİL DE KANAL BAŞINA AYRI TRACK: bir caption track'in TEK stili olur — stil
     kliplerin değil, TRACK'in ayarıdır (Premiere: Caption Track Settings > Style). Yani tek
     track'e yazarken "Tofi pembe / Moni siyah" imkânsızdı. Premiere birden çok caption
     track'i destekliyor (Text panelinde kendi ifadesi: "Multiple caption tracks enabled"),
     her birinin kendi stili olur. Bu yüzden "Herkes" kaynağında her ses kanalı AYRI bir
     altyazı kanalına yazılır; kullanıcı sonra her track'e kendi stilini verir.

     ÇAĞRI SIRASI = TRACK SIRASI. Hangi ses kanalının kaçıncı altyazı kanalına gittiği log'a
     ve sonuç mesajına yazılır — yoksa kullanıcı hangi track'e hangi stili vereceğini bilemez.
     Tek kaynak seçiliyken (A1 ya da A2) tek grup olur, davranış eskisiyle aynıdır. */
  async function placeCaptions(range) {
    /* AUTOCUT SONRASI BAYATLIK FRENİ. Boşluklar kesilince timeline kısalıyor ama elde duran
       cue'lar eski zamanlarda kalıyor — yerleştirilirse hepsi kesilen toplam süre kadar kayar.
       Kullanıcı kendi akışında önce kesip sonra üretiyor, yani bu yola normalde girmiyor;
       fren yine de duruyor çünkü bedeli tek bir onay sorusu, karşılığı ise fark edilmesi zor
       (ve videoyu çıkarana kadar görünmeyen) dakikalarca kayma. */
    if (state.cuesStale) {
      var devamBayat = await uiConfirm(
        "Bu altyazılar AutoCut kesiminden ÖNCE üretildi.\n\n" +
        "Kesim timeline'ı kısalttığı için altyazılar kesilen toplam süre kadar KAYAR — " +
        "dakikalarca olabilir.\n\nDoğrusu altyazıyı yeniden üretmek. Yine de ekleyeyim mi?", "Altyazı");
      if (!devamBayat) return null;
    }
    /* İKİNCİ BASIŞ FRENİ — ÜST ÜSTE YAZININ ZAMANLAMADAN BAĞIMSIZ İKİNCİ SEBEBİ.
       host.jsx addCaptionsToTimeline her çağrıda KOŞULSUZ `seq.createCaptionTrack` çalıştırıyor;
       eski caption track'leri silen, sayan ya da yeniden kullanan tek satır kod YOK (panel
       caption track'e hiç erişemiyor — üç API yüzeyi de ölçüldü, bkz. CLAUDE.md). Yani 5
       karakterli bir videoda ikinci basış 5 track DAHA yaratır ve her altyazı ekranda İKİ KEZ,
       birebir üst üste çizilir. Aşağıdaki bütün çakışma çözümü tek basış varsayımıyla çalışır;
       önceki basıştan kalan track'ler o hesabın tümüyle dışındadır.
       Panel track sayısını okuyamadığı için tek yol SORMAK. Bayrak sekans adına bağlı ve
       kalıcı: her yerleştirme yeni track yarattığı için soru her tekrarda sorulmalı. */
    var capAnahtar = "capBasildi_" + (_oturum.name || "sekans");
    if (lsGet(capAnahtar, "") === "1") {
      var devamTekrar = await uiConfirm(
        "Bu sekansa daha önce altyazı eklendi.\n\n" +
        "Panel eski altyazı kanallarını SİLEMİYOR (Premiere script'ten izin vermiyor). " +
        "Şimdi eklersem yenileri eskilerin ÜSTÜNE gelir ve her yazı ekranda iki kez görünür.\n\n" +
        "Önce Premiere'de eski altyazı kanallarını (C1, C2…) sil.\n\nSildiysen devam edeyim mi?",
        "Altyazı");
      if (!devamTekrar) return null;
    }
    /* HER KARAKTERE AYRI ALTYAZI KANALI:  C1 = videoyu çeken (A1) · sonra yazıya dökülen
       her ses kanalı kendi track'ine (aktifKanallar() sırasıyla).
       Bir ara sabit iki kanala (C1 = sen, C2 = arkadaşlar birleşik) indirilmişti; kullanıcı
       karaktere göre renk istediği için geri alındı.
       BEDELİ: panel stili ATAYAMIYOR (host.jsx ölçümü — seq.captionTracks yok), yani her
       videoda track sayısı kadar elle Track Style vermek gerekiyor. Bunu katlanılır kılan
       şey, sonuç mesajının "hangi track kimin" eşlemesini yazması.
       KAZANCI: aynı anda konuşanların cue'ları artık AYRI track'lerde, yani birbirini
       ezmiyor — birleşik C2 devrinde ölçülen ~600 çözülemeyen çakışma bu düzende doğmuyor.
       Tek kaynak (A1/A2) seçiliyken zaten tek grup olur. */
    var gruplar = [];
    if (state.genMode === "channels") {
      if (state.a1Cues && state.a1Cues.length) {
        gruplar.push({ ad: "sen", cues: state.a1Cues });
      }
      /* Konuşma çıkmayan kanal ATLANIR: boş bir caption track oluşturmak hem işe yaramaz
         hem sonraki track'lerin C-numarasını kaydırıp "hangi track kimin" eşlemesini yanıltır. */
      aktifKanallar().forEach(function (ch) {
        if (ch.cues && ch.cues.length) {
          gruplar.push({ ad: kanalAdi(ch), cues: ch.cues });
        }
      });
    } else if (state.singleCues && state.singleCues.length) {
      gruplar.push({ ad: "Altyazı", cues: state.singleCues });
    }

    var isler = [];
    gruplar.forEach(function (g) {
      var c = g.cues;
      if (range) c = c.filter(function (x) { return x.end > range.start && x.start < range.end; });
      if (!c.length) return;
      /* Zaman sırası ŞART: motor kanal içinde sırasız satır döndürebiliyor ve sesleHizala
         cue'ları ileri itebiliyor. cuesToSrt diziyi olduğu sırayla yazdığı için sıralanmamış
         liste, zamanı geriye giden bir SRT üretir ve Premiere böyle bir dosyayı reddedebilir. */
      isler.push({ ad: g.ad,
                   cues: c.slice().sort(function (a, b) { return a.start - b.start; }) });
    });
    if (!isler.length) { uiAlert("Önce altyazı oluştur."); return null; }

    /* TOFI MONI VİDEO MODU — cue'ları SEYRELTİR (ilk dakika tam, sonrasında ~20 sn'de bir
       en vurucu cümle). Seçimi Claude yapıyor; panelin internete çıktığı TEK yer burası ve
       yalnız kutu işaretliyken çalışır.
       YIKICI DEĞİL: cue'lar silinmiyor, işaretleniyor — mod kapatılıp yeniden basılırsa
       25 dakikalık GPU işi tekrar edilmiyor. Hata olursa altyazı TAM hâliyle eklenir;
       sessizce yarım iş yapmaktansa moddan vazgeçmek doğru. */
    if (vurucuAcik() && VUR && CEP) {
      try {
        logLine("Vurucu cümleler seçiliyor (yapay zekâ)…");
        var vGiris = isler.map(function (x) { return { ad: x.ad, cues: x.cues }; });
        var vSonuc = await VUR.vurucuSec(extRoot, vGiris, { onLog: logLine });
        for (var vi = 0; vi < isler.length; vi++) {
          if (vSonuc && vSonuc.gruplar && vSonuc.gruplar[vi] && vSonuc.gruplar[vi].cues) {
            isler[vi].cues = vSonuc.gruplar[vi].cues;
          }
        }
      } catch (eVur) {
        logLine("Vurucu mod atlandı: " + (eVur.message || eVur));
        uiAlert("Vurucu mod çalışmadı:\n\n" + (eVur.message || eVur) +
                "\n\nAltyazılar TAM hâliyle eklenecek.", "Altyazı");
      }
    } else if (!vurucuAcik() && VUR) {
      // Mod kapatıldıysa eski işaretler kalmasın, yoksa SRT filtrelenmeye devam eder.
      isler.forEach(function (x) { try { VUR.temizle(x.cues); } catch (eT) {} });
    }

    /* ⚠ VURUCU MOD BİR GRUBUN TÜM CUE'LARINI ELEYEBİLİR — BOŞ GRUP DÜŞÜRÜLMEK ZORUNDA.
       Yukarıdaki `if (!isler.length)` kontrolü vurucu bloğundan ÖNCE çalışıyor ve bunu
       göremiyor; boş grubu düşüren tek kod ise aşağıdaki GİZLEME bloğunun içinde, yani
       `kaSayac.gizlenen` şartına bağlı. Oysa vurucu.js `gosterilenler()` işaretli cue varken
       hiçbiri seçilmemişse BOŞ dizi döndürüyor ve `isaretle` her cue'ya vurucuGoster yazdığı
       için "işaretli var" her zaman doğru: az konuşan / hiçbir 20 sn penceresinde "en vurucu"
       seçilmeyen karakterin grubu cues:[] olarak geri geliyordu.
       Sonucu: içinde yalnız "\n" olan bir SRT yazılıp addCaptionsToTimeline'a gönderiliyor →
       ya ekranda hiçbir yazı olmayan FAZLADAN bir caption track açılıyor (ve kullanıcının
       Track Style vermek için güvendiği "C1 sen · C2 Dora · C3 Sage" eşlemesi gerçek track
       sırasıyla tutmuyor) ya da içe alma başarısız olup hiçbir altyazı kaybı olmadığı hâlde
       sarı hata gösteriliyordu. Uç durumda (API bozuk cevap verirse) BÜTÜN gruplar boşalıyor
       ve panel N adet boş SRT yazıp "ok:0 altyazı" diye YEŞİL başarı raporluyordu.
       ⚠ Sayaç AYRI bir değişkende (`vBosKalanlar`): aşağıdaki `bosKalanlar` gizleme bloğunda
       sıfırlanıyor, oraya yazmak sessizce ezilirdi. */
    var vBosKalanlar = "";
    if (vurucuAcik() && VUR) {
      var vDusen = [];
      isler = isler.filter(function (x) {
        if (x.cues && x.cues.length) return true;
        vDusen.push(x.ad); return false;
      });
      if (vDusen.length) {
        vBosKalanlar = vDusen.join(", ");
        logLine("Vurucu modda hiç cümle seçilmedi, altyazı kanalı oluşturulmadı: " + vBosKalanlar);
      }
      /* Hepsi boşaldıysa AYRI mesaj: aşağıdaki genel kontrol "çakışma yüzünden gizlendi"
         diyor ve YANLIŞ sebebi gösterirdi. */
      if (!isler.length) {
        uiAlert("Vurucu mod hiçbir cümle seçmedi — altyazı yazılmadı.\n\n" +
                "“Tofi Moni video modu” kutusunu kapatıp tekrar dene.", "Altyazı");
        return null;
      }
    }

    /* CUE NESNELERİNİN KOPYASINI AL — BURADAN SONRASI ZAMANLARI DEĞİŞTİRİYOR.
       `isler[i].cues` şimdiye kadar state.a1Cues / ch.cues içindeki cue nesnelerinin TA
       KENDİSİYDİ: yukarıdaki c.slice() yalnız DİZİYİ kopyalıyor, içindeki nesneleri değil.
       Çakışma gidericileri cue.start / cue.end'i YERİNDE yazdığı için her "Timeline'a Ekle"
       basışı panelin kendi listesini kalıcı bozuyordu: ikinci basışta cue'lar İKİNCİ kez
       kırpılıyor, transkript ekranı timeline'ı tutmuyor ve saveSession (metin düzeltmesinde
       de çalışıyor) bozulmuş zamanları oturum dosyasına yazıyordu. BUGÜNE KADAR
       GÖRÜNMEMESİNİN TEK SEBEBİ, kanal içi gidericinin kullanıcının verisinde hiçbir şey
       değiştirmemesiydi (ölçüldü: 0 kırpma / 0 itme — tam bir no-op). Aşağıya eklenen
       kanallar arası geçiş ise GERÇEKTEN kırpıyor (ölçüldü: 233 cue'da 20 kırpma), yani
       kopya artık ŞART.
       KOPYA GENEL — ALAN LİSTESİ TUTULMUYOR. Alanları tek tek saymak (start/end/text/…)
       bu projenin iki kez yandığı sessiz-alan-düşürme tuzağı: cue'ya ileride eklenecek bir
       alan (emoji, konuşmacı, yeni bir işaret) burada hata vermeden kaybolurdu.
       Kopya vurucu bloğundan SONRA alınıyor ki VUR.isaretle / VUR.temizle GERÇEK nesnelere
       yazmaya devam etsin — "mod kapatılınca işaret kalkar" kuralı bozulmasın. */
    isler.forEach(function (x) {
      x.cues = x.cues.map(function (c) {
        var n = {}, k;
        for (k in c) if (Object.prototype.hasOwnProperty.call(c, k)) n[k] = c[k];
        return n;
      });
    });

    /* ÇAKIŞMA GİDER. Her track artık TEK kişinin olduğu için kişiler arası çakışma yok;
       kalan tek kaynak aynı konuşanın kendi içinde üst üste binen cue'ları (motor damgası +
       sesleHizala'nın ileri itmesi). Nadir ama bedava: çakışan altyazılardan birini Premiere
       sessizce yutuyor ve panel yine "ok" dönüyor — kayıp ancak video çıkarılırken fark
       edilir. Fonksiyon yoksa (eski pipeline.js) atlanır ama söylenir. */
    isler.forEach(function (x) {
      if (pipeline && typeof pipeline.cakismaGider === "function") {
        try { pipeline.cakismaGider(x.cues, logLine); } catch (eCk) { logLine("Çakışma giderilemedi: " + (eCk.message || eCk)); }
      } else logLine("UYARI: çakışma gidericisi yok — aynı anda konuşanların altyazısı üst üste binebilir.");
    });

    /* KANALLAR ARASI ÇAKIŞMA — YUKARIDAKİ DÖNGÜNÜN GÖRMEDİĞİ ŞEY.
       Yukarıdaki cakismaGider her grubun KENDİ listesine bakıyor; C1'in cue'su ile C3'ün
       cue'sunun kesişip kesişmediğini hesaplayan tek satır kod yoktu. Premiere caption
       track'lerinin hepsini aynı anda ve aynı yerde çizdiği için kullanıcı bunu ekranda
       üst üste yazı olarak görüyor (ÖLÇÜLDÜ, kullanıcının gerçek oturumu: 233 cue / 5 grup /
       35 çakışan çift / 12.41 sn).
       Politika (ayrıntısı pipeline.js'te): önce KIRP (senkron bozulmaz), yetmezse kutu
       açıksa GİZLE, hiçbir zaman İTME. Ölçülen sonuç: yalnız kırpma 35 -> 9 çift,
       kırpma + gizleme 35 -> 0 (12 cue gizlenerek, hiçbiri C1 değil).
       sesleHizala'dan SONRA çalışmak ZORUNDA: onun rijit dalı cue'yu ileri UZATABİLİYOR ve
       yeni bir kanallar arası çakışma doğurabiliyor. Tek grup varsa fonksiyon hiç iş
       yapmadan dönüyor — tek kaynak (A1/A2) modu birebir eskisi gibi kalır. */
    var kaSayac = null, gizlenenToplam = 0, bosKalanlar = "";
    if (isler.length > 1) {
      if (pipeline && typeof pipeline.kanallarArasiCakisma === "function") {
        try {
          kaSayac = pipeline.kanallarArasiCakisma(isler, { gizle: cakismaGizle() }, logLine);
          /* EŞİK FRENİ — TOPLU METİN KAYBINI SESSİZCE YUTMA. Bedel moda göre 5 kat
             değişiyor: vurucu modu açıkken birkaç altyazı, kapalıyken (tam altyazı, binlerce
             cue) yüzlerce olabiliyor. Sonuç çubuğundaki sarı satır bu büyüklükte bir kayıp
             için yeterli değil — henüz hiçbir şey yazılmadığı için iptal BEDAVA, sor.
             Eşik hem mutlak hem oransal: 20 altyazının altı zaten gürültü, üstü ise ancak
             toplamın %3'ünü aşarsa kullanıcıyı rahatsız etmeye değer. */
          var toplamCue = 0;
          isler.forEach(function (x) { toplamCue += x.cues.length; });
          var esik = Math.max(20, Math.round(toplamCue * 0.03));
          if (kaSayac.gizlenen > esik) {
            var yuzde = (kaSayac.gizlenen * 100 / Math.max(1, toplamCue)).toFixed(1);
            var devamGizle = await uiConfirm(
              kaSayac.gizlenen + " altyazı (%" + yuzde + ") videoda HİÇ görünmeyecek — " +
              "o anlarda iki kişi aynı anda konuşuyor ve “asla üst üste gelmesin” açık.\n\n" +
              "Evet: gizle, hiçbir yazı üst üste binmesin.\n" +
              "Hayır: hiçbirini gizleme, o anlarda yazılar üst üste binsin.", "Altyazı");
            if (!devamGizle) {
              // Kopya üzerinde çalışıyoruz: işaretleri silip gizlemesiz yeniden koşmak güvenli.
              isler.forEach(function (x) {
                x.cues.forEach(function (c) { if (c.gizliCakisma) delete c.gizliCakisma; });
              });
              logLine("Gizleme iptal edildi — kırpma yapıldı, kalan çakışmalar üst üste kalacak.");
              kaSayac = pipeline.kanallarArasiCakisma(isler, { gizle: false }, logLine);
            }
          }
        } catch (eKa) { logLine("Kanallar arası çakışma giderilemedi: " + (eKa.message || eKa)); }
      } else {
        // Eski pipeline.js ile eşleşme: sessizce eski davranışa düşme, SÖYLE.
        logLine("UYARI: kanallar arası çakışma gidericisi yok (pipeline.js eski) — " +
                "aynı anda konuşanların altyazısı ekranda üst üste binebilir.");
      }
    }
    /* GİZLENENLERİ SRT LİSTESİNDEN DÜŞ. Cue nesnesi SİLİNMİYOR — yalnız bu yerleştirmede
       yazılmıyor. Kopya üzerinde çalıştığımız için panelin listesi ve oturum dosyası hiç
       etkilenmez (vurucu modundaki "işaretle, silme" kuralıyla aynı mantık). */
    if (kaSayac && kaSayac.gizlenen) {
      isler.forEach(function (x) {
        var once = x.cues.length;
        x.cues = x.cues.filter(function (c) { return !c.gizliCakisma; });
        gizlenenToplam += (once - x.cues.length);
      });
      /* Bir grup TAMAMEN boşalabilir (az konuşan bir karakterin her cue'su gizlenirse).
         Boş SRT yazmak Premiere'de boş bir caption track üretir ve C-numaralandırmasını
         kaydırır — "C3 Dora" dediğimiz track artık Dora'nınki olmaz, kullanıcı da Track
         Style'ları o numaralara göre elle veriyor. Grubu düşür ve ADIYLA söyle. */
      var dusenler = [];
      isler = isler.filter(function (x) {
        if (x.cues.length) return true;
        dusenler.push(x.ad); return false;
      });
      if (dusenler.length) {
        logLine("Altyazı kalmadı, kanal oluşturulmadı: " + dusenler.join(", "));
        bosKalanlar = dusenler.join(", ");
      }
    }
    /* Her şey gizlendiyse yerleştirecek bir şey yok. Sessizce "ok" dönmek yasak —
       kullanıcı boş bir timeline'a bakıp panelin çalıştığını sanardı. */
    if (!isler.length) return "err:Bütün altyazılar çakışma yüzünden gizlendi. " +
      "“Asla üst üste gelmesin” kutusunu kapat ya da kanal sayısını azalt.";

    /* AYNI CÜMLEDE BOŞLUK BIRAKMA — SON ADIM, SRT YAZILMADAN HEMEN ÖNCE.
       buildCues her cue'nun bitişini `sonraki.start - 0.08`e dayıyor; kelime tavanı 2 olduğu
       için hızlı konuşmada neredeyse HER cue sınırında 2 karelik bir boşluk kalıyor ve yazı
       sürekli yanıp sönüyor (kullanıcı: "kelime aralarında boşluk oluyo, garip duruyo").
       Aynı cümlenin ardışık cue'ları yapıştırılır, cümleler arasındaki boşluk KORUNUR.
       ⚠ SIRA BİLEREK EN SONDA — üç sebebi var:
         1) Kanallar arası çakışma çözümünden SONRA çalışır, yani köprü yeni bir çakışma
            doğurup KIRPMA/GİZLEME tetikleyemez. Yanıp sönmeyi düzeltmek için altyazı
            kaybetmek yanlış takas olurdu; fonksiyon kendi içinde diğer kanalları kontrol
            edip gerekirse köprüyü hiç kurmuyor.
         2) Gizlenen cue'lar listeden DÜŞÜRÜLDÜKTEN sonra çalışır, yani köprü gerçekten
            ekrana çıkacak komşuya kurulur.
         3) Cue KOPYASI üzerinde çalışıyoruz (yukarıdaki kopya bloğu) — panelin listesi,
            oturum dosyası ve emoji süreleri hiç etkilenmez. */
    if (pipeline && typeof pipeline.cumleBirlestir === "function") {
      try { pipeline.cumleBirlestir(isler, {}, logLine); }
      catch (eKp) { logLine("Cümle birleştirme yapılamadı: " + (eKp.message || eKp)); }
    } else logLine("UYARI: cümle birleştirici yok (pipeline.js eski) — altyazılar arasında boşluk kalır.");

    var basarili = [], hatalar = [], toplam = 0;
    for (var i = 0; i < isler.length; i++) {
      var is = isler[i];
      /* SON EMNİYET: boş cue listesi Premiere'de BOŞ bir caption track üretir ve C
         numaralandırmasını kaydırır. Yukarıdaki iki filtre (vurucu + gizleme) bunu zaten
         yakalıyor; bu satır, ileride araya girecek yeni bir seyreltme adımının aynı hatayı
         sessizce geri getirmesini engelliyor. */
      if (!is.cues || !is.cues.length) { logLine(is.ad + " → altyazı kalmadı, kanal açılmadı."); continue; }
      /* ⚠ SRT work KÖKÜNE DEĞİL captions/ ALT KLASÖRÜNE YAZILIR — GERİ ALMA.
         host addCaptionsToTimeline dosyayı importFiles ile PROJE ÖĞESİ yapıyor ve caption
         track'i o öğeden kuruyor, yani dosya projenin KALICI bir bağımlılığı. Panel tarafında
         ise açılışta çalışan cleanupOldTemp deseni "cap_<damga>_<n>.srt" adını geçici sayıp
         24 saatten eskiyse SİLİYORDU: kullanıcı Pazartesi altyazı basıp projeyi kaydediyor,
         Salı paneli açınca beş SRT siliniyor ("Temizlik: 5 eski geçici dosya silindi") ve
         proje bir daha açıldığında altyazı öğelerinin kaynağı diskte yok.
         Aynı hata sınıfı bu projede bir kez yaşandı: kırpılmış Craig kaydı work'e yazılınca
         klip "Media Offline" oluyordu, o yüzden `hizalanmis` klasörüne taşındı.
         cleanupOldTemp readdirSync ile ÖZYİNELEMESİZ tarıyor, yani alt klasöre hiç dokunmaz.
         Dosya adına sıra da giriyor: Date.now() aynı milisaniyede iki kez dönebiliyor ve
         ikinci SRT birincinin üstüne yazılıp aynı metin iki track'e düşüyordu. */
      var capDir = path.join(cfg.workDir, "captions");
      try { pipeline.ensureDir(capDir); } catch (eCd) {}
      var srtFile = path.join(capDir, "cap_" + Date.now() + "_" + i + ".srt");
      fs.writeFileSync(srtFile, pipeline.cuesToSrt(is.cues), "utf8");
      var r = String(await evalES('addCaptionsToTimeline("' + esPath(srtFile) + '")'));
      logLine(is.ad + " → " + (basarili.length + 1) + ". altyazı kanalı (" + is.cues.length + " satır): " + r);
      if (r.indexOf("ok:") === 0) {
        basarili.push({ ad: is.ad });
        toplam += is.cues.length;
      } else hatalar.push(is.ad + " — " + r.replace(/^[a-z_]+:/, ""));
    }

    if (!basarili.length) return "err:" + (hatalar[0] || "Altyazı kanalı oluşturulamadı");
    /* Bayrağı ANCAK gerçekten track oluştuktan sonra kur: başarısız bir denemeden sonra
       "daha önce eklendi" diye sormak kullanıcıyı olmayan track'leri silmeye gönderirdi. */
    try { lsSet(capAnahtar, "1"); } catch (eLs) {}
    /* HANGİ TRACK KİMİN — numarayla yaz. Karakter başına ayrı track düzeninde 4-5 track
       oluşabiliyor ve Premiere'de hepsi "C1, C2, C3…" diye görünüyor; isim olmadan kullanıcı
       hangisine hangi stili vereceğini bilemez. Sıra `basarili` dizisinden okunuyor, yani
       GERÇEKTEN oluşan track'lerden — konuşma çıkmayan kanal atlandığı için stil kutusundaki
       sırayla birebir aynı olmayabilir. */
    var adlar = basarili.map(function (b, i) { return "C" + (i + 1) + " " + b.ad; });
    var msg = "ok:" + toplam + " altyazı → " + basarili.length + " ayrı altyazı kanalı (" + adlar.join(" · ") + ")";
    /* Stili panel ATAYAMIYOR (üç API yüzeyi de ölçüldü) — kullanıcı Premiere'de elle veriyor.
       Bu yüzden hangi track'in kimin olduğunu yukarıda yazmak ŞART: 4-5 track hepsi "C1, C2…"
       diye görünüyor ve isim olmadan hangisine hangi stili vereceği bilinemez. */
    if (basarili.length > 1) msg += " | Stilleri Premiere'de ver: altyazıya tıkla → Track Style";
    /* GİZLENEN / ÜST ÜSTE KALAN SAYISI MESAJA GİRER — sessiz geçmek yasak. Gizleme metin
       kaybıdır ve kullanıcı ekranda olmayan bir repliğin panelde BİLEREK düşürüldüğünü ancak
       buradan öğrenir. Kırılım da yazılıyor ("Sage 3 · Mimi 4"): öncelik sabit olduğu için
       hep aynı karakterin kaybetmesi mümkün, kullanıcı bunu tahmin etmek yerine görsün. */
    if (gizlenenToplam) {
      msg += " | " + gizlenenToplam + " altyazı gizlendi (aynı anda konuşma";
      var kir = [], adK;
      if (kaSayac && kaSayac.gizlenenAd)
        for (adK in kaSayac.gizlenenAd)
          if (Object.prototype.hasOwnProperty.call(kaSayac.gizlenenAd, adK))
            kir.push(adK + " " + kaSayac.gizlenenAd[adK]);
      msg += kir.length ? (": " + kir.join(" · ") + ")") : ")";
    }
    if (bosKalanlar) msg += " | " + bosKalanlar + ": altyazı kalmadı, kanal açılmadı";
    /* Vurucu modda hiç cümle seçilmeyen karakterler AYRI yazılır: sebebi çakışma değil,
       "bu kişinin hiçbir cümlesi vurucu seçilmedi" — kullanıcı kanalı arayacak. */
    if (vBosKalanlar) msg += " | vurucu modda hiç cümle seçilmedi: " + vBosKalanlar;
    if (kaSayac && kaSayac.kalan)
      msg += " | " + kaSayac.kalan + " altyazı ÜST ÜSTE kaldı — track'lere farklı dikey konum ver";
    /* showResult "(\d+) hata" arıyor; kısmi başarıda yeşil ✓ yerine uyarı göstersin diye
       sayıyı bu kalıpta yazmak ZORUNLU. */
    if (hatalar.length) msg += " | " + hatalar.length + " hata: " + hatalar.join(" ; ");
    return msg;
  }
  function placeCurrent(range) { return placeCaptions(range); }

  // Ekrandaki tüm cue'lar tek liste (yerleştirme ve dışa aktarma için).
  function allCues() {
    if (state.genMode === "channels") {
      var out = state.a1Cues.slice();
      aktifKanallar().forEach(function (ch) { out = out.concat(ch.cues); });
      return out;
    }
    return state.singleCues;
  }

  // ---------- butonlar ----------
  $("btnRun").addEventListener("click", async function () {
    if (state.running) return;
    /* AYNI ANDA TEK İŞ: İptal butonları pipeline.cancelAll() çağırıyor ve o, kayıtlı BÜTÜN
       süreçleri öldürüyor (hangi işe ait olduğuna bakmadan). İki iş aynı anda çalışırsa
       birinin iptali diğerini de öldürüyordu — 25 dakikalık altyazı işi böyle çöpe gidiyordu. */
    if (state.acRunning) { uiAlert("AutoCut analizi sürüyor. Bitmesini bekle ya da onu iptal et.", "Altyazı"); return; }
    if (snk.calisiyor) { uiAlert("Senkron işlemi sürüyor. Bitmesini bekle ya da onu iptal et.", "Altyazı"); return; }
    state.running = true; state.cancelled = false;
    var btn = this; btn.disabled = true; $("result").hidden = true;
    // Üretim sürerken kanal listesi yenilenemez (biten kanalların altyazıları kaybolur)
    var kt = $("btnKanalTara"); if (kt) kt.disabled = true;
    $("log").textContent = ""; progressReset("Başlıyor…");
    $("btnCancel").hidden = false;
    try {
      if (!CEP) await runMock();
      // Kaynak "Herkes" ise her kanal ayrı yazıya dökülür (üst üste konuşmalar karışmaz),
      // sonuç tek altyazı kanalında birleşir. Diğer kaynaklarda tek geçiş.
      else if (state.track === "herkes") await runChannels();
      else await runSingle();
      /* Üretim BAŞARIYLA bitti: cue'lar artık güncel timeline'a ait, AutoCut bayatlık freni
         kalkar. Hata/iptal durumunda buraya hiç gelinmez ve bayrak bilerek AÇIK kalır —
         yarım kalmış üretimin cue'ları da bayattır. */
      state.cuesStale = false;
    }
    catch (e) {
      if (state.cancelled) progressFail("İptal edildi", "warn");
      else { progressFail("❌ " + friendlyError(e), "bad"); logLine("HATA: " + (e.message || e)); }
    }
    finally {
      state.running = false; btn.disabled = false; $("btnCancel").hidden = true;
      if (kt) kt.disabled = false;
      modGorunumUygula();
      /* Renk Değiştir sekmesindeyken iş bittiyse üretim alanı yeniden gizleniyor; son durumu
         bu sekmenin kendi durum satırına taşı — yoksa "Bitti" mesajı hiç görünmeden yok olur.
         (modGorunumUygula -> refreshRecolorBtns bu satırı gizlediği için SONRA yazılmalı.) */
    }
  });
  // ---------- RENK DEĞİŞTİR (3. sekme) ----------
  // Timeline'da SEÇİLİ altyazı kliplerini, tıklanan renge/stile GÜVENLİ yolla çevirir:
  // seçili kliplerin zamanlarını al → panel cue listesinde eşle → o cue'lara renk override ata →
  // seçili en erken noktadan SONA kadar TEMİZ yeniden yerleştir (importMGT komşuyu ezmesin).
  var _recoloring = false;
  // Stil adından renk tahmini (görsel ipucu); ad renk içermiyorsa palet sırasıyla ayırt et.
  // Kullanıcının stil adlarına göre gerçek renkler (buton swatch'ı stilin rengini göstersin).
  var _STYLE_COLORS = { "dora": "#35c26a", "mimi": "#ff7ac2", "moni": "#4b8bff", "niko": "#f9ca24",
    "tofi": "#e5544b", "sen": "#f5f5f5" };
  var _COLORWORDS = { "beyaz": "#f5f5f5", "kırmızı": "#e5544b", "kirmizi": "#e5544b", "mavi": "#4b8bff",
    "sarı": "#f9ca24", "sari": "#f9ca24", "yeşil": "#35c26a", "yesil": "#35c26a", "mor": "#b06dfc",
    "pembe": "#ff7ac2", "turuncu": "#ff8c42", "lacivert": "#3b5bdb", "gri": "#9aa0b5", "altın": "#e0a63a",
    "altin": "#e0a63a", "turkuaz": "#3fc6c6", "yeşilimsi": "#9ac44b" };
  /* "Kaydedilmiş listeyi yükle" butonu JS ile eklenir (HTML'de yok). Liste boşken diskteki
     oturumu tek tıkla geri getirir — kullanıcı geri yükleme teklifini kaçırdıysa 30 dakikalık
     üretimi boşuna tekrarlamasın. */
  /* Timeline'daki altyazının YAZISINI yerinde düzelt. Eskiden metin hatası görünce ya Premiere'de
     tek tek elle düzeltmek ya da panelde düzeltip yeniden basmak gerekiyordu; ikincisi tüm zaman
     aralığını silip yeniden bastığı için timeline'da elle yapılan konum/süre ayarları uçuyordu. */
    
  $("btnAddTimeline").addEventListener("click", async function () {
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de timeline'a eklenir."); return; }
    var btn = this; if (btn.disabled) return; btn.disabled = true;   // çift-tık koruması (mükerrer yerleştirmeyi önler)
    try {
      // Yerleştirmeden önce kaydet (Geri Al için). Sonuç log'lanır: kaydetme başarısızsa
      // "Geri Al" bu ana DEĞİL daha eski bir sürüme döner — sebebi Ayrıntılar'da görünsün.
      logLine("Kaydet: " + (await evalES('saveProject()')));
      progressBusy("Timeline'a ekleniyor…");
      var r = await placeCurrent();
      if (r != null) showResult(r); else $("progressBox").hidden = true;
    }
    catch (e) { progressFail("❌ " + friendlyError(e), "bad"); logLine("HATA: " + (e.message || e)); uiAlert(friendlyError(e), "Hata"); }
    finally { btn.disabled = false; }
  });
  // Geri Al: son işlemden önce kaydedilen sürüme dön (proje yeniden açılır)
  $("undoBtn").addEventListener("click", async function () {
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de çalışır."); return; }
    var btn = this; if (btn.disabled) return;
    if (!(await uiConfirm("Son işlemden ÖNCE kaydedilen sürüme dönülecek — son kesim/altyazı ve o andan sonraki değişiklikler kaybolur. Proje yeniden açılır.\n\nDevam?", "Geri Al"))) return;
    btn.disabled = true;
    try {
      var r = await evalES('revertToSaved()');
      var msg = String(r).replace(/^[a-z_]+:/, "");
      uiAlert(msg, String(r).indexOf("ok:") === 0 ? "Geri Alındı ✓" : "Geri Al");
    } finally { btn.disabled = false; }
  });
  $("logToggle").addEventListener("click", function () { var l = $("log"); l.hidden = !l.hidden; this.textContent = l.hidden ? "Ayrıntılar ▾" : "Ayrıntılar ▴"; });

  // ---------- transkript export (SRT / TXT / YouTube bölüm) ----------
  function exportCues() {
    var all = allCues().map(function (c) { return { start: c.start, end: c.end, text: c.text }; });
    all.sort(function (a, b) { return a.start - b.start; });
    return all;
  }
  function saveAs(defName, filters, content) {
    var p = null;
    try {
      if (typeof window.cep !== "undefined" && window.cep.fs && window.cep.fs.showSaveDialogEx) {
        var res = window.cep.fs.showSaveDialogEx("Kaydet", cfg.workDir, filters, defName);
        if (res && res.data) p = res.data;
      }
    } catch (e) {}
    if (!p) p = path.join(cfg.workDir, defName);   // fallback: work klasörü
    fs.writeFileSync(p, content, "utf8");
    logLine("Kaydedildi: " + p);
    uiAlert("Kaydedildi:\n" + p, "Dışa Aktar");
    return p;
  }
  $("btnExportSrt").addEventListener("click", function () {
    if (!CEP) { uiAlert("Önizleme modu."); return; }
    if (!exportCues().length) { uiAlert("Önce altyazı oluştur."); return; }
    saveAs("transkript.srt", ["srt"], pipeline.cuesToSrt(exportCues()));
  });
  $("btnExportTxt").addEventListener("click", function () {
    if (!CEP) { uiAlert("Önizleme modu."); return; }
    if (!exportCues().length) { uiAlert("Önce altyazı oluştur."); return; }
    saveAs("transkript.txt", ["txt"], pipeline.cuesToTxt(exportCues()));
  });
  $("btnExportChapters").addEventListener("click", function () {
    if (!CEP) { uiAlert("Önizleme modu."); return; }
    if (!exportCues().length) { uiAlert("Önce altyazı oluştur."); return; }
    var iv = parseInt($("chapInterval").value, 10) || 60;
    var txt = pipeline.cuesToChapters(exportCues(), { interval: iv });
    var n = (txt.match(/\n/g) || []).length;
    if (n < 3) { uiAlert("Sadece " + n + " bölüm çıktı. YouTube bölümleri için en az 3 gerekir (aralığı küçült veya daha uzun video).", "Bölümler"); }
    saveAs("bolumler.txt", ["txt"], txt);
  });

  // ---------- İPTAL ----------
  /* İPTAL — iki işin AYRI bayrağı var. Eskiden tek `state.cancelled` paylaşılıyordu:
     AutoCut analizi başlarken onu sıfırlayıp çalışan altyazı işinin iptal bilgisini siliyordu.
     (pipeline.cancelAll hâlâ tüm süreçleri öldürür; bu yüzden iki iş aynı anda başlatılamıyor —
      bkz. btnRun / acAnalyze başındaki kontroller.) */
  function _sureclerdurdur() { try { if (pipeline && pipeline.cancelAll) pipeline.cancelAll(); } catch (e) {} }
  $("btnCancel").addEventListener("click", function () { state.cancelled = true; _sureclerdurdur(); });
  $("acCancel").addEventListener("click", function () { state.acCancelled = true; _sureclerdurdur(); });


  /* ================= SENKRON KARTI =================
     Craig bot ile alınan kişi başı ses dosyalarını otomatik hizalayıp doğru kanala koyar.

     AKIŞ: klasör seç -> dosya adlarından Discord adını çıkar -> kişilerle eşle ->
           çeken kişiyi seç -> her dosyayı OBS kaydıyla hizala -> yerleşim tablosunu göster ->
           kullanıcı onaylayınca Premiere'e uygula (import + kanal + renk etiketi).

     KANAL KURALI: A1 = çeken (OBS mikrofonu, dokunulmaz), A2 = karşı taraf (Tofi<->Moni),
                   sonra Kişiler listesindeki sırayla kalanlar, EN SON oyun sesi.
                   Videoda olmayan karakter kanal harcamaz (alttakiler yukarı kayar).

     REFERANS SEÇİMİ: arkadaşlar A2 (OBS'in Discord'dan aldığı karışık kanal) ile hizalanır —
     ikisi de aynı Discord ses zincirinden geçtiği için sistematik sapma olmaz. Çeken kişinin
     kendi sesi A2'de YOKTUR, o yüzden onun dosyası A1 ile hizalanır. */
  var KISI = null;                 // js/kisiler.js modülü
  var HIZ = null;                  // js/hizala.js modülü
  var snk = { klasor: "", dosyalar: [], plan: [], calisiyor: false, iptal: false, temizlik: [], cekenDosya: null,
              sesKanalSayisi: 0,
              cekenKontrol: null,   // çekenin kendi kaydının A1'e göre gecikmesi (çapraz kontrol)
              uyariMetni: "",       // tablonun üstünde kalıcı gösterilecek kritik uyarı (eşleşme kaynaklı)
              a2Uyari: "" };        // A2 referansı okunamadıysa (o çalıştırmaya ait) uyarı
  var _snkMax = 0;

  function snkLog(msg) { var el = $("snkLog"); if (!el) return; var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  function snkProgress(pct, label) {
    var box = $("snkProgress"); if (!box) return;
    box.hidden = false; box.classList.remove("done", "error");
    $("snkSpinner").hidden = false; var bd = $("snkBadge"); if (bd) bd.hidden = true;
    $("snkLabel").style.color = ""; if (label != null) $("snkLabel").textContent = label;
    if (pct >= 0) { if (pct < _snkMax) pct = _snkMax; else _snkMax = pct; $("snkFill").style.width = pct + "%"; $("snkPct").textContent = Math.round(pct) + "%"; }
  }
  function snkDone(label) {
    var box = $("snkProgress"); box.hidden = false; box.classList.add("done"); box.classList.remove("error");
    $("snkSpinner").hidden = true; var bd = $("snkBadge"); if (bd) { bd.hidden = false; bd.textContent = "✓"; bd.className = "prog-badge ok"; }
    _snkMax = 100; $("snkFill").style.width = "100%"; $("snkPct").textContent = "100%";
    $("snkLabel").style.color = "var(--good)"; $("snkLabel").textContent = label || "Bitti";
  }
  function snkFail(label, kind) {
    var box = $("snkProgress"); box.hidden = false; box.classList.add("error"); box.classList.remove("done");
    $("snkSpinner").hidden = true; var bd = $("snkBadge"); if (bd) { bd.hidden = false; bd.textContent = "✕"; bd.className = "prog-badge bad"; }
    $("snkLabel").style.color = (kind === "warn") ? "var(--warn)" : "var(--bad)"; $("snkLabel").textContent = label || "Hata";
  }

  // ---------- kişiler tablosu ----------
  var _kisiSonMetin = "";        // blur'da gereksiz kayıt yapmamak için (Karakter İsimleri kutusuyla aynı mantık)
  function snkKisiStatus(msg, renk) {
    var el = $("snkKisiStatus"); if (!el) return;
    el.textContent = msg || ""; el.style.color = renk || "var(--muted)";
  }
  function snkKisiDoldur() {
    var ta = $("snkKisiText");
    if (ta && KISI) { ta.value = KISI.toText(state.kisiler); _kisiSonMetin = ta.value; }
    var b = $("snkKisiBadge"); if (b) b.textContent = (state.kisiler || []).length;
  }
  function snkKisiKaydet() {
    if (!KISI) return;
    var ta = $("snkKisiText"); if (!ta) return;
    /* 2. argüman (düzenleme ÖNCEKİ liste) ŞART: kullanıcı renk etiketini yanlış yazarsa
       (ör. "[Blu]") kisiler.js o kişinin ESKİ rengini korur. Argüman geçilmezse modül içi
       önbelleğe düşüyor; açıkça geçmek niyeti kodda görünür kılar.
       Sağ taraf önce hesaplanır, yani state.kisiler burada hâlâ eski listedir. */
    state.kisiler = KISI.parseText(ta.value, state.kisiler);
    _kisiSonMetin = ta.value;
    try { KISI.save(extRoot, state.kisiler); } catch (e) {
      snkKisiStatus("✕ " + (e.message || e), "var(--bad)"); return;
    }
    snkKisiDoldur();
    /* Renk uyarısı KALDIRILDI: timeline etiketleme iptal edilince renk alanı da anlamsızlaştı.
       parseText eski "[Mavi]" yazımını hâlâ tolere ediyor (kullanıcının mevcut listesi
       bozulmasın), ama artık ne gösteriliyor ne de kullanılıyor.
       SIRA bilgisi verilir: bu listenin sırası ses kanallarının sırasını belirliyor. */
    snkKisiStatus("✓ Kaydedildi — " + state.kisiler.length + " kişi (sıra = kanal sırası)", "var(--good)");
    if (snk.dosyalar.length) snkEslestir();     // açık liste varsa yeniden eşle
  }

  // ---------- 1) klasör seç ----------
  var SES_UZANTI = /\.(m4a|aac|mp3|flac|wav|ogg|opus|wma)$/i;
  function snkKlasorSec() {
    if (!CEP) { uiAlert("Önizleme modu — Premiere'de klasör seçilir."); return; }
    if (!KISI || !HIZ) { uiAlert("Senkron modülleri yüklenemedi. Paneli yeniden kur (deploy-dev.ps1) ve Premiere'i yeniden başlat.", "Senkron"); return; }
    var yol = "";
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
        var r = window.cep.fs.showOpenDialogEx(false, true, "Craig klasörünü seç", snk.klasor || "");
        if (r && r.data && r.data.length) yol = r.data[0];
      }
    } catch (e) {}
    if (!yol) return;
    snk.klasor = yol;
    $("snkKlasorYol").innerHTML = "";
    $("snkKlasorYol").appendChild(document.createTextNode(yol));
    snkDosyalariOku();
  }
  function snkDosyalariOku() {
    var hepsi = [];
    try { hepsi = fs.readdirSync(snk.klasor); } catch (e) { uiAlert("Klasör okunamadı: " + (e.message || e), "Senkron"); return; }
    snk.dosyalar = [];
    for (var i = 0; i < hepsi.length; i++) {
      if (!SES_UZANTI.test(hepsi[i])) continue;
      snk.dosyalar.push({ dosya: hepsi[i], yol: path.join(snk.klasor, hepsi[i]), ad: KISI.adCikar(hepsi[i]) });
    }
    if (!snk.dosyalar.length) {
      uiAlert("Bu klasörde ses dosyası yok. Craig'den “Çoklu Parça” indirdiğinden ve ZIP'i çıkardığından emin ol.", "Senkron");
      return;
    }
    snkLog(snk.dosyalar.length + " ses dosyası bulundu: " + snk.dosyalar.map(function (d) { return d.ad; }).join(", "));
    $("snkCekenCard").hidden = false;
    snkEslestir();
  }

  // ---------- 2) kişileri eşle + plan kur ----------
  function snkCekenKim() {
    var b = document.querySelector("#snkCeken .seg-btn.active");
    return b ? b.dataset.ceken : "Tofi";
  }
  function snkEslestir() {
    if (!snk.dosyalar.length) return;
    // Hizalama/yerleştirme sürerken planı yeniden kurma: snkCalistir plan NESNELERİNE
    // referans tutuyor, yeniden kurulursa yerleştirme eski plana göre yapılır.
    if (snk.calisiyor) { snkLog("İşlem sürerken liste yenilenmez."); return; }
    var ceken = snkCekenKim();
    var karsi = (ceken === "Tofi") ? "Moni" : "Tofi";
    var eslesen = [], bilinmeyen = [];
    snk.dosyalar.forEach(function (d) {
      var k = KISI.bul(state.kisiler, d.ad);
      if (k) eslesen.push({ dosya: d, kisi: k });
      else bilinmeyen.push(d);
    });

    /* AYNI karaktere birden çok dosya düşebilir: kişi Discord'dan düşüp yeniden bağlanınca
       Craig "_2" ekli ikinci dosya üretir, bir karaktere iki hesap kayıtlıysa da olur.
       Bu durum eskiden SESSİZCE bozuyordu:
         - A2'nin sahibinde aşağıdaki döngü sonuncuyu alıyor, öteki dosya hiçbir satıra
           girmediği için tabloda bile görünmeden kayboluyordu;
         - diğer karakterlerde ise iki dosya iki ayrı kanala konup ses ÇİFT çıkıyordu.
       Artık ilk dosya ana kayıt; kalanlar "(2. kayıt)" etiketiyle ayrı satırda görünür. */
    var sayac = {}, tekrar = [];
    eslesen = eslesen.filter(function (e) {
      var ad = e.kisi.karakter;
      sayac[ad] = (sayac[ad] || 0) + 1;
      if (sayac[ad] === 1) return true;
      e.sira = sayac[ad];
      tekrar.push(e);
      return false;
    });

    /* ===== KANAL SIRASI =====
         A1 = videoyu çeken (OBS mikrofonu — dokunulmaz; Craig'deki kendi dosyası yalnızca
              hizalama referansıdır, timeline'a konmaz)
         A2 = Tofi/Moni'den diğeri
         sonra "Karakter İsimleri" listesindeki SIRAYLA kalan karakterler
         en son = oyun sesi
       VİDEODA OLMAYAN KARAKTER KANAL HARCAMAZ: alttakiler yukarı kayar. Sage ve Niko yoksa
       oyun sesi A5 olur. Sıra listeden geldiği için kullanıcı panelden değiştirebilir. */
    /* Aynı karakter adı listede iki kez yazılıysa (kullanıcı elle eklerken kolayca olur)
       aynı dosya İKİ kanala konurdu — ses çift çıkar. Ada göre tekilleştir.
       Karşılaştırma KISI._norm ile aynı kuralda olmalı: dosya eşleşmesi de öyle yapılıyor,
       yoksa "mimi" ile "Mimi" ayrı sanılır. */
    var siraListesi = [], gorulenKarakter = {};
    // NOT: _kn bu fonksiyonun her yerinde ayni kurali uygulamali (dosyaOf anahtari dahil).
    var _kn = function (s) { return String(s == null ? "" : s).replace(/İ/g, "i").replace(/I/g, "i").toLowerCase(); };
    (state.kisiler || []).forEach(function (k) {
      if (!k || !k.karakter) return;
      if (_kn(k.karakter) === _kn(ceken) || _kn(k.karakter) === _kn(karsi)) return;
      if (gorulenKarakter[_kn(k.karakter)]) return;
      gorulenKarakter[_kn(k.karakter)] = 1;
      siraListesi.push(k.karakter);
    });
    /* Anahtar NORMALLEŞTİRİLMİŞ ad. Eskiden ham ad kullanılıyordu ama sıra listesi filtresi
       _kn ile karşılaştırıyordu — iki farklı kural. Kullanıcı listede çekenin adını
       "Tofı" (noktasız ı) ya da "tofi" yazsa filtre onu eliyor, dosyaOf ise eşleştiremiyor:
       çekenin KENDİ kaydı bilinmeyenlere düşüp timeline'a konuyor ve ses çift çıkıyordu. */
    var dosyaOf = {};
    eslesen.forEach(function (e) { dosyaOf[_kn(e.kisi.karakter)] = e; });

    var plan = [], sonrakiKanal = 0;
    plan.push({ kanal: sonrakiKanal++, karakter: ceken, kilit: true, not: "OBS mikrofonun — dokunulmaz" });
    // A2: Tofi/Moni'den diğeri. Yoksa kanal boş bırakılmaz, sıradaki kişi buraya kayar.
    if (dosyaOf[_kn(karsi)]) plan.push({ kanal: sonrakiKanal++, karakter: karsi, dosya: dosyaOf[_kn(karsi)].dosya });
    else snkLog(karsi + " bu videoda yok — kanal harcanmadı, alttakiler yukarı kaydı.");
    siraListesi.forEach(function (ad) {
      if (dosyaOf[_kn(ad)]) plan.push({ kanal: sonrakiKanal++, karakter: ad, dosya: dosyaOf[_kn(ad)].dosya });
    });
    /* Aynı kişinin ek kayıtları. Çekenin ikinci kaydı YERLEŞTİRİLMEZ — sesi zaten A1'de,
       konursa çift çıkar. Diğerleri kendi kanalını alır ve etiketinden anlaşılır. */
    tekrar.forEach(function (e) {
      if (_kn(e.kisi.karakter) === _kn(ceken)) {
        snkLog(e.dosya.dosya + " — " + ceken + " adına ikinci kayıt. Sesin zaten A1'de, yerleştirilmiyor.");
        return;
      }
      snkLog(e.dosya.dosya + " — " + e.kisi.karakter + " adına " + e.sira + ". kayıt (kişi düşüp yeniden " +
             "bağlanmış olabilir). Ayrı kanala konuyor; gerekmiyorsa Premiere'de o kanalı sil.");
      plan.push({
        kanal: sonrakiKanal++, karakter: e.kisi.karakter + " (" + e.sira + ". kayıt)",
        dosya: e.dosya
      });
    });
    bilinmeyen.forEach(function (d) {
      plan.push({ kanal: sonrakiKanal++, karakter: "?", dosya: d, bilinmeyen: true });
    });
    /* OYUN SESİ EN SONDA. Panel onu TAŞIMAZ (Premiere'de klip taşıma API'si yok; tek yol
       overwriteClip ve o, çoklu-akışlı OBS kaydında dosyanın 1. akışını = mikrofonu
       yerleştiriyordu). Satır yalnızca hangi kanalda olması gerektiğini söyler; klibi
       kullanıcı elle oraya taşır. */
    plan.push({ kanal: sonrakiKanal++, karakter: "Oyun sesi", oyun: true,
                not: "oyun sesini Premiere'de buraya SEN taşı — panel dokunmaz" });
    // çekenin kendi Craig dosyası — hizalama referansı (timeline'a konmaz)
    snk.cekenDosya = null;
    // _kn: cekenin kendi kaydini bulmak da ayni kurala uymali, yoksa kayit timeline'a konup ses cift cikar.
    eslesen.forEach(function (e) { if (_kn(e.kisi.karakter) === _kn(ceken)) snk.cekenDosya = e.dosya; });

    /* Çekenin kendi kaydı eşleşmediyse bilinmeyenler arasında kalır ve A4+'ya yerleştirilir —
       sesi zaten A1'de olduğu için timeline'da ÇİFT çıkar. Bu uyarı eskiden yalnız gizli log'a
       gidiyordu (#snkLog varsayılan olarak kapalı); kullanıcı hiç görmüyordu. Artık tablonun
       üstündeki uyarı satırında da görünür. */
    snk.uyariMetni = "";
    if (!snk.cekenDosya && bilinmeyen.length) {
      snk.uyariMetni = "⚠ " + ceken + " adına kayıtlı dosya bulunamadı. Bilinmeyenlerden biri SENİN kaydınsa " +
        "onu yerleştirme — sesin zaten A1'de, videoda çift/yankılı çıkar. Kişi listesine Discord adını ekleyip tekrar dene.";
      snkLog("UYARI: " + snk.uyariMetni);
    }
    snk.plan = plan;
    /* ⚠ KANAL İSİMLERİNİ PLANDAN YAZ — "MONİ ÇEKTİ AMA TOFİ ÇIKTI" HATASININ ASIL ÇÖZÜMÜ.
       Panel doğru cevabı ZATEN biliyordu: bu kartta "Videoyu kim çekiyor?" seçicisi var ve
       plan[0] tam olarak "A1 = çeken" diyor. Ama emoji tarafı A1'in adını bambaşka bir
       yerden (localStorage kanalAd.0) okuyordu ve o değer VİDEODAN VİDEOYA taşınıyordu:
       kullanıcı Senkron'da "Moni" seçse bile A1'in adı geçen videodan kalma "Tofi" kalıyor,
       emoji Tofi'nin yüzünü koyuyordu. İki kaynak arasında tek satır bağ yoktu — bu, o bağ.
       Kullanıcı zaten her videoda bu seçiciyi çeviriyor; kanal listesi artık peşinden geliyor. */
    kanalAdlariniPlandanYaz(plan);
    snkPlanCiz();
    $("snkPlanCard").hidden = false;
    $("snkUygula").hidden = false;
    snkKanalSayisiOku();   // ses kanalı bütçesi uyarısı UYGULA'dan önce görünsün
  }
  /* Sekanstaki ses kanalı sayısını okuyup planı yeniden çizer.
     snk.sesKanalSayisi eskiden yalnız snkCalistir içinde (Uygula'ya basıldıktan SONRA)
     doldurulduğu için snkPlanCiz'deki bütçe uyarısı ilk çizimde ASLA çıkmıyordu (0 && … kısa
     devre). Kullanıcı kanal eklemesi gerektiğini ancak uzun işlemin sonundaki hatayla öğreniyordu. */
  async function snkKanalSayisiOku() {
    if (!CEP) return;
    try {
      var b = JSON.parse(await evalES("getSequenceInfoJSON()"));
      if (b && !b.error && b.audioTracks) {
        snk.sesKanalSayisi = b.audioTracks;
        /* Kanal başına klip sayısı: hedef kanalda zaten klip varsa yerleştirme onu EZER
           (overwriteClip). Kanal sırası değiştiği için bu gerçek bir risk — tabloda ve
           onay metninde gösterilir. */
        snk.kanalKlip = b.clipCounts || [];
        snkPlanCiz();
      } else {
        /* ⚠ SESSİZ else DALI DA MODELİ TAZELEMEK ZORUNDA. "Aktif sekans yok" tam olarak
           buraya düşüyordu (b.error) ve eskiden kanalKlip'e hiç dokunulmuyordu: tablo bir
           ÖNCEKİ sekanstan kalan değerlerle çizili kalıyor, kullanıcı olmayan bir riski
           ("A3'te zaten 5 klip var — üzerine yazılacak") görüp gereksiz yere iptal ediyordu. */
        snk.kanalKlip = null;
        try { snkPlanCiz(); } catch (e1) {}
      }
    } catch (e) {
      /* Okunamadıysa ESKİ veriyle devam etme: üzerine yazma uyarısı bayat veriye bakıp
         yanlış (ya da hiç) uyarır. null = "bilinmiyor", plan bunu ayrıca söyler.
         ⚠ Tabloyu da YENİDEN ÇİZ: veriyi null yapmak tek başına DOM'daki bayat uyarı
         satırlarını kaldırmıyordu. snkPlanCiz null'da uyarı satırı hiç üretmiyor. */
      snk.kanalKlip = null;
      try { snkPlanCiz(); } catch (e2) {}
    }
  }

  /* snkOyunKanalDoldur() KALDIRILDI — "Oyun sesi şu an hangi kanalda?" seçici artık yok.
     Panel oyun sesini taşımıyor, dolayısıyla nerede olduğunu bilmesine de gerek yok:
     yerleşim tablosu en alta "Oyun sesi" satırı koyar, kullanıcı klibi oraya elle taşır. */

  // ---------- 3) yerleşim tablosu ----------
  // hizala.js'in ASCII güven değerleri -> ekranda düzgün Türkçe
  var GUVEN_TR = { yuksek: "güçlü eşleşme", orta: "orta eşleşme", dusuk: "zayıf eşleşme" };
  function snkPlanCiz() {
    var box = $("snkPlanRows"); if (!box) return;
    box.innerHTML = "";
    snk.plan.forEach(function (p) {
      var row = document.createElement("div");
      /* Kırmızı (sorunlu) yalnızca GERÇEK sorunlarda: tanınmayan kişi ya da diğerlerinden
         sapan hizalama. Bir karakterin o videoda olmaması normaldir — soluk gösterilir. */
      row.className = "snk-row" + ((p.kilit || p.bos) ? " kilit" : "") + ((p.bilinmeyen || p.aykiri) ? " sorunlu" : "");
      var kn = document.createElement("div"); kn.className = "snk-kanal"; kn.textContent = "A" + (p.kanal + 1);
      row.appendChild(kn);

      var orta = document.createElement("div"); orta.className = "snk-orta";
      var isim = document.createElement("div"); isim.className = "snk-kisi";
      // Renk noktası KALDIRILDI: timeline'da klip renklendirme iptal edildi (kafa karıştırıyordu).
      isim.appendChild(document.createTextNode(p.bilinmeyen ? "Bilinmeyen kişi" : p.karakter));
      orta.appendChild(isim);
      var alt = document.createElement("div"); alt.className = "snk-dosya";
      alt.textContent = p.dosya ? p.dosya.dosya : (p.not || "");
      /* Oyun sesi satırı bir BİLGİ değil, KULLANICININ yapacağı iş. Soluk 11px yazıda kaybolup
         "kilitli, dokunulmayacak" gibi okunuyordu; normal renkte ve sarmalı göster. */
      if (p.oyun) { alt.style.color = "var(--text)"; alt.style.whiteSpace = "normal"; }
      /* OYUN SESİ TAŞINDI MI? Panel artık taşımıyor, kullanıcı elle yapıyor — unutup Uygula'ya
         basarsa oyun sesinin durduğu kanala bir kişi yazılır ve oyun sesi EZİLİR. Hedef kanalın
         dolu/boş olması bunun tek görünür işareti, satırda söylensin. */
      if (p.oyun && snk.kanalKlip) {
        var od = document.createElement("div");
        od.className = "snk-dosya"; od.style.whiteSpace = "normal";
        if (snk.kanalKlip[p.kanal] > 0) {
          od.style.color = "var(--good)";
          od.textContent = "✓ A" + (p.kanal + 1) + "'de " + snk.kanalKlip[p.kanal] +
                           " klip var — taşımışsın gibi görünüyor";
        } else {
          od.style.color = "var(--warn)";
          od.textContent = "⚠ A" + (p.kanal + 1) + " boş — oyun sesini oraya taşımadıysan " +
                           "önce taşı, sonra Uygula'ya bas";
        }
        orta.appendChild(od);
      }
      /* ÜZERİNE YAZMA UYARISI: yerleştirme overwriteClip ile yapılıyor. Hedef kanalda
         zaten klip varsa (tipik durum: oyun sesi hâlâ eski yerinde duruyor) o klip EZİLİR.
         Kanal sırası değiştiği için bu artık gerçek bir risk — satırda görünsün. */
      if (p.dosya && snk.kanalKlip && snk.kanalKlip[p.kanal] > 0) {
        var uy = document.createElement("div");
        uy.className = "snk-dosya"; uy.style.color = "var(--warn)";
        uy.textContent = "⚠ A" + (p.kanal + 1) + "'de zaten " + snk.kanalKlip[p.kanal] + " klip var — üzerine yazılacak";
        orta.appendChild(uy);
      }
      orta.appendChild(alt);
      row.appendChild(orta);

      var sag = document.createElement("div"); sag.className = "snk-kayma";
      if (p.bilinmeyen) {
        // kullanıcı elle karakter seçebilsin
        var wrap = document.createElement("div"); wrap.className = "select sm";
        var sel = document.createElement("select");
        var o0 = document.createElement("option"); o0.value = ""; o0.textContent = "kişi seç…"; sel.appendChild(o0);
        (state.kisiler || []).forEach(function (k) {
          var op = document.createElement("option"); op.value = k.karakter; op.textContent = k.karakter; sel.appendChild(op);
        });
        (function (satir, s) {
          s.addEventListener("change", function () {
            if (!s.value) return;
            /* İşlem sürerken seçim yapılamaz: snkEslestir zaten `snk.calisiyor` yüzünden erken
               dönüyor, yani ad dosyaya yazılıyor ama PLAN güncellenmiyordu — dosya yine
               isimsiz/renksiz yerleşiyor, ekranda tek bir geri bildirim çıkmıyordu. */
            if (snk.calisiyor) {
              uiAlert("İşlem sürerken kişi değiştirilemez. Önce “İptal”e bas, kişiyi seç, sonra tekrar “Uygula”.", "Senkron");
              s.value = ""; return;
            }
            var k = KISI.karakterBul(state.kisiler, s.value);
            if (!k) return;
            // seçilen kişiyi kalıcı yap: dosyadaki adı o kişinin adlarına ekle
            if (satir.dosya && satir.dosya.ad) {
              // Craig'in "_2" eki listeye girmesin ("dielyzed_2" diye ikinci bir varyant olmaz)
              var ham = (KISI.ekKirp ? KISI.ekKirp(satir.dosya.ad) : satir.dosya.ad);
              var varMi = false;
              for (var q = 0; q < k.adlar.length; q++) if (k.adlar[q] === ham) varMi = true;
              if (!varMi) {
                k.adlar.push(ham);
                // Kaydetme hatası eskiden boş catch ile yutuluyordu: dosya salt-okunursa
                // kullanıcı seçimin kaydedilmediğini asla öğrenmiyordu.
                try { KISI.save(extRoot, state.kisiler); snkKisiStatus("✓ “" + ham + "” → " + k.karakter + " olarak kaydedildi", "var(--good)"); }
                catch (e) { snkKisiStatus("✕ Kişi listesi kaydedilemedi: " + (e.message || e), "var(--bad)"); }
                snkKisiDoldur();
              }
            }
            snkEslestir();
          });
        })(p, sel);
        wrap.appendChild(sel); sag.appendChild(wrap);
      } else if (p.hizaHata) {
        // Hizalanamayan dosya (bozuk ya da çok kısa kayıt) — yerleştirilmez, sebebi görünsün
        sag.innerHTML = "";
        var sh = document.createElement("small");
        sh.textContent = "hizalanamadı"; sh.style.color = "var(--bad)"; sh.title = p.hizaHata;
        sag.appendChild(sh);
      } else if (p.offset != null) {
        sag.innerHTML = "";
        sag.appendChild(document.createTextNode((p.offset >= 0 ? "+" : "") + p.offset.toFixed(2) + " sn"));
        var s2 = document.createElement("small");
        // hizala.js güveni ASCII üretiyor ("yuksek/orta/dusuk"); ekrana ham basınca şapkasız
        // Türkçe gibi görünüyor ve "dusuk" kullanıcıyı gereksiz yere korkutuyordu.
        s2.textContent = p.aykiri ? "diğerlerinden farklı!" : (GUVEN_TR[p.guven] || "eşleşme bilinmiyor");
        s2.title = "Asıl güvenilirlik işareti bu değil: dosyaların kayması birbirini tutuyor mu ona bakılır.";
        if (p.aykiri) s2.style.color = "var(--bad)";
        sag.appendChild(s2);
      } else if (p.kilit) {
        sag.innerHTML = ""; var s3 = document.createElement("small"); s3.textContent = "kilitli"; sag.appendChild(s3);
      }
      row.appendChild(sag);
      box.appendChild(row);
    });

    var gereken = 0, yerlesecekSayi = 0;
    snk.plan.forEach(function (p) {
      if (p.kanal + 1 > gereken) gereken = p.kanal + 1;
      if (p.dosya && !p.kilit) yerlesecekSayi++;
    });
    var u = $("snkUyari");

    /* Yerleştirilecek dosya yoksa NEDENİNİ açıkça söyle. En sık durum: kullanıcı tek başına
       test kaydı almış, klasörde yalnızca kendi dosyası var — o da kural gereği timeline'a
       konmaz (sesi zaten A1'de), sadece hizalama referansı olur. Tablodaki "kaydı yok"
       satırından bu anlaşılmıyordu. */
    if (u && !yerlesecekSayi) {
      u.hidden = false; u.style.color = "var(--warn)";
      u.textContent = snk.cekenDosya
        ? ("Klasörde sadece SENİN kaydın var (" + snk.cekenDosya.dosya + "). Sesin zaten A1'de olduğu için " +
           "yerleştirilecek bir şey yok; bu dosya yalnızca hizalama referansı olarak kullanılır. " +
           "Arkadaşlarınla birlikte kayıt alman gerekiyor.")
        : "Klasörde tanınan bir kayıt yok. Craig'den “Çoklu Parça” indirdiğinden ve ZIP'i çıkardığından emin ol.";
      $("snkUygula").hidden = true;
      return;
    }
    $("snkUygula").hidden = false;

    /* Uyarı satırı: kanal bütçesi + kritik uyarılar. Kritik uyarılar (ör. "kendi kaydın
       bilinmeyenler arasında olabilir", "A2 okunamadı") eskiden yalnız varsayılan olarak GİZLİ
       olan log'a yazılıyordu; kullanıcı hiç görmüyordu. */
    if (u) {
      var uyarilar = [];
      if (snk.sesKanalSayisi && gereken > snk.sesKanalSayisi) {
        uyarilar.push("⚠ Sekansta " + snk.sesKanalSayisi + " ses kanalı var, " + gereken + " gerekiyor. " +
          "Premiere'de " + (gereken - snk.sesKanalSayisi) + " ses kanalı ekle (panel ekleyemiyor), sonra tekrar dene.");
      }
      if (snk.uyariMetni) uyarilar.push(snk.uyariMetni);
      if (snk.a2Uyari) uyarilar.push(snk.a2Uyari);
      if (uyarilar.length) {
        u.hidden = false;
        u.style.color = (snk.uyariMetni || snk.a2Uyari) ? "var(--bad)" : "var(--warn)";
        u.textContent = uyarilar.join("   ");
      } else u.hidden = true;
    }
  }
  // _labelRenk KALDIRILDI — timeline renk etiketleme iptal edildiği için kullanan kalmadı.

  // ---------- 4) hizalama + uygulama ----------
  // Timeline'daki bir ses kanalını hizalama referansı olarak WAV'a döker
  async function snkRefWav(trackIdx, ad) {
    var d = await getClips(trackIdx);
    var w = path.join(cfg.workDir, ad + "_" + Date.now() + ".wav");
    await pipeline.buildTimelineAudio(d.clips, cfg.ffmpegExe, w, null, trackIdx);
    snk.temizlik.push(w);
    return w;
  }

  /* "Uygula"ya basıldıktan sonra iş RESMEN başlayana kadar geçen ön kontrol aşaması.
     Bu aşamada `await` var (sekans adı okunuyor, onay pencereleri açılıyor) ama snk.calisiyor
     henüz false ve düğme henüz kilitli değil — ikinci bir tıklama eskiden buradan sızıp aynı
     işi İKİ KEZ başlatabiliyordu (iki kez ffmpeg, iki kez yerleştirme, temizlik listesi sıfırlanıyor). */
  var _snkHazirlik = false;
  async function snkCalistir() {
    if (snk.calisiyor || _snkHazirlik) return;
    if (!CEP) { uiAlert("Önizleme modu — Premiere'de çalışır."); return; }
    // Aynı anda tek iş: iptal düğmeleri pipeline.cancelAll() ile TÜM süreçleri öldürüyor (bkz. "İPTAL" bölümü)
    if (state.running) { uiAlert("Altyazı üretimi sürüyor. Bitmesini bekle ya da onu iptal et.", "Senkron"); return; }
    if (state.acRunning) { uiAlert("AutoCut analizi sürüyor. Bitmesini bekle ya da onu iptal et.", "Senkron"); return; }

    var yerlesecek = [], seqAd = "";
    _snkHazirlik = true;
    try {
      snk.plan.forEach(function (p) { if (p.dosya && !p.kilit) yerlesecek.push(p); });
      if (!yerlesecek.length) { uiAlert("Yerleştirilecek ses dosyası yok.", "Senkron"); return; }

      var bilinmeyen = 0;
      yerlesecek.forEach(function (p) { if (p.bilinmeyen) bilinmeyen++; });
      if (bilinmeyen) {
        /* Asıl risk onay metninde YOKTU: bilinmeyenlerden biri çekenin kendi kaydıysa sesi
           hem A1'de hem yeni kanalda çıkıyor (çift/yankılı ses) ve kullanıcı bunu ancak
           montajda fark ediyor. Uyarı artık burada da yazılı. */
        var devam = await uiConfirm(bilinmeyen + " dosyanın kime ait olduğu bilinmiyor; bunlar isimsiz " +
          "yerleştirilecek." +
          (snk.cekenDosya ? "" :
            "\n\n⚠ DİKKAT: “" + snkCekenKim() + "” adına eşleşen dosya bulunamadı. Bilinmeyenlerden biri " +
            "SENİN kaydınsa yerleştirme — sesin zaten A1'de, videoda çift çıkar.") +
          "\n\nYine de devam edilsin mi? (İptal edip listeden kişi seçebilirsin.)", "Senkron");
        if (!devam) return;
      }

      /* AYNI SEKANSTA İKİNCİ ÇALIŞTIRMA: ilk çalıştırma A2'ye karşı tarafın TEMİZ kaydını
         yazıyor (eski karışık Discord sesi eziliyor). İkinci kez çalıştırılırsa A2 referansı
         artık "karışık kanal" değil tek kişinin sesi olur ve diğerlerinin hizalaması anlamsız
         çıkar — panel bunu fark edecek hiçbir ölçüme sahip değil, o yüzden açıkça uyarıyoruz. */
      try { var bi0 = JSON.parse(await evalES("getSequenceInfoJSON()")); seqAd = (bi0 && bi0.sequenceName) || ""; } catch (eSq) {}
      if (seqAd && lsGet("snkUygulandi." + seqAd, "")) {
        var yine = await uiConfirm("Bu sekansta senkron DAHA ÖNCE çalıştırıldı (" +
          new Date(parseInt(lsGet("snkUygulandi." + seqAd, "0"), 10) || Date.now()).toLocaleString() + ").\n\n" +
          "A2'de artık karışık Discord sesi değil, tek kişinin temiz kaydı var; hizalama referansı bozuk " +
          "olacağı için kaymalar yanlış çıkar.\n\nÖnerilen: önce “Geri Al” ile projeyi eski hâline döndür.\n\n" +
          "Yine de devam edeyim mi?", "Senkron");
        if (!yine) return;
      }

      snk.calisiyor = true; snk.iptal = false; snk.temizlik = [];
      snk.cekenKontrol = null;   // önceki çalıştırmadan kalan değer yeni ölçümü yanıltmasın
      $("snkUygula").disabled = true; $("snkCancel").hidden = false;
      _snkMax = 0; $("snkLog").textContent = "";
    } finally { _snkHazirlik = false; }   // ön kontrol bitti (iptal edildiyse de kilit açılır)

    try {
      pipeline.ensureDir(cfg.workDir);

      // --- sekans ve kanal bütçesi ---
      snkProgress(3, "Sekans okunuyor…");
      var bilgi;
      try { bilgi = JSON.parse(await evalES("getSequenceInfoJSON()")); }
      catch (e) { throw new Error("Sekans bilgisi okunamadı."); }
      if (bilgi.error) throw new Error("Aktif sekans yok. Önce bir sekans aç.");
      snk.sesKanalSayisi = bilgi.audioTracks;
      /* Klip sayılarını BURADA da tazele: üzerine yazma uyarısının tek veri kaynağı bu.
         Eskiden yalnız klasör seçilirken okunuyordu; kullanıcı arada sekans değiştirir ya da
         Premiere'de klip taşırsa uyarı BAYAT veriye bakıp sessizce yanlış (ya da hiç)
         uyarıyordu — oyun sesi habersiz eziliyordu. */
      snk.kanalKlip = bilgi.clipCounts || [];
      var gereken = 0;
      snk.plan.forEach(function (p) { if (p.kanal + 1 > gereken) gereken = p.kanal + 1; });
      if (gereken > bilgi.audioTracks) {
        throw new Error("Sekansta " + bilgi.audioTracks + " ses kanalı var ama " + gereken + " gerekiyor. " +
          "Premiere'de " + (gereken - bilgi.audioTracks) + " ses kanalı ekleyip tekrar dene " +
          "(panel kanal ekleyemiyor, Premiere'in API'si buna izin vermiyor).");
      }

      // --- referans sesler ---
      snkProgress(8, "OBS sesi hazırlanıyor (A1)…");
      var refA1 = await snkRefWav(0, "snkref1");
      var refA2 = null;
      try {
        snkProgress(14, "OBS sesi hazırlanıyor (A2)…");
        refA2 = await snkRefWav(1, "snkref2");
      } catch (e2) { snkLog("A2 okunamadı: " + (e2.message || e2)); }
      snk.a2Uyari = "";              // bu çalıştırmaya ait; A2 varsa eski uyarı ekranda kalmasın
      if (!refA2) {
        /* A2 yoksa SESSİZCE A1'e düşmek en tehlikeli hatalardan biri: A1 senin kendi
           mikrofonun; arkadaşının konuşma zarfıyla korele değil (sohbette sıra alındığı için
           neredeyse ters korele). Korelasyon rastgele bir tepeye oturuyor, tek dosya olduğu
           için tutarlılık kontrolü de devreye girmiyor ve panel yeşil ✓ gösteriyordu. */
        snk.a2Uyari = "⚠ A2 (Discord karışık kanalı) okunamadı — hizalama kendi mikrofonunla (A1) yapıldı, sonuç yanlış olabilir.";
        snkPlanCiz();
        var devamA1 = await uiConfirm(
          "A2 (OBS'in Discord'dan aldığı karışık kanal) okunamadı.\n\n" +
          "Hizalama SENİN mikrofonunla (A1) yapılacak. Arkadaşının sesiyle senin sesin aynı anda " +
          "olmadığı için sonuç büyük ihtimalle YANLIŞ olur.\n\n" +
          "Önerilen: OBS kaydını A2'ye de koyup tekrar dene.\n\nYine de devam edeyim mi?", "Senkron");
        if (!devamA1) { snkFail("İptal edildi", "warn"); return; }
      }

      // --- hizalama ---
      var sonuclar = [];
      for (var i = 0; i < yerlesecek.length; i++) {
        if (snk.iptal) throw new Error("İptal edildi");
        var p = yerlesecek[i];
        snkProgress(20 + 55 * i / yerlesecek.length, p.karakter + " hizalanıyor…");
        /* TEK DOSYANIN HATASI TÜM İŞİ DÜŞÜRMESİN: offsetBul, dosya bozuksa ya da ses ~8
           saniyeden kısaysa throw ediyor. Buraya gelene kadar dakikalarca referans üretildi ve
           önceki dosyalar hizalandı; hepsini çöpe atmak yerine o dosyayı atla, sonda bildir. */
        try {
          var r = await HIZ.offsetBul(cfg.ffmpegExe, (refA2 || refA1), p.dosya.yol,
            { maxKaymaSn: 180, workDir: cfg.workDir });
          p.offset = r.offset; p.guven = r.guven; p.r = r.r; p.hizaHata = null;
          sonuclar.push(p);
          snkLog(p.karakter + ": " + (r.offset >= 0 ? "+" : "") + r.offset.toFixed(2) + " sn  (güven " +
                 r.guven + ", benzerlik " + r.r.toFixed(2) + ")");
        } catch (eDosya) {
          p.hizaHata = String((eDosya && eDosya.message) || eDosya);
          p.offset = null; p.guven = null;
          snkLog("ATLANDI — " + p.karakter + " hizalanamadı: " + p.hizaHata);
        }
      }
      // Hizalanamayanlar yerleştirilmez (yanlış yere konmasındansa hiç konmasın)
      var hizalanamayan = [];
      yerlesecek = yerlesecek.filter(function (q) { if (q.hizaHata) { hizalanamayan.push(q); return false; } return true; });
      if (!yerlesecek.length) {
        throw new Error("Hiçbir dosya hizalanamadı. Kayıtlar bozuk olabilir ya da çok kısa " +
                        "(hizalama için en az ~10 saniye ses gerekir).");
      }

      /* Çekenin kendi Craig dosyası A2'de YOK (A2 = Discord'dan gelenler), o yüzden A1 ile
         hizalanır ve yalnızca ÇAPRAZ KONTROL olarak kullanılır — timeline'a konmaz. */
      if (snk.cekenDosya) {
        snkProgress(78, "Kendi sesin çapraz kontrol ediliyor…");
        try {
          var rc = await HIZ.offsetBul(cfg.ffmpegExe, refA1, snk.cekenDosya.yol,
            { maxKaymaSn: 180, workDir: cfg.workDir });
          // NOT: medyana KATILMAZ — farklı referansla (A1) ölçüldüğü için tutarlılık
          // hesabını bozar; ayrıca 2 elemanlı dizide medyanı ortalamaya çevirirdi.
          snk.cekenKontrol = rc.offset;
          snkLog("Kendi kaydın (A1 ile): " + (rc.offset >= 0 ? "+" : "") + rc.offset.toFixed(2) + " sn");
        } catch (e3) {}
      }

      /* TUTARLILIK: Craig herkesi aynı anda kaydettiği için tüm gecikmeler birbirine yakın
         OLMALI. Sapan dosya yanlış hizalanmıştır — korelasyon değerinden çok daha keskin bir
         işaret (karışık kanalda doğru eşleşme bile düşük korelasyon verebiliyor). */
      /* 3. ARGÜMAN ŞART: hizala.js'in tutarlilikKontrol'ü çapraz ölçümü (çekenin kendi kaydının
         A1'e göre gecikmesi) 3. parametreden alıyor. Geçilmezse hem tek dosyalık durumdaki
         denetim hem de çok dosyalıdaki "hepsi aynı yöne kaymış" denetimi (caprazUyusmuyor)
         sessizce devre dışı kalıyor — ölçüm yapılıp hiç kullanılmıyordu. */
      var tut = HIZ.tutarlilikKontrol(sonuclar, 0.5, snk.cekenKontrol);
      snkProgress(82, "Kontrol ediliyor…");
      if (tut.aykiriSayisi) {
        snkLog("UYARI: " + tut.aykiriSayisi + " dosyanın kayması diğerlerinden farklı (medyan " +
               tut.medyan.toFixed(2) + " sn).");
      }

      /* ÇAPRAZ KONTROL — en sık senaryoda (sen + tek arkadaş) tutarlılık kontrolü çalışmıyor:
         en az 2 sonuç istiyor, yoksa `tekDosya` deyip hiçbir şeyi işaretlemiyor. Geriye sadece
         korelasyon kalıyor, o da tek başına doğru/yanlış eşleşmeyi ayıramıyor (hizala.js'in
         kendi notu). Oysa çekenin kendi Craig kaydı A1 ile zaten ölçüldü ve A1 ile A2 AYNI OBS
         kaydından geliyor: Craig herkesi aynı anda başlattığı için iki gecikme birbirine yakın
         OLMALI. Sapma varsa hizalama yanlıştır — bağımsız bir doğrulama. */
      var caprazNot = "";
      if (snk.cekenKontrol != null) {
        if (tut.tekDosya) {
          for (var cz = 0; cz < sonuclar.length; cz++) {
            var fark = Math.abs(sonuclar[cz].offset - snk.cekenKontrol);
            if (fark > 1.0) {
              sonuclar[cz].aykiri = true;
              caprazNot += "\n⚠ " + sonuclar[cz].karakter + ": senin kaydının gecikmesi " +
                snk.cekenKontrol.toFixed(2) + " sn, bu dosyanınki " + sonuclar[cz].offset.toFixed(2) +
                " sn — aralarında " + fark.toFixed(2) + " sn fark var, hizalama muhtemelen YANLIŞ.";
              snkLog("ÇAPRAZ KONTROL: " + sonuclar[cz].karakter + " " + fark.toFixed(2) + " sn sapıyor.");
            }
          }
        } else if (tut.caprazUyusmuyor) {
          /* Birden çok dosyada tutarlılık kontrolü "hepsi birbiriyle uyumlu" diyebilir ama
             HEPSİ birlikte yanlış yöne kaymış olabilir (aynı hatalı referans). Çeken kendi
             kaydıyla ölçülen bağımsız değer bunu yakalayan tek işaret. */
          caprazNot += "\n⚠ Dosyaların ortak kayması " + tut.medyan.toFixed(2) + " sn, ama senin kendi " +
            "kaydının kayması " + snk.cekenKontrol.toFixed(2) + " sn. Hepsi birlikte yanlış kaymış " +
            "olabilir — yerleştirdikten sonra sesleri mutlaka dinleyerek kontrol et.";
          snkLog("ÇAPRAZ KONTROL: medyan " + tut.medyan.toFixed(2) + " sn, kendi kaydın " +
                 snk.cekenKontrol.toFixed(2) + " sn — uyuşmuyor.");
        }
      }
      /* Kanal durumunu ONAYDAN HEMEN ÖNCE tazele. Oyun sesini artık kullanıcı elle taşıyor ve
         bunu panel hizalama yaparken (dakikalar sürebilir) yapmış olabilir. Bayat veriyle
         sorulursa "A3'ün üzerine yazılacak" uyarısı yanlış çıkar ve oyun sesi satırı taşınmış
         olduğu hâlde "boş" görünür. */
      await snkKanalSayisiOku();
      snkPlanCiz();   // aykırı işaretleri (tutarlılık + çapraz kontrol) tabloya yansıt

      // --- onay ---
      var ozet = [];
      yerlesecek.forEach(function (p) {
        ozet.push("A" + (p.kanal + 1) + " → " + p.karakter + "   " +
                  (p.offset >= 0 ? "+" : "") + p.offset.toFixed(2) + " sn" + (p.aykiri ? "  ⚠" : ""));
      });
      var atlandiNot = "";
      if (hizalanamayan.length) {
        atlandiNot = "\n\n⚠ " + hizalanamayan.length + " dosya hizalanamadı ve YERLEŞTİRİLMEYECEK:";
        hizalanamayan.forEach(function (h) { atlandiNot += "\n• " + h.karakter + " (" + h.dosya.dosya + ")"; });
        atlandiNot += "\nDosya bozuk ya da çok kısa olabilir.";
      }
      /* ÜZERİNE YAZMA: yerleştirme overwriteClip ile yapılıyor, hedef kanaldaki mevcut klip
         EZİLİR. Kanal sırası değiştiğinden (oyun sesi artık en sonda) bu gerçek bir risk:
         kullanıcının oyun sesi hâlâ A3'teyse ve oraya Mimi gidecekse önceden görmeli. */
      var ezilecek = [];
      yerlesecek.forEach(function (p) {
        var say = (snk.kanalKlip && snk.kanalKlip[p.kanal]) || 0;
        if (say > 0) ezilecek.push("A" + (p.kanal + 1) + " (" + say + " klip) → " + p.karakter);
      });
      /* OYUN SESİNİ PANEL TAŞIMAZ (v1.8.1). Premiere'de klip taşıma API'si yok; tek yol
         overwriteClip ve o, project item'dan yerleştirdiği için çoklu-akışlı OBS kaydında
         (A1/A2/A3 = aynı dosyanın 1./2./3. akışı) hedefe oyun sesi değil MİKROFON koyuyordu.
         Panel bunu fark edip taşımayı reddediyordu, yani özellik zaten çalışmıyordu.
         Artık klibi kullanıcı elle taşıyor; panelin işi yalnızca hatırlatmak: en alttaki
         "Oyun sesi" satırının kanalı boşsa taşıma muhtemelen yapılmamıştır ve Uygula'ya
         basılırsa oyun sesinin GERÇEKTEN durduğu kanal bir kişiyle ezilir. */
      var oyunSatir = null;
      snk.plan.forEach(function (p) { if (p.oyun) oyunSatir = p; });
      var oyunNot = "";
      if (oyunSatir && snk.kanalKlip && !(snk.kanalKlip[oyunSatir.kanal] > 0)) {
        oyunNot = "\n\n⚠ A" + (oyunSatir.kanal + 1) + " (oyun sesi kanalı) BOŞ. Oyun sesini oraya " +
                  "taşımadıysan şimdi İPTAL et, Premiere'de klibi elle en alta taşı, sonra tekrar " +
                  "Uygula'ya bas — yoksa oyun sesinin durduğu kanal bir kişiyle ezilir.";
      }
      var ezmeNot = ezilecek.length
        ? ("\n\n⚠ ŞU KANALLARDA ZATEN KLİP VAR, ÜZERİNE YAZILACAK:\n• " + ezilecek.join("\n• "))
        : "";
      if (snk.kanalKlip === null) {
        ezmeNot += "\n\n⚠ Kanalların içeriği okunamadı — üzerine yazma riski KONTROL EDİLEMEDİ.";
      }
      var msg = yerlesecek.length + " ses dosyası yerleştirilecek:\n\n" + ozet.join("\n") + oyunNot + atlandiNot + ezmeNot +
        (tut.aykiriSayisi ? "\n\n⚠ " + tut.aykiriSayisi + " dosyanın kayması diğerlerinden farklı — " +
          "yanlış hizalanmış olabilir. Uyguladıktan sonra o kanalları kontrol et." : "") +
        (caprazNot ? "\n" + caprazNot : "") +
        "\n\nProje önce kaydedilecek; sorun olursa üstteki “Geri Al” ile bu ana dönebilirsin.";
      if (!(await uiConfirm(msg, "Senkron"))) { snkFail("İptal edildi", "warn"); return; }

      // --- uygula ---
      if (snk.iptal) throw new Error("İptal edildi");
      snkProgress(86, "Proje kaydediliyor…");
      /* KAYDETME SONUCU KONTROL EDİLİR: onay metninde kullanıcıya "Geri Al ile bu ana
         dönebilirsin" sözü verildi. Kaydetme başarısız olursa (kilitli dosya, kopmuş harici
         disk, salt-okunur konum) "Geri Al" DAHA ESKİ bir sürüme döner ve aradaki tüm çalışma
         gider — yani güvenlik ağı tam tersine veri kaybettirir. */
      var sv = String(await evalES("saveProject()"));
      snkLog("Kaydet: " + sv);

      /* KAYDETME ONAYI EN BAŞTA SORULUR. Eskiden bu blok oyun sesi taşındıktan SONRA
         geliyordu: kullanıcı "hayır, devam etme" dese bile oyun sesi çoktan A3'ten A5'e
         taşınmış oluyordu ve panel "İptal edildi" diyordu — timeline değişmiş, kullanıcı
         hiçbir şey olmadığını sanıyordu. Artık hiçbir şeye dokunmadan soruluyor. */
      if (sv.indexOf("ok:") !== 0) {
        var devamKayit = await uiConfirm("Proje kaydedilemedi: " + hostMesaj(sv) + "\n\n" +
          "Devam edersem “Geri Al” bu ana DÖNEMEZ; daha eski bir sürüme döner ve aradaki " +
          "çalışman kaybolabilir.\n\nYine de devam edeyim mi?", "Senkron");
        if (!devamKayit) { snkFail("İptal edildi", "warn"); return; }
      }

      /* Oyun sesi taşıma adımı KALDIRILDI (v1.8.1) — yukarıdaki uzun nota bak. Kullanıcı
         klibi elle taşıdığı için burada yapılacak bir iş yok; onay metnindeki uyarı
         (oyunNot) taşımanın atlanmış olabileceğini zaten söylüyor. */

      /* NEGATİF KAYMA: Craig kaydı OBS'ten ÖNCE başlamışsa klip timeline'da 0'dan önceye
         düşmeliydi — bu mümkün değil. Bu yüzden dosyanın başı ffmpeg ile kırpılır ve kırpılmış
         kopya 0'a yerleştirilir; senkron korunur. */
      snkProgress(88, "Dosyalar hazırlanıyor…");
      for (var k = 0; k < yerlesecek.length; k++) {
        var q = yerlesecek[k];
        q.konacakYol = q.dosya.yol;
        q.konacakBas = q.offset;
        if (q.offset < -0.01) {
          /* Uzantı ".wav" OLMAK ZORUNDA: trimWav çıktıyı pcm_s16le olarak yazıyor ve ffmpeg
             biçimi uzantıdan seçiyor. ".m4a" verilirse mp4 muxer'a PCM yazmaya çalışıp
             "Conversion failed" ile çöküyor (ölçüldü). */
          /* Kodek KOPYALANIR (trimAudioCopy), yeniden kodlanmaz: trimWav altyazı hattı için
             yazılmış ve çıktıyı 16 kHz MONO'ya düşürüyor — Craig'in 48 kHz kaydını bozardı. */
          /* KIRPILAN DOSYA GEÇİCİ DEĞİLDİR — timeline'daki klibin MEDYASI olur.
             work klasörüne yazılıp snk.temizlik'e eklendiğinde finally bloğu onu siliyordu:
             yerleştirme başarılı görünüyor, sonra klip "Media Offline" oluyordu. Artık
             Craig klasörünün altındaki "hizalanmis" klasörüne, kullanıcının medyasının
             yanına yazılır ve ASLA silinmez. */
          var hedefDir = path.join(path.dirname(q.dosya.yol), "hizalanmis");
          pipeline.ensureDir(hedefDir);
          var kirp = path.join(hedefDir, path.basename(q.dosya.yol, path.extname(q.dosya.yol)) +
                               "_hizali" + path.extname(q.dosya.yol));
          await pipeline.trimAudioCopy(q.dosya.yol, kirp, -q.offset, cfg.ffmpegExe);
          q.konacakYol = kirp; q.konacakBas = 0;
          snkLog(q.karakter + ": kayıt videodan önce başlamış, başı kırpıldı (" + (-q.offset).toFixed(2) + " sn).");
        }
      }

      if (snk.iptal) throw new Error("İptal edildi");
      snkProgress(92, "Premiere'e yerleştiriliyor…");
      var satirlar = [];
      yerlesecek.forEach(function (p) {
        // Renk alanı KALDIRILDI (timeline etiketleme iptal edildi) — host da 4 alan bekliyor.
        satirlar.push(p.konacakYol + "|" + p.kanal + "|" + Math.max(0, p.konacakBas).toFixed(3) +
                      "|" + p.karakter);
      });
      /* ⚠ YERLEŞTİRİLMEYEN AMA DOKUNULMAMASI GEREKEN KANALLAR DA BİLDİRİLİR.
         Oyun sesi satırının `dosya` alanı yok, bu yüzden `yerlesecek` filtresinden eleniyor
         ve plan dosyasına hiç yazılmıyordu — host o kanalı bilmiyor, rezerve edemiyordu.
         Sonuç: kanal tipi uyumsuzluğunda yedek arama plandaki bütün kanalları atlayıp tam da
         oyun sesi kanalına ulaşıyor, oraya bir Craig kaydı koyuyordu; kullanıcı sonradan oyun
         sesini oraya sürükleyince arkadaşının sesi sessizce eziliyordu.
         Hizalanamayan (elenen) kayıtların kanalları da rezerve edilir: o kanal kullanıcının
         beklediği yer, yedek arama oraya yazmamalı. */
      snk.plan.forEach(function (p) {
        if (!p || typeof p.kanal !== "number" || p.kanal < 0) return;
        if (yerlesecek.indexOf(p) !== -1) return;          // zaten normal satırla bildirildi
        satirlar.push("#REZERVE|" + p.kanal);
      });
      var planDosya = path.join(cfg.workDir, "snkplan_" + Date.now() + ".txt");
      fs.writeFileSync(planDosya, satirlar.join("\n"), "utf8");
      var sonuc = await evalES('senkronUygula("' + esPath(planDosya) + '")');
      try { fs.unlinkSync(planDosya); } catch (e4) {}
      snkLog("Sonuç: " + sonuc);

      var sonucStr = String(sonuc);
      if (sonucStr.indexOf("ok:") !== 0) {
        snkFail("⚠ " + hostMesaj(sonucStr), "warn");
        uiAlert(hostMesaj(sonucStr), "Senkron");
        return;
      }
      /* KISMİ BAŞARI da "ok:" ile başlıyor: "ok:3 ses yerleştirildi, 2 hata | Dora: A5 kanalına
         yerleşmedi …". Sadece öneke bakmak yeşil ✓ gösteriyordu; kullanıcı bir arkadaşının sesi
         hiç konmamışken videoyu kurgulayıp yayınlayabiliyordu. Hata varsa A2 temizliği de
         teklif edilmez (A2'ye ses gerçekten yerleşmemiş olabilir). */
      var hm = sonucStr.match(/(\d+)\s*hata/);
      var hataSayisi = hm ? parseInt(hm[1], 10) : 0;
      // Bu sekansta senkron çalıştı — ikinci çalıştırmada A2 referansı bozuk olacağı için uyaracağız
      if (seqAd) lsSet("snkUygulandi." + seqAd, String(Date.now()));
      if (hataSayisi) {
        snkFail("⚠ " + sonucStr.replace(/^ok:/, ""), "warn");
        await uiAlert("Bazı sesler yerleştirilemedi:\n\n" + sonucStr.replace(/^ok:/, "").replace(/\s*\|\s*/g, "\n\n") +
          "\n\nO kanalları Premiere'de kontrol et. En sık sebep: kanal Mono açılmış, Craig kaydı stereo — " +
          "kanal başlığına sağ tıklayıp uygun tipte yeni bir ses kanalı ekleyip tekrar dene.", "Senkron");
        return;
      }
      snkDone("Bitti — " + sonucStr.replace(/^ok:/, "") +
              (hizalanamayan.length ? " (" + hizalanamayan.length + " dosya hizalanamadı, konmadı)" : ""));

      /* A2 TEMİZLİĞİ AYRI ONAY: karışık Discord kanalı artık gereksiz ama kanalı boşaltmak
         kullanıcının medyasını siler; açıkça istemeden dokunulmaz.
         UNDO GRUBU: host beginUndoGroup/endUndoGroup ÇAĞIRIYOR ama app.beginUndoGroup
         Premiere Pro'da YOKTUR (After Effects API'si). Çağrı try/catch'e düşüp sessizce
         geçersiz kalıyor, yani silinen klipler TEK Ctrl+Z ile GERİ GELMEZ — her klip ayrı
         bir geri alma adımı. Kullanıcıya bu yüzden "birden çok kez" deniyor. */
      /* ⚠ YALNIZ GERÇEKTEN YERLEŞMİŞ KAYIT İÇİN TEKLİF ET. Eskiden seçim filtrelenmiş
         `yerlesecek` listesinden değil HAM snk.plan'dan yapılıyordu; hizalanamayan dosyalar
         (q.hizaHata) yerleştirmeden ELENİYOR ama aynı nesneler snk.plan'da `dosya` alanıyla
         duruyor. Yani A2'nin sahibi hizalanamadığında A2'ye HİÇ klip konmadığı hâlde panel
         "A2'de artık X'in temiz kaydı var" diyordu. O durumda konacakYol da undefined olduğu
         için korunacak ad orijinal Craig adından türetiliyor, host onu kanalda bulamayıp
         "err:Korunacak klip bulunamadi; guvenlik icin hicbir sey silinmedi" dönüyor ve panel
         bu cevabı yalnız VARSAYILAN OLARAK GİZLİ olan log'a yazıyordu — kullanıcı temizliğin
         yapıldığını sanıyordu. */
      var karsiPlan = null;
      snk.plan.forEach(function (p) {
        if (p.kanal === 1 && p.dosya && !p.hizaHata && p.konacakYol) karsiPlan = p;
      });
      /* ⚠ HOST "TAŞINDI" DEDİYSE A2 HAKKINDA KONUŞMA. Kanal tipi uyumsuzluğunda host kaydı
         BAŞKA bir kanala koyuyor ve bunu sonuç mesajında "kanal tipi uymadığı için taşındı:
         Moni -> A5" diye bildiriyor. Panel bunu okumadan "A2'de artık Moni'nin temiz kaydı
         var" diyor, kullanıcı Evet diyor ve A2 temizleniyor — oysa A2'ye HİÇBİR ŞEY konmadı;
         orada duran tek şey OBS'in karışık Discord sesi ve o siliniyor. Korunacak klip de
         A2'de olmadığı için host güvenlik kontrolüyle reddediyor, yani sonuç "hiçbir şey
         silinmedi" oluyor ama teklif baştan yanlış. */
      if (karsiPlan && /taşındı|tasindi/i.test(sonucStr) &&
          new RegExp(karsiPlan.karakter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*->", "i").test(sonucStr)) {
        snkLog("A2 temizliği teklif EDİLMEDİ: " + karsiPlan.karakter + " kanal tipi uyumsuzluğu " +
               "yüzünden başka kanala taşındı, A2'ye bir şey konmadı.");
        karsiPlan = null;
      }
      if (karsiPlan) {
        var sil = await uiConfirm("A2'de artık " + karsiPlan.karakter + "'nin temiz kaydı var.\n\n" +
          "OBS'ten gelen ESKİ karışık Discord sesi hâlâ orada duruyor olabilir — o kanalı temizleyeyim mi?\n\n" +
          // Geri alınabilirliği yaz: host artık undo grubu kullanıyor, kullanıcı "geri dönüşü yok"
          // sanıp gerçekten gereken temizlikten kaçınmasın.
          "(Not: A2'ye yeni ses zaten yerleşti. Temizlik yaparsan A2'deki TÜM eski klipler silinir — " +
          "yanlışlıkla yaparsan Ctrl+Z ile geri alabilirsin ama her klip ayrı adım — " +
          "üstteki “Geri Al” düğmesi daha kolay.)", "A2 temizliği");
        if (sil) {
          /* Yerleştirilen klibin adını KORUNACAK olarak geçiyoruz. Bu olmadan clearAudioTrack
             kanaldaki her şeyi siliyordu — az önce koyduğumuz Craig kaydı dahil.
             ADI GERÇEKTEN YERLEŞEN DOSYADAN al (konacakYol): kayma negatifse timeline'a
             giden şey kırpılmış kopyadır ("...._hizali.m4a") ve orijinal Craig adıyla
             eşleşmez — koruma sessizce tutmuyordu, klip yine siliniyordu. */
          var korunacak = path.basename(karsiPlan.konacakYol || karsiPlan.dosya.yol)
                            .replace(/\.[^.]+$/, "");
          var t = String(await evalES('clearAudioTrack(1,"' + esPath(korunacak) + '")'));
          snkLog("A2 temizliği: " + t);
          /* ⚠ HOST'UN REDDİ EKRANA ÇIKAR. Cevap yalnız gizli log'a yazılıyordu: güvenlik
             kontrolü hiçbir şey silmeden dönse bile kullanıcı temizliğin olduğunu sanıyordu.
             Aynı sessiz dal, korunacak ad Türkçe karakter içerip evalScript literalinde
             bozulduğunda da tetikleniyor. */
          if (t.indexOf("ok:") !== 0) {
            snkFail("⚠ A2 temizliği yapılamadı: " + hostMesaj(t), "warn");
            await uiAlert("A2 temizliği YAPILMADI:\n\n" + hostMesaj(t) +
                          "\n\nA2'deki eski karışık ses hâlâ duruyor — Premiere'de elle silebilirsin.",
                          "A2 temizliği");
          }
        }
      }
    } catch (e) {
      if (snk.iptal) snkFail("İptal edildi", "warn");
      else { snkFail("❌ " + friendlyError(e), "bad"); snkLog("HATA: " + (e.message || e)); }
    } finally {
      snk.calisiyor = false;
      $("snkUygula").disabled = false;
      $("snkCancel").hidden = true;
      cleanupFiles(snk.temizlik || []);
      snk.temizlik = [];
    }
  }

  // ---------- olay bağlantıları ----------
  if ($("snkKlasor")) $("snkKlasor").addEventListener("click", snkKlasorSec);
  if ($("snkUygula")) $("snkUygula").addEventListener("click", snkCalistir);
  // "Oyun sesi hangi kanalda?" seçici kaldırıldı (panel oyun sesine dokunmuyor) — bağlantı da yok.
  if ($("snkCancel")) $("snkCancel").addEventListener("click", function () {
    snk.iptal = true;
    try { if (pipeline && pipeline.cancelAll) pipeline.cancelAll(); } catch (e) {}
  });
  if ($("snkLogToggle")) $("snkLogToggle").addEventListener("click", function () {
    var l = $("snkLog"); l.hidden = !l.hidden; this.textContent = l.hidden ? "Ayrıntılar ▾" : "Ayrıntılar ▴";
  });
  (function () {
    var btns = document.querySelectorAll("#snkCeken .seg-btn");
    for (var i = 0; i < btns.length; i++) btns[i].addEventListener("click", function () {
      var a = document.querySelector("#snkCeken .seg-btn.active"); if (a) a.classList.remove("active");
      this.classList.add("active");
      lsSet("snkCeken", this.dataset.ceken);
      if (snk.dosyalar.length) snkEslestir();
    });
  })();
  if ($("snkKisiSave")) $("snkKisiSave").addEventListener("click", snkKisiKaydet);
  // "Kaydet"e basmayı unutursan kaybolmasın — Karakter İsimleri kutusunda zaten var olan koruma.
  // İki kutu birebir aynı göründüğü için kullanıcı ikisinin de aynı davrandığını varsayıyor.
  if ($("snkKisiText")) $("snkKisiText").addEventListener("blur", function () {
    if (KISI && this.value !== _kisiSonMetin) snkKisiKaydet();
  });
  if ($("snkKisiReset")) $("snkKisiReset").addEventListener("click", async function () {
    if (!KISI) return;
    if (!(await uiConfirm("Kişi listesi varsayılana dönecek. Kendi eklediklerin silinir.\n\nDevam?", "Kişiler"))) return;
    state.kisiler = KISI.defaults();
    try { KISI.save(extRoot, state.kisiler); } catch (e) {}
    snkKisiDoldur();
    $("snkKisiStatus").textContent = "✓ Varsayılanlar yüklendi.";
    $("snkKisiStatus").style.color = "var(--good)";
  });

  // ---------- AUTOCUT ----------
  var acCuts = [], acLast = null, _acMax = 0;
  function acSetProgress(pct, label) {
    var box = $("acProgress"); box.hidden = false; box.classList.remove("done", "error");
    var sp = $("acSpinner"); if (sp) sp.hidden = false; var bd = $("acBadge"); if (bd) bd.hidden = true;
    if (label) $("acLabel").textContent = label;
    if (pct >= 0) { if (pct < _acMax) pct = _acMax; else _acMax = pct; $("acFill").style.width = pct + "%"; $("acPct").textContent = Math.round(pct) + "%"; }
  }
  function acDone(label) {
    var box = $("acProgress"); box.hidden = false; box.classList.add("done"); box.classList.remove("error");
    var sp = $("acSpinner"); if (sp) sp.hidden = true; var bd = $("acBadge"); if (bd) { bd.hidden = false; bd.textContent = "✓"; bd.className = "prog-badge ok"; }
    _acMax = 100; $("acFill").style.width = "100%"; $("acPct").textContent = "100%";
    $("acLabel").style.color = "var(--good)"; $("acLabel").textContent = label || "Bitti";
  }
  function acFail(label, kind) {
    var box = $("acProgress"); box.hidden = false; box.classList.add("error"); box.classList.remove("done");
    var sp = $("acSpinner"); if (sp) sp.hidden = true; var bd = $("acBadge"); if (bd) { bd.hidden = false; bd.textContent = "✕"; bd.className = "prog-badge bad"; }
    $("acLabel").style.color = (kind === "warn") ? "var(--warn)" : "var(--bad)"; $("acLabel").textContent = label || "Hata";
  }
  function acLogLine(msg) { var el = $("acLog"); var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  $("acLogToggle").addEventListener("click", function () { var l = $("acLog"); l.hidden = !l.hidden; this.textContent = l.hidden ? "Ayrıntılar ▾" : "Ayrıntılar ▴"; });

  /* ---------- AutoCut: hangi kanallar "konuşma"? ----------
     ESKİDEN A1 + A2 SABİTTİ. Senkron kartı arkadaşları A4, A5, A6…'ya koyduğu için
     onların sesi analize HİÇ girmiyordu: yalnızca A4'teki arkadaş konuşurken o bölüm
     "kimse konuşmuyor" sayılıp kesiliyordu — yani arkadaşın konuşması siliniyordu.
     Artık klip içeren bütün kanallar listelenir. Varsayılan seçim A3 HARİÇ hepsi
     (A3 sabit kural gereği oyun sesi). Seçim kanal numarasına göre hatırlanır. */
  /* OYUN SESİ ARTIK EN SON KANALDA (yeni kanal düzeni: A1 çeken · A2 diğeri · sonra
     karakterler · en son oyun sesi). Eskiden burada "A3 = oyun sesi" sabiti vardı; o
     düzende doğruydu ama yeni düzende A3 Mimi oluyor, yani yanlış kişiyi analiz dışı
     bırakırdı. Varsayılan: klip içeren SON kanal hariç hepsi. Kullanıcı değiştirebilir,
     seçim kanal numarasına göre hatırlanır. */
  var _acKanallar = [];            // [{idx, clips, chk}]
  var _acSonKanal = -1;            // klip içeren en son kanal (yeni düzende oyun sesi)

  /* VARSAYILAN: HEPSİ İŞARETLİ — tahmin YAPILMAZ.
     Önce "son kanal oyun sesidir" diye varsayıp onu dışlıyordum. Ama panel oyun sesini
     taşıyamadığı projelerde son kanal bir ARKADAŞ oluyor; o kanal analiz dışı kalınca
     arkadaşın tek başına konuştuğu yerler "boşluk" sayılıp ripple-delete ile SİLİNİYORDU.
     İki hatanın maliyeti eşit değil:
       - oyun sesi yanlışlıkla İÇERİDE ise: hiç boşluk bulunmaz, kimse bir şey kaybetmez,
         kullanıcı sonucu görüp kutuyu kaldırır.
       - bir kişi yanlışlıkla DIŞARIDA ise: konuşması sessizce silinir.
     Bu yüzden varsayılan güvenli tarafta: hepsi işaretli.

     SEÇİM ARTIK HATIRLANMIYOR — bilerek. Kanal NUMARASINA göre hatırlamak yeni düzende
     tuzak: oyun sesi kadroya göre yer değiştiriyor (3 arkadaşla A5, 4 arkadaşla A6).
     Kullanıcı bir videoda A5'i (oyun sesi) işaretten çıkarınca, sonraki videoda A5'te
     oturan ARKADAŞ sessizce analiz dışı kalıyor ve konuşması siliniyordu (ölçüldü).
     Hatırlamanın kazancı bir tık; bedeli silinen konuşma. Her açılışta hepsi işaretli
     başlıyor, kullanıcı oyun sesi kanalının kutusunu kaldırıyor. */
  function acKanalSecili(idx) {
    return true;
  }
  function acSeciliKanallar() {
    var out = [];
    for (var i = 0; i < _acKanallar.length; i++) if (_acKanallar[i].chk.checked) out.push(_acKanallar[i].idx);
    return out;
  }
  function acKanalUyariGuncelle() {
    var u = $("acKanalUyari"); if (!u) return;
    var sec = acSeciliKanallar();
    u.hidden = false;
    if (!sec.length) {
      u.style.color = "var(--warn)";
      u.textContent = "Hiçbir kanal işaretli değil — analiz yapılamaz.";
      return;
    }
    u.style.color = "";
    u.textContent = "Analiz edilecek: " + sec.map(function (i) { return "A" + (i + 1); }).join(", ");
  }
  function acKanalCiz(list) {
    var box = $("acKanalRows"); if (!box) return;
    box.innerHTML = ""; _acKanallar = [];
    var dolu = (list || []).filter(function (t) { return t.clips > 0; });
    if (!dolu.length) {
      box.innerHTML = '<p class="note" style="margin:0;color:var(--warn)">Sekansta ses klibi bulunamadı.</p>';
      var u0 = $("acKanalUyari"); if (u0) u0.hidden = true;
      return;
    }
    // Varsayılan seçim için: klip içeren SON kanal = yeni düzende oyun sesi.
    _acSonKanal = dolu[dolu.length - 1].idx;
    dolu.forEach(function (t) {
      var row = document.createElement("label");
      row.className = "switch-row"; row.style.margin = "0";
      var sol = document.createElement("span");
      sol.appendChild(document.createTextNode("A" + (t.idx + 1)));
      var s = document.createElement("small");
      s.textContent = " " + t.clips + " klip" +
        (t.idx === 0 ? " · senin mikrofonun"
                     : (t.idx === _acSonKanal ? " · en alt kanal — oyun sesi buradaysa KUTUYU KALDIR" : ""));
      sol.appendChild(s);
      var chk = document.createElement("input");
      chk.type = "checkbox"; chk.checked = acKanalSecili(t.idx);
      (function (idx, kutu) {
        kutu.addEventListener("change", function () {
          // Seçim KAYDEDİLMİYOR (bkz. acKanalSecili): kanal numarasının anlamı videodan
          // videoya değişiyor, kayıtlı seçim başka birini dışlıyordu.
          acAnalizGecersiz();          // seçim değişti: ekrandaki eski analiz artık geçersiz
          acKanalUyariGuncelle();
        });
      })(t.idx, chk);
      row.appendChild(sol); row.appendChild(chk);
      box.appendChild(row);
      _acKanallar.push({ idx: t.idx, clips: t.clips, chk: chk });
    });
    acKanalUyariGuncelle();
  }
  async function acKanallariTara(sessiz) {
    if (!CEP) return;
    var raw = await evalES("getAudioTracksJSON()");
    var d = null; try { d = JSON.parse(raw); } catch (e) {}
    if (!d || d.error) { if (!sessiz) uiAlert("Sekans okunamadı. Önce bir sekans aç.", "AutoCut"); return; }
    acKanalCiz(d.tracks || []);
  }
  if ($("acKanalTara")) $("acKanalTara").addEventListener("click", function () {
    var p = acKanallariTara(false); if (p && p["catch"]) p["catch"](function () {});
  });

  $("acAnalyze").addEventListener("click", async function () {
    if (!CEP) {
      acCuts = [{ start: 1, end: 2 }, { start: 5, end: 8 }];
      $("acCount").textContent = "142"; $("acSaved").textContent = "178 sn"; $("acResult").hidden = false;
      _acMax = 0; acDone("Bitti (önizleme) — 142 boşluk"); return;
    }
    /* Aynı anda tek iş: iptal düğmeleri pipeline.cancelAll() çağırıyor ve o BÜTÜN süreçleri
       öldürüyor. Eskiden 30 dakikalık altyazı işi sürerken burada başlatılan analizin iptali
       o işi de öldürüyordu; üstelik ortak state.cancelled sıfırlanınca altyazı tarafı iptali
       "hata" sanıyordu. */
    if (state.running) { uiAlert("Altyazı üretimi sürüyor. Bitmesini bekle ya da onu iptal et, sonra analiz yap.", "AutoCut"); return; }
    if (snk.calisiyor) { uiAlert("Senkron işlemi sürüyor. Bitmesini bekle ya da onu iptal et.", "AutoCut"); return; }
    var btn = this; if (state.acRunning) return;
    state.acRunning = true;
    btn.disabled = true; state.acCancelled = false; $("acResult").hidden = true; $("acLog").textContent = ""; $("acLabel").style.color = ""; _acMax = 0;
    $("acCancel").hidden = false;
    acSetProgress(8, "Sekans okunuyor…");
    try {
      pipeline.ensureDir(cfg.workDir);
      var stamp = Date.now();
      /* SEÇİLİ TÜM KANALLAR — eskiden A1+A2 sabitti ve A4+'daki arkadaşlar hiç
         analiz edilmediği için onların konuştuğu bölümler "boşluk" sayılıp kesiliyordu. */
      var secKanal = acSeciliKanallar();
      if (!secKanal.length) {
        // Kart hiç çizilmemiş olabilir (görünüm açılmadan analiz denendi) — bir kez tara.
        await acKanallariTara(true);
        secKanal = acSeciliKanallar();
      }
      if (!secKanal.length) {
        /* ⚠ İLERLEME KUTUSUNU KAPAT — DÜZ `return` SPINNER'I SONSUZA KADAR DÖNDÜRÜYORDU.
           Bu noktadan önce acSetProgress(8, "Sekans okunuyor…") çalıştı; #acProgress görünür
           ve spinner açık. finally bloğu yalnız state/btn/#acCancel'i toparlıyor, ilerleme
           kutusuna hiç dokunmuyor ve bu dal exception değil DÜZ RETURN olduğu için catch'teki
           acFail'e de girmiyordu. Kullanıcı uyarıyı kapatıyor, çubuk %8'de "Sekans okunuyor…"
           yazıp dönmeye devam ediyor ve analizin arka planda sürdüğünü sanıyordu. */
        acFail("Kanal seçili değil", "warn");
        uiAlert("Analiz edilecek kanal seçili değil.\n\n“Konuşma kanalları” kartından " +
                "arkadaşlarının seslerinin olduğu kanalları işaretle. " +
                "(Kart boşsa sekansta ses klibi bulunamamış demektir — “Kanalları Tara”ya bas.)", "AutoCut");
        return;
      }
      var wavs = [], atlanan = [], basarili = [];
      for (var ki = 0; ki < secKanal.length; ki++) {
        if (state.acCancelled) throw new Error("İptal edildi");
        var tIdx = secKanal[ki];
        acSetProgress(12 + 28 * ki / secKanal.length, "A" + (tIdx + 1) + " sesi hazırlanıyor…");
        try {
          var kd = await getClips(tIdx);
          var kw = path.join(cfg.workDir, "acv" + (tIdx + 1) + "_" + stamp + ".wav");
          await pipeline.buildTimelineAudio(kd.clips, cfg.ffmpegExe, kw, null, tIdx);
          wavs.push(kw); basarili.push(tIdx);
        } catch (eK) {
          /* Tek kanalın hazırlanamaması TÜM analizi düşürmesin — ama SESSİZ de geçme:
             o kanaldaki konuşma boşluk sayılır ve kesilir, kullanıcı bunu bilmeli. */
          atlanan.push("A" + (tIdx + 1) + " — " + (eK.message || eK));
        }
      }
      atlanan.forEach(function (m) { acLogLine("ATLANDI: " + m); });
      if (!wavs.length) {
        throw new Error("Seçili kanalların hiçbirinden ses hazırlanamadı." +
                        (atlanan.length ? (" " + atlanan[0]) : ""));
      }
      if (atlanan.length) {
        acLogLine("UYARI: " + atlanan.length + " kanal analiz DIŞINDA kaldı; o kanallardaki " +
                  "konuşmalar boşluk sayılıp kesilebilir.");
      }
      // karıştır (sekans-hizalı konuşma sesi)
      var voice = path.join(cfg.workDir, "acvoice_" + stamp + ".wav");
      await pipeline.mixWavs(wavs, cfg.ffmpegExe, voice);
      for (var wi = 0; wi < wavs.length; wi++) { try { fs.unlinkSync(wavs[wi]); } catch (e) {} }
      acLogLine("Timeline sesi hazır — " + basarili.length + " kanal: " +
                basarili.map(function (i) { return "A" + (i + 1); }).join(", "));
      acSetProgress(45, "Boşluklar taranıyor…");
      // denoise KALDIRILDI (kutu arayüzden çıktı) — pipeline varsayılanı zaten kapalı.
      var opts = { sensitivity: parseFloat($("acSens").value), minSilence: parseFloat($("acMin").value) };
      var res = await pipeline.analyzeSilence(cfg, voice, function (l) { var s = String(l).trim(); if (s) acLogLine(s); }, opts);
      try { fs.unlinkSync(voice); } catch (e) {}
      acCuts = res.cuts; acLast = res;
      $("acCount").textContent = res.count;
      // küçük toplamlarda 0 sn görünmesin: 1 sn altında ondalık göster
      $("acSaved").textContent = (res.totalCut >= 1 ? Math.round(res.totalCut) : res.totalCut.toFixed(1)) + " sn";
      $("acResult").hidden = false;
      /* Kesim maliyeti boşluk SAYISIYLA büyüyor. Çok yüksek sayıda kullanıcıyı önceden uyar —
         daha önce 1137 boşlukluk bir kesim hiç bitmeden iptal edilmişti. */
      if (res.count > 500) {
        acLogLine("UYARI: " + res.count + " boşluk çok fazla; kesim uzun sürer. " +
                  "“En kısa boşluk” değerini büyütürsen çok daha hızlı biter ve neredeyse aynı süreyi kazanırsın.");
      }
      acDone("Bitti — " + res.count + " boşluk bulundu (eşik " + res.threshold + "dB)" +
             (res.merged ? (", " + res.merged + " yakın boşluk birleşti") : ""));
    } catch (e) {
      if (state.acCancelled) acFail("İptal edildi", "warn");
      else { acFail("❌ " + friendlyError(e), "bad"); acLogLine("HATA: " + (e.message || e)); }
    }
    finally { state.acRunning = false; btn.disabled = false; $("acCancel").hidden = true; }
  });

  /* Ayar değişince ESKİ analiz sonucu geçersizdir. Eskiden kart ekranda kalıyor, "Boşlukları
     Kes" hâlâ eski acCuts dizisini kullanıyordu: kullanıcı "En kısa boşluk"u 0.5'ten 0.2'ye
     çekip kesince, onayda yine eski sayıyı görüp 0.5 sn'lik kesimleri uyguluyordu. */
  function acAnalizGecersiz() {
    if (!acCuts.length && !acLast) return;
    acCuts = []; acLast = null;
    var r = $("acResult"); if (r) r.hidden = true;
    var pb = $("acProgress"); if (pb) pb.hidden = true;
    acLogLine("Ayar değişti — eski analiz sonucu silindi, tekrar “Analiz Et”.");
  }
  $("acCut").addEventListener("click", async function () {
    var btn = this; if (btn.disabled) return;
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de boşluklar kesilir."); return; }
    // Üretim sürerken kesim yapılırsa timeline zamanları kayar; hazırlanan altyazılar yanlış yere düşer.
    if (state.running) { uiAlert("Altyazı üretimi sürerken kesim yapılamaz — zamanlar kayar ve altyazılar yanlış yere düşer.", "AutoCut"); return; }
    if (!acCuts.length) { uiAlert("Önce Analiz Et."); return; }
    var _sec = acLast ? acLast.totalCut : 0;
    var _secTxt = _sec >= 1 ? Math.round(_sec) + " sn" : _sec.toFixed(1) + " sn";
    var _uyari = (acCuts.length > 500)
      ? ("\n\n⚠ " + acCuts.length + " kesim çok fazla — bu işlem uzun sürebilir. İptal edip “En kısa boşluk” " +
         "değerini büyütmen (ör. 0.3 sn) neredeyse aynı süreyi kazandırır ama çok daha hızlı biter.")
      : "";
    if (!(await uiConfirm(acCuts.length + " boşluk kesilecek (~" + _secTxt + " kısalır)." + _uyari +
        "\n\nSekans dışı / kayıt boşluğu olanlar otomatik atlanır. Kesimden ÖNCE kaydet; geri almak için Ctrl+Z (birden çok kez gerekebilir).", "Boşlukları Kes"))) return;
    btn.disabled = true;   // çift-tık koruması: kesim sürerken tekrar tetiklenmesin
    try {
      _acMax = 0; $("acLabel").style.color = "";
      /* Kardeş akış acAnalyze bunu yapıyor, burada yoktu: work klasörü yoksa aşağıdaki
         writeFileSync ENOENT ile patlıyordu. ensureDir idempotent. */
      pipeline.ensureDir(cfg.workDir);
      acSetProgress(25, "Proje kaydediliyor…");   // kesimden önce her zaman kaydet (Geri Al için)
      /* ⚠ KAYIT BAŞARISIZSA SOR — ONAY METNİ "geri dönebilirsin" SÖZÜ VERİYOR.
         Aynı çağrı Senkron tarafında 'ok:' önekine göre denetlenip kullanıcıya soruluyor;
         burada dönüş değeri hiç kontrol edilmiyor, yalnızca VARSAYILAN OLARAK GİZLİ #acLog'a
         yazılıyordu. Proje salt-okunur bir konumdaysa ya da .prproj başka bir süreç
         tarafından kilitliyse saveProject "err:" dönüyor ve panel hiç uyarmadan yüzlerce
         ripple-delete uyguluyor; kullanıcı sonucu beğenmeyip projeyi kapatınca kaydedilmemiş
         son duruma değil çok daha eski bir sürüme dönüyordu. */
      var sv = String(await evalES('saveProject()'));
      acLogLine("Kaydet: " + sv);
      if (sv.indexOf("ok:") !== 0) {
        if (!(await uiConfirm("Proje kaydedilemedi: " + hostMesaj(sv) +
              "\n\nBu durumda üstteki “Geri Al” düğmesi bu ana DÖNEMEZ.\n\nYine de keseyim mi?",
              "Boşlukları Kes"))) { acFail("İptal edildi", "warn"); return; }
      }
      var body = acCuts.map(function (c) { return c.start.toFixed(3) + "|" + c.end.toFixed(3); }).join("\n");
      var file = path.join(cfg.workDir, "cuts_" + Date.now() + ".txt");
      fs.writeFileSync(file, body, "utf8");
      acSetProgress(50, "Kesiliyor… (başladıktan sonra durdurulamaz)"); $("acLabel").style.color = "";
      var r = await evalES('autoCut("' + esPath(file) + '")');
      acLogLine("Sonuç: " + r);
      var msg = String(r).replace(/^[a-z_]+:/, "");
      if (String(r).indexOf("ok:") === 0) {
        acDone("Bitti — " + msg);
        /* KESİLEN ARALIKLARI UNUT. Bunlar kesim ÖNCESİ zamanlara göre hesaplanmıştı;
           kesimden sonra timeline kaydığı için artık geçersizler. Eskiden ekranda kalıyordu
           ve "Boşlukları Kes"e ikinci kez basmak (ya da başka bir sekansa geçip basmak)
           ESKİ aralıkları uyguluyordu — yani rastgele yerlerden kesiyordu. */
        acCuts = []; acLast = null;
        /* ⚠ acAnalizGecersiz() BURADA ÇAĞRILAMAZ — NO-OP'A DÜŞÜYORDU. O fonksiyon
           `if (!acCuts.length && !acLast) return;` ile başlıyor; iki değişken bir satır önce
           temizlendiği için ilk satırda geri dönüyor ve asıl işini (#acResult'ı gizlemek)
           HİÇ yapmıyordu: kesim bittikten sonra kart ekranda "142 boşluk / 178 sn" yazmaya
           devam ediyor, oysa o boşluklar artık kesilmiş. Kullanıcı "Boşlukları Kes"e basınca
           "Önce Analiz Et" hatası alıyor ve ekrandaki sayıyla mesaj çelişiyordu.
           Doğrudan çağırmak da yanlış olurdu: fonksiyon #acProgress'i de gizliyor ve bir
           satır önce yazdığımız acDone("Bitti — …") mesajını ekrandan silerdi; log satırı
           ("Ayar değişti…") da bu bağlamda yanıltıcı. Tek gereken kartı gizlemek. */
        var _acR = $("acResult"); if (_acR) _acR.hidden = true;
        /* ELDEKİ ALTYAZILAR ARTIK BAYAT. Cue zamanları kesim ÖNCESİNE göre üretildi; kesim
           timeline'ı kısalttığı için "Timeline'a Ekle" onları kesilen toplam süre kadar —
           yani DAKİKALARCA — yanlış yere koyar. Panel bunu hiç fark etmiyordu; hizalama
           tartışması 0.3 saniyelikken bu senaryo dakikalarca kaydırıyor.
           Bayrak yerleştirmede kontrol edilir (placeCaptions). */
        if (allCues().length) {
          state.cuesStale = true;
          logLine("⚠ Kesim yapıldı — ekrandaki altyazılar kesim ÖNCESİ zamanlara ait. " +
                  "Timeline'a eklemeden önce yeniden üret.");
        }
      } else { acFail("⚠ " + msg, "warn"); uiAlert(msg, "Sonuç"); }
      /* Geçici kesim listesi başarılı yolda da silinir — work klasöründe birikmesin. */
      try { fs.unlinkSync(file); } catch (eCf) {}
    } catch (e) {
      /* ⚠ CATCH YOKTU, YALNIZ finally VARDI. Kardeş akış acAnalyze hatayı yakalayıp kırmızı
         gösteriyor; burada koruma yoktu. async bir fonksiyonda fırlatılan hata yakalanmayan
         bir promise reddine dönüşüyor: kullanıcıya HİÇBİR ŞEY gösterilmiyor, spinner ve
         "Kesiliyor… (başladıktan sonra durdurulamaz)" etiketi ekranda donuyor ve kullanıcı
         dakikalarca bekliyordu (work klasörü kilitli/silinmişse writeFileSync patlıyor —
         OneDrive kilidi bu projede bilinen bir durum).
         acAnalyze'daki `state.acCancelled` dalı KOPYALANMADI: acCut'ta iptal düğmesi yok. */
      acFail("❌ " + friendlyError(e), "bad");
      acLogLine("HATA: " + (e.message || e));
    } finally { btn.disabled = false; }
  });

  // ---------- MOCK (tarayıcı önizleme) ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function runMock() {
    state.genMode = "single";
    var steps = [[20, "Ses hazırlanıyor…"], [55, "Yazıya dökülüyor (GPU)…"], [90, "Bitiriliyor…"]];
    _pg.transT0 = Date.now();
    for (var k = 0; k < steps.length; k++) { _pg.base = steps[k][1]; transProgress(steps[k][0], 0, 100); logLine(steps[k][1]); await sleep(500); }
    state.a1Cues = []; state.a2Cues = []; state.speakers = [];
    state.singleCues = [
      { start: 0, end: 2, text: "Hepinize merhaba" },
      { start: 3, end: 4.5, text: "Gelme sen gelme" },
      { start: 5, end: 7, text: "Ya nasıl sahte ya" }
    ];
    renderTranscript(state.singleCues, null);
    progressDone("Bitti — " + state.singleCues.length + " altyazı hazır");
  }

  // ---------- LİSANS ----------
  var LIS = null;                  // js/lisans.js modülü (CEP dışında yüklenemez)

  /* Panel sürümü — aktivasyon ve ping ile birlikte sunucuya gider ki "kim en son hangi
     sürümü kullanıyor" tablodan okunabilsin (kullanıcının açık isteği). */
  function panelSurumu() {
    try { return JSON.parse(String(fs.readFileSync(path.join(extRoot, "version.json"), "utf8")).replace(/^﻿/, "")).version || ""; }
    catch (e) { return ""; }
  }

  function lisansDurumYaz(msg, renk) {
    var el = $("lisansDurum"); if (!el) return;
    el.textContent = msg || "";
    el.style.color = renk || "var(--muted)";
  }

  /*
   * Lisans kapısı. Promise döner; SADECE panel kullanılabilir olduğunda resolve olur.
   * Kilitliyken hiç resolve olmaz — oturum geri yükleme ve güncelleme sorusu da o yüzden
   * bunun ARDINA zincirlenmiş durumda (kilidin arkasında modal açılmasın).
   *
   * ⚠ HER HATA DALI PANELİ AÇAR. Modül yüklenemedi, durum okunamadı, beklenmedik istisna —
   *   hepsi "aç" ile biter (bkz. js/lisans.js başlığı). Kilit yalnız iki şeyden gelir:
   *   yerel kayıt yok/başka PC, ya da sunucu açıkça iptal etti.
   */
  function lisansKapisi() {
    return new Promise(function (resolve) {
      var kilit = $("lisansKilit");
      if (!CEP || !kilit) return resolve();          // tarayıcı önizlemesinde lisans yok

      try { LIS = require(path.join(extRoot, "js", "lisans.js")); }
      catch (eL) {
        /* Modül yoksa/bozuksa paneli AÇ. Eski bir kurulumdan güncellenen makinede
           lisans.js henüz kopyalanmamış olabilir; onu kilitlemek düpedüz kayıp. */
        logLine("Lisans modülü yüklenemedi, panel lisanssız açılıyor: " + (eL.message || eL));
        return resolve();
      }

      var d;
      try { d = LIS.durumOku(extRoot); }
      catch (eD) { logLine("Lisans durumu okunamadı, panel açılıyor: " + (eD.message || eD)); return resolve(); }

      var surum = panelSurumu();

      function ac(kayit) {
        kilit.hidden = true;
        /* Ping AÇILDIKTAN SONRA ve arka planda: sonucu beklenmiyor, hatası yutuluyor.
           Buraya `await` koymak "internet yoksa panel geç açılıyor" demek olurdu. */
        try { LIS.ping(extRoot, kayit, surum, logLine); } catch (eP) {}
        resolve();
      }

      if (d.durum === "acik") {
        /* ⚠ SEBEP ADLARI lisans.js İLE AYNI OLMAK ZORUNDA. Buradaki iki dal ÖLÜYDÜ:
           durumOku "hwidokunamadi" ya da "kontrolsuz" diye bir sebep hiç üretmiyor
           ("hwidyok" üretiyor) ve `mesaj` alanı da hiç dönmüyor — yani `d.mesaj` her zaman
           undefined'dı ve log satırı "Lisans: undefined" yazardı. Panelin neden açık kaldığı
           hiçbir yere yazılmıyordu; oysa bu bilgi tam da "kilit çalışıyor mu" sorusunun
           cevabı. "karmayok" bu pakette eklendi (crypto arızasında kimlik biçimi değişiyor). */
        if (d.sebep === "hwidyok")
          logLine("Lisans: bilgisayar kimliği okunamadı — panel yine de açıldı.");
        else if (d.sebep === "karmayok")
          logLine("Lisans: kimlik biçimi değişmiş (crypto okunamadı) — panel yine de açıldı.");
        else if (d.sebep === "karmagoc")
          logLine("Lisans: kayıt eski biçimdeydi, kimlik doğrulandı — panel açıldı.");
        return ac(d.kayit);
      }

      // ---- KİLİTLİ: kod ekranı ----
      kilit.hidden = false;
      var inp = $("lisansSifre"), btn = $("lisansGiris");
      /* ⚠ EKRANDA KOD KUTUSUNDAN BAŞKA HİÇBİR ŞEY YOK (kullanıcı isteği, 7 Ağustos 2026):
         bilgisayar kimliği GÖSTERİLMEZ, "kodu falancadan al" gibi bir metin YAZILMAZ, alt
         bilgi satırı YOKTUR. Kimlik arka planda üretilip yalnız sunucuya gidiyor.
         Teşhis bilgisi Ayrıntılar log'una yazılıyor — ekranı kirletmeden erişilebilir. */
      logLine("Lisans kilidi: " + (d.sebep || "?") + " · panel " + surum);

      var calisiyor = false;
      function dene() {
        if (calisiyor) return;                       // çift tıklama iki istek göndermesin
        var sifre = (inp && inp.value ? inp.value : "").trim();
        if (!sifre) { lisansDurumYaz("Şifreyi yaz.", "var(--warn)"); return; }
        calisiyor = true;
        if (btn) { btn.disabled = true; btn.textContent = "Kontrol ediliyor…"; }
        lisansDurumYaz("Sunucuya bağlanılıyor…", "var(--muted)");

        LIS.aktivasyon(extRoot, sifre, surum).then(function (r) {
          calisiyor = false;
          if (btn) { btn.disabled = false; btn.textContent = "Devam"; }
          if (r.ok) {
            lisansDurumYaz("✓ Açılıyor…", "var(--good)");
            /* ⚠ "Bir daha sorulmayacak" SÖZÜ ANCAK DİSKE YAZILDIYSA VERİLİR. Yazma
               başarısızsa (dosyayı açık tutan bir süreç, salt okunur klasör) panel yine
               açılır ama kod bir sonraki açılışta tekrar sorulur — o cümle yalan olurdu ve
               kullanıcı aynı döngüye her açılışta düşerken tek bir uyarı bile görmüyordu. */
            if (r.yazildi === false)
              logLine("⚠ Lisans etkinleştirildi ama diske YAZILAMADI — panel bir sonraki açılışta kodu tekrar sorabilir.");
            else
              logLine("Lisans etkinleştirildi — bu bilgisayarda bir daha sorulmayacak.");
            setTimeout(function () { ac(r.kayit); }, 350);
            return;
          }
          /* Renk ayrımı bilinçli: "internet" sarı (kullanıcı tekrar denesin),
             şifre/başka-PC kırmızı (tekrar denemek işe yaramaz). */
          lisansDurumYaz(r.mesaj, r.sebep === "internet" ? "var(--warn)" : "var(--bad)");
          if (inp) { inp.value = ""; inp.focus(); }
        })["catch"](function (e) {
          calisiyor = false;
          if (btn) { btn.disabled = false; btn.textContent = "Devam"; }
          lisansDurumYaz("Beklenmedik hata: " + (e.message || e), "var(--bad)");
        });
      }

      if (btn) btn.addEventListener("click", dene);
      if (inp) {
        inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") dene(); });
        setTimeout(function () { try { inp.focus(); } catch (e) {} }, 60);
      }
    });
  }

  // ---------- başlangıç ----------
  function loadStyles() {
    state.styles = [];
    var dirs = [];
    if (cfg && cfg.stylesDir) dirs.push(cfg.stylesDir);
    var ad = (typeof process !== "undefined" && process.env && process.env.APPDATA) || "";
    if (ad) dirs.push(path.join(ad, "Adobe", "Common", "Motion Graphics Templates"));
    var HIDE = { "untitled": 1, "basic lower third": 1, "basic title": 1 }, seen = {};
    for (var di = 0; di < dirs.length; di++) {
      var d = dirs[di]; if (!fs.existsSync(d)) continue;
      /* ⚠ existsSync GEÇSE BİLE readdirSync PATLAYABİLİR: OneDrive senkron kilidinde EPERM
         geliyor (bu projede belgelenmiş bir tuzak). Korumasız hâli initCEP'i düşürüyor ve
         onunla birlikte panelin bütün olay bağlantılarını öldürüyordu. state.styles yalnız
         bir log satırında kullanılıyor — bu klasörün okunamaması paneli durdurmamalı. */
      var files = [];
      try { files = fs.readdirSync(d).filter(function (f) { return /\.mogrt$/i.test(f); }); }
      catch (eRd) { if ($("log")) logLine("Stil klasörü okunamadı (" + d + "): " + (eRd.message || eRd)); continue; }
      for (var fi = 0; fi < files.length; fi++) {
        var name = files[fi].replace(/\.mogrt$/i, "").trim(), key = name.toLowerCase();
        if (HIDE[key] || seen[key]) continue; seen[key] = 1;
        state.styles.push({ name: name, path: path.join(d, files[fi]) });
      }
    }
  }
  function initCEP() {
    cs = new CSInterface(); extRoot = cs.getSystemPath(SystemPath.EXTENSION);
    // host.jsx'i her panel açılışında TAZE yükle (kod değişince tam restart gerekmesin — kapat-aç yeter)
    try { cs.evalScript('$.evalFile("' + extRoot.replace(/\\/g, "/") + '/jsx/host.jsx")'); } catch (eHost) {}
    path = require("path"); fs = require("fs"); pipeline = require(path.join(extRoot, "js", "pipeline.js"));
    /* ⚠ EXE İLE KURULUMDA PROGRAM YOLLARINI TAZELE — loadConfig'ten ÖNCE.
       configBirlestir YALNIZCA oto-güncelleme yolunda (checkForUpdate, paket indirildikten
       sonra) çalışıyordu; panel açılışında çalışan bir yol YOKTU. Kurulum exe'si config.json'u
       `onlyifdoesntexist` ile koruyor (kullanıcının elle değiştirdiği device/model/fontName
       ezilmesin diye), ama bunun bedeli şuydu: motor düzeni değişip yeni bir exe gönderildiğinde
       program yolları (engineExe/ffmpegExe/workDir/stylesDir) mevcut kullanıcıya ASLA
       ulaşmıyordu — panel "motor bulunamadı" diyor, sebebi görünmüyordu. Bu yollar kullanıcı
       ayarı DEĞİL (hepsi %ENGINE% token'ı, makineye özel yol içermiyor).
       Exe aynı dosyayı "config.pkg.json" adıyla da kuruyor (ignoreversion) ve birleştirme
       burada, zaten test edilmiş JS koduyla yapılıyor — Inno Pascal'da JSON ayrıştırıcı
       yazmak, önlemeye çalıştığından daha büyük bir hata doğururdu.
       İdempotent: değişiklik yoksa diske yazmıyor. Zip yolunda bu dosya hiç oluşmaz (pakette
       yok), orada configBirlestir zaten güncelleme sırasında çalışıyor. */
    try {
      var _pkgYol = path.join(extRoot, "config.pkg.json");
      if (fs.existsSync(_pkgYol)) {
        var _upd = require(path.join(extRoot, "js", "updater.js"));
        if (typeof _upd.configBirlestir === "function") {
          var _yeniAnahtar = _upd.configBirlestir(extRoot, extRoot, "config.pkg.json");
          var _zor = _upd.configBirlestir.sonZorlanan || [];
          logLine("Kurulum ayarları birleştirildi" +
                  (_zor.length ? " — program yolu tazelendi: " + _zor.join(", ") : " (program yolları zaten güncel)") +
                  (_yeniAnahtar ? " · " + _yeniAnahtar + " yeni ayar eklendi" : "") + ".");
        }
        /* ⚠ BİRLEŞTİKTEN SONRA SİLİNİR — TEK KULLANIMLIK DOSYA.
           Bırakılırsa BAYATLIYOR ve asıl işi tersine çeviriyor: dosyayı yalnız exe kuruyor,
           oto-güncelleme zip'inde YOK ve updater'ın copyDir'i hiçbir şeyi silmiyor. Yani
           exe'den kalan eski config.pkg.json diskte kalıyor; zip güncellemesi config.json'daki
           program yollarını doğru tazeliyor, panel bir sonraki açılışta aynı yolları BAYAT
           dosyadan ESKİ değerlere geri çekiyordu (ölçüldü). Tam da önlemek için yazıldığı
           "motor bulunamadı" hatası, bu kez zip yoluna — yani ikinci kullanıcının kullandığı
           yola — taşınmış oluyordu.
           Silmek her iki yolu da kapatıyor: exe her kurulumda dosyayı yeniden koyuyor, panel
           bir kez uygulayıp siliyor; zip yolunda dosya hiç bulunmuyor ve configBirlestir orada
           zaten güncelleme sırasında çalışıyor. */
        try { fs.unlinkSync(_pkgYol); }
        catch (eDel) { logLine("UYARI: config.pkg.json silinemedi (" + (eDel.message || eDel) +
                               ") — bir sonraki açılışta tekrar uygulanacak."); }
      }
    } catch (eCfgP) { logLine("Paket ayarları birleştirilemedi: " + (eCfgP.message || eCfgP)); }
    cfg = pipeline.loadConfig(extRoot);
    /* Vurucu mod modülü. YÜKLENEMEZSE panel çalışmaya DEVAM EDER — o mod bir ek özellik,
       altyazı üretimi ondan bağımsız. Yükleme hatası log'a düşer ki "kutu işaretli ama
       hiçbir şey olmuyor" durumu sessiz kalmasın. */
    try { VUR = require(path.join(extRoot, "js", "vurucu.js")); }
    catch (eVurYuk) { VUR = null; logLine("Vurucu mod modülü yüklenemedi: " + (eVurYuk.message || eVurYuk)); }
    /* Emoji modülü — yalnız dosya okur, Premiere'e dokunmaz. Yüklenemezse panel çalışmaya
       DEVAM EDER (emoji bir ek özellik), ama sessiz kalmaz. */
    try { EMJ = require(path.join(extRoot, "js", "emoji.js")); }
    catch (eEmj) { EMJ = null; logLine("Emoji modülü yüklenemedi: " + (eEmj.message || eEmj)); }
    /* PNG yatay aynalama — sol taraftaki karakterlerin ekranın içine bakması için.
       Yüklenemezse emoji özelliği DÜŞMEZ: sol taraftakiler aynalanmadan konur ve sayısı
       sonuç mesajına yazılır (sessiz düşüş yok). Saf dosya işi, Premiere'e dokunmaz. */
    try { AYNA = require(path.join(extRoot, "js", "pngayna.js")); }
    catch (eAyna) { AYNA = null; logLine("PNG aynalama modülü yüklenemedi: " + (eAyna.message || eAyna)); }
    setPill("pillHost", true); setPill("pillGpu", fs.existsSync(cfg.engineExe));
    // Karakter isimleri sözlüğü — sozluk.json yoksa varsayılan (Tofi, Moni, Dora, Mimi, Niko)
    SZ = pipeline.sozluk;
    state.dict = SZ.load(extRoot);
    // Senkron kartı modülleri (Craig kayıtlarını hizalama ve yerleştirme)
    try {
      KISI = require(path.join(extRoot, "js", "kisiler.js"));
      HIZ = require(path.join(extRoot, "js", "hizala.js"));
      state.kisiler = KISI.load(extRoot);
      snkKisiDoldur();
      var ck = lsGet("snkCeken", "Tofi");
      var ckBtn = document.querySelector('#snkCeken .seg-btn[data-ceken="' + ck + '"]');
      if (ckBtn) { var akt = document.querySelector("#snkCeken .seg-btn.active"); if (akt) akt.classList.remove("active"); ckBtn.classList.add("active"); }
    } catch (eKisi) { logLine("Senkron modülü yüklenemedi: " + (eKisi.message || eKisi)); }
    dictFill();
    if (state.dict.length) logLine("Sözlük: " + SZ.hotwords(state.dict));
    loadStyles();
    // stil seçici kaldırıldı — altyazı Premiere altyazı kanalına gidiyor
    if (state.styles.length) logLine(state.styles.length + " stil: " + state.styles.map(function (s) { return s.name; }).join(", "));
    try { cleanupOldTemp(); } catch (eTmp) {}            // eski geçici WAV'lar birikmesin
    try { refreshRangeOptions(); } catch (eRng) {}       // süre aralığı menüleri sekans uzunluğuna göre
    // Konuşmacı ayırma CPU'ya düşmüşse bunu görünür yap — sessizce 5-15 kat yavaşlıyordu
    /* ⚠ DİARİZASYON NOTU KALDIRILDI — OLMAYAN BİR SEKMEYE YOLLUYORDU.
       Konuşmacı ayırma ölçülüp kaldırıldı (trOpts `diarize: false` sabit gönderiyor) ve
       "Konuşmacıya Göre" sekmesi index.html'de artık yok. loadConfig varsayılanı "cpu"
       olduğu için bu not diarize-device.txt yazmamış HER kullanıcıda, her açılışta çıkıyor
       ve ikinci kullanıcı olmayan bir kutuyu arıyordu. */
    /* SIRA ÖNEMLİ: önce "kaydedilmiş oturum geri yüklensin mi", ANCAK ondan sonra güncelleme
       sorusu. İkisi aynı anda açılınca aynı modal kutusunu paylaşıyorlardı; ikinci soru
       birincinin yazısını eziyor ve tek tıklama ikisini birden cevaplıyordu (modal kuyruğu
       artık çakışmayı engelliyor, bu sıra da soruların mantıklı gelmesini sağlıyor). */
    /* LİSANS KAPISI EN ÖNDE: oturum geri yükleme ve güncelleme soruları modal kutusu
       açıyor; kilit ekranı onların ÜSTÜNDE (z-index 2000 > 1000) durduğu için soru
       görünmez bir yerde bekler ve kullanıcı "panel donmuş" sanırdı. Kilit açılana
       kadar hiçbir soru sorulmuyor. Lisans yoksa/hata varsa kapı zaten hemen açılıyor. */
    lisansKapisi().then(function () {
      /* ⚠ HAZIR İÇERİK BURADA KURULUR — KİLİT AÇILDIKTAN SONRA.
         Eskiden yalnız wirePreset() içinden çağrılıyordu; o da wirePersistence() üzerinden
         lisans kapısı çözülmeden SENKRON çalışıyor. Kilitliyken içerik dağıtılmasın diye
         oraya bir kontrol koymuştuk — doğru fikir, yanlış yer: ilk açılışta panel kilitli
         olduğu için fonksiyon geri dönüyor, kullanıcı kodu girip paneli açıyor ama
         varsayilanlariKur BİR DAHA ÇAĞRILMIYOR.
         GERÇEKTEN OLDU (ParsMazi, 7 Ağustos 2026): preset'ler, emoji resimleri ve Track
         Style'ların HİÇBİRİ kurulmadı; panel kendi sabit kart listesini gösterdiği için
         sorun "preset'ler eski gelmiş" gibi göründü ve gerçek sebep gizlendi.
         Buradaki çağrı wirePreset'tekini de kapsıyor (fonksiyon "varsa üzerine yazmaz",
         iki kez çağrılması zararsız). */
      try { varsayilanlariKur(); } catch (eVk) { logLine("Hazır içerik kurulamadı: " + (eVk.message || eVk)); }
      /* Kartlar hazır içerikten ÖNCE çizilmişti — yeni kurulan preset'lerle yeniden çiz,
         yoksa kullanıcı kayıt dolu olduğu hâlde boş/eksik kart görür. */
      try { if (typeof presetBtnlarCiz === "function") presetBtnlarCiz(); } catch (ePb) {}
      /* Emoji klasörü ayarı varsayilanlariKur içinde yazıldı; ekrandaki kutu ondan ÖNCE
         doldurulmuştu, tazele. */
      try {
        var eInp = $("emojiKlasor");
        if (eInp && !eInp.value) eInp.value = lsGet("emoji.klasor", "") || emojiKlasorVarsayilan();
      } catch (eEi) {}
      /* ⚠ EMOJİ TARAFI DA BURADA TAZELENMEK ZORUNDA — İKİ AYRI HATA BUNDAN DOĞUYORDU:
         Sıra şu: wirePreset/wireEmojiTest lisans kilitliyken çalışıyor, varsayilanlariKur
         ise ANCAK kod girildikten sonra bu blokta çalışıyor.
         1) Animasyon menüsü (#emojiPreset) preset'ler daha KURULMADAN dolduruluyordu —
            ikinci kullanıcının İLK oturumunda menüde "Emoji Sağ Taraf" hiç görünmüyordu ve
            paneli kapatıp açmadan kullanamıyordu.
         2) Emoji klasörü durum satırı, klasör HENÜZ YOKKEN okunuyordu → temiz kurulumda
            kırmızı "Klasör okunamadı" yazıyor, hemen ardından 46 resim kuruluyor ama satır
            güncellenmiyordu. Kullanıcı çalışan bir paneli bozuk sanıyordu. */
      try { wireEmojiPreset(true); } catch (eEp) {}
      try { emojiKlasorDurumYaz(); } catch (eEd) {}
      var oturumIsi;
      try { oturumIsi = offerSessionRestore(); } catch (eSes) {}
      return Promise.resolve(oturumIsi)["catch"](function () {});
    }).then(function () {
      // Oto-güncelleme (arka planda, sessiz — internet yoksa/başarısızsa paneli etkilemez)
      try {
        var updater = require(path.join(extRoot, "js", "updater.js"));
        updater.checkForUpdate(extRoot, {
          log: logLine,
          setStatus: function (t) { if (t) logLine(t); },
          confirm: uiConfirm,
          alert: uiAlert
        });
      } catch (eUpd) {}
    });
  }
  function initMock() {
    setPill("pillHost", false); setPill("pillGpu", true);
    // Önizlemede sozluk.js require edilemez — kutuyu örnekle doldur (kaydetme devre dışı)
    var ta = $("dictText");
    if (ta) ta.value = "Tofi: toffy, tofy, topi\nMoni: money, monny\nDora: dorra, tora\nMimi: mimmi, mimy\nNiko: nico, nikko";
    var db = $("dictBadge"); if (db) db.textContent = "5";
    state.styles = [{ name: "Tofi Text", path: "tofi" }, { name: "Moni Text", path: "moni" },
      { name: "Kırmızı", path: "kirmizi" }, { name: "Mavi", path: "mavi" }, { name: "Sarı", path: "sari" }, { name: "Yeşil", path: "yesil" }];
    // stil seçici kaldırıldı — altyazı Premiere altyazı kanalına gidiyor
  }

  // Select'leri kalıcılaştır + kaydedilmişi geri yükle (init sonrası — seçenekler dolmuş olur)
  /* ⚠ HER ADIM KENDİ try/catch'İNDE — BİRİ PATLARSA ÖTEKİLER BAĞLANMAYA DEVAM ETSİN.
     Eskiden hepsi tek bir blokta çalışıyordu ve initCEP ile AYNI try'ı paylaşıyordu:
     initCEP içindeki korumasız çağrılardan biri (require, loadConfig, dictFill, özellikle
     loadStyles → readdirSync, OneDrive senkron kilidinde EPERM verebiliyor) fırlarsa
     wirePersistence HİÇ çalışmıyordu. Panel normal GÖRÜNÜYOR çünkü HTML zaten çizili;
     sadece Preset/Emoji düğmeleri, Shorts/Vurucu kutuları ve Kaynak Ses hafızası hiçbir şey
     yapmıyor. Kullanıcı "panel bozuldu" diyor, tek iz gizli log'daki bir satır oluyordu.
     Aynı sebeple adımlar birbirinden de yalıtıldı: erken bir wire* hatası kendinden
     SONRAKİLERİ de öldürüyordu. */
  function _wire(ad, fn) {
    try { fn(); }
    catch (e) { if ($("log")) logLine("Bağlantı kurulamadı (" + ad + "): " + (e.message || e)); }
  }
  function wirePersistence() {
    // chapInterval artık gerçek bir <select> (index.html): YouTube bölüm aralığı da hatırlansın —
    // her panel açılışında varsayılana dönüp kullanıcıya tekrar seçtiriyordu.
    _wire("ayar hafızası", function () {
      var ids = ["acSens", "acMin", "selStyleSingle", "selStyleA1", "selIstif", "chapInterval"];
      for (var i = 0; i < ids.length; i++) { restoreSelect(ids[i]); persistSelect(ids[i]); }
      // AutoCut ayarları değişince ekranda duran analiz sonucu artık o ayara ait değil — sıfırla
      var acIds = ["acSens", "acMin"];
      for (var a = 0; a < acIds.length; a++) {
        var el = $(acIds[a]); if (el) el.addEventListener("change", acAnalizGecersiz);
      }
    });
    _wire("kaynak ses", restoreSegs);
    // Shorts kutusu restoreSegs'ten SONRA: mod geri yüklendikten sonra kısıtı uygulamalı
    // (kayıtlı mod "speaker" ve Shorts açıksa Tek Stil'e geçirilir).
    _wire("Shorts", wireShorts);
    /* Vurucu mod ve API anahtarı: VUR modülü initCEP'te yükleniyor, o yüzden bunlar ondan
       SONRA bağlanmalı — anahtar durumu notu VUR.anahtarVarMi'ye bakıyor. */
    _wire("vurucu mod", wireVurucu);
    // Çakışma kutusu vurucunun hemen yanında: ikisi de aynı karttaki altyazı davranış kutuları.
    _wire("çakışma kutusu", wireCakisma);
    _wire("API anahtarı", wireApiKey);
    _wire("preset kartı", wirePreset);
    _wire("stil aktarma", wireStilProje);
    _wire("emoji testi", wireEmojiTest);
    _wire("kanal tarama", function () {
      if ($("btnKanalTara")) $("btnKanalTara").addEventListener("click", function () { scanChannels(); });
    });
  }

  try { if (CEP) initCEP(); else initMock(); }
  catch (e) { setPill("pillHost", false); if ($("log")) logLine("Init hatası: " + (e.message || e)); }
  // AYRI try: init patlasa bile düğmeler bağlanmaya çalışılsın (bkz. _wire notu).
  try { wirePersistence(); }
  catch (e2) { if ($("log")) logLine("Bağlantı kurulumu hatası: " + (e2.message || e2)); }
})();
