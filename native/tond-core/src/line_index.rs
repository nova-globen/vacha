//! Asynchronous line index of the ORIGINAL file, klogg-style.
//!
//! A background thread scans the original in 8 MiB chunks with `memchr`,
//! appending newline byte offsets to a shared, ascending `Vec<u64>`. The
//! `frontier` atomic publishes how far the scan has advanced; any query whose
//! range lies at or below the frontier gets an exact answer, anything beyond
//! it gets the best-effort count of what has been scanned so far.
//!
//! After a complete scan the offsets are persisted to a sidecar
//! (`<cache_dir>/tond-index/<hash>.tondidx`, keyed by canonical path plus
//! length plus mtime) so the next open of an unchanged file skips the scan
//! entirely. Corrupt, short, or stale sidecars are ignored and the scan runs
//! normally.

use std::env;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::{io, thread};

use crate::source::Source;
use crate::CHUNK;

const MAGIC: &[u8; 4] = b"TNDX";
const VERSION: u32 = 1;
const HEADER_LEN: usize = 32;

pub(crate) struct LineIndex {
    /// Newline byte offsets in the original, ascending, complete up to
    /// `frontier`. Appended to in scan order, so entries never reorder.
    newlines: Mutex<Vec<u64>>,
    /// Bytes of the original scanned so far; stored with `Release` after the
    /// batch covering them is visible in `newlines`.
    frontier: AtomicU64,
    total: u64,
    /// True once the scan thread has exited (complete or cancelled).
    finished: Mutex<bool>,
    finished_cv: Condvar,
    cancel: AtomicBool,
}

impl LineIndex {
    /// An index that is already complete: empty documents and sidecar hits.
    pub(crate) fn completed(newlines: Vec<u64>, total: u64) -> Arc<LineIndex> {
        Arc::new(LineIndex {
            newlines: Mutex::new(newlines),
            frontier: AtomicU64::new(total),
            total,
            finished: Mutex::new(true),
            finished_cv: Condvar::new(),
            cancel: AtomicBool::new(false),
        })
    }

    /// Spawns the background scan of `source`; writes `key`'s sidecar on
    /// completion.
    pub(crate) fn start(
        source: Arc<Source>,
        key: Option<SidecarKey>,
    ) -> io::Result<(Arc<LineIndex>, JoinHandle<()>)> {
        let total = source.len();
        let index = Arc::new(LineIndex {
            newlines: Mutex::new(Vec::new()),
            frontier: AtomicU64::new(0),
            total,
            finished: Mutex::new(false),
            finished_cv: Condvar::new(),
            cancel: AtomicBool::new(false),
        });
        let idx = Arc::clone(&index);
        let handle = thread::Builder::new()
            .name("tond-line-index".into())
            .spawn(move || {
                let mut scratch = Vec::new();
                let mut batch = Vec::new();
                let mut offset = 0u64;
                let mut complete = true;
                while offset < total {
                    if idx.cancel.load(Ordering::Relaxed) {
                        complete = false;
                        break;
                    }
                    let chunk = source.chunk(offset, CHUNK, &mut scratch);
                    if chunk.is_empty() {
                        // The original shrank under us; freeze where we are.
                        complete = false;
                        break;
                    }
                    batch.clear();
                    for pos in memchr::memchr_iter(b'\n', chunk) {
                        batch.push(offset + pos as u64);
                    }
                    idx.newlines.lock().unwrap().extend_from_slice(&batch);
                    offset += chunk.len() as u64;
                    idx.frontier.store(offset, Ordering::Release);
                }
                if complete {
                    if let Some(key) = &key {
                        let newlines = idx.newlines.lock().unwrap();
                        write_sidecar(key, &newlines);
                    }
                }
                let mut finished = idx.finished.lock().unwrap();
                *finished = true;
                idx.finished_cv.notify_all();
            })?;
        Ok((index, handle))
    }

    pub(crate) fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// 0.0..=1.0; exactly 1.0 only when the whole original has been scanned.
    pub(crate) fn progress(&self) -> f64 {
        if self.total == 0 {
            return 1.0;
        }
        (self.frontier.load(Ordering::Acquire) as f64 / self.total as f64).min(1.0)
    }

    /// Blocks until the scan thread has exited.
    pub(crate) fn wait(&self) {
        let mut finished = self.finished.lock().unwrap();
        while !*finished {
            finished = self.finished_cv.wait(finished).unwrap();
        }
    }

    /// Newline count in `range` of the original, and whether it is exact
    /// (`range` entirely at or below the scan frontier).
    pub(crate) fn count_in(&self, range: std::ops::Range<u64>) -> (u64, bool) {
        let exact = range.end <= self.frontier.load(Ordering::Acquire);
        let newlines = self.newlines.lock().unwrap();
        let a = newlines.partition_point(|&x| x < range.start);
        let b = newlines.partition_point(|&x| x < range.end);
        ((b - a) as u64, exact)
    }

    /// Byte offset (in the original) of the `n`-th newline (1-based) at or
    /// after `start`, if that many have been indexed.
    pub(crate) fn nth_in(&self, start: u64, n: u64) -> Option<u64> {
        let newlines = self.newlines.lock().unwrap();
        let a = newlines.partition_point(|&x| x < start);
        newlines.get(a + (n - 1) as usize).copied()
    }
}

/// Identity of a sidecar: where it lives and the (length, mtime) pair the
/// original must still match for the sidecar to be trusted.
pub(crate) struct SidecarKey {
    pub(crate) path: PathBuf,
    pub(crate) file_len: u64,
    pub(crate) mtime: u64,
}

fn cache_dir() -> PathBuf {
    env::var_os("TOND_INDEX_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("tond-index")
}

fn fnv1a64(parts: &[&[u8]]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for part in parts {
        for &byte in *part {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

pub(crate) fn sidecar_key(canonical: &Path, file_len: u64, mtime: u64) -> SidecarKey {
    let hash = fnv1a64(&[
        canonical.to_string_lossy().as_bytes(),
        &file_len.to_le_bytes(),
        &mtime.to_le_bytes(),
    ]);
    SidecarKey {
        path: cache_dir().join(format!("{hash:016x}.tondidx")),
        file_len,
        mtime,
    }
}

/// Loads and validates a sidecar. Any mismatch — magic, version, stale
/// length/mtime, truncation, trailing bytes, out-of-range or non-ascending
/// offsets — returns `None` and the caller scans normally.
pub(crate) fn load_sidecar(key: &SidecarKey) -> Option<Vec<u64>> {
    let data = fs::read(&key.path).ok()?;
    if data.len() < HEADER_LEN || &data[..4] != MAGIC {
        return None;
    }
    let field = |at: usize| u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
    if u32::from_le_bytes(data[4..8].try_into().unwrap()) != VERSION
        || field(8) != key.file_len
        || field(16) != key.mtime
    {
        return None;
    }
    let count = usize::try_from(field(24)).ok()?;
    if count.checked_mul(8)? != data.len() - HEADER_LEN {
        return None;
    }
    let mut offsets = Vec::with_capacity(count);
    let mut prev = None;
    for raw in data[HEADER_LEN..].chunks_exact(8) {
        let offset = u64::from_le_bytes(raw.try_into().unwrap());
        if offset >= key.file_len || prev.is_some_and(|p| offset <= p) {
            return None;
        }
        offsets.push(offset);
        prev = Some(offset);
    }
    Some(offsets)
}

/// Best-effort persist: written to a temp file next to the final name, then
/// renamed into place; every failure is silently dropped (the sidecar is only
/// a cache).
fn write_sidecar(key: &SidecarKey, newlines: &[u64]) {
    fn inner(tmp: &Path, key: &SidecarKey, newlines: &[u64]) -> io::Result<()> {
        let mut out = BufWriter::with_capacity(1 << 20, File::create(tmp)?);
        out.write_all(MAGIC)?;
        out.write_all(&VERSION.to_le_bytes())?;
        out.write_all(&key.file_len.to_le_bytes())?;
        out.write_all(&key.mtime.to_le_bytes())?;
        out.write_all(&(newlines.len() as u64).to_le_bytes())?;
        for &offset in newlines {
            out.write_all(&offset.to_le_bytes())?;
        }
        out.flush()
    }
    let Some(dir) = key.path.parent() else {
        return;
    };
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let tmp = key
        .path
        .with_extension(format!("tmp{}", std::process::id()));
    if inner(&tmp, key, newlines).is_ok() {
        let _ = fs::rename(&tmp, &key.path);
    } else {
        let _ = fs::remove_file(&tmp);
    }
}
