; ============================================================
;  Yusufwrl Premiere - Kurulum betigi (Inno Setup 6)
;  Cikti: YusufwrlKur.exe  (arkadasina verecegin tek dosya)
;
;  Ne yapar (YONETICI HAKKI GEREKMEZ, hepsi kullanici hesabinda):
;   1) Paneli    -> %APPDATA%\Adobe\CEP\extensions\com.yusufwrl.premierepanel
;   2) Motoru    -> secilen klasor (varsayilan: %USERPROFILE%\YusufwrlEngine)
;   3) Poetsen One fontunu (per-user, admin'siz)
;   4) PlayerDebugMode reg anahtarlarini (imzasiz eklenti yuklensin)
;   5) engine-root.txt yazar (panel motoru nerede bulacagini bilsin)
;
;  DERLEMEDEN ONCE: staging\ klasorunu doldur (bkz. STAGING-README.txt)
; ============================================================

#define AppName    "Yusufwrl Premiere"
#define AppId      "com.yusufwrl.premierepanel"
#define AppVersion "1.9.31"

[Setup]
AppId={{7C9E6B10-3A42-4F58-9D21-A6B4E8C0F312}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Yusufwrl
DefaultDirName={userappdata}\Adobe\CEP\extensions\{#AppId}
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=YusufwrlKur
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\index.html

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[Dirs]
Name: "{code:GetEngineDir}"

[InstallDelete]
; Eski surumlerde pakete giren .debug: son kullanicida gereksiz DevTools portu (localhost:8088)
; aciyor. Kurucu yalnizca ekler/uzerine yazar, silmez -> bunu acikca kaldirmak gerekiyor.
Type: files; Name: "{app}\.debug"

[Files]
; --- Panel dosyalari -> CEP extensions klasoru ({app}) ---
; Kullaniciya ozel dosyalar haric (kurulum/guncelleme kullanicininkini ezmesin)
; BU BES DOSYA HER YERDE AYNI: .gitignore, installer\panel-files.ps1 ($PanelUserFiles;
; pack-panel.ps1 ve deploy-dev.ps1 listeyi oradan okur), installer\kur.ps1 ($koru),
; js\updater.js (KULLANICI_DOSYALARI) ve burasi -> BESINI birden guncelle.
; DIKKAT: config.json bu listede DEGIL. Pakette gelmesi SART — temiz kurulumda yoksa panel
; hic acilmaz (js\pipeline.js loadConfig patlar). Ama wildcard satirindan DISLANIP hemen
; asagida onlyifdoesntexist ile AYRI konuyor:
;   ⚠ ESKIDEN buradaki yorum "guncellemede korunmasi kur.ps1 ile saglaniyor" diyordu ama
;   installer.iss kur.ps1'i HIC calistirmiyor ([Code] bolumunde yalnizca WriteEngineRoot ve
;   InstallFontPerUser var); kur.ps1 sadece elle dagitilan KUR.bat senaryosunda kosuyor.
;   Yani teslim edilen tek dosya olan exe'de config birlestirme yolu YOKTU ve ignoreversion
;   bayragi dosyayi HER kurulumda uzerine yaziyordu: kullanicinin elle degistirdigi degerler
;   (device=cpu, model, fontName) sessizce paketteki hallerine donuyordu. Belirtisi dolayli
;   ("GPU yokken tekrar cuda deniyor"), sebebi gorunmez.
;   Inno Pascal Script'te JSON birlestirici YAZILMADI — bilerek: dilde JSON ayristirici yok,
;   elle yazilan birlestirici bozuk cikti uretirse panel HIC acilmaz, yani onlemeye calistigindan
;   daha buyuk bir hata dogururdu.
;   ⚠ ESKI YORUM YANLISTI: "configBirlestir zaten bir sonraki acilista ekliyor" DOGRU DEGIL.
;   O fonksiyon YALNIZCA oto-guncelleme yolunda (js\updater.js checkForUpdate, uzak surum >
;   yerel surum iken, paket indirildikten SONRA) calisiyordu; panel acilisinda calisan bir yol
;   YOKTU. Yani exe ile yeniden kurulumda program yollari (engineExe/ffmpegExe/workDir/
;   stylesDir) TAZELENMIYORDU: motor duzeni degisirse yeni exe o degisikligi mevcut
;   kullaniciya ULASTIRMIYOR, belirti "motor/stil bulunamadi" oluyor ve sebebi gorunmuyordu.
;   ✅ KAPATILDI: asagidaki ikinci Source satiri ayni dosyayi "config.pkg.json" adiyla da
;   kuruyor ve panel acilista (js\app.js initCEP) birlestirip dosyayi SILIYOR. Birlestirme
;   JS tarafinda, zaten test edilmis kodla yapiliyor.
Source: "staging\panel\*"; DestDir: "{app}"; Excludes: "engine-root.txt,diarize-device.txt,sozluk.json,kisiler.json,assemblyai-key.txt,anthropic-key.txt,presetler.json,presetler.bak.json,lisans.json,lisans.json.bak,config.json"; \
  Flags: recursesubdirs createallsubdirs ignoreversion
; config.json: temiz kurulumda gelir, yeniden kurulumda kullanicininki KORUNUR.
Source: "staging\panel\config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist
; ⚠ AYNI DOSYA "config.pkg.json" ADIYLA DA KURULUR — HER kurulumda tazelenir (ignoreversion).
;   Panel acilista (js\app.js initCEP) bunu js\updater.js configBirlestir() ile kullanicinin
;   config.json'una birlestiriyor: yeni anahtarlar eklenir ve program yollari
;   (engineExe/ffmpegExe/workDir/stylesDir) PAKETTEN zorlanir. Boylece onlyifdoesntexist'in
;   bedeli (motor duzeni degisikliginin mevcut kullaniciya hic ulasmamasi) kapaniyor.
;   Bu dosya KORUNAN-DOSYA LISTELERINE EKLENMEZ — korunursa hic tazelenmez, amaci kalkar.
Source: "staging\panel\config.json"; DestDir: "{app}"; DestName: "config.pkg.json"; Flags: ignoreversion
; --- Motor (Faster-Whisper-XXL + styles) -> secilen klasor ---
;     KOSULLU: motor staging\engine altinda VARSA exe'ye gomulur, YOKSA bu satir hic
;     derlenmez ve kurulum yalniz paneli kurar.
;     NEDEN: motor 7,3 GB. Exe'ye gomulunce (a) Inno tek dosyada ~2 GB sinirina takiliyor,
;     (b) 7 GB'lik bir exe'yi Drive/WeTransfer'dan indirtmek zaten pratik degil. Motor
;     ayrica RAR ile gonderiliyor; kurulum sihirbazi motorun yerini SORUYOR (GetEngineDir)
;     ve panele engine-root.txt olarak yaziyor, yani elle konan motor da sorunsuz bulunuyor.
;     Motoru yine de gomecek olursan: staging\engine\ altini doldur, bu blok kendiliginden
;     devreye girer.
#if FileExists(AddBackslash(SourcePath) + "staging\engine\Faster-Whisper-XXL\faster-whisper-xxl.exe")
Source: "staging\engine\*"; DestDir: "{code:GetEngineDir}"; \
  Flags: recursesubdirs createallsubdirs ignoreversion
#endif
; --- Font (gecici; asagida per-user kurulur) ---
Source: "staging\PoetsenOne-Regular.ttf"; DestDir: "{tmp}"; Flags: dontcopy

[Registry]
; PlayerDebugMode = imzasiz CEP eklentisi yuklenebilsin. HKCU -> admin gerekmez.
Root: HKCU; Subkey: "Software\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Messages]
WelcomeLabel2=Bu sihirbaz [name] panelini, Whisper motorunu ve gerekli fontu bilgisayarina kuracak.%n%nKurulum bitince Premiere Pro'yu kapatip yeniden ac.

[Code]
var
  EngineDirPage: TInputDirWizardPage;
  VarsayilanMotor: String;      // sihirbaza baslangicta konulan deger

function PanelKlasoru: String;
begin
  // {app} sihirbazin basinda henuz kesin degil; sabit yol kullan (DefaultDirName ile ayni).
  Result := ExpandConstant('{userappdata}\Adobe\CEP\extensions\{#AppId}');
end;

// Onceki kurulumda secilen motor klasoru (yoksa '')
function EskiMotorKoku: String;
var
  A: AnsiString;
  T: String;
begin
  Result := '';
  if not LoadStringFromFile(PanelKlasoru + '\engine-root.txt', A) then Exit;
  // Dosya UTF-8 (BOM'suz) yazildi (bkz. WriteEngineRoot). LoadStringFromFile ham bayt
  // okur; String(A) ANSI cevirisi yaptigi icin 'D:\Kayitlarim\Motor' gibi Turkce
  // karakterli yollari BOZUYORDU -> sihirbaz mevcut motor yerine varsayilani gosterip
  // 3 GB motoru yanlis klasore kuruyordu. UTF8Decode dogru cozer.
  T := UTF8Decode(A);
  // Dosya GERCEKTEN UTF-8 mi? Cok eski kurucular burayi ANSI yaziyordu; o baytlar UTF-8
  // olarak cozulunce bozuk karakter cikar. Geri kodlayip karsilastiriyoruz: esit degilse
  // dosya UTF-8 degil, ANSI cevirisine donuyoruz. (Ikisi de test edildi, ikisi de dogru.)
  if UTF8Encode(T) <> A then T := String(A);
  Result := Trim(T);
end;

procedure InitializeWizard;
var
  Eski: String;
begin
  EngineDirPage := CreateInputDirPage(wpWelcome,
    'Motor klasoru',
    'Whisper motoru ve stiller nereye kurulsun?',
    'Motor (~3 GB) + stil (.mogrt) dosyalari asagidaki klasore kurulacak.' + #13#10 +
    'Daha once kurduysan mevcut klasorun otomatik dolduruldu - DEGISTIRME.' + #13#10 +
    'NOT: Windows kullanici adinda Turkce karakter (c,s,g,i,o,u) varsa,' + #13#10 +
    'motoru C:\YusufwrlEngine gibi sade bir yola kur (CEF Turkce yollarda takilabiliyor).',
    False, 'YusufwrlEngine');
  EngineDirPage.Add('Motor klasoru:');

  // Onceki kurulumun motor yolunu varsayilan yap. Eskiden burasi kosulsuz
  // %USERPROFILE%\YusufwrlEngine yaziyordu; motoru C:\YusufwrlEngine'e kurmus bir kullanici
  // "Ileri, Ileri" dediginde engine-root.txt motorun OLMADIGI yola donuyor ve panel calismiyordu.
  VarsayilanMotor := ExpandConstant('{%USERPROFILE%}\YusufwrlEngine');
  Eski := EskiMotorKoku;
  if Eski <> '' then VarsayilanMotor := Eski;
  EngineDirPage.Values[0] := VarsayilanMotor;
end;

function GetEngineDir(Param: String): String;
begin
  if EngineDirPage = nil then
    Result := ExpandConstant('{%USERPROFILE%}\YusufwrlEngine')
  else
    Result := EngineDirPage.Values[0];
end;

// Fontu per-user kur (Windows 10 1809+; admin gerekmez)
procedure InstallFontPerUser;
var
  Src, FontsDir, Dst: String;
begin
  try
    ExtractTemporaryFile('PoetsenOne-Regular.ttf');
    Src := ExpandConstant('{tmp}\PoetsenOne-Regular.ttf');
    FontsDir := ExpandConstant('{localappdata}\Microsoft\Windows\Fonts');
    ForceDirectories(FontsDir);
    Dst := FontsDir + '\PoetsenOne-Regular.ttf';
    FileCopy(Src, Dst, False);
    RegWriteStringValue(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows NT\CurrentVersion\Fonts',
      'Poetsen One (TrueType)', Dst);
  except
    // font kurulmazsa panel yine calisir; kullanici fontu elle kurabilir
  end;
end;

// Panel motoru nerede bulacagini bilsin diye engine-root.txt yaz.
// UTF-8 (BOM'suz) yazilir: panel dosyayi utf8 okuyor (js\pipeline.js loadConfig).
// SaveStringToFile ANSI yazdigi icin Turkce karakterli kullanici adlarinda ('Gokhan')
// yol bozuluyor, panel motoru bulamiyor ve hata teshis edilemiyordu.
procedure WriteEngineRoot;
var
  A: TArrayOfString;
begin
  // Not: eskiden burada "eski deger okunamadiysa yazma" korumasi vardi. EskiMotorKoku
  // artik UTF-8'i dogru cozdugu icin okunan deger guvenilir; kosulsuz yaziyoruz.
  SetArrayLength(A, 1);
  A[0] := GetEngineDir('');
  SaveStringsToUTF8FileWithoutBOM(ExpandConstant('{app}\engine-root.txt'), A, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteEngineRoot;
    InstallFontPerUser;
  end;
end;
