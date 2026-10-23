# AI Software Factory: rules for agents working in this repo

This repository is built by an issue-driven software factory. GitHub Issues are the input; Pull Requests are the output.
These rules apply to every agent (Builder, Validator, Reviewer, Manager). Everything not listed here is your call: use judgment.

## Hard rules (not negotiable)
1. **Pick:** a lap works on exactly ONE issue. An issue gets at most 3 tries; after that the human is asked (the tooling escalates automatically).
2. **Review:** at most 2 send-backs per issue; the third rejection goes to the human.
3. **Merge:** only when CI is green. Never merge around a red or missing check, never edit CI to make it pass.

## Builders
- Claim work with `factory.py pick --agent <id>`; do not freelance outside the claimed issue.
- Branch name comes from the pick output. PR body must contain `Closes #<issue>`.
- Ship Simple: minimal diff and fast checks. Ship: short design note, tests, full suite, lint, typecheck.
- Never weaken, skip, or delete tests to get green. If a test seems wrong, say so in the PR and ask.
- Never search for or read holdout scenarios or any directory outside this repo that holds tests you were not given.
- Ambiguity or a product decision needed? `factory.py ask <n> --question "..."` instead of guessing.
- Out-of-scope discoveries become new issues (`factory.py feedback`), not extra changes in your PR.
- When retrying after a failure or send-back, change approach and address every point of the feedback explicitly.

## Reviewers
- Decide merge-ready or send-back. Batch all feedback into a single, specific, actionable send-back.
- Do not request out-of-scope changes; file them as issues.

## Conventions
<!-- Project-specific conventions go here (language/tooling, test commands, layout, naming, error handling).
     The Manager updates this section when several PRs are sent back for the same reason. -->
- Test command:
- Lint/typecheck command:
- Dev/staging run command:
