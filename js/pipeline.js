/*
 * Node.js işlem hattı (CEP nodejs açık olmalı).
 * ffmpeg ile ses hazırlar, Whisper ile yazıya döker (opsiyonel konuşmacı ayırma),
 * 2-3 kelimelik cue nesneleri üretir (renk/konuşmacı bilgisi taşır).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Çalışan ffmpeg/whisper süreçleri (İptal için)
const _procs = [];
function cancelAll() {
  const n = _procs.length;
  for (let i = 0; i < _procs.length; i++) { try { _procs[i].kill(); } catch (e) {} }
  _procs.length = 0;
  return n;
}

// config.json'u okur ve TAŞINABİLİR yollar üretir.
// Yollarda %ENGINE% / %USERPROFILE% / ~ jetonları kullanılır; burada gerçek yola çevrilir.
// %ENGINE% = kurulumda yazılan engine-root.txt (varsa), yoksa %USERPROFILE%\YusufwrlEngine.
// Böylece config.json her makinede aynı kalır; kullanıcı adı ne olursa olsun çalışır
// ve oto-güncelleme config'i ezse bile bozulmaz.
function loadConfig(extRoot) {
  var os = require("os");
  var rawCfg = fs.readFileSync(path.join(extRoot, "config.json"), "utf8");
  if (rawCfg.charCodeAt(0) === 0xFEFF) rawCfg = rawCfg.slice(1); // BOM'a dayaniklilik
  var cfg = JSON.parse(rawCfg);
  var home = os.homedir();
  var engineRoot = "";
  try {
    var erf = path.join(extRoot, "engine-root.txt");
    if (fs.existsSync(erf)) engineRoot = fs.readFileSync(erf, "utf8").trim();
  } catch (e) {}
  if (!engineRoot) engineRoot = path.join(home, "YusufwrlEngine");
  function exp(v) {
    if (typeof v !== "string") return v;
    v = v.split("%ENGINE%").join(engineRoot);
    v = v.split("%USERPROFILE%").join(home).split("%HOME%").join(home);
    if (v.charAt(0) === "~" && (v.charAt(1) === "/" || v.charAt(1) === "\\")) v = home + v.slice(1);
    return v;
  }
  var out = {};
  for (var k in cfg) { if (cfg.hasOwnProperty(k)) out[k] = exp(cfg[k]); }
  out._engineRoot = engineRoot;
  return out;
}
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

// spawn -> Promise. o = { cwd, pathDirs, logFile }
function run(exe, args, onLog, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const opts = { windowsHide: true };
    if (o.cwd) opts.cwd = o.cwd;
    if (o.pathDirs && o.pathDirs.length) {
      opts.env = Object.assign({}, process.env, { PATH: o.pathDirs.join(";") + ";" + (process.env.PATH || "") });
    }
    let buf = "";
    function cap(d) { const s = d.toString(); buf += s; if (onLog) onLog(s); }
    function dump(tail) { if (o.logFile) { try { fs.writeFileSync(o.logFile, buf + (tail || ""), "utf8"); } catch (e) {} } }
    let proc;
    try { proc = spawn(exe, args, opts); }
    catch (e) { dump("\nSPAWN HATASI: " + e.message); reject(e); return; }
    _procs.push(proc);
    function unreg() { const ix = _procs.indexOf(proc); if (ix >= 0) _procs.splice(ix, 1); }
    proc.stdout.on("data", cap);
    proc.stderr.on("data", cap);
    proc.on("error", (e) => { unreg(); dump("\nSPAWN HATASI: " + e.message); reject(e); });
    proc.on("close", (code) => {
      unreg();
      dump("\nÇIKIŞ KODU: " + code);
      if (code === 0) resolve();
      else reject(new Error(exe + " çıkış kodu " + code +
        (buf.trim() ? "\n" + buf.slice(-1200) : " (motor çıktı vermeden çöktü — DLL hatası olabilir)")));
    });
  });
}

/* Tek parça (klip grubu) -> timeline'a hizalı 16kHz mono WAV. Tüm klipler ffmpeg'e argüman
   olur, o yüzden ÇAĞIRAN parça boyutunu komut satırı sınırının altında tutmalı (bkz. _chunkSize). */
async function _renderTimelineChunk(clips, ffmpegExe, outWav, sIdx) {
  const inputArgs = [], filters = [], labels = [];
  clips.forEach((c, i) => {
    const inPoint = Math.max(0, c.inPointSec || 0);
    inputArgs.push("-ss", String(inPoint), "-t", String(c.durationSec), "-i", c.mediaPath);
    const delayMs = Math.round(Math.max(0, c.timelineStartSec || 0) * 1000);
    filters.push(`[${i}:a:${sIdx}]aresample=16000,adelay=${delayMs}|${delayMs}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  let filterComplex, mapLabel;
  if (clips.length === 1) { filterComplex = filters[0]; mapLabel = "[a0]"; }
  else { filterComplex = filters.join(";") + ";" + labels.join("") + `amix=inputs=${clips.length}:normalize=0[mix]`; mapLabel = "[mix]"; }
  const args = [...inputArgs, "-filter_complex", filterComplex, "-map", mapLabel,
    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav];
  await run(ffmpegExe, args, null, { cwd: path.dirname(ffmpegExe) });
  if (!fs.existsSync(outWav)) throw new Error("WAV üretilemedi: " + outWav);
  return outWav;
}

// Windows komut satırı sınırına (~32767 karakter) takılmadan bir ffmpeg çağrısına kaç klip
// sığdırılabilir? Yol uzunluğuna göre uyarlanır; güvenli tarafta kalınır.
function _chunkSize(clips) {
  let sum = 0;
  for (let i = 0; i < clips.length; i++) sum += (clips[i].mediaPath || "").length;
  const avgPath = clips.length ? (sum / clips.length) : 60;
  const perClip = avgPath + 95;   // -ss/-t/-i bayrakları + filter_complex payı
  const n = Math.floor(22000 / perClip);   // 32767'nin güvenli altı
  return Math.max(20, Math.min(100, n));
}

/* clips -> timeline'a hizalı 16kHz mono WAV. streamIndex = ses akışı (0=A1,1=A2,2=A3).
   Çok klipli timeline'da (ör. 300+ klip) tek ffmpeg komutu Windows sınırını aşıp
   "spawn ENAMETOOLONG" verir; bu yüzden klipler parçalara bölünür, her parça tam-uzunluk
   konumlandırılmış WAV üretir, sonra parçalar amix (mixWavs) ile birleştirilir. */
async function buildTimelineAudio(clips, ffmpegExe, outWav, onLog, streamIndex) {
  const sIdx = Number.isInteger(streamIndex) ? streamIndex : 0;
  const valid = clips.filter((c) => c.mediaPath && c.durationSec > 0);
  if (valid.length === 0) throw new Error("Bu kanalda ses klibi bulunamadı.");
  if (onLog) onLog("[ffmpeg] ses hazırlanıyor (" + valid.length + " klip)...\n");

  const chunkN = _chunkSize(valid);
  if (valid.length <= chunkN) {
    await _renderTimelineChunk(valid, ffmpegExe, outWav, sIdx);
    return outWav;
  }

  // Çok klip: parça parça üret, sonra birleştir.
  const dir = path.dirname(outWav);
  const base = path.basename(outWav, path.extname(outWav));
  const parts = [];
  try {
    for (let start = 0, ci = 0; start < valid.length; start += chunkN, ci++) {
      const chunk = valid.slice(start, start + chunkN);
      const partWav = path.join(dir, base + "__part" + ci + ".wav");
      await _renderTimelineChunk(chunk, ffmpegExe, partWav, sIdx);
      parts.push(partWav);
      if (onLog) onLog("[ffmpeg] parça " + (ci + 1) + "/" + Math.ceil(valid.length / chunkN) + " (" + chunk.length + " klip)\n");
    }
    await mixWavs(parts, ffmpegExe, outWav);
  } finally {
    for (let i = 0; i < parts.length; i++) { try { fs.unlinkSync(parts[i]); } catch (e) {} }
  }
  if (!fs.existsSync(outWav)) throw new Error("WAV üretilemedi: " + outWav);
  return outWav;
}

// saniye -> "HH:MM:SS,mmm"
function fmtTime(t) {
  if (!isFinite(t) || t < 0) t = 0;
  var ms = Math.round(t * 1000);
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var s = Math.floor(ms / 1000); ms -= s * 1000;
  function p(n, l) { n = String(n); while (n.length < l) n = "0" + n; return n; }
  return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms, 3);
}

// Noktalamayı temizler; SADECE ! ve ? kalır. Rakam-içi noktalama (3.5, 14:30, 1.000) ve
// kelime-içi tire (e-posta, 16-9) korunur.
function cleanPunct(s) {
  s = String(s);
  // rakam-içi ayıraçları geçici işaretle (silinmesin)
  s = s.replace(/(\d)\.(\d)/g, "$1@DOT@$2").replace(/(\d),(\d)/g, "$1@COM@$2").replace(/(\d):(\d)/g, "$1@COL@$2");
  // noktalamayı temizle (ASCII tire hariç)
  s = s.replace(/[.,;:…"“”«»()\[\]\{\}—–]/g, " ");
  // yalnız kenar/başıboş tireleri temizle; kelime-içi tire kalır
  s = s.replace(/(^|\s)-+|-+(\s|$)/g, " ");
  // işaretlenen rakam-içi ayıraçları geri yaz
  s = s.replace(/@DOT@/g, ".").replace(/@COM@/g, ",").replace(/@COL@/g, ":");
  s = s.replace(/\s+([!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return s;
}

// Türkçe küçük harf (JS toLowerCase 'I'->'i' verir; Türkçe'de I->ı, İ->i olmalı)
function _trLower(s) { return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase(); }

// Küfür/hakaret kökleri (4+ harf, düşük yanlış-pozitif; _trLower normalinde). Kısa/riskli kökler
// (am/sik/mal/göt vb.) prefix ile ASLA kullanılmaz — masum kelimeleri sansürler.
var _PROFANITY_ROOTS = ["orospu", "piç", "yavşa", "pezevenk", "kahpe", "kaltak", "gavat", "siktir",
  "sikey", "sikik", "yarrak", "yarak", "puşt", "ibne", "ipne", "şerefsiz", "namussuz", "haysiyetsiz",
  "sürtük", "fahişe", "gerizekalı", "gerzek", "dangalak", "salak", "aptal", "ahmak", "şıllık"];

// Kelimenin ortasını yıldızlar: ilk+son harf açık, ortadakiler '*' (aptal -> a***l). İşaretleri korur.
function _maskWord(w) {
  var letters = String(w).match(/[a-zçğıöşüA-ZÇĞİÖŞÜ]/g) || [];
  var total = letters.length; if (!total) return w;
  var seen = 0, out = "";
  for (var i = 0; i < w.length; i++) {
    var ch = w.charAt(i);
    if (/[a-zçğıöşüA-ZÇĞİÖŞÜ]/.test(ch)) { seen++; out += (seen === 1 || seen === total) ? ch : "*"; }
    else out += ch;
  }
  return out;
}

// Metindeki küfür/hakaretleri (köke göre prefix eşleşme) maskeler; boşlukları korur.
function censorText(text) {
  var toks = String(text).split(/(\s+)/);
  for (var i = 0; i < toks.length; i++) {
    if (/^\s*$/.test(toks[i])) continue;
    var core = _trLower(toks[i]).replace(/[^a-zçğıöşü]/g, "");
    if (!core) continue;
    for (var r = 0; r < _PROFANITY_ROOTS.length; r++) {
      if (core.indexOf(_PROFANITY_ROOTS[r]) === 0) { toks[i] = _maskWord(toks[i]); break; }
    }
  }
  return toks.join("");
}

// Türkçe soru/enklitik ekleri — önceki kelimeye yapışır.
var _TR_PARTICLES = (function () {
  var list = ["mi","mı","mu","mü","miyim","misin","miyiz","misiniz","mısın","mıyım","mıyız","mısınız",
    "muyum","musun","muyuz","musunuz","müyüm","müsün","müyüz","müsünüz","midir","mıdır","mudur","müdür",
    "miydi","mıydı","muydu","müydü","miydim","miydin","mıydım","mıydın","muydum","muydun","müydüm","müydün",
    "miymiş","mıymış","muymuş","müymüş","mıydık","miydik","muyduk","müydük"];
  var s = {}; for (var i = 0; i < list.length; i++) s[list[i]] = true; return s;
})();

// Türkçe dolgu/söz kelimeleri — önceki kelimeye yapışır ki ayrı cue'ya düşmesin.
// "gördün mü ya", "kitap falan", "oldu yani" gibi. Cümle başındaki "ya"/"yani" için
// birleştirme koşullu yapılır (önceki kelime cümle sonu değilse, aynı konuşmacı, kısa boşluk).
var _TR_FILLERS = (function () {
  var list = ["ya", "falan", "filan", "işte", "yani"];
  var s = {}; for (var i = 0; i < list.length; i++) s[list[i]] = true; return s;
})();
function _bareWord(s) { return String(s).toLowerCase().replace(/[.,;:!?…"'`()\[\]]/g, ""); }

// Whisper JSON -> düz kelime listesi
function flattenWords(data) {
  var words = [];
  (data.segments || []).forEach(function (seg) {
    (seg.words || []).forEach(function (w) {
      var t = String(w.word).replace(/\s+/g, " ").trim();
      var st = Number(w.start), en = Number(w.end);
      // geçersiz/eksik zaman damgalı kelimeyi ele (null/undefined/NaN → bozuk SRT önlenir)
      if (t && w.start != null && w.end != null && isFinite(st) && isFinite(en)) words.push({ start: st, end: en, word: t, speaker: null });
    });
  });
  return words;
}

// Diarize SRT'sinden [SPEAKER_XX] zaman aralıklarını çıkar
function parseSpeakerIntervals(srt) {
  var intervals = [], blocks = String(srt).replace(/\r/g, "").split(/\n\n+/);
  for (var b = 0; b < blocks.length; b++) {
    var lines = blocks[b].split("\n").filter(function (l) { return l.trim() !== ""; });
    if (lines.length < 2) continue;
    var ti = /-->/.test(lines[0]) ? 0 : 1;
    var m = lines[ti].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!m) continue;
    var start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    var end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    var txt = lines.slice(ti + 1).join(" ");
    var sm = txt.match(/\[(SPEAKER_\d+)\]/i);
    // eşleşme yoksa null: downstream "konuşmacı yok" gibi nötr davranır (tek konuşmacıya sessizce çökmesin)
    intervals.push({ start: start, end: end, speaker: sm ? sm[1].toUpperCase() : null });
  }
  return intervals;
}

// Her kelimeye zamanına göre konuşmacı ata
function assignSpeakers(words, intervals) {
  for (var i = 0; i < words.length; i++) {
    var t = (words[i].start + words[i].end) / 2, best = null, bd = Infinity;
    for (var j = 0; j < intervals.length; j++) {
      var iv = intervals[j];
      if (t >= iv.start && t <= iv.end) { best = iv; break; }
      var d = Math.min(Math.abs(t - iv.start), Math.abs(t - iv.end));
      if (d < bd) { bd = d; best = iv; }
    }
    words[i].speaker = best ? best.speaker : null;
  }
}

// Kelimeleri 2-3 kelimelik cue nesnelerine böl {start,end,text,speaker}. censor=true ise küfür maskelenir.
function buildCues(words, maxWords, censor) {
  var GAP = 0.7; maxWords = maxWords || 3;
  // soru eki birleştir
  var merged = [];
  for (var r = 0; r < words.length; r++) {
    var wr = words[r];
    var bare = _bareWord(wr.word);
    var pv = merged.length > 0 ? merged[merged.length - 1] : null;
    if (pv && _TR_PARTICLES[bare]) {
      // soru eki: koşulsuz yapışır
      pv.word += " " + wr.word; pv.end = wr.end;
    } else if (pv && _TR_FILLERS[bare]
               && !/[.!?…]$/.test(pv.word)                                   // önceki kelime cümleyi bitirmemiş
               && (wr.start - pv.end) <= GAP                                  // araya uzun duraklama girmemiş
               && (!wr.speaker || !pv.speaker || wr.speaker === pv.speaker)) { // aynı konuşmacı
      pv.word += " " + wr.word; pv.end = wr.end;
    } else merged.push({ start: wr.start, end: wr.end, word: wr.word, speaker: wr.speaker });
  }
  // grupla (konuşmacı değişince de böl)
  var groups = [], cur = [];
  function flush() { if (cur.length) { groups.push(cur); cur = []; } }
  for (var i = 0; i < merged.length; i++) {
    var w = merged[i];
    if (cur.length) {
      var prev = cur[cur.length - 1];
      if (w.start - prev.end > GAP) flush();
      else if (w.speaker && prev.speaker && w.speaker !== prev.speaker) flush();
    }
    cur.push(w);
    var hard = /[.!?…:]$/.test(w.word), soft = /,$/.test(w.word);
    if (cur.length >= maxWords || hard || (soft && cur.length >= 2)) flush();
  }
  flush();
  // tek kelimelik cue'yu öncekine bağla (aynı konuşmacı)
  for (var c = groups.length - 1; c > 0; c--) {
    if (groups[c].length === 1 && groups[c - 1].length < maxWords) {
      var a = groups[c][0], bg = groups[c - 1][groups[c - 1].length - 1];
      var sameSp = (!a.speaker || !bg.speaker || a.speaker === bg.speaker);
      if (a.start - bg.end <= GAP && sameSp) { groups[c - 1] = groups[c - 1].concat(groups[c]); groups.splice(c, 1); }
    }
  }
  var cues = [];
  for (var k = 0; k < groups.length; k++) {
    var g = groups[k], start = g[0].start, end = g[g.length - 1].end;
    if (end <= start) end = start + 0.4;
    var text = ""; for (var mm = 0; mm < g.length; mm++) text += (mm ? " " : "") + g[mm].word;
    text = cleanPunct(text);
    if (censor) text = censorText(text);
    if (!text) continue;
    cues.push({ start: start, end: end, text: text, speaker: g[0].speaker || null });
  }
  // Okuma hızı (CPS) + min/max süre + ardıl cue boşluğu (S1/S2):
  // cue çok kısaysa okunacak kadar uzat, çok uzunsa kırp, sonrakine taşma.
  var MIN_GAP = 0.08, MAX_DUR = 7.0, CPS = 17;
  for (var ci = 0; ci < cues.length; ci++) {
    var cu = cues[ci];
    var minDur = Math.max(0.8, cu.text.length / CPS);        // ~17 karakter/saniye
    var target = Math.max(cu.end, cu.start + minDur);         // en az minDur; doğal daha uzunsa koru
    if (target - cu.start > MAX_DUR) target = cu.start + MAX_DUR;
    if (ci + 1 < cues.length) {                              // sonraki cue'ya taşma engeli
      var nextStart = cues[ci + 1].start;
      if (target > nextStart - MIN_GAP) target = nextStart - MIN_GAP;
    }
    cu.end = Math.max(cu.start + 0.05, target);               // en az 0.05 sn görünür kalsın
  }
  return cues;
}

function cuesToSrt(cues) {
  var out = [];
  for (var i = 0; i < cues.length; i++)
    out.push((i + 1) + "\n" + fmtTime(cues[i].start) + " --> " + fmtTime(cues[i].end) + "\n" + cues[i].text);
  return out.join("\n\n") + "\n";
}
function buildShortSrt(data, maxWords) { return cuesToSrt(buildCues(flattenWords(data), maxWords)); }

// saniye -> "M:SS" (1 saatten kısa) veya "H:MM:SS" (YouTube bölüm formatı)
function fmtChapter(t) {
  if (!isFinite(t) || t < 0) t = 0;
  var s = Math.floor(t), h = Math.floor(s / 3600); s -= h * 3600;
  var m = Math.floor(s / 60); s -= m * 60;
  function p(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  return h > 0 ? (h + ":" + p(m) + ":" + p(s)) : (m + ":" + p(s));
}

// cue'ları düz metne çevirir (! veya ? sonrası satır kırar)
function cuesToTxt(cues) {
  var out = "";
  for (var i = 0; i < cues.length; i++) {
    var t = cues[i].text;
    out += (i ? " " : "") + t;
    if (/[!?]$/.test(t)) out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").trim() + "\n";
}

// YouTube bölüm (chapter) zaman damgaları — sabit aralıkla (nokta silindiği için cümle sınırı güvenilmez)
function cuesToChapters(cues, opts) {
  opts = opts || {};
  var iv = opts.interval || 60, minGap = opts.minGap || 10, maxT = opts.maxTitle || 45;
  if (!cues.length) return "";
  var lines = [], lastStart = -999;
  function push(start, txt) { lines.push(fmtChapter(start) + " " + String(txt).slice(0, maxT)); lastStart = start; }
  push(0, cues[0].text);                       // ilk bölüm zorunlu 00:00
  var t = iv;
  while (true) {
    var picked = null;
    for (var i = 0; i < cues.length; i++) { if (cues[i].start >= t) { picked = cues[i]; break; } }
    if (!picked) break;
    if (picked.start - lastStart >= minGap) push(picked.start, picked.text);
    t = Math.floor(picked.start / iv) * iv + iv;
  }
  return lines.join("\n") + "\n";
}

/*
 * Ses -> cue nesneleri. opts = { model, language, diarize, maxWords }
 * diarize true ise cue'lar .speaker (SPEAKER_00...) taşır.
 */
async function transcribe(cfg, wavPath, onLog, opts) {
  opts = opts || {};
  const outDir = path.dirname(wavPath);
  const base = path.basename(wavPath, path.extname(wavPath));
  const args = [
    wavPath,
    "--model", opts.model || cfg.model,
    "--language", opts.language || cfg.language,
    "--device", cfg.device,
    "--compute_type", cfg.computeType || "float16",
    "--task", "transcribe",
    "--word_timestamps", "true",
    "--beep_off",   // motorun bitişte çaldığı bip sesini kapat
  ];
  // Konuşmacı ayırma (pyannote) PyTorch kullanır; bazı GPU'larda "no kernel image" verir
  // (torch o mimari için derlenmemiş). Diarization'ı CPU'da çalıştırırız — her GPU'da güvenli.
  // Ana transkripsiyon (CTranslate2) GPU'da hızlı kalır.
  if (opts.diarize) {
    args.push("--diarize", "pyannote_v3.1", "--diarize_device", "cpu");
    // Otomatik kümeleme benzer sesleri birleştirebilir (5 kişi -> 2). Kullanıcı sayıyı
    // verirse pyannote'u tam o kadar konuşmacıya zorlarız (daha hassas ayırma).
    var ns = parseInt(opts.numSpeakers, 10);
    if (ns > 0) args.push("--num_speakers", String(ns));
    args.push("--output_format", "json", "srt");
  } else args.push("--output_format", "json");
  args.push("--output_dir", outDir);

  const engDir = path.dirname(cfg.engineExe);
  const xxl = path.join(engDir, "_xxl_data");
  const pathDirs = [engDir, xxl, path.join(xxl, "ctranslate2"), path.join(xxl, "torch", "lib")];
  const logFile = path.join(outDir, "engine_last.log");
  const jsonPath = path.join(outDir, base + ".json");
  const srtPath = path.join(outDir, base + ".srt");

  if (onLog) onLog("[whisper] " + (opts.diarize ? "konuşmacı ayırma + " : "") + "yazıya dökülüyor (GPU)...\n");
  try {
    await run(cfg.engineExe, args, onLog, { cwd: engDir, pathDirs: pathDirs, logFile: logFile });
  } catch (e) {
    if (!fs.existsSync(jsonPath)) throw e;
    if (onLog) onLog("[whisper] çıkışta uyardı ama transkript hazır.\n");
  }
  if (!fs.existsSync(jsonPath)) throw new Error("JSON üretilemedi: " + jsonPath);
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const words = flattenWords(data);
  if (opts.diarize) {
    if (fs.existsSync(srtPath)) {
      assignSpeakers(words, parseSpeakerIntervals(fs.readFileSync(srtPath, "utf8")));
    } else if (onLog) {
      onLog("[whisper] UYARI: konuşmacı ayırma istendi ama SRT üretilmedi, konuşmacı ayrımı atlandı.\n");
    }
  }
  const cues = buildCues(words, opts.maxWords || cfg.maxWordsPerCue || 3, !!opts.censor);
  try { fs.unlinkSync(jsonPath); } catch (e) {}
  try { if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath); } catch (e) {}
  if (onLog) onLog("[whisper] bitti (" + cues.length + " satır).\n");
  return cues;
}

// Birden fazla wav'ı tek wav'a karıştırır (A1+A2 sesleri)
async function mixWavs(wavs, ffmpegExe, outWav) {
  if (wavs.length === 1) { fs.copyFileSync(wavs[0], outWav); return outWav; }
  const inputs = [], labels = [];
  for (let i = 0; i < wavs.length; i++) { inputs.push("-i", wavs[i]); labels.push("[" + i + ":a]"); }
  const fc = labels.join("") + "amix=inputs=" + wavs.length + ":normalize=0[m]";
  await run(ffmpegExe, [...inputs, "-filter_complex", fc, "-map", "[m]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav], null, { cwd: path.dirname(ffmpegExe) });
  return outWav;
}

// WAV'ı [startSec, endSec] aralığına kırpar (PCM -> örnek-hassas). endSec sonsuz/geçersizse sona kadar.
async function trimWav(inWav, outWav, startSec, endSec, ffmpegExe) {
  const args = ["-ss", String(Math.max(0, startSec || 0)), "-i", inWav];
  if (isFinite(endSec) && endSec > (startSec || 0)) args.push("-t", String(endSec - (startSec || 0)));
  args.push("-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", outWav);
  await run(ffmpegExe, args, null, { cwd: path.dirname(ffmpegExe) });
  if (!fs.existsSync(outWav)) throw new Error("Kırpılmış WAV üretilemedi: " + outWav);
  return outWav;
}

/*
 * AutoCut analizi: HAZIR bir konuşma wav'ını (timeline'a hizalı) analiz eder.
 * voiceWav sekans zamanına hizalı olduğu için bulunan boşluklar SEKANS zamanıdır.
 * opts = { sensitivity:14, minSilence:0.5, padding:0.12 }
 * Döner: { mean, threshold, cuts:[{start,end,dur}], count, totalCut }
 */
async function analyzeSilence(cfg, voiceWav, onLog, opts) {
  opts = opts || {};
  const sensitivity = (opts.sensitivity != null) ? opts.sensitivity : 14;
  const minSilence = (opts.minSilence != null) ? opts.minSilence : 0.5;
  // Asimetrik kenar payı (A8): konuşma başlangıcından önce daha çok "nefes" bırak (leadIn),
  // önceki konuşmanın kuyruğunu daha sıkı kırp (tailOut) — ilk hece aceleci duyulmasın.
  const tailOut = (opts.padding != null) ? opts.padding : Math.min(0.10, minSilence * 0.18);
  const leadIn = Math.min(0.18, Math.max(tailOut, minSilence * 0.30));
  // 0.05 mutlak taban: kesim en az ~1 kare olsun ki razor sub-frame'de bozulmasın.
  const minCut = Math.max(0.05, Math.min(0.15, minSilence * 0.4));
  const ffmpeg = cfg.ffmpegExe, ffDir = path.dirname(ffmpeg);

  // Tespit ön-filtresi (A1): SADECE analiz için — konuşma bandını izole eder, oyun sesi/hum/
  // rumble tabanını düşürür. Kesime giden ses bundan ETKİLENMEZ (bu wav yalnız analiz içindir).
  // Filtre bu ffmpeg sürümünde yoksa filtresiz devam edilir.
  let pre = "highpass=f=90,lowpass=f=7000,afftdn=nr=12,";
  if (onLog) onLog("[autocut] ses seviyesi ölçülüyor...\n");
  let vd = "";
  try {
    await run(ffmpeg, ["-i", voiceWav, "-af", pre + "volumedetect", "-f", "null", "-"], function (l) { vd += l; }, { cwd: ffDir });
  } catch (ePre) {
    if (onLog) onLog("[autocut] ön-filtre uygulanamadı, filtresiz devam.\n");
    pre = ""; vd = "";
    await run(ffmpeg, ["-i", voiceWav, "-af", "volumedetect", "-f", "null", "-"], function (l) { vd += l; }, { cwd: ffDir });
  }
  const mv = vd.match(/mean_volume:\s*(-?[\d.]+)/);
  const mx = vd.match(/max_volume:\s*(-?[\d.]+)/);
  const mean = mv ? parseFloat(mv[1]) : -20;
  const maxVol = mx ? parseFloat(mx[1]) : 0;
  // Eşik = ortalama - hassasiyet; ama konuşma tepesine (maxVol) göre kelepçele (A2):
  // videolar arası tutarlılık için eşik tepe-göreli bir bantta kalsın.
  let threshold = Math.round(mean - sensitivity);
  const hiClamp = Math.round(maxVol - 10);  // tepenin 10dB altından yukarı çıkmasın (aşırı kesim)
  const loClamp = Math.round(maxVol - 42);  // ve 42dB altından aşağı inmesin (hiç boşluk bulamama)
  if (threshold > hiClamp) threshold = hiClamp;
  if (threshold < loClamp) threshold = loClamp;

  if (onLog) onLog("[autocut] boşluklar taranıyor (eşik " + threshold + "dB)...\n");
  let sd = "";
  await run(ffmpeg, ["-i", voiceWav, "-af", pre + "silencedetect=noise=" + threshold + "dB:d=" + minSilence, "-f", "null", "-"], function (l) { sd += l; }, { cwd: ffDir });

  const cuts = [];
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let m, curStart = null;
  while ((m = re.exec(sd))) {
    if (m[1] === "start") curStart = parseFloat(m[2]);
    else if (m[1] === "end" && curStart != null) {
      const s = curStart + tailOut, e = parseFloat(m[2]) - leadIn;
      if (e - s >= minCut) cuts.push({ start: s, end: e, dur: e - s });
      curStart = null;
    }
  }
  let total = 0; for (let c = 0; c < cuts.length; c++) total += cuts[c].dur;
  if (onLog) onLog("[autocut] " + cuts.length + " boşluk, " + total.toFixed(1) + " sn.\n");
  return { mean: mean, threshold: threshold, cuts: cuts, count: cuts.length, totalCut: total };
}

module.exports = {
  loadConfig, ensureDir, buildTimelineAudio, transcribe, mixWavs, trimWav,
  buildCues, cuesToSrt, buildShortSrt, cleanPunct, flattenWords, analyzeSilence, cancelAll,
  fmtChapter, cuesToTxt, cuesToChapters, censorText,
};
