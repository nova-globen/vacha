//! Streamed-search tests focused on matches spanning piece boundaries.

mod util;

use tond_core::Document;

fn collect(doc: &Document, needle: &[u8], from: u64) -> Vec<u64> {
    let mut hits = Vec::new();
    doc.search(needle, from, &mut |offset| {
        hits.push(offset);
        true
    });
    hits
}

#[test]
fn needle_across_original_add_boundary_every_alignment() {
    let dir = util::scratch_dir("search-oa");
    let needle = b"NEEDLE";
    let prefix = b"0123456789";
    let suffix = b"abcdefghij";
    for k in 1..needle.len() {
        let mut content = prefix.to_vec();
        content.extend_from_slice(&needle[..k]);
        let path = util::write_file(&dir, &format!("oa{k}.txt"), &content);
        let mut doc = Document::open(&path).unwrap();
        let end = doc.len();
        let mut rest = needle[k..].to_vec();
        rest.extend_from_slice(suffix);
        doc.insert(end, &rest);
        assert_eq!(collect(&doc, needle, 0), vec![prefix.len() as u64], "k={k}");
    }
}

#[test]
fn needle_across_add_original_boundary_every_alignment() {
    let dir = util::scratch_dir("search-ao");
    let needle = b"NEEDLE";
    let suffix = b"abcdefghij";
    for k in 1..needle.len() {
        let mut content = needle[k..].to_vec();
        content.extend_from_slice(suffix);
        let path = util::write_file(&dir, &format!("ao{k}.txt"), &content);
        let mut doc = Document::open(&path).unwrap();
        doc.insert(0, &needle[..k]);
        assert_eq!(collect(&doc, needle, 0), vec![0], "k={k}");
    }
}

#[test]
fn needle_spanning_many_one_byte_pieces() {
    let needle = b"NEEDLE";
    let mut doc = Document::new();
    doc.insert(0, b"xx");
    for (i, &b) in needle.iter().enumerate() {
        doc.insert(2 + i as u64, &[b]);
    }
    let end = doc.len();
    doc.insert(end, b"yy");
    assert_eq!(collect(&doc, needle, 0), vec![2]);
}

#[test]
fn needle_across_original_original_boundary_from_delete() {
    let dir = util::scratch_dir("search-oo");
    let path = util::write_file(&dir, "oo.txt", b"NEExxxDLE and NEExxxDLE again");
    let mut doc = Document::open(&path).unwrap();
    doc.delete(3..6);
    doc.delete(14..17); // second occurrence, shifted left by the first delete
    assert_eq!(collect(&doc, b"NEEDLE", 0), vec![0, 11]);
}

#[test]
fn overlapping_matches_across_boundary() {
    let dir = util::scratch_dir("search-ov");
    let path = util::write_file(&dir, "ov.txt", b"aa");
    let mut doc = Document::open(&path).unwrap();
    doc.insert(2, b"aa"); // document: "aaaa" as original|add
    assert_eq!(collect(&doc, b"aa", 0), vec![0, 1, 2]);
    // Identical answers for the same bytes in a single contiguous piece.
    let contiguous = util::write_file(&dir, "ov2.txt", b"aaaa");
    let doc2 = Document::open(&contiguous).unwrap();
    assert_eq!(collect(&doc2, b"aa", 0), vec![0, 1, 2]);
}

#[test]
fn from_offset_and_early_stop() {
    let dir = util::scratch_dir("search-from");
    let path = util::write_file(&dir, "from.txt", b"aa");
    let mut doc = Document::open(&path).unwrap();
    doc.insert(2, b"aa"); // "aaaa"
    assert_eq!(collect(&doc, b"aa", 1), vec![1, 2]);
    assert_eq!(collect(&doc, b"aa", 2), vec![2]);
    assert_eq!(collect(&doc, b"aa", 3), Vec::<u64>::new());
    assert_eq!(collect(&doc, b"aa", 99), Vec::<u64>::new());

    let mut first = Vec::new();
    doc.search(b"aa", 0, &mut |offset| {
        first.push(offset);
        false
    });
    assert_eq!(first, vec![0]);
}

#[test]
fn empty_needle_matches_nothing() {
    let mut doc = Document::new();
    doc.insert(0, b"anything");
    assert_eq!(collect(&doc, b"", 0), Vec::<u64>::new());
}
