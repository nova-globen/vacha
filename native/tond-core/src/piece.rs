//! Piece storage: the edited document is a sequence of pieces, each borrowing
//! bytes either from the immutable original or from the append-only add
//! buffer. Insert splits a piece; delete trims or removes pieces; nothing is
//! ever copied or moved in the underlying byte stores.
//!
//! v0 keeps the pieces in a flat `Vec` behind [`PieceStore`]'s narrow
//! interface — `find` / `insert` / `delete` and a snapshotting `Clone` — so a
//! balanced piece tree can replace the storage later without touching callers.

use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};

/// Sentinel for "newline count not computed yet".
const NEWLINES_UNKNOWN: u64 = u64::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SourceKind {
    /// Bytes of the opened file, never mutated.
    Original,
    /// Bytes of the append-only add buffer.
    Add,
}

/// One contiguous run of `len` bytes starting at `start` in `kind`.
///
/// `newlines` caches the piece's newline count. Add pieces are counted the
/// moment they are created (the inserted text is in hand and in RAM); original
/// pieces start unknown and are filled in lazily from the line index. The
/// cache is atomic so `&self` line queries can populate it.
#[derive(Debug)]
pub(crate) struct Piece {
    pub(crate) kind: SourceKind,
    pub(crate) start: u64,
    pub(crate) len: u64,
    newlines: AtomicU64,
}

impl Clone for Piece {
    fn clone(&self) -> Piece {
        Piece {
            kind: self.kind,
            start: self.start,
            len: self.len,
            newlines: AtomicU64::new(self.newlines.load(Ordering::Relaxed)),
        }
    }
}

impl Piece {
    pub(crate) fn new(kind: SourceKind, start: u64, len: u64, newlines: Option<u64>) -> Piece {
        Piece {
            kind,
            start,
            len,
            newlines: AtomicU64::new(newlines.unwrap_or(NEWLINES_UNKNOWN)),
        }
    }

    pub(crate) fn end(&self) -> u64 {
        self.start + self.len
    }

    pub(crate) fn cached_newlines(&self) -> Option<u64> {
        match self.newlines.load(Ordering::Relaxed) {
            NEWLINES_UNKNOWN => None,
            n => Some(n),
        }
    }

    pub(crate) fn cache_newlines(&self, n: u64) {
        debug_assert!(n <= self.len);
        self.newlines.store(n, Ordering::Relaxed);
    }
}

pub(crate) fn count_newlines(bytes: &[u8]) -> u64 {
    memchr::memchr_iter(b'\n', bytes).count() as u64
}

/// The ordered pieces of the edited document plus its total length.
///
/// Cloning a `PieceStore` is the undo snapshot: pieces are three words and an
/// atomic, so a full clone per edit stays cheap at v0's piece counts.
#[derive(Clone, Default)]
pub(crate) struct PieceStore {
    pieces: Vec<Piece>,
    len: u64,
    /// `(piece index, logical offset of that piece's first byte)` — a hint
    /// maintained by the `&mut` edit paths so sequential access patterns skip
    /// the cumulative scan. Always valid for the current `pieces`.
    cursor: (usize, u64),
}

impl PieceStore {
    pub(crate) fn with_original(len: u64) -> PieceStore {
        let mut store = PieceStore::default();
        if len > 0 {
            store
                .pieces
                .push(Piece::new(SourceKind::Original, 0, len, None));
            store.len = len;
        }
        store
    }

    pub(crate) fn pieces(&self) -> &[Piece] {
        &self.pieces
    }

    pub(crate) fn len(&self) -> u64 {
        self.len
    }

    /// Returns `(index, logical start)` of the piece containing `offset`, or
    /// `(pieces.len(), self.len())` when `offset` is at or past the end.
    pub(crate) fn find(&self, offset: u64) -> (usize, u64) {
        let (mut i, mut at) = if self.cursor.0 <= self.pieces.len() && self.cursor.1 <= offset {
            self.cursor
        } else {
            (0, 0)
        };
        while i < self.pieces.len() {
            let l = self.pieces[i].len;
            if offset < at + l {
                return (i, at);
            }
            at += l;
            i += 1;
        }
        (i, at)
    }

    /// Splices `piece` in at logical `offset` (clamped to the end), splitting
    /// the piece it lands inside. `add` is the add buffer, needed to keep the
    /// newline caches of split add pieces exact.
    pub(crate) fn insert(&mut self, offset: u64, piece: Piece, add: &[u8]) {
        let offset = offset.min(self.len);
        let added = piece.len;
        let (i, at) = self.find(offset);
        if offset == at {
            self.pieces.insert(i, piece);
            self.cursor = (i, offset);
        } else {
            let (left, right) = self.split_piece(i, offset - at, add);
            self.pieces[i] = left;
            self.pieces.insert(i + 1, piece);
            self.pieces.insert(i + 2, right);
            self.cursor = (i + 1, offset);
        }
        self.len += added;
    }

    /// Removes the logical byte range (clamped to the document).
    pub(crate) fn delete(&mut self, range: Range<u64>, add: &[u8]) {
        let start = range.start.min(self.len);
        let end = range.end.min(self.len);
        if start >= end {
            return;
        }
        let (mut i, at) = self.find(start);
        if start > at {
            let (left, right) = self.split_piece(i, start - at, add);
            self.pieces[i] = left;
            self.pieces.insert(i + 1, right);
            i += 1;
        }
        // The range now begins exactly at piece boundary `i`.
        let mut remaining = end - start;
        let mut k = 0usize;
        while remaining > 0 && self.pieces[i + k].len <= remaining {
            remaining -= self.pieces[i + k].len;
            k += 1;
        }
        if k > 0 {
            self.pieces.drain(i..i + k);
        }
        if remaining > 0 {
            let (_, right) = self.split_piece(i, remaining, add);
            self.pieces[i] = right;
        }
        self.len -= end - start;
        self.cursor = (i, start);
    }

    /// Splits piece `i` at intra-piece offset `at` (0 < at < len) into two
    /// pieces, preserving the always-exact newline caches of add pieces.
    fn split_piece(&self, i: usize, at: u64, add: &[u8]) -> (Piece, Piece) {
        let p = &self.pieces[i];
        debug_assert!(at > 0 && at < p.len);
        let left = Piece::new(p.kind, p.start, at, None);
        let right = Piece::new(p.kind, p.start + at, p.len - at, None);
        if p.kind == SourceKind::Add {
            let s = p.start as usize;
            let left_nl = count_newlines(&add[s..s + at as usize]);
            left.cache_newlines(left_nl);
            match p.cached_newlines() {
                Some(total) => right.cache_newlines(total - left_nl),
                None => {
                    right.cache_newlines(count_newlines(&add[s + at as usize..s + p.len as usize]))
                }
            }
        }
        (left, right)
    }
}
