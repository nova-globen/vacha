//! save_as round trips: new path, save over the opened original, and
//! documents that never had a file.

mod util;

use std::fs;

use tond_core::Document;
use util::read_all;

#[test]
fn save_as_new_path_round_trip() {
    let dir = util::scratch_dir("save-new");
    let original: &[u8] = b"alpha\nbeta\ngamma\n";
    let orig_path = util::write_file(&dir, "orig.txt", original);

    let mut doc = Document::open(&orig_path).unwrap();
    doc.wait_for_index();
    let mut model = original.to_vec();
    doc.insert(0, b">> ");
    model.splice(0..0, b">> ".iter().copied());
    doc.delete(9..14);
    model.drain(9..14);
    let end = doc.len();
    doc.insert(end, b"delta\n");
    model.extend_from_slice(b"delta\n");

    let out_path = dir.join("out.txt");
    doc.save_as(&out_path).unwrap();

    assert_eq!(fs::read(&out_path).unwrap(), model, "saved bytes");
    assert_eq!(
        fs::read(&orig_path).unwrap(),
        original,
        "original untouched"
    );
    let leftovers: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("tond-save"))
        .collect();
    assert!(leftovers.is_empty(), "stray temp files: {leftovers:?}");

    // Reopening the saved file yields the same content and line structure.
    let doc2 = Document::open(&out_path).unwrap();
    doc2.wait_for_index();
    assert_eq!(read_all(&doc2), model);
    util::check_lines(&doc2, &model);

    // Saving elsewhere does not re-base: history survives.
    assert!(doc.undo());
    assert_eq!(read_all(&doc), &model[..model.len() - 6]);
}

#[test]
fn save_over_original_rebases() {
    let dir = util::scratch_dir("save-over");
    let original: &[u8] = b"one\ntwo\nthree\nfour\n";
    let path = util::write_file(&dir, "inplace.txt", original);

    let mut doc = Document::open(&path).unwrap();
    doc.wait_for_index();
    let mut model = original.to_vec();
    doc.delete(4..8);
    model.drain(4..8);
    doc.insert(4, b"TWO\n");
    model.splice(4..4, b"TWO\n".iter().copied());

    doc.save_as(&path).unwrap();

    assert_eq!(fs::read(&path).unwrap(), model, "file replaced in place");
    assert_eq!(doc.len(), model.len() as u64);
    assert_eq!(read_all(&doc), model);
    assert!(!doc.undo(), "re-base clears undo history");
    doc.wait_for_index();
    util::check_lines(&doc, &model);

    // The re-based document keeps working: edit and save in place again.
    doc.insert(0, b"# ");
    model.splice(0..0, b"# ".iter().copied());
    doc.save_as(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), model);
    assert_eq!(read_all(&doc), model);
}

#[test]
fn save_documents_without_files() {
    let dir = util::scratch_dir("save-nofile");

    let mut doc = Document::new();
    doc.insert(0, b"hello\nworld");
    let path = dir.join("fresh.txt");
    doc.save_as(&path).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"hello\nworld");

    let mut empty = Document::new();
    let empty_path = dir.join("empty.txt");
    empty.save_as(&empty_path).unwrap();
    assert_eq!(fs::read(&empty_path).unwrap(), b"");
}
