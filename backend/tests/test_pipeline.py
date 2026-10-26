"""End-to-end pipeline test against a fake GitHub client (no network)."""
import json
import os
import subprocess
import sys

import pytest

from backend import analyzer, cache, config, service
from backend.github_client import GitHubClient, GitHubRateLimited
from backend.graph_engine import build_view
from backend.rag_pipeline import RAGPipeline
from backend.tree_sitter_analyzer import TreeSitterAnalyzer, attribute_from_blame
from backend.xai import build_summary, contributor_profile

PY_SRC = '''import os

class Router:
    def route(self, rule, **options):
        """Register a rule."""
        if rule and options:
            for k in options:
                if k == "x" or k == "y":
                    pass
        return rule

    async def dispatch(self, req):
        return req

def helper(a, b=2):
    return a + b
'''
JS_SRC = '''const add = (a, b) => a + b;
export function mul(a, b) { if (a && b) { return a * b; } return 0; }
class Box { open(x) { return x ? 1 : 2; } }
'''


class Fake(GitHubClient):
    def __init__(self, token=None, blame=True):
        super().__init__(token)
        self.blame = blame

    def rate_limit(self):
        return None

    def get_repo(self, o, r):
        return {"owner": o, "name": r, "full_name": f"{o}/{r}", "description": "demo", "stars": 5, "forks": 1,
                "language": "Python", "default_branch": "main", "html_url": f"https://github.com/{o}/{r}", "archived": False}

    def get_commits(self, o, r, limit=60):
        def c(i, a, msg, merge=False):
            return {"sha": f"{i:040x}", "short": f"{i:07x}", "message": msg, "author": a, "author_name": a,
                    "author_is_bot": a == "dependabot[bot]", "date": f"2026-09-{i:02d}",
                    "url": f"https://github.com/{o}/{r}/commit/{i:040x}", "is_merge": merge}
        return [c(9, "alice", "feat: routing"), c(8, "bob", "fix: dispatch"), c(7, "alice", "refactor router"),
                c(6, None, "unlinked author"), c(5, "dependabot[bot]", "bump deps"), c(4, "carol", "docs"),
                c(3, "bob", "merge", merge=True)]

    def get_contributors(self, o, r, limit=40):
        mk = lambda l, n: {"login": l, "contributions": n, "avatar_url": "", "profile_url": f"https://github.com/{l}", "is_bot": False}
        return [mk("alice", 120), mk("bob", 60), mk("carol", 9), mk("zed", 3)]

    def get_pulls(self, o, r, limit=30):
        return [{"id": 11, "title": "Router rewrite", "author": "alice", "author_is_bot": False, "state": "merged",
                 "pr_url": f"https://github.com/{o}/{r}/pull/11", "created": "2026-09-01", "body": "rewrites router"},
                {"id": 12, "title": "Docs", "author": "carol", "author_is_bot": False, "state": "open",
                 "pr_url": f"https://github.com/{o}/{r}/pull/12", "created": "2026-09-02", "body": ""}]

    def get_pr_reviews(self, o, r, n):
        return {11: [{"reviewer": "bob", "reviewer_is_bot": False, "state": "APPROVED"},
                     {"reviewer": "alice", "reviewer_is_bot": False, "state": "COMMENTED"}],
                12: [{"reviewer": "alice", "reviewer_is_bot": False, "state": "APPROVED"}]}[n]

    def get_tree(self, o, r, ref):
        return [{"path": "src/router.py", "size": len(PY_SRC)}, {"path": "web/box.js", "size": len(JS_SRC)},
                {"path": "docs/index.md", "size": 10}, {"path": "node_modules/x/y.js", "size": 50}], False

    def get_commit_files(self, o, r, sha):
        i = int(sha, 16)
        return {9: [("src/router.py", 30, 2)], 8: [("src/router.py", 5, 1), ("web/box.js", 4, 0)],
                7: [("src/router.py", 10, 10)], 4: [("docs/index.md", 3, 0)]}.get(i, []) and \
            [{"path": p, "additions": a, "deletions": d} for p, a, d in
             {9: [("src/router.py", 30, 2)], 8: [("src/router.py", 5, 1), ("web/box.js", 4, 0)],
              7: [("src/router.py", 10, 10)], 4: [("docs/index.md", 3, 0)]}[i]]

    def get_raw_file(self, o, r, ref, path, max_bytes=0):
        return {"src/router.py": PY_SRC, "web/box.js": JS_SRC}.get(path)

    def get_blame(self, o, r, oid, path):
        if not self.blame:
            raise AssertionError("blame must not be called without a token")
        if path == "src/router.py":  # route(): lines 4-11 -> alice 5 lines, bob 3 lines
            return [{"start": 1, "end": 3, "author": "alice", "author_name": "a"},
                    {"start": 4, "end": 8, "author": "alice", "author_name": "a"},
                    {"start": 9, "end": 11, "author": "bob", "author_name": "b"},
                    {"start": 12, "end": 20, "author": None, "author_name": "ghost"}]
        return [{"start": 1, "end": 3, "author": "bob", "author_name": "b"}]


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EQUINOX_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("EQUINOX_USE_CHROMA", "0")
    analyzer._MEMORY.clear()


def state(token=True):
    return analyzer.analyze_repository("https://github.com/Acme/Demo.git", refresh=True,
                                       client=Fake("tok" if token else None, blame=token))


def test_parse_repo_url():
    p = GitHubClient.parse_repo_url
    assert p("pallets/flask") == ("pallets", "flask")
    assert p("https://github.com/foo/foo.github.io.git") == ("foo", "foo.github.io")
    assert p("git@github.com:a/b.git") == ("a", "b")
    assert p("github.com/a/b/tree/main") == ("a", "b")
    for bad in ("", "flask", "a/b c", "a/..", "https://github.com/onlyowner"):
        with pytest.raises(ValueError):
            p(bad)


def test_tree_sitter_functions():
    ts = TreeSitterAnalyzer()
    fns = {f["name"]: f for f in ts.analyze_source(PY_SRC, "a.py")}
    assert set(fns) == {"Router.route", "Router.dispatch", "helper"}
    assert fns["Router.route"]["start_line"] == 4 and fns["Router.route"]["end_line"] == 10
    assert fns["Router.route"]["cyclomatic_complexity"] == 6 and fns["Router.route"]["is_method"]
    assert fns["helper"]["parameters"] == ["a", "b"]
    js = {f["name"] for f in ts.analyze_source(JS_SRC, "b.js")}
    assert {"add", "mul", "Box.open"} <= js


def test_blame_attribution_exact():
    ts = TreeSitterAnalyzer()
    fns = [f for f in ts.analyze_source(PY_SRC, "a.py") if f["name"] == "Router.route"]
    out = attribute_from_blame(fns, [{"start": 1, "end": 8, "author": "alice"}, {"start": 9, "end": 11, "author": "bob"}])[0]
    assert out["primary_owner"] == "alice" and out["primary_ownership_pct"] == 71.4  # 5 of the 7 lines (4-10)
    assert [o["contributor"] for o in out["ownership_breakdown"]] == ["alice", "bob"]


def test_full_state_with_token():
    s = state(True)
    ids = {c["id"] for c in s["contributors"]}
    assert ids == {"alice", "bob", "carol", "zed"}          # bot and unlinked author excluded
    assert s["data_source"]["blame_used"] and s["data_source"]["token_used"]
    assert any("not linked" in w for w in s["data_source"]["warnings"])
    e = {frozenset((x["source"], x["target"])): x for x in s["edges"]}
    ab = e[frozenset(("alice", "bob"))]
    assert ab["co_edits"] == 1 and ab["pr_reviews"] == 1 and ab["function_co_ownership"] >= 1
    assert all(x["source"] in ids and x["target"] in ids for x in s["edges"])
    assert max(x["weight"] for x in s["edges"]) == 10
    route = next(f for f in s["ast_functions"] if f["name"] == "Router.route")
    assert route["primary_owner"] == "alice" and route["ownership_basis"] == "blame"
    assert route["github_url"].endswith(f"/blob/{9:040x}/src/router.py#L4")
    assert all(f["path"] != "node_modules/x/y.js" for f in s["files"])


def test_no_token_never_calls_blame_and_labels_basis():
    s = state(False)
    assert not s["data_source"]["blame_used"]
    route = next(f for f in s["ast_functions"] if f["name"] == "Router.route")
    assert route["ownership_basis"] == "file-commits" and route["primary_owner"] == "alice"
    assert any("no GITHUB_TOKEN" in w for w in s["data_source"]["warnings"])
    assert "file-level" in build_summary(contributor_profile(s, "alice"))


def test_views_by_depth():
    s = state(True)
    sizes = []
    for d in range(1, 6):
        v = build_view(s, d)
        ids = {n["id"] for n in v["nodes"]}
        assert len(ids) == len(v["nodes"]), "node ids must be unique"
        assert all(e["source"] in ids and e["target"] in ids for e in v["edges"])
        sizes.append(len(v["nodes"]))
        types = {n["type"] for n in v["nodes"]}
        assert ("file" in types) == (d >= 3) and ("ast_function" in types) == (d >= 4)
    assert sizes == sorted(sizes)
    v5 = build_view(s, 5)
    assert any(e["type"] == "contains" for e in v5["edges"])


def test_xai_two_line_evidence_based():
    s = state(True)
    txt = build_summary(contributor_profile(s, "alice"))
    l1, l2 = txt.split("\n")
    assert "2 of the last 7 commits" in l1 and "src/" in l1 and "feat: routing" in l1
    assert "Router.route()" in l2 and "71%" in l2 and "git blame" in l2 and "reviewed 1 sampled PR, most for carol" in l2
    zed = build_summary(contributor_profile(s, "zed")).split("\n")
    assert len(zed) == 2 and "3 commits overall" in zed[0] and "none among the last 7" in zed[0]
    with pytest.raises(ValueError):
        contributor_profile(s, "nobody")


def test_rag_relevance_and_focus():
    s = state(True)
    rag = RAGPipeline("acme/demo").ingest(s)
    docs = rag.retrieve("who wrote the router dispatch function", top_k=3)
    assert docs and any("dispatch" in d["text"].lower() for d in docs)
    assert rag.retrieve("zzzz qqqq unrelated") == []                     # no irrelevant fallback
    only_bob = rag.retrieve("router", top_k=10, focus="bob")
    assert only_bob and all("bob" in d["people"] for d in only_bob)
    assert any(d["citation"].startswith("[AST:") for d in rag.retrieve("Router.route owners", 5))


def test_cache_roundtrip_and_token_upgrade():
    s = state(False)
    cache.save("acme/demo", s)
    analyzer._MEMORY.clear()
    # same request served from disk without touching the client
    class Boom(Fake):
        def get_repo(self, *a):
            raise AssertionError("should have been cached")
    assert analyzer.analyze_repository("acme/demo", client=Boom(None, blame=False))["repo_name"] == "Acme/Demo"
    # a token now exists but cached data had no blame -> recompute
    with pytest.raises(AssertionError):
        analyzer.analyze_repository("acme/demo", client=Boom("tok"))


def test_rate_limit_guard():
    class Low(Fake):
        def rate_limit(self):
            return {"remaining": 2, "limit": 60, "reset": 1_900_000_000}
    with pytest.raises(GitHubRateLimited):
        analyzer.analyze_repository("a/b", refresh=True, client=Low())


def test_cli_errors_are_json():
    env = {**os.environ, "EQUINOX_CACHE_DIR": "/tmp/eq-cli-test"}
    for argv, kind in ((["analyze", "--repo", "notarepo"], "invalid"), (["analyze", "--repo", "a/b", "--depth", "9"], "invalid")):
        p = subprocess.run([sys.executable, "backend/cli.py", *argv], capture_output=True, text=True, env=env)
        out = json.loads(p.stdout)
        assert p.returncode == 2 and out["status"] == "error" and out["kind"] == kind


def test_payloads_shape(monkeypatch):
    s = state(True)
    monkeypatch.setattr(service, "analyze_repository", lambda *a, **k: s)
    a = service.analyze_payload("acme/demo", 4)
    json.dumps(a)  # must be serialisable
    assert a["nodes"] and a["data_source"]["token_used"]
    r = service.rag_payload("acme/demo", "who owns route", "alice")
    assert r["citations"] and r["retriever"] == "tfidf"
    x = service.xai_payload("acme/demo", "bob")
    assert x["xai_summary"].count("\n") == 1
    json.dumps(service.pdf_payload("acme/demo"))


def test_fastapi_routes(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import app
    s = state(True)
    monkeypatch.setattr(service, "analyze_repository", lambda *a, **k: s)
    c = TestClient(app)
    r = c.post("/api/analyze-repo", json={"repoUrl": "acme/demo", "depth": 3}).json()
    assert r["success"] and r["data"]["nodes"]
    assert c.post("/api/analyze-repo", json={"repoUrl": "acme/demo", "depth": 9}).status_code == 400
    x = c.post("/api/xai-summary", json={"repoName": "acme/demo", "contributorId": "alice"}).json()
    assert x["summary"].count("\n") == 1 and x["evidence"]["id"] == "alice"
    assert c.post("/api/xai-summary", json={"repoName": "acme/demo", "contributorId": "ghost"}).status_code == 400
    g = c.post("/api/rag-query", json={"repoName": "acme/demo", "query": "router dispatch"}).json()
    assert g["citations"] and "answer" in g
    assert c.post("/api/export-pdf-data", json={"repoName": "acme/demo"}).json()["success"]


def test_cli_success_path(monkeypatch, capsys):
    from backend import cli
    s = state(True)
    monkeypatch.setattr(service, "analyze_repository", lambda *a, **k: s)
    assert cli.main(["analyze", "--repo", "acme/demo", "--depth", "4"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "success" and out["depth"] == 4
    assert cli.main(["xai", "--repo", "acme/demo", "--contributor", "nobody"]) == 2
    assert json.loads(capsys.readouterr().out)["kind"] == "invalid"
