"""Equinox - GitHub client (REST + GraphQL).

Every method returns data that came from GitHub. Failures raise typed errors
instead of silently returning empty data, so callers can decide what to do.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class GitHubError(Exception):
    kind = "github"

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


class GitHubNotFound(GitHubError):
    kind = "not_found"


class GitHubAuthError(GitHubError):
    kind = "auth"


class GitHubRateLimited(GitHubError):
    kind = "rate_limit"

    def __init__(self, message: str, status: Optional[int] = None, reset_at: Optional[int] = None):
        super().__init__(message, status)
        self.reset_at = reset_at


def is_bot(login: Optional[str], user_type: Optional[str] = None) -> bool:
    return bool(login) and (user_type == "Bot" or login.endswith("[bot]"))


class GitHubClient:
    def __init__(self, token: Optional[str] = None, timeout: int = 20):
        self.token = token
        self.timeout = timeout
        self.rate_remaining: Optional[int] = None

    # ------------------------------------------------------------------ parsing
    @staticmethod
    def parse_repo_url(text: str) -> Tuple[str, str]:
        """Accepts https://github.com/o/r[.git][/tree/..], github.com/o/r, git@github.com:o/r.git, o/r."""
        s = (text or "").strip()
        if not s:
            raise ValueError("Repository is empty. Use 'owner/repo' or a GitHub URL.")
        s = re.sub(r"^git@github\.com:", "", s, flags=re.I)
        s = re.sub(r"^(?:https?://)?(?:www\.)?github\.com/", "", s, flags=re.I)
        s = s.split("?")[0].split("#")[0].strip("/")
        parts = [p for p in s.split("/") if p]
        if len(parts) < 2:
            raise ValueError(f"'{text}' is not a valid repository. Use 'owner/repo' or a GitHub URL.")
        owner, repo = parts[0], parts[1].removesuffix(".git")
        if not _NAME_RE.match(owner) or not _NAME_RE.match(repo) or repo in (".", ".."):
            raise ValueError(f"'{owner}/{repo}' contains characters GitHub does not allow.")
        return owner, repo

    # ---------------------------------------------------------------- transport
    def _note_rate(self, headers) -> None:
        try:
            v = headers.get("X-RateLimit-Remaining")
            if v is not None:
                self.rate_remaining = int(v)
        except (AttributeError, ValueError):
            pass

    def _request(self, url: str, *, data: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None,
                 retries: int = 2) -> Any:
        h = {"User-Agent": "Equinox-Contributor-Graph/2.0"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h)
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    self._note_rate(resp.headers)
                    raw = resp.read()
                    if resp.status == 204 or not raw:
                        return None
                    return json.loads(raw.decode("utf-8"))
            except urllib.error.HTTPError as e:
                self._note_rate(e.headers)
                try:
                    body = e.read().decode("utf-8", "ignore")
                except Exception:
                    body = ""
                msg = body
                try:
                    msg = json.loads(body).get("message", body)
                except ValueError:
                    pass
                if e.code == 401:
                    raise GitHubAuthError("GitHub rejected the token (401). Check GITHUB_TOKEN.", 401)
                if e.code == 404:
                    raise GitHubNotFound(f"Not found on GitHub: {url.replace(API, '')}", 404)
                if e.code in (403, 429):
                    reset = e.headers.get("X-RateLimit-Reset")
                    limited = e.headers.get("X-RateLimit-Remaining") == "0" or "rate limit" in msg.lower()
                    if limited:
                        raise GitHubRateLimited(
                            "GitHub API rate limit reached. Set GITHUB_TOKEN to raise the limit "
                            "from 60 to 5000 requests/hour.", e.code, int(reset) if reset else None)
                    raise GitHubError(f"GitHub refused the request ({e.code}): {msg}", e.code)
                if e.code >= 500 and attempt < retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise GitHubError(f"GitHub error {e.code}: {msg}", e.code)
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
                if attempt < retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise GitHubError(f"Network error talking to GitHub: {e}")
        raise GitHubError("Unreachable")  # pragma: no cover

    def rest(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
        return self._request(url, headers={"Accept": "application/vnd.github+json",
                                           "X-GitHub-Api-Version": "2022-11-28"})

    def graphql(self, query: str, variables: Dict[str, Any]) -> Dict[str, Any]:
        if not self.token:
            raise GitHubAuthError("GitHub GraphQL requires a token (set GITHUB_TOKEN).", 401)
        out = self._request(f"{API}/graphql", data=json.dumps({"query": query, "variables": variables}).encode(),
                            headers={"Content-Type": "application/json"})
        if out and out.get("errors"):
            raise GitHubError("GraphQL error: " + "; ".join(e.get("message", "?") for e in out["errors"][:2]))
        return (out or {}).get("data") or {}

    # --------------------------------------------------------------- endpoints
    def rate_limit(self) -> Optional[Dict[str, int]]:
        """Free call (does not consume quota). None if unavailable."""
        try:
            core = self.rest("/rate_limit")["resources"]["core"]
            return {"remaining": core["remaining"], "limit": core["limit"], "reset": core["reset"]}
        except (GitHubError, KeyError, TypeError):
            return None

    def get_repo(self, owner: str, repo: str) -> Dict[str, Any]:
        d = self.rest(f"/repos/{owner}/{repo}")
        return {
            "owner": d["owner"]["login"], "name": d["name"], "full_name": d["full_name"],
            "description": d.get("description") or "",
            "stars": d.get("stargazers_count", 0), "forks": d.get("forks_count", 0),
            "language": d.get("language"), "default_branch": d.get("default_branch") or "main",
            "html_url": d.get("html_url") or f"https://github.com/{owner}/{repo}",
            "archived": bool(d.get("archived")),
        }

    def get_contributors(self, owner: str, repo: str, limit: int = 40) -> List[Dict[str, Any]]:
        data = self.rest(f"/repos/{owner}/{repo}/contributors", {"per_page": min(limit, 100)}) or []
        return [{"login": c["login"], "contributions": c.get("contributions", 0),
                 "avatar_url": c.get("avatar_url", ""), "profile_url": c.get("html_url", ""),
                 "is_bot": is_bot(c["login"], c.get("type"))}
                for c in data if c.get("login")]

    def get_commits(self, owner: str, repo: str, limit: int = 60) -> List[Dict[str, Any]]:
        try:
            data = self.rest(f"/repos/{owner}/{repo}/commits", {"per_page": min(limit, 100)}) or []
        except GitHubError as e:
            if e.status == 409:
                raise GitHubError("This repository is empty (no commits).", 409)
            raise
        out = []
        for c in data:
            author = c.get("author") or {}
            commit = c.get("commit") or {}
            cauthor = commit.get("author") or {}
            out.append({
                "sha": c["sha"], "short": c["sha"][:7],
                "message": (commit.get("message") or "").split("\n")[0][:200],
                "author": author.get("login"),  # None when the commit email is not linked to an account
                "author_name": cauthor.get("name"),
                "author_is_bot": is_bot(author.get("login"), author.get("type")),
                "date": (cauthor.get("date") or "")[:10],
                "url": c.get("html_url") or f"https://github.com/{owner}/{repo}/commit/{c['sha']}",
                "is_merge": len(c.get("parents") or []) > 1,
            })
        return out

    def get_commit_files(self, owner: str, repo: str, sha: str) -> List[Dict[str, Any]]:
        d = self.rest(f"/repos/{owner}/{repo}/commits/{sha}") or {}
        return [{"path": f["filename"], "additions": f.get("additions", 0), "deletions": f.get("deletions", 0)}
                for f in d.get("files", [])]

    def get_pulls(self, owner: str, repo: str, limit: int = 30) -> List[Dict[str, Any]]:
        data = self.rest(f"/repos/{owner}/{repo}/pulls",
                         {"state": "all", "sort": "updated", "direction": "desc", "per_page": min(limit, 100)}) or []
        out = []
        for p in data:
            user = p.get("user") or {}
            out.append({
                "id": p["number"], "title": p.get("title") or "",
                "author": user.get("login"), "author_is_bot": is_bot(user.get("login"), user.get("type")),
                "state": "merged" if p.get("merged_at") else p.get("state", "closed"),
                "pr_url": p.get("html_url") or f"https://github.com/{owner}/{repo}/pull/{p['number']}",
                "created": (p.get("created_at") or "")[:10],
                "body": re.sub(r"\s+", " ", p.get("body") or "").strip()[:300],
            })
        return out

    def get_pr_reviews(self, owner: str, repo: str, number: int) -> List[Dict[str, Any]]:
        data = self.rest(f"/repos/{owner}/{repo}/pulls/{number}/reviews", {"per_page": 100}) or []
        return [{"reviewer": (r.get("user") or {}).get("login"),
                 "reviewer_is_bot": is_bot((r.get("user") or {}).get("login"), (r.get("user") or {}).get("type")),
                 "state": r.get("state")}
                for r in data if (r.get("user") or {}).get("login")]

    def get_tree(self, owner: str, repo: str, ref: str) -> Tuple[List[Dict[str, Any]], bool]:
        d = self.rest(f"/repos/{owner}/{repo}/git/trees/{urllib.parse.quote(ref, safe='')}", {"recursive": 1}) or {}
        blobs = [{"path": t["path"], "size": t.get("size", 0)} for t in d.get("tree", []) if t.get("type") == "blob"]
        return blobs, bool(d.get("truncated"))

    def get_raw_file(self, owner: str, repo: str, ref: str, path: str, max_bytes: int = 250_000) -> Optional[str]:
        """Raw file content from raw.githubusercontent.com (does not consume REST quota)."""
        url = f"{RAW}/{owner}/{repo}/{ref}/{urllib.parse.quote(path)}"
        h = {"User-Agent": "Equinox-Contributor-Graph/2.0"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=self.timeout) as resp:
                data = resp.read(max_bytes + 1)
        except Exception:
            return None
        if len(data) > max_bytes:
            return None
        return data.decode("utf-8", "ignore")

    def get_blame(self, owner: str, repo: str, oid: str, path: str) -> List[Dict[str, Any]]:
        """Real `git blame` at commit `oid` through the GraphQL API (needs a token)."""
        q = ("query($owner:String!,$name:String!,$oid:GitObjectID!,$path:String!){"
             "repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{blame(path:$path){"
             "ranges{startingLine endingLine commit{oid author{name user{login}}}}}}}}}")
        data = self.graphql(q, {"owner": owner, "name": repo, "oid": oid, "path": path})
        obj = ((data.get("repository") or {}).get("object") or {})
        ranges = ((obj.get("blame") or {}).get("ranges")) or []
        out = []
        for r in ranges:
            a = (r.get("commit") or {}).get("author") or {}
            out.append({"start": r["startingLine"], "end": r["endingLine"],
                        "author": (a.get("user") or {}).get("login"), "author_name": a.get("name")})
        return out
