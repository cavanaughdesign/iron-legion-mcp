---
name: ai-software-factory
description: Run, set up, and operate an autonomous AI software factory where the human plans a release and agents build it from GitHub Issues to merged Pull Requests, with staging feedback looping back in as new issues. Use this skill whenever the user mentions their "software factory", "AI factory", agent pipeline, or autonomous build loop; wants to plan a greenfield proof of concept or brownfield small epic for agents to build; asks to split a release into linked issues or parallel work; wants laps, pick/claim of a single issue, Ship vs Ship Simple routing, app validation, holdout scenarios, code-review send-backs, a manager agent, CI-green merge gates, or "3 tries then ask me" escalation; or wants to turn staging bugs into new issues that re-enter the pipeline. Trigger even if they only describe the pieces (issues as input, PRs as output, agents building in parallel, hidden tests the builder never sees) without naming the factory.
---

# AI Software Factory

A way of building software where **the human plans the release, the factory builds it, and the human's feedback goes back in as issues.**

```
1 PLAN (human + planning agent)         2 THE FACTORY BUILDS IT                          3 TEST IT, FEED IT BACK
 next release ─┐                        Split → Issues(GitHub: INPUT) → Pick(ONE issue)   merged code → staging
 (greenfield PoC│                              ↑                          │ simple │ complex   → human tests it
  or brownfield │                              │              Ship Simple─┴─ Ship (full pipeline)   │
  small epic)   ├──► holdout scenarios         │                          ↓                  something's off?
 holdouts ──────┘    (builder NEVER sees)      │     App validation (like a user + holdouts)       ▼
                                               │              ↓                              new issues ──► back
                                               │     Code review ──► Merge ──► Pull requests (OUTPUT)    through
                                               │        │ send-back (≤2)          (CI must be green)     the factory
                                               └────────┘ fixed on a later lap
   Manager agent: every few hours, steps back and fixes what one lap can't see
   Agents ask questions, human answers ("its questions, my answers")
```

## The three hard rules (everything else is the agents' call)

| Rule | Where | Enforced by |
|---|---|---|
| **3 tries, then ask me** | Pick | `fail` / `validate fail` escalate on the 3rd failed try |
| **2 send-backs max** | Code review | `review send-back` escalates on the 3rd rejection |
| **CI green** | Merge | `merge` refuses unless every check passed (and at least one exists) |

These are enforced in code by `scripts/factory.py`, not left to memory. Do not add more hard rules and do not relax these three;
the design intent is that agents use judgment everywhere else. When a rule fires, the tool exits **3**: stop, read the JSON, and
bring the human in. If a rule keeps firing, fix the cause (see Manager), not the rule.

## First decision: which job is the user asking for?

| User wants | Do this | Read |
|---|---|---|
| Set the factory up in a repo | Setup flow below | `references/setup-and-ops.md` |
| Plan a release / write holdouts | Planning flow | `references/pipeline.md` (Phase 1), `references/holdouts.md` |
| Split a plan into issues | `validate-plan`, then `split` | `references/pipeline.md` |
| Build the next issue (a lap) | Builder flow | `references/roles.md` (Builder) |
| Validate / review / merge a PR | Validator or Reviewer flow | `references/roles.md` |
| Check on the factory, step back | Manager flow | `references/roles.md` (Manager) |
| Staging bugs → new issues | Feedback flow | `references/pipeline.md` (Phase 3) |
| Understand or explain the process | Summarize from this file | `references/pipeline.md` |

If the request is ambiguous, check `factory.py status`: if a factory already exists, infer the stage from it; otherwise start at setup/planning.
Ask at most one clarifying question, and only when it changes what you would do.

## The tool

`scripts/factory.py` (Python 3.9+, stdlib only) holds the loop's state in `.factory/state.json` (file-locked, so parallel laps are safe),
mirrors every transition to GitHub through `gh` (labels, comments, issue creation, merge), and runs offline when `gh` is unavailable.
Run it as `python3 <skill-dir>/scripts/factory.py <command>`. Add `-h` to any command. All commands print JSON (except `status`).

**Exit codes:** `0` ok · `2` bad usage or invalid input · `3` hard rule fired, question asked, or action blocked (stop and read) · `10` nothing to pick.

Verify the tool works in the current environment before relying on it: `python3 <skill-dir>/scripts/test_factory.py` (24 tests, about 10 seconds).

## Setup flow
1. Confirm a git repo and CI that reports checks on PRs. No CI means the merge rule can never pass; for greenfield make "CI + test harness + walking skeleton" issue #1.
2. `factory.py init` (add `--repo owner/name` or `--offline` if `gh` is missing or unauthenticated). It never overwrites an existing `.factory/`.
3. `factory.py holdouts init` creates the holdouts directory **outside** the repo.
4. Copy `assets/AGENTS.factory.md` into the repo as `AGENTS.md` (append if one exists; never overwrite) and fill in its Conventions section. Copy `assets/pull_request_template.md` to `.github/` if absent.
5. Recommend branch protection: require PRs and passing status checks. The tool is the second lock, not the only one.

## Planning flow (Phase 1: with the human, not for them)
1. Establish release type (**greenfield** = proof of concept, **brownfield** = small epic) and the one-sentence outcome. Cut scope aggressively.
2. Write **holdout scenarios first**: `factory.py holdouts new --id HS-001 --title "..."`, then fill in the file it creates (path from `holdouts path`).
   Use `assets/holdout-scenario.template.md` as the shape. Review them with the human.
3. Draft `release-plan.json` from `assets/release-plan.template.json`: every issue independently shippable, with verifiable acceptance criteria, explicit `depends_on`, and an honest `simple` or `complex` tag.
4. `factory.py validate-plan release-plan.json` and show the human the **parallel waves**. Fix warnings (oversized releases, holdout mentions in issue text).
5. On approval: `factory.py holdouts check && factory.py split release-plan.json`. `split` is idempotent and never overwrites existing issues.

Never put holdout content in issue text. Issue bodies are read by every builder.

## Builder flow (one lap)
1. `factory.py pick --agent lap-N`. Exit 10: nothing ready, stop. The payload gives `number`, `route`, `branch`, `acceptance`, `attempt`, `tries_left`, and `feedback_from_previous_lap`.
2. **Route `ship-simple`**: minimal change, fast checks. **Route `ship`**: short design note, tests, full suite, lint and typecheck.
3. Work only on that one issue. Do not read holdouts. Do not weaken tests. If a decision is needed: `factory.py ask <n> --question "..."` (this parks the issue and refunds the try).
4. Open a PR with `Closes #<n>`; then `factory.py submit <n> --pr <PR>`.
5. If you cannot make it work: `factory.py fail <n> --note "<what you tried, what happened>"`. You have 3 tries, so change approach each time.
If `feedback_from_previous_lap` is set (a send-back or failed validation), address every point and say how in the PR description.

## Validator flow
Get the PR build, never the builder's reasoning. Exercise the acceptance criteria **like a user**, then run the holdouts (`holdouts list`, then read them from `holdouts path`).
`validate <n> --result pass` or `--result fail --note "<symptom + reproduction>"`. The note is read by the next builder, so describe user-visible symptoms; never quote holdout text or IDs (`references/holdouts.md` has a do/don't table).

## Reviewer flow
Decide **merge-ready** or **send-back**. Batch all feedback into one specific, actionable send-back, since only 2 are allowed. No out-of-scope requests (file them via `feedback`).
`review <n> --verdict merge-ready` then `merge <n>` (default `--ci auto` asks GitHub). If merge exits 3, CI is not green: wait or send back; never bypass.
Use `--ci green` only after personally verifying CI when `gh` is unavailable, and say that you did.

## Manager flow (every few hours)
1. `factory.py manager-report`, `factory.py holdouts leak-scan`, `factory.py sweep`; read the most recent merged PRs.
2. Look for **patterns a single lap cannot see**: the same failure across issues, repeated send-backs for the same reason, blocked chains behind escalations, stuck laps, drift, leaked holdouts.
3. Fix the smallest systemic cause **through the factory** (new issue via `feedback`, or a convention update in `AGENTS.md` via a normal PR). Never commit around the pipeline and never relax a hard rule.
4. Report to the human: what you saw, what you changed, what needs a decision.

## Feedback flow (Phase 3)
Merged code goes to staging. For each problem the human finds: `factory.py feedback --title ... --body ... --acceptance "..." [--acceptance "..."] --severity bug|regression|polish [--complexity complex]`.
One problem per issue; observable acceptance criteria; regressions jump the queue. After a cycle, fold real failures into new holdouts.

## Handling escalations (exit 3)
Read the JSON (`rule`, `reason`, `escalation_file`) and the dossier it points to. Summarize for the human in plain language: what was tried, why it stopped, and the options.
Then act on their decision: clarified → `resolve <n> --action retry --note "<their answer>"` (resets counters, boosts priority, passes the note to the next builder); abandon → `resolve <n> --action drop --note "..."` (add `--unblock-dependents` only if dependents can proceed without it).
Do not silently retry an escalated issue.

## Operating in a chat vs an agentic environment
- **Claude Code / agentic runners:** spawn each role in a fresh context; use one git worktree per parallel lap; schedule the Manager. See `references/roles.md` (Running roles in Claude Code).
- **Plain chat (claude.ai):** you cannot run an unattended loop. Work one stage at a time, state which role you are playing, and keep roles separate: do not build, validate, and review the same change in one breath, and do not read holdouts while acting as the Builder.
  Where you cannot run `gh` or the script, produce the artifacts (plan JSON, holdout scenarios, issue text, role prompts, exact commands) for the user to run.

## Design principles (why it works this way)
- **One issue per lap** keeps context small and lets laps run in parallel without stepping on each other.
- **Holdouts** keep tests honest: builders optimize for what they can see, so the final check must be hidden.
- **Separate roles, fresh contexts** prevent self-grading and inherited blind spots.
- **Hard rules are few and mechanical** so the human can trust the factory unattended; judgment is left to the agents everywhere else.
- **The Manager** exists because laps are local; only a view across laps reveals shared root causes.
- **Feedback re-enters as issues** so there is exactly one path for work: no side doors, no hotfixes around the pipeline.

## Anti-patterns
- Putting holdouts in the repo, in issue text, or in the builder's context.
- Letting the Builder also validate or review its own PR.
- Bypassing a red CI, editing CI to pass, or weakening tests to get green.
- Retrying an escalated issue without a human decision or new information.
- Oversized releases (more than about 12 issues): the Manager cannot reason about them.
- Splitting issues that edit the same files into parallel waves; add a dependency instead.
- Editing GitHub labels by hand to move work; use the commands so state and GitHub stay in sync.

## Bundled files
- `scripts/factory.py`: state machine, rule enforcement, GitHub mirroring, holdout isolation, manager report.
- `scripts/test_factory.py`: 24 end-to-end tests (hard rules, concurrency, holdout leaks, escalation).
- `references/pipeline.md`: every stage's contract, state machine, greenfield vs brownfield.
- `references/roles.md`: role charters, boundaries, prompt templates, Claude Code tips.
- `references/holdouts.md`: isolation rules, writing scenarios, leak-free failure notes.
- `references/setup-and-ops.md`: prerequisites, parallel laps, scheduling, command reference, troubleshooting.
- `assets/`: `release-plan.template.json`, `holdout-scenario.template.md`, `AGENTS.factory.md`, `pull_request_template.md`.
