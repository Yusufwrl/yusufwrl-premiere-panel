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
    singleCues: [], a1Cues: [], a2Cues: [], speakers: [], singleStyle: "",
    dict: [], dictMap: null,     // karakter isimleri sözlüğü (Tofi/Moni/…) + arama tablosu
    channels: [],                // "ayrı kanal" modu: her ses kanalı bir kişi
    kanalTarandi: false,         // "Kanalları Tara" çalıştı mı (boş sonuç ile hiç taranmamışı ayırmak için)
    kisiler: [] };               // Discord adı -> karakter + renk (Senkron kartı)

  function $(id) { return document.getElementById(id); }
  // Turkce kucuk harf: duz toLowerCase "I"->"i" verir; Turkcede I->i, İ->i olmali.
  // Stil adi eslesmesinde onemli: "MİMİ.mogrt" duz toLowerCase ile "mi̇mi̇" olur ve renk tutmaz.
  function trLower(s) { return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase(); }
  // Ayar kalıcılığı (localStorage) — panel her açılışta son ayarları hatırlar.
  function lsGet(k, d) { try { var v = localStorage.getItem("yw." + k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem("yw." + k, v); } catch (e) {} }
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
  function evalES(code) { return new Promise(function (res) { if (!cs) { res('{"error":"no_cep"}'); return; } cs.evalScript(code, function (r) { res(r); }); }); }
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

  // ---------- mod ve track ----------
  var modeBtns = document.querySelectorAll("#segMode .seg-btn");
  for (var i = 0; i < modeBtns.length; i++) modeBtns[i].addEventListener("click", function (ev) {
    document.querySelector("#segMode .seg-btn.active").classList.remove("active");
    this.classList.add("active"); state.mode = this.dataset.mode; lsSet("mode", state.mode);
    modGorunumUygula();
    /* "Konuşmacıya Göre"ye İLK KEZ geçildiğinde kanalları kendiliğinden tara — kullanıcı
       "Kanalları Tara" adımını atlayıp doğrudan "Altyazı Oluştur"a basınca hata alıyordu.
       Yalnız GERÇEK tıklamada (ev.isTrusted): restoreSegs() açılışta bu düğmeyi programla
       tıklıyor ve o sırada başlayan tarama, geri yüklenen oturumla yarışıyordu. */
    if (ev && ev.isTrusted && state.mode === "speaker" && CEP && !state.running && !state.kanalTarandi) {
      // scanChannels async: hata FIRLATMAZ, promise'i reddeder — düz try/catch onu yakalayamaz.
      try { var pTara = scanChannels(); if (pTara && pTara["catch"]) pTara["catch"](function () {}); } catch (eTara) {}
    }
  });
  // Sekmelerin görünürlüğü tek yerden: üretim bitince (btnRun finally) de yeniden uygulanır.
  function modGorunumUygula() {
    var isRecolor = (state.mode === "recolor");
    /* İlerleme çubuğu ve "✕ İptal" butonu #genArea'nın İÇİNDE. Renk Değiştir sekmesine
       geçince tamamen kayboluyordu; kullanıcı iş durdu sanıp Premiere'i kapatıyor ve
       20 dakikalık üretimi öldürüyordu. İş sürerken üretim alanı görünür kalır. */
    $("genArea").hidden = isRecolor && !state.running;
    $("panelRecolor").hidden = !isRecolor;
    $("panelSingle").hidden = (state.mode !== "single");
    $("panelSpeaker").hidden = (state.mode !== "speaker");
    if (isRecolor) refreshRecolorBtns();
    if (!isRecolor || state.running) {
      // Cue'ları üreten moda dönerken transkript/sonuç kartını koru (ör. renk sekmesine gidip
      // gelince kaybolmasın); farklı üretim moduna geçişte gizle.
      // "channels" genMode'u "Konuşmacıya Göre" sekmesinde üretiliyor; sekme adıyla birebir
      // eşleşmediği için sonuç kartı ve "Timeline'a Ekle" butonu haksız yere gizleniyordu.
      var uretimSekmesi = (state.genMode === "channels") ? "speaker" : state.genMode;
      var hasCur = allCues().length;
      var keep = (uretimSekmesi === state.mode) && hasCur;
      $("result").hidden = !keep;
      $("speakerMap").hidden = !(keep && state.mode === "speaker" && state.speakers.length);
    }
  }
  var trackBtns = document.querySelectorAll("#segTrack .seg-btn");
  for (var j = 0; j < trackBtns.length; j++) trackBtns[j].addEventListener("click", function () {
    document.querySelector("#segTrack .seg-btn.active").classList.remove("active");
    this.classList.add("active"); state.track = this.dataset.track; lsSet("track", state.track);
  });
  // Kaydedilmiş mod/track'i geri yükle (buton tıklaması ile — panelleri de senkronlar)
  function restoreSegs() {
    var sm = lsGet("mode", null); if (sm) { var bm = document.querySelector('#segMode .seg-btn[data-mode="' + sm + '"]'); if (bm) bm.click(); }
    var st = lsGet("track", null); if (st) { var bt = document.querySelector('#segTrack .seg-btn[data-track="' + st + '"]'); if (bt) bt.click(); }
  }

  // ---------- kart menüsü navigasyonu ----------
  function goView(name) {
    var all = document.querySelectorAll(".view");
    for (var i = 0; i < all.length; i++) { all[i].classList.remove("active"); all[i].setAttribute("hidden", ""); }
    var id = name === "altyazi" ? "viewAltyazi" : name === "autocut" ? "viewAutocut"
           : name === "senkron" ? "viewSenkron" : "viewHome";
    var el = $(id); el.removeAttribute("hidden"); el.classList.add("active");
    $("backBtn").hidden = (id === "viewHome");
    var c = document.querySelector(".content"); if (c) c.scrollTop = 0;
    // Süre aralığı menüleri aktif sekansın uzunluğuna göre — sekans değişmiş olabilir
    if (name === "altyazi") { try { refreshRangeOptions(); } catch (e) {} }
  }
  var toolCards = document.querySelectorAll(".tool-card");
  for (var tcx = 0; tcx < toolCards.length; tcx++) toolCards[tcx].addEventListener("click", function () { goView(this.dataset.view); });
  $("backBtn").addEventListener("click", function () { goView("home"); });

  // ---------- stiller ----------
  function fillStyleOptions(sel, includeCaption) {
    sel.innerHTML = "";
    // "caption" kelimesi kullanıcıya hiçbir şey anlatmıyordu; bu seçenek MOGRT/renk KULLANMAZ,
    // altyazıyı Premiere'in kendi altyazı (caption) kanalına döker. Etiket bunu yazsın.
    if (includeCaption) { var o = document.createElement("option"); o.value = ""; o.textContent = "Renksiz düz altyazı (Premiere altyazı kanalı)"; sel.appendChild(o); }
    state.styles.forEach(function (s) { var op = document.createElement("option"); op.value = s.path; op.textContent = s.name; sel.appendChild(op); });
  }
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
      var listeler = [state.singleCues, state.a1Cues, state.a2Cues];
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
  function trOpts(extra) {
    /* Model ve sansür artık panelde seçilmiyor: her zaman en doğru model (config.json'daki
       large-v3) ve tam sansür kullanılır. Seçenek sunmak fayda getirmiyordu — hızlı model
       Türkçe'de belirgin kötü, sansürü kapatmak da YouTube için istenmiyor. */
    var o = { model: cfg.model || "large-v3", language: cfg.language, diarize: false,
      censor: "all",
      hotwords: SZ ? SZ.hotwords(state.dict) : "", dictMap: state.dictMap };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  function renderSpeakerMap() {
    var box = $("speakerRows"); box.innerHTML = "";
    state.speakers.forEach(function (sp, i) {
      var row = document.createElement("div"); row.className = "sp-row";
      var dot = document.createElement("div"); dot.className = "sp-dot"; dot.style.background = speakerColor(i); row.appendChild(dot);
      var info = document.createElement("div"); info.className = "sp-info";
      var nm = document.createElement("div"); nm.className = "sp-name"; nm.textContent = "Konuşmacı " + (i + 1);
      if (sp.start != null) {
        var jt = document.createElement("span"); jt.className = "sp-jump";
        jt.textContent = " ▶ " + fmtShort(sp.start);
        jt.title = "İlk konuştuğu ana git (Premiere)";
        (function (sec) { jt.addEventListener("click", function () { evalES("seekTo(" + sec + ")"); }); })(sp.start);
        nm.appendChild(jt);
      }
      var sm = document.createElement("div"); sm.className = "sp-sample"; sm.textContent = "\"" + (sp.sample || "") + "\"";
      info.appendChild(nm); info.appendChild(sm); row.appendChild(info);
      var wrap = document.createElement("div"); wrap.className = "select sm";
      var sel = document.createElement("select"); fillStyleOptions(sel, false);
      if (!preselect(sel, "moni")) preselect(sel, "");
      sp.styleSel = sel; wrap.appendChild(sel); row.appendChild(wrap);
      box.appendChild(row);
    });
    $("speakerMap").hidden = state.speakers.length === 0;
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
    s1.value = eskiS; s2.value = eskiE;   // seçim korunsun (yoksa boşa döner)
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
  /* "A1+A2" (eski adıyla Mix): konuşma kanallarını TEK wav'da birleştirir — A3 oyun sesidir,
     dahil edilmez. Eskiden bu seçenekte sessizce sadece A1 yazıya dökülüyordu; arkadaşların
     altyazıya hiç girmiyordu ve uyarı da çıkmıyordu. Kanallardan biri yoksa diğeriyle devam edilir.
     NOT: kullanıcıya görünen her metin index.html'deki düğme etiketiyle ("A1+A2") aynı olmalı —
     "Mix" diye bir düğme artık yok, panel var olmayan bir düğmeyi tarif ediyordu. */
  async function prepAudioMix(name) {
    var range = getRange(), stamp = Date.now();
    var parts = [], cleanup = [], bulunan = [], mixEnd = 0;
    // try/catch TÜM kanal işlemini sarmalı: bir kanalın ffmpeg hatası diğerini düşürmemeli.
    for (var t = 0; t < 2; t++) {
      try {
        var data = await getClips(t);
        var used = clipsInRange(data.clips, range);
        if (!used.length) { logLine("A1+A2: A" + (t + 1) + " seçilen aralıkta boş."); continue; }
        var w = path.join(cfg.workDir, name + "_mix" + t + "_" + stamp + ".wav");
        await pipeline.buildTimelineAudio(used, cfg.ffmpegExe, w, logLine, t);
        parts.push(w); cleanup.push(w); bulunan.push("A" + (t + 1));
        var ke = clipsEnd(used); if (ke > mixEnd) mixEnd = ke;
      } catch (e) { logLine("A1+A2: A" + (t + 1) + " atlandı (" + friendlyError(e) + ")"); }
    }
    // Hata metni düğme etiketiyle aynı adı kullanır ("A1+A2"); "Mix" adlı bir düğme yok.
    if (!parts.length) { cleanupFiles(cleanup); throw new Error("“A1+A2” seçili ama A1 ve A2 kanallarında konuşma bulunamadı."); }
    logLine("A1+A2: " + bulunan.join(" + ") + " birleştirildi");
    var wav = path.join(cfg.workDir, name + "_mix_" + stamp + ".wav");
    // Bundan sonraki her hatada üretilmiş WAV'lar temizlenir (yoksa work klasöründe sızar)
    try {
      await pipeline.mixWavs(parts, cfg.ffmpegExe, wav);
      cleanup.push(wav);
      if (!range) return { wav: wav, offset: 0, cleanup: cleanup, dur: mixEnd };
      var wav2 = path.join(cfg.workDir, name + "_mixr_" + stamp + ".wav");
      await pipeline.trimWav(wav, wav2, range.start, range.end, cfg.ffmpegExe);
      cleanup.push(wav2);
    } catch (eMix) { cleanupFiles(cleanup); throw eMix; }
    logLine("[aralık] " + fmtShort(range.start) + (isFinite(range.end) ? " → " + fmtShort(range.end) : " → son"));
    return { wav: wav2, offset: range.start, cleanup: cleanup, dur: Math.max(0, Math.min(mixEnd, range.end) - range.start) };
  }
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
    var isMix = (state.track === "mix");
    setProgress(8, "Sekans okunuyor…");
    pipeline.ensureDir(cfg.workDir);
    var prep;
    if (isMix) {
      setProgress(20, "Ses hazırlanıyor (A1 + A2)…");
      prep = await prepAudioMix("single");
    } else {
      var trackIdx = parseInt(state.track, 10);
      var data = await getClips(trackIdx);
      logLine(data.sequenceName + " · " + data.clips.length + " klip");
      setProgress(20, "Ses hazırlanıyor…");
      prep = await prepAudio(data.clips, trackIdx, "single");
    }
    setProgress(45, "Yazıya dökülüyor (GPU)…");
    _pg.transT0 = Date.now(); _pg.totalSec = prep.dur || 0;
    var cues = await pipeline.transcribe(cfg, prep.wav, function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, 45, 95); }, trOpts());
    offsetCues(cues, prep.offset);
    cleanupFiles(prep.cleanup);
    state.singleCues = cues; state.a1Cues = []; state.a2Cues = []; state.speakers = []; $("speakerMap").hidden = true;
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
  // list = [{idx, clips, style?, cues?}] — taramadan ya da kaydedilmiş oturumdan gelir
  function renderChannelMap(list, videoTracks) {
    var box = $("kanalRows"); if (!box) return;
    /* Üretilmiş altyazıları KORU. Yeniden tarama (ya da kutuyu kapatıp açma) sadece kanal
       listesini ve stilleri tazelemeli; 30 dakikalık işlemin sonucunu silmemeli. Tarama
       verisinde cues alanı olmadığı için önceki cue'lar kanal numarasına göre geri bağlanır. */
    var eski = {};
    state.channels.forEach(function (c) {
      if (c.cues && c.cues.length) eski[c.idx] = { cues: c.cues, style: c.styleSel ? c.styleSel.value : "" };
    });
    box.innerHTML = ""; state.channels = [];
    var uyari = $("kanalUyari");
    // A1 = sen; arkadaş kanalları A2'den başlar ve içinde klip olmalı
    var dolu = list.filter(function (t) { return t.idx >= 1 && t.clips > 0; });
    if (!dolu.length) {
      box.innerHTML = '<p class="note" style="margin:0;color:var(--warn)">A2 ve sonrasında ses klibi yok. ' +
        'Arkadaşların seslerini ayrı ayrı A2, A3, A4… kanallarına yerleştir.</p>';
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
      chk.checked = (t.aktif != null) ? !!t.aktif : (lsGet("kanalAktif." + t.idx, "1") === "1");
      (function (ix, c, r) {
        function yansit() { if (c.checked) r.classList.remove("kanal-pasif"); else r.classList.add("kanal-pasif"); }
        c.addEventListener("change", function () { lsSet("kanalAktif." + ix, c.checked ? "1" : "0"); yansit(); });
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
      (function (ix, el) { el.addEventListener("change", function () { lsSet("kanalAd." + ix, el.value.trim()); }); })(t.idx, adInp);
      var sm = document.createElement("div"); sm.className = "sp-sample";
      sm.textContent = "A" + (t.idx + 1) + " · " + t.clips + " klip" +
        (onceki && onceki.cues.length ? (" · " + onceki.cues.length + " altyazı hazır") : "");
      info.appendChild(adInp); info.appendChild(sm); row.appendChild(info);

      var wrap = document.createElement("div"); wrap.className = "select sm";
      var sel = document.createElement("select"); fillStyleOptions(sel, false);
      if (sel.options.length) sel.selectedIndex = Math.min(i + 1, sel.options.length - 1);   // farklı renk öner
      var secilecek = t.style || (onceki && onceki.style) || "";
      if (secilecek) { for (var q = 0; q < sel.options.length; q++) if (sel.options[q].value === secilecek) { sel.value = secilecek; break; } }
      wrap.appendChild(sel); row.appendChild(wrap);
      box.appendChild(row);
      state.channels.push({ idx: t.idx, clips: t.clips, styleSel: sel, aktifChk: chk, adInput: adInp,
                            renk: renk, cues: t.cues || (onceki ? onceki.cues : []) });
    });
    /* Video kanalı bütçesi: en alt kanal senin görüntün, üstündeki bir kanal A1 altyazısı,
       bir kanal da arkadaşlar için gerekli → en az 3. Üst üste konuşma varsa her ek katman
       bir kanal daha ister. Yetmezse yerleştirme katmanı kırpar (silme yapmaz) ama ekranda
       altyazılar üst üste binebilir. */
    if (uyari) {
      if (videoTracks && videoTracks < 3) {
        uyari.hidden = false; uyari.style.color = "var(--warn)";
        uyari.textContent = "⚠ Sekansta " + videoTracks + " video kanalı var; rahat çalışmak için en az 3 gerekir " +
          "(görüntü + senin altyazın + arkadaşlar). Üst üste konuşma varsa daha fazlası gerekir. " +
          "Premiere'de video kanalı eklemen önerilir.";
      } else uyari.hidden = true;
    }
  }
  // Kanalin gorunen adi: kullanici isim yazdiysa o, yoksa "A4"
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
        ? "A2 ve sonrasındaki kanallarda ses klibi yok. Bu mod her arkadaşın AYRI kanalda olmasını ister; " +
          // Düğmenin GERÇEK etiketi "A1+A2" (index.html). "Mix" yazınca kullanıcı olmayan bir
          // düğmeyi arıyor ve panelin bozuk olduğunu sanıyordu.
          "tek karışık kanalın varsa “Tek Stil” sekmesinde Kaynak Ses'i “A1+A2” yap."
        : "Önce “Kanalları Tara” butonuna bas ve kanallara stil ata.");
    }
    var islenecek = aktifKanallar();
    if (!islenecek.length) throw new Error("Hiç kanal seçilmedi. Arkadaşların bulunduğu kanalları işaretle.");

    state.genMode = "channels";
    state.singleCues = []; state.a2Cues = []; state.speakers = []; $("speakerMap").hidden = true;
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
        singleCues: state.singleCues, a1Cues: state.a1Cues, a2Cues: state.a2Cues,
        speakers: state.speakers.map(function (s) {
          return { id: s.id, sample: s.sample, start: s.start, style: s.styleSel ? s.styleSel.value : "" };
        }),
        channels: state.channels.map(function (c) {
          return { idx: c.idx, clips: c.clips, style: c.styleSel ? c.styleSel.value : "",
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
  async function saveSessionAuto() {
    if (!CEP || !cfg) return;
    try {
      var d = await getClips(0);
      _oturum.name = d.sequenceName; _oturum.end = clipsEnd(d.clips);
      saveSession();
      logLine("Oturum kaydedildi — panel kapansa da liste durur.");
    } catch (e) {}
  }
  function restoreSession(o) {
    state.genMode = o.genMode || "single";
    state.singleCues = o.singleCues || [];
    state.a1Cues = o.a1Cues || [];
    state.a2Cues = o.a2Cues || [];
    state.speakers = []; state.channels = [];
    if (state.genMode === "channels" && (o.channels || []).length) {
      renderChannelMap(o.channels, 0);   // 0 = bilinmiyor; sahte değer uyarıyı kalıcı bastırıyordu
      state.kanalTarandi = true;         // liste dolu geldi; "önce tara" demeye gerek yok
    } else if (state.genMode === "speaker" && (o.speakers || []).length) {
      state.speakers = o.speakers.map(function (s) { return { id: s.id, sample: s.sample, start: s.start }; });
      renderSpeakerMap();
      for (var i = 0; i < state.speakers.length; i++) {
        var st = o.speakers[i] && o.speakers[i].style, sel = state.speakers[i].styleSel;
        if (st && sel) { for (var q = 0; q < sel.options.length; q++) if (sel.options[q].value === st) { sel.value = st; break; } }
      }
    }
    redrawTranscript();
    var hedef = (state.genMode === "single") ? "single" : "speaker";
    var btn = document.querySelector('#segMode .seg-btn[data-mode="' + hedef + '"]');
    if (btn && state.mode !== hedef) btn.click();
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
  function stilAdlariSatiri() {
    var adlar = [], gorulen = {};
    (state.styles || []).forEach(function (s) {
      var n = String(s.name || "").trim();
      if (n && !gorulen[n.toLowerCase()]) { gorulen[n.toLowerCase()] = 1; adlar.push(n.replace(/\|/g, " ")); }
    });
    return adlar.length ? ("#STILLER|" + adlar.join("|") + "\n") : "";
  }

  function writeCuesMulti(lines) {
    var body = stilAdlariSatiri() + lines.map(function (l) {
      return l.start.toFixed(3) + "|" + l.end.toFixed(3) + "|" + l.mogrt + "|" + String(l.text).replace(/[\r\n|]/g, " ");
    }).join("\n");
    var file = path.join(cfg.workDir, "mcues_" + Date.now() + "_" + (fileCounter++) + ".txt");
    fs.writeFileSync(file, body, "utf8");
    return file;
  }
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
    progressDone("Bitti — " + msg);
  }

  // Timeline'a yerleştirir; ham sonuç metnini döndürür (null = iptal, zaten uyarıldı).
  /* KAÇ VİDEO KANALI GEREKİYOR?
     host tarafında altyazının gittiği kanal  idx = (videoKanalSayısı - 1) - lane.
     En alttaki kanal (idx 0) kullanıcının GÖRÜNTÜSÜ ve asla kullanılmamalı, yani idx >= 1:
        (vt - 1) - enUstLane >= 1   =>   vt >= enUstLane + 2
     Sayı okunamazsa yerleştirme YAPILMAZ: yanlış tahminin bedeli, silinen görüntü.
     Dönüş: kanal sayısı (yeterliyse) ya da 0 (yetersiz — kullanıcı zaten uyarıldı). */
  async function videoKanaliYeterMi(enUstLane, modAdi) {
    var vt = 0;
    try { vt = (JSON.parse(await evalES("getAudioTracksJSON()")) || {}).videoTracks || 0; } catch (e) { vt = 0; }
    if (!vt) {
      uiAlert("Sekansın video kanalı sayısı okunamadı; güvenli olsun diye hiçbir şey eklenmedi.\n\n" +
              "Premiere'de sekansın açık olduğundan emin olup tekrar dene.", "Altyazı");
      return 0;
    }
    var gereken = enUstLane + 2;
    if (vt < gereken) {
      uiAlert(modAdi + " için en az " + gereken + " video kanalı gerekiyor, sekansta " + vt + " tane var.\n\n" +
              "Premiere'de zaman çizelgesinde bir video kanalının başlığına sağ tıkla → “Tek Kanal Ekle” " +
              "ile " + (gereken - vt) + " tane ekle, sonra tekrar dene.\n\n" +
              "(En alttaki kanal senin görüntün — altyazı oraya konursa görüntü silinir, o yüzden durduruldu.)",
              "Video kanalı yetersiz");
      return 0;
    }
    return vt;
  }

  async function placeSingle(range) {
    var stylePath = $("selStyleSingle").value;
    if (stylePath) state.singleStyle = stylePath;   // son gerçek stili hatırla (renk değiştirmede komşu cue'lar için yedek)
    var cues = range ? state.singleCues.filter(function (c) { return c.end > range.start && c.start < range.end; }) : state.singleCues;
    if (!cues.length) { uiAlert("Önce altyazı oluştur."); return null; }
    // Herhangi bir cue renk override taşıyorsa (renk değiştirme), "Düz altyazı" seçili olsa bile
    // MOGRT yolunu kullan — override yok sayılıp caption track dökülmesin.
    var hasOv = false; for (var oi = 0; oi < cues.length; oi++) { if (cues[oi]._ovMogrt) { hasOv = true; break; } }
    if (stylePath || hasOv) {
      // MOGRT altyazı bir video kanalı tüketir (lane 0) — en az 2 kanal gerekir.
      if (!(await videoKanaliYeterMi(0, "Altyazı"))) return null;
      var fb = stylePath || state.singleStyle || (state.styles[0] && state.styles[0].path) || "";   // override'sız komşulara stil
      var file = writeCuesMulti(cues.map(function (c) { return { start: c.start, end: c.end, mogrt: (c._ovMogrt || fb), text: c.text }; }));
      return await evalES('addMultiStyleSubtitles("' + esPath(file) + '",-1)');
    }
    var srtFile = path.join(cfg.workDir, "cap_" + Date.now() + ".srt");
    fs.writeFileSync(srtFile, pipeline.cuesToSrt(cues), "utf8");
    return await evalES('addCaptionsToTimeline("' + esPath(srtFile) + '")');
  }
  async function placeSpeaker(range) {
    var a1Style = $("selStyleA1").value;
    var spStyle = {}; state.speakers.forEach(function (sp) { spStyle[sp.id] = sp.styleSel.value; });
    var _gap = 130;   // istifleme sabit: A1 ile çakışan A2 altyazısı 130px yukarı kayar

    // A1 lane 0 + A2 lane 1 => en üst lane 1 => en az 3 video kanalı gerekir.
    if (!(await videoKanaliYeterMi(1, "Konuşmacıya göre altyazı"))) return null;

    // Yerleştirilecek A1 aralıkları — A2'nin A1 ile üst üste GELİP GELMEDİĞİNİ bulmak için.
    var a1Iv = [];
    state.a1Cues.forEach(function (c) { if (c._ovMogrt || a1Style) a1Iv.push([c.start, c.end]); });
    function overlapsA1(s, e) { for (var i = 0; i < a1Iv.length; i++) { if (a1Iv[i][0] < e && a1Iv[i][1] > s) return true; } return false; }

    // A1 = üst track (lane 0), kayma 0. A2 = alt track (lane 1), istifleme moduna göre kayar.
    var kayma = stackShifter(overlapsA1, _gap);
    var combined = [];
    state.a1Cues.forEach(function (c) { var mg = c._ovMogrt || a1Style; if (mg) combined.push({ start: c.start, end: c.end, mogrt: mg, text: c.text, lane: 0, shift: 0 }); });
    // İkinci koruma katmanı: stili bulunamayan A2 satırı sessizce DÜŞMESİN — ilk atanmış stile düşer.
    var yedekSp = "";
    for (var sk in spStyle) { if (spStyle.hasOwnProperty(sk) && spStyle[sk]) { yedekSp = spStyle[sk]; break; } }
    if (!yedekSp) yedekSp = a1Style || state.singleStyle || (state.styles[0] && state.styles[0].path) || "";
    var yedekli = 0;
    state.a2Cues.forEach(function (c) {
      var mg = c._ovMogrt || spStyle[c.speaker];
      if (!mg && yedekSp) { mg = yedekSp; yedekli++; }
      if (mg) combined.push({ start: c.start, end: c.end, mogrt: mg, text: c.text, lane: 1, shift: kayma(c.start, c.end) });
    });
    if (yedekli) logLine("UYARI: " + yedekli + " A2 satırına stil atanmamıştı, yedek stille eklendi.");
    if (range) combined = combined.filter(function (c) { return c.end > range.start && c.start < range.end; });
    if (!combined.length) { uiAlert("Stil atanmadı."); return null; }

    combined.sort(function (a, b) { return a.start - b.start; });
    var body = stilAdlariSatiri() + combined.map(function (c) {
      return c.start.toFixed(3) + "|" + c.end.toFixed(3) + "|" + c.mogrt + "|" + c.lane + "|" + c.shift + "|" + String(c.text).replace(/[\r\n|]/g, " ");
    }).join("\n");
    var file = path.join(cfg.workDir, "laned_" + Date.now() + ".txt");
    fs.writeFileSync(file, body, "utf8");
    logLine(combined.length + " altyazı · A1 üst / A2 alt (çakışanlar istiflenir)");
    return await evalES('addLanedSubtitles("' + esPath(file) + '")');
  }

  /* Ayrı kanal modunda yerleştirme. A1 = katman 0 (taban). Arkadaşlar katman 1'den başlar;
     AYNI ANDA konuşan arkadaşlar birbirinin üstüne binmesin diye çakışanlara ayrı katman
     verilir (greedy). Çakışma yoksa hepsi tek katmanda kalır — gereksiz video kanalı tüketilmez. */
  async function placeChannels(range) {
    var a1Style = $("selStyleA1").value, _gap = 130;
    var a1Iv = [];
    state.a1Cues.forEach(function (c) { if (c._ovMogrt || a1Style) a1Iv.push([c.start, c.end]); });
    function overlapsA1(s, e) { for (var i = 0; i < a1Iv.length; i++) { if (a1Iv[i][0] < e && a1Iv[i][1] > s) return true; } return false; }

    var arkadas = [];
    aktifKanallar().forEach(function (ch) {
      var st = ch.styleSel ? ch.styleSel.value : "";
      ch.cues.forEach(function (c) {
        var mg = c._ovMogrt || st;
        if (mg) arkadas.push({ start: c.start, end: c.end, mogrt: mg, text: c.text });
      });
    });
    arkadas.sort(function (a, b) { return a.start - b.start; });

    // Çakışanlara ayrı katman (greedy interval coloring)
    var katmanSon = [];
    arkadas.forEach(function (it) {
      var L = 0;
      while (L < katmanSon.length && katmanSon[L] > it.start + 0.001) L++;
      katmanSon[L] = it.end; it.kat = L;
    });

    /* KATMAN BÜTÇESİ — her katman bir video kanalı tüketir. host tarafı taşan lane'i 0'a
       kelepçeliyor (addLanedSubtitles: idx2 = top - lane, idx2<0 ise 0) ve o kanaldaki
       zaman aralığına denk gelen TÜM klipleri siliyor — yani senin GÖRÜNTÜN silinebilir.
       Bu yüzden katman sayısı sekanstaki video kanalıyla sınırlanır: fazla çakışanlar aynı
       katmanda kalır (ekranda üst üste binebilir ama hiçbir şey silinmez). */
    var maxKat = 0;
    for (var mk = 0; mk < arkadas.length; mk++) if (arkadas[mk].kat > maxKat) maxKat = arkadas[mk].kat;
    /* En az lane 1 kullanılacak (arkadaş lane = 1 + kat) => en az 3 video kanalı şart.
       Yetmezse ya da sayı okunamazsa HİÇ yerleştirme yapma: eskiden bu durumda kelepçe
       hesabı (vt-3) negatife düşüp 0 oluyor, arkadaşlar yine lane 1'e gidiyor ve host
       idx 0'a — yani kullanıcının görüntü kanalına — basıp oradaki klipleri siliyordu. */
    var vt = await videoKanaliYeterMi(1, "Konuşmacıya Göre modu");
    if (!vt) return null;
    {
      var izin = vt - 3;   // arkadaş lane = 1+kat, idx = (vt-1)-(1+kat) >= 1  =>  kat <= vt-3
      if (maxKat > izin) {
        var kirpilan = 0;
        for (var k3 = 0; k3 < arkadas.length; k3++) if (arkadas[k3].kat > izin) { arkadas[k3].kat = izin; kirpilan++; }
        logLine("UYARI: sekansta " + vt + " video kanalı var, " + (3 + maxKat) + " gerekiyordu. " +
                kirpilan + " altyazı aynı katmana alındı (üst üste gelebilir). Video kanalı eklersen düzelir.");
        maxKat = izin;
      }
    }
    var kayma = stackShifter(overlapsA1, _gap);
    var combined = [];
    state.a1Cues.forEach(function (c) {
      var mg = c._ovMogrt || a1Style;
      if (mg) combined.push({ start: c.start, end: c.end, mogrt: mg, text: c.text, lane: 0, shift: 0 });
    });
    arkadas.forEach(function (it) {
      combined.push({ start: it.start, end: it.end, mogrt: it.mogrt, text: it.text,
        lane: 1 + it.kat, shift: kayma(it.start, it.end) + it.kat * _gap });
    });
    if (range) combined = combined.filter(function (c) { return c.end > range.start && c.start < range.end; });
    if (!combined.length) { uiAlert("Stil atanmadı."); return null; }
    combined.sort(function (a, b) { return a.start - b.start; });

    var body = stilAdlariSatiri() + combined.map(function (c) {
      return c.start.toFixed(3) + "|" + c.end.toFixed(3) + "|" + c.mogrt + "|" + c.lane + "|" + c.shift + "|" + String(c.text).replace(/[\r\n|]/g, " ");
    }).join("\n");
    var file = path.join(cfg.workDir, "chan_" + Date.now() + ".txt");
    fs.writeFileSync(file, body, "utf8");
    logLine(combined.length + " altyazı · " + (arkadas.length ? (2 + maxKat) : 1) + " katman (üst üste konuşma: " + (maxKat ? "var" : "yok") + ")");
    return await evalES('addLanedSubtitles("' + esPath(file) + '")');
  }

  /* İSTİFLEME — arkadaşın altyazısı ne zaman yukarı kaysın?
     Bir denemede kayma kararı "konuşma serisi" başına verilmişti (zıplamayı azaltmak için);
     ama seride TEK bir çakışma tüm seriyi yukarıda tutuyordu ve sen konuşmadığın hâlde altyazı
     gereksiz yere yukarıda kalıyordu. Ölçüm: 0.6 sn'lik yayılma bile 600 satırda 104 gereksiz
     kayma üretiyor. Bu yüzden varsayılan davranış GERÇEK çakışma — yayılma yok.
       "overlap" : sadece ikiniz aynı anda konuşurken kayar (varsayılan)
       "off"     : hiç kaymaz (çakışırsa üst üste binebilir)
       "always"  : arkadaşlar hep yukarıda (tutarlı konum, hiç zıplama yok) */
  function stackShifter(overlapFn, gap) {
    var mod = String(($("selIstif") && $("selIstif").value) || "overlap");
    if (mod === "off") return function () { return 0; };
    if (mod === "always") return function () { return gap; };
    return function (s, e) { return overlapFn(s, e) ? gap : 0; };
  }

  // Aktif üretim moduna göre doğru yerleştiriciyi seçer
  function placeCurrent(range) {
    if (state.genMode === "channels") return placeChannels(range);
    if (state.genMode === "speaker") return placeSpeaker(range);
    return placeSingle(range);
  }
  // Aktif moddaki tüm cue'lar (renk değiştirme ve dışa aktarma için tek liste)
  function allCues() {
    if (state.genMode === "channels") {
      var out = state.a1Cues.slice();
      aktifKanallar().forEach(function (ch) { out = out.concat(ch.cues); });
      return out;
    }
    if (state.genMode === "speaker") return state.a1Cues.concat(state.a2Cues);
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
    var btn = this; btn.disabled = true; $("result").hidden = true; $("speakerMap").hidden = true;
    // Üretim sürerken kanal listesi yenilenemez (biten kanalların altyazıları kaybolur)
    var kt = $("btnKanalTara"); if (kt) kt.disabled = true;
    $("log").textContent = ""; progressReset("Başlıyor…");
    $("btnCancel").hidden = false;
    try {
      if (!CEP) await runMock();
      else if (state.mode === "speaker") await runChannels();
      else await runSingle();
    }
    catch (e) {
      if (state.cancelled) progressFail("İptal edildi", "warn");
      else { progressFail("❌ " + friendlyError(e), "bad"); logLine("HATA: " + (e.message || e)); }
    }
    finally {
      state.running = false; btn.disabled = false; $("btnCancel").hidden = true;
      if (kt) kt.disabled = false;
      var sonEtiket = $("progressLabel").textContent, sonRenk = $("progressLabel").style.color;
      modGorunumUygula();
      /* Renk Değiştir sekmesindeyken iş bittiyse üretim alanı yeniden gizleniyor; son durumu
         bu sekmenin kendi durum satırına taşı — yoksa "Bitti" mesajı hiç görünmeden yok olur.
         (modGorunumUygula -> refreshRecolorBtns bu satırı gizlediği için SONRA yazılmalı.) */
      if (state.mode === "recolor") {
        var rs = $("recolorStatus");
        if (rs) { rs.hidden = false; rs.textContent = sonEtiket; rs.style.color = sonRenk || ""; }
      }
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
  function styleColor(name, i) {
    var n = trLower(name);
    for (var s in _STYLE_COLORS) { if (_STYLE_COLORS.hasOwnProperty(s) && n.indexOf(s) >= 0) return _STYLE_COLORS[s]; }
    for (var k in _COLORWORDS) { if (_COLORWORDS.hasOwnProperty(k) && n.indexOf(k) >= 0) return _COLORWORDS[k]; }
    return speakerColor(i);
  }
  function setRecolorStatus(r) {
    var el = $("recolorStatus"); if (!el) return; el.hidden = false;
    var s = String(r);
    logLine("Premiere sonucu: " + s);              // ham metin Ayrıntılar'da kalsın
    var msg = hostMesaj(s);                        // ham ExtendScript hatası kullanıcıya çıkmasın
    var hm = s.match(/(\d+)\s*hata/);              // kısmi başarı da "ok:" ile başlıyor
    if (s.indexOf("ok:") === 0 && !(hm && parseInt(hm[1], 10))) {
      el.textContent = "✓ " + s.replace(/^ok:/, ""); el.style.color = "var(--good)";
    } else if (s.indexOf("ok:") === 0) {
      el.textContent = "⚠ " + s.replace(/^ok:/, ""); el.style.color = "var(--warn)";
    } else { el.textContent = "⚠ " + msg; el.style.color = "var(--warn)"; }
  }
  /* "Kaydedilmiş listeyi yükle" butonu JS ile eklenir (HTML'de yok). Liste boşken diskteki
     oturumu tek tıkla geri getirir — kullanıcı geri yükleme teklifini kaçırdıysa 30 dakikalık
     üretimi boşuna tekrarlamasın. */
  async function recolorOturumYukle() {
    if (!CEP || !cfg) return;
    var o = null;
    try { if (!_oturum.name) { var d = await getClips(0); _oturum.name = d.sequenceName; _oturum.end = clipsEnd(d.clips); } } catch (e) {}
    o = _oturum.name ? oturumOku(_oturum.name) : null;
    if (!o) { uiAlert("Bu sekans için kaydedilmiş liste bulunamadı.", "Renk değiştir"); updateRecolorHint(); return; }
    var oncekiMod = state.mode;
    restoreSession(o);
    // restoreSession üretim sekmesine geçiyor; kullanıcı Renk Değiştir'deyse orada kalsın
    if (oncekiMod === "recolor") {
      var b = document.querySelector('#segMode .seg-btn[data-mode="recolor"]');
      if (b) b.click();
      /* Geri bildirim BURADA verilmeli: restoreSession'ın yazdığı "geri yüklendi" mesajı
         #progressLabel'a gidiyor, o da Renk Değiştir sekmesinde gizli olan #genArea'nın içinde —
         kullanıcı düğmeye basıp hiçbir şey olmamış gibi görüyordu. */
      var rst = $("recolorStatus");
      if (rst) {
        rst.hidden = false; rst.style.color = "var(--good)";
        rst.textContent = "✓ Kaydedilmiş liste yüklendi — " + allCues().length + " altyazı. Şimdi timeline'da klip seçip renge bas.";
      }
    }
    updateRecolorHint();
  }
  function recolorYukleButonu(goster) {
    var h = $("recolorHint"); if (!h || !h.parentNode) return;
    var b = $("recolorLoadSession");
    if (!b) {
      if (!goster) return;
      b = document.createElement("button");
      b.id = "recolorLoadSession"; b.type = "button"; b.className = "btn-ghost";
      b.style.marginTop = "8px";
      b.textContent = "Kaydedilmiş listeyi yükle";
      b.addEventListener("click", function () { recolorOturumYukle(); });
      h.parentNode.insertBefore(b, h.nextSibling);
    }
    /* `hidden` YETMEZ: css/style.css'te .btn-ghost için display:inline-flex tanımlı ve tarayıcının
       [hidden]{display:none} kuralını EZİYOR (aynı tuzak .prog-badge ve .recolor-status için CSS'te
       ayrıca çözülmüş). Liste yüklendikten sonra buton ekranda kalıp tekrar tıklanabiliyordu. */
    b.style.display = goster ? "" : "none";
  }
  function updateRecolorHint() {
    var h = $("recolorHint"); if (!h) return;
    var has = allCues().length;
    if (has) {
      h.style.color = ""; h.textContent = "İpucu: birden çok klip seçip tek renge çevirebilirsin. Değişiklik geri alınabilir (Ctrl+Z).";
      recolorYukleButonu(false);
      return;
    }
    /* Metin güncellendi: artık oturum kaydetme var, liste panel kapanınca SIFIRLANMIYOR.
       Eski metin ("panel kapanınca liste sıfırlanır, videoyu tekrar oluştur") kullanıcıya
       30 dakikalık üretimi boşuna tekrarlatıyordu. */
    var yedek = kayitliOturumVarMi();
    h.style.color = "var(--warn)";
    h.textContent = yedek
      ? "⚠ Panelde liste boş — ama bu sekans için KAYDEDİLMİŞ bir altyazı listesi var. Aşağıdaki düğmeyle geri yükle."
      : "⚠ Önce “Tek Stil” veya “Konuşmacıya Göre” ile altyazı oluşturup timeline'a ekle — renk değiştirme o listeyi kullanır.";
    recolorYukleButonu(yedek);
  }
  function refreshRecolorBtns() {
    var box = $("recolorBtns"); if (!box) return; box.innerHTML = "";
    var st = $("recolorStatus"); if (st) st.hidden = true;
    if (!state.styles.length) { box.innerHTML = '<p class="note" style="margin:0">Stil bulunamadı. Stil (.mogrt) klasörünü kontrol et.</p>'; updateRecolorHint(); return; }
    state.styles.forEach(function (s, i) {
      var btn = document.createElement("button"); btn.className = "color-btn"; btn.type = "button"; btn.title = s.name;
      var sw = document.createElement("span"); sw.className = "color-swatch"; sw.style.background = styleColor(s.name, i);
      var nm = document.createElement("span"); nm.className = "color-name"; nm.textContent = s.name;
      btn.appendChild(sw); btn.appendChild(nm);
      (function (mgPath, button) { button.addEventListener("click", function () { doRecolor(mgPath, button); }); })(s.path, btn);
      box.appendChild(btn);
    });
    updateRecolorHint();
  }
  async function doRecolor(mogrt, btn) {
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de renk değişir."); return; }
    /* Üretim sürerken renk değiştirme YOK: bu fonksiyon sonunda saveSession() çağırıyor ve
       yarım kalmış (kanalları henüz dolmamış) listeyi diskteki iyi oturumun üstüne yazabiliyor. */
    if (state.running) { uiAlert("Altyazı üretimi sürerken renk değiştirilemez. Üretim bitince tekrar dene.", "Renk değiştir"); return; }
    if (_recoloring) return; _recoloring = true;
    if (btn) btn.classList.add("busy");
    var st = $("recolorStatus");
    try {
      var raw = await evalES("getSelectedSubTimes()");
      var times = []; try { times = JSON.parse(raw) || []; } catch (e) {}
      if (!times.length) { uiAlert("Timeline'da altyazı klibi seçili değil. Önce klip(ler)e tıkla, sonra bir renk seç.", "Renk değiştir"); return; }
      var cues = allCues();
      if (!cues.length) {
        // Liste boş: diskte kaydedilmiş oturum olabilir (ipucu ve yükle butonu onu gösterir).
        uiAlert(kayitliOturumVarMi()
          ? "Panelde altyazı listesi boş. Bu sekans için KAYDEDİLMİŞ bir liste var — aşağıdaki “Kaydedilmiş listeyi yükle” düğmesine bas, sonra tekrar dene."
          : "Panelde altyazı listesi boş. Önce “Tek Stil” ya da “Konuşmacıya Göre” ile bu videonun altyazısını oluştur.", "Renk değiştir");
        updateRecolorHint(); return;
      }
      var matched = [];
      for (var t = 0; t < times.length; t++) {
        var best = null, bd = 0.3;
        for (var i = 0; i < cues.length; i++) { var d = Math.abs(cues[i].start - times[t]); if (d < bd) { bd = d; best = cues[i]; } }
        if (best) { best._ovMogrt = mogrt; matched.push(best); }
      }
      if (!matched.length) { uiAlert("Seçili klipler panel listesindeki altyazılarla eşleşmedi (aynı sekans ve aynı oluşturma mı?).", "Renk değiştir"); return; }
      // importMGT komşu ezmesin diye seçili en erken noktadan SONA kadar temiz yerleştir.
      var spanStart = matched[0].start;
      for (var mI = 1; mI < matched.length; mI++) if (matched[mI].start < spanStart) spanStart = matched[mI].start;
      var range = { start: spanStart - 0.05, end: Infinity };
      if (st) { st.hidden = false; st.style.color = "var(--muted)"; st.textContent = "⏳ " + matched.length + " altyazının rengi değiştiriliyor…"; }
      logLine("Kaydet: " + (await evalES('saveProject()')));   // renk değişimi öncesi kaydet (Geri Al için) — sonuç log'lansın
      var r = await placeCurrent(range);
      if (r != null) { setRecolorStatus(r); saveSession(); } else if (st) st.hidden = true;
    } catch (e) { if (st) { st.hidden = false; st.style.color = "var(--bad)"; st.textContent = "✕ " + (e.message || e); } }
    finally { _recoloring = false; if (btn) btn.classList.remove("busy"); }
  }
  /* Timeline'daki altyazının YAZISINI yerinde düzelt. Eskiden metin hatası görünce ya Premiere'de
     tek tek elle düzeltmek ya da panelde düzeltip yeniden basmak gerekiyordu; ikincisi tüm zaman
     aralığını silip yeniden bastığı için timeline'da elle yapılan konum/süre ayarları uçuyordu. */
  function fixStatus(msg, renk) {
    var el = $("fixStatus"); if (!el) return;
    el.textContent = msg || ""; el.style.color = renk || "var(--muted)";
  }
  if ($("btnFixRead")) $("btnFixRead").addEventListener("click", async function () {
    if (!CEP) { fixStatus("Önizleme modu.", "var(--warn)"); return; }
    var raw = await evalES("getSelectedSubText()");
    var list = []; try { list = JSON.parse(raw) || []; } catch (e) {}
    if (!list.length) { fixStatus("Timeline'da altyazı klibi seçili değil.", "var(--warn)"); return; }
    $("fixText").value = list[0] || "";
    fixStatus(list.length > 1 ? (list.length + " klip seçili — Uygula hepsini aynı yapar") : "Okundu.",
      list.length > 1 ? "var(--warn)" : "var(--good)");
  });
  if ($("btnFixApply")) $("btnFixApply").addEventListener("click", async function () {
    if (!CEP) { fixStatus("Önizleme modu.", "var(--warn)"); return; }
    var t = String($("fixText").value || "").replace(/\s+/g, " ").trim();
    if (!t) { fixStatus("Önce yazıyı gir.", "var(--warn)"); return; }
    var btn = this; if (btn.disabled) return; btn.disabled = true;
    try {
      await evalES("saveProject()");   // Geri Al için
      // Metin DOSYA üzerinden geçirilir: evalScript string literaline gömmek Türkçe karakter,
      // tırnak ve ters bölü açısından kırılgan (altyazı yerleştirme de aynı sebeple dosya kullanıyor).
      pipeline.ensureDir(cfg.workDir);
      var tf = path.join(cfg.workDir, "fixtext_" + Date.now() + ".txt");
      fs.writeFileSync(tf, t, "utf8");
      var r = await evalES('setSelectedSubTextFile("' + esPath(tf) + '")');
      try { fs.unlinkSync(tf); } catch (eDel) {}
      var msg = String(r).replace(/^[a-z_]+:/, "");
      fixStatus((String(r).indexOf("ok:") === 0 ? "✓ " : "⚠ ") + msg,
        String(r).indexOf("ok:") === 0 ? "var(--good)" : "var(--warn)");
    } catch (eFix) { fixStatus("✕ " + friendlyError(eFix), "var(--bad)"); }
    finally { btn.disabled = false; }
  });

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
                   A3 = oyun sesi (dokunulmaz), A4+ = diğer arkadaşlar.

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
    /* Tanınmayan renk etiketi SESSİZ kalmasın: tek geri bildirim, kutudaki "[Blu]" yazısının
       kaydettikten sonra sessizce "[Blue]"ya dönmesiydi — kullanıcı yazdığı rengin
       uygulanmadığını fark etmiyordu. */
    var renkHatalilar = [];
    for (var rh = 0; rh < state.kisiler.length; rh++) {
      if (state.kisiler[rh] && state.kisiler[rh].renkHatasi) renkHatalilar.push(state.kisiler[rh].renkHatasi);
    }
    if (renkHatalilar.length) {
      snkKisiStatus("⚠ Bilinmeyen renk: " + renkHatalilar.join(", ") + " — eski renk korundu. " +
        "Geçerli renkler: " + KISI.LABELLER.join(", "), "var(--warn)");
    } else {
      snkKisiStatus("✓ Kaydedildi — " + state.kisiler.length + " kişi", "var(--good)");
    }
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

    /* Kanal ataması: çeken A1'de zaten var (OBS), Craig'deki kendi dosyası SADECE hizalama
       referansı olarak kullanılır, timeline'a konmaz. Karşı taraf A2'ye, A3 oyun sesi olduğu
       için atlanır, kalanlar A4'ten itibaren sıralanır. */
    var plan = [], sonrakiKanal = 3;   // 0-tabanlı: 3 = A4
    plan.push({ kanal: 0, karakter: ceken, kilit: true, not: "OBS mikrofonun — dokunulmaz" });
    var karsiKayit = null;
    eslesen.forEach(function (e) { if (e.kisi.karakter === karsi) karsiKayit = e; });
    if (karsiKayit) plan.push({ kanal: 1, karakter: karsi, dosya: karsiKayit.dosya, renk: karsiKayit.kisi.renk });
    else plan.push({ kanal: 1, karakter: karsi, bos: true, not: "bu videoda yok — kanal boş kalacak" });
    plan.push({ kanal: 2, karakter: "Oyun sesi", kilit: true, not: "dokunulmaz" });

    eslesen.forEach(function (e) {
      if (e.kisi.karakter === ceken || e.kisi.karakter === karsi) return;   // A1/A2 zaten ayrıldı
      plan.push({ kanal: sonrakiKanal++, karakter: e.kisi.karakter, dosya: e.dosya, renk: e.kisi.renk });
    });
    /* Aynı kişinin ek kayıtları. Çekenin ikinci kaydı YERLEŞTİRİLMEZ — sesi zaten A1'de,
       konursa çift çıkar. Diğerleri kendi kanalını alır ve etiketinden anlaşılır. */
    tekrar.forEach(function (e) {
      if (e.kisi.karakter === ceken) {
        snkLog(e.dosya.dosya + " — " + ceken + " adına ikinci kayıt. Sesin zaten A1'de, yerleştirilmiyor.");
        return;
      }
      snkLog(e.dosya.dosya + " — " + e.kisi.karakter + " adına " + e.sira + ". kayıt (kişi düşüp yeniden " +
             "bağlanmış olabilir). Ayrı kanala konuyor; gerekmiyorsa Premiere'de o kanalı sil.");
      plan.push({
        kanal: sonrakiKanal++, karakter: e.kisi.karakter + " (" + e.sira + ". kayıt)",
        dosya: e.dosya, renk: e.kisi.renk
      });
    });
    bilinmeyen.forEach(function (d) {
      plan.push({ kanal: sonrakiKanal++, karakter: "?", dosya: d, bilinmeyen: true, renk: 0 });
    });
    // çekenin kendi Craig dosyası — hizalama referansı (timeline'a konmaz)
    snk.cekenDosya = null;
    eslesen.forEach(function (e) { if (e.kisi.karakter === ceken) snk.cekenDosya = e.dosya; });

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
      if (b && !b.error && b.audioTracks) { snk.sesKanalSayisi = b.audioTracks; snkPlanCiz(); }
    } catch (e) {}
  }

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
      if (!p.kilit && p.renk != null) {
        var sw = document.createElement("span"); sw.className = "snk-etiket";
        sw.style.background = _labelRenk(p.renk); sw.title = KISI.LABELLER[p.renk] || "";
        isim.appendChild(sw);
      }
      isim.appendChild(document.createTextNode(p.bilinmeyen ? "Bilinmeyen kişi" : p.karakter));
      orta.appendChild(isim);
      var alt = document.createElement("div"); alt.className = "snk-dosya";
      alt.textContent = p.dosya ? p.dosya.dosya : (p.not || "");
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
  // Premiere label indeksi -> yaklaşık ekran rengi (sadece tabloda göstermek için)
  function _labelRenk(i) {
    var r = ["#a78bfa", "#818cf8", "#22d3ee", "#c4b5fd", "#38bdf8", "#22c55e", "#fb7185", "#fbbf24",
             "#a855f7", "#3b82f6", "#14b8a6", "#e879f9", "#d6bcab", "#4ade80", "#a16207", "#facc15"];
    return r[i] || "#888";
  }

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
          "yerleştirilecek ve renk almayacak." +
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
      var msg = yerlesecek.length + " ses dosyası yerleştirilecek:\n\n" + ozet.join("\n") + atlandiNot +
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
      if (sv.indexOf("ok:") !== 0) {
        var devamKayit = await uiConfirm("Proje kaydedilemedi: " + hostMesaj(sv) + "\n\n" +
          "Devam edersem “Geri Al” bu ana DÖNEMEZ; daha eski bir sürüme döner ve aradaki " +
          "çalışman kaybolabilir.\n\nYine de devam edeyim mi?", "Senkron");
        if (!devamKayit) { snkFail("İptal edildi", "warn"); return; }
      }

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
        satirlar.push(p.konacakYol + "|" + p.kanal + "|" + Math.max(0, p.konacakBas).toFixed(3) + "|" +
                      (p.bilinmeyen ? -1 : (p.renk != null ? p.renk : 0)) + "|" + p.karakter);
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
         (host.jsx clearAudioTrack artık beginUndoGroup/endUndoGroup kullanıyor: silinen onlarca
         klip TEK Ctrl+Z ile geri gelir. Eskiden buradaki yorum "Premiere'de undo grubu yok"
         diyordu — o bilgi artık YANLIŞ.) */
      var karsiPlan = null;
      snk.plan.forEach(function (p) { if (p.kanal === 1 && p.dosya) karsiPlan = p; });
      if (karsiPlan) {
        var sil = await uiConfirm("A2'de artık " + karsiPlan.karakter + "'nin temiz kaydı var.\n\n" +
          "OBS'ten gelen ESKİ karışık Discord sesi hâlâ orada duruyor olabilir — o kanalı temizleyeyim mi?\n\n" +
          // Geri alınabilirliği yaz: host artık undo grubu kullanıyor, kullanıcı "geri dönüşü yok"
          // sanıp gerçekten gereken temizlikten kaçınmasın.
          "(Not: A2'ye yeni ses zaten yerleşti. Temizlik yaparsan A2'deki TÜM eski klipler silinir — " +
          "yanlışlıkla yaparsan Premiere'de Ctrl+Z ile geri alabilirsin.)", "A2 temizliği");
        if (sil) {
          /* Yerleştirilen klibin adını KORUNACAK olarak geçiyoruz. Bu olmadan clearAudioTrack
             kanaldaki her şeyi siliyordu — az önce koyduğumuz Craig kaydı dahil.
             ADI GERÇEKTEN YERLEŞEN DOSYADAN al (konacakYol): kayma negatifse timeline'a
             giden şey kırpılmış kopyadır ("...._hizali.m4a") ve orijinal Craig adıyla
             eşleşmez — koruma sessizce tutmuyordu, klip yine siliniyordu. */
          var korunacak = path.basename(karsiPlan.konacakYol || karsiPlan.dosya.yol)
                            .replace(/\.[^.]+$/, "");
          var t = await evalES('clearAudioTrack(1,"' + esPath(korunacak) + '")');
          snkLog("A2 temizliği: " + t);
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
      // A1 (sen) timeline sesi — SEKANS zamanına hizalı
      var a1 = await getClips(0);
      var a1wav = path.join(cfg.workDir, "acv1_" + stamp + ".wav");
      acSetProgress(20, "A1 sesi hazırlanıyor…");
      await pipeline.buildTimelineAudio(a1.clips, cfg.ffmpegExe, a1wav, null, 0);
      var wavs = [a1wav];
      // A2 (arkadaşlar) — varsa
      try {
        var a2 = await getClips(1);
        var a2wav = path.join(cfg.workDir, "acv2_" + stamp + ".wav");
        acSetProgress(30, "A2 sesi hazırlanıyor…");
        await pipeline.buildTimelineAudio(a2.clips, cfg.ffmpegExe, a2wav, null, 1);
        wavs.push(a2wav);
      } catch (e2) { acLogLine("A2 atlandı: " + (e2.message || e2)); }
      // karıştır (sekans-hizalı konuşma sesi)
      var voice = path.join(cfg.workDir, "acvoice_" + stamp + ".wav");
      await pipeline.mixWavs(wavs, cfg.ffmpegExe, voice);
      for (var wi = 0; wi < wavs.length; wi++) { try { fs.unlinkSync(wavs[wi]); } catch (e) {} }
      acLogLine("Timeline sesi hazır (" + wavs.length + " kanal).");
      acSetProgress(45, "Boşluklar taranıyor…");
      var opts = { sensitivity: parseFloat($("acSens").value), minSilence: parseFloat($("acMin").value),
                   denoise: !!($("chkDenoise") && $("chkDenoise").checked) };
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
      acSetProgress(25, "Proje kaydediliyor…");   // kesimden önce her zaman kaydet (Geri Al için)
      acLogLine("Kaydet: " + (await evalES('saveProject()')));
      var body = acCuts.map(function (c) { return c.start.toFixed(3) + "|" + c.end.toFixed(3); }).join("\n");
      var file = path.join(cfg.workDir, "cuts_" + Date.now() + ".txt");
      fs.writeFileSync(file, body, "utf8");
      acSetProgress(50, "Kesiliyor… (başladıktan sonra durdurulamaz)"); $("acLabel").style.color = "";
      var r = await evalES('autoCut("' + esPath(file) + '")');
      acLogLine("Sonuç: " + r);
      var msg = String(r).replace(/^[a-z_]+:/, "");
      if (String(r).indexOf("ok:") === 0) acDone("Bitti — " + msg);
      else { acFail("⚠ " + msg, "warn"); uiAlert(msg, "Sonuç"); }
    } finally { btn.disabled = false; }
  });

  // ---------- MOCK (tarayıcı önizleme) ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function runMock() {
    state.genMode = (state.mode === "speaker") ? "speaker" : "single";
    var steps = state.mode === "speaker"
      ? [[15, "A1 yazıya dökülüyor…"], [45, "A2 okunuyor…"], [70, "Konuşmacılar ayrılıyor (AI)…"], [95, "Bitiriliyor…"]]
      : [[20, "Ses hazırlanıyor…"], [55, "Yazıya dökülüyor (GPU)…"], [90, "Bitiriliyor…"]];
    _pg.transT0 = Date.now();
    for (var k = 0; k < steps.length; k++) { _pg.base = steps[k][1]; transProgress(steps[k][0], 0, 100); logLine(steps[k][1]); await sleep(500); }
    if (state.mode === "speaker") {
      state.singleCues = [];
      state.speakers = [{ id: "SPEAKER_00", sample: "Ya nasıl sahte ya" }, { id: "SPEAKER_01", sample: "Gelme sen gelme" }];
      renderSpeakerMap();
      var color = { SPEAKER_00: speakerColor(0), SPEAKER_01: speakerColor(1), __A1__: "#e5544b" };
      state.a1Cues = [{ start: 0, end: 2, text: "Hepinize merhaba", speaker: "__A1__" }];
      state.a2Cues = [
        { start: 3, end: 4.5, text: "Gelme sen gelme", speaker: "SPEAKER_01" },
        { start: 5, end: 7, text: "Ya nasıl sahte ya", speaker: "SPEAKER_00" },
        { start: 8, end: 9.5, text: "İnceleyin işte", speaker: "SPEAKER_00" }
      ];
      var all = state.a1Cues.concat(state.a2Cues);
      renderTranscript(all, color);
      progressDone("Bitti (önizleme) — 2 konuşmacı, 4 satır");
    } else {
      state.a1Cues = []; state.a2Cues = [];
      state.singleCues = [
        { start: 0, end: 1.8, text: "Hepinize merhaba" }, { start: 2, end: 2.9, text: "arkadaşlar" },
        { start: 3, end: 4.8, text: "Bugün var ya" }, { start: 5, end: 6.8, text: "harika bir şey" }
      ];
      renderTranscript(state.singleCues, null);
      progressDone("Bitti (önizleme) — 4 altyazı hazır");
    }
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
      var files = fs.readdirSync(d).filter(function (f) { return /\.mogrt$/i.test(f); });
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
    cfg = pipeline.loadConfig(extRoot);
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
    fillStyleOptions($("selStyleSingle"), true); preselect($("selStyleSingle"), "tofi");
    fillStyleOptions($("selStyleA1"), false); preselect($("selStyleA1"), "tofi");
    refreshRecolorBtns();   // Renk Değiştir sekmesi buton grid'i
    if (state.styles.length) logLine(state.styles.length + " stil: " + state.styles.map(function (s) { return s.name; }).join(", "));
    try { cleanupOldTemp(); } catch (eTmp) {}            // eski geçici WAV'lar birikmesin
    try { refreshRangeOptions(); } catch (eRng) {}       // süre aralığı menüleri sekans uzunluğuna göre
    // Konuşmacı ayırma CPU'ya düşmüşse bunu görünür yap — sessizce 5-15 kat yavaşlıyordu
    if (cfg.diarizeDevice !== "cuda") logLine("Not: konuşmacı ayırma CPU'da çalışacak (yavaş). Hızlandırmak için “Konuşmacıya Göre” sekmesindeki GPU kutusunu işaretle.");
    /* SIRA ÖNEMLİ: önce "kaydedilmiş oturum geri yüklensin mi", ANCAK ondan sonra güncelleme
       sorusu. İkisi aynı anda açılınca aynı modal kutusunu paylaşıyorlardı; ikinci soru
       birincinin yazısını eziyor ve tek tıklama ikisini birden cevaplıyordu (modal kuyruğu
       artık çakışmayı engelliyor, bu sıra da soruların mantıklı gelmesini sağlıyor). */
    var oturumIsi;
    try { oturumIsi = offerSessionRestore(); } catch (eSes) {}
    Promise.resolve(oturumIsi)["catch"](function () {}).then(function () {
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
    fillStyleOptions($("selStyleSingle"), true); preselect($("selStyleSingle"), "tofi");
    fillStyleOptions($("selStyleA1"), false); preselect($("selStyleA1"), "tofi");
    refreshRecolorBtns();
  }

  // Select'leri kalıcılaştır + kaydedilmişi geri yükle (init sonrası — seçenekler dolmuş olur)
  function wirePersistence() {
    // chapInterval artık gerçek bir <select> (index.html): YouTube bölüm aralığı da hatırlansın —
    // her panel açılışında varsayılana dönüp kullanıcıya tekrar seçtiriyordu.
    var ids = ["acSens", "acMin", "selStyleSingle", "selStyleA1", "selIstif", "chapInterval"];
    for (var i = 0; i < ids.length; i++) { restoreSelect(ids[i]); persistSelect(ids[i]); }
    // AutoCut ayarları değişince ekranda duran analiz sonucu artık o ayara ait değil — sıfırla
    var acIds = ["acSens", "acMin"];
    for (var a = 0; a < acIds.length; a++) {
      var el = $(acIds[a]); if (el) el.addEventListener("change", acAnalizGecersiz);
    }
    // AutoCut gürültü azaltma — varsayılan KAPALI (analizi ~5 kat yavaşlatıyor)
    var dn = $("chkDenoise");
    if (dn) { dn.checked = lsGet("denoise", "0") === "1"; dn.addEventListener("change", function () { lsSet("denoise", dn.checked ? "1" : "0"); acAnalizGecersiz(); }); }
    restoreSegs();
    if ($("btnKanalTara")) $("btnKanalTara").addEventListener("click", function () { scanChannels(); });
  }

  try { if (CEP) initCEP(); else initMock(); wirePersistence(); }
  catch (e) { setPill("pillHost", false); if ($("log")) logLine("Init hatası: " + e.message); }
})();
