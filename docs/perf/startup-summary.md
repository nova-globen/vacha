# Tond startup measurement

Session `85bf0aec6953`, 2026-10-23 18:22 +02:00. Produced by `scripts/measure-startup.ps1`; raw runs in `startup.jsonl`.

| Metric | Median | Min | Max | Runs |
| --- | ---: | ---: | ---: | ---: |
| Cold start, process start → editor interactive (wall) | 699 ms | 668 ms | 843 ms | 5 |
| Cold start, process start → `code/didStartWorkbench` (wall) | 580 ms | 535 ms | 694 ms | 5 |
| Cold start, `code/didStartWorkbench` on the renderer clock | 353 ms | 301 ms | 426 ms | 5 |
| Warm open, `tond_open.exe <file>` → tab active and painted (wall) | 138 ms | 120 ms | 160 ms | 5 |
| Warm open, `tond_open.exe` start → exit | 42 ms | 40 ms | 63 ms | 5 |

- **Machine:** Gigabyte Technology Co., Ltd. B850 EAGLE WIFI6E; AMD Ryzen 9 9950X3D 16-Core Processor (16 cores / 32 threads, 31.1 GB); Microsoft Windows 11 Pro 26H2, build 26300.9711, x64; power: no battery, scheme Ultimate Performance.
- **Build:** Tond 1.0.0, commit `93528968d44b480339c023c2bc13ef05b731b9f4`, x64, built 2026-10-23T18:15:41.8299586+02:00.
- **Method:** CDP inspector attached (`--remote-debugging-port`) on every run; scratch `--user-data-dir`; 1 warm-up cold run(s) not counted; OS file cache warm (no reboot between runs). Cold runs where the editor was already painted when CDP attached (end time is then an upper bound): 0.
- **Label:** fresh release build (vscode-win32-x64-min + tond_open), desktop otherwise idle
