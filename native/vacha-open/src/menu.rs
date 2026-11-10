// vacha_menu - "Open with Vacha" in the right-click menu of the Store build.
//
// A package cannot write the `*\shell\Vacha` key the site installer uses. It
// declares a COM class instead (build\win32\msix\AppxManifest.xml), which Explorer
// asks for the entry's title and icon and tells when it is clicked. The click starts
// vacha_open.exe from the same folder with the selected files, so it opens them as a
// double click does. Both objects hold no state, so each is one static instance.

use std::ffi::c_void;
use std::ptr::{null, null_mut};

type Hresult = i32;
type This = *mut c_void;

const S_OK: Hresult = 0;
const S_FALSE: Hresult = 1;
const E_NOTIMPL: Hresult = 0x8000_4001_u32 as i32;
const E_NOINTERFACE: Hresult = 0x8000_4002_u32 as i32;
const E_POINTER: Hresult = 0x8000_4003_u32 as i32;
const E_FAIL: Hresult = 0x8000_4005_u32 as i32;
const CLASS_E_NOAGGREGATION: Hresult = 0x8004_0110_u32 as i32;
const CLASS_E_CLASSNOTAVAILABLE: Hresult = 0x8004_0111_u32 as i32;

const SIGDN_FILESYSPATH: u32 = 0x8005_8000;
const GET_MODULE_HANDLE_FROM_ADDRESS: u32 = 0x4;
const GET_MODULE_HANDLE_UNCHANGED_REFCOUNT: u32 = 0x2;
/// CreateProcess refuses a longer command line; files past it are left out.
const MAX_COMMAND_LINE: usize = 32_000;

#[repr(C)]
#[derive(PartialEq)]
pub struct Guid(u32, u16, u16, [u8; 8]);

// The same value as com:Class and desktop5:Verb in AppxManifest.xml
const CLSID_OPEN_WITH_VACHA: Guid = Guid(0x6d1f3c52, 0x8a47, 0x4e19, [0xb2, 0x6c, 0x3f, 0x90, 0xd5, 0x17, 0xa8, 0x4e]);
const IID_IUNKNOWN: Guid = Guid(0, 0, 0, [0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
const IID_ICLASS_FACTORY: Guid = Guid(1, 0, 0, [0xc0, 0, 0, 0, 0, 0, 0, 0x46]);
const IID_IEXPLORER_COMMAND: Guid = Guid(0xa08ce4d0, 0xfa25, 0x44ab, [0xb5, 0x7c, 0xc7, 0xb1, 0xc3, 0x23, 0xe0, 0xb9]);

#[repr(C)]
struct ProcessInformation {
	process: isize,
	thread: isize,
	process_id: u32,
	thread_id: u32,
}

#[repr(C, align(8))]
struct StartupInfo {
	size: u32,
	rest: [u8; 100],
}

#[link(name = "kernel32")]
extern "system" {
	fn GetModuleHandleExW(flags: u32, address: *const c_void, module: *mut isize) -> i32;
	fn GetModuleFileNameW(module: isize, name: *mut u16, size: u32) -> u32;
	fn CreateProcessW(application: *const u16, command_line: *mut u16, process_attributes: *const c_void, thread_attributes: *const c_void, inherit_handles: i32, flags: u32, environment: *const c_void, directory: *const u16, startup: *const StartupInfo, information: *mut ProcessInformation) -> i32;
	fn CloseHandle(handle: isize) -> i32;
}

#[link(name = "ole32")]
extern "system" {
	fn CoTaskMemAlloc(size: usize) -> *mut c_void;
	fn CoTaskMemFree(memory: *mut c_void);
}

// Only the methods this file calls are named; the rest keep their places in the table.
#[repr(C)]
struct ShellItemArrayVtbl {
	unknown: [usize; 2],
	release: unsafe extern "system" fn(This) -> u32,
	unused: [usize; 4],
	get_count: unsafe extern "system" fn(This, *mut u32) -> Hresult,
	get_item_at: unsafe extern "system" fn(This, u32, *mut This) -> Hresult,
}

#[repr(C)]
struct ShellItemVtbl {
	unknown: [usize; 2],
	release: unsafe extern "system" fn(This) -> u32,
	unused: [usize; 2],
	get_display_name: unsafe extern "system" fn(This, u32, *mut *mut u16) -> Hresult,
}

#[repr(C)]
struct ClassFactoryVtbl {
	query_interface: unsafe extern "system" fn(This, *const Guid, *mut This) -> Hresult,
	add_ref: unsafe extern "system" fn(This) -> u32,
	release: unsafe extern "system" fn(This) -> u32,
	create_instance: unsafe extern "system" fn(This, This, *const Guid, *mut This) -> Hresult,
	lock_server: unsafe extern "system" fn(This, i32) -> Hresult,
}

#[repr(C)]
struct ExplorerCommandVtbl {
	query_interface: unsafe extern "system" fn(This, *const Guid, *mut This) -> Hresult,
	add_ref: unsafe extern "system" fn(This) -> u32,
	release: unsafe extern "system" fn(This) -> u32,
	get_title: unsafe extern "system" fn(This, This, *mut *mut u16) -> Hresult,
	get_icon: unsafe extern "system" fn(This, This, *mut *mut u16) -> Hresult,
	get_tool_tip: unsafe extern "system" fn(This, This, *mut *mut u16) -> Hresult,
	get_canonical_name: unsafe extern "system" fn(This, *mut Guid) -> Hresult,
	get_state: unsafe extern "system" fn(This, This, i32, *mut u32) -> Hresult,
	invoke: unsafe extern "system" fn(This, This, This) -> Hresult,
	get_flags: unsafe extern "system" fn(This, *mut u32) -> Hresult,
	enum_sub_commands: unsafe extern "system" fn(This, *mut This) -> Hresult,
}

#[repr(C)]
struct Object<T: 'static>(&'static T);

// The objects are immutable: a table of function pointers each.
unsafe impl<T> Sync for Object<T> {}

static FACTORY_VTBL: ClassFactoryVtbl = ClassFactoryVtbl { query_interface: factory_query_interface, add_ref, release, create_instance, lock_server };
static COMMAND_VTBL: ExplorerCommandVtbl = ExplorerCommandVtbl {
	query_interface: command_query_interface,
	add_ref,
	release,
	get_title,
	get_icon,
	get_tool_tip,
	get_canonical_name,
	get_state,
	invoke,
	get_flags,
	enum_sub_commands,
};
static FACTORY: Object<ClassFactoryVtbl> = Object(&FACTORY_VTBL);
static COMMAND: Object<ExplorerCommandVtbl> = Object(&COMMAND_VTBL);

fn as_this<T>(object: &'static Object<T>) -> This {
	object as *const Object<T> as This
}

fn wide(text: &str) -> Vec<u16> {
	text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// A copy of `text` the caller frees with CoTaskMemFree, as Explorer does.
unsafe fn task_string(text: &str, out: *mut *mut u16) -> Hresult {
	if out.is_null() {
		return E_POINTER;
	}
	let text = wide(text);
	let copy = CoTaskMemAlloc(text.len() * 2) as *mut u16;
	*out = copy;
	if copy.is_null() {
		return E_FAIL;
	}
	std::ptr::copy_nonoverlapping(text.as_ptr(), copy, text.len());
	S_OK
}

/// The folder this DLL is in, which is the root of the package, with a final backslash.
fn package_folder() -> Option<String> {
	let mut module = 0;
	let address = package_folder as *const c_void;
	if unsafe { GetModuleHandleExW(GET_MODULE_HANDLE_FROM_ADDRESS | GET_MODULE_HANDLE_UNCHANGED_REFCOUNT, address, &mut module) } == 0 {
		return None;
	}
	let mut buffer = [0u16; 1024];
	let len = unsafe { GetModuleFileNameW(module, buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
	if len == 0 || len == buffer.len() {
		return None;
	}
	let path = String::from_utf16_lossy(&buffer[..len]);
	Some(path[..path.rfind('\\')? + 1].to_string())
}

/// The file system paths of the selection; a shell item without one is skipped.
unsafe fn selected_paths(items: This) -> Vec<String> {
	let mut paths = Vec::new();
	if items.is_null() {
		return paths;
	}
	let table = &**(items as *const *const ShellItemArrayVtbl);
	let mut count = 0;
	if (table.get_count)(items, &mut count) != S_OK {
		return paths;
	}
	for index in 0..count {
		let mut item: This = null_mut();
		if (table.get_item_at)(items, index, &mut item) != S_OK || item.is_null() {
			continue;
		}
		let item_table = &**(item as *const *const ShellItemVtbl);
		let mut name: *mut u16 = null_mut();
		if (item_table.get_display_name)(item, SIGDN_FILESYSPATH, &mut name) == S_OK && !name.is_null() {
			let len = (0..).take_while(|&i| *name.add(i) != 0).count();
			paths.push(String::from_utf16_lossy(std::slice::from_raw_parts(name, len)));
			CoTaskMemFree(name.cast());
		}
		(item_table.release)(item);
	}
	paths
}

unsafe extern "system" fn add_ref(_this: This) -> u32 {
	2
}

unsafe extern "system" fn release(_this: This) -> u32 {
	1
}

unsafe extern "system" fn factory_query_interface(this: This, iid: *const Guid, out: *mut This) -> Hresult {
	query_interface(this, iid, out, &IID_ICLASS_FACTORY)
}

unsafe extern "system" fn command_query_interface(this: This, iid: *const Guid, out: *mut This) -> Hresult {
	query_interface(this, iid, out, &IID_IEXPLORER_COMMAND)
}

unsafe fn query_interface(this: This, iid: *const Guid, out: *mut This, own: &Guid) -> Hresult {
	if iid.is_null() || out.is_null() {
		return E_POINTER;
	}
	if *iid == IID_IUNKNOWN || *iid == *own {
		*out = this;
		return S_OK;
	}
	*out = null_mut();
	E_NOINTERFACE
}

unsafe extern "system" fn create_instance(_this: This, outer: This, iid: *const Guid, out: *mut This) -> Hresult {
	if !outer.is_null() {
		return CLASS_E_NOAGGREGATION;
	}
	command_query_interface(as_this(&COMMAND), iid, out)
}

unsafe extern "system" fn lock_server(_this: This, _lock: i32) -> Hresult {
	S_OK
}

unsafe extern "system" fn get_title(_this: This, _items: This, out: *mut *mut u16) -> Hresult {
	task_string("Open with Vacha", out)
}

unsafe extern "system" fn get_icon(_this: This, _items: This, out: *mut *mut u16) -> Hresult {
	match package_folder() {
		Some(folder) => task_string(&format!("{folder}Vacha.exe,0"), out),
		None => E_FAIL,
	}
}

unsafe extern "system" fn get_tool_tip(_this: This, _items: This, out: *mut *mut u16) -> Hresult {
	if !out.is_null() {
		*out = null_mut();
	}
	E_NOTIMPL
}

unsafe extern "system" fn get_canonical_name(_this: This, out: *mut Guid) -> Hresult {
	if out.is_null() {
		return E_POINTER;
	}
	*out = CLSID_OPEN_WITH_VACHA;
	S_OK
}

unsafe extern "system" fn get_state(_this: This, _items: This, _slow_ok: i32, out: *mut u32) -> Hresult {
	if out.is_null() {
		return E_POINTER;
	}
	*out = 0; // ECS_ENABLED
	S_OK
}

unsafe extern "system" fn invoke(_this: This, items: This, _bind_context: This) -> Hresult {
	let Some(folder) = package_folder() else {
		return E_FAIL;
	};
	let shim = format!("{folder}vacha_open.exe");
	let mut command = format!("\"{shim}\"");
	for path in selected_paths(items) {
		if command.len() + path.len() + 3 > MAX_COMMAND_LINE {
			break;
		}
		command.push_str(&format!(" \"{path}\""));
	}

	let application = wide(&shim);
	let mut command = wide(&command);
	let startup = StartupInfo { size: std::mem::size_of::<StartupInfo>() as u32, rest: [0; 100] };
	let mut information = ProcessInformation { process: 0, thread: 0, process_id: 0, thread_id: 0 };
	if CreateProcessW(application.as_ptr(), command.as_mut_ptr(), null(), null(), 0, 0, null(), null(), &startup, &mut information) == 0 {
		return E_FAIL;
	}
	CloseHandle(information.thread);
	CloseHandle(information.process);
	S_OK
}

unsafe extern "system" fn get_flags(_this: This, out: *mut u32) -> Hresult {
	if out.is_null() {
		return E_POINTER;
	}
	*out = 0; // ECF_DEFAULT
	S_OK
}

unsafe extern "system" fn enum_sub_commands(_this: This, out: *mut This) -> Hresult {
	if !out.is_null() {
		*out = null_mut();
	}
	E_NOTIMPL
}

/// # Safety
/// Called by COM with valid pointers.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(clsid: *const Guid, iid: *const Guid, out: *mut This) -> Hresult {
	if clsid.is_null() || out.is_null() {
		return E_POINTER;
	}
	*out = null_mut();
	if *clsid != CLSID_OPEN_WITH_VACHA {
		return CLASS_E_CLASSNOTAVAILABLE;
	}
	factory_query_interface(as_this(&FACTORY), iid, out)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> Hresult {
	S_FALSE // the objects are static, and unloading saves nothing
}
