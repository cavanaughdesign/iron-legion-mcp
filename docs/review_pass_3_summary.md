# Review pass 3: Security boundaries

Builds on pass 2's exact-commit validation and reconciliation behavior.

- Strict Zod validation covers plans, commands, project configuration, actions, and worker results. SQL writes use bound parameters.
- Commands come exclusively from trusted local configuration; no user-supplied shell command strings are executed. Processes have time/output bounds, minimal inherited environment, and process-tree cancellation.
- The browser server binds only to 127.0.0.1. It checks Host and Origin, requires a single-use handoff followed by an HttpOnly SameSite session, serves only exact application routes, and denies unauthenticated APIs.
- Factory mutations and human decisions are App-visible tools. Validator evidence is only readable through the interactive App or authenticated browser API; model-readable artifact access refuses it.
- Holdouts must resolve outside the project tree. Builders receive no holdout content or validator reasoning. Public feedback is scrubbed for known scenario lines and IDs.
- The legacy file scaffolder now checks canonical ancestors and uses exclusive creation when overwrite is disabled.
- Dependency audit reported zero vulnerabilities after updating the legacy test/build toolchain and local embedding package.

Boundary: trusted-process workers have the signed-in operating-system user's access. Their filesystem is not a security sandbox. The optional networkless Docker executor requires a prepared image and separate runtime acceptance; it was not exercised against a Docker daemon on this machine.

Next pass: verify query bounds, scheduling budgets, responsiveness, and resource cleanup.
