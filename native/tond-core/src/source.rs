//! Read-only access to the opened original file.
//!
//! The fast path is a whole-file memory mapping; when mapping fails (exotic
//! filesystems, exhausted address space) every read degrades to a positioned
//! `pread`-style call on the file handle. Nothing here ever loads the file
//! into the heap.
//!
//! This is the only module in the crate allowed to contain `unsafe`.

use std::fs::File;
use std::io;
use std::path::Path;

/// Immutable byte source backing the `Original` side of the piece table.
///
/// The mutation-under-mmap caveat every mmap-based editor shares: the length
/// is captured once at open, and an external writer that truncates or rewrites
/// the file invalidates the mapping and with it the whole `Document`. Callers
/// own that contract, exactly as EmEditor and klogg do.
pub(crate) enum Source {
    /// The empty original of `Document::new` (and of zero-length files, which
    /// cannot be mapped on Windows).
    Empty,
    /// Whole-file read-only mapping.
    Mapped(memmap2::Mmap),
    /// Windowed positioned-read fallback when mapping fails.
    Windowed { file: File, len: u64 },
}

impl Source {
    pub(crate) fn empty() -> Source {
        Source::Empty
    }

    pub(crate) fn open(path: &Path) -> io::Result<Source> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Ok(Source::from_file(file, len))
    }

    /// Wraps an already-opened read-only file of known length.
    pub(crate) fn from_file(file: File, len: u64) -> Source {
        if len == 0 {
            return Source::Empty;
        }
        // SAFETY: `file` is opened read-only and this process never writes
        // through the mapping. `len` was captured once, above, and every read
        // below is bounds-checked against the mapping's own length, so no
        // access can leave the mapped region. The remaining hazard — another
        // process truncating the file out from under the map — is the
        // documented caveat on this type, not a soundness burden this module
        // can discharge.
        #[allow(unsafe_code)]
        match unsafe { memmap2::Mmap::map(&file) } {
            Ok(map) => Source::Mapped(map),
            Err(_) => Source::Windowed { file, len },
        }
    }

    pub(crate) fn len(&self) -> u64 {
        match self {
            Source::Empty => 0,
            Source::Mapped(map) => map.len() as u64,
            Source::Windowed { len, .. } => *len,
        }
    }

    /// Copies bytes at `offset` into `buf`; returns the count copied (short at
    /// end of file, `0` past it).
    pub(crate) fn read_at(&self, offset: u64, buf: &mut [u8]) -> usize {
        match self {
            Source::Empty => 0,
            Source::Mapped(map) => {
                let len = map.len() as u64;
                if offset >= len {
                    return 0;
                }
                let start = offset as usize;
                let n = buf.len().min((len - offset) as usize);
                buf[..n].copy_from_slice(&map[start..start + n]);
                n
            }
            Source::Windowed { file, len } => {
                if offset >= *len {
                    return 0;
                }
                let want = buf.len().min((*len - offset) as usize);
                let mut done = 0;
                while done < want {
                    match positioned_read(file, &mut buf[done..want], offset + done as u64) {
                        Ok(0) => break,
                        Ok(n) => done += n,
                        Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                        Err(_) => break,
                    }
                }
                done
            }
        }
    }

    /// Borrows up to `max` bytes starting at `offset`: a zero-copy slice of
    /// the mapping on the fast path, otherwise a windowed read into `scratch`.
    /// Returns an empty slice at or past end of file.
    pub(crate) fn chunk<'a>(
        &'a self,
        offset: u64,
        max: usize,
        scratch: &'a mut Vec<u8>,
    ) -> &'a [u8] {
        match self {
            Source::Mapped(map) => {
                let len = map.len() as u64;
                if offset >= len {
                    return &[];
                }
                let n = max.min((len - offset) as usize);
                let start = offset as usize;
                &map[start..start + n]
            }
            _ => {
                scratch.resize(max, 0);
                let n = self.read_at(offset, scratch);
                &scratch[..n]
            }
        }
    }
}

#[cfg(windows)]
fn positioned_read(file: &File, buf: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_read(buf, offset)
}

#[cfg(unix)]
fn positioned_read(file: &File, buf: &mut [u8], offset: u64) -> io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.read_at(buf, offset)
}
