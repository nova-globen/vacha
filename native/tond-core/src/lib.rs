//! tond-core — the disk-backed text engine for Tond v2.
//!
//! Opens and edits files far larger than RAM (the 50 GB class) without ever
//! materialising them: a piece table over an immutable, memory-mapped original
//! plus an append-only add buffer, with an asynchronous line index, a
//! persistent sidecar index cache, and streamed search and save. No
//! disk-backed piece-table crate exists on crates.io — this is the component
//! the commercial huge-file editors monetise, per
//! `docs/plans/06-tond/RESEARCH_huge-file-editors.md` §3–4.
//!
//! Editor-agnostic on purpose: no rendering, no encoding policy, no UI
//! assumptions — just bytes, u64 offsets, and lines.
//!
//! ```no_run
//! use tond_core::Document;
//!
//! let mut doc = Document::open(std::path::Path::new("huge.log"))?;
//! doc.insert(0, b"# annotated\n");
//! let mut first = [0u8; 32];
//! let n = doc.read(0, &mut first);
//! doc.save_as(std::path::Path::new("huge-annotated.log"))?;
//! # Ok::<(), std::io::Error>(())
//! ```

#![deny(unsafe_code)]

mod line_index;
mod piece;
mod source;

use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::mem;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::UNIX_EPOCH;

use line_index::LineIndex;
use piece::{count_newlines, Piece, PieceStore, SourceKind};
use source::Source;

/// Chunk size for the streamed paths (line scan, search, save): 8 MiB.
pub(crate) const CHUNK: usize = 8 << 20;

/// Add-buffer size past which v1 will spill inserted text to a temp file
/// (EmEditor-style) instead of growing the heap. v0 does not spill yet; the
/// constant is the hook.
pub const ADD_SPILL_THRESHOLD: u64 = 256 << 20;

/// A text document backed by the file it was opened from.
///
/// The original file is never read into the heap and never mutated; edits
/// live in an append-only add buffer and a piece table of `(source, start,
/// len)` runs. All offsets are `u64` byte offsets into the EDITED document.
///
/// External writers invalidate an open `Document` (the original is memory
/// mapped) — the same caveat every mmap-based editor carries.
pub struct Document {
    source: Arc<Source>,
    /// Canonical path of the opened original, used to key the sidecar cache
    /// and to detect save-over-the-original.
    original_path: Option<PathBuf>,
    add: Vec<u8>,
    store: PieceStore,
    undo_stack: Vec<PieceStore>,
    redo_stack: Vec<PieceStore>,
    index: Arc<LineIndex>,
    index_thread: Option<JoinHandle<()>>,
}

impl Document {
    /// Opens `path` without reading it fully: the file is memory mapped (with
    /// a windowed positioned-read fallback) and a background thread starts
    /// indexing line starts — or loads them instantly from a valid sidecar
    /// cache. Returns as soon as the mapping exists.
    pub fn open(path: &Path) -> io::Result<Document> {
        let file = File::open(path)?;
        let meta = file.metadata()?;
        let len = meta.len();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64);
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let source = Arc::new(Source::from_file(file, len));
        let key = mtime.map(|m| line_index::sidecar_key(&canonical, len, m));
        let (index, index_thread) = if len == 0 {
            (LineIndex::completed(Vec::new(), 0), None)
        } else if let Some(newlines) = key.as_ref().and_then(line_index::load_sidecar) {
            (LineIndex::completed(newlines, len), None)
        } else {
            let (index, handle) = LineIndex::start(Arc::clone(&source), key)?;
            (index, Some(handle))
        };
        Ok(Document {
            source,
            original_path: Some(canonical),
            add: Vec::new(),
            store: PieceStore::with_original(len),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            index,
            index_thread,
        })
    }

    /// An empty in-memory document.
    pub fn new() -> Document {
        Document {
            source: Arc::new(Source::empty()),
            original_path: None,
            add: Vec::new(),
            store: PieceStore::default(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            index: LineIndex::completed(Vec::new(), 0),
            index_thread: None,
        }
    }

    /// Total length in bytes of the EDITED document.
    pub fn len(&self) -> u64 {
        self.store.len()
    }

    /// True when the edited document has no bytes.
    pub fn is_empty(&self) -> bool {
        self.store.len() == 0
    }

    /// Copies bytes of the edited document starting at `offset` into `buf`
    /// (clamped to the document); returns the number of bytes written.
    pub fn read(&self, offset: u64, buf: &mut [u8]) -> usize {
        if offset >= self.store.len() || buf.is_empty() {
            return 0;
        }
        let (start_piece, piece_start) = self.store.find(offset);
        let pieces = self.store.pieces();
        let mut inner = offset - piece_start;
        let mut written = 0usize;
        for piece in &pieces[start_piece..] {
            if written == buf.len() {
                break;
            }
            let want = (buf.len() - written).min((piece.len - inner) as usize);
            let dst = &mut buf[written..written + want];
            match piece.kind {
                SourceKind::Add => {
                    let s = (piece.start + inner) as usize;
                    dst.copy_from_slice(&self.add[s..s + want]);
                }
                SourceKind::Original => {
                    let got = self.source.read_at(piece.start + inner, dst);
                    if got < want {
                        // Original truncated externally; report what we have.
                        return written + got;
                    }
                }
            }
            written += want;
            inner = 0;
        }
        written
    }

    /// Inserts `text` at byte `offset` (clamped to the end).
    ///
    /// O(pieces) worst case in v0; the storage sits behind a private
    /// `PieceStore` so a piece tree can replace it without API changes.
    pub fn insert(&mut self, offset: u64, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.snapshot();
        let start = self.add.len() as u64;
        self.add.extend_from_slice(text);
        // TODO(v1): once `self.add.len()` crosses ADD_SPILL_THRESHOLD, spill
        // the add buffer to a temp file and read pieces back through it.
        let newlines = count_newlines(text);
        let piece = Piece::new(SourceKind::Add, start, text.len() as u64, Some(newlines));
        self.store.insert(offset, piece, &self.add);
    }

    /// Deletes the byte `range` (clamped to the document).
    pub fn delete(&mut self, range: Range<u64>) {
        let start = range.start.min(self.len());
        let end = range.end.min(self.len());
        if start >= end {
            return;
        }
        self.snapshot();
        self.store.delete(start..end, &self.add);
    }

    /// Reverts the most recent edit; returns false when there is nothing to
    /// undo. Depth is unlimited: undo states are piece-table snapshots and the
    /// add buffer is append-only, so old snapshots stay valid forever.
    pub fn undo(&mut self) -> bool {
        match self.undo_stack.pop() {
            Some(prev) => {
                self.redo_stack.push(mem::replace(&mut self.store, prev));
                true
            }
            None => false,
        }
    }

    /// Re-applies the most recently undone edit; returns false when there is
    /// nothing to redo. The redo stack is cleared by every new edit.
    pub fn redo(&mut self) -> bool {
        match self.redo_stack.pop() {
            Some(next) => {
                self.undo_stack.push(mem::replace(&mut self.store, next));
                true
            }
            None => false,
        }
    }

    /// Number of lines currently known (a document always has at least one).
    ///
    /// While the background index is still running, newline counts for
    /// not-yet-scanned regions of the original are unknown, so this is a
    /// lower bound that grows monotonically as the scan advances
    /// (klogg-style; it never blocks on the scan). Exact once
    /// [`index_progress`](Self::index_progress) is `1.0` —
    /// [`wait_for_index`](Self::wait_for_index) forces that. Inserted and
    /// deleted text is always counted exactly.
    pub fn line_count(&self) -> u64 {
        let mut lines = 1u64;
        for piece in self.store.pieces() {
            lines += self.piece_newlines(piece);
        }
        lines
    }

    /// Byte offset of the start of line `line` (0-based) in the EDITED
    /// document. `None` when the document has fewer lines — which, before the
    /// index completes, can also mean "not scanned yet" for original regions
    /// (same best-effort contract as [`line_count`](Self::line_count)).
    pub fn line_start(&self, line: u64) -> Option<u64> {
        if line == 0 {
            return Some(0);
        }
        let mut acc_offset = 0u64;
        let mut acc_lines = 0u64;
        for piece in self.store.pieces() {
            let newlines = self.piece_newlines(piece);
            if acc_lines + newlines >= line {
                let nth = line - acc_lines; // 1-based within this piece
                let inner = self.nth_newline_in_piece(piece, nth)?;
                return Some(acc_offset + inner + 1);
            }
            acc_lines += newlines;
            acc_offset += piece.len;
        }
        None
    }

    /// The 0-based line containing byte `offset` (clamped; `offset == len()`
    /// answers the final line). Best-effort before the index completes, as
    /// for [`line_count`](Self::line_count).
    pub fn line_at(&self, offset: u64) -> u64 {
        let offset = offset.min(self.store.len());
        let (piece_idx, piece_start) = self.store.find(offset);
        let pieces = self.store.pieces();
        let mut lines = 0u64;
        for piece in &pieces[..piece_idx] {
            lines += self.piece_newlines(piece);
        }
        if piece_idx < pieces.len() && offset > piece_start {
            let piece = &pieces[piece_idx];
            let inner = offset - piece_start;
            lines += match piece.kind {
                SourceKind::Add => {
                    let s = piece.start as usize;
                    count_newlines(&self.add[s..s + inner as usize])
                }
                SourceKind::Original => self.index.count_in(piece.start..piece.start + inner).0,
            };
        }
        lines
    }

    /// Progress of the background line scan of the original, `0.0..=1.0`.
    /// Documents opened from a sidecar cache (and empty documents) report
    /// `1.0` immediately.
    pub fn index_progress(&self) -> f64 {
        self.index.progress()
    }

    /// Blocks until the line index is complete, making every line query
    /// exact. Intended for tests and command-line callers.
    pub fn wait_for_index(&self) {
        self.index.wait();
    }

    /// Streamed, case-sensitive literal search over the EDITED document.
    /// Calls `on_match` with the byte offset of every occurrence at or after
    /// `from` — including overlapping ones — in ascending order, until
    /// exhaustion or until `on_match` returns false. Runs on the caller's
    /// thread; scratch memory is bounded by the chunk size and the needle
    /// length, never by the file size. An empty needle matches nothing.
    ///
    /// Matches spanning piece boundaries are found via a rolling window of
    /// the last `needle.len() - 1` bytes carried across every boundary.
    pub fn search(&self, needle: &[u8], from: u64, on_match: &mut dyn FnMut(u64) -> bool) {
        if needle.is_empty() || from >= self.store.len() {
            return;
        }
        let finder = memchr::memmem::Finder::new(needle);
        let keep = needle.len() - 1;
        let mut tail: Vec<u8> = Vec::with_capacity(keep);
        let mut boundary: Vec<u8> = Vec::with_capacity(2 * keep);
        let mut scratch: Vec<u8> = Vec::new();
        let pieces = self.store.pieces();
        let (start_piece, piece_start) = self.store.find(from);
        let mut logical = from;
        let mut inner = from - piece_start;
        for piece in &pieces[start_piece..] {
            while inner < piece.len {
                let chunk: &[u8] = match piece.kind {
                    SourceKind::Add => {
                        let s = (piece.start + inner) as usize;
                        let e = (piece.start + piece.len) as usize;
                        &self.add[s..e.min(s + CHUNK)]
                    }
                    SourceKind::Original => {
                        let want = ((piece.len - inner) as usize).min(CHUNK);
                        self.source.chunk(piece.start + inner, want, &mut scratch)
                    }
                };
                if chunk.is_empty() {
                    return; // original truncated externally
                }
                // Matches crossing into this chunk start inside `tail`.
                if keep > 0 && !tail.is_empty() {
                    boundary.clear();
                    boundary.extend_from_slice(&tail);
                    boundary.extend_from_slice(&chunk[..keep.min(chunk.len())]);
                    let tail_len = tail.len();
                    let base = logical - tail_len as u64;
                    let mut pos = 0usize;
                    while let Some(m) = finder.find(&boundary[pos..]) {
                        let at = pos + m;
                        if at >= tail_len {
                            break; // starts in the chunk; the chunk pass owns it
                        }
                        if at + needle.len() > tail_len && !on_match(base + at as u64) {
                            return;
                        }
                        pos = at + 1;
                    }
                }
                // Matches starting inside this chunk (overlapping included).
                let mut pos = 0usize;
                while let Some(m) = finder.find(&chunk[pos..]) {
                    let at = pos + m;
                    if !on_match(logical + at as u64) {
                        return;
                    }
                    pos = at + 1;
                }
                // Roll the boundary window forward.
                if keep > 0 {
                    if chunk.len() >= keep {
                        tail.clear();
                        tail.extend_from_slice(&chunk[chunk.len() - keep..]);
                    } else {
                        tail.extend_from_slice(chunk);
                        let excess = tail.len().saturating_sub(keep);
                        if excess > 0 {
                            tail.drain(..excess);
                        }
                    }
                }
                logical += chunk.len() as u64;
                inner += chunk.len() as u64;
            }
            inner = 0;
        }
    }

    /// Streamed save: merges the pieces into a temp file in the target's
    /// directory, fsyncs it, then atomically renames it over the target. The
    /// document is never materialised in memory and the target is untouched
    /// until the rename.
    ///
    /// Saving over the opened original requires releasing the memory mapping
    /// first, so on that path the document re-bases onto the freshly written
    /// file: undo/redo history is cleared and the line index restarts (v0
    /// trade-off). Saving anywhere else leaves the document, its history, and
    /// its mapping untouched.
    pub fn save_as(&mut self, path: &Path) -> io::Result<()> {
        let parent = match path.parent() {
            Some(dir) if !dir.as_os_str().is_empty() => dir.to_path_buf(),
            _ => PathBuf::from("."),
        };
        let tmp = temp_path(&parent, path);
        if let Err(error) = self.stream_to(&tmp) {
            let _ = fs::remove_file(&tmp);
            return Err(error);
        }
        let replacing = match (&self.original_path, fs::canonicalize(path)) {
            (Some(original), Ok(target)) => *original == target,
            _ => false,
        };
        if !replacing {
            if let Err(error) = fs::rename(&tmp, path) {
                let _ = fs::remove_file(&tmp);
                return Err(error);
            }
            return Ok(());
        }
        // The mapping holds the target open, which blocks the rename on
        // Windows: stop the scanner, drop the map, then swap the file.
        self.index.cancel();
        if let Some(handle) = self.index_thread.take() {
            let _ = handle.join();
        }
        let original_path = self
            .original_path
            .clone()
            .expect("replacing implies a path");
        self.source = Arc::new(Source::empty());
        if let Err(error) = fs::rename(&tmp, path) {
            let _ = fs::remove_file(&tmp);
            // The original is still in place; remap it so the document keeps
            // working. Line queries stay frozen where the cancelled scan got.
            if let Ok(source) = Source::open(&original_path) {
                self.source = Arc::new(source);
            }
            return Err(error);
        }
        // Re-base onto the saved file. If this reopen fails the document is
        // unusable (its original is gone); the error says so.
        *self = Document::open(path)?;
        Ok(())
    }

    /// Snapshot the piece table for undo; every new edit clears redo.
    fn snapshot(&mut self) {
        self.undo_stack.push(self.store.clone());
        self.redo_stack.clear();
    }

    /// Newline count of a piece. Add pieces are always cached exactly;
    /// original pieces are answered from the line index — exact (and then
    /// cached on the piece) once the index covers them, otherwise the
    /// best-effort count of the scanned part.
    fn piece_newlines(&self, piece: &Piece) -> u64 {
        if let Some(cached) = piece.cached_newlines() {
            return cached;
        }
        match piece.kind {
            SourceKind::Add => {
                let s = piece.start as usize;
                let newlines = count_newlines(&self.add[s..s + piece.len as usize]);
                piece.cache_newlines(newlines);
                newlines
            }
            SourceKind::Original => {
                let (newlines, exact) = self.index.count_in(piece.start..piece.end());
                if exact {
                    piece.cache_newlines(newlines);
                }
                newlines
            }
        }
    }

    /// Intra-piece byte offset of the `nth` newline (1-based) in `piece`.
    fn nth_newline_in_piece(&self, piece: &Piece, nth: u64) -> Option<u64> {
        match piece.kind {
            SourceKind::Add => {
                let s = piece.start as usize;
                memchr::memchr_iter(b'\n', &self.add[s..s + piece.len as usize])
                    .nth((nth - 1) as usize)
                    .map(|pos| pos as u64)
            }
            SourceKind::Original => {
                let global = self.index.nth_in(piece.start, nth)?;
                (global < piece.end()).then(|| global - piece.start)
            }
        }
    }

    /// Streams the edited document into `path` and fsyncs it.
    fn stream_to(&self, path: &Path) -> io::Result<()> {
        let mut out = BufWriter::with_capacity(1 << 20, File::create(path)?);
        let mut scratch = Vec::new();
        for piece in self.store.pieces() {
            match piece.kind {
                SourceKind::Add => {
                    let s = piece.start as usize;
                    out.write_all(&self.add[s..s + piece.len as usize])?;
                }
                SourceKind::Original => {
                    let mut inner = 0u64;
                    while inner < piece.len {
                        let want = ((piece.len - inner) as usize).min(CHUNK);
                        let chunk = self.source.chunk(piece.start + inner, want, &mut scratch);
                        if chunk.is_empty() {
                            return Err(io::Error::new(
                                io::ErrorKind::UnexpectedEof,
                                "original file shrank while saving",
                            ));
                        }
                        out.write_all(chunk)?;
                        inner += chunk.len() as u64;
                    }
                }
            }
        }
        out.flush()?;
        out.get_ref().sync_all()
    }
}

impl Default for Document {
    fn default() -> Document {
        Document::new()
    }
}

impl Drop for Document {
    fn drop(&mut self) {
        self.index.cancel();
        if let Some(handle) = self.index_thread.take() {
            let _ = handle.join();
        }
    }
}

/// A unique temp-file name in `dir`, next to `target` so the final rename
/// never crosses a volume.
fn temp_path(dir: &Path, target: &Path) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = target
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unnamed".into());
    dir.join(format!(".{name}.{}-{n}.tond-save", std::process::id()))
}
