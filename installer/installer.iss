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
#define AppVersion "1.2.0"

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

[Files]
; --- Panel dosyalari -> CEP extensions klasoru ({app}) ---
; Kullaniciya ozel dosyalar haric (kurulum/guncelleme kullanicininkini ezmesin)
Source: "staging\panel\*"; DestDir: "{app}"; Excludes: "engine-root.txt,diarize-device.txt,sozluk.json,kisiler.json"; \
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

procedure InitializeWizard;
begin
  EngineDirPage := CreateInputDirPage(wpWelcome,
    'Motor klasoru',
    'Whisper motoru ve stiller nereye kurulsun?',
    'Motor (~3 GB) + stil (.mogrt) dosyalari asagidaki klasore kurulacak.' + #13#10 +
    'Varsayilani birak (onerilir). NOT: Windows kullanici adinda Turkce karakter (c,s,g,i,o,u) varsa,' + #13#10 +
    'motoru C:\YusufwrlEngine gibi sade bir yola kur (CEF Turkce yollarda takilabiliyor).',
    False, 'YusufwrlEngine');
  EngineDirPage.Add('Motor klasoru:');
  EngineDirPage.Values[0] := ExpandConstant('{%USERPROFILE%}\YusufwrlEngine');
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

// Panel motoru nerede bulacagini bilsin diye engine-root.txt yaz
procedure WriteEngineRoot;
begin
  SaveStringToFile(ExpandConstant('{app}\engine-root.txt'), GetEngineDir(''), False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteEngineRoot;
    InstallFontPerUser;
  end;
end;
