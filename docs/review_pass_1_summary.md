# Review pass 1: Architecture

Scope: existing agent packs, native factory service, SQLite persistence, process executor, MCP resource, and browser dashboard.

- Preserved the seven existing tools and added two factory tools (nine total).
- Ported factory behavior into TypeScript; Python reference files are packaged as role/specification assets, not executed.
- SQLite is authoritative. Immediate transactions, unique active-job constraints, leases, revision checks, and an external-operation ledger protect competing processes.
- The UI reads persisted state and controls dispatch. Independent worker commands own no workflow transitions.
- Factory state and job artifacts live outside the application installation directory.

Finding resolved: the original registry comment accidentally terminated its own block comment and prevented compilation. Corrected it. SDK handler and test types were repaired without changing existing tool names.

Next pass: exercise retry limits, dependency promotion, interruption, stale evidence, and durable external-operation recovery.
