/* Yusufwrl Altyazı — panel mantığı (Tek Stil + Konuşmacıya Göre) */
(function () {
  "use strict";
  var CEP = (typeof window.__adobe_cep__ !== "undefined");
  var cs = null, pipeline = null, cfg = null, path = null, fs = null, extRoot = "";
  var SP_COLORS = ["#4b8bff", "#35c26a", "#e0a63a", "#b06dfc", "#3fc6c6", "#ff7ac2", "#e5544b", "#9ac44b",
    "#ff8c42", "#6c5ce7", "#f9ca24", "#48dbfb"];
  var fileCounter = 0;

  var state = { mode: "single", genMode: "single", track: "0", running: false, cancelled: false, styles: [],
    singleCues: [], a1Cues: [], a2Cues: [], speakers: [], singleStyle: "",
    dict: [], dictMap: null,     // karakter isimleri sözlüğü (Tofi/Moni/…) + arama tablosu
    channels: [] };              // "ayrı kanal" modu: her ses kanalı bir kişi

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
  function uiModal(opts) {
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
    [/No such file|could not find codec|Invalid data found|does not contain any stream/i,
      "Medya dosyası okunamadı. Klip çevrimdışı (offline) olabilir — Premiere'de sağ tık > Link Media."],
    [/out of memory|cudaErrorMemoryAllocation|CUBLAS_STATUS_ALLOC/i,
      "GPU belleği yetmedi. Model'i “medium” yap ya da açık olan ağır programları kapat."],
    [/cudnn|cublas|CUDA driver|no kernel image|\.dll/i,
      "Ekran kartı sürücüsü sorunu. Sürücüyü güncelle; sorun sürerse Model'i “medium” yap."],
    [/ENAMETOOLONG/i,
      "Bu sekansta çok fazla klip var. Süre aralığı vererek videoyu parça parça işle."],
    [/ENOENT/i,
      "Motor bulunamadı. Kurulum eksik olabilir — YusufwrlEngine klasörünü kontrol et."],
    [/JSON üretilemedi/i,
      "Yapay zekâ motoru sonuç üretemedi. Seçili kanalda konuşma olduğundan emin ol, sonra tekrar dene."]
  ];
  function friendlyError(e) {
    var ham = String((e && e.message) || e || "");
    for (var i = 0; i < _HATA_CEVIRI.length; i++) if (_HATA_CEVIRI[i][0].test(ham)) return _HATA_CEVIRI[i][1];
    var ilk = ham.split("\n")[0];
    return ilk.length > 140 ? ilk.slice(0, 140) + "…" : ilk;
  }
  function trimLog(s) { var lines = String(s).split("\n"); return (lines.length > 200 ? lines.slice(0, 200) : lines).join("\n"); }
  function logLine(msg) { var el = $("log"); var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  function setPill(id, on) { var el = $(id); el.classList.remove("on", "off"); el.classList.add(on ? "on" : "off"); }
  // ---------- İlerleme (yüzde + tahmini süre + bitti/hata durumu) ----------
  // _pg.max: yüzde geri gitmesin (monotonik). _pg.transT0: transkripsiyon başlangıç zamanı (ETA için).
  var _pg = { base: "", max: 0, transT0: 0, totalSec: 0 };   // totalSec: ilerlemeyi zaman damgasindan hesaplamak icin
  function _fmtEta(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return "~" + m + ":" + (s < 10 ? "0" : "") + s; }
  function setProgress(pct, label, eta) {
    var box = $("progressBox"); box.hidden = false; box.classList.remove("done", "error");
    var sp = $("spinner"); if (sp) sp.hidden = false;
    var bd = $("progressBadge"); if (bd) bd.hidden = true;
    if (label != null) _pg.base = label;
    var lbl = $("progressLabel"); lbl.textContent = "";
    lbl.appendChild(document.createTextNode(_pg.base || ""));
    if (eta) { var e = document.createElement("span"); e.className = "prog-eta"; e.textContent = "  " + eta + " kaldı"; lbl.appendChild(e); }
    if (pct >= 0) {
      if (pct < _pg.max) pct = _pg.max; else _pg.max = pct;   // geri gitmesin
      $("progressFill").style.width = pct + "%"; $("progressPct").textContent = Math.round(pct) + "%";
    }
  }
  function progressReset(label) {
    _pg.base = label || ""; _pg.max = 0; _pg.transT0 = 0; _pg.totalSec = 0;
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
  for (var i = 0; i < modeBtns.length; i++) modeBtns[i].addEventListener("click", function () {
    document.querySelector("#segMode .seg-btn.active").classList.remove("active");
    this.classList.add("active"); state.mode = this.dataset.mode; lsSet("mode", state.mode);
    var isRecolor = (state.mode === "recolor");
    $("genArea").hidden = isRecolor;               // üretim alanı (Model/aralık/oluştur/sonuç) sadece renk-dışı modda
    $("panelRecolor").hidden = !isRecolor;
    $("panelSingle").hidden = (state.mode !== "single");
    $("panelSpeaker").hidden = (state.mode !== "speaker");
    if (isRecolor) refreshRecolorBtns();
    else {
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
  });
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
    var id = name === "altyazi" ? "viewAltyazi" : name === "autocut" ? "viewAutocut" : "viewHome";
    var el = $(id); el.removeAttribute("hidden"); el.classList.add("active");
    $("backBtn").hidden = (id === "viewHome");
    var c = document.querySelector(".content"); if (c) c.scrollTop = 0;
  }
  var toolCards = document.querySelectorAll(".tool-card");
  for (var tcx = 0; tcx < toolCards.length; tcx++) toolCards[tcx].addEventListener("click", function () { goView(this.dataset.view); });
  $("backBtn").addEventListener("click", function () { goView("home"); });

  // ---------- stiller ----------
  function fillStyleOptions(sel, includeCaption) {
    sel.innerHTML = "";
    if (includeCaption) { var o = document.createElement("option"); o.value = ""; o.textContent = "Düz altyazı (caption)"; sel.appendChild(o); }
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
        // A2 satırları elle düzeltilebilir (A1 = tek kişi, sen; değiştirilmez)
        if (c.speaker && c.speaker !== "__A1__") {
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
        var id = "__CH" + ch.idx + "__"; cc[id] = speakerColor(i);
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
    // "large-v3:batched" = hızlı önizleme modu; model adı ile bayrak burada ayrılır
    var mv = String(($("selModel") && $("selModel").value) || "large-v3");
    var hizli = /:batched$/.test(mv);
    // Sansür: "off" | "hard" (sadece ağır küfür) | "all" (hakaretler dahil)
    var cs = String(($("selCensor") && $("selCensor").value) || "all");
    var o = { model: mv.replace(/:batched$/, ""), batched: hizli,
      language: cfg.language, diarize: false,
      censor: (cs === "off") ? false : cs,
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
  // "1:30" -> 90 sn, "90" -> 90, "1:05:00" -> 3900. Boş/geçersiz -> null.
  function parseTime(str) {
    str = String(str == null ? "" : str).trim();
    if (!str) return null;
    /* KATI biçim kontrolü: "90", "1:30", "1:05:00" (ondalık saniye olabilir). Eskiden parseFloat
       kullanılıyordu ve "1:00-2:00", "2dk", "1:30x" gibi girdilerde sondaki çöpü sessizce yutup
       geçerli sayıyordu — kullanıcı yanlış aralıkla 30 dakika bekliyordu. */
    if (!/^\d+(:\d{1,2}){0,2}([.,]\d+)?$/.test(str)) return null;
    var parts = str.split(":"), val = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseFloat(parts[i].replace(",", "."));
      if (isNaN(n) || n < 0) return null;
      val = val * 60 + n;
    }
    return val;
  }
  // Panel girdilerinden aralık okur. İkisi de boşsa null (= tüm video).
  function getRange() {
    var sHam = String(($("rangeStart") && $("rangeStart").value) || "").trim();
    var eHam = String(($("rangeEnd") && $("rangeEnd").value) || "").trim();
    var s = parseTime(sHam), e = parseTime(eHam);
    /* Yanlış yazım ("1:00-2:00", "1;30", "bir dakika") sessizce TÜM videoyu işletiyordu:
       kullanıcı 30 dakika bekleyip yanlış sonuç alıyordu. Artık açıkça hata verilir. */
    if (sHam && s == null) throw new Error("Başlangıç süresi anlaşılmadı: “" + sHam + "”. Örnek: 1:30");
    if (eHam && e == null) throw new Error("Bitiş süresi anlaşılmadı: “" + eHam + "”. Örnek: 2:45");
    if (s == null && e == null) return null;
    var start = (s == null) ? 0 : s;
    var end = (e == null) ? Infinity : e;
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
  /* MIX: konuşma kanallarını (A1 + A2) TEK wav'da birleştirir — A3 oyun sesidir, dahil edilmez.
     Eskiden "Mix" seçilince sessizce sadece A1 yazıya dökülüyordu; arkadaşların altyazıya hiç
     girmiyordu ve uyarı da çıkmıyordu. Kanallardan biri yoksa diğeriyle devam edilir. */
  async function prepAudioMix(name) {
    var range = getRange(), stamp = Date.now();
    var parts = [], cleanup = [], bulunan = [], mixEnd = 0;
    // try/catch TÜM kanal işlemini sarmalı: bir kanalın ffmpeg hatası diğerini düşürmemeli.
    for (var t = 0; t < 2; t++) {
      try {
        var data = await getClips(t);
        var used = clipsInRange(data.clips, range);
        if (!used.length) { logLine("Mix: A" + (t + 1) + " seçilen aralıkta boş."); continue; }
        var w = path.join(cfg.workDir, name + "_mix" + t + "_" + stamp + ".wav");
        await pipeline.buildTimelineAudio(used, cfg.ffmpegExe, w, logLine, t);
        parts.push(w); cleanup.push(w); bulunan.push("A" + (t + 1));
        var ke = clipsEnd(used); if (ke > mixEnd) mixEnd = ke;
      } catch (e) { logLine("Mix: A" + (t + 1) + " atlandı (" + friendlyError(e) + ")"); }
    }
    if (!parts.length) { cleanupFiles(cleanup); throw new Error("Mix için A1/A2 kanallarında konuşma bulunamadı."); }
    logLine("Mix: " + bulunan.join(" + ") + " birleştirildi");
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
      var desen = /^(single|a1|a2|ch\d+|acv\d|acvoice|mcues|laned|chan|cuts|cap|sub|cues|fixtext)_[a-z0-9]*_?\d{10,}\./;
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

  // ---------- KONUŞMACIYA GÖRE ----------
  async function runSpeaker() {
    state.genMode = "speaker"; state.singleCues = [];
    pipeline.ensureDir(cfg.workDir);
    setProgress(8, "A1 (sen) okunuyor…");
    var a1 = await getClips(0);
    setProgress(15, "A1 sesi hazırlanıyor…");
    var prep1 = await prepAudio(a1.clips, 0, "a1");
    setProgress(25, "A1 yazıya dökülüyor…");
    _pg.transT0 = Date.now(); _pg.totalSec = prep1.dur || 0;
    state.a1Cues = offsetCues(await pipeline.transcribe(cfg, prep1.wav, function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, 25, 48); },
      trOpts()), prep1.offset);
    cleanupFiles(prep1.cleanup);
    logLine("A1: " + state.a1Cues.length + " satır");

    setProgress(50, "A2 (arkadaşlar) okunuyor…");
    var a2 = await getClips(1);
    setProgress(55, "A2 sesi hazırlanıyor…");
    var prep2 = await prepAudio(a2.clips, 1, "a2");
    // "min3" = en az 3 kişi (alt sınır), "3" = tam 3 kişi, "" = otomatik
    var spkSec = String(($("selNumSpk") && $("selNumSpk").value) || "");
    var spkOpts = { diarize: true };
    // Diarizasyon cihazi: GPU cok daha hizli ama bazi kartlarda (ornegin RTX 50xx) torch kerneli yok.
    if ($("chkDiarGpu")) spkOpts.diarizeDevice = $("chkDiarGpu").checked ? "cuda" : "cpu";
    var mm = spkSec.match(/^min(\d+)$/);
    if (mm) { spkOpts.minSpeakers = parseInt(mm[1], 10); logLine("A2: en az " + mm[1] + " konuşmacıya ayrılacak"); }
    else {
      var nSpk = parseInt(spkSec, 10);
      if (nSpk > 0) { spkOpts.numSpeakers = nSpk; logLine("A2: tam " + nSpk + " konuşmacıya ayrılacak"); }
    }
    setProgress(65, "A2 konuşmacılar ayrılıyor (AI)…");
    _pg.transT0 = Date.now(); _pg.totalSec = prep2.dur || 0;
    state.a2Cues = offsetCues(await pipeline.transcribe(cfg, prep2.wav, function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, 65, 93); },
      trOpts(spkOpts)), prep2.offset);
    cleanupFiles(prep2.cleanup);

    var seen = {}, speakers = [];
    state.a2Cues.forEach(function (c) { if (c.speaker && !seen[c.speaker]) { seen[c.speaker] = 1; speakers.push({ id: c.speaker, sample: c.text, start: c.start }); } });
    /* Konuşmacı ayırma SESSİZ KAYIP koruması: konuşmacısı belirlenemeyen A2 satırlarına stil
       atanamıyor, dolayısıyla timeline'a HİÇ basılmıyorlardı — panel yine "ok" diyordu.
       Artık bu satırlar bir konuşmacıya bağlanır; kullanıcı rengi sonradan değiştirebilir. */
    if (!speakers.length && state.a2Cues.length) {
      speakers.push({ id: "SPEAKER_00", sample: state.a2Cues[0].text, start: state.a2Cues[0].start });
      logLine("UYARI: konuşmacı ayırma sonuç vermedi — tüm A2 satırları tek konuşmacı sayıldı.");
    }
    if (speakers.length) {
      var sahipsiz = 0;
      state.a2Cues.forEach(function (c) { if (!c.speaker) { c.speaker = speakers[0].id; sahipsiz++; } });
      if (sahipsiz) logLine("UYARI: " + sahipsiz + " A2 satırının konuşmacısı belirlenemedi, ilk konuşmacıya atandı.");
    }
    state.speakers = speakers;
    renderSpeakerMap();
    redrawTranscript();
    logLine("A2: " + state.a2Cues.length + " satır, " + speakers.length + " konuşmacı");
    progressDone("Bitti — " + speakers.length + " konuşmacı, " + (state.a1Cues.length + state.a2Cues.length) + " satır");
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
    var raw = await evalES("getAudioTracksJSON()");
    var d; try { d = JSON.parse(raw); } catch (e) { uiAlert("Sekans okunamadı: " + raw, "Kanal tarama"); return; }
    if (d.error === "no_sequence") { uiAlert("Aktif sekans yok. Önce bir sekans aç.", "Kanal tarama"); return; }
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

      var dot = document.createElement("div"); dot.className = "sp-dot"; dot.style.background = speakerColor(i); row.appendChild(dot);

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
    state.genMode = "channels";
    state.singleCues = []; state.a2Cues = []; state.speakers = []; $("speakerMap").hidden = true;
    if (!state.channels.length) throw new Error("Önce “Kanalları Tara” butonuna bas ve kanallara stil ata.");
    var islenecek = aktifKanallar();
    if (!islenecek.length) throw new Error("Hiç kanal seçilmedi. Arkadaşların bulunduğu kanalları işaretle.");
    // Önceki üretimin cue'larını temizle — döngü ortasında hata olursa yeni A1 ile eski
    // kanal altyazıları karışık kalıyordu.
    state.channels.forEach(function (c) { c.cues = []; });
    var atlanan = state.channels.length - islenecek.length;
    if (atlanan) logLine(atlanan + " kanal işaretsiz, atlanıyor (oyun sesi/karışık kanal).");
    pipeline.ensureDir(cfg.workDir);
    var pay = 85 / (1 + islenecek.length);

    setProgress(8, "A1 (sen) okunuyor…");
    var a1 = await getClips(0);
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
      setProgress(lo, kanalAdi(ch) + " yazıya dökülüyor…");
      var data = await getClips(ch.idx);
      var prep = await prepAudio(data.clips, ch.idx, "ch" + ch.idx);
      _pg.transT0 = Date.now(); _pg.totalSec = prep.dur || 0;
      ch.cues = offsetCues(await pipeline.transcribe(cfg, prep.wav,
        (function (a, b) { return function (l) { var p = whenLog(l); if (p >= 0) transProgress(p, a, b); }; })(lo, hi),
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
      fs.writeFileSync(sessionPath(_oturum.name), JSON.stringify(veri), "utf8");
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
      var ak = $("chkAyriKanal");
      if (ak && !ak.checked) {
        ak.checked = true; lsSet("ayriKanal", "1");   // ayar bir sonraki açılışta da kalsın
        if ($("kanalBox")) $("kanalBox").hidden = false;
        if ($("diarizeBox")) $("diarizeBox").hidden = true;
      }
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
  async function offerSessionRestore() {
    if (!CEP || !cfg) return;
    var d;
    try { d = await getClips(0); } catch (e) { return; }     // sekans yoksa sessizce çık
    _oturum.name = d.sequenceName; _oturum.end = clipsEnd(d.clips);
    var p = sessionPath(d.sequenceName);
    if (!fs.existsSync(p)) return;
    var o; try { o = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return; }
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
  function writeCuesMulti(lines) {
    var body = lines.map(function (l) {
      return l.start.toFixed(3) + "|" + l.end.toFixed(3) + "|" + l.mogrt + "|" + String(l.text).replace(/[\r\n|]/g, " ");
    }).join("\n");
    var file = path.join(cfg.workDir, "mcues_" + Date.now() + "_" + (fileCounter++) + ".txt");
    fs.writeFileSync(file, body, "utf8");
    return file;
  }
  function showResult(r) {
    var msg = String(r).replace(/^[a-z_]+:/, "");
    if (String(r).indexOf("ok:") === 0) progressDone("Bitti — " + msg);
    else { progressFail("⚠ " + msg, "warn"); uiAlert(msg, "Sonuç"); }
  }

  // Timeline'a yerleştirir; ham sonuç metnini döndürür (null = iptal, zaten uyarıldı).
  async function placeSingle(range) {
    var stylePath = $("selStyleSingle").value;
    if (stylePath) state.singleStyle = stylePath;   // son gerçek stili hatırla (renk değiştirmede komşu cue'lar için yedek)
    var cues = range ? state.singleCues.filter(function (c) { return c.end > range.start && c.start < range.end; }) : state.singleCues;
    if (!cues.length) { uiAlert("Önce altyazı oluştur."); return null; }
    // Herhangi bir cue renk override taşıyorsa (renk değiştirme), "Düz altyazı" seçili olsa bile
    // MOGRT yolunu kullan — override yok sayılıp caption track dökülmesin.
    var hasOv = false; for (var oi = 0; oi < cues.length; oi++) { if (cues[oi]._ovMogrt) { hasOv = true; break; } }
    if (stylePath || hasOv) {
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
    var body = combined.map(function (c) {
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
    var vt = 0;
    try { vt = (JSON.parse(await evalES("getAudioTracksJSON()")) || {}).videoTracks || 0; } catch (eVt) {}
    if (vt > 0) {
      var izin = Math.max(0, vt - 3);   // en alt video kanalı (senin görüntün) korunur
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

    var body = combined.map(function (c) {
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
    if (state.running) return; state.running = true; state.cancelled = false;
    var btn = this; btn.disabled = true; $("result").hidden = true; $("speakerMap").hidden = true;
    $("log").textContent = ""; progressReset("Başlıyor…");
    $("btnCancel").hidden = false;
    try {
      if (!CEP) await runMock();
      else if (state.mode === "speaker") {
        if ($("chkAyriKanal") && $("chkAyriKanal").checked) await runChannels();
        else await runSpeaker();
      } else await runSingle();
    }
    catch (e) {
      if (state.cancelled) progressFail("İptal edildi", "warn");
      else { progressFail("❌ " + friendlyError(e), "bad"); logLine("HATA: " + (e.message || e)); }
    }
    finally { state.running = false; btn.disabled = false; $("btnCancel").hidden = true; }
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
    var s = String(r), msg = s.replace(/^[a-z_]+:/, "");
    if (s.indexOf("ok:") === 0) { el.textContent = "✓ " + msg; el.style.color = "var(--good)"; }
    else { el.textContent = "⚠ " + msg; el.style.color = "var(--warn)"; }
  }
  function updateRecolorHint() {
    var h = $("recolorHint"); if (!h) return;
    var has = allCues().length;
    if (has) { h.style.color = ""; h.textContent = "İpucu: birden çok klip seçip tek renge çevirebilirsin. Değişiklik geri alınabilir (Ctrl+Z)."; }
    else { h.style.color = "var(--warn)"; h.textContent = "⚠ Önce \"Tek Stil\" veya \"Konuşmacıya Göre\" ile altyazı oluşturup timeline'a ekle — renk değiştirme o listeyi kullanır (panel kapanınca sıfırlanır)."; }
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
    if (_recoloring) return; _recoloring = true;
    if (btn) btn.classList.add("busy");
    var st = $("recolorStatus");
    try {
      var raw = await evalES("getSelectedSubTimes()");
      var times = []; try { times = JSON.parse(raw) || []; } catch (e) {}
      if (!times.length) { uiAlert("Timeline'da altyazı klibi seçili değil. Önce klip(ler)e tıkla, sonra bir renk seç.", "Renk değiştir"); return; }
      var cues = allCues();
      if (!cues.length) { uiAlert("Panelde altyazı listesi boş. Panel kapanınca liste sıfırlanır — o videoyu tekrar 'Altyazı Oluştur'.", "Renk değiştir"); updateRecolorHint(); return; }
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
      await evalES('saveProject()');   // renk değişimi öncesi kaydet (Geri Al için)
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
      await evalES('saveProject()');   // yerleştirmeden önce kaydet (Geri Al için)
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
  function cancelOp() { state.cancelled = true; try { if (pipeline && pipeline.cancelAll) pipeline.cancelAll(); } catch (e) {} }
  $("btnCancel").addEventListener("click", cancelOp);
  $("acCancel").addEventListener("click", cancelOp);

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
    var btn = this; btn.disabled = true; state.cancelled = false; $("acResult").hidden = true; $("acLog").textContent = ""; $("acLabel").style.color = ""; _acMax = 0;
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
      if (state.cancelled) acFail("İptal edildi", "warn");
      else { acFail("❌ " + friendlyError(e), "bad"); acLogLine("HATA: " + (e.message || e)); }
    }
    finally { btn.disabled = false; $("acCancel").hidden = true; }
  });

  $("acCut").addEventListener("click", async function () {
    var btn = this; if (btn.disabled) return;
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de boşluklar kesilir."); return; }
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
    $("selModel").value = cfg.model || "large-v3";
    // Karakter isimleri sözlüğü — sozluk.json yoksa varsayılan (Tofi, Moni, Dora, Mimi, Niko)
    SZ = pipeline.sozluk;
    state.dict = SZ.load(extRoot);
    dictFill();
    if (state.dict.length) logLine("Sözlük: " + SZ.hotwords(state.dict));
    loadStyles();
    fillStyleOptions($("selStyleSingle"), true); preselect($("selStyleSingle"), "tofi");
    fillStyleOptions($("selStyleA1"), false); preselect($("selStyleA1"), "tofi");
    refreshRecolorBtns();   // Renk Değiştir sekmesi buton grid'i
    if (state.styles.length) logLine(state.styles.length + " stil: " + state.styles.map(function (s) { return s.name; }).join(", "));
    try { cleanupOldTemp(); } catch (eTmp) {}            // eski geçici WAV'lar birikmesin
    // Kaydedilmiş oturum varsa geri yüklemeyi teklif et (panel kapanınca liste uçmasın)
    try { offerSessionRestore(); } catch (eSes) {}
    // Konuşmacı ayırma CPU'ya düşmüşse bunu görünür yap — sessizce 5-15 kat yavaşlıyordu
    if (cfg.diarizeDevice !== "cuda") logLine("Not: konuşmacı ayırma CPU'da çalışacak (yavaş). Hızlandırmak için “Konuşmacıya Göre” sekmesindeki GPU kutusunu işaretle.");
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
    var ids = ["acSens", "acMin", "selModel", "selStyleSingle", "selStyleA1", "selNumSpk", "selCensor", "selIstif"];
    for (var i = 0; i < ids.length; i++) { restoreSelect(ids[i]); persistSelect(ids[i]); }
    // AutoCut gürültü azaltma — varsayılan KAPALI (analizi ~5 kat yavaşlatıyor)
    var dn = $("chkDenoise");
    if (dn) { dn.checked = lsGet("denoise", "0") === "1"; dn.addEventListener("change", function () { lsSet("denoise", dn.checked ? "1" : "0"); }); }
    // Sansür eskiden açık/kapalı bir kutuydu; kayıtlı eski değeri yeni üç seviyeye taşı
    if ($("selCensor") && lsGet("selCensor", null) == null) $("selCensor").value = (lsGet("censor", "1") === "1") ? "all" : "off";
    restoreSegs();
    // Ayrı kanal modu toggle'ı — açıkken diarizasyon (AI tahmini) devre dışı kalır
    var ak = $("chkAyriKanal");
    if (ak) {
      ak.checked = lsGet("ayriKanal", "0") === "1";
      var uygula = function (tara) {
        var on = ak.checked;
        if ($("kanalBox")) $("kanalBox").hidden = !on;
        if ($("diarizeBox")) $("diarizeBox").hidden = on;
        var not = $("rsFriendsNote"); if (not) not.textContent = on ? "Her kanal ayrı kişi" : "AI otomatik ayıracak";
        lsSet("ayriKanal", on ? "1" : "0");
        if (on && tara && CEP && cfg) scanChannels();
      };
      ak.addEventListener("change", function () { uygula(true); });
      var dg = $("chkDiarGpu");
      if (dg) {
        dg.checked = lsGet("diarGpu", (cfg && cfg.diarizeDevice === "cuda") ? "1" : "0") === "1";
        dg.addEventListener("change", function () { lsSet("diarGpu", dg.checked ? "1" : "0"); });
      }
      uygula(false);   // ilk yüklemede sadece görünürlük; tarama kullanıcı isteyince
    }
    if ($("btnKanalTara")) $("btnKanalTara").addEventListener("click", function () { scanChannels(); });
  }

  try { if (CEP) initCEP(); else initMock(); wirePersistence(); }
  catch (e) { setPill("pillHost", false); if ($("log")) logLine("Init hatası: " + e.message); }
})();
