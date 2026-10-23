# User guide

Iron Legion turns a release plan into small issues, runs independent Builder, Validator, and Reviewer assignments, and brings questions back to you. You define the outcome, inspect the evidence, resolve decisions, and test the result in staging.

Complete the [setup guide](setup.md) first. This guide uses the labels in the current dashboard.

## Your first release

Start with one small, independent issue so you can see the whole workflow before adding dependencies.

1. Open the dashboard or call `factory__open` in your MCP Apps-capable host.
2. Click **New release** and select your configured project.
3. Choose **Small epic · existing project** for an existing application, or **Proof of concept · new project** for greenfield work. Both require an initialized Git repository.
4. Enter a release name and a one-sentence user outcome.
5. Give the first issue a unique key, title, route, and observable acceptance criteria. Enter one criterion per line. Leave dependencies blank for this first issue.
6. Click **Create release**. The release is saved as a draft; workers have not started.
7. If you use private scenarios, finish writing them outside the repository before continuing.
8. Click **Start factory** and follow the issue on **Factory board**.
9. Inspect assignment outcomes in **Workers** and their artifacts in **Validation & review**.
10. When the issue reaches **Merge ready**, review the candidate. With GitHub configured, open its issue card and select **Verify CI & merge**. Without GitHub, keep the candidate for local inspection; this is the expected stopping point.

For example, a small documentation issue could be:

| Field                | Example                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Release name         | Clearer installation instructions                                                              |
| One-sentence outcome | A new contributor can install the project from its README                                      |
| Key                  | `install-docs`                                                                                 |
| Title                | Document the supported installation steps                                                      |
| Route                | Ship Simple                                                                                    |
| Acceptance criteria  | README states the supported runtime version; README lists the actual install and test commands |
| Depends on           | Leave blank                                                                                    |

Your configured checks still run for this issue. Choose criteria that fit your target repository.

## Find your way around

Select the release you want to inspect using the release dropdown. The six views show information for that release.

| View                    | What you use it for                                                               |
| ----------------------- | --------------------------------------------------------------------------------- |
| **Factory board**       | Follow issues through the pipeline, search them, and open issue details           |
| **Release plan**        | Review the goal, acceptance criteria, and dependencies; synchronize GitHub issues |
| **Workers**             | Inspect active and completed assignments and their recorded outcomes              |
| **Validation & review** | Read reports, test output, traces, and screenshots when provided                  |
| **Decision inbox**      | Answer questions and resolve escalated work                                       |
| **Activity**            | Inspect saved events and request a manager report                                 |

The top bar provides refresh, color theme, and fullscreen controls. Data refreshes automatically while the App is visible. In an embedded host, fullscreen first uses host support, then falls back to a browser link. If the host cannot open it, use the visible fallback link.

## Write a useful release plan

Keep each release focused on one user outcome. A plan accepts 1–50 issues. Use stable keys such as `billing-api` or `billing-screen`: keys begin with a lowercase letter and contain lowercase letters, digits, and hyphens.

Write acceptance criteria as observable results. For example, “Submitting an empty email shows an inline error and does not create an account” gives the Builder and evaluators a concrete outcome to verify.

Choose **Ship Simple** for a small, contained change and **Ship · full pipeline** for larger work. The route is included in the worker context. Both routes still require configured checks, validation, and review.

Add dependency keys separated by commas. If `billing-screen` depends on `billing-api`, the screen waits until the API issue is confirmed merged. Independent issues can run concurrently within the configured job limit. Duplicate keys, missing dependencies, self-dependencies, and cycles are rejected.

The current release form creates a plan; it does not provide an editor for an existing plan. Review the draft before starting. If a draft needs substantial correction, cancel it and create a corrected release.

Private scenarios belong in the configured external scenario directory, written before execution. Do not paste their contents or identifiers into public issue text. Public acceptance criteria should describe the desired behavior without revealing the private evaluation cases.

## Understand the pipeline

| Issue label     | Meaning and next step                                                       |
| --------------- | --------------------------------------------------------------------------- |
| **Blocked**     | Waiting for dependencies to be confirmed merged                             |
| **Ready**       | Eligible for a Builder assignment when capacity is available                |
| **Building**    | Builder is working on the issue in its factory worktree                     |
| **Validating**  | Validator is evaluating the candidate commit independently                  |
| **Reviewing**   | Reviewer is examining that same candidate                                   |
| **Merge ready** | The candidate passed independent evaluation; GitHub merge gates still apply |
| **Merged**      | The remote merge was confirmed; dependent work can become ready             |
| **Needs you**   | Work is parked for your decision or reconciliation                          |
| **Dropped**     | You chose to stop pursuing the issue; its dependents remain blocked         |
| **Cancelled**   | The release's work was cancelled                                            |

The orchestrator runs configured checks before committing Builder output. Validator and Reviewer each receive a fresh worktree at the exact candidate commit. A changed commit or tracked evaluator modifications invalidate that evaluation.

The original working checkout is separate from the factory worktrees. Inspect the candidate branch and commit shown in issue details rather than expecting your normal checkout to switch branches automatically.

Release labels describe the overall lifecycle: **draft**, **running**, **paused**, **completed**, or **cancelled**. A release completes when all its issues are merged or dropped. Inspect dropped issues as well as the merged count when assessing the delivered scope.

## Inspect evidence

Open an issue card to see its acceptance criteria, dependencies, build attempts, send-backs, candidate commit, and branch. Use **Workers** to understand which role ran and its outcome. Open an artifact in **Validation & review** to read the actual evidence.

Artifacts can include reports, test output, traces, and PNG screenshots. Their availability depends on the executor and task; an empty screenshot list does not prove a visual check occurred. A passing unit test also does not establish staging or installed-host acceptance.

Validator artifacts are available through the human-facing App path and are kept out of the Builder's supplied context. Handle private evaluation material carefully when sharing reports.

## Pause, resume, or cancel

| Control                         | Effect                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| **Pause dispatch**              | Stops assigning new work; current assignments can finish                           |
| **Resume**                      | Resumes a paused release after configuration and budget checks                     |
| **Cancel** → **Cancel release** | Aborts active workers and cancels remaining work; the action requires confirmation |

Cancellation preserves candidate branches, worktrees, audit history, and any remote objects already created. It does not delete published issues or PRs or undo a merge. Review those separately when closing abandoned work.

Closing the browser leaves the engine running. Stopping the standalone terminal or disconnecting an MCP-owned process shuts down that process and its workers. Reopen the App to inspect saved state after restart.

## Resolve the decision inbox

Work reaches **Needs you** when a worker asks a question, repeated attempts fail, a lease expires, or an external operation needs reconciliation. Three failed build attempts trigger escalation. Two review send-backs are allowed; a third triggers escalation.

1. Open **Decision inbox** and read the issue's feedback.
2. Inspect related worker results, artifacts, and Activity events.
3. Enter a concrete explanation in **Your decision**.
4. Select **Retry with my answer** to provide guidance and reset the retry counters, or **Drop issue** to stop pursuing it.

If the release is paused, use **Resume** when you are ready to dispatch again. Dropping an issue does not satisfy its dependencies. If the remaining plan no longer makes sense, cancel it and create a revised release.

For an expired worker lease, first confirm the old worker is no longer writing. For an uncertain GitHub operation, inspect the actual remote issue, PR, or merge before retrying. The factory parks uncertain operations so you can reconcile their outcome instead of blindly issuing another write. If the issue changed while you were deciding, refresh and review its current state before submitting again.

## Publish and merge with GitHub

GitHub features require the project's configured repository, matching `origin` fetch/push URLs, fetched base branch, Git push access, and authenticated `gh` CLI. Setup is described in the [setup guide](setup.md#optional-github-and-staging).

Use **Sync GitHub issues** in **Release plan** to publish/synchronize planned issues. The factory handles candidate branch/PR publication in the workflow. Inspect the corresponding PR and checks in GitHub before completing your first real integration.

By default, `autoMerge` is false. Open a **Merge ready** issue and select **Verify CI & merge**. The factory checks the exact reviewed head, expected base, non-draft state, clean mergeability, and reported CI checks. At least one successful check must exist, and missing, pending, skipped, or failing checks block merging. A changed remote head requires fresh evaluation. GitHub branch protection remains authoritative.

If an administrator enables `autoMerge`, eligible candidates can merge automatically through those gates. Completion is confirmed before dependent issues are promoted. Without GitHub, the merge control is disabled and candidates remain **Merge ready**; there is no local “pretend merged” action.

## Test the result and send feedback

Use your project's staging/preview environment to exercise the user outcome after deployment. Iron Legion can supply a configured preview URL to workers, but your repository's CI/CD performs the deployment.

For a release that has started and is not cancelled, select **Feedback** and enter:

- **What went wrong?** A concise issue title.
- **Reproduction and context:** Steps, relevant environment, and what happened.
- **Expected behavior:** Observable acceptance criteria, one per line.
- **Severity:** Bug, Regression, or Polish. Regressions receive queue priority.

Select **Create feedback issue**. Feedback enters the same build/validation/review workflow. Adding feedback to a completed release reopens it **paused**; select **Resume** when ready.

## Manager reports and execution limits

Select **Manager report** in **Activity** for a progress assessment. The engine also produces periodic reports according to `managerIntervalMinutes`. If an optional Manager executor is configured, it adds independent analysis as evidence; it does not directly edit code or merge work.

`concurrency` limits active jobs across the engine. `maxJobsPerRelease` limits dispatch for a release; reaching the limit pauses new assignments for review. Inspect repeated failures and scope before increasing it, then restart after configuration changes and resume. These are execution limits, not a token meter or provider billing cap.

## Recovery and backups

State defaults to `~/.iron-legion`, or the directory selected by `IRON_LEGION_HOME`:

| Item                                             | Contents                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `config.json`                                    | Default configuration location; `IRON_LEGION_CONFIG` can override it |
| `factory.db` and its SQLite companion files      | Releases, issues, jobs, artifacts, events, and operation receipts    |
| `legacy-state.db` and its SQLite companion files | State used by the original tools                                     |
| `jobs/`                                          | Worker prompts and result files                                      |
| `worktrees/`                                     | Candidate and evaluator worktrees retained for inspection            |

For a simple backup, stop **all** Iron Legion instances, copy the state directory and any externally located configuration, and retain your target repositories and private scenarios. Alternatively, use SQLite's backup mechanism for a live database. Copying only a live `.db` while omitting its WAL can lose data.

Restore with the service stopped, using an empty state directory and the matching application version. Worktrees are linked to their original Git repositories and paths; preserve those locations or reconcile the worktrees before resuming. Do not treat the state backup as a replacement for your repository backups.

There is no automatic destructive worktree cleanup. After stopping the service and confirming work is no longer active, maintainers can remove inspected, completed worktrees using `git worktree remove <path>`. Preserve database history and any evidence you need.

## When something gets stuck

| Symptom                                | What to check                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No assignment starts                   | Release is running, required dependencies are merged, executors/checks are configured, capacity is available, and the job budget is not exhausted |
| An issue stays Blocked                 | Its dependency must be confirmed merged; a dropped dependency remains blocking                                                                    |
| Checks fail only in workers            | Fresh worktrees need their own dependencies; inspect recorded check output and command paths                                                      |
| Merge ready never advances             | GitHub may be absent, manual merge may be required, or CI/base/head/mergeability gates may be blocking                                            |
| The App shows an action error          | Read the banner, refresh stale state, and inspect Activity or terminal output                                                                     |
| Browser authentication expires         | Obtain a fresh one-time link; the old bootstrap URL cannot be reused                                                                              |
| A worker or GitHub result is uncertain | Inspect the actual process or remote state before resolving the parked issue                                                                      |

For installation issues, return to [setup.md](setup.md). For custom executors, container limitations, or maintenance details, see [README.md](README.md). For exactly what was tested and what still needs acceptance in your environment, see [verification evidence](docs/verification.md).
