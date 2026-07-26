# Yusufwrl Altyazı Paneli

A1 ses kanalındaki Türkçe konuşmayı otomatik, 2-3 kelimelik altyazıya çevirir
(Whisper large-v3, GPU).

## Kurulum

Panel zaten kuruldu. Sadece **Premiere Pro'yu kapatıp yeniden aç**, sonra:

**Window (Pencere) > Extensions > Yusufwrl Panel**

> İleride paneli taşırsan / tekrar kurman gerekirse `KUR.bat` dosyasına çift tıkla.

## Kullanım

1. Altyazı çıkarmak istediğin sekansı aç.
2. Panelde kaynak kanalı seç (**A1** = mikrofonun) ve **"Türkçe Altyazı Oluştur"**.
3. Panel: sesi çıkarır → Whisper ile Türkçe'ye döker → 2-3 kelimelik satırlara böler
   → altyazıları listeler. (23 dk video ≈ 3-4 dk, GPU'da.)
4. **"Timeline'a Ekle"** ile projeye alınır → Project panelinden timeline'a sürükle.

## Font (Poetsen One) — tek seferlik

Premiere altyazı fontunu script'ten değiştirmez; bir kez "Track Style" oluştur:

1. Timeline'da altyazıya tıkla.
2. **Text (Metin)** panelinde fontu **Poetsen One** yap.
3. **Track Styles > Create Style** ile kaydet.
4. Sonraki altyazılara bu style'ı uygula → hepsi otomatik Poetsen One olur.

## Ayarlar (config.json / Ayarlar sekmesi)

- `maxWordsPerCue`: satır başına en fazla kelime (3 = "en çok 3 kelime")
- `audioStreamIndex`: A1'in medyadaki ses akışı (0 = ilk ses = mikrofon)
- `model`: `large-v3` (en doğru) / `medium` (hızlı)
- `fontName`: `Poetsen One`

## Dosya konumları

- Motor: `C:\Users\yusuf\YusufwrlEngine\Faster-Whisper-XXL`
- Geçici ses/SRT: `C:\Users\yusuf\YusufwrlEngine\work`
