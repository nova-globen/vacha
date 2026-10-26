//! Differential fuzz: random insert/delete/undo/redo applied to a `Document`
//! and to a plain `Vec<u8>` reference model, asserting equality after every
//! operation.

mod util;

use std::mem;

use tond_core::Document;
use util::{line_starts, read_all, Lcg};

struct Model {
    bytes: Vec<u8>,
    undo: Vec<Vec<u8>>,
    redo: Vec<Vec<u8>>,
}

impl Model {
    fn insert(&mut self, offset: u64, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        self.undo.push(self.bytes.clone());
        self.redo.clear();
        let at = (offset as usize).min(self.bytes.len());
        self.bytes.splice(at..at, text.iter().copied());
    }

    fn delete(&mut self, start: u64, end: u64) {
        let s = (start as usize).min(self.bytes.len());
        let e = (end as usize).min(self.bytes.len());
        if s >= e {
            return;
        }
        self.undo.push(self.bytes.clone());
        self.redo.clear();
        self.bytes.drain(s..e);
    }

    fn undo(&mut self) -> bool {
        match self.undo.pop() {
            Some(prev) => {
                self.redo.push(mem::replace(&mut self.bytes, prev));
                true
            }
            None => false,
        }
    }

    fn redo(&mut self) -> bool {
        match self.redo.pop() {
            Some(next) => {
                self.undo.push(mem::replace(&mut self.bytes, next));
                true
            }
            None => false,
        }
    }
}

#[test]
fn differential_random_edits() {
    let mut rng = Lcg(0x0705_2026_5eed_0001);

    // A small original with uneven lines, some \r\n, and no trailing newline.
    let mut original = Vec::new();
    for i in 0..120u64 {
        let line_len = rng.next() % 40;
        for _ in 0..line_len {
            original.push(b'a' + (rng.next() % 26) as u8);
        }
        if i % 7 == 3 {
            original.push(b'\r');
        }
        original.push(b'\n');
    }
    original.extend_from_slice(b"tail without newline");

    let dir = util::scratch_dir("fuzz");
    let path = util::write_file(&dir, "fuzz-original.txt", &original);

    let mut doc = Document::open(&path).unwrap();
    doc.wait_for_index();
    let mut model = Model {
        bytes: original.clone(),
        undo: Vec::new(),
        redo: Vec::new(),
    };

    for step in 0..2000u32 {
        let len = model.bytes.len() as u64;
        match rng.next() % 100 {
            0..=44 => {
                let offset = rng.next() % (len + 3); // sometimes past the end
                let text_len = (rng.next() % 9) as usize; // sometimes empty
                let mut text = Vec::with_capacity(text_len);
                for _ in 0..text_len {
                    text.push(match rng.next() % 20 {
                        0 => b'\n',
                        1 => b'\r',
                        c => b'a' + c as u8,
                    });
                }
                doc.insert(offset, &text);
                model.insert(offset, &text);
            }
            45..=79 => {
                let start = rng.next() % (len + 3);
                let end = start + rng.next() % 12;
                doc.delete(start..end);
                model.delete(start, end);
            }
            80..=89 => {
                assert_eq!(doc.undo(), model.undo(), "undo disagreement at {step}");
            }
            _ => {
                assert_eq!(doc.redo(), model.redo(), "redo disagreement at {step}");
            }
        }

        assert_eq!(doc.len(), model.bytes.len() as u64, "len at {step}");
        assert_eq!(read_all(&doc), model.bytes, "content at {step}");
        let newlines = model.bytes.iter().filter(|&&b| b == b'\n').count() as u64;
        assert_eq!(doc.line_count(), newlines + 1, "line_count at {step}");

        if step % 25 == 24 {
            // Windowed read from a random offset.
            let offset = rng.next() % (model.bytes.len() as u64 + 2);
            let mut window = [0u8; 33];
            let n = doc.read(offset, &mut window);
            let s = (offset as usize).min(model.bytes.len());
            let expected = &model.bytes[s..(s + 33).min(model.bytes.len())];
            assert_eq!(&window[..n], expected, "windowed read at {step}");
        }

        if step % 100 == 99 {
            let starts = line_starts(&model.bytes);
            for (line, &start) in starts.iter().enumerate() {
                assert_eq!(
                    doc.line_start(line as u64),
                    Some(start),
                    "line_start({line}) at {step}"
                );
            }
            assert_eq!(doc.line_start(starts.len() as u64), None);
            for offset in (0..=model.bytes.len()).step_by(37) {
                let expected = model.bytes[..offset]
                    .iter()
                    .filter(|&&b| b == b'\n')
                    .count() as u64;
                assert_eq!(doc.line_at(offset as u64), expected, "line_at at {step}");
            }
        }
    }
}
