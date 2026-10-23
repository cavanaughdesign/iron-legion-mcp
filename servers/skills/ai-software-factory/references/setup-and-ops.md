# Setup and operations

Contents
- Prerequisites
- One-time setup in a repo
- Running a release end to end (command cheat sheet)
- Running parallel laps
- Scheduling the Manager
- CI and branch protection
- Command reference and exit codes
- Troubleshooting
- Recovering and auditing

## Prerequisites
- A GitHub repo with Actions (or other CI) that reports checks on PRs. **Without CI the merge rule cannot be satisfied**:
  for greenfield, issue #1 is the CI/test harness.
- `gh` CLI authenticated (`gh auth status`). Without it the tool runs in `--offline` mode: state and rules work, but nothing
  syncs to GitHub and `merge --ci auto` is refused (you must assert `--ci green` after checking yourself).
- Python 3.9+ (standard library only). Unix-like OS (uses `fcntl` file locking).

## One-time setup in a repo
```
python3 <skill>/scripts/factory.py init                 # detects repo via gh; creates .factory/, syncs labels, gitignores .factory/
python3 <skill>/scripts/factory.py holdouts init        # external holdouts dir (outside the repo)
```
Then copy `assets/AGENTS.factory.md` into the repo as `AGENTS.md` (or append to the existing one; never overwrite
an existing file). It gives every Builder the repo-level rules. Copy the PR template from `assets/pull_request_template.md`
to `.github/pull_request_template.md` if the repo has none.

Tip: set `alias factory="python3 <skill>/scripts/factory.py"`.

## Running a release end to end
```
# Phase 1: plan (with the human)
factory holdouts new --id HS-001 --title "..."          # write holdouts FIRST
factory validate-plan release-plan.json                 # see parallel waves
# Phase 2: build
factory split release-plan.json                         # issues + labels + state
factory pick --agent lap-1                              # one issue per lap; exit 10 = idle
factory submit 1012 --pr 57                             # builder done
factory validate 1012 --result pass                     # validator (after running holdouts)
factory review 1012 --verdict merge-ready               # reviewer
factory merge 1012                                      # refused unless CI is green
factory status                                          # board
# Phase 3: staging feedback
factory feedback --title "Total doubled on staging" --body "..." --acceptance "Total applied once" --severity regression
```
(Issue numbers shown are examples. Offline mode numbers start at 1000; online mode uses real GitHub numbers.)

## Running parallel laps
Each lap = pick, build, submit, validate, review, merge for one issue. Run N laps at once:
- Give each its own git worktree; `factory.py` resolves the shared `.factory/` through the git common dir.
- All state mutations are serialised by a file lock, so simultaneous `pick` calls never claim the same issue (covered by tests).
- Keep N at or below the width of the current wave (`validate-plan` shows it). More laps than ready issues just idle on exit 10.
- Waves widen as dependencies merge; the loop picks up newly ready issues automatically.

## Scheduling the Manager
Every few hours: `factory manager-report` (saved under `.factory/reports/`, new file each run) plus
`factory holdouts leak-scan` and `factory sweep`. Example cron:
```
0 */3 * * *  cd /path/to/repo && python3 /path/to/skill/scripts/factory.py sweep >> .factory/cron.log 2>&1
```
The judgment part (reading patterns and acting) is an agent session using the Manager prompt in `roles.md`.

## CI and branch protection
- Protect the default branch: require PRs, require status checks, disallow force-push. This makes "CI green" true at the platform
  level too; `factory.py` is the second lock, not the only one.
- Require at least one meaningful check (tests). A PR with zero checks is treated as not green.
- If your repo genuinely has no CI for a given change type, verify manually and pass `--ci green` knowingly; do not make that the default.

## Command reference
| Command | Purpose | Notable exits |
|---|---|---|
| `init [--repo] [--offline]` | Create `.factory/`, sync labels | never overwrites |
| `validate-plan FILE` | Validate plan, show waves | 2 on errors |
| `split FILE [--dry-run]` | Create linked issues | idempotent |
| `pick --agent ID [--complexity]` | Claim ONE issue | 10 none ready |
| `submit N --pr P` | Builder done | 3 wrong state |
| `fail N --note` | Failed build attempt | 3 on 3rd failure |
| `validate N --result pass/fail [--note]` | App validation | 3 on 3rd failure |
| `review N --verdict merge-ready/send-back [--note]` | Code review | 3 on 3rd send-back |
| `merge N [--ci auto/green/red] [--no-gh-merge]` | Merge | 3 if CI not green |
| `ask N --question` | Ask the human | 3 (parked) |
| `feedback --title --body --acceptance ... [--severity] [--complexity]` | New issue from staging | |
| `resolve N --action retry/drop --note [--unblock-dependents]` | Human decision | |
| `sweep [--minutes]` | Fail stale claims | |
| `status [--json]` | Board | |
| `manager-report` | Evidence pack | |
| `holdouts init/new/list/check/leak-scan/path` | Holdout management | 3 on leak/problem |

**Exit codes:** 0 ok; 2 usage/validation; **3 hard rule / question / blocked: stop, read the JSON, do not retry blindly**; 10 nothing to pick.

## Troubleshooting
- **"not an initialised factory"**: run `init` at the repo root, or set `FACTORY_HOME`.
- **`merge` says "no CI checks reported"**: checks have not started yet (wait and retry) or CI is not configured for PRs.
- **GitHub and local state disagree** (someone edited labels by hand): local state is the source of truth for the loop.
  Fix by running the right command (`resolve`, `feedback`), not by editing labels.
- **Escalated issue**: read `.factory/escalations/<n>-*.md`, decide (clarify and `resolve --action retry`, or `drop`).
- **Stale claim from a crashed lap**: `sweep` converts it to a failed try.
- **Plan needs to change mid-release**: add issues via `feedback` (they join the current release) or finish/drop open
  issues then `split` a new plan. A release with open issues blocks splitting a different release.

## Recovering and auditing
- `.factory/events.jsonl` is an append-only audit log of every claim, status change, escalation, and feedback.
- `.factory/escalations/` holds a markdown dossier per escalation.
- `.factory/reports/` holds each manager report.
- `state.json` is plain JSON; back it up before manual edits (the tool never edits history).
