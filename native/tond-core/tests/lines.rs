//! Line index exactness, the sidecar cache round trip, and corrupt-sidecar
//! fallback. Kept as a single test because it owns the TOND_INDEX_DIR
//! environment variable for this process.

mod util;

use std::fs;

use tond_core::Document;
use util::check_lines;

#[test]
fn line_queries_sidecar_round_trip_and_corruption() {
    let dir = util::scratch_dir("lines");
    let index_dir = dir.join("idx");
    std::env::set_var("TOND_INDEX_DIR", &index_dir);

    // Empty lines, \r\n, a bare \r (not a terminator), no trailing newline.
    let content: &[u8] = b"first\n\nthird line\r\nfourth\rstill fourth\nno trailing newline";
    let path = util::write_file(&dir, "lines.txt", content);

    // Cold open: background scan, exact after wait_for_index.
    {
        let doc = Document::open(&path).unwrap();
        doc.wait_for_index();
        assert_eq!(doc.index_progress(), 1.0);
        check_lines(&doc, content);
    }

    // The completed scan persisted a sidecar.
    let sidecar_dir = index_dir.join("tond-index");
    let sidecars: Vec<_> = fs::read_dir(&sidecar_dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "tondidx"))
        .collect();
    assert_eq!(sidecars.len(), 1, "expected exactly one sidecar");

    // Warm open: the sidecar completes the index synchronously, same answers.
    {
        let doc = Document::open(&path).unwrap();
        assert_eq!(
            doc.index_progress(),
            1.0,
            "sidecar should complete the index at open"
        );
        check_lines(&doc, content);
    }

    // A corrupt sidecar must be ignored: scan runs, answers stay exact.
    fs::write(&sidecars[0], b"TNDXgarbage").unwrap();
    {
        let doc = Document::open(&path).unwrap();
        doc.wait_for_index();
        check_lines(&doc, content);
    }

    // A truncated sidecar (valid header, short body) must also be ignored.
    let good = fs::read(&sidecars[0]).unwrap();
    fs::write(&sidecars[0], &good[..good.len() - 5]).unwrap();
    {
        let doc = Document::open(&path).unwrap();
        doc.wait_for_index();
        check_lines(&doc, content);
    }

    // Line queries combine the original index with edited pieces.
    {
        let mut doc = Document::open(&path).unwrap();
        doc.wait_for_index();
        let mut model = content.to_vec();
        doc.insert(6, b"inserted\nlines\n");
        model.splice(6..6, b"inserted\nlines\n".iter().copied());
        doc.delete(0..2);
        model.drain(0..2);
        let end = doc.len();
        doc.insert(end, b"\nappended");
        model.extend_from_slice(b"\nappended");
        check_lines(&doc, &model);
    }
}
