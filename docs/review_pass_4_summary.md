# Review pass 4: Performance and resource bounds

Builds on pass 3's process and access boundaries.

- Queue and release-event indexes support polling and scheduling. UI history is bounded to 100 releases, 200 jobs/events and 100 artifact entries; artifact bodies load on demand.
- Exact-commit merge checks query all relevant evaluations independently of the UI history cap, avoiding old-evidence eviction bugs.
- Worker concurrency is checked under an immediate SQLite transaction. Active issue and manager jobs have unique indexes. Lease heartbeats run independently from worker execution.
- Commands have finite time/output limits; stdout is parsed separately from stderr so diagnostics cannot corrupt structured results. UTF-8 decoding is streamed correctly.
- Release execution budgets pause new dispatch. Manager cadence and bounded periodic UI polling avoid continuous agent sessions.
- Shutdown stops dispatch, aborts owned workers, and waits for pending work before database closure. Worktrees remain intentionally inspectable; cleanup is explicit.
- Browser checks covered 1440px desktop and 390px mobile layouts, all six views, and dark/light WCAG A/AA scans.

Next pass: audit configuration documentation, packaged assets, clean installation, and external acceptance boundaries.
