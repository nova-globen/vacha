; Vacha user-level installer (Inno Setup 6). Licence: jrsoftware.org/files/is/license.txt
; permits commercial use and redistribution with no fee; since 6.5.0 the vendor
; requests (not requires) a paid commercial licence, jrsoftware.org/isorder.php.
; Compile: ISCC.exe /DArch=arm64 /DAppVersion=1.1.0 /DSourceDir=..\..\dist\win32-arm64 build\win32\vacha-setup.iss

#ifndef Arch
	#define Arch "arm64"
#endif
#ifndef AppVersion
	#define AppVersion "0.0.0"
#endif
#ifndef SourceDir
	#define SourceDir "..\..\dist\win32-" + Arch
#endif

; File associations point at the forwarder shim, not Vacha.exe: the shim talks to
; the running instance over its named pipe so a warm open costs milliseconds, and
; only falls back to launching Vacha.exe cold.
#define ShimExe "vacha_open.exe"
#define AppIcon "resources\app\resources\win32\code.ico"

; Vacha was called Tond up to 1.0.0. The AppId is unchanged, so this setup
; upgrades a Tond install in place of adding a second app: it quits Tond, moves
; the install from Programs\tond to Programs\vacha, and takes over or removes what
; Tond registered. The app itself carries the settings folders over on first start.
#define LegacyName "Tond"
#define LegacyShimExe "tond_open.exe"

[Setup]
AppId={{FC828270-755C-4664-B40E-CB0BA6AC8FC9}
AppName=Vacha
AppVersion={#AppVersion}
AppPublisher=Nova Globen AB
AppPublisherURL=https://nova-globen.se/vacha
AppSupportURL=https://nova-globen.se/vacha/issues
DefaultDirName={localappdata}\Programs\vacha
DefaultGroupName=Vacha
; a Tond install would otherwise keep its Programs\tond folder and Start menu group
UsePreviousAppDir=no
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=VachaSetup-{#Arch}-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesInstallIn64BitMode=x64compatible
#endif
SetupIconFile=..\..\resources\win32\code.ico
WizardImageFile=..\..\resources\win32\inno-big-100.bmp,..\..\resources\win32\inno-big-125.bmp,..\..\resources\win32\inno-big-150.bmp,..\..\resources\win32\inno-big-175.bmp,..\..\resources\win32\inno-big-200.bmp,..\..\resources\win32\inno-big-225.bmp,..\..\resources\win32\inno-big-250.bmp
WizardSmallImageFile=..\..\resources\win32\inno-small-100.bmp,..\..\resources\win32\inno-small-125.bmp,..\..\resources\win32\inno-small-150.bmp,..\..\resources\win32\inno-small-175.bmp,..\..\resources\win32\inno-small-200.bmp,..\..\resources\win32\inno-small-225.bmp,..\..\resources\win32\inno-small-250.bmp
UninstallDisplayIcon={app}\Vacha.exe
WizardStyle=modern
CloseApplications=yes
LicenseFile={#SourceDir}\resources\app\LICENSE.txt
ChangesAssociations=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "addtopath"; Description: "Add Vacha to PATH (requires restarting open terminals)"; GroupDescription: "Other:"
Name: "associatetext"; Description: "Open plain-text files with Vacha (.txt, .log, .ini, .cfg, .conf, .env)"; GroupDescription: "Other:"

; An upgrade copies over the old install, so files a newer build no longer
; ships would linger: clear the app payload, and the Chromium files Vacha dropped.
[InstallDelete]
Type: filesandordirs; Name: "{app}\resources\app"
Type: files; Name: "{app}\dxcompiler.dll"
Type: files; Name: "{app}\dxil.dll"
Type: files; Name: "{app}\vk_swiftshader.dll"
Type: files; Name: "{app}\vk_swiftshader_icd.json"
Type: files; Name: "{app}\vulkan-1.dll"
Type: files; Name: "{app}\locales\*.pak"
; Tond's Start menu group and desktop shortcut
Type: filesandordirs; Name: "{userprograms}\{#LegacyName}"
Type: files; Name: "{userdesktop}\{#LegacyName}.lnk"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Vacha"; Filename: "{app}\Vacha.exe"
Name: "{userdesktop}\Vacha"; Filename: "{app}\Vacha.exe"; Tasks: desktopicon

[Registry]
; user PATH entry for the CLI shim in bin\ (Tond's entry is removed in [Code])
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}\bin"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}\bin'))

; Per-extension ProgIds. Opening goes through the forwarder shim, but the
; DefaultIcon stays the stock Windows art (imageres.dll) so files keep looking
; like text/config files instead of turning into rows of Vacha logos.
Root: HKCU; Subkey: "Software\Classes\Vacha.txt"; ValueType: string; ValueName: ""; ValueData: "Text Document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.txt\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-102"
Root: HKCU; Subkey: "Software\Classes\Vacha.txt\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Vacha.log"; ValueType: string; ValueName: ""; ValueData: "Log File"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.log\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-102"
Root: HKCU; Subkey: "Software\Classes\Vacha.log\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Vacha.ini"; ValueType: string; ValueName: ""; ValueData: "Configuration Settings"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.ini\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-69"
Root: HKCU; Subkey: "Software\Classes\Vacha.ini\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Vacha.cfg"; ValueType: string; ValueName: ""; ValueData: "Configuration Settings"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.cfg\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-69"
Root: HKCU; Subkey: "Software\Classes\Vacha.cfg\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Vacha.conf"; ValueType: string; ValueName: ""; ValueData: "Configuration Settings"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.conf\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-69"
Root: HKCU; Subkey: "Software\Classes\Vacha.conf\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Vacha.env"; ValueType: string; ValueName: ""; ValueData: "ENV File"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Vacha.env\DefaultIcon"; ValueType: expandsz; ValueName: ""; ValueData: "%SystemRoot%\System32\imageres.dll,-2"
Root: HKCU; Subkey: "Software\Classes\Vacha.env\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""

; "Open with Vacha" for every file type (right-click and the Open With list)
Root: HKCU; Subkey: "Software\Classes\*\shell\Vacha"; ValueType: string; ValueName: ""; ValueData: "Open with Vacha"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\*\shell\Vacha"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\Vacha.exe"
Root: HKCU; Subkey: "Software\Classes\*\shell\Vacha\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Applications\{#ShimExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Vacha"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\{#ShimExe}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppIcon}"
Root: HKCU; Subkey: "Software\Classes\Applications\{#ShimExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""

; claim the plain-text types by default (code formats are deliberately left alone)
Root: HKCU; Subkey: "Software\Classes\.txt"; ValueType: string; ValueName: ""; ValueData: "Vacha.txt"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "Vacha.txt"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.log"; ValueType: string; ValueName: ""; ValueData: "Vacha.log"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.log\OpenWithProgids"; ValueType: string; ValueName: "Vacha.log"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.ini"; ValueType: string; ValueName: ""; ValueData: "Vacha.ini"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.ini\OpenWithProgids"; ValueType: string; ValueName: "Vacha.ini"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.cfg"; ValueType: string; ValueName: ""; ValueData: "Vacha.cfg"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.cfg\OpenWithProgids"; ValueType: string; ValueName: "Vacha.cfg"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.conf"; ValueType: string; ValueName: ""; ValueData: "Vacha.conf"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.conf\OpenWithProgids"; ValueType: string; ValueName: "Vacha.conf"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.env"; ValueType: string; ValueName: ""; ValueData: "Vacha.env"; Tasks: associatetext; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.env\OpenWithProgids"; ValueType: string; ValueName: "Vacha.env"; ValueData: ""; Tasks: associatetext; Flags: uninsdeletevalue

; What Tond registered. A default the user picked for Tond ("Always use this
; app") is stored by Windows as a hash-protected UserChoice naming Tond's ProgId,
; which setup cannot rewrite; so Tond's ProgIds and Applications entry stay, now
; opening with Vacha, and are removed on uninstall. Duplicates in menus go now.
Root: HKCU; Subkey: "Software\Classes\Tond.file"; Flags: deletekey
Root: HKCU; Subkey: "Software\Classes\Tond.txt\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.txt')
Root: HKCU; Subkey: "Software\Classes\Tond.log\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.log')
Root: HKCU; Subkey: "Software\Classes\Tond.ini\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.ini')
Root: HKCU; Subkey: "Software\Classes\Tond.cfg\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.cfg')
Root: HKCU; Subkey: "Software\Classes\Tond.conf\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.conf')
Root: HKCU; Subkey: "Software\Classes\Tond.env\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.env')
Root: HKCU; Subkey: "Software\Classes\Tond.txt"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.txt')
Root: HKCU; Subkey: "Software\Classes\Tond.log"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.log')
Root: HKCU; Subkey: "Software\Classes\Tond.ini"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.ini')
Root: HKCU; Subkey: "Software\Classes\Tond.cfg"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.cfg')
Root: HKCU; Subkey: "Software\Classes\Tond.conf"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.conf')
Root: HKCU; Subkey: "Software\Classes\Tond.env"; Flags: uninsdeletekey; Check: LegacyKeyExists('Tond.env')
Root: HKCU; Subkey: "Software\Classes\Applications\{#LegacyShimExe}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppIcon}"; Flags: uninsdeletekey; Check: LegacyKeyExists('Applications\{#LegacyShimExe}')
Root: HKCU; Subkey: "Software\Classes\Applications\{#LegacyShimExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ShimExe}"" ""%1"""; Flags: uninsdeletekey; Check: LegacyKeyExists('Applications\{#LegacyShimExe}')
Root: HKCU; Subkey: "Software\Classes\Applications\{#LegacyShimExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Vacha"; Flags: uninsdeletekey; Check: LegacyKeyExists('Applications\{#LegacyShimExe}')
Root: HKCU; Subkey: "Software\Classes\*\shell\Tond"; Flags: deletekey
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueName: "Tond.txt"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Classes\.log\OpenWithProgids"; ValueName: "Tond.log"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Classes\.ini\OpenWithProgids"; ValueName: "Tond.ini"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Classes\.cfg\OpenWithProgids"; ValueName: "Tond.cfg"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Classes\.conf\OpenWithProgids"; ValueName: "Tond.conf"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Classes\.env\OpenWithProgids"; ValueName: "Tond.env"; Flags: deletevalue
; Tond's start-at-login item; Vacha registers its own on first start
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "{#LegacyName}"; Flags: deletevalue

[Run]
; types sent to Vacha (or Tond) with "Choose another app" get their icons back
Filename: "{app}\{#ShimExe}"; Parameters: "--fix-file-icons"; Flags: runhidden waituntilterminated
Filename: "{app}\Vacha.exe"; Description: "{cm:LaunchProgram,Vacha}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Vacha registers itself as a start-at-login item at runtime; remove it on uninstall
Filename: "reg"; Parameters: "delete ""HKCU\Software\Microsoft\Windows\CurrentVersion\Run"" /v ""Vacha"" /f"; Flags: runhidden; RunOnceId: "RemoveStartAtLogin"

[Code]
var
	// where Tond was installed, if this setup upgrades a Tond install elsewhere
	LegacyDir: String;

function NeedsAddPath(Param: string): boolean;
var
	OrigPath: string;
begin
	if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
	begin
		Result := True;
		exit;
	end;
	Result := Pos(';' + Uppercase(Param) + ';', ';' + Uppercase(OrigPath) + ';') = 0;
end;

function LegacyKeyExists(SubKey: String): Boolean;
begin
	Result := RegKeyExists(HKCU, 'Software\Classes\' + SubKey);
end;

// Drops one entry from the user PATH, if it is there.
procedure RemoveFromPath(Entry: String);
var
	OrigPath, Padded: String;
	Index: Integer;
begin
	if not RegQueryStringValue(HKCU, 'Environment', 'Path', OrigPath) then
		exit;
	Padded := ';' + OrigPath + ';';
	Index := Pos(';' + Uppercase(Entry) + ';', Uppercase(Padded));
	if Index = 0 then
		exit;
	Delete(Padded, Index, Length(Entry) + 1);
	OrigPath := Copy(Padded, 2, Length(Padded) - 2);
	RegWriteExpandStringValue(HKCU, 'Environment', 'Path', OrigPath);
end;

// The folder the previous install (same AppId) went to, when it holds Tond.exe
// and is not where this setup installs. Read before setup rewrites the key.
function FindLegacyDir(): String;
var
	Dir: String;
begin
	Result := '';
	if not RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{FC828270-755C-4664-B40E-CB0BA6AC8FC9}_is1', 'Inno Setup: App Path', Dir) then
		exit;
	if FileExists(AddBackslash(Dir) + '{#LegacyName}.exe') then
		Result := RemoveBackslash(Dir);
end;

function InitializeSetup(): Boolean;
begin
	LegacyDir := FindLegacyDir();
	Result := True;
end;

// Vacha hides to the tray instead of quitting, so Restart Manager (CloseApplications)
// cannot close it and a silent upgrade fails with exit code 5. Ask the running
// instance to quit over its pipe (<exe> --quit), then wait for it. Only the exe
// installed by this setup (or by Tond) counts: dev and smoke builds elsewhere
// are left alone.
function ProcessCount(Path: String): Integer;
var
	Locator, Service, Processes: Variant;
begin
	Result := 0;
	StringChangeEx(Path, '\', '\\', True);
	StringChangeEx(Path, '''', '\''', True);
	try
		Locator := CreateOleObject('WbemScripting.SWbemLocator');
		Service := Locator.ConnectServer('.', 'root\CIMV2');
		Processes := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE ExecutablePath = ''' + Path + '''');
		Result := Processes.Count;
	except
		Log('Could not list processes: ' + GetExceptionMessage);
	end;
end;

function RunningCount(AppExe, LegacyExe: String): Integer;
begin
	Result := ProcessCount(AppExe);
	if LegacyExe <> '' then
		Result := Result + ProcessCount(LegacyExe);
end;

function WaitForExit(AppExe, LegacyExe: String; Milliseconds: Integer): Boolean;
var
	Waited: Integer;
begin
	Waited := 0;
	while (RunningCount(AppExe, LegacyExe) > 0) and (Waited < Milliseconds) do
	begin
		Sleep(250);
		Waited := Waited + 250;
	end;
	Result := RunningCount(AppExe, LegacyExe) = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
	ResultCode: Integer;
	AppExe, LegacyExe: String;
begin
	Result := '';
	AppExe := ExpandConstant('{app}\Vacha.exe');
	LegacyExe := '';
	if LegacyDir <> '' then
		LegacyExe := LegacyDir + '\{#LegacyName}.exe';
	if RunningCount(AppExe, LegacyExe) = 0 then
		exit;

	Log('Vacha is running; asking it to quit');
	if ProcessCount(AppExe) > 0 then
		Exec(AppExe, '--quit', '', SW_HIDE, ewNoWait, ResultCode);
	if (LegacyExe <> '') and (ProcessCount(LegacyExe) > 0) then
		Exec(LegacyExe, '--quit', '', SW_HIDE, ewNoWait, ResultCode);
	while not WaitForExit(AppExe, LegacyExe, 20000) do
	begin
		if WizardSilent() then
		begin
			Result := 'Vacha is still running. Quit it from its tray icon (right-click, Quit) and run setup again.';
			exit;
		end;
		if MsgBox('Vacha is still running. Quit it from its tray icon (right-click, Quit), then click Retry.', mbError, MB_RETRYCANCEL) = IDCANCEL then
		begin
			Result := 'Vacha is still running.';
			exit;
		end;
	end;
end;

// After an upgrade from Tond: its install folder and PATH entry go. Settings
// live elsewhere (%APPDATA%, ~\.tond) and are carried over by the app.
procedure CurStepChanged(CurStep: TSetupStep);
begin
	if (CurStep <> ssPostInstall) or (LegacyDir = '') then
		exit;
	if CompareText(LegacyDir, RemoveBackslash(ExpandConstant('{app}'))) = 0 then
		exit;
	RemoveFromPath(LegacyDir + '\bin');
	if not DelTree(LegacyDir, True, True, True) then
		Log('Could not remove ' + LegacyDir);
end;
