// vacha_open — the shim the OS launches for file associations.
//
// Opening a file used to cost a second full Electron boot (~1.5-2 s) whose only
// job was to forward argv over the main named pipe and exit. This does the same
// forwarding directly, so a warm open is a pipe write instead of a process tree.
// If nothing is listening it hands the arguments to Vacha.exe and gets out of the
// way.

#![windows_subsystem = "windows"]

mod icons;
mod sha256;
mod wire;

use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};
use std::thread;
use std::time::{Duration, Instant};

use sha256::sha256_hex;
use wire::{
	json_escape, read_frame, write_frame, Payload, Reader, Value, REQUEST_PROMISE,
	RESPONSE_INITIALIZE, RESPONSE_PROMISE_SUCCESS,
};

const VERSION: &str = env!("TOND_VERSION");
const NAME_SHORT: &str = env!("TOND_NAME_SHORT");

/// If the running instance has not answered by now something is wrong with it;
/// give up rather than leave the user staring at nothing.
const WATCHDOG: Duration = Duration::from_secs(5);
const ERROR_PIPE_BUSY: i32 = 231;

#[link(name = "user32")]
extern "system" {
	fn AllowSetForegroundWindow(dwProcessId: u32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
	fn WaitNamedPipeW(lpNamedPipeName: *const u16, nTimeOut: u32) -> i32;
}

fn main() -> ExitCode {
	let started = Instant::now();

	// `vacha_open --allow-foreground <pid>`: a second Vacha.exe launch (Start
	// menu, taskbar) holds the foreground right and hands it to the running
	// instance through this, instead of a native node module.
	let mut args = env::args_os().skip(1);
	match args.next().as_deref().and_then(OsStr::to_str) {
		Some("--allow-foreground") => {
			let pid = args.next().and_then(|pid| pid.to_str()?.parse::<u32>().ok());
			return match pid {
				Some(pid) if unsafe { AllowSetForegroundWindow(pid) } != 0 => ExitCode::SUCCESS,
				_ => ExitCode::FAILURE,
			};
		}
		// `vacha_open --fix-file-icons [ext ...]`: see icons.rs
		Some("--fix-file-icons") => {
			let extensions: Vec<String> = args.map(|ext| ext.to_string_lossy().into_owned()).collect();
			let Ok(shim) = env::current_exe() else {
				return ExitCode::FAILURE;
			};
			let app_icon = shim
				.parent()
				.map(|dir| dir.join("resources").join("app").join("resources").join("win32").join("code.ico"))
				.unwrap_or_default();
			let changed = icons::fix_file_icons(&extensions, &shim, &app_icon);
			log(&format!("fix-file-icons: {changed} changed"));
			return ExitCode::SUCCESS;
		}
		_ => {}
	}

	let cli = Cli::parse(env::args_os().skip(1));

	// A hung instance must not strand the process holding the user's double
	// click; the watchdog is the only thing that can unblock a pipe read.
	thread::spawn(|| {
		thread::sleep(WATCHDOG);
		log("watchdog fired");
		std::process::exit(1);
	});

	let handle = ipc_handle(&cli.user_data_dir);
	log(&format!("pipe {handle}"));

	match connect(&handle).and_then(|mut pipe| forward(&mut pipe, &cli.files)) {
		Ok(()) => {
			log(&format!("forwarded in {} ms", started.elapsed().as_millis()));
			ExitCode::SUCCESS
		}
		Err(error) => {
			log(&format!("forward failed ({error}); launching"));
			match launch(&cli.raw) {
				Ok(()) => ExitCode::SUCCESS,
				Err(error) => {
					log(&format!("launch failed ({error})"));
					ExitCode::FAILURE
				}
			}
		}
	}
}

// -- command line ------------------------------------------------------------

struct Cli {
	/// Absolute paths to open, in the order given.
	files: Vec<String>,
	/// Honoured so the shim can be pointed at a scratch profile while testing.
	user_data_dir: Option<String>,
	/// Everything as received, for the cold-start hand-off.
	raw: Vec<OsString>,
}

impl Cli {
	fn parse(args: impl Iterator<Item = OsString>) -> Self {
		let raw: Vec<OsString> = args.collect();
		let mut files = Vec::new();
		let mut user_data_dir = None;

		let mut index = 0;
		while index < raw.len() {
			let arg = raw[index].to_string_lossy().into_owned();
			if let Some(value) = arg.strip_prefix("--user-data-dir=") {
				user_data_dir = Some(value.to_string());
			} else if arg == "--user-data-dir" {
				user_data_dir = raw.get(index + 1).map(|v| v.to_string_lossy().into_owned());
				index += 1;
			} else if !arg.starts_with('-') {
				files.push(absolute(&raw[index]));
			}
			index += 1;
		}

		Self {
			files,
			user_data_dir,
			raw,
		}
	}
}

fn absolute(path: &OsStr) -> String {
	let resolved = std::path::absolute(path).unwrap_or_else(|_| PathBuf::from(path));
	resolved.to_string_lossy().into_owned()
}

// -- pipe name ---------------------------------------------------------------

/// Mirrors `createStaticIPCHandle(userDataPath, 'main', version)`.
fn ipc_handle(user_data_dir: &Option<String>) -> String {
	let path = user_data_path(user_data_dir);
	let scope = &sha256_hex(path.as_bytes())[..8];
	format!(r"\\.\pipe\{scope}-{VERSION}-main-sock")
}

/// Mirrors `getUserDataPath` for the cases a desktop launch can hit.
fn user_data_path(user_data_dir: &Option<String>) -> String {
	if let Ok(portable) = env::var("VSCODE_PORTABLE") {
		return normalize(&format!("{portable}\\user-data"));
	}
	if let Ok(app_data) = env::var("VSCODE_APPDATA") {
		return normalize(&format!("{app_data}\\{NAME_SHORT}"));
	}
	if let Some(dir) = user_data_dir {
		return normalize(dir);
	}

	let roaming = env::var("APPDATA").unwrap_or_else(|_| {
		let profile = env::var("USERPROFILE").unwrap_or_default();
		format!("{profile}\\AppData\\Roaming")
	});
	normalize(&format!("{roaming}\\{NAME_SHORT}"))
}

/// `path.resolve` equivalent: back-slashes, no `.`/`..` segments, no trailing
/// separator. The hash is taken over the exact string the main process used, so
/// this has to agree with node down to the last character.
fn normalize(path: &str) -> String {
	let absolute = std::path::absolute(path)
		.map(|p| p.to_string_lossy().into_owned())
		.unwrap_or_else(|_| path.to_string());
	let absolute = absolute.replace('/', "\\");

	let (prefix, rest) = match absolute.find(":\\") {
		Some(index) => absolute.split_at(index + 2),
		None => ("", absolute.as_str()),
	};

	let mut segments: Vec<&str> = Vec::new();
	for segment in rest.split('\\') {
		match segment {
			"" | "." => {}
			".." => {
				segments.pop();
			}
			other => segments.push(other),
		}
	}

	format!("{prefix}{}", segments.join("\\"))
}

// -- forwarding --------------------------------------------------------------

fn connect(handle: &str) -> io::Result<File> {
	for _ in 0..5 {
		match OpenOptions::new().read(true).write(true).open(handle) {
			Ok(pipe) => return Ok(pipe),
			Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
				let wide: Vec<u16> = OsStr::new(handle)
					.encode_wide()
					.chain(std::iter::once(0))
					.collect();
				unsafe { WaitNamedPipeW(wide.as_ptr(), 250) };
			}
			Err(error) => return Err(error),
		}
	}
	Err(io::Error::new(io::ErrorKind::WouldBlock, "pipe stayed busy"))
}

fn forward(pipe: &mut File, files: &[String]) -> io::Result<()> {
	// `nodeIPCConnect(handle, 'main')`: the first message is the client context.
	let mut context = Payload::new();
	context.string("main");
	write_frame(pipe, &context.into_bytes())?;
	await_response(pipe, RESPONSE_INITIALIZE, None)?;

	// Windows will not let the other process raise its window unless we say so,
	// which is what the Electron forwarder did via `allowSetForegroundWindow`.
	let mut body = Payload::new();
	body.array(0);
	write_frame(pipe, &call(1, "getMainProcessId", body))?;
	if let Some(Value::Int(pid)) = await_response(pipe, RESPONSE_PROMISE_SUCCESS, Some(1))? {
		unsafe { AllowSetForegroundWindow(pid as u32) };
	}

	write_frame(pipe, &call(2, "start", start_arguments(files)))?;
	await_response(pipe, RESPONSE_PROMISE_SUCCESS, Some(2))?;
	Ok(())
}

/// `ProxyChannel` call: header `[type, id, channel, method]`, body = the
/// argument array the method is applied to.
fn call(id: i64, method: &str, body: Payload) -> Vec<u8> {
	let mut payload = Payload::new();
	payload.array(4);
	payload.int(REQUEST_PROMISE);
	payload.int(id);
	payload.string("launch");
	payload.string(method);

	let mut bytes = payload.into_bytes();
	bytes.extend_from_slice(&body.into_bytes());
	bytes
}

/// `ILaunchMainService.start(args, userEnv)`. Only `args._` matters: the paths
/// are already absolute, so the receiving instance's cwd is irrelevant, and an
/// empty list simply focuses the window.
fn start_arguments(files: &[String]) -> Payload {
	let paths: Vec<String> = files
		.iter()
		.map(|file| format!("\"{}\"", json_escape(file)))
		.collect();

	let mut body = Payload::new();
	body.array(2);
	body.object_json(&format!("{{\"_\":[{}]}}", paths.join(",")));
	body.object_json("{}");
	body
}

/// Reads frames until the expected response arrives, returning its body.
fn await_response(pipe: &mut File, kind: i64, id: Option<i64>) -> io::Result<Option<Value>> {
	loop {
		let (_, payload) = read_frame(pipe)?;
		let mut reader = Reader::new(&payload);

		let Some(Value::Array(header)) = reader.value() else {
			continue;
		};
		if header.first() != Some(&Value::Int(kind)) {
			// An error response for our request is fatal; anything else is noise.
			if let (Some(Value::Int(other)), Some(expected)) = (header.first(), id) {
				if header.get(1) == Some(&Value::Int(expected)) && *other != RESPONSE_INITIALIZE {
					return Err(io::Error::other(format!("request {expected} failed ({other})")));
				}
			}
			continue;
		}
		if let Some(expected) = id {
			if header.get(1) != Some(&Value::Int(expected)) {
				continue;
			}
		}

		return Ok(reader.value());
	}
}

// -- cold start --------------------------------------------------------------

fn launch(args: &[OsString]) -> io::Result<()> {
	let exe = env::current_exe()?
		.parent()
		.map(|dir| dir.join(format!("{NAME_SHORT}.exe")))
		.ok_or_else(|| io::Error::other("no install directory"))?;

	if !exe.exists() {
		return Err(io::Error::new(
			io::ErrorKind::NotFound,
			exe.to_string_lossy().into_owned(),
		));
	}

	Command::new(exe).args(args).spawn().map(|_| ())
}

// -- diagnostics -------------------------------------------------------------

/// Off unless TOND_OPEN_LOG names a file; the shim is a windowed binary with
/// nowhere to print, and this is how the open latency gets measured.
fn log(message: &str) {
	let Ok(path) = env::var("TOND_OPEN_LOG") else {
		return;
	};
	if let Ok(mut file) = OpenOptions::new()
		.create(true)
		.append(true)
		.open(Path::new(&path))
	{
		let _ = writeln!(file, "[vacha_open] {message}");
	}
}
