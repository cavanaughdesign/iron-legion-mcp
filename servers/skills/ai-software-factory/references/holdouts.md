# Holdout scenarios

Contents
- What they are and why they exist
- Isolation rules
- Writing good scenarios
- Wording failure notes without leaking
- Commands
- Scenario template
- Failure modes

## What they are and why they exist
Holdout scenarios are **how we'll test it, written up front. The builder never sees them.** They are
"used to test, never to build." This is the same idea as a held-out test set in machine learning:
if the builder can see the exam, it optimizes for the exam instead of the goal, and a green test
suite stops meaning "the software works".

Acceptance criteria in issues are the builder's spec. Holdouts are the independent check on whether
the spec was satisfied in spirit, including the user journeys and edge cases the spec author did not
list.

## Isolation rules
1. **Location:** outside the repository (default `~/.factory-holdouts/<repo>`, mode 700).
   `factory.py holdouts init` refuses a path inside the repo. Never commit them, never push them to the
   repo's GitHub, never attach them to issues or PRs.
2. **Roles:** Planner (writes), Validator (reads and runs), Manager (leak-scan only). Builder and Reviewer never.
3. **Builders' working directory** must not contain the holdouts dir or any symlink to it.
4. **Failure notes** from validation are read by builders; they must not reveal scenario text (see below).
5. **Leak scan:** `factory.py holdouts leak-scan` greps the repo for scenario IDs and distinctive titles and
   exits 3 on a hit. The Manager runs it every cycle. A hit means that scenario is burned: rewrite it.
6. Do not paste holdout contents into chat sessions that also drive Builders.

## Writing good scenarios
- Write them **during planning, before the split**. Writing them later, after seeing the code, defeats the purpose.
- One user journey per scenario, from a persona's starting state to an observable outcome.
- **Observable** pass/fail: what appears on screen, in an API response, in a file, in a database row. Not "code is clean".
- Cover: the happy path; at least one realistic failure (invalid input, expired session, double-submit, empty state);
  and, for brownfield, one **unchanged-behavior** check on an adjacent existing feature.
- Prefer behaviors over implementation: "invoice shows as Paid within 5 seconds of payment" not "calls updateStatus()".
- Keep each scenario independent so a failure points at one thing.
- Aim for 3 to 8 per small release. More than that and they become a second spec.
- IDs are `HS-001`, `HS-002`, ... and the file's first line must be `# HS-nnn: short title`.

## Wording failure notes without leaking
The note passed to `validate --result fail --note` is read by the next builder. Describe the
**symptom and reproduction a real user would report**, not the test.

| Leaks (don't) | Safe (do) |
|---|---|
| "HS-003 failed: expired card scenario" | "Paying with an expired card shows a blank page instead of an error message" |
| "Holdout expects status=PAID after webhook" | "After a successful payment the invoice still shows Unpaid after 10s" |
| "Edge case 2 in the holdout: empty cart" | "Opening checkout with an empty cart throws a 500" |

If the only way to describe the failure reveals the scenario, describe it more generally and let the
builder find the specific cause.

## Commands
```
factory.py holdouts init [--path DIR]    # create the external directory (refuses paths inside the repo)
factory.py holdouts new --id HS-001 --title "Customer pays invoice with expired card"
factory.py holdouts list                 # IDs and titles only
factory.py holdouts check                # outside repo, headers valid, perms, at least one scenario
factory.py holdouts leak-scan            # exit 3 if scenario IDs/titles appear in the repo
factory.py holdouts path                 # validator/manager only
```
`new` never overwrites an existing scenario.

## Scenario template
See `assets/holdout-scenario.template.md`. Core shape:
```
# HS-001: Customer pays invoice with an expired card
## Persona and starting state
## Steps (as a user would do them)
## Expected observable outcome
## Pass / fail criteria
## Edge conditions to probe
```

## Failure modes
- **Holdouts leak into issues** (the Planner pasted them): burned. Rewrite and re-run the affected issues.
- **Holdouts too close to acceptance criteria**: they add no information. Make them broader journeys.
- **Holdouts never updated**: after each staging cycle, fold new real-world failures into new holdouts.
- **Validator reads builder's reasoning**: contaminates the check. Give it only the issue, the PR build, and the holdouts.
