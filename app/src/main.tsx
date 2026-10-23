import React, { useCallback, useEffect, useRef, useState, useId } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  ExternalLink,
  FileCheck2,
  GitBranch,
  GitMerge,
  Layers3,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Terminal,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import * as bridge from "./bridge";
import "./style.css";

type Issue = {
  id: string;
  key: string;
  title: string;
  body: string;
  acceptance: string[];
  depends_on: string[];
  complexity: string;
  status: string;
  tries: number;
  sendbacks: number;
  feedback: string;
  revision: number;
  branch?: string;
  head?: string;
  pr?: number;
};
type Snapshot = {
  projects: any[];
  releases: any[];
  selected: string | null;
  issues: Issue[];
  jobs: any[];
  events: any[];
  artifacts: any[];
  health: any;
};
type Tab = "board" | "plan" | "workers" | "evidence" | "decisions" | "activity";
const tabs: { id: Tab; label: string; icon: typeof Box }[] = [
  { id: "board", label: "Factory board", icon: LayoutDashboard },
  { id: "plan", label: "Release plan", icon: Layers3 },
  { id: "workers", label: "Workers", icon: Users },
  { id: "evidence", label: "Validation & review", icon: ShieldCheck },
  { id: "decisions", label: "Decision inbox", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: Activity },
];
const labels: Record<string, string> = {
  backlog: "Blocked",
  ready: "Ready",
  claimed: "Building",
  in_validation: "Validating",
  in_review: "Reviewing",
  approved: "Merge ready",
  merged: "Merged",
  needs_human: "Needs you",
  dropped: "Dropped",
  cancelled: "Cancelled",
};
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const short = (value?: string) => value?.slice(0, 8) || "—";
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span />
      {labels[status] || status}
    </span>
  );
}
function Empty({
  icon: Icon = Layers3,
  title,
  children,
}: {
  icon?: typeof Box;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function App() {
  const [data, setData] = useState<Snapshot>(),
    [tab, setTab] = useState<Tab>("board"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"release" | "feedback" | "cancel" | null>(
      null,
    ),
    [detail, setDetail] = useState<Issue | null>(null),
    [evidence, setEvidence] = useState<any>(),
    [filter, setFilter] = useState(""),
    [link, setLink] = useState(""),
    [theme, setTheme] = useState(
      document.documentElement.dataset.theme === "light" ? "light" : "dark",
    );
  const selected = useRef<string | undefined>(undefined),
    mounted = useRef(true),
    refreshing = useRef(false),
    generation = useRef(0);
  const accept = useCallback((value: Snapshot) => {
    if (mounted.current) {
      setData(value);
      selected.current = value.selected ?? undefined;
    }
  }, []);
  const refresh = useCallback(
    async (id?: string) => {
      if (refreshing.current) return;
      refreshing.current = true;
      const g = ++generation.current;
      try {
        const value = await bridge.snapshot(id ?? selected.current);
        if (g === generation.current) accept(value);
      } catch (e) {
        if (mounted.current)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        refreshing.current = false;
      }
    },
    [accept],
  );
  useEffect(() => {
    mounted.current = true;
    bridge.connect(accept, setError);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 2500);
    const stop = () => {
      clearInterval(timer);
      mounted.current = false;
    };
    window.addEventListener("factory-teardown", stop);
    return () => {
      stop();
      window.removeEventListener("factory-teardown", stop);
    };
  }, [accept, refresh]);
  useEffect(() => {
    const syncTheme = () =>
      setTheme(
        document.documentElement.dataset.theme === "light" ? "light" : "dark",
      );
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    syncTheme();
    return () => observer.disconnect();
  }, []);
  const act = async (command: any) => {
    setBusy(true);
    setError("");
    try {
      const result = await bridge.control(command);
      await refresh(command.releaseId);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const release = data?.releases.find((r) => r.id === data.selected),
    project = data?.projects.find((p) => p.id === release?.project),
    issues = data?.issues ?? [],
    decisions = issues.filter((i) => i.status === "needs_human"),
    merged = issues.filter((i) => i.status === "merged").length,
    running = issues.filter((i) =>
      ["claimed", "in_validation", "in_review"].includes(i.status),
    ).length;
  const toggleTheme = () => {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  };
  const selectRelease = (id: string) => {
    selected.current = id;
    generation.current++;
    refreshing.current = false;
    void refresh(id);
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("board");
          }}
        >
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          <span>
            IRON LEGION<small>SOFTWARE FACTORY</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>LOCAL</span>
        </div>
        <div className="workspace">
          <Box size={17} />
          <div>
            {project?.name || "Your workspace"}
            <small>{project?.github || "Local orchestration"}</small>
          </div>
        </div>
        <div className="nav-label">CONTROL CENTER</div>
        <nav>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {id === "decisions" && decisions.length > 0 && (
                <span className="count">{decisions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-status">
            <span className={data?.health.worker ? "pulse" : ""} />
            {data?.health.worker
              ? "Factory engine online"
              : "Connecting to engine"}
          </div>
          <p>
            Plan the release.
            <br />
            Let the factory build.
          </p>
          <span className="version">IRON LEGION / v1.0</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <strong>{tabs.find((t) => t.id === tab)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className="local-label">
              <ShieldCheck size={13} /> LOCAL FIRST
            </span>
            <button
              className="icon-button"
              aria-label="Refresh factory"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-button"
              aria-label="Toggle fullscreen"
              onClick={() =>
                void bridge
                  .fullscreen()
                  .then((url) => {
                    if (url) setLink(url);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              <Maximize2 size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> AUTONOMOUS DELIVERY
              </div>
              <h1>
                {tab === "board"
                  ? "Your software, in motion."
                  : tabs.find((t) => t.id === tab)?.label}
              </h1>
              <p>
                {tab === "board"
                  ? "From a clear plan to reviewed code. Every step, visible."
                  : tab === "plan"
                    ? "A focused release. Explicit dependencies. Observable acceptance criteria."
                    : tab === "workers"
                      ? "Independent roles. Focused assignments. Fresh contexts."
                      : tab === "evidence"
                        ? "Evidence attached to the exact commit that was evaluated."
                        : tab === "decisions"
                          ? "Your judgment, precisely where the factory needs it."
                          : "The durable record of what happened and why."}
              </p>
            </div>
            <button
              className="primary"
              disabled={!data?.projects.length || busy}
              onClick={() => setModal("release")}
            >
              <Plus size={17} /> New release
            </button>
          </div>
          {error && (
            <div role="alert" className="notice danger">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {link && (
            <div className="notice">
              <span>
                Open this one-time dashboard link within 60 seconds:{" "}
                <a href={link} target="_blank" rel="noreferrer">
                  Open factory in browser <ExternalLink size={13} />
                </a>
              </span>
              <button aria-label="Dismiss link" onClick={() => setLink("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading">
              <Loader2 className="spin" /> Connecting to your factory…
            </div>
          ) : !data.projects.length ? (
            <section className="panel onboarding">
              <div className="eyebrow">WELCOME TO IRON LEGION</div>
              <h2>Give your factory a workspace.</h2>
              <p>
                Add a Git project and your coding-agent commands to the local
                configuration, then restart the server. Your release plans, work
                history, and decisions stay on this machine.
              </p>
              <div className="setup-steps">
                <div>
                  <span>01</span>
                  <h3>Connect a repository</h3>
                  <p>Choose a local Git repository and its base branch.</p>
                </div>
                <div>
                  <span>02</span>
                  <h3>Assign the roles</h3>
                  <p>
                    Configure independent Builder, Validator, and Reviewer
                    commands.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <h3>Plan the release</h3>
                  <p>
                    Define a small outcome and measurable acceptance criteria.
                  </p>
                </div>
              </div>
              <pre>
                Copy config.example.json to ~/.iron-legion/config.json{"\n"}Set
                project root, executors, and checks{"\n"}Restart Iron Legion →
                New release
              </pre>
              <div className="inline-hint">
                <ShieldCheck size={17} /> Use container isolation when private
                scenarios must be inaccessible to builders.
              </div>
            </section>
          ) : (
            <>
              <section className="release-bar">
                <div className="release-choice">
                  <GitBranch size={19} />
                  <label className="sr-only" htmlFor="release-select">
                    Selected release
                  </label>
                  <select
                    id="release-select"
                    value={data.selected ?? ""}
                    onChange={(e) => selectRelease(e.target.value)}
                  >
                    {!release && <option value="">Choose a release</option>}
                    {data.releases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  {release && <Badge status={release.status} />}
                </div>
                <div className="release-actions">
                  {release && (
                    <>
                      {release.status === "draft" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: "start",
                              releaseId: release.id,
                            }).catch(() => {})
                          }
                        >
                          <Play size={15} /> Start factory
                        </button>
                      )}
                      {release.status === "running" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: "pause",
                              releaseId: release.id,
                            }).catch(() => {})
                          }
                        >
                          <Pause size={15} /> Pause dispatch
                        </button>
                      )}
                      {release.status === "paused" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: "resume",
                              releaseId: release.id,
                            }).catch(() => {})
                          }
                        >
                          <Play size={15} /> Resume
                        </button>
                      )}
                      {!["cancelled", "completed"].includes(release.status) && (
                        <button
                          className="muted-button"
                          disabled={busy}
                          onClick={() => setModal("cancel")}
                        >
                          <X size={14} /> Cancel
                        </button>
                      )}
                      {!["draft", "cancelled"].includes(release.status) && (
                        <button
                          disabled={busy}
                          onClick={() => setModal("feedback")}
                        >
                          <Plus size={15} /> Feedback
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>
              {!release ? (
                <section className="panel">
                  <Empty title="Your next release starts here">
                    Create a release with a focused goal and a few independently
                    shippable issues.
                  </Empty>
                </section>
              ) : (
                <>
                  <section className="stats">
                    <div>
                      <span>
                        RELEASE PROGRESS <GitMerge size={16} />
                      </span>
                      <strong>
                        {merged}
                        <small> / {issues.length}</small>
                      </strong>
                      <div className="progress">
                        <i
                          style={{
                            width: `${issues.length ? (merged / issues.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <p>issues merged</p>
                    </div>
                    <div>
                      <span>
                        IN THE FACTORY <Zap size={16} />
                      </span>
                      <strong>{running.toString().padStart(2, "0")}</strong>
                      <p>
                        <span className="dot building" /> active assignments
                      </p>
                    </div>
                    <div>
                      <span>
                        NEEDS YOUR INPUT <MessageSquare size={16} />
                      </span>
                      <strong className={decisions.length ? "attention" : ""}>
                        {decisions.length.toString().padStart(2, "0")}
                      </strong>
                      <p>
                        {decisions.length
                          ? "decisions waiting for you"
                          : "No decisions waiting"}
                      </p>
                    </div>
                    <div>
                      <span>
                        EXECUTION MODE <ShieldCheck size={16} />
                      </span>
                      <strong className="mode-text">
                        {project?.isolation === "container"
                          ? "Isolated"
                          : "Trusted"}
                      </strong>
                      <p>
                        {project?.isolation === "container"
                          ? "Container workers"
                          : "Local process workers"}
                      </p>
                    </div>
                  </section>
                  {tab === "board" && (
                    <section className="panel board-panel">
                      <div className="section-heading">
                        <div>
                          <h2>
                            Release pipeline{" "}
                            <span className="subtle">
                              {issues.length} issues
                            </span>
                          </h2>
                          <p>{release.goal}</p>
                        </div>
                        <label className="search">
                          <Search size={15} />
                          <input
                            placeholder="Filter issues…"
                            aria-label="Filter issues"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="board">
                        {[
                          {
                            title: "Queued",
                            statuses: ["backlog", "ready"],
                            color: "queued",
                          },
                          {
                            title: "Building",
                            statuses: ["claimed"],
                            color: "building",
                          },
                          {
                            title: "Validating",
                            statuses: ["in_validation"],
                            color: "validating",
                          },
                          {
                            title: "Reviewing",
                            statuses: ["in_review", "approved"],
                            color: "reviewing",
                          },
                          {
                            title: "Delivered",
                            statuses: ["merged", "dropped", "cancelled"],
                            color: "delivered",
                          },
                          {
                            title: "Needs you",
                            statuses: ["needs_human"],
                            color: "attention",
                          },
                        ].map((column) => {
                          const cards = issues.filter(
                            (i) =>
                              column.statuses.includes(i.status) &&
                              `${i.title} ${i.key}`
                                .toLowerCase()
                                .includes(filter.toLowerCase()),
                          );
                          return (
                            <div className="column" key={column.title}>
                              <div className="column-title">
                                <span className={`dot ${column.color}`} />
                                {column.title}
                                <small>{cards.length}</small>
                              </div>
                              <div className="column-cards">
                                {cards.map((i) => (
                                  <button
                                    className="issue-card"
                                    key={i.id}
                                    onClick={() => setDetail(i)}
                                  >
                                    <div className="card-meta">
                                      <span>{i.key}</span>
                                      {i.complexity === "simple" ? (
                                        <Zap size={14} />
                                      ) : (
                                        <Layers3 size={14} />
                                      )}
                                    </div>
                                    <h3>{i.title}</h3>
                                    <div className="card-footer">
                                      <Badge status={i.status} />
                                      <span>{i.tries}/3 tries</span>
                                    </div>
                                    {i.depends_on.length > 0 && (
                                      <div className="dependency">
                                        <GitBranch size={12} />
                                        {i.depends_on.join(", ")}
                                      </div>
                                    )}
                                  </button>
                                ))}
                                {!cards.length && (
                                  <div className="column-empty">
                                    {filter
                                      ? "No matching issues"
                                      : "No issues"}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="panel-footer">
                        <span>
                          <Circle size={12} /> 3 attempts, then escalation
                        </span>
                        <span>
                          <ArrowDownLeft size={13} /> 2 review send-backs
                          maximum
                        </span>
                        <span>
                          <CheckCircle2 size={13} /> Verified CI before merge
                        </span>
                      </div>
                    </section>
                  )}
                  {tab === "plan" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>{release.name}</h2>
                          <p>{release.goal}</p>
                        </div>
                        <Badge status={release.type} />
                      </div>
                      <div className="plan-list">
                        {issues.map((i) => (
                          <button
                            className="plan-row"
                            key={i.id}
                            onClick={() => setDetail(i)}
                          >
                            <span className="issue-key">{i.key}</span>
                            <div>
                              <h3>{i.title}</h3>
                              <p>
                                {i.acceptance.length} acceptance criteria ·{" "}
                                {i.complexity} route
                                {i.depends_on.length
                                  ? ` · after ${i.depends_on.join(", ")}`
                                  : " · can start independently"}
                              </p>
                            </div>
                            <Badge status={i.status} />
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                      <div className="panel-footer">
                        <span>
                          <ShieldCheck size={14} /> Private scenarios{" "}
                          {project?.holdouts
                            ? "configured outside the repository"
                            : "not configured"}
                        </span>
                        {project?.github && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void act({
                                action: "sync_github",
                                releaseId: release.id,
                              }).catch(() => {})
                            }
                          >
                            Sync GitHub issues <ExternalLink size={13} />
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                  {tab === "workers" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Worker assignments</h2>
                          <p>
                            Configured roles:{" "}
                            {project?.roles.join(", ") || "none"}
                          </p>
                        </div>
                        <span className="subtle">
                          {data.health.concurrency} concurrent slots
                        </span>
                      </div>
                      {!data.jobs.length ? (
                        <Empty
                          icon={Users}
                          title="Workers are ready when you are"
                        >
                          Start the factory to dispatch the first ready issue.
                        </Empty>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>ROLE / JOB</th>
                                <th>ISSUE</th>
                                <th>STATUS</th>
                                <th>CANDIDATE</th>
                                <th>STARTED</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.jobs.map((j) => (
                                <tr key={j.id}>
                                  <td>
                                    <button
                                      className="text-button capitalize"
                                      onClick={() =>
                                        setEvidence({
                                          name: `${j.role} worker`,
                                          kind: "report",
                                          content: `Job: ${j.id}\nRole: ${j.role}\nStatus: ${j.status}\nCandidate: ${j.head || "Not recorded"}\nStarted: ${j.started_at}\nFinished: ${j.finished_at || "In progress"}\n\n${j.output || "Waiting for worker result."}`,
                                        })
                                      }
                                    >
                                      {j.role}
                                    </button>
                                    <small className="mono">
                                      {short(j.id)}
                                    </small>
                                  </td>
                                  <td>
                                    {issues.find((i) => i.id === j.issue_id)
                                      ?.key || "Release"}
                                  </td>
                                  <td>
                                    <Badge status={j.status} />
                                  </td>
                                  <td className="mono">{short(j.head)}</td>
                                  <td>{date(j.started_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}
                  {tab === "evidence" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Validation & review evidence</h2>
                          <p>
                            Independent evaluations, project checks, and change
                            summaries.
                          </p>
                        </div>
                        <span className="subtle">
                          {data.artifacts.length} artifacts
                        </span>
                      </div>
                      {!data.artifacts.length ? (
                        <Empty
                          icon={FileCheck2}
                          title="Evidence follows execution"
                        >
                          Reports appear here as workers complete assignments.
                        </Empty>
                      ) : (
                        <div className="evidence-grid">
                          {data.artifacts.map((a) => (
                            <button
                              className="evidence-card"
                              key={a.id}
                              onClick={() =>
                                void bridge
                                  .artifact(a.id)
                                  .then(setEvidence)
                                  .catch((e) => setError(e.message))
                              }
                            >
                              <div className="evidence-icon">
                                <FileCheck2 size={21} />
                              </div>
                              <div>
                                <span className="eyebrow">{a.kind}</span>
                                <h3>{a.name}</h3>
                                <p>
                                  {issues.find((i) => i.id === a.issue_id)
                                    ?.key || "Release"}{" "}
                                  · {date(a.created_at)}
                                </p>
                              </div>
                              <ArrowRight size={17} />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab === "decisions" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Your decision inbox</h2>
                          <p>
                            Escalated work remains parked until you resolve it.
                          </p>
                        </div>
                        <Badge
                          status={
                            decisions.length ? "needs_human" : "completed"
                          }
                        />
                      </div>
                      {!decisions.length ? (
                        <Empty
                          icon={CheckCircle2}
                          title="Nothing needs your attention"
                        >
                          The factory will bring questions and exhausted retries
                          here.
                        </Empty>
                      ) : (
                        <div className="decision-list">
                          {decisions.map((i) => (
                            <Decision
                              key={i.id}
                              issue={i}
                              busy={busy}
                              onResolve={async (decision, note) => {
                                await act({
                                  action: "resolve",
                                  issueId: i.id,
                                  revision: i.revision,
                                  decision,
                                  note,
                                });
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {tab === "activity" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Factory activity</h2>
                          <p>Recent events are saved with the release.</p>
                        </div>
                        <button
                          disabled={
                            busy ||
                            ["completed", "cancelled"].includes(release.status)
                          }
                          onClick={() =>
                            void act({
                              action: "manager",
                              releaseId: release.id,
                            }).catch(() => {})
                          }
                        >
                          <Activity size={15} /> Manager report
                        </button>
                      </div>
                      <div className="timeline">
                        {[...data.events].reverse().map((e) => (
                          <div className="timeline-event" key={e.id}>
                            <span
                              className={`event-node ${e.kind.includes("fail") || e.kind.includes("escalat") ? "attention" : "progress-event"}`}
                            />
                            <div>
                              <span className="event-kind">
                                {e.kind.replaceAll(".", " / ")}
                              </span>
                              <p>
                                {e.detail.startsWith("{")
                                  ? "Manager assessed release progress, blocked dependencies, and repeated failures."
                                  : e.detail}
                              </p>
                            </div>
                            <time>{date(e.created_at)}</time>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Layers3 size={14} /> Built with intent. Delivered with evidence.
            </span>
            <span>Local state · Independent roles · Human judgment</span>
          </footer>
        </div>
      </main>
      {modal === "release" && data && (
        <ReleaseForm
          projects={data.projects}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (project, plan) => {
            const result = await act({
              action: "create_release",
              project,
              plan,
              requestId: crypto.randomUUID(),
            });
            const r = result.result ?? result;
            setModal(null);
            setTab("plan");
            selectRelease(r.id);
          }}
        />
      )}
      {modal === "feedback" && release && (
        <FeedbackForm
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (issue, severity) => {
            await act({
              action: "feedback",
              releaseId: release.id,
              issue,
              severity,
              requestId: crypto.randomUUID(),
            });
            setModal(null);
          }}
        />
      )}
      {modal === "cancel" && release && (
        <Modal title="Cancel this release?" onClose={() => setModal(null)}>
          <p>
            Cancel <strong>{release.name}</strong>, stop active workers, and
            mark unfinished issues as cancelled. Git branches and existing pull
            requests remain available for inspection.
          </p>
          <div className="form-actions">
            <button onClick={() => setModal(null)}>Keep release</button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void act({ action: "cancel", releaseId: release.id })
                  .then(() => setModal(null))
                  .catch(() => {})
              }
            >
              Cancel release
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          <div className="detail-meta">
            <span className="mono">{detail.key}</span>
            <Badge
              status={
                issues.find((i) => i.id === detail.id)?.status ?? detail.status
              }
            />
            <span>{detail.complexity} route</span>
          </div>
          <p>{detail.body || "No additional description."}</p>
          <h3>Acceptance criteria</h3>
          <ul className="acceptance">
            {detail.acceptance.map((a, n) => (
              <li key={n}>
                <ListChecks size={16} />
                {a}
              </li>
            ))}
          </ul>
          {detail.feedback && <div className="notice">{detail.feedback}</div>}
          <dl>
            <dt>Dependencies</dt>
            <dd>{detail.depends_on.join(", ") || "None"}</dd>
            <dt>Build attempts</dt>
            <dd>{detail.tries} / 3</dd>
            <dt>Review send-backs</dt>
            <dd>{detail.sendbacks} / 2</dd>
            <dt>Commit</dt>
            <dd className="mono">{detail.head || "No candidate yet"}</dd>
            <dt>Branch</dt>
            <dd className="mono">
              {detail.branch || "Assigned when building"}
            </dd>
          </dl>
          {detail.status === "approved" && (
            <button
              className="primary"
              disabled={busy || !project?.github}
              onClick={() =>
                void act({
                  action: "merge",
                  issueId: detail.id,
                  revision: detail.revision,
                })
                  .then(() => setDetail(null))
                  .catch(() => {})
              }
            >
              <GitMerge size={16} /> Verify CI & merge
            </button>
          )}
        </Modal>
      )}
      {evidence && (
        <Modal title={evidence.name} onClose={() => setEvidence(undefined)}>
          <span className="eyebrow">{evidence.kind}</span>
          {evidence.kind === "screenshot" &&
          /^[A-Za-z0-9+/=\r\n]+$/.test(evidence.content) ? (
            <img
              className="artifact-image"
              src={`data:image/png;base64,${evidence.content}`}
              alt={evidence.name}
            />
          ) : (
            <pre className="artifact-content">{evidence.content}</pre>
          )}
        </Modal>
      )}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function Decision({
  issue,
  busy,
  onResolve,
}: {
  issue: Issue;
  busy: boolean;
  onResolve: (decision: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      className="decision-card"
      onSubmit={(e) => {
        e.preventDefault();
        void onResolve("retry", note).catch(() => {});
      }}
    >
      <div className="card-meta">
        <span>{issue.key}</span>
        <Badge status="needs_human" />
      </div>
      <h3>{issue.title}</h3>
      <p>{issue.feedback}</p>
      <label>
        Your decision
        <textarea
          required
          maxLength={8000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Clarify the requirement or describe what to try next…"
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          disabled={busy || !note.trim()}
          onClick={() => void onResolve("drop", note).catch(() => {})}
        >
          Drop issue
        </button>
        <button className="primary" disabled={busy}>
          <ArrowRight size={15} /> Retry with my answer
        </button>
      </div>
    </form>
  );
}
const newIssue = () => ({
  key: "",
  title: "",
  body: "",
  complexity: "simple",
  acceptance: "",
  depends_on: "",
});
function ReleaseForm({
  projects,
  busy,
  onClose,
  onSubmit,
}: {
  projects: any[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (project: string, plan: any) => Promise<void>;
}) {
  const [project, setProject] = useState(projects[0]?.id ?? ""),
    [name, setName] = useState(""),
    [goal, setGoal] = useState(""),
    [type, setType] = useState("brownfield"),
    [items, setItems] = useState([newIssue()]),
    [error, setError] = useState("");
  const update = (n: number, key: string, value: string) =>
    setItems(
      items.map((i, index) => (index === n ? { ...i, [key]: value } : i)),
    );
  return (
    <Modal title="Plan a new release" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          void onSubmit(project, {
            release: { name, goal, type },
            issues: items.map((i) => ({
              ...i,
              acceptance: i.acceptance
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              depends_on: i.depends_on
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })),
          }).catch((e) => setError(e.message));
        }}
      >
        {error && (
          <div role="alert" className="notice danger">
            {error}
          </div>
        )}
        <div className="form-grid">
          <label>
            Project
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Release type
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="brownfield">Small epic · existing project</option>
              <option value="greenfield">Proof of concept · new project</option>
            </select>
          </label>
        </div>
        <label>
          Release name
          <input
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Customer billing v1"
          />
        </label>
        <label>
          One-sentence outcome
          <textarea
            required
            maxLength={8000}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should a user be able to do when this ships?"
          />
        </label>
        <div className="form-section-title">
          <h3>Independently shippable issues</h3>
          <span>{items.length} / 50</span>
        </div>
        {items.map((i, n) => (
          <fieldset key={n}>
            <legend>Issue {String(n + 1).padStart(2, "0")}</legend>
            <div className="form-grid">
              <label>
                Key
                <input
                  required
                  pattern="[a-z][a-z0-9-]{0,59}"
                  value={i.key}
                  onChange={(e) => update(n, "key", e.target.value)}
                  placeholder="billing-api"
                />
              </label>
              <label>
                Route
                <select
                  value={i.complexity}
                  onChange={(e) => update(n, "complexity", e.target.value)}
                >
                  <option value="simple">Ship Simple</option>
                  <option value="complex">Ship · full pipeline</option>
                </select>
              </label>
            </div>
            <label>
              Title
              <input
                required
                maxLength={180}
                value={i.title}
                onChange={(e) => update(n, "title", e.target.value)}
              />
            </label>
            <label>
              Acceptance criteria · one per line
              <textarea
                required
                value={i.acceptance}
                onChange={(e) => update(n, "acceptance", e.target.value)}
                placeholder="Observable outcomes the builder can verify"
              />
            </label>
            <label>
              Depends on · comma-separated keys
              <input
                value={i.depends_on}
                onChange={(e) => update(n, "depends_on", e.target.value)}
                placeholder="Leave blank to start independently"
              />
            </label>
            {items.length > 1 && (
              <button
                type="button"
                className="muted-button"
                onClick={() =>
                  setItems(items.filter((_, index) => n !== index))
                }
              >
                <Trash2 size={14} /> Remove issue
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={items.length >= 50}
          onClick={() => setItems([...items, newIssue()])}
        >
          <Plus size={15} /> Add issue
        </button>
        <div className="inline-hint">
          <ShieldCheck size={17} /> Write private evaluation scenarios before
          starting the factory. Keep their contents out of issue text.
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Layers3 size={16} />
            )}{" "}
            Create release
          </button>
        </div>
      </form>
    </Modal>
  );
}
function FeedbackForm({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (issue: any, severity: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [acceptance, setAcceptance] = useState(""),
    [severity, setSeverity] = useState("bug"),
    [error, setError] = useState("");
  return (
    <Modal title="Feed it back into the factory" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit(
            {
              key: `feedback-${crypto.randomUUID().slice(0, 8)}`,
              title,
              body,
              complexity: "simple",
              acceptance: acceptance.split("\n").filter(Boolean),
              depends_on: [],
            },
            severity,
          ).catch((e) => setError(e.message));
        }}
      >
        {error && (
          <div className="notice danger" role="alert">
            {error}
          </div>
        )}
        <label>
          What went wrong?
          <input
            required
            maxLength={180}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Reproduction and context
          <textarea
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label>
          Expected behavior · one criterion per line
          <textarea
            required
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
          />
        </label>
        <label>
          Severity
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="bug">Bug</option>
            <option value="regression">Regression · priority queue</option>
            <option value="polish">Polish</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Create feedback issue <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
