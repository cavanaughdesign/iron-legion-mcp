# Review pass 5: Maintainability and release operations

Builds on pass 4's bounded, observable runtime.

- Formatted new TypeScript, React, CSS, scripts and configuration. Separated workflow contracts/store/service/executor/GitHub/HTTP/App registration from the original pack registry.
- Replaced obsolete MVP onboarding with source-derived installation, configuration, worker protocol, nine-tool configuration, transport/resource behavior, authentication, state recovery, backup, troubleshooting and verification guidance. Preserved the historical README separately.
- Clean builds remove only the checked, generated dist directory and copy required role assets and sample fixtures. Runtime databases live outside the installation directory.
- Private package contents explicitly include compiled server/App assets, role skill files, configuration example and the Codex adapter. Tests, credentials, runtime data and QA fixtures are excluded from the distribution.
- Added portable verification scripts, UI fixture isolation, browser/embedded acceptance workflows and a CI workflow. Live coding-provider checks remain an explicit opt-in rather than a hidden CI cost.
- Documented the difference between successful local live-Codex execution, deterministic integration fixtures, a local AppBridge harness, and unperformed GitHub/deployment/installed-host acceptance.

See production_readiness_roadmap.md for the final release boundary and docs/verification.md for reproducible evidence.
