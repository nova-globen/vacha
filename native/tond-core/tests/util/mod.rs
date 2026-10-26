//! Shared helpers for the integration tests. Each tests/*.rs binary compiles
//! its own copy, so not every binary uses every item.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// Deterministic 64-bit LCG (Knuth MMIX constants); tests must not depend on
/// external randomness.
pub struct Lcg(pub u64);

impl Lcg {
    pub fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

/// A per-process scratch directory under the system temp dir.
pub fn scratch_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("tond-core-tests-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

/// Reads the entire edited document through `Document::read`.
pub fn read_all(doc: &tond_core::Document) -> Vec<u8> {
    let mut buf = vec![0u8; doc.len() as usize];
    let n = doc.read(0, &mut buf);
    assert_eq!(n, buf.len(), "read() returned short for full document");
    buf
}

/// 0-based line start offsets of `bytes` ('\n' terminators only).
pub fn line_starts(bytes: &[u8]) -> Vec<u64> {
    let mut starts = vec![0u64];
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            starts.push(i as u64 + 1);
        }
    }
    starts
}

/// Asserts every line query against a reference byte model. Only valid once
/// the index is complete.
pub fn check_lines(doc: &tond_core::Document, model: &[u8]) {
    let starts = line_starts(model);
    assert_eq!(doc.line_count(), starts.len() as u64, "line_count");
    for (n, &start) in starts.iter().enumerate() {
        assert_eq!(doc.line_start(n as u64), Some(start), "line_start({n})");
    }
    assert_eq!(
        doc.line_start(starts.len() as u64),
        None,
        "line_start past end"
    );
    for offset in 0..=model.len() {
        let expected = model[..offset].iter().filter(|&&b| b == b'\n').count() as u64;
        assert_eq!(doc.line_at(offset as u64), expected, "line_at({offset})");
    }
}
