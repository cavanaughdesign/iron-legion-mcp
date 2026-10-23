#!/usr/bin/env python3
"""factory.py - state machine and hard-rule enforcement for the AI Software Factory.

GitHub Issues are the factory's INPUT and Pull Requests are its OUTPUT.
This tool keeps a local, lock-protected state file (.factory/state.json) that is the
source of truth for the loop, and mirrors every transition to GitHub through the `gh`
CLI (labels, comments, issue creation, merging) when online.

The three hard rules are enforced in code, not left to agent discretion:
  1. PICK     - an issue gets at most 3 build tries, then it escalates to the human.
  2. REVIEW   - an issue gets at most 2 send-backs, then it escalates to the human.
  3. MERGE    - nothing merges unless CI is green.

Exit codes (agents should branch on these):
  0  ok
  2  usage or validation error
  3  hard rule triggered / question asked / action blocked - stop and read output
  10 nothing available to pick (loop can idle or end)

Python 3.9+, standard library only. Requires the `gh` CLI only for online mode.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

MAX_TRIES = 3          # hard rule: PICK - 3 tries, then ask the human
MAX_SENDBACKS = 2      # hard rule: REVIEW - 2 send-backs max
STATE_VERSION = 1
GH_TIMEOUT_SECONDS = 60
EXIT_OK, EXIT_USAGE, EXIT_BLOCKED, EXIT_IDLE = 0, 2, 3, 10

STATUSES = ("backlog", "ready", "claimed", "in_validation", "in_review",
            "approved", "merged", "needs_human", "dropped")
LABEL_PREFIX = "factory:"
LABELS: Dict[str, Tuple[str, str]] = {
    "factory:backlog": ("c5def5", "Waiting on dependencies"),
    "factory:ready": ("0e8a16", "Ready to be picked up by a lap"),
    "factory:claimed": ("fbca04", "Claimed by a lap"),
    "factory:in-validation": ("1d76db", "Under app validation"),
    "factory:in-review": ("5319e7", "Under code review"),
    "factory:approved": ("0e8a16", "Reviewer says merge-ready"),
    "factory:needs-human": ("b60205", "Hard rule hit - human decision required"),
    "factory:feedback": ("d93f0b", "Created from staging feedback"),
    "complexity:simple": ("bfdadc", "Routed to Ship Simple"),
    "complexity:complex": ("006b75", "Routed to Ship (full pipeline)"),
}
STATUS_LABEL = {
    "backlog": "factory:backlog", "ready": "factory:ready", "claimed": "factory:claimed",
    "in_validation": "factory:in-validation", "in_review": "factory:in-review",
    "approved": "factory:approved", "needs_human": "factory:needs-human",
}
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
HOLDOUT_ID_RE = re.compile(r"^HS-\d{3,}$")


class FactoryError(Exception):
    def __init__(self, message: str, code: int = EXIT_USAGE, payload: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.payload = payload or {}


# --------------------------------------------------------------------------- utils
def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def parse_ts(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def minutes_since(value: Optional[str]) -> float:
    if not value:
        return 0.0
    return (dt.datetime.now(dt.timezone.utc) - parse_ts(value)).total_seconds() / 60.0


def slugify(text: str, limit: int = 40) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit] or "x"


def emit(obj: Any) -> None:
    print(json.dumps(obj, indent=2, sort_keys=False))


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise FactoryError(f"file not found: {path}") from None
    except json.JSONDecodeError as exc:
        raise FactoryError(f"invalid JSON in {path}: {exc}") from None
    if not isinstance(data, dict):
        raise FactoryError(f"{path} must contain a JSON object")
    return data


# ------------------------------------------------------------------ home / config
def git_toplevel(start: Path) -> Optional[Path]:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True,
                             text=True, cwd=str(start))
    except FileNotFoundError:
        return None
    return Path(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None


def find_home(start: Optional[Path] = None) -> Optional[Path]:
    """Locate .factory/. Order: $FACTORY_HOME, walk up from cwd, git common dir (worktrees)."""
    env = os.environ.get("FACTORY_HOME")
    if env:
        return Path(env).expanduser().resolve()
    cur = (start or Path.cwd()).resolve()
    for parent in [cur, *cur.parents]:
        if (parent / ".factory").is_dir():
            return parent / ".factory"
    try:
        out = subprocess.run(["git", "rev-parse", "--git-common-dir"], capture_output=True,
                             text=True, cwd=str(cur))
        if out.returncode == 0 and out.stdout.strip():
            common = Path(out.stdout.strip())
            common = common if common.is_absolute() else (cur / common)
            cand = common.resolve().parent / ".factory"
            if cand.is_dir():
                return cand
    except FileNotFoundError:
        pass
    return None


class Factory:
    """Loads config + state, serialises writers with a file lock."""

    def __init__(self, home: Path):
        self.home = home
        self.config_path = home / "config.json"
        self.state_path = home / "state.json"
        self.lock_path = home / "state.lock"
        self.events_path = home / "events.jsonl"
        if not self.config_path.exists() or not self.state_path.exists():
            raise FactoryError(f"{home} is not an initialised factory; run `factory.py init`")
        self.config = json.loads(self.config_path.read_text(encoding="utf-8"))

    @property
    def offline(self) -> bool:
        return bool(self.config.get("offline", True))

    @property
    def repo(self) -> Optional[str]:
        return self.config.get("repo")

    @contextlib.contextmanager
    def mutate(self) -> Iterator[dict]:
        self.home.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                state = json.loads(self.state_path.read_text(encoding="utf-8"))
                yield state
                tmp = self.state_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
                os.replace(tmp, self.state_path)
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def read(self) -> dict:
        with open(self.lock_path, "a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def log(self, event: str, **fields: Any) -> None:
        with open(self.events_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"ts": now(), "event": event, **fields}) + "\n")


def require_factory() -> Factory:
    home = find_home()
    if home is None:
        raise FactoryError("no .factory directory found; run `factory.py init` at the repo root")
    return Factory(home)


# ------------------------------------------------------------------- GitHub (gh)
def gh_available() -> bool:
    return shutil.which("gh") is not None


def run_gh(fx: Factory, args: List[str], stdin: Optional[str] = None,
           required: bool = False) -> Optional[str]:
    """Run gh. Best-effort mirror unless required=True. Returns stdout or None."""
    if fx.offline:
        return None
    if not gh_available():
        if required:
            raise FactoryError("gh CLI not found but factory is online; install gh or use --offline")
        warn("gh CLI not found; skipping GitHub mirror")
        return None
    cmd = ["gh", *args]
    try:
        # DEVNULL when there is no input: a gh call must never block waiting on an inherited stdin.
        proc = subprocess.run(cmd, input=stdin, stdin=None if stdin is not None else subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=GH_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        msg = f"gh {' '.join(args[:3])} timed out after {GH_TIMEOUT_SECONDS}s"
        if required:
            raise FactoryError(msg) from None
        warn(msg)
        return None
    if proc.returncode != 0:
        msg = f"gh {' '.join(args[:3])} failed: {proc.stderr.strip()[:300]}"
        if required:
            raise FactoryError(msg)
        warn(msg)
        return None
    return proc.stdout.strip()


def gh_comment(fx: Factory, number: int, text: str) -> None:
    run_gh(fx, ["issue", "comment", str(number), "--repo", fx.repo or "", "--body-file", "-"], stdin=text)


def gh_set_status(fx: Factory, issue: dict, old: Optional[str], new: str) -> None:
    add = STATUS_LABEL.get(new)
    rem = STATUS_LABEL.get(old) if old else None
    args = ["issue", "edit", str(issue["number"]), "--repo", fx.repo or ""]
    if add:
        args += ["--add-label", add]
    if rem and rem != add:
        args += ["--remove-label", rem]
    if add or rem:
        run_gh(fx, args)


def set_status(fx: Factory, issue: dict, new: str) -> None:
    if new not in STATUSES:
        raise FactoryError(f"internal: unknown status {new}")
    old = issue["status"]
    issue["status"] = new
    issue["updated_at"] = now()
    if old != new:
        gh_set_status(fx, issue, old, new)
    fx.log("status", number=issue["number"], old=old, new=new)


# --------------------------------------------------------------------- plan logic
def compute_waves(deps: Dict[str, List[str]]) -> Dict[str, int]:
    waves: Dict[str, int] = {}
    remaining = set(deps)
    level = 0
    while remaining:
        ready = sorted(k for k in remaining if all(d in waves for d in deps[k]))
        if not ready:
            raise FactoryError("dependency cycle among: " + ", ".join(sorted(remaining)))
        for k in ready:
            waves[k] = level
        remaining -= set(ready)
        level += 1
    return waves


def validate_plan(plan: dict) -> Tuple[List[str], List[str], Dict[str, int]]:
    errors: List[str] = []
    warnings: List[str] = []
    release = plan.get("release")
    if not isinstance(release, dict):
        return ["`release` object is required"], warnings, {}
    for field in ("name", "type", "goal"):
        if not isinstance(release.get(field), str) or not release[field].strip():
            errors.append(f"release.{field} is required")
    if release.get("type") not in ("greenfield", "brownfield"):
        errors.append("release.type must be 'greenfield' (proof of concept) or 'brownfield' (small epic)")
    issues = plan.get("issues")
    if not isinstance(issues, list) or not issues:
        return errors + ["`issues` must be a non-empty list"], warnings, {}
    keys: List[str] = []
    for idx, issue in enumerate(issues):
        label = f"issues[{idx}]"
        if not isinstance(issue, dict):
            errors.append(f"{label} must be an object")
            continue
        key = issue.get("key", "")
        label = f"issue '{key}'" if key else label
        if not isinstance(key, str) or not KEY_RE.match(key):
            errors.append(f"{label}: key must match {KEY_RE.pattern}")
        elif key in keys:
            errors.append(f"{label}: duplicate key")
        else:
            keys.append(key)
        if not str(issue.get("title", "")).strip():
            errors.append(f"{label}: title is required")
        if issue.get("complexity") not in ("simple", "complex"):
            errors.append(f"{label}: complexity must be 'simple' or 'complex'")
        acc = issue.get("acceptance")
        if not isinstance(acc, list) or not acc or not all(isinstance(a, str) and a.strip() for a in acc):
            errors.append(f"{label}: acceptance must be a non-empty list of strings")
        elif issue.get("complexity") == "simple" and len(acc) > 4:
            warnings.append(f"{label}: marked simple but has {len(acc)} acceptance criteria; consider complex or splitting")
        elif issue.get("complexity") == "complex" and len(acc) < 2:
            warnings.append(f"{label}: marked complex but has a single acceptance criterion; consider simple")
        blob = " ".join([str(issue.get("body", "")), *(acc if isinstance(acc, list) else [])]).lower()
        if "holdout" in blob:
            warnings.append(f"{label}: mentions 'holdout' - issue text is visible to builders; keep holdouts out of it")
    deps: Dict[str, List[str]] = {}
    for issue in issues:
        if not isinstance(issue, dict) or not isinstance(issue.get("key"), str):
            continue
        d = issue.get("depends_on", [])
        if not isinstance(d, list) or not all(isinstance(x, str) for x in d):
            errors.append(f"issue '{issue['key']}': depends_on must be a list of keys")
            continue
        for dep in d:
            if dep == issue["key"]:
                errors.append(f"issue '{issue['key']}': depends on itself")
            elif dep not in keys:
                errors.append(f"issue '{issue['key']}': unknown dependency '{dep}'")
        deps[issue["key"]] = [x for x in d if x in keys and x != issue["key"]]
    waves: Dict[str, int] = {}
    if not errors:
        try:
            waves = compute_waves(deps)
        except FactoryError as exc:
            errors.append(str(exc))
    if len(issues) > 15:
        warnings.append(f"{len(issues)} issues is large for one release; the factory works best on a PoC or small epic")
    if release.get("type") == "greenfield" and len(issues) > 12:
        warnings.append("greenfield releases should stay a proof of concept; consider trimming scope")
    return errors, warnings, waves


def issue_body(issue: dict, release: dict, wave: int, dep_numbers: Dict[str, int]) -> str:
    route = "Ship Simple (small change)" if issue["complexity"] == "simple" else "Ship (full pipeline)"
    lines = [
        f"**Release:** {release['name']} ({release['type']})",
        f"**Route:** {route}",
        f"**Wave:** {wave} - may run in parallel with other wave-{wave} issues",
        "",
        "## Description",
        issue.get("body", "").strip() or issue["title"],
        "",
        "## Acceptance criteria",
        *[f"- [ ] {a}" for a in issue["acceptance"]],
        "",
        "## Dependencies",
    ]
    if dep_numbers:
        lines += [f"- Depends on #{n} (`{k}`)" for k, n in dep_numbers.items()]
    else:
        lines.append("- None")
    lines += [
        "",
        "## Factory rules",
        f"- {MAX_TRIES} build tries, then the human is asked.",
        f"- {MAX_SENDBACKS} review send-backs max.",
        "- Merge only with CI green.",
        f"<!-- factory:key={issue['key']} release={slugify(release['name'])} -->",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------- resolvers
def resolve(state: dict, ref: str) -> dict:
    issues = state["issues"]
    if ref.lstrip("#").isdigit():
        n = int(ref.lstrip("#"))
        for issue in issues.values():
            if issue["number"] == n:
                return issue
        raise FactoryError(f"no factory issue with number {n}")
    cur = slugify((state.get("release") or {}).get("name", ""))
    uid = f"{cur}/{ref}"
    if uid in issues:
        return issues[uid]
    matches = [i for i in issues.values() if i["key"] == ref]
    if len(matches) == 1:
        return matches[0]
    raise FactoryError(f"cannot resolve issue reference '{ref}'")


def deps_satisfied(state: dict, issue: dict) -> bool:
    for dep in issue["depends_on"]:
        target = state["issues"].get(f"{issue['release']}/{dep}")
        if target is None:
            return False
        if target["status"] == "merged":
            continue
        if target["status"] == "dropped" and target.get("unblocks"):
            continue
        return False
    return True


def promote(fx: Factory, state: dict) -> int:
    count = 0
    for issue in state["issues"].values():
        if issue["status"] == "backlog" and deps_satisfied(state, issue):
            set_status(fx, issue, "ready")
            count += 1
    return count


def escalate(fx: Factory, issue: dict, reason: str, rule: str) -> dict:
    set_status(fx, issue, "needs_human")
    issue["claimed_by"] = None
    esc_dir = fx.home / "escalations"
    esc_dir.mkdir(exist_ok=True)
    path = esc_dir / f"{issue['number']}-{now().replace(':', '')}.md"
    notes = "\n".join(f"- [{n['ts']}] {n['kind']}: {n['text']}" for n in issue["notes"]) or "- (none)"
    path.write_text(
        f"# Escalation: #{issue['number']} {issue['title']}\n\n"
        f"**Rule hit:** {rule}\n**Reason:** {reason}\n"
        f"**Tries:** {issue['tries']}/{MAX_TRIES}  **Send-backs:** {issue['sendbacks']}/{MAX_SENDBACKS}\n"
        f"**PR:** {issue.get('pr') or 'none'}\n\n## History\n{notes}\n\n"
        "## Options for the human\n"
        "- `resolve --action retry`: reset counters and re-queue (use after clarifying the issue)\n"
        "- `resolve --action drop`: abandon this issue (add --unblock-dependents if dependents can proceed)\n"
        "- Reshape: edit the issue text/acceptance criteria, then `resolve --action retry`\n",
        encoding="utf-8")
    gh_comment(fx, issue["number"],
               f"Factory escalation ({rule}): {reason}\n\nHuman decision required. See `{path.name}`.")
    fx.log("escalate", number=issue["number"], rule=rule, reason=reason)
    return {"escalated": True, "number": issue["number"], "rule": rule, "reason": reason,
            "escalation_file": str(path)}


def add_note(issue: dict, kind: str, text: str) -> None:
    issue["notes"].append({"ts": now(), "kind": kind, "text": text})


# --------------------------------------------------------------------- commands
def cmd_init(a: argparse.Namespace) -> Tuple[Any, int]:
    start = Path.cwd().resolve()
    base = git_toplevel(start) or start
    home = (Path(os.environ["FACTORY_HOME"]).expanduser().resolve()
            if os.environ.get("FACTORY_HOME") else base / ".factory")
    if (home / "config.json").exists():
        return {"initialised": False, "reason": "already initialised (nothing overwritten)",
                "home": str(home)}, EXIT_OK
    offline = a.offline
    repo = a.repo
    if not offline:
        if not gh_available():
            warn("gh CLI not found; initialising in offline mode")
            offline = True
        elif not repo:
            proc = subprocess.run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
                                  capture_output=True, text=True, cwd=str(base))
            repo = proc.stdout.strip() if proc.returncode == 0 and proc.stdout.strip() else None
            if not repo:
                warn("could not detect GitHub repo; pass --repo owner/name. Initialising offline")
                offline = True
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.json").write_text(json.dumps({
        "repo": repo, "offline": offline, "merge_method": "squash",
        "holdouts_dir": None, "stale_claim_minutes": 90, "created_at": now()}, indent=2), encoding="utf-8")
    (home / "state.json").write_text(json.dumps({
        "version": STATE_VERSION, "release": None, "issues": {}, "next_number": 1000,
        "feedback_seq": 0}, indent=2), encoding="utf-8")
    fx = Factory(home)
    labels_created = 0
    if not fx.offline:
        for name, (color, desc) in LABELS.items():
            if run_gh(fx, ["label", "create", name, "--repo", fx.repo or "", "--color", color,
                           "--description", desc, "--force"]) is not None:
                labels_created += 1
    gi = base / ".gitignore"
    if (base / ".git").exists():
        existing = gi.read_text(encoding="utf-8") if gi.exists() else ""
        if ".factory/" not in existing.split():
            with open(gi, "a", encoding="utf-8") as fh:
                fh.write(("" if existing.endswith("\n") or not existing else "\n") + ".factory/\n")
    fx.log("init", repo=repo, offline=offline)
    return {"initialised": True, "home": str(home), "repo": repo, "offline": offline,
            "labels_synced": labels_created}, EXIT_OK


def cmd_validate_plan(a: argparse.Namespace) -> Tuple[Any, int]:
    plan = load_json(a.plan)
    errors, warnings, waves = validate_plan(plan)
    grouped: Dict[int, List[str]] = {}
    for k, w in waves.items():
        grouped.setdefault(w, []).append(k)
    out = {"valid": not errors, "errors": errors, "warnings": warnings,
           "waves": [{"wave": w, "parallel_issues": sorted(v)} for w, v in sorted(grouped.items())]}
    return out, EXIT_OK if not errors else EXIT_USAGE


def cmd_split(a: argparse.Namespace) -> Tuple[Any, int]:
    plan = load_json(a.plan)
    errors, warnings, waves = validate_plan(plan)
    if errors:
        raise FactoryError("plan invalid: " + "; ".join(errors))
    release = plan["release"]
    rel_slug = slugify(release["name"])
    order = sorted(plan["issues"], key=lambda i: (waves[i["key"]], i["key"]))
    if a.dry_run:
        return {"dry_run": True, "release": rel_slug, "warnings": warnings,
                "would_create": [{"key": i["key"], "title": i["title"], "wave": waves[i["key"]],
                                  "complexity": i["complexity"], "depends_on": i.get("depends_on", [])}
                                 for i in order]}, EXIT_OK
    fx = require_factory()
    created: List[dict] = []
    skipped: List[str] = []
    with fx.mutate() as st:
        active = st.get("release")
        if active and slugify(active["name"]) != rel_slug:
            open_items = [i for i in st["issues"].values()
                          if i["release"] == slugify(active["name"]) and i["status"] not in ("merged", "dropped")]
            if open_items:
                raise FactoryError(f"release '{active['name']}' still has {len(open_items)} open issue(s); "
                                   "finish or drop them before splitting a new release")
        st["release"] = {"name": release["name"], "type": release["type"], "goal": release["goal"],
                         "split_at": now()}
        for issue in order:
            uid = f"{rel_slug}/{issue['key']}"
            if uid in st["issues"]:
                skipped.append(issue["key"])
                continue
            deps = issue.get("depends_on", [])
            dep_numbers = {d: st["issues"][f"{rel_slug}/{d}"]["number"] for d in deps}
            body = issue_body(issue, release, waves[issue["key"]], dep_numbers)
            labels = [f"complexity:{issue['complexity']}",
                      STATUS_LABEL["ready" if not deps else "backlog"]]
            number: Optional[int] = None
            url = None
            if not fx.offline:
                out = run_gh(fx, ["issue", "create", "--repo", fx.repo or "", "--title", issue["title"],
                                  "--body-file", "-", "--label", ",".join(labels)], stdin=body, required=True)
                m = re.search(r"/issues/(\d+)", out or "")
                if not m:
                    raise FactoryError(f"could not parse issue number from gh output: {out!r}")
                number, url = int(m.group(1)), out
            else:
                number = st["next_number"]
                st["next_number"] += 1
            rec = {"key": issue["key"], "release": rel_slug, "number": number, "url": url,
                   "title": issue["title"], "body": body, "complexity": issue["complexity"],
                   "acceptance": issue["acceptance"], "depends_on": deps, "wave": waves[issue["key"]],
                   "status": "ready" if not deps else "backlog", "tries": 0, "sendbacks": 0,
                   "boost": False, "claimed_by": None, "claimed_at": None, "pr": None,
                   "last_feedback": None, "source": "plan", "unblocks": False, "notes": [],
                   "created_at": now(), "updated_at": now(), "merged_at": None}
            st["issues"][uid] = rec
            created.append({"key": issue["key"], "number": number, "wave": rec["wave"], "status": rec["status"]})
            fx.log("created", number=number, key=issue["key"])
    return {"release": rel_slug, "created": created, "skipped_existing": skipped, "warnings": warnings}, EXIT_OK


def claim_payload(issue: dict) -> dict:
    return {"picked": True, "number": issue["number"], "key": issue["key"], "title": issue["title"],
            "route": "ship-simple" if issue["complexity"] == "simple" else "ship",
            "attempt": issue["tries"], "tries_left": MAX_TRIES - issue["tries"],
            "branch": f"factory/{issue['number']}-{slugify(issue['title'], 30)}",
            "acceptance": issue["acceptance"], "feedback_from_previous_lap": issue.get("last_feedback"),
            "body": issue["body"]}


def cmd_pick(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        promote(fx, st)
        pool = [i for i in st["issues"].values() if i["status"] == "ready"]
        if a.complexity:
            pool = [i for i in pool if i["complexity"] == a.complexity]
        for issue in list(pool):
            if issue["tries"] >= MAX_TRIES:       # defensive: never hand out a 4th try
                escalate(fx, issue, f"already used {MAX_TRIES} tries", "PICK: 3 tries, then ask me")
                pool.remove(issue)
        if not pool:
            counts = status_counts(st)
            return {"picked": None, "reason": "no ready issues", "counts": counts}, EXIT_IDLE
        pool.sort(key=lambda i: (0 if i["boost"] else 1, i["wave"], i["number"]))
        chosen = pool[0]                          # ONE issue per lap
        chosen["tries"] += 1
        chosen["boost"] = False
        chosen["claimed_by"] = a.agent
        chosen["claimed_at"] = now()
        set_status(fx, chosen, "claimed")
        gh_comment(fx, chosen["number"], f"Claimed by `{a.agent}` (try {chosen['tries']}/{MAX_TRIES}).")
        if not fx.offline and a.assign:
            run_gh(fx, ["issue", "edit", str(chosen["number"]), "--repo", fx.repo or "", "--add-assignee", a.assign])
        fx.log("claim", number=chosen["number"], agent=a.agent, attempt=chosen["tries"])
        return claim_payload(chosen), EXIT_OK


def require_status(issue: dict, allowed: Tuple[str, ...], action: str) -> None:
    if issue["status"] not in allowed:
        raise FactoryError(f"cannot {action} #{issue['number']}: status is '{issue['status']}', "
                           f"expected one of {', '.join(allowed)}", EXIT_BLOCKED)


def failed_attempt(fx: Factory, issue: dict, note: str, source: str) -> Tuple[Any, int]:
    add_note(issue, source, note)
    issue["last_feedback"] = note
    issue["claimed_by"] = None
    issue["claimed_at"] = None
    if issue["tries"] >= MAX_TRIES:
        return escalate(fx, issue, f"{MAX_TRIES} failed tries. Last: {note}", "PICK: 3 tries, then ask me"), EXIT_BLOCKED
    set_status(fx, issue, "ready")
    gh_comment(fx, issue["number"], f"Attempt {issue['tries']}/{MAX_TRIES} failed ({source}): {note}\nRe-queued.")
    return {"number": issue["number"], "status": "ready", "tries": issue["tries"],
            "tries_left": MAX_TRIES - issue["tries"]}, EXIT_OK


def cmd_fail(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("claimed", "in_validation"), "record a failed attempt for")
        return failed_attempt(fx, issue, a.note, "build")


def cmd_submit(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("claimed",), "submit")
        issue["pr"] = a.pr
        set_status(fx, issue, "in_validation")
        add_note(issue, "submit", f"PR #{a.pr} opened")
        gh_comment(fx, issue["number"], f"PR #{a.pr} submitted for app validation.")
        return {"number": issue["number"], "status": "in_validation", "pr": a.pr}, EXIT_OK


def cmd_validate(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("in_validation",), "validate")
        if a.result == "pass":
            set_status(fx, issue, "in_review")
            add_note(issue, "validation", a.note or "passed")
            gh_comment(fx, issue["number"], "App validation passed (incl. holdouts). Moving to code review.")
            return {"number": issue["number"], "status": "in_review"}, EXIT_OK
        if not a.note:
            raise FactoryError("--note is required when validation fails (state what broke, without leaking holdout content)")
        return failed_attempt(fx, issue, a.note, "validation")


def cmd_review(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("in_review",), "review")
        if a.verdict == "merge-ready":
            set_status(fx, issue, "approved")
            add_note(issue, "review", a.note or "merge-ready")
            gh_comment(fx, issue["number"], "Code review: merge-ready.")
            return {"number": issue["number"], "status": "approved"}, EXIT_OK
        if not a.note:
            raise FactoryError("--note is required for a send-back (the next lap needs concrete feedback)")
        issue["sendbacks"] += 1
        add_note(issue, "send-back", a.note)
        issue["last_feedback"] = a.note
        if issue["sendbacks"] > MAX_SENDBACKS:
            return escalate(fx, issue, f"review rejected the work a third time. Last: {a.note}",
                            "REVIEW: 2 send-backs max"), EXIT_BLOCKED
        # Sent back: fixed on a later lap. The try counter resets because this is a new, informed pass.
        issue["tries"] = 0
        issue["boost"] = True
        set_status(fx, issue, "ready")
        gh_comment(fx, issue["number"],
                   f"Code review send-back {issue['sendbacks']}/{MAX_SENDBACKS}: {a.note}\nRe-queued for a later lap.")
        return {"number": issue["number"], "status": "ready", "sendbacks": issue["sendbacks"],
                "sendbacks_left": MAX_SENDBACKS - issue["sendbacks"]}, EXIT_OK


def ci_is_green(fx: Factory, pr: int) -> Tuple[bool, str]:
    if fx.offline:
        return False, "cannot verify CI offline"
    out = run_gh(fx, ["pr", "checks", str(pr), "--repo", fx.repo or "", "--json", "bucket,name"])
    if out is None:
        return False, "could not read CI status from GitHub"
    try:
        checks = json.loads(out or "[]")
    except json.JSONDecodeError:
        return False, "unparseable CI status"
    if not checks:
        return False, "no CI checks reported (cannot confirm green)"
    bad = [c["name"] for c in checks if c.get("bucket") not in ("pass", "skipping")]
    return (not bad), ("all checks green" if not bad else "not green: " + ", ".join(bad))


def cmd_merge(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("approved",), "merge")
        if not issue.get("pr"):
            raise FactoryError(f"#{issue['number']} has no PR recorded", EXIT_BLOCKED)
        if a.ci == "auto":
            green, detail = ci_is_green(fx, issue["pr"])
        elif a.ci == "green":
            green, detail = True, "asserted green by caller"
        else:
            green, detail = False, "caller reports CI red"
        if not green:
            add_note(issue, "merge-blocked", detail)
            return {"merged": False, "rule": "MERGE: CI green", "detail": detail}, EXIT_BLOCKED
        if not fx.offline and not a.no_gh_merge:
            method = {"squash": "--squash", "merge": "--merge", "rebase": "--rebase"}[fx.config.get("merge_method", "squash")]
            run_gh(fx, ["pr", "merge", str(issue["pr"]), "--repo", fx.repo or "", method, "--delete-branch"], required=True)
        issue["merged_at"] = now()
        set_status(fx, issue, "merged")
        add_note(issue, "merge", detail)
        unblocked = promote(fx, st)
        return {"merged": True, "number": issue["number"], "ci": detail, "dependents_unblocked": unblocked,
                "next": "merged code goes to staging; test it and feed problems back with `feedback`"}, EXIT_OK


def cmd_ask(a: argparse.Namespace) -> Tuple[Any, int]:
    """The 'its questions, my answers' channel: park an issue until the human answers."""
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("claimed", "in_validation", "in_review"), "ask a question about")
        add_note(issue, "question", a.question)
        # A question is not a failed try: refund the try that this lap consumed.
        if issue["status"] == "claimed" and issue["tries"] > 0:
            issue["tries"] -= 1
        return escalate(fx, issue, a.question, "ASK: agent needs a human answer"), EXIT_BLOCKED


def cmd_feedback(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        rel = st.get("release")
        if not rel:
            raise FactoryError("no active release; split a plan first")
        rel_slug = slugify(rel["name"])
        st["feedback_seq"] += 1
        key = f"fb-{st['feedback_seq']}"
        body = "\n".join([
            f"**Source:** staging feedback ({a.severity})", f"**Release:** {rel['name']}", "",
            "## What is off", a.body.strip(), "", "## Acceptance criteria", *[f"- [ ] {c}" for c in a.acceptance],
            "", f"<!-- factory:key={key} release={rel_slug} source=feedback -->"])
        labels = ["factory:feedback", f"complexity:{a.complexity}", STATUS_LABEL["ready"]]
        if fx.offline:
            number, url = st["next_number"], None
            st["next_number"] += 1
        else:
            out = run_gh(fx, ["issue", "create", "--repo", fx.repo or "", "--title", a.title, "--body-file", "-",
                              "--label", ",".join(labels)], stdin=body, required=True)
            m = re.search(r"/issues/(\d+)", out or "")
            if not m:
                raise FactoryError(f"could not parse issue number from gh output: {out!r}")
            number, url = int(m.group(1)), out
        st["issues"][f"{rel_slug}/{key}"] = {
            "key": key, "release": rel_slug, "number": number, "url": url, "title": a.title, "body": body,
            "complexity": a.complexity, "acceptance": a.acceptance, "depends_on": [], "wave": 0,
            "status": "ready", "tries": 0, "sendbacks": 0, "boost": a.severity == "regression",
            "claimed_by": None, "claimed_at": None, "pr": None, "last_feedback": None, "source": "feedback",
            "unblocks": False, "notes": [], "created_at": now(), "updated_at": now(), "merged_at": None}
        fx.log("feedback", number=number, severity=a.severity)
        return {"created": True, "number": number, "key": key, "status": "ready",
                "note": "feedback re-enters the factory as a normal issue"}, EXIT_OK


def cmd_resolve(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    with fx.mutate() as st:
        issue = resolve(st, a.ref)
        require_status(issue, ("needs_human",), "resolve")
        add_note(issue, "human", f"{a.action}: {a.note}")
        if a.action == "retry":
            issue.update(tries=0, sendbacks=0, boost=True, claimed_by=None, claimed_at=None)
            issue["last_feedback"] = a.note
            set_status(fx, issue, "ready")
        else:
            issue["unblocks"] = bool(a.unblock_dependents)
            set_status(fx, issue, "dropped")
        gh_comment(fx, issue["number"], f"Human decision: {a.action}. {a.note}")
        promote(fx, st)
        return {"number": issue["number"], "status": issue["status"]}, EXIT_OK


def cmd_sweep(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    limit = a.minutes if a.minutes is not None else fx.config.get("stale_claim_minutes", 90)
    results = []
    with fx.mutate() as st:
        for issue in list(st["issues"].values()):
            if issue["status"] in ("claimed", "in_validation") and minutes_since(issue["claimed_at"]) > limit:
                res, code = failed_attempt(fx, issue, f"claim went stale (> {limit} min with no progress)", "sweep")
                results.append({**res, "exit": code})
    return {"swept": results, "stale_after_minutes": limit}, EXIT_OK


def status_counts(state: dict) -> Dict[str, int]:
    counts = {s: 0 for s in STATUSES}
    for issue in state["issues"].values():
        counts[issue["status"]] += 1
    return counts


def cmd_status(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    st = fx.read()
    rows = sorted(st["issues"].values(), key=lambda i: (i["wave"], i["number"]))
    data = {"release": st["release"], "counts": status_counts(st), "issues": [
        {k: i[k] for k in ("number", "key", "title", "status", "complexity", "wave", "tries", "sendbacks", "pr", "claimed_by")}
        for i in rows], "repo": fx.repo, "offline": fx.offline}
    if a.json:
        return data, EXIT_OK
    lines = []
    if st["release"]:
        lines.append(f"Release: {st['release']['name']} ({st['release']['type']}) - {st['release']['goal']}")
    lines.append("Counts: " + ", ".join(f"{k}={v}" for k, v in data["counts"].items() if v))
    lines.append(f"{'#':>6}  {'status':<14} {'cx':<7} {'w':>2} {'tries':>5} {'sb':>3}  title")
    for i in rows:
        lines.append(f"{i['number']:>6}  {i['status']:<14} {i['complexity']:<7} {i['wave']:>2} "
                     f"{i['tries']:>2}/{MAX_TRIES} {i['sendbacks']:>1}/{MAX_SENDBACKS}  {i['title']}")
    return "\n".join(lines), EXIT_OK


def cmd_manager_report(a: argparse.Namespace) -> Tuple[Any, int]:
    """Produce the evidence the Manager agent needs to 'step back and fix what one lap can't see'."""
    fx = require_factory()
    st = fx.read()
    stale_min = a.stale_minutes if a.stale_minutes is not None else fx.config.get("stale_claim_minutes", 90)
    issues = list(st["issues"].values())
    counts = status_counts(st)
    stuck = [i for i in issues if i["status"] in ("claimed", "in_validation") and minutes_since(i["claimed_at"]) > stale_min]
    retry_hot = [i for i in issues if i["tries"] >= 2 and i["status"] not in ("merged", "dropped")]
    sb_hot = [i for i in issues if i["sendbacks"] >= 1 and i["status"] not in ("merged", "dropped")]
    human = [i for i in issues if i["status"] == "needs_human"]
    blocked = [i for i in issues if i["status"] == "backlog" and any(
        (st["issues"].get(f"{i['release']}/{d}") or {}).get("status") in ("needs_human", "dropped") for d in i["depends_on"])]
    merged = [i for i in issues if i["merged_at"]]
    cycle = [(parse_ts(i["merged_at"]) - parse_ts(i["created_at"])).total_seconds() / 3600 for i in merged]
    feedback_issues = [i for i in issues if i["source"] == "feedback"]
    obs: List[str] = []
    if human:
        obs.append(f"{len(human)} issue(s) await a human decision; dependents are blocked until resolved.")
    if blocked:
        obs.append(f"{len(blocked)} backlog issue(s) are blocked behind escalated/dropped work: "
                   + ", ".join(f"#{i['number']}" for i in blocked))
    if len(retry_hot) >= 2:
        obs.append("Multiple issues are burning retries; look for a shared root cause (broken test env, "
                   "missing fixture, flaky CI, unclear conventions) and fix it once.")
    if len(sb_hot) >= 2:
        obs.append("Several issues were sent back by review; check whether builders share a misunderstanding "
                   "of conventions and encode it in the repo's agent instructions.")
    if stuck:
        obs.append(f"{len(stuck)} claim(s) look stale; run `sweep` or check for crashed laps.")
    if feedback_issues and len(feedback_issues) >= max(3, len(merged) // 2 or 1):
        obs.append("Heavy staging feedback relative to merges; strengthen holdout scenarios or acceptance criteria.")
    if not obs:
        obs.append("No structural problems detected. Spot-check the latest merged PRs for drift.")
    report = {
        "generated_at": now(), "release": st["release"], "counts": counts,
        "throughput": {"merged": len(merged), "avg_cycle_hours": round(sum(cycle) / len(cycle), 2) if cycle else None},
        "stuck_claims": [{"number": i["number"], "claimed_by": i["claimed_by"], "minutes": round(minutes_since(i["claimed_at"]))} for i in stuck],
        "retry_hotspots": [{"number": i["number"], "title": i["title"], "tries": i["tries"], "last_feedback": i["last_feedback"]} for i in retry_hot],
        "sendback_hotspots": [{"number": i["number"], "title": i["title"], "sendbacks": i["sendbacks"], "last_feedback": i["last_feedback"]} for i in sb_hot],
        "needs_human": [{"number": i["number"], "title": i["title"]} for i in human],
        "blocked_backlog": [i["number"] for i in blocked],
        "staging_feedback_issues": len(feedback_issues),
        "observations": obs,
        "manager_charter": "Fix what one lap cannot see: shared root causes, flaky infra, conventions, scope. "
                           "Hard rules are not yours to relax. Fixes ship as normal issues through the factory.",
    }
    reports = fx.home / "reports"
    reports.mkdir(exist_ok=True)
    path = reports / f"manager-{now().replace(':', '')}.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")   # new file every time, never overwrites
    report["saved_to"] = str(path)
    return report, EXIT_OK


# ----------------------------------------------------------------------- holdouts
def holdouts_dir(fx: Factory) -> Path:
    d = fx.config.get("holdouts_dir")
    if not d:
        raise FactoryError("holdouts not configured; run `factory.py holdouts init`")
    return Path(d).expanduser().resolve()


def read_holdout_header(path: Path) -> Optional[Tuple[str, str]]:
    try:
        first = path.read_text(encoding="utf-8").splitlines()[0]
    except (IndexError, UnicodeDecodeError, OSError):
        return None
    m = re.match(r"^#\s*(HS-\d{3,}):\s*(.+)$", first)
    return (m.group(1), m.group(2).strip()) if m else None


def cmd_holdouts(a: argparse.Namespace) -> Tuple[Any, int]:
    fx = require_factory()
    repo_root = fx.home.parent.resolve()
    if a.hcmd == "init":
        if fx.config.get("holdouts_dir") and not a.path:
            return {"holdouts_dir": fx.config["holdouts_dir"], "created": False}, EXIT_OK
        target = Path(a.path).expanduser().resolve() if a.path else (
            Path.home() / ".factory-holdouts" / slugify((fx.repo or repo_root.name).replace("/", "-")))
        if target == repo_root or repo_root in target.parents:
            raise FactoryError("holdouts must live OUTSIDE the repository so builders can never see them")
        target.mkdir(parents=True, exist_ok=True)
        os.chmod(target, 0o700)
        fx.config["holdouts_dir"] = str(target)
        fx.config_path.write_text(json.dumps(fx.config, indent=2), encoding="utf-8")
        return {"holdouts_dir": str(target), "created": True}, EXIT_OK
    d = holdouts_dir(fx)
    if a.hcmd == "path":
        return {"holdouts_dir": str(d), "warning": "validator and manager roles only"}, EXIT_OK
    if a.hcmd == "new":
        if not HOLDOUT_ID_RE.match(a.id):
            raise FactoryError("id must look like HS-001")
        target = d / f"{a.id}.md"
        if target.exists():
            raise FactoryError(f"{target.name} already exists; holdouts are never overwritten")
        d.mkdir(parents=True, exist_ok=True)
        target.write_text(
            f"# {a.id}: {a.title}\n\n## Persona and starting state\n\n## Steps (as a user would do them)\n1. \n\n"
            "## Expected observable outcome\n\n## Pass / fail criteria\n- PASS if:\n- FAIL if:\n\n"
            "## Edge conditions to probe\n- \n", encoding="utf-8")
        return {"created": str(target)}, EXIT_OK
    if a.hcmd == "list":
        items = []
        for p in sorted(d.glob("HS-*.md")):
            h = read_holdout_header(p)
            items.append({"id": h[0], "title": h[1]} if h else {"file": p.name, "problem": "missing '# HS-nnn: title' header"})
        return {"count": len(items), "scenarios": items}, EXIT_OK
    if a.hcmd == "check":
        problems: List[str] = []
        if repo_root == d or repo_root in d.parents:
            problems.append("holdouts directory is inside the repository")
        if not d.exists():
            problems.append("holdouts directory does not exist")
        files = sorted(d.glob("HS-*.md")) if d.exists() else []
        if not files:
            problems.append("no holdout scenarios written yet (write them BEFORE the factory builds)")
        for p in files:
            if not read_holdout_header(p):
                problems.append(f"{p.name}: missing '# HS-nnn: title' header")
        if d.exists() and (d.stat().st_mode & 0o077):
            problems.append("holdouts directory is group/world accessible (chmod 700 recommended)")
        return {"ok": not problems, "count": len(files), "problems": problems}, EXIT_OK if not problems else EXIT_BLOCKED
    if a.hcmd == "leak-scan":
        ids: Dict[str, str] = {}
        for p in d.glob("HS-*.md") if d.exists() else []:
            h = read_holdout_header(p)
            if h:
                ids[h[0]] = h[1]
        needles = [(i, re.compile(re.escape(i), re.I)) for i in ids]
        needles += [(f"title of {i}", re.compile(re.escape(t), re.I)) for i, t in ids.items() if len(t) >= 12]
        skip = {".git", "node_modules", ".factory", "dist", "build", "__pycache__", ".venv", "venv"}
        hits: List[dict] = []
        for root, dirs, files in os.walk(repo_root):
            dirs[:] = [x for x in dirs if x not in skip]
            for name in files:
                p = Path(root) / name
                try:
                    if p.stat().st_size > 1_000_000:
                        continue
                    text = p.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                for ln, line in enumerate(text.splitlines(), 1):
                    for label, rx in needles:
                        if rx.search(line):
                            hits.append({"file": str(p.relative_to(repo_root)), "line": ln, "matched": label})
        return {"leaked": bool(hits), "scenarios_checked": len(ids), "hits": hits[:50]}, EXIT_OK if not hits else EXIT_BLOCKED
    raise FactoryError(f"unknown holdouts command {a.hcmd}")


# ---------------------------------------------------------------------------- CLI
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="factory.py", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init", help="create .factory/ (never overwrites an existing one)")
    s.add_argument("--repo", help="owner/name (auto-detected through gh if omitted)")
    s.add_argument("--offline", action="store_true", help="do not talk to GitHub; state-only mode")
    s.set_defaults(fn=cmd_init)

    s = sub.add_parser("validate-plan", help="validate a release plan and show parallel waves")
    s.add_argument("plan")
    s.set_defaults(fn=cmd_validate_plan)

    s = sub.add_parser("split", help="turn a release plan into linked GitHub issues")
    s.add_argument("plan")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_split)

    s = sub.add_parser("pick", help="claim exactly ONE ready issue (exit 10 if none)")
    s.add_argument("--agent", required=True, help="lap/agent identifier, e.g. lap-1")
    s.add_argument("--complexity", choices=["simple", "complex"])
    s.add_argument("--assign", help="GitHub login to assign (optional)")
    s.set_defaults(fn=cmd_pick)

    s = sub.add_parser("submit", help="builder finished: record the PR, move to app validation")
    s.add_argument("ref"); s.add_argument("--pr", type=int, required=True)
    s.set_defaults(fn=cmd_submit)

    s = sub.add_parser("fail", help="record a failed build attempt (enforces 3-tries rule)")
    s.add_argument("ref"); s.add_argument("--note", required=True)
    s.set_defaults(fn=cmd_fail)

    s = sub.add_parser("validate", help="record app-validation result")
    s.add_argument("ref"); s.add_argument("--result", choices=["pass", "fail"], required=True)
    s.add_argument("--note")
    s.set_defaults(fn=cmd_validate)

    s = sub.add_parser("review", help="record code-review verdict (enforces 2-send-backs rule)")
    s.add_argument("ref"); s.add_argument("--verdict", choices=["merge-ready", "send-back"], required=True)
    s.add_argument("--note")
    s.set_defaults(fn=cmd_review)

    s = sub.add_parser("merge", help="merge an approved PR (enforces CI-green rule)")
    s.add_argument("ref")
    s.add_argument("--ci", choices=["auto", "green", "red"], default="auto",
                   help="auto asks GitHub; 'green' asserts you verified it yourself")
    s.add_argument("--no-gh-merge", action="store_true", help="record merge without calling `gh pr merge`")
    s.set_defaults(fn=cmd_merge)

    s = sub.add_parser("ask", help="park an issue and ask the human a question (not a failed try)")
    s.add_argument("ref"); s.add_argument("--question", required=True)
    s.set_defaults(fn=cmd_ask)

    s = sub.add_parser("feedback", help="staging found something off: file it as a new issue")
    s.add_argument("--title", required=True); s.add_argument("--body", required=True)
    s.add_argument("--acceptance", action="append", required=True, help="repeatable")
    s.add_argument("--severity", choices=["bug", "regression", "polish"], default="bug")
    s.add_argument("--complexity", choices=["simple", "complex"], default="simple")
    s.set_defaults(fn=cmd_feedback)

    s = sub.add_parser("resolve", help="human decision on an escalated issue")
    s.add_argument("ref"); s.add_argument("--action", choices=["retry", "drop"], required=True)
    s.add_argument("--note", required=True)
    s.add_argument("--unblock-dependents", action="store_true")
    s.set_defaults(fn=cmd_resolve)

    s = sub.add_parser("sweep", help="treat stale claims as failed attempts")
    s.add_argument("--minutes", type=int)
    s.set_defaults(fn=cmd_sweep)

    s = sub.add_parser("status", help="show factory state")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_status)

    s = sub.add_parser("manager-report", help="evidence pack for the Manager agent")
    s.add_argument("--stale-minutes", type=int)
    s.set_defaults(fn=cmd_manager_report)

    s = sub.add_parser("holdouts", help="manage holdout scenarios (validator/manager roles only)")
    hs = s.add_subparsers(dest="hcmd", required=True)
    h = hs.add_parser("init"); h.add_argument("--path")
    hs.add_parser("path")
    h = hs.add_parser("new"); h.add_argument("--id", required=True); h.add_argument("--title", required=True)
    hs.add_parser("list"); hs.add_parser("check"); hs.add_parser("leak-scan")
    s.set_defaults(fn=cmd_holdouts)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result, code = args.fn(args)
    except FactoryError as exc:
        payload = {"error": str(exc), **exc.payload}
        print(json.dumps(payload, indent=2), file=sys.stderr)
        return exc.code
    if isinstance(result, str):
        print(result)
    else:
        emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
