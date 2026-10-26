//! Edge cases: empty file, empty document, boundary inserts, delete-all,
//! clamping, undo/redo stack rules.

mod util;

use tond_core::Document;
use util::read_all;

#[test]
fn empty_file() {
    let dir = util::scratch_dir("edge-empty");
    let path = util::write_file(&dir, "empty.txt", b"");
    let mut doc = Document::open(&path).unwrap();
    assert_eq!(doc.len(), 0);
    assert!(doc.is_empty());
    assert_eq!(doc.index_progress(), 1.0);
    assert_eq!(doc.line_count(), 1);
    assert_eq!(doc.line_start(0), Some(0));
    assert_eq!(doc.line_start(1), None);
    assert_eq!(doc.line_at(0), 0);
    let mut buf = [0u8; 8];
    assert_eq!(doc.read(0, &mut buf), 0);

    doc.insert(0, b"now\nfull");
    assert_eq!(read_all(&doc), b"now\nfull");
    assert_eq!(doc.line_count(), 2);
}

#[test]
fn empty_document_and_boundary_inserts() {
    let mut doc = Document::new();
    assert_eq!(doc.len(), 0);
    assert_eq!(doc.line_count(), 1);
    assert_eq!(doc.line_start(0), Some(0));
    assert!(!doc.undo());
    assert!(!doc.redo());

    doc.insert(0, b"middle");
    doc.insert(0, b"start-");
    let end = doc.len();
    doc.insert(end, b"-end");
    assert_eq!(read_all(&doc), b"start-middle-end");

    // Insert past the end clamps to the end.
    doc.insert(9999, b"!");
    assert_eq!(read_all(&doc), b"start-middle-end!");

    // Reads past the end return nothing.
    let mut buf = [0u8; 4];
    assert_eq!(doc.read(doc.len(), &mut buf), 0);
    assert_eq!(doc.read(doc.len() + 100, &mut buf), 0);
}

#[test]
fn delete_all_and_clamped_deletes() {
    let dir = util::scratch_dir("edge-delall");
    let content: &[u8] = b"line one\nline two\nline three\n";
    let path = util::write_file(&dir, "del.txt", content);
    let mut doc = Document::open(&path).unwrap();
    doc.wait_for_index();

    doc.delete(0..doc.len());
    assert_eq!(doc.len(), 0);
    assert_eq!(doc.line_count(), 1);
    assert_eq!(read_all(&doc), b"");

    // Deleting from an empty document is a no-op that records no undo state.
    doc.delete(0..10);
    assert!(doc.undo(), "the delete-all is undoable");
    assert_eq!(read_all(&doc), content);
    assert!(!doc.undo(), "exactly one edit was recorded");

    // A delete whose range starts past the end is a no-op.
    doc.delete(doc.len() + 5..doc.len() + 9);
    assert_eq!(read_all(&doc), content);
}

#[test]
fn undo_redo_stack_rules() {
    let mut doc = Document::new();
    doc.insert(0, b"abc");
    doc.insert(3, b"def");
    assert_eq!(read_all(&doc), b"abcdef");

    assert!(doc.undo());
    assert_eq!(read_all(&doc), b"abc");
    assert!(doc.redo());
    assert_eq!(read_all(&doc), b"abcdef");

    // A new edit clears the redo stack.
    assert!(doc.undo());
    doc.insert(0, b"x");
    assert!(!doc.redo());
    assert_eq!(read_all(&doc), b"xabc");

    // Unlimited depth: unwind everything.
    assert!(doc.undo());
    assert!(doc.undo());
    assert!(!doc.undo());
    assert_eq!(doc.len(), 0);
    // Empty inserts never record history and never clear the redo stack.
    doc.insert(0, b"");
    assert!(doc.redo(), "empty insert must not clear redo");
    assert_eq!(read_all(&doc), b"abc");
}
