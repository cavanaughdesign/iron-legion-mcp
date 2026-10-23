# Factory role guidance

[ai-software-factory](ai-software-factory/SKILL.md) contains the workflow rules, role charters, scenario templates, and reference implementation used by Iron Legion.

The running factory uses the native TypeScript engine in `servers/factory/`. It supplies each worker with its selected role charter; the orchestrator owns queue state, commits, PR publication, and merges. The bundled Python implementation is a reference, not a second runtime or a general-purpose skill registry.
