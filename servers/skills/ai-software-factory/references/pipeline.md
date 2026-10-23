# Pipeline contract: every stage, its inputs, outputs, and exit criteria

Contents
1. Phase 1: Plan the next release
2. Phase 2: The factory builds it (Split, Issues, Pick, Ship Simple / Ship, App validation, Code review, Merge, Pull requests, Manager)
3. Phase 3: Test it, feed it back
4. State machine
5. Greenfield vs brownfield

GitHub Issues are the factory's **input**. Pull Requests are its **output**. Nothing else
crosses the factory boundary except (a) the human's answers to agent questions and
(b) holdout scenarios, which only the validator and manager may read.

---

## 1. Phase 1: Plan the next release

**Actors:** the human ("Me") + a planning agent. This is the only phase where the human
does heavy lifting; after it, the human's job is answering questions and testing staging.

**Output A: the release.** One of:
- **greenfield**: a proof of concept. Goal is to prove the idea works end to end, not polish.
- **brownfield**: a small epic added to an existing codebase. Keep it small enough that the
  Manager can reason about the whole thing (rule of thumb: 3 to 12 issues).

**Output B: holdout scenarios.** How the release will be tested, written up front, **before**
any building. The builder never sees them (see `holdouts.md`). Writing them first forces the
plan to be concrete and prevents the builder from tuning its work to the tests.

**Planning method (do this with the human, not for them):**
1. Ask what outcome a user should be able to achieve when the release is done. One sentence.
2. Ask what is explicitly out of scope. Cutting scope is the planner's main job.
3. Draft the holdout scenarios as user journeys with observable pass/fail criteria. Review with
   the human. Save them with `factory.py holdouts new`.
4. Only then draft `release-plan.json` (see `assets/release-plan.template.json`).
5. Run `factory.py validate-plan`. Show the human the parallel waves; ask if the order matches intent.

**Exit criteria:** valid plan JSON, human approved the scope, `holdouts check` passes.

## 2. Phase 2: The factory builds it

### Split
Breaks the release into **linked issues** and identifies **what can run in parallel**.
- Each issue is independently shippable and has acceptance criteria a builder can verify.
- Dependencies are explicit (`depends_on`). Everything with no unmet dependency is a parallel wave.
- Each issue is tagged `simple` or `complex` (this drives routing; see Pick).
- Command: `factory.py split plan.json` creates the GitHub issues, labels, and local state.
  Re-running is safe: existing issues are skipped, never overwritten.

Issue sizing: if an issue needs more than about one focused PR of review attention, split it.
If two issues always change the same files, merge them or add a dependency; otherwise parallel
laps will conflict.

### Issues (GitHub: the input)
The queue. The label on each issue is its state (`factory:ready`, `factory:claimed`, ...).
Issue text is visible to every builder, so **never put holdout content in an issue**.

### Pick
A **lap** is one pass through Pick, Ship, Validate, Review, Merge. Laps run **in parallel**.
Each lap picks **exactly ONE** issue and claims it (`factory.py pick --agent lap-N`).
Priority: sent-back and regression issues first, then lowest wave, then lowest number.
Claiming is atomic (file lock), so two laps never get the same issue.

**HARD RULE: 3 tries, then ask me.** The tool increments the try counter at claim time. A third
failed try escalates to the human automatically (exit code 3).

The pick output includes `route`: `ship-simple` or `ship`.

### Ship Simple / Ship
- **Ship Simple** (`simple`): small changes, fixes to PRs. Lightweight path: branch, change,
  run the repo's fast checks, open the PR.
- **Ship** (`complex`): bigger work, the **full pipeline**: design note in the PR description,
  tests first or alongside, full local test suite, lint/typecheck, open the PR.

Both end the same way: PR opened against the default branch with `Closes #N`, then
`factory.py submit N --pr <PR number>`.

Fixes for a sent-back issue go to the **same branch and PR** where possible, with the reviewer's
feedback (`feedback_from_previous_lap` in the pick output) addressed point by point.

### App validation
Tests the change **like a user** (drives the running app, not just unit tests) and **runs the
holdouts**. Gets the PR build, never the builder's reasoning.
- Pass: `factory.py validate N --result pass`
- Fail: `factory.py validate N --result fail --note "<what broke>"`. A failed validation counts as a
  failed try. The note describes the observable failure; it must **not** quote holdout scenario
  text (the builder will read it on the next try). See `holdouts.md` for how to word failures.

### Code review
A separate reviewer agent determines whether the PR is **merge ready**: correctness, tests that
actually assert behavior, security, consistency with codebase conventions, scope creep.
- `factory.py review N --verdict merge-ready`
- `factory.py review N --verdict send-back --note "<specific, actionable>"`

**HARD RULE: 2 send-backs max.** The third rejection escalates to the human. A send-back
re-queues the issue with priority; it is "fixed on a later lap".

### Merge
The reviewer merges, **only when CI is green**.
**HARD RULE: CI green.** `factory.py merge N` (default `--ci auto`) asks GitHub for the PR's checks and
refuses unless every check passed or was skipped, and at least one check exists. Merging unblocks
dependent issues automatically.

### Pull requests (GitHub: the output)
Merged PRs are the deliverable. Merged code goes to **staging**.

### Manager agent
Runs **every few hours**. Steps back and **fixes what one lap can't see**: patterns across issues
that no single lap can observe. Start from `factory.py manager-report`. See `roles.md`.

### Questions channel ("its questions, my answers")
Any agent may ask the human something instead of guessing: `factory.py ask N --question "..."`.
The issue parks as `needs_human`, the try is refunded, and the human answers with
`factory.py resolve N --action retry --note "<answer>"`. Batch questions; do not ping the human
for things the agent can decide. **Everything that is not a hard rule is the agents' call.**

## 3. Phase 3: Test it, feed it back
1. Merged code is deployed to staging.
2. The human (or a staging-test agent) exercises it.
3. **Something is off: it becomes new issues, back through the factory.**
   `factory.py feedback --title ... --body ... --acceptance ... --severity bug|regression|polish`
4. Feedback issues are ordinary issues: same Pick, same hard rules. Regressions get priority.

The loop is complete when staging has no open feedback and the human is satisfied; then plan the
next release.

## 4. State machine

```
backlog --(deps merged)--> ready --pick--> claimed --submit--> in_validation --pass--> in_review
   ^                         ^  ^             |                    |                      |
   |                         |  +--fail(<3)---+--------fail(<3)----+     send-back(<=2)    |
   |                         +-----------------------------------------------------------+
   |                                                                          merge-ready   v
   |                                                                                    approved --CI green--> merged
 any state --3rd failed try / 3rd send-back / ask--> needs_human --resolve--> ready | dropped
```

## 5. Greenfield vs brownfield

| | Greenfield (PoC) | Brownfield (small epic) |
|---|---|---|
| Goal | Prove the idea end to end | Add one coherent capability safely |
| First issues | Repo scaffold, CI, walking skeleton | Characterization tests around touched code |
| Risk | Over-building | Breaking existing behavior |
| Holdouts focus | Core user journey works | Core journey works AND existing flows unchanged |
| Manager focus | Architecture drift, dead code | Regressions, convention violations |

For greenfield, issue #1 should always be "CI + test harness + walking skeleton": the merge rule
(CI green) is meaningless without CI. For brownfield, confirm CI exists and is green on the
default branch before splitting.
