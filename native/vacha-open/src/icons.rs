// File-type icons for types the user sent to Vacha with "Choose another app".
//
// Windows records such a choice as an `<ext>_auto_file` ProgId holding only an
// open command - no DefaultIcon - so Explorer falls back to the icon of the
// program in that command, and this shim has none: every such file showed a
// blank page. `vacha_open --fix-file-icons [ext ...]` gives each auto ProgId that
// opens with this shim the icon Windows itself registers for the extension
// (machine-wide, HKLM, so the user's own choice does not mask it), or Vacha's
// icon when Windows has none (.md, for one). Existing DefaultIcons are left
// alone unless their icon file is gone. Choices made while the product was
// called Tond still name `tond_open.exe`; those commands are pointed at this
// shim, and their icons with them. Explorer is told to refresh when anything
// changed.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};

type Hkey = isize;
const HKEY_CURRENT_USER: Hkey = 0x8000_0001_u32 as i32 as isize;
const HKEY_LOCAL_MACHINE: Hkey = 0x8000_0002_u32 as i32 as isize;
const KEY_READ: u32 = 0x2_0019;
const RRF_RT_REG_SZ: u32 = 0x0000_0002;
const RRF_RT_REG_EXPAND_SZ: u32 = 0x0000_0004;
const RRF_NOEXPAND: u32 = 0x1000_0000;
const REG_SZ: u32 = 1;
const REG_EXPAND_SZ: u32 = 2;
const ERROR_SUCCESS: i32 = 0;
const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNF_IDLIST: u32 = 0;
const AUTO_SUFFIX: &str = "_auto_file";
const LEGACY_SHIM: &str = "tond_open.exe";

#[link(name = "advapi32")]
extern "system" {
	fn RegOpenKeyExW(hkey: Hkey, sub_key: *const u16, options: u32, sam: u32, result: *mut Hkey) -> i32;
	fn RegEnumKeyExW(hkey: Hkey, index: u32, name: *mut u16, name_len: *mut u32, reserved: *mut u32, class: *mut u16, class_len: *mut u32, last_write: *mut u64) -> i32;
	fn RegCloseKey(hkey: Hkey) -> i32;
	fn RegGetValueW(hkey: Hkey, sub_key: *const u16, value: *const u16, flags: u32, value_type: *mut u32, data: *mut u8, data_len: *mut u32) -> i32;
	fn RegSetKeyValueW(hkey: Hkey, sub_key: *const u16, value: *const u16, value_type: u32, data: *const u8, data_len: u32) -> i32;
}

#[link(name = "shell32")]
extern "system" {
	fn SHChangeNotify(event_id: i32, flags: u32, item1: *const u8, item2: *const u8);
}

fn wide(text: &str) -> Vec<u16> {
	OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
}

/// The default (unnamed) string value of `root\sub_key`, unexpanded, with its type.
fn default_value(root: Hkey, sub_key: &str) -> Option<(String, u32)> {
	let key = wide(sub_key);
	let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
	let mut value_type = 0u32;
	let mut len = 0u32;
	if unsafe { RegGetValueW(root, key.as_ptr(), null(), flags, &mut value_type, null_mut(), &mut len) } != ERROR_SUCCESS || len < 2 {
		return None;
	}
	let mut buffer = vec![0u16; (len as usize).div_ceil(2)];
	if unsafe { RegGetValueW(root, key.as_ptr(), null(), flags, &mut value_type, buffer.as_mut_ptr().cast(), &mut len) } != ERROR_SUCCESS {
		return None;
	}
	let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
	let text = String::from_utf16_lossy(&buffer[..end]);
	(!text.trim().is_empty()).then_some((text, value_type))
}

/// Every `*_auto_file` key name under HKCU\Software\Classes.
fn auto_progids() -> Vec<String> {
	let mut names = Vec::new();
	let classes = wide("Software\\Classes");
	let mut key: Hkey = 0;
	if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, classes.as_ptr(), 0, KEY_READ, &mut key) } != ERROR_SUCCESS {
		return names;
	}
	let mut buffer = [0u16; 256];
	for index in 0.. {
		let mut len = buffer.len() as u32;
		let status = unsafe { RegEnumKeyExW(key, index, buffer.as_mut_ptr(), &mut len, null_mut(), null_mut(), null_mut(), null_mut()) };
		if status != ERROR_SUCCESS {
			break; // ERROR_NO_MORE_ITEMS, or a name longer than any ProgId we care about
		}
		let name = String::from_utf16_lossy(&buffer[..len as usize]);
		if name.to_ascii_lowercase().ends_with(AUTO_SUFFIX) {
			names.push(name);
		}
	}
	unsafe { RegCloseKey(key) };
	names
}

/// The icon Windows registers for `.ext` machine-wide, if any. A `%1` icon
/// ("ask the file's icon handler", as for .xml) only works with that type's
/// handler, which the auto ProgId does not have, so it counts as none.
fn system_icon(extension: &str) -> Option<(String, u32)> {
	let (progid, _) = default_value(HKEY_LOCAL_MACHINE, &format!("Software\\Classes\\.{extension}"))?;
	default_value(HKEY_LOCAL_MACHINE, &format!("Software\\Classes\\{progid}\\DefaultIcon"))
		.filter(|(icon, _)| !icon.contains("%1"))
}

/// The file an icon value (`"path",index`) or command (`"path" "%1"`) names.
fn named_file(value: &str) -> &str {
	let value = value.trim();
	match value.strip_prefix('"') {
		Some(rest) => rest.split('"').next().unwrap_or_default(),
		None => value.split(',').next().unwrap_or_default().trim(),
	}
}

/// Whether an icon value names a file that is no longer there. Values that need
/// expanding (`%SystemRoot%\...`) are trusted.
fn icon_missing(icon: &str) -> bool {
	let file = named_file(icon);
	!file.is_empty() && !file.contains('%') && !Path::new(file).exists()
}

fn set_default(sub_key: &str, value: &str, value_type: u32) -> bool {
	let data = wide(value);
	let sub_key = wide(sub_key);
	let status = unsafe {
		RegSetKeyValueW(HKEY_CURRENT_USER, sub_key.as_ptr(), null(), value_type, data.as_ptr().cast(), (data.len() * 2) as u32)
	};
	status == ERROR_SUCCESS
}

/// Gives the auto ProgIds that open with this shim an icon; returns how many changed.
pub fn fix_file_icons(extensions: &[String], shim: &Path, app_icon: &Path) -> usize {
	let candidates = if extensions.is_empty() {
		auto_progids()
	} else {
		extensions
			.iter()
			.map(|ext| format!("{}{AUTO_SUFFIX}", ext.trim_start_matches('.').to_ascii_lowercase()))
			.collect()
	};
	let shim_name = shim
		.file_name()
		.map(|name| name.to_string_lossy().to_ascii_lowercase())
		.unwrap_or_default();

	let mut changed = 0;
	for progid in candidates {
		let command_key = format!("Software\\Classes\\{progid}\\shell\\open\\command");
		let icon_key = format!("Software\\Classes\\{progid}\\DefaultIcon");
		let Some((command, _)) = default_value(HKEY_CURRENT_USER, &command_key) else {
			continue;
		};
		let lower = command.to_ascii_lowercase();

		// A choice made for Tond: open with this shim from now on, and drop an
		// icon that pointed into the old install
		let mut stale_dir = None;
		if !lower.contains(&shim_name) && lower.contains(LEGACY_SHIM) {
			let new_command = format!("\"{}\" \"%1\"", shim.to_string_lossy());
			if !set_default(&command_key, &new_command, REG_SZ) {
				continue;
			}
			changed += 1;
			stale_dir = Path::new(named_file(&command)).parent().map(|dir| dir.to_string_lossy().to_ascii_lowercase());
		} else if !lower.contains(&shim_name) {
			continue;
		}

		if let Some((icon, _)) = default_value(HKEY_CURRENT_USER, &icon_key) {
			let in_stale_dir = stale_dir.as_deref().is_some_and(|dir| named_file(&icon).to_ascii_lowercase().starts_with(dir));
			if !in_stale_dir && !icon_missing(&icon) {
				continue;
			}
		}

		let extension = &progid[..progid.len() - AUTO_SUFFIX.len()];
		let (icon, value_type) = system_icon(extension)
			.unwrap_or_else(|| (app_icon.to_string_lossy().into_owned(), REG_SZ));
		let value_type = if value_type == REG_EXPAND_SZ || icon.contains('%') { REG_EXPAND_SZ } else { REG_SZ };
		if set_default(&icon_key, &icon, value_type) {
			changed += 1;
		}
	}

	if changed > 0 {
		unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, null(), null()) };
	}
	changed
}
