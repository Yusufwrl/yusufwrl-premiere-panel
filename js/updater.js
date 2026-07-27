/*
 * Panel oto-güncelleme (GitHub Releases).
 * Panel her açılışta son sürümü kontrol eder; yeni sürüm varsa panel.zip'i indirir,
 * uzantı klasörüne açar ve kullanıcıdan Premiere'i yeniden başlatmasını ister.
 * SADECE panel kodunu (HTML/JS/JSX/CSS) günceller — motor (YusufwrlEngine) İNDİRİLMEZ.
 *
 * Repo/asset yapılandırması: uzantı kökündeki update.json
 *   { "repo": "kullanici/repo", "asset": "panel.zip" }
 * Yerel sürüm: uzantı kökündeki version.json  { "version": "1.1.0" }
 */
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

function stripBom(s) { return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }
function readJson(p, def) { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch (e) { return def; } }

// "v1.2.0" / "1.2" karşılaştırması → 1: a yeni, -1: b yeni, 0: eşit
function cmpVer(a, b) {
  var pa = String(a).replace(/^v/i, "").split("."), pb = String(b).replace(/^v/i, "").split(".");
  for (var i = 0; i < 3; i++) {
    var na = parseInt(pa[i] || "0", 10) || 0, nb = parseInt(pb[i] || "0", 10) || 0;
    if (na > nb) return 1; if (na < nb) return -1;
  }
  return 0;
}

function httpsGetJson(url, depth) {
  depth = depth || 0;
  return new Promise(function (resolve, reject) {
    if (depth > 6) return reject(new Error("çok fazla yönlendirme"));
    var req = https.get(url, { headers: { "User-Agent": "YusufwrlPanel", "Accept": "application/vnd.github+json" } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return httpsGetJson(res.headers.location, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      var b = ""; res.on("data", function (d) { b += d; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(12000, function () { req.destroy(new Error("zaman aşımı")); });
  });
}

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(dest);
    function go(u, depth) {
      if (depth > 6) { file.close(); return reject(new Error("çok fazla yönlendirme")); }
      var req = https.get(u, { headers: { "User-Agent": "YusufwrlPanel" } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return go(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
        res.pipe(file);
        file.on("finish", function () { file.close(function () { resolve(); }); });
      });
      req.on("error", function (e) { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
      req.setTimeout(60000, function () { req.destroy(new Error("indirme zaman aşımı")); });
    }
    go(url, 0);
  });
}

// Windows'ta yerleşik PowerShell Expand-Archive — ek bağımlılık yok.
function unzip(zipPath, destDir) {
  return new Promise(function (resolve, reject) {
    var ps = "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") +
             "' -DestinationPath '" + destDir.replace(/'/g, "''") + "' -Force";
    var p = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true });
    var err = "";
    p.stderr.on("data", function (d) { err += d; });
    p.on("error", reject);
    p.on("close", function (code) { code === 0 ? resolve() : reject(new Error("Expand-Archive: " + (err || code))); });
  });
}

function copyDir(src, dst, skip) {
  skip = skip || [];
  var entries = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (skip.indexOf(e.name) !== -1) continue;
    var s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); copyDir(s, d, skip); }
    else { fs.copyFileSync(s, d); }
  }
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { try { fs.unlinkSync(p); } catch (_) {} } }

// repo değeri gerçek mi (placeholder değil mi)?
function isConfigured(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") && !/kullanici|repo-adi/i.test(repo);
}

/*
 * ui = {
 *   log(msg),                       // sessiz bilgi (log paneli)
 *   setStatus(text),                // kısa durum
 *   confirm(msg, title)->Promise,   // kullanıcı onayı
 *   alert(msg, title)->Promise
 * }
 */
async function checkForUpdate(extRoot, ui) {
  ui = ui || {};
  var log = ui.log || function () {};
  var conf = readJson(path.join(extRoot, "update.json"), null);
  if (!conf || !isConfigured(conf.repo)) { log("Oto-güncelleme yapılandırılmadı (update.json)."); return; }

  var local = (readJson(path.join(extRoot, "version.json"), { version: "0.0.0" }) || {}).version || "0.0.0";

  var rel;
  try { rel = await httpsGetJson("https://api.github.com/repos/" + conf.repo + "/releases/latest"); }
  catch (e) { log("Güncelleme kontrolü atlandı: " + e.message); return; }

  var remote = rel && (rel.tag_name || rel.name) || "0.0.0";
  if (cmpVer(remote, local) <= 0) { log("Panel güncel (v" + local + ")."); return; }

  var assetName = conf.asset || "panel.zip";
  var asset = (rel.assets || []).filter(function (a) { return a.name === assetName; })[0];
  if (!asset) { log("Yeni sürüm v" + remote + " var ama " + assetName + " eklentisi bulunamadı."); return; }

  var ok = ui.confirm ? await ui.confirm(
    "Yeni panel sürümü: v" + String(remote).replace(/^v/i, "") + " (şu an v" + local + ").\n\n" +
    "Şimdi güncellensin mi? Sadece panel indirilir (motor değişmez). İşlem sonunda Premiere'i yeniden başlatman gerekir.",
    "Güncelleme var") : true;
  if (!ok) return;

  var clean = String(remote).replace(/^v/i, "");
  var tmp = path.join(os.tmpdir(), "yusufwrl_update_" + clean + ".zip");
  var stage = path.join(os.tmpdir(), "yusufwrl_stage_" + clean);
  try {
    if (ui.setStatus) ui.setStatus("Güncelleme indiriliyor v" + clean + "…");
    log("İndiriliyor: " + asset.browser_download_url);
    await download(asset.browser_download_url, tmp);
    rmrf(stage); fs.mkdirSync(stage, { recursive: true });
    await unzip(tmp, stage);
    // makineye özel dosyalar — ASLA ezme (motor kökü + diarization cihazı)
    copyDir(stage, extRoot, ["engine-root.txt", "diarize-device.txt"]);
    fs.writeFileSync(path.join(extRoot, "version.json"), JSON.stringify({ version: clean }, null, 2));
    if (ui.setStatus) ui.setStatus("");
    if (ui.alert) await ui.alert("Panel v" + clean + " kuruldu.\nPremiere'i kapatıp yeniden aç.", "Güncelleme tamam");
    else log("Güncelleme tamam (v" + clean + "). Premiere'i yeniden başlat.");
  } catch (e) {
    if (ui.setStatus) ui.setStatus("");
    log("Güncelleme başarısız: " + e.message);
    if (ui.alert) ui.alert("Güncelleme başarısız: " + e.message + "\n(Paneli kapatıp tekrar dene.)", "Hata");
  } finally {
    rmrf(tmp); rmrf(stage);
  }
}

module.exports = { checkForUpdate: checkForUpdate, cmpVer: cmpVer };
