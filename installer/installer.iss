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
#define AppVersion "1.4.0"

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
; DIKKAT: config.json bu listede DEGIL ve buraya EKLENMEZ. Pakette gelir ve temiz
; kurulumda gerekir; dislanirsa panel hic acilmaz (js\pipeline.js loadConfig patlar).
; Guncellemede korunmasi js\updater.js configBirlestir() ve kur.ps1 ile saglaniyor.
Source: "staging\panel\*"; DestDir: "{app}"; Excludes: "engine-root.txt,diarize-device.txt,sozluk.json,kisiler.json,assemblyai-key.txt"; \
  Flags: recursesubdirs createallsubdirs ignoreversion
; --- Motor (Faster-Whisper-XXL + styles) -> secilen klasor ---
;     (Motoru ayri dagitacaksan bu satiri sil ve arkadasin motoru elle koysun.)
Source: "staging\engine\*"; DestDir: "{code:GetEngineDir}"; \
  Flags: recursesubdirs createallsubdirs ignoreversion
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
