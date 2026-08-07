# Yusufwrl Premiere Paneli — Kurulum

Sana iki dosya geldi:

1. **YusufwrlKur.exe** — panelin kendisi (15 MB)
2. **YusufwrlEngine.rar** — altyazı motoru (~6 GB indirme, açılınca 7,3 GB)

Bir de **kod** verildi. Kodu kurulumdan sonra bir kere gireceksin.

---

## 1. Motoru aç (önce bunu yap)

`YusufwrlEngine.rar` dosyasını indir ve **`C:\` sürücüsünün köküne** aç. Sonuç şöyle olmalı:

```
C:\YusufwrlEngine\
    Faster-Whisper-XXL\
    fonts\
    styles\
```

Başka bir yere de açabilirsin (D: sürücüsü, Belgeler…) — kurulum sırasında yerini soracak.
Yalnız **yolda Türkçe karakter olmasın** (`Masaüstü`, `Müzikler` gibi): panel o klasörleri
okurken takılabiliyor.

## 2. Paneli kur

`YusufwrlKur.exe` dosyasına çift tıkla.

**Windows mavi bir uyarı verirse** ("Windows bilgisayarınızı korudu"): bu, dosyanın imzasız
olmasından — henüz yeterince indirilmemiş her program bu uyarıyı alır. Sırayla:
**Daha fazla bilgi** → **Yine de çalıştır**.

Sihirbaz sana **motorun nerede olduğunu** soracak — 1. adımda açtığın `YusufwrlEngine`
klasörünü göster. Gerisi kendiliğinden hallolur (panel dosyaları, Premiere ayarı, font).

## 3. Premiere'i aç

Kurulumdan sonra **Premiere Pro'yu tamamen kapat ve yeniden aç.**

Panel: **Window (Pencere) → Extensions → Yusufwrl Premiere**

Panel açılınca bir **kod** soracak. Sana verilen kodu yaz. Bir kere girilir, bu bilgisayarda
bir daha sorulmaz.

## 4. Hazır gelenler

Kurulumdan sonra bunlar zaten yüklü olur, bir şey yapmana gerek yok:

- **Emoji resimleri** (30 adet) — motor klasörünün altına kurulur, panel kendiliğinden bulur
- **Preset'ler** (8 adet) — Preset ekranında hazır
- **Track Style'lar** (6 adet) — altyazı renkleri

> Track Style'ların Premiere'de görünmesi için: Altyazı ekranındaki **"Stilleri projeye ekle"**
> düğmesine bas. Her yeni projede bir kez yapılır.

## 5. Yapay zekâ anahtarı (yalnız emoji ve "Tofi Moni modu" için)

Panelin çoğu özelliği (altyazı, AutoCut, senkron, preset) anahtarsız çalışır.
Yalnız **emoji** ve **Tofi Moni video modu** yapay zekâ kullanıyor.

Onları kullanacaksan kendi anahtarını al:

1. `console.anthropic.com` → giriş yap → **API Keys** → yeni anahtar oluştur
2. Hesabına birkaç dolar kredi yükle (25 dakikalık bir videoda emoji seçimi birkaç sente denk gelir)
3. Panelde **Ayarlar** ekranına gir, anahtarı yapıştır

---

## Sorun çıkarsa

| Belirti | Sebep / çözüm |
|---|---|
| Panel Extensions listesinde yok | Premiere'i **tamamen** kapatıp aç. Olmadıysa kurulumu tekrar çalıştır. |
| "Kod geçersiz" | Kodu harfi harfine yaz. Büyük/küçük fark etmez, tire koymana gerek yok. |
| "Bu kod başka bir bilgisayarda kullanılıyor" | Kod tek bilgisayara bağlanır. Yeni bilgisayar için haber ver. |
| Altyazı üretmiyor / motor hatası | Kurulumda gösterdiğin motor klasörü yanlış olabilir. Panelde **Ayarlar → motor klasörü**'nden düzelt. |
| Emoji düğmesi "anahtar yok" diyor | 5. adım — kendi API anahtarını gir. |

Panelin güncellemeleri **kendiliğinden** gelir: yeni sürüm çıktığında panel açılışta sorar,
"evet" dersen kendi kendini günceller. Senin ayarların, preset'lerin ve kodun korunur.
