# HS-000: Short title of the user journey

> Store this file OUTSIDE the repository (see `factory.py holdouts init`). Builders must never see it.

## Persona and starting state
Who is the user, and what exists before the journey begins (data, account state, feature flags)?

## Steps (as a user would do them)
1. Open ...
2. Click ...
3. Enter ...

## Expected observable outcome
What the user sees or what can be observed in the system (screen text, API response, database row, email).

## Pass / fail criteria
- PASS if: ...
- FAIL if: ...

## Edge conditions to probe
- Realistic failure (invalid input, expired session, double submit, network drop)
- Empty / very large state
- (Brownfield) an adjacent existing flow that must be unchanged
