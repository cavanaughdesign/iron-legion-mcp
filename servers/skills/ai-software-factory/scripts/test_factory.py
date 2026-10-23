#!/usr/bin/env python3
"""End-to-end tests for factory.py (offline mode, stdlib only).

Run:  python3 scripts/test_factory.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

FACTORY = str(Path(__file__).resolve().parent / "factory.py")

PLAN = {
    "release": {"name": "v0.2 Invoicing", "type": "brownfield", "goal": "Customers can pay invoices online"},
    "issues": [
        {"key": "schema", "title": "Add invoice tables", "complexity": "complex",
         "acceptance": ["migration applies cleanly", "rollback works"]},
        {"key": "api", "title": "Invoice REST endpoints", "complexity": "complex",
         "depends_on": ["schema"], "acceptance": ["CRUD works", "auth enforced"]},
        {"key": "copy", "title": "Fix typo on pricing page", "complexity": "simple",
         "acceptance": ["typo gone"]},
        {"key": "ui", "title": "Invoice list page", "complexity": "complex",
         "depends_on": ["api"], "acceptance": ["lists invoices", "empty state shown"]},
    ],
}


class FactoryCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "repo"
        self.dir.mkdir()
        self.hold = Path(self.tmp.name) / "holdouts"
        self.env = {**os.environ, "HOME": self.tmp.name}
        self.env.pop("FACTORY_HOME", None)
        subprocess.run(["git", "init", "-q"], cwd=self.dir, check=True)
        self.run_f("init", "--offline")
        self.plan_path = self.dir / "plan.json"
        self.plan_path.write_text(json.dumps(PLAN))

    def tearDown(self):
        self.tmp.cleanup()

    def run_f(self, *args, expect=0):
        proc = subprocess.run([sys.executable, FACTORY, *args], cwd=self.dir, env=self.env,
                              capture_output=True, text=True)
        self.assertEqual(proc.returncode, expect,
                         f"args={args} rc={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}")
        out = proc.stdout.strip() or proc.stderr.strip()
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return out

    def split(self):
        return self.run_f("split", str(self.plan_path))

    def num(self, key):
        st = json.loads((self.dir / ".factory" / "state.json").read_text())
        return next(i["number"] for i in st["issues"].values() if i["key"] == key)

    def to_review(self, key):
        n = self.num(key)
        self.run_f("submit", str(n), "--pr", str(n + 5000))
        self.run_f("validate", str(n), "--result", "pass")
        return n


class TestPlan(FactoryCase):
    def test_waves_show_parallelism(self):
        out = self.run_f("validate-plan", str(self.plan_path))
        self.assertTrue(out["valid"])
        self.assertEqual(out["waves"][0]["parallel_issues"], ["copy", "schema"])
        self.assertEqual(out["waves"][1]["parallel_issues"], ["api"])

    def test_cycle_rejected(self):
        bad = json.loads(json.dumps(PLAN))
        bad["issues"][0]["depends_on"] = ["ui"]
        self.plan_path.write_text(json.dumps(bad))
        out = self.run_f("validate-plan", str(self.plan_path), expect=2)
        self.assertFalse(out["valid"])
        self.assertTrue(any("cycle" in e for e in out["errors"]))

    def test_unknown_dep_and_bad_type(self):
        bad = json.loads(json.dumps(PLAN))
        bad["issues"][1]["depends_on"] = ["nope"]
        bad["release"]["type"] = "yolo"
        self.plan_path.write_text(json.dumps(bad))
        out = self.run_f("validate-plan", str(self.plan_path), expect=2)
        self.assertGreaterEqual(len(out["errors"]), 2)

    def test_holdout_mention_warns(self):
        bad = json.loads(json.dumps(PLAN))
        bad["issues"][2]["body"] = "see the holdout scenarios"
        self.plan_path.write_text(json.dumps(bad))
        out = self.run_f("validate-plan", str(self.plan_path))
        self.assertTrue(any("holdout" in w for w in out["warnings"]))

    def test_split_is_idempotent_and_dry_run_is_pure(self):
        dry = self.run_f("split", str(self.plan_path), "--dry-run")
        self.assertTrue(dry["dry_run"])
        first = self.split()
        self.assertEqual(len(first["created"]), 4)
        second = self.split()
        self.assertEqual(second["created"], [])
        self.assertEqual(len(second["skipped_existing"]), 4)


class TestPick(FactoryCase):
    def test_pick_respects_dependencies_and_one_issue(self):
        self.split()
        a = self.run_f("pick", "--agent", "lap-1")
        b = self.run_f("pick", "--agent", "lap-2")
        self.assertEqual({a["key"], b["key"]}, {"schema", "copy"})
        self.assertNotEqual(a["number"], b["number"])
        self.run_f("pick", "--agent", "lap-3", expect=10)   # api blocked until schema merges

    def test_route_by_complexity(self):
        self.split()
        got = {}
        for lap in ("a", "b"):
            r = self.run_f("pick", "--agent", lap)
            got[r["key"]] = r["route"]
        self.assertEqual(got["copy"], "ship-simple")
        self.assertEqual(got["schema"], "ship")

    def test_concurrent_picks_never_double_claim(self):
        many = {"release": PLAN["release"], "issues": [
            {"key": f"t{i}", "title": f"Task {i}", "complexity": "simple", "acceptance": ["done"]} for i in range(8)]}
        self.plan_path.write_text(json.dumps(many))
        self.split()
        claimed, lock = [], threading.Lock()

        def worker(n):
            proc = subprocess.run([sys.executable, FACTORY, "pick", "--agent", f"lap-{n}"], cwd=self.dir,
                                  env=self.env, capture_output=True, text=True)
            if proc.returncode == 0:
                with lock:
                    claimed.append(json.loads(proc.stdout)["number"])

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(len(claimed), 8)
        self.assertEqual(len(set(claimed)), 8)


class TestHardRules(FactoryCase):
    def test_three_tries_then_ask_me(self):
        self.split()
        n = self.num("copy")
        for attempt in (1, 2):
            r = self.run_f("pick", "--agent", "x", "--complexity", "simple")
            self.assertEqual((r["number"], r["attempt"]), (n, attempt))
            out = self.run_f("fail", str(n), "--note", f"boom {attempt}")
            self.assertEqual(out["status"], "ready")
        r = self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.assertEqual(r["tries_left"], 0)
        out = self.run_f("fail", str(n), "--note", "boom 3", expect=3)
        self.assertTrue(out["escalated"])
        self.assertIn("3 tries", out["rule"])
        self.assertTrue(Path(out["escalation_file"]).exists())
        self.run_f("pick", "--agent", "x", "--complexity", "simple", expect=10)   # never handed out again

    def test_validation_failure_counts_as_a_try(self):
        self.split()
        n = self.num("copy")
        for i in range(3):
            self.run_f("pick", "--agent", "x", "--complexity", "simple")
            self.run_f("submit", str(n), "--pr", "9")
            expect = 0 if i < 2 else 3
            self.run_f("validate", str(n), "--result", "fail", "--note", f"broke {i}", expect=expect)

    def test_validation_fail_requires_note(self):
        self.split()
        n = self.num("copy")
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.run_f("submit", str(n), "--pr", "9")
        self.run_f("validate", str(n), "--result", "fail", expect=2)

    def test_two_sendbacks_max(self):
        self.split()
        n = self.num("copy")
        for round_no in (1, 2):
            self.run_f("pick", "--agent", "x", "--complexity", "simple")
            self.to_review_pr(n)
            out = self.run_f("review", str(n), "--verdict", "send-back", "--note", f"fix {round_no}")
            self.assertEqual(out["sendbacks"], round_no)
            self.assertEqual(out["status"], "ready")
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.to_review_pr(n)
        out = self.run_f("review", str(n), "--verdict", "send-back", "--note", "still wrong", expect=3)
        self.assertTrue(out["escalated"])
        self.assertIn("2 send-backs", out["rule"])

    def to_review_pr(self, n):
        self.run_f("submit", str(n), "--pr", str(n + 1))
        self.run_f("validate", str(n), "--result", "pass")

    def test_sendback_gets_priority_and_feedback(self):
        self.split()
        n = self.num("copy")
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.to_review_pr(n)
        self.run_f("review", str(n), "--verdict", "send-back", "--note", "handle empty input")
        r = self.run_f("pick", "--agent", "y")
        self.assertEqual(r["number"], n)
        self.assertEqual(r["feedback_from_previous_lap"], "handle empty input")

    def test_merge_requires_ci_green_and_approval(self):
        self.split()
        n = self.num("copy")
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.run_f("merge", str(n), "--ci", "green", "--no-gh-merge", expect=3)    # not approved yet
        self.to_review_pr(n)
        self.run_f("review", str(n), "--verdict", "merge-ready")
        red = self.run_f("merge", str(n), "--ci", "red", expect=3)
        self.assertEqual(red["rule"], "MERGE: CI green")
        auto = self.run_f("merge", str(n), "--ci", "auto", expect=3)               # offline cannot verify
        self.assertIn("offline", auto["detail"])
        ok = self.run_f("merge", str(n), "--ci", "green", "--no-gh-merge")
        self.assertTrue(ok["merged"])

    def test_merge_unblocks_dependents(self):
        self.split()
        n = self.num("schema")
        self.run_f("pick", "--agent", "x", "--complexity", "complex")
        self.to_review_pr(n)
        self.run_f("review", str(n), "--verdict", "merge-ready")
        out = self.run_f("merge", str(n), "--ci", "green", "--no-gh-merge")
        self.assertEqual(out["dependents_unblocked"], 1)
        nxt = self.run_f("pick", "--agent", "y", "--complexity", "complex")
        self.assertEqual(nxt["key"], "api")

    def test_resolve_retry_resets_counters(self):
        self.split()
        n = self.num("copy")
        for _ in range(3):
            self.run_f("pick", "--agent", "x", "--complexity", "simple")
            self.run_f("fail", str(n), "--note", "no", expect=0 if _ < 2 else 3)
        self.run_f("resolve", str(n), "--action", "retry", "--note", "clarified acceptance criteria")
        r = self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.assertEqual(r["attempt"], 1)

    def test_drop_blocks_dependents_unless_unblocked(self):
        self.split()
        n = self.num("schema")
        for _ in range(3):
            self.run_f("pick", "--agent", "x", "--complexity", "complex")
            self.run_f("fail", str(n), "--note", "no", expect=0 if _ < 2 else 3)
        self.run_f("resolve", str(n), "--action", "drop", "--note", "descoped")
        self.run_f("pick", "--agent", "x", "--complexity", "complex", expect=10)    # api still blocked
        rep = self.run_f("manager-report")
        self.assertTrue(rep["blocked_backlog"])


class TestAsk(FactoryCase):
    def test_question_parks_issue_without_burning_a_try(self):
        self.split()
        n = self.num("copy")
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        out = self.run_f("ask", str(n), "--question", "Should refunds be partial or full?", expect=3)
        self.assertTrue(out["escalated"])
        self.assertTrue(out["rule"].startswith("ASK"))
        self.run_f("pick", "--agent", "x", "--complexity", "simple", expect=10)      # parked
        self.run_f("resolve", str(n), "--action", "retry", "--note", "Full refunds only")
        r = self.run_f("pick", "--agent", "x", "--complexity", "simple")
        self.assertEqual(r["attempt"], 1)
        self.assertEqual(r["feedback_from_previous_lap"], "Full refunds only")


class TestFeedbackAndManager(FactoryCase):
    def test_feedback_reenters_factory(self):
        self.split()
        out = self.run_f("feedback", "--title", "Total wrong on staging", "--body", "Tax doubled",
                         "--acceptance", "tax applied once", "--severity", "regression")
        self.assertTrue(out["created"])
        r = self.run_f("pick", "--agent", "x")
        self.assertEqual(r["number"], out["number"])      # regression is boosted

    def test_manager_report_flags_stuck_and_saves_new_file(self):
        self.split()
        self.run_f("pick", "--agent", "x", "--complexity", "simple")
        rep = self.run_f("manager-report", "--stale-minutes", "-1")
        self.assertEqual(len(rep["stuck_claims"]), 1)
        self.assertTrue(Path(rep["saved_to"]).exists())
        swept = self.run_f("sweep", "--minutes", "-1")
        self.assertEqual(len(swept["swept"]), 1)

    def test_status_text_and_json(self):
        self.split()
        self.assertIn("Release: v0.2 Invoicing", self.run_f("status"))
        self.assertEqual(self.run_f("status", "--json")["counts"]["ready"], 2)


class TestHoldouts(FactoryCase):
    def test_must_live_outside_repo(self):
        self.run_f("holdouts", "init", "--path", str(self.dir / "tests" / "holdouts"), expect=2)

    def test_lifecycle_and_leak_detection(self):
        self.run_f("holdouts", "init", "--path", str(self.hold))
        self.run_f("holdouts", "new", "--id", "HS-001", "--title", "Customer pays invoice with expired card")
        self.run_f("holdouts", "new", "--id", "HS-001", "--title", "dup", expect=2)     # never overwrite
        listing = self.run_f("holdouts", "list")
        self.assertEqual(listing["scenarios"][0]["id"], "HS-001")
        self.assertTrue(self.run_f("holdouts", "check")["ok"])
        self.assertFalse(self.run_f("holdouts", "leak-scan")["leaked"])
        (self.dir / "src").mkdir()
        (self.dir / "src" / "cheat.py").write_text("# handles customer pays invoice with expired card\n")
        leak = self.run_f("holdouts", "leak-scan", expect=3)
        self.assertTrue(leak["leaked"])
        self.assertEqual(leak["hits"][0]["file"], "src/cheat.py")


class TestInit(FactoryCase):
    def test_init_never_overwrites(self):
        out = self.run_f("init", "--offline")
        self.assertFalse(out["initialised"])
        self.assertIn(".factory/", (self.dir / ".gitignore").read_text())


if __name__ == "__main__":
    unittest.main()
