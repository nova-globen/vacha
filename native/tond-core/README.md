# tond-core

The disk-backed text engine for Tond v2: open **and edit** files in the
50 GB class without ever loading them into memory.

The market research (`docs/plans/06-tond/RESEARCH_huge-file-editors.md`)
found that every genuine 50 GB editor is closed-source and dated, that no
disk-backed rope or piece-table crate exists on crates.io, and that this
missing component is exactly what EmEditor and 010 Editor have monetised for
two decades. This crate is that component, editor-agnostic on purpose: no
rendering, no encoding policy, no UI assumptions — bytes, `u64` offsets, and
lines.

## Architecture

Piece table over a disk-backed original (research §4):

- **Original** — the opened file, never mutated. Memory mapped read-only
  (`memmap2`), with a windowed positioned-read fallback when mapping fails.
  Heap cost for unchanged content is ~zero.
- **Add buffer** — append-only `Vec<u8>` holding every inserted byte.
- **Piece table** — `(source, start, len)` runs with per-piece newline
  counts; insert splits a piece, delete trims or removes pieces. Stored in a
  flat `Vec` behind a private `PieceStore` so a balanced piece tree can
  replace it without API changes.
- **Undo** — piece-table snapshots; the add buffer is append-only, so old
  snapshots stay valid forever and depth is unlimited (010 Editor's trick).
- **Async line index** — a background thread scans the original with
  `memchr` in 8 MiB chunks (klogg-style). Line queries combine that index
  with the per-piece newline counts of edits.
- **Sidecar cache** — a completed scan persists the newline table to
  `<cache_dir>/tond-index/<hash>.tondidx`, keyed by canonical path + length
  + mtime (`TOND_INDEX_DIR` overrides the cache dir, default is the system
  temp dir). Reopening an unchanged file skips the scan entirely; corrupt,
  short, or stale sidecars are ignored safely.
- **Streamed search and save** — both iterate pieces in chunks. Search
  carries a rolling `needle.len() - 1` window across every piece and chunk
  boundary, so spanning matches are found; save merges pieces into a temp
  file next to the target, fsyncs, then atomically renames it into place.

## API

```rust
use tond_core::Document;

let mut doc = Document::open(path)?;      // mmap; returns immediately
doc.len();                                // edited length, bytes
doc.read(offset, &mut buf);               // any window of the edited document
doc.insert(offset, b"text");              // edits never touch the original
doc.delete(range);
doc.undo(); doc.redo();                   // unlimited depth
doc.line_count();                         // exact once index_progress() == 1.0
doc.line_start(line); doc.line_at(offset);
doc.index_progress();                     // 0.0..=1.0 background scan
doc.wait_for_index();                     // block until line queries are exact
doc.search(b"needle", 0, &mut |hit| true);// streamed, boundary-safe
doc.save_as(path)?;                       // streamed merge + atomic rename
```

Line-query semantics before the index completes: counts over unscanned
regions of the original are best-effort lower bounds that grow monotonically
as the scan advances; edited text is always exact. `wait_for_index()` (or
`index_progress() == 1.0`) makes every answer exact.

The mmap caveat all such editors share: an external writer that truncates or
rewrites the opened file invalidates the `Document`.

## v0 limitations (deliberate)

- `Vec` piece store: edits are O(pieces); fine for thousands of edits, the
  private `PieceStore` interface is where the piece tree lands in v1.
- No add-buffer spill: inserted text lives in RAM. `ADD_SPILL_THRESHOLD` is
  the hook; v1 spills to a temp file EmEditor-style.
- Search is literal, case-sensitive, and single-threaded (it reports every
  occurrence, including overlapping ones).
- Saving over the opened original re-bases the document (the mapping must be
  released to swap the file), clearing undo history and restarting the line
  index. Saving anywhere else keeps history intact.
- Undo snapshots clone the piece `Vec` per edit; cheap now, becomes shared
  subtrees with the piece tree.

## v1 roadmap hooks

- Piece tree behind `PieceStore` (same interface, O(log pieces) edits).
- Add-buffer spill past `ADD_SPILL_THRESHOLD`.
- Regex/case-folded streaming search on the same chunk walker.
- In-place patch fast path for overwrite-only edits (research §4.6).
- Hybrid threshold: below ~100–500 MB a rope path with full editor feel,
  above it this engine with feature shedding.

## Build, test, bench

```
cargo build --release
cargo test --release
cargo run --release --example bench -- gen 1        # 1 GiB synthetic log
cargo run --release --example bench -- run <path>   # prints the table
```

Dependencies: `memmap2` and `memchr` only; everything else is std.
