---
name: surum-yayinla
description: Premiere panelinin yeni sürümünü yayınlar — sürümü üç dosyada birden bump eder, paketler ve GitHub'a çıkar. Kullanıcı "sürüm çıkar / yayınla / güncelleme gönder" dediğinde kullan.
---

# Premiere paneli sürüm yayınlama

Sürüm üç yerde **birlikte** ilerlemeli. `installer/installer.iss` genelde geride kalır — mutlaka kontrol et.

## Adımlar
1. Mevcut sürümü oku: `version.json`.
2. Yeni semver'i sor (ör. 1.1.15) ya da bir patch artır. Şu **üç** dosyaya yaz (UTF-8, BOM'suz):
   - `version.json`
   - `CSXS/manifest.xml` → `ExtensionBundleVersion`
   - `installer/installer.iss` → `AppVersion` (`#define`)
3. Otomatik-güncelleme zip'ini üret:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\pack-panel.ps1`
4. GitHub'a yayınla:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\publish-github.ps1`
   (commit + push + release + `panel.zip` yükler; `gh` girişli olmalı.)
5. Kullanıcıya sürüm etiketini (`v<sürüm>`) ve auto-updater'ın `update.json` üzerinden `panel.zip`'i çekeceğini Türkçe bildir. Son kullanıcının panelde güncellemeyi göreceğini hatırlat.

Not: `installer.iss` AppVersion bilerek ayrı bir alandır ama her sürümde birlikte güncellenmelidir — asıl drift buradan çıkıyor.
