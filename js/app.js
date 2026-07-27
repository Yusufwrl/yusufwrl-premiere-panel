/* Yusufwrl Altyazı — panel mantığı (Tek Stil + Konuşmacıya Göre) */
(function () {
  "use strict";
  var CEP = (typeof window.__adobe_cep__ !== "undefined");
  var cs = null, pipeline = null, cfg = null, path = null, fs = null, extRoot = "";
  var SP_COLORS = ["#4b8bff", "#35c26a", "#e0a63a", "#b06dfc", "#3fc6c6", "#ff7ac2", "#e5544b", "#9ac44b",
    "#ff8c42", "#6c5ce7", "#f9ca24", "#48dbfb"];
  var fileCounter = 0;

  var state = { mode: "single", track: "0", running: false, cancelled: false, styles: [],
    singleCues: [], a1Cues: [], a2Cues: [], speakers: [] };

  function $(id) { return document.getElementById(id); }
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
  function trimLog(s) { var lines = String(s).split("\n"); return (lines.length > 200 ? lines.slice(0, 200) : lines).join("\n"); }
  function logLine(msg) { var el = $("log"); var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  function setPill(id, on) { var el = $(id); el.classList.remove("on", "off"); el.classList.add(on ? "on" : "off"); }
  function setProgress(pct, label) { $("progressBox").hidden = false; if (label) $("progressLabel").textContent = label;
    if (pct >= 0) { $("progressFill").style.width = pct + "%"; $("progressPct").textContent = Math.round(pct) + "%"; } }
  function esPath(p) { return String(p).replace(/\\/g, "\\\\"); }
  function evalES(code) { return new Promise(function (res) { if (!cs) { res('{"error":"no_cep"}'); return; } cs.evalScript(code, function (r) { res(r); }); }); }
  function speakerColor(i) { return SP_COLORS[i % SP_COLORS.length]; }
  function fmtShort(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec % 60); return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  function whenLog(line) { var s = String(line).trim(); if (s) logLine(s.length > 80 ? s.slice(-80) : s); var mm = s.match(/(\d+)%/); return mm ? +mm[1] : -1; }

  // ---------- mod ve track ----------
  var modeBtns = document.querySelectorAll("#segMode .seg-btn");
  for (var i = 0; i < modeBtns.length; i++) modeBtns[i].addEventListener("click", function () {
    document.querySelector("#segMode .seg-btn.active").classList.remove("active");
    this.classList.add("active"); state.mode = this.dataset.mode; lsSet("mode", state.mode);
    $("panelSingle").hidden = (state.mode !== "single");
    $("panelSpeaker").hidden = (state.mode !== "speaker");
    $("result").hidden = true; $("speakerMap").hidden = true;
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
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].textContent.toLowerCase().indexOf(nameLike) >= 0) { sel.selectedIndex = i; return true; }
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
          if (v) { cue.text = v; if (cue._ref) cue._ref.text = v; }   // _ref: konuşmacı modunda state.a1/a2Cues'a köprü
          else node.textContent = cue.text;
        });
        node.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); node.blur(); } });
      })(c, x);
      row.appendChild(x);
      box.appendChild(row);
    });
    $("result").hidden = false;
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
    var s = parseTime($("rangeStart") && $("rangeStart").value);
    var e = parseTime($("rangeEnd") && $("rangeEnd").value);
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
    if (!range) return { wav: wav, offset: 0, cleanup: [wav] };
    var wav2 = path.join(cfg.workDir, name + "_r_" + stamp + ".wav");
    await pipeline.trimWav(wav, wav2, range.start, range.end, cfg.ffmpegExe);
    logLine("[aralık] " + fmtShort(range.start) + (isFinite(range.end) ? " → " + fmtShort(range.end) : " → son"));
    return { wav: wav2, offset: range.start, cleanup: [wav, wav2] };
  }
  function offsetCues(cues, off) {
    if (off) for (var i = 0; i < cues.length; i++) { cues[i].start += off; cues[i].end += off; }
    return cues;
  }
  function cleanupFiles(list) { for (var i = 0; i < list.length; i++) { try { fs.unlinkSync(list[i]); } catch (e) {} } }

  // ---------- TEK STİL ----------
  async function runSingle() {
    var trackIdx = (state.track === "mix") ? 0 : parseInt(state.track, 10);
    setProgress(8, "Sekans okunuyor…");
    var data = await getClips(trackIdx);
    logLine(data.sequenceName + " · " + data.clips.length + " klip");
    pipeline.ensureDir(cfg.workDir);
    setProgress(20, "Ses hazırlanıyor…");
    var prep = await prepAudio(data.clips, trackIdx, "single");
    setProgress(45, "Yazıya dökülüyor (GPU)…");
    var cues = await pipeline.transcribe(cfg, prep.wav, function (l) { var p = whenLog(l); if (p >= 0) setProgress(45 + Math.min(50, p * 0.5)); },
      { model: $("selModel").value, language: cfg.language, diarize: false, censor: ($("chkCensor") && $("chkCensor").checked) });
    offsetCues(cues, prep.offset);
    cleanupFiles(prep.cleanup);
    state.singleCues = cues; state.speakers = []; $("speakerMap").hidden = true;
    renderTranscript(cues, null);
    setProgress(100, "Bitti ✓");
  }

  // ---------- KONUŞMACIYA GÖRE ----------
  async function runSpeaker() {
    pipeline.ensureDir(cfg.workDir);
    setProgress(8, "A1 (sen) okunuyor…");
    var a1 = await getClips(0);
    setProgress(15, "A1 sesi hazırlanıyor…");
    var prep1 = await prepAudio(a1.clips, 0, "a1");
    setProgress(25, "A1 yazıya dökülüyor…");
    state.a1Cues = offsetCues(await pipeline.transcribe(cfg, prep1.wav, function (l) { whenLog(l); },
      { model: $("selModel").value, language: cfg.language, diarize: false, censor: ($("chkCensor") && $("chkCensor").checked) }), prep1.offset);
    cleanupFiles(prep1.cleanup);
    logLine("A1: " + state.a1Cues.length + " satır");

    setProgress(50, "A2 (arkadaşlar) okunuyor…");
    var a2 = await getClips(1);
    setProgress(55, "A2 sesi hazırlanıyor…");
    var prep2 = await prepAudio(a2.clips, 1, "a2");
    var numSpk = parseInt($("selNumSpk") && $("selNumSpk").value, 10) || 0;
    if (numSpk > 0) logLine("A2: " + numSpk + " konuşmacıya ayrılacak");
    setProgress(65, "A2 konuşmacılar ayrılıyor (AI)…");
    state.a2Cues = offsetCues(await pipeline.transcribe(cfg, prep2.wav, function (l) { var p = whenLog(l); if (p >= 0) setProgress(65 + Math.min(30, p * 0.3)); },
      { model: $("selModel").value, language: cfg.language, diarize: true, censor: ($("chkCensor") && $("chkCensor").checked), numSpeakers: numSpk }), prep2.offset);
    cleanupFiles(prep2.cleanup);

    var seen = {}, speakers = [];
    state.a2Cues.forEach(function (c) { if (c.speaker && !seen[c.speaker]) { seen[c.speaker] = 1; speakers.push({ id: c.speaker, sample: c.text, start: c.start }); } });
    state.speakers = speakers;
    renderSpeakerMap();

    var color = {}; speakers.forEach(function (s, i) { color[s.id] = speakerColor(i); }); color["__A1__"] = "#e5544b";
    var all = state.a1Cues.map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: "__A1__", _ref: c }; })
      .concat(state.a2Cues.map(function (c) { return { start: c.start, end: c.end, text: c.text, speaker: c.speaker, _ref: c }; }));
    all.sort(function (a, b) { return a.start - b.start; });
    renderTranscript(all, color);
    logLine("A2: " + state.a2Cues.length + " satır, " + speakers.length + " konuşmacı");
    setProgress(100, "Bitti ✓");
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
    if (String(r).indexOf("ok:") === 0) { $("progressLabel").textContent = "✓ " + msg; $("progressLabel").style.color = "var(--good)"; }
    else { $("progressLabel").textContent = "⚠ " + msg; $("progressLabel").style.color = "var(--warn)"; uiAlert(msg, "Sonuç"); }
    $("progressBox").hidden = false;
  }

  async function placeSingle(range) {
    var stylePath = $("selStyleSingle").value;
    var cues = range ? state.singleCues.filter(function (c) { return c.end > range.start && c.start < range.end; }) : state.singleCues;
    if (!cues.length) { uiAlert("Önce altyazı oluştur."); return; }
    $("progressLabel").style.color = ""; $("progressBox").hidden = false;
    $("progressLabel").textContent = "Timeline'a ekleniyor…";
    if (stylePath) {
      var file = writeCuesMulti(cues.map(function (c) { return { start: c.start, end: c.end, mogrt: (c._ovMogrt || stylePath), text: c.text }; }));
      showResult(await evalES('addMultiStyleSubtitles("' + esPath(file) + '",-1)'));
    } else {
      var srtFile = path.join(cfg.workDir, "cap_" + Date.now() + ".srt");
      fs.writeFileSync(srtFile, pipeline.cuesToSrt(state.singleCues), "utf8");
      showResult(await evalES('addCaptionsToTimeline("' + esPath(srtFile) + '")'));
    }
  }
  async function placeSpeaker(range) {
    var a1Style = $("selStyleA1").value;
    var spStyle = {}; state.speakers.forEach(function (sp) { spStyle[sp.id] = sp.styleSel.value; });
    var _gap = 130; var _sg = $("stackGap"); if (_sg) _gap = parseInt(_sg.value, 10) || 130;

    // Yerleştirilecek A1 aralıkları — A2'nin A1 ile üst üste GELİP GELMEDİĞİNİ bulmak için.
    var a1Iv = [];
    state.a1Cues.forEach(function (c) { if (c._ovMogrt || a1Style) a1Iv.push([c.start, c.end]); });
    function overlapsA1(s, e) { for (var i = 0; i < a1Iv.length; i++) { if (a1Iv[i][0] < e && a1Iv[i][1] > s) return true; } return false; }

    // A1 = üst track (lane 0), kayma 0. A2 = alt track (lane 1); SADECE A1 ile aynı anda
    // görünüyorsa (çakışıyorsa) ekranda _gap kadar yukarı kayar (çakışma okunmaz olmasın),
    // çakışmıyorsa normal konumda kalır ("ekran aynı kalsın").
    var combined = [];
    state.a1Cues.forEach(function (c) { var mg = c._ovMogrt || a1Style; if (mg) combined.push({ start: c.start, end: c.end, mogrt: mg, text: c.text, lane: 0, shift: 0 }); });
    state.a2Cues.forEach(function (c) { var mg = c._ovMogrt || spStyle[c.speaker]; if (mg) combined.push({ start: c.start, end: c.end, mogrt: mg, text: c.text, lane: 1, shift: overlapsA1(c.start, c.end) ? _gap : 0 }); });
    if (range) combined = combined.filter(function (c) { return c.end > range.start && c.start < range.end; });
    if (!combined.length) { uiAlert("Stil atanmadı."); return; }

    combined.sort(function (a, b) { return a.start - b.start; });
    var body = combined.map(function (c) {
      return c.start.toFixed(3) + "|" + c.end.toFixed(3) + "|" + c.mogrt + "|" + c.lane + "|" + c.shift + "|" + String(c.text).replace(/[\r\n|]/g, " ");
    }).join("\n");
    var file = path.join(cfg.workDir, "laned_" + Date.now() + ".txt");
    fs.writeFileSync(file, body, "utf8");
    $("progressBox").hidden = false; $("progressLabel").style.color = ""; $("progressLabel").textContent = "Timeline'a ekleniyor…";
    logLine(combined.length + " altyazı · A1 üst / A2 alt (çakışanlar istiflenir)");
    showResult(await evalES('addLanedSubtitles("' + esPath(file) + '")'));
  }

  // ---------- butonlar ----------
  $("btnRun").addEventListener("click", async function () {
    if (state.running) return; state.running = true; state.cancelled = false;
    var btn = this; btn.disabled = true; $("result").hidden = true; $("speakerMap").hidden = true;
    $("log").textContent = ""; $("progressLabel").style.color = ""; setProgress(0, "Başlıyor…");
    $("btnCancel").hidden = false;
    try { if (!CEP) await runMock(); else if (state.mode === "speaker") await runSpeaker(); else await runSingle(); }
    catch (e) {
      if (state.cancelled) { setProgress(-1, "İptal edildi"); $("progressLabel").style.color = "var(--warn)"; }
      else { setProgress(-1, "❌ " + (e.message || e)); $("progressLabel").style.color = "var(--bad)"; logLine("HATA: " + (e.message || e)); }
    }
    finally { state.running = false; btn.disabled = false; $("btnCancel").hidden = true; }
  });
  // Timeline'da SEÇİLİ altyazıların rengini değiştir — GÜVENLİ yol: seçili kliplerin
  // zamanlarını al, panel cue listesinde eşle, o cue'lara renk override ata ve TÜM bölgeyi
  // temiz yeniden yerleştir (importMGT'nin komşuyu ezme sorununa girmeden).
  (function () {
    var b = $("btnRecolor"); if (!b) return;
    b.addEventListener("click", async function () {
      if (b.disabled) return;
      var mg = $("selRecolor") && $("selRecolor").value;
      if (!mg) { uiAlert("Önce bir renk/stil seç.", "Renk değiştir"); return; }
      var raw = await evalES("getSelectedSubTimes()");
      var times = []; try { times = JSON.parse(raw) || []; } catch (e) {}
      if (!times.length) { uiAlert("Timeline'da altyazı klibi seçili değil. Önce klip(ler)e tıkla, sonra Değiştir'e bas.", "Renk değiştir"); return; }
      var cues = (state.mode === "speaker") ? state.a1Cues.concat(state.a2Cues) : state.singleCues;
      if (!cues.length) { uiAlert("Panelde altyazı listesi boş. Panel kapanınca liste sıfırlanır — o videoyu tekrar 'Altyazı Oluştur'.", "Renk değiştir"); return; }
      var matched = [];
      for (var t = 0; t < times.length; t++) {
        var best = null, bd = 0.3;
        for (var i = 0; i < cues.length; i++) { var d = Math.abs(cues[i].start - times[t]); if (d < bd) { bd = d; best = cues[i]; } }
        if (best) { best._ovMogrt = mg; matched.push(best); }
      }
      if (!matched.length) { uiAlert("Seçili klipler panel listesindeki altyazılarla eşleşmedi (aynı sekans ve aynı oluşturma mı?).", "Renk değiştir"); return; }
      // SADECE seçili bölgeyi yeniden yerleştir (hız) — tüm altyazıları değil.
      var spanStart = matched[0].start, spanEnd = matched[0].end;
      for (var mI = 1; mI < matched.length; mI++) { if (matched[mI].start < spanStart) spanStart = matched[mI].start; if (matched[mI].end > spanEnd) spanEnd = matched[mI].end; }
      var range = { start: spanStart - 0.05, end: spanEnd + 0.05 };
      b.disabled = true;
      logLine(matched.length + " altyazının rengi değiştiriliyor…");
      try { if (state.mode === "speaker") await placeSpeaker(range); else await placeSingle(range); }
      catch (e) { showResult("err:" + (e.message || e)); }
      finally { b.disabled = false; }
    });
  })();
  $("btnAddTimeline").addEventListener("click", async function () {
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de timeline'a eklenir."); return; }
    var btn = this; if (btn.disabled) return; btn.disabled = true;   // çift-tık koruması (mükerrer yerleştirmeyi önler)
    try {
      await evalES('saveProject()');   // yerleştirmeden önce kaydet (Geri Al için)
      if (state.mode === "speaker") await placeSpeaker(); else await placeSingle();
    }
    catch (e) { uiAlert((e.message || e) + "", "Hata"); }
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
    if (state.mode === "speaker") {
      var all = state.a1Cues.concat(state.a2Cues).map(function (c) { return { start: c.start, end: c.end, text: c.text }; });
      all.sort(function (a, b) { return a.start - b.start; }); return all;
    }
    return state.singleCues;
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
  var acCuts = [], acLast = null;
  function acSetProgress(pct, label) { $("acProgress").hidden = false; if (label) $("acLabel").textContent = label; if (pct >= 0) { $("acFill").style.width = pct + "%"; $("acPct").textContent = Math.round(pct) + "%"; } }
  function acLogLine(msg) { var el = $("acLog"); var t = new Date().toLocaleTimeString(); el.textContent = trimLog("[" + t + "] " + msg + "\n" + el.textContent); }
  $("acLogToggle").addEventListener("click", function () { var l = $("acLog"); l.hidden = !l.hidden; this.textContent = l.hidden ? "Ayrıntılar ▾" : "Ayrıntılar ▴"; });

  $("acAnalyze").addEventListener("click", async function () {
    if (!CEP) {
      acCuts = [{ start: 1, end: 2 }, { start: 5, end: 8 }];
      $("acCount").textContent = "142"; $("acSaved").textContent = "178 sn"; $("acResult").hidden = false;
      acSetProgress(100, "Bitti ✓ (önizleme)"); return;
    }
    var btn = this; btn.disabled = true; state.cancelled = false; $("acResult").hidden = true; $("acLog").textContent = ""; $("acLabel").style.color = "";
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
      var opts = { sensitivity: parseFloat($("acSens").value), minSilence: parseFloat($("acMin").value) };
      var res = await pipeline.analyzeSilence(cfg, voice, function (l) { var s = String(l).trim(); if (s) acLogLine(s); }, opts);
      try { fs.unlinkSync(voice); } catch (e) {}
      acCuts = res.cuts; acLast = res;
      $("acCount").textContent = res.count;
      // küçük toplamlarda 0 sn görünmesin: 1 sn altında ondalık göster
      $("acSaved").textContent = (res.totalCut >= 1 ? Math.round(res.totalCut) : res.totalCut.toFixed(1)) + " sn";
      $("acResult").hidden = false;
      acSetProgress(100, "Analiz bitti ✓ (eşik " + res.threshold + "dB)");
    } catch (e) {
      if (state.cancelled) { acSetProgress(-1, "İptal edildi"); $("acLabel").style.color = "var(--warn)"; }
      else { acSetProgress(-1, "❌ " + (e.message || e)); $("acLabel").style.color = "var(--bad)"; acLogLine("HATA: " + (e.message || e)); }
    }
    finally { btn.disabled = false; $("acCancel").hidden = true; }
  });

  $("acCut").addEventListener("click", async function () {
    var btn = this; if (btn.disabled) return;
    if (!CEP) { uiAlert("Önizleme modu. Premiere'de boşluklar kesilir."); return; }
    if (!acCuts.length) { uiAlert("Önce Analiz Et."); return; }
    var _sec = acLast ? acLast.totalCut : 0;
    var _secTxt = _sec >= 1 ? Math.round(_sec) + " sn" : _sec.toFixed(1) + " sn";
    if (!(await uiConfirm(acCuts.length + " boşluk kesilecek (~" + _secTxt + " kısalır).\n\nSekans dışı / kayıt boşluğu olanlar otomatik atlanır. Kesimden ÖNCE kaydet; geri almak için Ctrl+Z (birden çok kez gerekebilir).", "Boşlukları Kes"))) return;
    btn.disabled = true;   // çift-tık koruması: kesim sürerken tekrar tetiklenmesin
    try {
      acSetProgress(25, "Proje kaydediliyor…");   // kesimden önce her zaman kaydet (Geri Al için)
      acLogLine("Kaydet: " + (await evalES('saveProject()')));
      var body = acCuts.map(function (c) { return c.start.toFixed(3) + "|" + c.end.toFixed(3); }).join("\n");
      var file = path.join(cfg.workDir, "cuts_" + Date.now() + ".txt");
      fs.writeFileSync(file, body, "utf8");
      acSetProgress(50, "Kesiliyor… (başladıktan sonra durdurulamaz)"); $("acLabel").style.color = "";
      var r = await evalES('autoCut("' + esPath(file) + '")');
      acLogLine("Sonuç: " + r);
      var msg = String(r).replace(/^[a-z_]+:/, "");
      if (String(r).indexOf("ok:") === 0) { acSetProgress(100, "✓ " + msg); $("acLabel").style.color = "var(--good)"; }
      else { acSetProgress(-1, "⚠ " + msg); $("acLabel").style.color = "var(--warn)"; uiAlert(msg, "Sonuç"); }
    } finally { btn.disabled = false; }
  });

  // ---------- MOCK (tarayıcı önizleme) ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function runMock() {
    var steps = state.mode === "speaker"
      ? [[15, "A1 yazıya dökülüyor…"], [45, "A2 okunuyor…"], [70, "Konuşmacılar ayrılıyor (AI)…"], [95, "Bitiriliyor…"]]
      : [[20, "Ses hazırlanıyor…"], [55, "Yazıya dökülüyor (GPU)…"], [90, "Bitiriliyor…"]];
    for (var k = 0; k < steps.length; k++) { setProgress(steps[k][0], steps[k][1]); logLine(steps[k][1]); await sleep(500); }
    setProgress(100, "Bitti ✓ (önizleme)");
    if (state.mode === "speaker") {
      state.speakers = [{ id: "SPEAKER_00", sample: "Ya nasıl sahte ya" }, { id: "SPEAKER_01", sample: "Gelme sen gelme" }];
      renderSpeakerMap();
      var color = { SPEAKER_00: speakerColor(0), SPEAKER_01: speakerColor(1), __A1__: "#e5544b" };
      renderTranscript([
        { start: 0, text: "Hepinize merhaba", speaker: "__A1__" },
        { start: 3, text: "Gelme sen gelme", speaker: "SPEAKER_01" },
        { start: 5, text: "Ya nasıl sahte ya", speaker: "SPEAKER_00" },
        { start: 8, text: "İnceleyin işte", speaker: "SPEAKER_00" }
      ], color);
    } else {
      renderTranscript([
        { start: 0, text: "Hepinize merhaba" }, { start: 2, text: "arkadaşlar" },
        { start: 3, text: "Bugün var ya" }, { start: 5, text: "harika bir şey" }
      ], null);
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
    loadStyles();
    fillStyleOptions($("selStyleSingle"), true); preselect($("selStyleSingle"), "tofi");
    fillStyleOptions($("selStyleA1"), false); preselect($("selStyleA1"), "tofi");
    fillStyleOptions($("selRecolor"), false); preselect($("selRecolor"), "tofi");
    if (state.styles.length) logLine(state.styles.length + " stil: " + state.styles.map(function (s) { return s.name; }).join(", "));
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
    state.styles = [{ name: "Tofi Text", path: "tofi" }, { name: "Moni Text", path: "moni" }];
    fillStyleOptions($("selStyleSingle"), true); preselect($("selStyleSingle"), "tofi");
    fillStyleOptions($("selStyleA1"), false); preselect($("selStyleA1"), "tofi");
  }

  // Select'leri kalıcılaştır + kaydedilmişi geri yükle (init sonrası — seçenekler dolmuş olur)
  function wirePersistence() {
    var ids = ["acSens", "acMin", "selModel", "selStyleSingle", "selStyleA1", "selNumSpk"];
    for (var i = 0; i < ids.length; i++) { restoreSelect(ids[i]); persistSelect(ids[i]); }
    restoreSegs();
    // Küfür sansürü toggle — varsayılan AÇIK
    var cc = $("chkCensor");
    if (cc) { cc.checked = lsGet("censor", "1") === "1"; cc.addEventListener("change", function () { lsSet("censor", cc.checked ? "1" : "0"); }); }
    // istif aralığı kaydırıcısı (konuşmacı modu) — kalıcı + canlı etiket
    var sg = $("stackGap"), lbl = $("stackGapVal");
    if (sg) {
      var sv = lsGet("stackGap", null); if (sv != null) sg.value = sv;
      function updSg() { if (lbl) lbl.textContent = sg.value + "px"; }
      updSg();
      sg.addEventListener("input", function () { updSg(); lsSet("stackGap", sg.value); });
    }
  }

  try { if (CEP) initCEP(); else initMock(); wirePersistence(); }
  catch (e) { setPill("pillHost", false); if ($("log")) logLine("Init hatası: " + e.message); }
})();
