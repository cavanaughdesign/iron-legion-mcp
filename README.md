# Iron Legion Factory

![Iron Legion — AI Software Factory: coordinated steel robotic arms building a shared component.](assets/social/iron-legion-banner.png)

Iron Legion turns your release plan into a coordinated software delivery workflow. You define the outcome and acceptance criteria; independent Builder, Validator, and Reviewer agents implement each issue, test the candidate, and assess whether it is ready to merge. The factory manages dependencies, schedules parallel work, retries within defined limits, and brings questions back to you when a human decision is needed.

Run it locally and follow the work through an interactive MCP App or browser dashboard. Inspect candidate commits and evaluation evidence, pause execution, resolve blocked work, and turn staging feedback into the next issue. Plans, job history, decisions, and artifacts are saved locally. Connect GitHub to publish issues and pull requests, with merges gated on independent evaluation and successful CI for the reviewed commit.

The name is inspired by the [Iron Legion from the Marvel Cinematic Universe](https://marvelcinematicuniverse.fandom.com/wiki/Iron_Legion). Here, that idea becomes a team of specialized software agents working toward one release: you set the mission, the factory coordinates execution, and the evidence shows what is ready to ship.

The factory follows `servers/skills/ai-software-factory/SKILL.md`: three failed build attempts trigger escalation; a third review send-back triggers escalation; merging requires successful CI on the reviewed commit. The bundled Python script is a reference implementation; the running server uses the native TypeScript engine and works on Windows.

New to Iron Legion? Follow the [setup guide](setup.md) to install and connect a project, then use the [user guide](userguide.md) for your first release and everyday workflows.

## Install and launch

Requires Node.js **22.12+** (24 recommended), npm, and Git. Agent execution additionally requires configured worker commands. The supplied Codex adapter uses an installed Codex CLI and its existing sign-in. GitHub publication requires the `gh` CLI signed in to the selected repository plus a usable Git remote.

```powershell
npm ci
npm run build
npm run dashboard
```

Open the **one-time link printed to stderr within 60 seconds**. The server chooses a free loopback port; `npm run dashboard -- --port=4178` requests a fixed port and fails clearly if it is in use. Refreshing the browser retains its eight-hour local session. Expired links require a fresh `factory__open` call with `popout: true`, or a server restart to print another link.

The empty dashboard explains setup. It contains no seeded production projects or simulated live results.

For source development, `npm run dev` runs the server through tsx; run `npm run build` after changing the App so its bundled HTML exists. The browser server always serves the built artifact.

## Configure a project

Copy [config.example.json](config.example.json) to `~/.iron-legion/config.json`. On Windows that is normally `C:/Users/<you>/.iron-legion/config.json`. Set:

- `id`, `name`, `root`: a trusted local Git repository **root**, with an existing initial commit.
- `baseBranch`: the existing branch that new work starts from.
- `executors.builder`, `.validator`, `.reviewer`: independent executable/argument arrays. Replace the example adapter paths with the absolute path to this installation's `scripts/codex-worker.mjs`. Set `executable` to your full Node executable path when Node is not discoverable by the host.
- `checks`: at least one meaningful command, run before the orchestrator commits Builder output.
- Optional `github: "owner/repo"`: enables issue/PR publication. Ensure `origin` points to this repository and its base branch has been fetched. `gh auth login` and Git push authentication are prerequisites; Iron Legion does not store their credentials.
- Optional `autoMerge: true`: enables merges after independent evaluation and verified GitHub checks. It defaults to false.
- Optional `holdouts`: an existing directory outside the repository containing private `.md` user scenarios, written before building.
- Optional `previewUrl`: the existing preview/staging URL the Validator should exercise. Deployment itself belongs to the target repository's CI/CD.
- Optional `executors.manager`: a periodic independent agent analysis in addition to the built-in manager report. Recommendations return as evidence; the manager does not directly modify code.

Restart the server after configuration changes. A missing config opens onboarding. Invalid configuration fails startup rather than partially enabling projects. There is no `.env` loader: set supported environment variables in your shell, service configuration, or MCP host configuration.

| Environment variable             | Purpose                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `IRON_LEGION_HOME`               | State/job/worktree directory; defaults to `~/.iron-legion`                                                |
| `IRON_LEGION_CONFIG`             | Absolute config-file path; defaults to `$IRON_LEGION_HOME/config.json`                                    |
| `IRON_LEGION_CODEX_BINARY`       | Optional full path to native Codex executable; Windows adapter also detects the standard npm installation |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Test-only browser override                                                                                |

`concurrency` defaults to 2, with a maximum of 8. `managerIntervalMinutes` defaults to 180. `maxJobsPerRelease` defaults to 500; reaching it pauses dispatch for review. Each command has a configured timeout (default 900 seconds), and stdout/stderr are bounded. Token billing depends on the configured executor; Iron Legion does not invent usage figures or enforce provider billing limits.

On Windows, configure native `.exe` executables or use the Node adapter. Shell scripts such as `.cmd`/`.ps1` are not implicitly interpreted. For npm checks use `node` with the absolute npm CLI script and `run <script>`, or configure a specific trusted PowerShell executable and argument array.

## Use the App

1. Create a release with a goal and small issues. Give each a stable key, observable acceptance criteria, route, and dependency keys. The server rejects duplicate keys, missing dependencies, cycles, and obvious private-scenario references.
2. Write private scenarios first if your project uses holdouts. Start the factory after the plan is ready.
3. The engine claims ready issues atomically. Builder gets one issue per attempt and its previous actionable feedback. Simple/complex routing is included in the role context.
4. Builder changes run configured checks and are committed on a dedicated factory branch. Validator and Reviewer each receive a fresh detached worktree of that exact candidate. Tracked evaluator modifications or a changed commit invalidate the result.
5. Use **Workers** to inspect execution outcomes; **Validation & review** for reports, traces and base64 PNG screenshots; **Activity** for persisted events. Validator artifacts remain on the human-facing App path.
6. **Pause dispatch** lets current assignments finish. **Cancel** aborts active workers and fences late results, preserving branches and remote objects for inspection.
7. Questions and exhausted retries appear in **Decision inbox**. A reasoned answer can retry or drop the issue. Retry resets counters after that explicit human decision. Dropped dependencies remain blocking; they are not treated as successful merges.
8. A reviewed candidate reaches **Merge ready**. With GitHub configured, the merge action verifies the PR head, base, draft state, mergeability, and all reported checks; at least one successful check is required. Missing, skipped, pending or failing checks do not pass. The merge request matches the reviewed SHA, and completion is confirmed before dependencies are promoted.
9. **Feedback** creates a new issue in the release; regressions take priority. Feedback on a completed release reopens it paused so you can choose when to resume.

Without GitHub, local building/validation/review works and stops at Merge ready. Iron Legion does not label a local branch as merged or bypass CI. Repository branch protection should also enforce your normal checks and review policy.

## Worker contract and role skill

Every assignment is a fresh process in its assigned working directory. The configured executable receives a JSON task on stdin. Arguments may use `{promptFile}`, `{outputFile}`, `{worktree}`, `{role}`, and `{jobDir}`. Return JSON on stdout or write `{outputFile}`:

```json
{
  "verdict": "pass",
  "summary": "Observable outcome and supporting evidence.",
  "artifacts": [
    {
      "kind": "report",
      "name": "review.txt",
      "content": "Evidence from this independent evaluation."
    }
  ]
}
```

Other verdicts are `fail` and `ask`. Artifact kinds are `report`, `test`, `trace`, and `screenshot` (base64 PNG, at most 160,000 characters). At most ten worker-provided artifacts are accepted. The orchestrator records check output and candidate summaries separately.

Iron Legion reads the selected role's charter from the supplied factory skill. Reference `factory.py` commands describe transitions; workers must not execute them. The orchestrator owns queue state, commits, PR publication and merges. Builders never receive holdouts, evaluator artifacts, or another role's reasoning.

The Codex adapter uses a fresh ephemeral session, structured output, Builder workspace-write/evaluator read-only modes, and the Windows elevated sandbox configuration. It ignores unrelated user configuration while retaining the existing sign-in. A successful live three-role smoke has been run; see [verification](docs/verification.md). Codex execution behavior is documented in [official non-interactive mode guidance](https://learn.chatgpt.com/docs/non-interactive-mode).

## Isolation and local security

Default **trusted-process** mode is for code and commands you trust. Workers run as your OS user. Separate contexts and worktrees prevent accidental role contamination; they do **not** prevent a hostile process from reading other files accessible to that user. Keep private scenarios out of issues, repository files, builder chats and logs.

The optional `container` mode runs a prepared `containerImage` with no network, reduced Linux capabilities, memory/CPU/process limits, the assigned worktree and job directory, and a read-only holdout mount only for Validator. Provide commands available inside that image. A host Git worktree's `.git` pointer is not portable into a container; the orchestrator performs Git operations outside the container and supplies the candidate patch in the task. Container agents must inspect source files/that patch rather than assume a usable in-container Git repository. This backend has not been accepted against a live Docker daemon in this environment. The supplied cloud Codex adapter is for trusted-process mode; it is not an offline container image.

The dashboard binds only to `127.0.0.1`, validates Host/Origin, and authenticates API requests with a single-use bootstrap followed by an HttpOnly SameSite cookie. Bootstrap tokens are URL fragments, removed before the App loads data. Raw credentials are not written to configuration or state. Parent environment secrets are not forwarded to workers; installed CLI sign-ins remain under those CLIs' control. Do not expose this local dashboard through a public reverse proxy.

## MCP configuration

After building, configure a generic host:

```json
{
  "mcpServers": {
    "iron-legion": {
      "command": "node",
      "args": ["C:/Tools/iron-legion/dist/servers/orchestrator/index.js"],
      "env": { "IRON_LEGION_CONFIG": "C:/Users/you/.iron-legion/config.json" }
    }
  }
}
```

VS Code's `mcp.json` uses a `servers` root instead of `mcpServers`. Use forward slashes in Windows JSON paths. Restart/reconnect the host after configuration changes. Call `factory__open` to open `ui://iron-legion/factory.html` (`text/html;profile=mcp-app`). Rendering requires an **MCP Apps-capable host**. A tool-only host receives structured data but cannot render this interface. Fullscreen first requests host display mode, then falls back to a fresh authenticated browser link or a visible link you can open.

The tool budget remains **nine**: the seven original meta/Builder/Tester/Docs tools, plus `factory__open` and App-visible `factory__control`. Control actions include planning, lifecycle controls, feedback, human resolution, artifact inspection, GitHub synchronization and merge. Input uses strict discriminated schemas. Legacy Builder/Tester/Docs tools retain their sample-project scope; their historical MVP documentation is [archived here](docs/legacy-mvp.md).

The browser UI closing does not stop the service. In stdio mode the MCP host owns the process; disconnecting that process stops its workers. For an independently running local service, run `npm run dashboard` in a separate terminal or OS service using the same state directory. Competing instances coordinate through SQLite job claims. Shutdown stops dispatch, terminates owned workers, and waits for in-flight operations to settle before closing state.

## Persistence, recovery and maintenance

`factory.db` contains releases, issues, jobs, events, artifacts, request receipts and external-operation receipts. SQLite uses WAL, foreign keys and a busy timeout; schema initialization/migrations are transactional and repeatable. Legacy run/step/semantic memory now lives in `legacy-state.db` under the data directory. No automatic import of old installation-local legacy databases is performed; preserve those files if upgrading an existing installation.

Job prompt/result files live under `jobs/`; worktrees under `worktrees/`. Keep these directories private to the service account. The service intentionally retains candidate worktrees for inspection. Stop the service before archiving/removing completed work with `git worktree remove <path>`; keep the database/audit history. There is no automatic destructive cleanup.

Back up state with SQLite's backup mechanism, or stop every instance and copy the database files plus jobs/worktrees. Do not copy only a live `.db` file while discarding its WAL. Keep a versioned configuration copy with the backup. Restore to an empty data directory and restart the matching application version.

An expired worker lease parks the issue for human reconciliation because the old writer may still exist. The engine does not automatically retry an uncertain writer. Unknown GitHub outcomes similarly require inspecting GitHub before resolving the issue. Confirmed issue/PR operations use durable receipts to avoid duplicate dispatch after restart.

## Verification and packaging

```powershell
npx playwright install chromium
npm run verify
npm run smoke:live   # optional: uses your installed Codex sign-in and model allowance
npm pack            # creates a private installable distribution after rebuilding
```

`verify` runs both TypeScript checks, behavioral tests, a clean production build, compiled stdio/resource/HTTP smoke, a real Git-worktree subprocess workflow, browser/embedded/accessible-theme workflows, and the dependency audit. The default workflow uses clearly identified deterministic test workers. Live model smoke is separate and never runs automatically in CI. QA artifacts are under `artifacts/`; Playwright's report is under `playwright-report/`.

See [verification evidence and remaining external acceptance](docs/verification.md) and the five review summaries. These distinguish local/runtime evidence from a real target repository's GitHub branch protection, deployment pipeline and installed host behavior.

## Troubleshooting

- **Empty project list:** create the config at the selected path and restart; environment changes require restarting the MCP host process too.
- **Start disabled/rejected:** confirm the Git root, initial commit/base branch, all three executors, meaningful checks, and any private scenario directory.
- **Agent cannot write on Windows:** use the supplied adapter, which sets the native Windows sandbox configuration. Confirm the installed Codex CLI can execute a workspace-write task. Do not bypass sandboxing to hide the failure.
- **Cannot spawn npm/codex:** use a native executable or Node adapter and absolute paths. `.cmd`/`.ps1` wrappers are not interpreted implicitly.
- **GitHub publication parked:** install/sign in to `gh`, verify origin/push access, then inspect the existing issue/PR before resolving. Never blindly retry an uncertain external write.
- **Merge blocked:** verify checks exist and succeed on the reviewed head, the PR base is correct, and GitHub considers it cleanly mergeable. Changes to the remote head require fresh evaluation.
- **Browser 401/expired link:** open a fresh link via `factory__open` with `popout: true`; old bootstrap tokens cannot be reused.
- **No App in the host:** verify MCP Apps support and that resources/read returns the bundled HTML. Tool-only support is insufficient.
- **Semantic model download:** semantic recall lazily downloads the local MiniLM model on first use, then uses its cached weights. Core factory scheduling does not depend on this download.
