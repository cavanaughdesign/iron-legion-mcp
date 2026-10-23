# Production readiness

## Local release boundary

Iron Legion's trusted-process local factory and MCP App are implemented and have local behavioral, transport, browser and live-Codex evidence. The installable package is a private local release. No public publication or deployment has been performed.

The software implementation is complete for that local release. New-user documentation is in [setup.md](setup.md) and [userguide.md](userguide.md), and both are included in the distribution. The final archive's clean-install results and SHA-256 identity are recorded in `release/package-verification.json` and `release/SHA256SUMS.txt`.

## Resolved critical findings

| Area                     | Resolution                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Missing execution engine | Persistent native state machine, atomic scheduling, independent executor processes and Git worktrees.            |
| Retry/review rules       | Mechanical counters, parked human decisions and explicit resolution.                                             |
| Stale workers/evidence   | Lease fencing, revision checks and exact-commit validation/review.                                               |
| Unknown remote outcomes  | Durable external-operation receipts and human reconciliation.                                                    |
| Unsafe local dashboard   | Loopback binding, Host/Origin checks, single-use bootstrap and authenticated APIs.                               |
| Private evidence         | Separate role inputs and App-only validation artifact retrieval. Trusted-process filesystem limits are explicit. |
| Legacy build failures    | Registry syntax, SDK types, ESM fixture, bounded test subprocesses and vector-store compatibility repaired.      |
| Dependency advisories    | Current compatible toolchain and embedding runtime; zero findings in the release audit.                          |

## Target-environment acceptance

Configure and accept the real GitHub repository, representative project checks, staging deployment, and installed MCP host before enabling unattended remote publication/merging. Optional Docker execution needs its own prepared image/runtime acceptance. See docs/verification.md; local tests are not substituted for those external outcomes.

The user will perform target-environment testing at their convenience. No additional factory features are required for the completed local release. GitHub/staging/installed-host acceptance remains explicitly unverified until that testing is performed.
