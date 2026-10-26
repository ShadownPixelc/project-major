"""Equinox - live repository analysis.

Pipeline: GitHub REST (repo, contributors, commits, PRs, tree) -> per-commit file
lists -> PR reviews -> raw source + Tree-sitter -> git blame (token) -> NetworkX.
Every number in the resulting state is derived from GitHub; if something cannot be
fetched it is omitted and listed in `data_source.warnings`.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend import cache, config
from backend.github_client import GitHubClient, GitHubError, GitHubRateLimited
from backend.graph_engine import ContributorGraphEngine
from backend.tree_sitter_analyzer import (TreeSitterAnalyzer, attribute_from_blame, attribute_from_file_history,
                                          language_for_path, language_label)
from backend.xai import _area

_MEMORY: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_SKIP_DIRS = {"node_modules", "vendor", "vendors", "third_party", "dist", "build", "target", "site-packages",
              "__pycache__", "migrations", "docs_src", "examples"}
_SKIP_PAT = re.compile(r"(\.min\.|\.d\.ts$|_pb2\.py$|\.generated\.|\.bundle\.)")
_TEST_PAT = re.compile(r"(^|/)(tests?|__tests__|spec)(/|$)|(_test|\.test|\.spec)\.")


def _is_candidate(path: str, size: int, max_bytes: int) -> bool:
    if not language_for_path(path) or size > max_bytes or size == 0 or _SKIP_PAT.search(path):
        return False
    return not any(part in _SKIP_DIRS for part in path.split("/")[:-1])


def _soft(fut, label: str, warnings: List[str], default):
    try:
        return fut.result()
    except GitHubError as e:
        warnings.append(f"{label}: {e}")
        return default


def _plan(rl: Optional[Dict[str, int]], want: Dict[str, int]) -> Dict[str, int]:
    """Shrink optional request budgets so we never burn the remaining quota."""
    if not rl:
        return dict(want)
    spare = max(0, rl["remaining"] - 8)  # ~5 mandatory calls + safety margin
    need = sum(want.values())
    scale = min(1.0, spare / need) if need else 1.0
    return {k: int(v * scale) for k, v in want.items()}


def analyze_repository(repo_input: str, *, refresh: bool = False, client: Optional[GitHubClient] = None,
                       analyzer: Optional[TreeSitterAnalyzer] = None) -> Dict[str, Any]:
    owner, repo = GitHubClient.parse_repo_url(repo_input)
    token = config.github_token() if client is None else client.token
    key = f"{owner}/{repo}".lower()
    ttl = config.cache_ttl()

    if not refresh:
        mem = _MEMORY.get(key)
        hit = mem[1] if mem and time.time() - mem[0] < ttl else cache.load(key, ttl)
        if hit and not (token and not hit["data_source"].get("token_used")):
            _MEMORY[key] = (time.time(), hit)
            return hit

    state = _build_state(owner, repo, client or GitHubClient(token), analyzer or TreeSitterAnalyzer(), bool(token))
    _MEMORY[key] = (time.time(), state)
    cache.save(key, state)
    return state


def _build_state(owner: str, repo: str, client: GitHubClient, ts: TreeSitterAnalyzer, has_token: bool) -> Dict[str, Any]:
    lim = config.limits(has_token)
    warnings: List[str] = []

    rl = client.rate_limit()
    if rl is not None and rl["remaining"] < 8:
        when = datetime.fromtimestamp(rl["reset"], timezone.utc).strftime("%H:%M UTC")
        raise GitHubRateLimited(
            f"GitHub API quota is nearly exhausted ({rl['remaining']}/{rl['limit']} left, resets {when}). "
            "Set GITHUB_TOKEN to raise the limit to 5000 requests/hour.", 403, rl["reset"])
    plan = _plan(rl, {"details": lim.commit_details, "reviews": lim.pr_reviews})

    overview = client.get_repo(owner, repo)
    owner, repo, branch = overview["owner"], overview["name"], overview["default_branch"]
    repo_url = overview["html_url"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        f_commits = pool.submit(client.get_commits, owner, repo, lim.commit_window)
        f_contrib = pool.submit(client.get_contributors, owner, repo, 40)
        f_pulls = pool.submit(client.get_pulls, owner, repo, lim.pull_requests)
        f_tree = pool.submit(client.get_tree, owner, repo, branch)
        commits = f_commits.result()  # fatal if it fails (rate limit / empty repo)
        contribs = _soft(f_contrib, "contributors", warnings, [])
        pulls = _soft(f_pulls, "pull requests", warnings, [])
        blobs, truncated = _soft(f_tree, "file tree", warnings, ([], False))
    if not commits:
        raise GitHubError("This repository has no commits.")
    if truncated:
        warnings.append("file tree was truncated by GitHub (very large repository)")
    head = commits[0]["sha"]
    bots_ok = config.include_bots()

    # ---- per-commit file lists (real co-editing evidence)
    targets = [c for c in commits if not c["is_merge"] and c["author"] and (bots_ok or not c["author_is_bot"])]
    targets = targets[:plan["details"]]

    def detail(c):
        try:
            return c["sha"], client.get_commit_files(owner, repo, c["sha"])
        except GitHubError as e:
            return c["sha"], e

    details: Dict[str, Any] = {}
    if targets:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for sha, res in pool.map(detail, targets):
                details[sha] = res
    failed = [r for r in details.values() if isinstance(r, GitHubError)]
    if failed:
        warnings.append(f"{len(failed)} commit detail request(s) failed: {failed[0]}")

    file_stats: Dict[str, Dict[str, Any]] = {}
    bulk = 0
    for c in commits:
        res = details.get(c["sha"])
        files = [] if (res is None or isinstance(res, GitHubError)) else res
        c["files"] = [f["path"] for f in files[:15]]
        c["files_changed"] = len(files) if files else None
        c["bulk"] = len(files) > lim.bulk_commit_files
        if c["bulk"]:
            bulk += 1
            continue
        if not c["author"]:
            continue
        for f in files:
            st = file_stats.setdefault(f["path"], {"commits": 0, "additions": 0, "deletions": 0, "by": {}})
            st["commits"] += 1
            st["additions"] += f["additions"]
            st["deletions"] += f["deletions"]
            st["by"][c["author"]] = st["by"].get(c["author"], 0) + 1
    if bulk:
        warnings.append(f"{bulk} bulk commit(s) (> {lim.bulk_commit_files} files) ignored for co-edit edges")
    unattributed = sum(1 for c in commits if not c["author"])
    if unattributed:
        warnings.append(f"{unattributed} commit(s) not linked to a GitHub account were left out of the graph")

    # ---- PR reviews (real review interactions)
    review_prs = [p for p in pulls if p["author"] and (bots_ok or not p["author_is_bot"])][:plan["reviews"]]

    def pr_rev(p):
        try:
            return p["id"], client.get_pr_reviews(owner, repo, p["id"])
        except GitHubError as e:
            return p["id"], e

    reviews: List[Dict[str, Any]] = []
    pr_by_id = {p["id"]: p for p in pulls}
    rev_failed = 0
    if review_prs:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for pid, res in pool.map(pr_rev, review_prs):
                if isinstance(res, GitHubError):
                    rev_failed += 1
                    continue
                seen = set()
                for r in res:
                    if r["reviewer"] == pr_by_id[pid]["author"] or r["reviewer"] in seen or (r["reviewer_is_bot"] and not bots_ok):
                        continue
                    seen.add(r["reviewer"])
                    reviews.append({"pr": pid, "author": pr_by_id[pid]["author"], "reviewer": r["reviewer"], "state": r["state"]})
                pr_by_id[pid]["reviewers"] = sorted(seen)
    if rev_failed:
        warnings.append(f"{rev_failed} PR review request(s) failed")
    for p in pulls:
        p.setdefault("reviewers", [])

    # ---- contributors
    window_counts: Dict[str, int] = {}
    for c in commits:
        if c["author"] and (bots_ok or not c["author_is_bot"]):
            window_counts[c["author"]] = window_counts.get(c["author"], 0) + 1
    info: Dict[str, Dict[str, Any]] = {c["login"]: c for c in contribs if bots_ok or not c["is_bot"]}
    people = list(info)
    extra = list(window_counts) + [r["reviewer"] for r in reviews] + [p["author"] for p in pulls
                                                                      if p["author"] and (bots_ok or not p["author_is_bot"])]
    for login in extra:
        if login not in info:
            info[login] = {"login": login, "contributions": None, "avatar_url": f"https://github.com/{login}.png",
                           "profile_url": f"https://github.com/{login}"}
            people.append(login)
    reviewed = {l: len({r["pr"] for r in reviews if r["reviewer"] == l}) for l in info}
    received = {l: len({r["pr"] for r in reviews if r["author"] == l}) for l in info}
    ranked = sorted(info, key=lambda l: ((info[l]["contributions"] or 0), window_counts.get(l, 0) + reviewed[l]), reverse=True)[:40]

    contributors = []
    for idx, login in enumerate(ranked):
        i = info[login]
        contributors.append({
            "id": login, "name": login, "badge": f"{idx + 1:02d}",
            "avatar_url": i.get("avatar_url") or f"https://github.com/{login}.png",
            "profile_url": i.get("profile_url") or f"https://github.com/{login}",
            "total_commits": i["contributions"], "window_commits": window_counts.get(login, 0),
            "commits_count": i["contributions"] if i["contributions"] is not None else window_counts.get(login, 0),
            "prs_reviewed": reviewed[login], "reviews_received": received[login], "domain": "",
        })
    cid_set = {c["id"] for c in contributors}
    if not contributors:
        warnings.append("no GitHub-linked contributors found in the sampled history")

    # ---- source files -> Tree-sitter (+ blame)
    size_of = {b["path"]: b["size"] for b in blobs}
    cands = [b for b in blobs if _is_candidate(b["path"], b["size"], lim.max_file_bytes)]
    cands.sort(key=lambda b: (-(file_stats.get(b["path"], {}).get("commits", 0)),
                              1 if _TEST_PAT.search(b["path"]) else 0, -b["size"]))
    chosen = [b["path"] for b in cands[:lim.files_parsed]]
    blame_ok = {"used": False}

    def process(path: str):
        try:
            return _process(path)
        except Exception as e:  # one bad file must not sink the whole analysis
            return path, None, None, None, f"analysis failed: {e}"

    def _process(path: str):
        src = client.get_raw_file(owner, repo, head, path, lim.max_file_bytes)
        if src is None:
            return path, None, None, None, "source unavailable"
        fns = ts.analyze_source(src, path)
        n_lines = src.count("\n") + 1
        by = {k: v for k, v in file_stats.get(path, {}).get("by", {}).items()}
        if has_token and fns:
            try:
                ranges = client.get_blame(owner, repo, head, path)
                if ranges:
                    blame_ok["used"] = True
                    return path, n_lines, attribute_from_blame(fns, ranges), "blame", None
            except GitHubError as e:
                return path, n_lines, attribute_from_file_history(fns, by), "file-commits", f"blame failed for {path}: {e}"
        return path, n_lines, attribute_from_file_history(fns, by), "file-commits", None

    parsed_lines: Dict[str, int] = {}
    functions: List[Dict[str, Any]] = []
    if chosen:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for path, n_lines, fns, basis, warn in pool.map(process, chosen):
                if warn and basis is None:
                    warnings.append(f"{path}: {warn}")
                    continue
                if warn:
                    warnings.append(warn)
                parsed_lines[path] = n_lines
                for f in fns:
                    f["github_url"] = f"{repo_url}/blob/{head}/{path}#L{f['start_line']}"
                    f["docstring_preview"] = f.get("signature", "")
                functions += fns
    functions.sort(key=lambda f: -f["cyclomatic_complexity"])
    functions = functions[:300]
    if not has_token:
        warnings.append("no GITHUB_TOKEN: function ownership is inferred from file-level commit history, "
                        "not git blame, and API budgets are small")

    # ---- file records
    paths = set(file_stats) | set(parsed_lines)
    files = []
    for p in paths:
        st = file_stats.get(p, {"commits": 0, "additions": 0, "deletions": 0, "by": {}})
        by = {k: v for k, v in st["by"].items() if k in cid_set}
        files.append({
            "path": p, "language": language_label(p), "lines": parsed_lines.get(p), "size": size_of.get(p),
            "commits": st["commits"], "additions": st["additions"], "deletions": st["deletions"],
            "contributors": sorted(by, key=lambda k: -by[k]), "contributor_commits": by,
            "file_url": f"{repo_url}/blob/{head}/{p}", "parsed": p in parsed_lines,
        })
    files.sort(key=lambda f: (f["commits"], f["parsed"]), reverse=True)
    files = files[:250]

    # ---- graph
    engine = ContributorGraphEngine()
    graph = engine.build_collaboration_graph(
        contributors, {f["path"]: f["contributor_commits"] for f in files}, reviews, functions)
    for n in graph["nodes"]:  # human-readable focus area derived from real file history
        areas: Dict[str, int] = {}
        for f in files:
            k = f["contributor_commits"].get(n["id"], 0)
            if k:
                areas[_area(f["path"])] = areas.get(_area(f["path"]), 0) + k
        n["domain"] = ", ".join(a for a, _ in sorted(areas.items(), key=lambda kv: -kv[1])[:2]) or "No recent file activity"

    engines = sorted(ts.used) or ["none"]
    return {
        "repo_name": f"{owner}/{repo}", "repo_url": repo_url, "description": overview["description"],
        "stars": overview["stars"], "forks": overview["forks"], "language": overview["language"],
        "default_branch": branch, "head_sha": head,
        "contributors": graph["nodes"], "edges": graph["edges"], "network_stats": graph["network_stats"],
        "files": files, "ast_functions": functions,
        "commits": commits, "prs": pulls, "reviews": reviews,
        "data_source": {
            "source": "github-live", "token_used": has_token, "blame_used": blame_ok["used"],
            "commit_window": len(commits), "commits_with_files": sum(1 for c in commits if c.get("files_changed")),
            "prs_sampled": len(review_prs), "reviews": len(reviews), "files_parsed": len(parsed_lines),
            "parser": "+".join(engines), "rate_limit_remaining": client.rate_remaining,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "warnings": warnings,
        },
    }
