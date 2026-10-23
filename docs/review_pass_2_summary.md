# Review pass 2: Logic and correctness

Builds on pass 1's single-authority architecture.

- Verified dependency waves, cycle detection, transactional rollback, idempotency keys, and concurrent database connections.
- Verified three-attempt escalation, third-review-rejection escalation, pause/cancel behavior, stale revision rejection, lease fencing, and exact-commit evaluations.
- Added a durable external-operation ledger: completed issue creation replays its result; unknown outcomes require reconciliation; PR publication is keyed by candidate commit.
- CI rejection leaves the candidate gated. A changed remote candidate invalidates approval and parks the issue.
- A successful live Codex Builder/Validator/Reviewer workflow produced candidate `5d14bfdc5b1c1d98cea910c0f041fcc3e9d26b97` and nine evidence artifacts in isolated Git worktrees.

Resolved legacy regressions: ESM sample tests, SQLite vector integer binding, and explicit vector `k` query constraints.

Next pass: review local HTTP authorization, filesystem containment, private evaluation artifacts, and subprocess isolation boundaries.
