# Benchmark cases

Human-created cases and profiles are frozen before a benchmark run. `manifest.json` has this shape:

```json
{"bench_id":"bench-v0","created_at":"2026-10-20T00:00:00Z","cases":[{"path":"case-example.json","sha256":"…","profile_sha256":"…"}]}
```

Hashes are SHA-256 over the exact file bytes. Human steps H1–H5 in `docs/BENCHMARK_PROTOCOL.md` remain mandatory.
