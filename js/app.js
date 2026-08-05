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
    /* AutoCut kanal listesi de sekansa bağlı: görünüm her açıldığında tazelenir, yoksa
       kullanıcı Senkron'la yeni kanallar ekledikten sonra eski listeyi görüyor.
       async: hata FIRLATMAZ, promise'i reddeder — düz try/catch yakalayamaz. */
    if (name === "autocut") {
      try { var pAc = acKanallariTara(true); if (pAc && pAc["catch"]) pAc["catch"](function () {}); } catch (e) {}
    }
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

  function trOpts(extra) {
    /* Model ve sansür artık panelde seçilmiyor: her zaman en doğru model (config.json'daki
       large-v3) ve tam sansür kullanılır. Seçenek sunmak fayda getirmiyordu — hızlı model
       Türkçe'de belirgin kötü, sansürü kapatmak da YouTube için istenmiyor. */
    var o = { model: cfg.model || "large-v3", language: cfg.language, diarize: false,
      censor: "all",
      hotwords: SZ ? SZ.hotwords(state.dict) : "", dictMap: state.dictMap };
    // Shorts: dikey karede satır dar — kısa cue'lar (bkz. SHORTS bölümü).
    if (shortsAcik()) { o.maxWords = SHORTS_MAX_KELIME; o.maxChars = SHORTS_MAX_KARAKTER; }
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
      /* İŞARET KUTUSU HATIRLANMIYOR — AutoCut'takiyle aynı sebep: kanal numarasının ANLAMI
         kadroya göre değişiyor (oyun sesi 3 arkadaşla A5, 4 arkadaşla A6). Kayıtlı "A5'i
         atla" tercihi sonraki videoda bir ARKADAŞI atlar ve o kişi hiç yazıya dökülmez.
         Oturumdan gelen değer (t.aktif) korunur; yoksa işaretli başlar. */
      chk.checked = (t.aktif != null) ? !!t.aktif : true;
      (function (ix, c, r) {
        function yansit() { if (c.checked) r.classList.remove("kanal-pasif"); else r.classList.add("kanal-pasif"); }
        c.addEventListener("change", function () { yansit(); });   // kaydedilmiyor, bkz. yukarıdaki not
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

      // Stil seçici KALDIRILDI: altyazı Premiere'in kendi altyazı kanalına gidiyor ve
      // o kanalın tek stili var — kanal başına renk vermek mümkün değil.
      box.appendChild(row);
      state.channels.push({ idx: t.idx, clips: t.clips, aktifChk: chk, adInput: adInp,
                            cues: t.cues || (onceki ? onceki.cues : []) });
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
    progressDone("Bitti — " + msg);
  }

  // Timeline'a yerleştirir; ham sonuç metnini döndürür (null = iptal, zaten uyarıldı).
  /* KAÇ VİDEO KANALI GEREKİYOR?
     host tarafında altyazının gittiği kanal  idx = (videoKanalSayısı - 1) - lane.
     En alttaki kanal (idx 0) kullanıcının GÖRÜNTÜSÜ ve asla kullanılmamalı, yani idx >= 1:
        (vt - 1) - enUstLane >= 1   =>   vt >= enUstLane + 2
     Sayı okunamazsa yerleştirme YAPILMAZ: yanlış tahminin bedeli, silinen görüntü.
     Dönüş: kanal sayısı (yeterliyse) ya da 0 (yetersiz — kullanıcı zaten uyarıldı). */

  /* ---------- TEK YERLEŞTİRME YOLU: Premiere altyazı kanalı ----------
     Eskiden üç yol vardı (placeSingle MOGRT dalı, placeSpeaker, placeChannels) ve her
     altyazı ayrı bir MOGRT klibi oluyordu: 20 dakikalık videoda ~1000 klip, Premiere
     kasıyordu. Artık hepsi TEK altyazı kanalına yazılıyor — video kanalı da tüketmiyor,
     bu yüzden katman bütçesi / görüntü silme sınıfı hataların tamamı ortadan kalktı.
     Görünüm (yazı tipi, renk, kontur, konum) Premiere'de altyazı stilinden ayarlanır. */
  async function placeCaptions(range) {
    var cues = allCues();
    if (range) cues = cues.filter(function (c) { return c.end > range.start && c.start < range.end; });
    if (!cues.length) { uiAlert("Önce altyazı oluştur."); return null; }
    // Zaman sırası ŞART: "Herkes" kaynağında kanallar ayrı ayrı dökülüyor, cue'lar karışık gelir.
    cues = cues.slice().sort(function (a, b) { return a.start - b.start; });
    var srtFile = path.join(cfg.workDir, "cap_" + Date.now() + ".srt");
    fs.writeFileSync(srtFile, pipeline.cuesToSrt(cues), "utf8");
    return await evalES('addCaptionsToTimeline("' + esPath(srtFile) + '")');
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
    /* OYUN SESİ EN SONDA. Panel onu taşıyamaz (Premiere'de klip taşıma API'si yok) —
       satır yalnızca hangi kanalda olması gerektiğini söyler. */
    plan.push({ kanal: sonrakiKanal++, karakter: "Oyun sesi", oyun: true,
                not: "panel oyun sesini buraya taşıyacak" });
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
        snkOyunKanalDoldur();
        snkPlanCiz();
      }
    } catch (e) {
      /* Okunamadıysa ESKİ veriyle devam etme: üzerine yazma uyarısı bayat veriye bakıp
         yanlış (ya da hiç) uyarır. null = "bilinmiyor", plan bunu ayrıca söyler. */
      snk.kanalKlip = null;
    }
  }

  /* Oyun sesinin ŞU ANDA bulunduğu kanal. Panel onu en alta taşıyacak; hangisi olduğunu
     bilmesi gerek. Varsayılan A3 (kullanıcının OBS düzeni), klip içermiyorsa "yok". */
  function snkOyunKanalDoldur() {
    var sel = $("snkOyunKanal"); if (!sel) return;
    var onceki = sel.value;
    sel.innerHTML = "";
    var o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "yok / zaten en altta";
    sel.appendChild(o0);
    var n = snk.sesKanalSayisi || 0, kl = snk.kanalKlip || [];
    for (var i = 0; i < n; i++) {
      if (i === 0) continue;                       // A1 = OBS mikrofonu, oyun sesi olamaz
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = "A" + (i + 1) + (kl[i] ? (" — " + kl[i] + " klip") : " — boş");
      sel.appendChild(o);
    }
    var kayitli = lsGet("snkOyunKanal", null);
    if (onceki) sel.value = onceki;
    else if (kayitli != null && kayitli !== "") sel.value = kayitli;
    else if (n > 2 && kl[2]) sel.value = "2";      // varsayılan: A3
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
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
      // Renk noktası KALDIRILDI: timeline'da klip renklendirme iptal edildi (kafa karıştırıyordu).
      isim.appendChild(document.createTextNode(p.bilinmeyen ? "Bilinmeyen kişi" : p.karakter));
      orta.appendChild(isim);
      var alt = document.createElement("div"); alt.className = "snk-dosya";
      alt.textContent = p.dosya ? p.dosya.dosya : (p.not || "");
      /* Oyun sesi satırı bir BİLGİ değil, panelin YAPACAĞI iş. Soluk 11px yazıda kaybolup
         "kilitli, dokunulmayacak" gibi okunuyordu; normal renkte ve sarmalı göster. */
      if (p.oyun) { alt.style.color = "var(--text)"; alt.style.whiteSpace = "normal"; }
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
      /* OYUN SESİ TAŞIMA: kişiler yerleşmeden ÖNCE yapılmalı, yoksa oyun sesi zaten ezilmiş olur.
         Hedef = plandaki "Oyun sesi" satırının kanalı (herkesin altı). */
      var oyunSel = $("snkOyunKanal");
      var oyunKaynak = oyunSel && oyunSel.value !== "" ? parseInt(oyunSel.value, 10) : -1;
      var oyunSatir = null;
      snk.plan.forEach(function (p) { if (p.oyun) oyunSatir = p; });
      var oyunHedef = oyunSatir ? oyunSatir.kanal : -1;
      var oyunTasinacak = (oyunKaynak >= 0 && oyunHedef >= 0 && oyunKaynak !== oyunHedef);
      var oyunNot = oyunTasinacak
        ? ("\n\nOyun sesi A" + (oyunKaynak + 1) + " → A" + (oyunHedef + 1) + " taşınacak " +
           "(kişiler yerleşmeden önce).\nNOT: taşıma kopyalama yoluyla yapılıyor — o klibe " +
           "uyguladığın efektler ve ses seviyesi anahtar kareleri KORUNMAZ.")
        : "";
      // Taşınacak kanalı ezme listesinden düş: orası taşımadan sonra boşalmış olacak.
      if (oyunTasinacak) {
        ezilecek = ezilecek.filter(function (s) { return s.indexOf("A" + (oyunKaynak + 1) + " (") !== 0; });
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

      /* OYUN SESİNİ TAŞI — kişiler yerleşmeden ÖNCE. Sıra kritik: sonra yapılsaydı hedef
         kanala zaten bir kişi konmuş olurdu ve taşıma "hedef boş değil" diye reddedilirdi;
         daha kötüsü, kaynak kanala (A3) kişi yazılıp oyun sesi çoktan ezilmiş olurdu. */
      if (oyunTasinacak) {
        if (snk.iptal) throw new Error("İptal edildi");
        snkProgress(88, "Oyun sesi A" + (oyunHedef + 1) + "'e taşınıyor…");
        var tas = String(await evalES("kanalTasi(" + oyunKaynak + "," + oyunHedef + ")"));
        snkLog("Oyun sesi taşıma: " + tas);
        if (tas.indexOf("ok:") !== 0) {
          /* Taşıma başarısızsa DEVAM ETME: kişiler yerleşirse oyun sesinin durduğu kanal
             ezilir. host hiçbir şey silmeden döndüğü için timeline hâlâ sağlam. */
          snkFail("⚠ Oyun sesi taşınamadı — hiçbir şey yerleştirilmedi.", "warn");
          uiAlert("Oyun sesi taşınamadı, bu yüzden yerleştirme yapılmadı (timeline'ın bozulmasın diye).\n\n" +
                  tas.replace(/^[a-z_]+:/, "") +
                  "\n\nOyun sesini Premiere'de elle en alt kanala taşıyıp tekrar dene, ya da " +
                  "“Oyun sesi şu an hangi kanalda?” seçimini “yok” yap.", "Senkron");
          return;
        }
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
        // Renk alanı KALDIRILDI (timeline etiketleme iptal edildi) — host da 4 alan bekliyor.
        satirlar.push(p.konacakYol + "|" + p.kanal + "|" + Math.max(0, p.konacakBas).toFixed(3) +
                      "|" + p.karakter);
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
      var karsiPlan = null;
      snk.plan.forEach(function (p) { if (p.kanal === 1 && p.dosya) karsiPlan = p; });
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
  // Oyun sesi kanalı seçimi hatırlansın — kullanıcının düzeni videodan videoya aynı.
  if ($("snkOyunKanal")) $("snkOyunKanal").addEventListener("change", function () {
    lsSet("snkOyunKanal", this.value);
  });
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
        uiAlert("Analiz edilecek kanal seçili değil.\n\n“Konuşma kanalları” kartından " +
                "arkadaşlarının seslerinin olduğu kanalları işaretle.", "AutoCut");
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
      if (String(r).indexOf("ok:") === 0) {
        acDone("Bitti — " + msg);
        /* KESİLEN ARALIKLARI UNUT. Bunlar kesim ÖNCESİ zamanlara göre hesaplanmıştı;
           kesimden sonra timeline kaydığı için artık geçersizler. Eskiden ekranda kalıyordu
           ve "Boşlukları Kes"e ikinci kez basmak (ya da başka bir sekansa geçip basmak)
           ESKİ aralıkları uyguluyordu — yani rastgele yerlerden kesiyordu. */
        acCuts = []; acLast = null;
        acAnalizGecersiz();
      } else { acFail("⚠ " + msg, "warn"); uiAlert(msg, "Sonuç"); }
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
    // stil seçici kaldırıldı — altyazı Premiere altyazı kanalına gidiyor
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
    // stil seçici kaldırıldı — altyazı Premiere altyazı kanalına gidiyor
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
    // Shorts kutusu restoreSegs'ten SONRA: mod geri yüklendikten sonra kısıtı uygulamalı
    // (kayıtlı mod "speaker" ve Shorts açıksa Tek Stil'e geçirilir).
    wireShorts();
    if ($("btnKanalTara")) $("btnKanalTara").addEventListener("click", function () { scanChannels(); });
  }

  try { if (CEP) initCEP(); else initMock(); wirePersistence(); }
  catch (e) { setPill("pillHost", false); if ($("log")) logLine("Init hatası: " + e.message); }
})();
