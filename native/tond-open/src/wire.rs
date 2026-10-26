// The two layers of VS Code's node IPC, reimplemented for the shim.
//
// Framing (src/vs/base/parts/ipc/common/ipc.net.ts):
//   [ TYPE u8 | ID u32be | ACK u32be | LEN u32be ][ LEN bytes ]
//   The plain `Protocol` used by the main named pipe only ever sends
//   TYPE = Regular (1) with ID and ACK zeroed.
//
// Payload (src/vs/base/parts/ipc/common/ipc.ts):
//   serialize(header) followed by serialize(body), where a value is
//   [ DataType u8 ][ length or value as a little-endian 7-bit VQL ][ bytes ].

use std::io::{self, Read, Write};

const TYPE_UNDEFINED: u8 = 0;
const TYPE_STRING: u8 = 1;
const TYPE_ARRAY: u8 = 4;
const TYPE_OBJECT: u8 = 5;
const TYPE_INT: u8 = 6;

const FRAME_REGULAR: u8 = 1;
const HEADER_LENGTH: usize = 13;

pub const REQUEST_PROMISE: i64 = 100;
pub const RESPONSE_INITIALIZE: i64 = 200;
pub const RESPONSE_PROMISE_SUCCESS: i64 = 201;

/// Builds the payload of one channel message.
#[derive(Default)]
pub struct Payload {
	bytes: Vec<u8>,
}

impl Payload {
	pub fn new() -> Self {
		Self::default()
	}

	pub fn into_bytes(self) -> Vec<u8> {
		self.bytes
	}

	pub fn string(&mut self, value: &str) -> &mut Self {
		self.bytes.push(TYPE_STRING);
		self.vql(value.len());
		self.bytes.extend_from_slice(value.as_bytes());
		self
	}

	pub fn int(&mut self, value: i64) -> &mut Self {
		self.bytes.push(TYPE_INT);
		self.vql(value as usize);
		self
	}

	/// A pre-rendered JSON value; `serialize` falls back to `JSON.stringify`
	/// for anything that is not a string/number/array/buffer.
	pub fn object_json(&mut self, json: &str) -> &mut Self {
		self.bytes.push(TYPE_OBJECT);
		self.vql(json.len());
		self.bytes.extend_from_slice(json.as_bytes());
		self
	}

	/// Starts an array of `len` elements; the caller writes them next.
	pub fn array(&mut self, len: usize) -> &mut Self {
		self.bytes.push(TYPE_ARRAY);
		self.vql(len);
		self
	}

	fn vql(&mut self, mut value: usize) {
		if value == 0 {
			self.bytes.push(0);
			return;
		}
		while value != 0 {
			let mut byte = (value & 0b0111_1111) as u8;
			value >>= 7;
			if value > 0 {
				byte |= 0b1000_0000;
			}
			self.bytes.push(byte);
		}
	}
}

pub fn write_frame(sink: &mut impl Write, payload: &[u8]) -> io::Result<()> {
	let mut frame = Vec::with_capacity(HEADER_LENGTH + payload.len());
	frame.push(FRAME_REGULAR);
	frame.extend_from_slice(&0u32.to_be_bytes()); // id
	frame.extend_from_slice(&0u32.to_be_bytes()); // ack
	frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
	frame.extend_from_slice(payload);
	sink.write_all(&frame)?;
	sink.flush()
}

pub fn read_frame(source: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
	let mut header = [0u8; HEADER_LENGTH];
	source.read_exact(&mut header)?;
	let len = u32::from_be_bytes([header[9], header[10], header[11], header[12]]) as usize;
	let mut body = vec![0u8; len];
	source.read_exact(&mut body)?;
	Ok((header[0], body))
}

/// Reads back what `serialize` wrote. Only the shapes the launch channel
/// answers with are supported; anything else yields `None`.
pub struct Reader<'a> {
	bytes: &'a [u8],
	pos: usize,
}

#[derive(Debug, PartialEq)]
pub enum Value {
	Undefined,
	Int(i64),
	Str(String),
	Array(Vec<Value>),
	/// Raw bytes of an object/buffer payload we do not need to interpret.
	Opaque,
}

impl<'a> Reader<'a> {
	pub fn new(bytes: &'a [u8]) -> Self {
		Self { bytes, pos: 0 }
	}

	pub fn value(&mut self) -> Option<Value> {
		let kind = *self.bytes.get(self.pos)?;
		self.pos += 1;
		match kind {
			TYPE_UNDEFINED => Some(Value::Undefined),
			TYPE_INT => self.vql().map(|v| Value::Int(v as i64)),
			TYPE_STRING => {
				let len = self.vql()?;
				let end = self.pos.checked_add(len)?;
				let slice = self.bytes.get(self.pos..end)?;
				self.pos = end;
				Some(Value::Str(String::from_utf8_lossy(slice).into_owned()))
			}
			TYPE_ARRAY => {
				let len = self.vql()?;
				let mut items = Vec::with_capacity(len.min(64));
				for _ in 0..len {
					items.push(self.value()?);
				}
				Some(Value::Array(items))
			}
			_ => {
				// Object / Buffer / VSBuffer all carry a length-prefixed blob.
				let len = self.vql()?;
				self.pos = self.pos.checked_add(len)?;
				Some(Value::Opaque)
			}
		}
	}

	fn vql(&mut self) -> Option<usize> {
		let mut value: usize = 0;
		let mut shift = 0;
		loop {
			let byte = *self.bytes.get(self.pos)?;
			self.pos += 1;
			value |= ((byte & 0b0111_1111) as usize) << shift;
			if byte & 0b1000_0000 == 0 {
				return Some(value);
			}
			shift += 7;
			if shift > 63 {
				return None;
			}
		}
	}
}

/// Escapes a string into a JSON string literal (without the quotes).
pub fn json_escape(value: &str) -> String {
	let mut out = String::with_capacity(value.len() + 8);
	for ch in value.chars() {
		match ch {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
			c => out.push(c),
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn vql_matches_writeint32vql() {
		let mut p = Payload::new();
		p.int(0);
		assert_eq!(p.into_bytes(), vec![TYPE_INT, 0]);

		let mut p = Payload::new();
		p.int(100);
		assert_eq!(p.into_bytes(), vec![TYPE_INT, 100]);

		// 300 = 0b100101100 -> 0xAC, 0x02
		let mut p = Payload::new();
		p.int(300);
		assert_eq!(p.into_bytes(), vec![TYPE_INT, 0xAC, 0x02]);
	}

	#[test]
	fn round_trips_a_response_header() {
		let mut p = Payload::new();
		p.array(2);
		p.int(RESPONSE_PROMISE_SUCCESS);
		p.int(7);
		let bytes = p.into_bytes();

		let mut reader = Reader::new(&bytes);
		assert_eq!(
			reader.value(),
			Some(Value::Array(vec![Value::Int(201), Value::Int(7)]))
		);
	}

	#[test]
	fn escapes_windows_paths() {
		assert_eq!(json_escape(r"C:\a\b.txt"), r"C:\\a\\b.txt");
	}
}
