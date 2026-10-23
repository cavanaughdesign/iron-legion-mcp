# Setup guide

This guide takes a new user from a source checkout to a working Iron Legion dashboard. After setup, follow the [user guide](userguide.md) to create your first release. The [README](README.md) contains the worker protocol and advanced configuration details.

## 1. Check the prerequisites

| Requirement                                   | Used for                                            |
| --------------------------------------------- | --------------------------------------------------- |
| Node.js 22.12 or newer; Node 24 recommended   | Running the server and supplied worker adapter      |
| npm                                           | Installing dependencies and building the App        |
| Git                                           | Creating branches, worktrees, and candidate commits |
| A coding-agent command for each role          | Builder, Validator, and Reviewer execution          |
| A local Git repository with an initial commit | The project the factory will work on                |
| GitHub CLI (`gh`), optional                   | Publishing issues/PRs and merging through GitHub    |
| An MCP Apps-capable host, optional            | Showing the dashboard inside a chat or IDE          |

Run these commands in a terminal to check your tools:

```powershell
node --version
npm --version
git --version
```

The supplied `scripts/codex-worker.mjs` adapter uses an installed Codex CLI and its existing sign-in. It does not require an API key in Iron Legion's configuration. Confirm your installed CLI works and is signed in before starting workers. You may also provide your own executors using the [worker contract](README.md#worker-contract-and-role-skill).

Default `trusted-process` workers run under your OS account. Use a repository and commands you trust. Independent roles and worktrees provide workflow separation; they do not prevent a hostile process from reading files accessible to that account.

## 2. Install and build Iron Legion

Extract or clone the project, open a terminal in its root directory (the directory containing `package.json`), and run:

```powershell
npm ci
npm run build
```

Keep the installation path handy. Examples below use `C:/Tools/iron-legion`; replace that with your actual installation directory. On macOS/Linux, use your absolute paths instead.

If you received the installable `.tgz` package, install it into a directory of your choice with `npm install /absolute/path/iron-legion-mcp-1.0.0.tgz`. It already contains the build. Its server, adapter, and example configuration are inside `node_modules/iron-legion-mcp`; use those installed paths when configuring and launching it. The source-development commands in this guide apply to a source checkout.

## 3. Prepare your target repository

Choose the project to build, separately from the Iron Legion installation. In that project's directory, check:

```powershell
git rev-parse --show-toplevel
git log -1 --oneline
git branch --list
git var GIT_AUTHOR_IDENT
```

Use the repository root printed by the first command as `root`. Choose an existing base branch such as `main`. A brand-new project must have an initial commit before the factory can create worktrees. Configure your Git author identity if the last command fails.

Choose at least one meaningful check for the project, such as its test command. Workers use fresh Git worktrees: untracked files and an existing `node_modules` directory in your normal checkout are not copied into them. Make sure your executor/check setup can prepare any required dependencies there.

For your first run, use a small, disposable project or a narrowly scoped change in a trusted repository.

## 4. Create your configuration

The default configuration file is `~/.iron-legion/config.json`. On Windows, create it from the example while in the Iron Legion source directory:

```powershell
New-Item -ItemType Directory -Force -Path "$HOME/.iron-legion" | Out-Null
if (-not (Test-Path -LiteralPath "$HOME/.iron-legion/config.json")) {
    Copy-Item -LiteralPath ./config.example.json -Destination "$HOME/.iron-legion/config.json"
}
```

If the destination already exists, edit it instead of overwriting it. On macOS/Linux, create `~/.iron-legion` and copy the same example there.

Open the file in your editor and replace the sample values:

| Field                    | What to enter                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `projects[0].id`         | A unique key such as `customer-portal`; lowercase letters, digits, and hyphens, starting with a letter |
| `projects[0].name`       | The project name shown in the dashboard                                                                |
| `projects[0].root`       | Absolute path to your target Git repository root                                                       |
| `projects[0].baseBranch` | An existing branch in that repository                                                                  |
| Each role's `executable` | `node`, or the absolute path to your Node executable                                                   |
| Each role's `args[0]`    | Absolute path to this installation's `scripts/codex-worker.mjs`                                        |
| `projects[0].checks`     | Commands that verify the target project                                                                |

The example's `node --test` check suits a project with Node's built-in test runner. Replace it when your project uses another test system. For an npm script on Windows, use Node to run the npm CLI directly, for example:

```json
{
  "executable": "C:/Program Files/nodejs/node.exe",
  "args": [
    "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
    "run",
    "test"
  ],
  "timeoutSeconds": 120
}
```

Verify those executable/script paths on your machine. Commands run in the assigned worktree. Command arguments are arrays; `.cmd` and `.ps1` wrappers are not automatically interpreted by a shell. Windows paths in JSON should use forward slashes or escaped backslashes.

Leave `autoMerge` set to `false` for manual merging. The defaults allow two concurrent jobs, a manager report every 180 minutes, and 500 jobs per release. Worker execution uses your configured agent's allowance; the job limit does not impose a provider spending cap.

Configuration is strict JSON. Save as UTF-8 without a byte-order mark, with no comments or trailing commas. Restart Iron Legion after changes.

### Optional private scenarios

Write your private acceptance scenarios before starting the release. Put `.md` files directly in an existing directory outside the target repository, then add its absolute path as the project's `holdouts` field. The directories must not contain each other.

Only Validator assignments receive that path through their task context. Keep the scenario contents out of issue text, repository files, and Builder conversations. Trusted-process mode does not enforce filesystem secrecy against hostile workers. Container mode requires separate preparation and has not been accepted against a live Docker daemon here; see [isolation details](README.md#isolation-and-local-security).

### Optional GitHub and staging

In the target repository, check your GitHub access and fetch the chosen base branch:

```powershell
gh auth status
git remote -v
git fetch origin main
```

Replace `main` with your base branch. If needed, authenticate with `gh auth login` and configure Git push authentication. Add `"github": "owner/repository"` to the project. Both `origin` fetch and push URLs must identify that repository using a standard GitHub HTTPS or SSH URL.

Configure CI and branch protection in the target repository. Merging requires successful checks on the exact reviewed commit; no reported checks, skipped checks, and pending checks do not pass. You can add an existing staging URL as `previewUrl`. Iron Legion does not create the deployment pipeline.

Without GitHub configuration, building, validation, and review work locally and stop at **Merge ready**. Dependent issues wait for confirmed merges, so start with an independent issue when trying local-only mode.

## 5. Launch the dashboard

From the Iron Legion source directory:

```powershell
npm run dashboard
```

Open the one-time URL printed in the terminal within **60 seconds**. The browser session lasts eight hours. The server binds to a free loopback port; to request a fixed port, use `npm run dashboard -- --port=4178`.

For an installed package, run `node /absolute/path/to/node_modules/iron-legion-mcp/dist/servers/orchestrator/index.js --dashboard` instead.

You should see the factory control center and your configured project available under **New release**. With no configured projects, the App shows onboarding. Invalid configuration causes startup to fail with an error.

Leave the terminal running while using the dashboard. Closing the browser does not stop the engine. Stop the standalone service with Ctrl+C. To get a new bootstrap link, restart the service or call `factory__open` with `popout: true` through a connected MCP host.

## 6. Connect an MCP host (optional)

Build first, then add this to a host that uses an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "iron-legion": {
      "command": "node",
      "args": ["C:/Tools/iron-legion/dist/servers/orchestrator/index.js"],
      "env": {
        "IRON_LEGION_CONFIG": "C:/Users/you/.iron-legion/config.json"
      }
    }
  }
}
```

Replace the paths. Use the full Node executable path if your host cannot find `node`. VS Code's `mcp.json` uses a `servers` root instead of `mcpServers`; follow your host's configuration format.

Restart or reconnect the host and ask it to call **`factory__open`**. The server supplies `ui://iron-legion/factory.html`. Inline rendering requires MCP Apps support; ordinary MCP tool support alone is insufficient. The App's fullscreen button can fall back to an authenticated browser link.

The MCP host owns its stdio server process. Disconnecting it stops that process and its workers. For a service that stays running independently, use the standalone dashboard command. Instances using the same state directory share persisted job claims.

## 7. Confirm your setup

Follow [Your first release](userguide.md#your-first-release) using one small issue. Confirm a Builder runs, a candidate commit is recorded, and independent Validator and Reviewer results appear. **Merge ready** is the expected local-only stopping point.

Developers can run the broader repository checks separately:

```powershell
npx playwright install chromium
npm run verify
```

`npm run smoke:live` separately exercises the installed Codex adapter and uses your sign-in/model allowance. The default test workflow uses deterministic test workers. Local test results do not prove your real GitHub, staging, Docker, or installed-host integration; see [verification boundaries](docs/verification.md).

## Paths and common setup problems

| Setting or symptom                  | Action                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Custom state location               | Set `IRON_LEGION_HOME`; default is `~/.iron-legion`                                                                 |
| Custom config location              | Set `IRON_LEGION_CONFIG` to an absolute file path; default is `<state directory>/config.json`                       |
| Native Codex binary not found       | Set `IRON_LEGION_CODEX_BINARY` to the native executable; on Windows, use `codex.exe`, not a `.cmd` wrapper          |
| Empty project list                  | Check the selected config path, save the project configuration, and restart                                         |
| Start rejected                      | Check the Git root/base branch, all three executors, at least one check, and any configured private `.md` scenarios |
| Browser reports 401 or expired link | Obtain a fresh link; bootstrap URLs are single-use                                                                  |
| App is missing in chat              | Confirm MCP Apps support, built HTML, and a host reconnect                                                          |
| Windows worker cannot write         | Use the supplied adapter and verify the installed Codex workspace-write sandbox works                               |

Set environment variables in the launch shell or MCP host configuration. Iron Legion does not load `.env` files. Keep the loopback dashboard local. See the [user guide](userguide.md#recovery-and-backups) for recovery and backup instructions.
