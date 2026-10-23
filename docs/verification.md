# Verification and release acceptance

This evidence concerns this checkout on Windows with Node 24.22.0. It does not attest a deployed GitHub repository or another machine's installed host. All checks are repeatable through the repository scripts.

## Executed evidence

- TypeScript server/test and browser checks.
- Behavioral tests for existing packs and state/semantic recall, plus planning, dependency cycles, atomic claims, revision fencing, retries, send-backs, cancellation, leases, budgets, external-operation receipts, private artifact access, HTTP authentication, process timeouts and cancellation.
- Clean production HTML/server build.
- Compiled stdio MCP handshake, discovery of nine tools and one resource, exact App metadata/MIME type, bundled HTML, loopback HTTP, unauthorized API rejection, and legacy Tester execution.
- Real Git-worktree workflow with separate subprocess Builder, Validator and Reviewer, meaningful project checks, a committed candidate, and persisted evidence. Default workers are deterministic fixtures, identified as such.
- **Live Codex workflow:** installed Codex CLI, existing ChatGPT sign-in, ephemeral independent roles and OS sandbox modes. Builder wrote the requested file, committed through the orchestrator, Validator and Reviewer examined the same SHA. Candidate: `5d14bfdc5b1c1d98cea910c0f041fcc3e9d26b97`; three completed jobs and nine artifacts. Temporary test repositories were removed after verification. This test validates the local adapter/runtime, not arbitrary project success or provider service guarantees.
- Real browser interaction across all six views, planning and execution, reload persistence, required-form Cancel behavior, evidence inspection, dark/light themes, 390px mobile containment, and automated WCAG 2 A/AA scans. The matching charcoal/steel/off-white/vermilion theme was checked across every view, evidence/release/feedback/cancel dialogs, and mobile layouts in both themes. Status labels use shapes and border treatments in addition to tone; search focus remains visible.
- Embedded rendering and requests through the official `AppBridge`, fullscreen accepted, fullscreen unavailable, a host returning inline, open-link success, and rejected open-link with a visible browser fallback. An initially light host theme and the first manual theme toggle are verified. This is a local test host, not acceptance in an installed third-party host.
- Dependency audit: zero vulnerabilities after toolchain updates.
- Private distribution acceptance: fresh production-only installation of the release archive, compiled stdio discovery, App resource loading, factory opening, legacy Tester execution, and installed `setup.md`/`userguide.md`. Exact archive identity and outcomes are recorded in `release/package-verification.json` and `release/SHA256SUMS.txt`.

Screenshots are generated under `artifacts/`. Playwright produces `playwright-report/`. `npm run verify` repeats all default checks; `npm run smoke:live` deliberately opts into using the installed coding CLI and its allowance.

## External acceptance still required

| Boundary           | What remains                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target project     | Configure its real root, checks, executors, private scenarios, and representative release acceptance.                                                                                                                                                       |
| GitHub             | This machine has no authenticated `gh` command for a target repo. Verify issue/PR publication, branch protection, CI reports and confirmed merge against your real repository. Fixture tests cover refusals, exact-head matching and confirmation behavior. |
| Staging            | Configure the repository's CI/CD and an optional preview URL. Iron Legion supplies feedback and validation context; it does not claim that a deployment occurred.                                                                                           |
| Installed MCP host | Connect the packaged server and accept rendering, App-only tool visibility and filesystem/process permissions in the actual host.                                                                                                                           |
| Container mode     | No prepared project-specific networkless worker image has been accepted. Docker is now reachable, but this optional backend remains unverified; trusted-process mode is the tested local release mode.                                                       |

Do not treat an offline fixture merge as evidence of a real merge. No GitHub issues, PRs, merges, deployments, or public package publication were performed during local verification.
