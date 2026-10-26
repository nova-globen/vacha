//! End-to-end benchmark for tond-core on a multi-GiB file. No external
//! bench dependencies; timings via `std::time::Instant`.
//!
//! Generate a synthetic log (size in GiB) in the system temp dir:
//!     cargo run --release --example bench -- gen 1
//! Run the suite against it:
//!     cargo run --release --example bench -- run <path>

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;
use std::process::ExitCode;
use std::time::Instant;

use tond_core::Document;

/// One marker line containing the search needle every 10 MiB of output, so a
/// 1 GiB file carries ~102 hits.
const MARKER_EVERY: u64 = 10 << 20;
const NEEDLE: &[u8] = b"TOND__NEEDLE__";

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [cmd, gib] if cmd == "gen" => match gib.parse::<u64>() {
            Ok(gib) if gib > 0 => gen(gib),
            _ => usage(),
        },
        [cmd, path] if cmd == "run" => run(Path::new(path)),
        _ => usage(),
    }
}

fn usage() -> ExitCode {
    eprintln!("usage: bench gen <GiB> | bench run <path>");
    ExitCode::FAILURE
}

fn gen(gib: u64) -> ExitCode {
    let target = gib << 30;
    let path = std::env::temp_dir().join(format!("tond-bench-{gib}gib.log"));
    let started = Instant::now();
    let mut out =
        BufWriter::with_capacity(8 << 20, File::create(&path).expect("create bench file"));
    let mut rng = Lcg(0x2026_0813);
    let mut written = 0u64;
    let mut next_marker = MARKER_EVERY;
    let mut i = 0u64;
    let mut markers = 0u64;
    while written < target {
        let line = if written >= next_marker {
            next_marker += MARKER_EVERY;
            markers += 1;
            format!(
                "2026-08-13T04:00:00.000000Z warn marker {} #{markers} at byte {written}\n",
                String::from_utf8_lossy(NEEDLE)
            )
        } else {
            format!(
                "2026-08-13T04:{:02}:{:02}.{:06}Z info worker-{:02} req={:016x} \
                 route=/api/v1/items/{} status={} latency_us={} bytes={}\n",
                i / 60 % 60,
                i % 60,
                rng.next() % 1_000_000,
                i % 64,
                rng.next(),
                rng.next() % 100_000,
                200 + (rng.next() % 4) * 100,
                rng.next() % 50_000,
                rng.next() % 262_144,
            )
        };
        out.write_all(line.as_bytes()).expect("write bench line");
        written += line.len() as u64;
        i += 1;
    }
    out.flush().expect("flush bench file");
    println!(
        "generated {} ({} bytes, {} lines, {markers} needle markers) in {:.1} s",
        path.display(),
        written,
        i,
        started.elapsed().as_secs_f64()
    );
    ExitCode::SUCCESS
}

fn run(path: &Path) -> ExitCode {
    let Ok(meta) = fs::metadata(path) else {
        eprintln!("cannot stat {}", path.display());
        return ExitCode::FAILURE;
    };
    let size = meta.len();
    let mb = size as f64 / (1 << 20) as f64;

    // A fresh sidecar directory so the first open is genuinely cold.
    let index_dir = std::env::temp_dir().join(format!("tond-bench-index-{}", std::process::id()));
    std::env::set_var("TOND_INDEX_DIR", &index_dir);

    // 1. Cold open: mmap only, no scan wait.
    let t = Instant::now();
    let doc = Document::open(path).expect("open");
    let open_cold = t.elapsed();

    // 2. Full line index (background scan runs from open; wait for it).
    let t = Instant::now();
    doc.wait_for_index();
    let index = t.elapsed();
    let lines = doc.line_count();
    drop(doc);

    // 3. Warm open: the sidecar completes the index synchronously.
    let t = Instant::now();
    let mut doc = Document::open(path).expect("reopen");
    let open_warm = t.elapsed();
    assert_eq!(
        doc.index_progress(),
        1.0,
        "warm open should load the sidecar"
    );

    // 4. 1000 random 16-byte inserts.
    let mut rng = Lcg(0x70bd_c0de_2026_0813);
    let text = b"[TOND-INSERT-16]";
    assert_eq!(text.len(), 16);
    let t = Instant::now();
    for _ in 0..1000 {
        let offset = rng.next() % doc.len();
        doc.insert(offset, text);
    }
    let inserts = t.elapsed();

    // 5. Streamed search over the edited document.
    let t = Instant::now();
    let mut hits = 0u64;
    doc.search(NEEDLE, 0, &mut |_| {
        hits += 1;
        true
    });
    let search = t.elapsed();

    // 6. Streamed save of the edited document.
    let save_path = std::env::temp_dir().join("tond-bench-save.out");
    let t = Instant::now();
    doc.save_as(&save_path).expect("save_as");
    let save = t.elapsed();
    let saved_size = fs::metadata(&save_path).map(|m| m.len()).unwrap_or(0);

    println!("tond-core bench — {} ({:.0} MiB)", path.display(), mb);
    println!("{:<34} {:>12}", "metric", "result");
    println!("{:-<34} {:->12}", "", "");
    row(
        "open (cold, mmap only)",
        &format!("{:.2} ms", ms(open_cold)),
    );
    row(
        "full line index",
        &format!(
            "{:.2} s  {:.0} MB/s  {lines} lines",
            index.as_secs_f64(),
            mb / index.as_secs_f64()
        ),
    );
    row("open (warm sidecar)", &format!("{:.2} ms", ms(open_warm)));
    row(
        "1000 random 16 B inserts",
        &format!(
            "{:.2} ms  {:.1} us/op",
            ms(inserts),
            inserts.as_micros() as f64 / 1000.0
        ),
    );
    row(
        &format!("search ({hits} hits)"),
        &format!(
            "{:.2} s  {:.0} MB/s",
            search.as_secs_f64(),
            mb / search.as_secs_f64()
        ),
    );
    row(
        &format!("save_as ({} bytes)", saved_size),
        &format!(
            "{:.2} s  {:.0} MB/s",
            save.as_secs_f64(),
            saved_size as f64 / (1 << 20) as f64 / save.as_secs_f64()
        ),
    );

    let _ = fs::remove_file(&save_path);
    let _ = fs::remove_dir_all(&index_dir);
    ExitCode::SUCCESS
}

fn row(name: &str, value: &str) {
    println!("{name:<34} {value}");
}

fn ms(d: std::time::Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
