// Bakes the product identity into the shim so it can derive the same named pipe
// name the main process serves on. VACHA_VERSION / VACHA_NAME_SHORT may be set by
// the release script; otherwise they are read from package.json / product.json.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
	let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
		.join("..")
		.join("..");

	let version = env::var("VACHA_VERSION").ok().unwrap_or_else(|| {
		let pkg = fs::read_to_string(root.join("package.json")).expect("package.json");
		first_string_field(&pkg, "version").expect("package.json version")
	});

	let name_short = env::var("VACHA_NAME_SHORT").ok().unwrap_or_else(|| {
		let product = fs::read_to_string(root.join("product.json")).expect("product.json");
		first_string_field(&product, "nameShort").expect("product.json nameShort")
	});

	println!("cargo:rustc-env=VACHA_VERSION={version}");
	println!("cargo:rustc-env=VACHA_NAME_SHORT={name_short}");
	println!("cargo:rerun-if-env-changed=VACHA_VERSION");
	println!("cargo:rerun-if-env-changed=VACHA_NAME_SHORT");
	println!("cargo:rerun-if-changed=../../package.json");
	println!("cargo:rerun-if-changed=../../product.json");
}

/// Minimal `"key": "value"` lookup; both files are generated/hand-written JSON
/// with the fields we want at the top level, so a real parser would be overkill.
fn first_string_field(json: &str, key: &str) -> Option<String> {
	let needle = format!("\"{key}\"");
	let start = json.find(&needle)? + needle.len();
	let rest = &json[start..];
	let colon = rest.find(':')?;
	let rest = &rest[colon + 1..];
	let open = rest.find('"')?;
	let rest = &rest[open + 1..];
	let close = rest.find('"')?;
	Some(rest[..close].to_string())
}
