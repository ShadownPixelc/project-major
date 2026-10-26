"""Equinox - Explainable contributor summaries.

Every statement is computed from the analysed repository state (commits, file
history, git blame, PR reviews, graph). No generic filler: if there is no
evidence for a claim, the claim is not made.
"""

from collections import Counter
from typing import Any, Dict, List, Optional


def find_contributor(state: Dict[str, Any], ident: str) -> Optional[Dict[str, Any]]:
    k = (ident or "").strip().lower()
    for c in state["contributors"]:
        if c["id"].lower() == k or (c.get("name") or "").lower() == k:
            return c
    return None


def _area(path: str) -> str:
    parts = path.split("/")
    if len(parts) == 1:
        return "(repo root)"
    return "/".join(parts[:2]) + "/" if len(parts) > 2 else parts[0] + "/"


def _short(text: str, n: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def contributor_profile(state: Dict[str, Any], ident: str) -> Dict[str, Any]:
    c = find_contributor(state, ident)
    if c is None:
        raise ValueError(f"Contributor '{ident}' not found in {state['repo_name']}.")
    cid = c["id"]
    commits = state["commits"]
    mine = [m for m in commits if m.get("author") == cid]

    area_w: Counter = Counter()
    file_w: Counter = Counter()
    exclusive = []
    for f in state["files"]:
        n = f.get("contributor_commits", {}).get(cid, 0)
        if n:
            file_w[f["path"]] += n
            area_w[_area(f["path"])] += n
            tot = sum(f["contributor_commits"].values())
            if tot >= 2 and n / tot >= 0.8:
                exclusive.append(f["path"])

    fns = [f for f in state["ast_functions"] if f.get("primary_owner") == cid]
    fns.sort(key=lambda f: ((f.get("primary_ownership_pct") or 0), f.get("cyclomatic_complexity", 1)), reverse=True)

    given = [r for r in state["reviews"] if r["reviewer"] == cid]
    received = [r for r in state["reviews"] if r["author"] == cid]
    partners = Counter(r["author"] for r in given).most_common(3)

    collab = []
    for e in state["edges"]:
        if cid in (e["source"], e["target"]):
            collab.append((e["target"] if e["source"] == cid else e["source"], e["weight"]))
    collab.sort(key=lambda t: -t[1])

    dates = [m["date"] for m in commits if m.get("date")]
    return {
        "id": cid, "name": c.get("name") or cid, "repo": state["repo_name"],
        "total_commits": c.get("total_commits"),
        "window_commits": len(mine), "window_size": len(commits),
        "window_since": min(dates) if dates else None,
        "share_pct": round(100 * len(mine) / len(commits)) if commits else 0,
        "top_areas": [a for a, _ in area_w.most_common(2)],
        "top_files": [{"path": p, "commits": n} for p, n in file_w.most_common(3)],
        "functions": [{"name": f["name"], "file": f["file_path"], "line": f["start_line"],
                       "pct": f.get("primary_ownership_pct"), "basis": f.get("ownership_basis")} for f in fns[:3]],
        "functions_owned_total": len(fns),
        "reviews_given": len({r["pr"] for r in given}), "reviews_received": len({r["pr"] for r in received}),
        "review_partners": [p for p, _ in partners],
        "collaborators": [{"id": i, "weight": w} for i, w in collab[:3]],
        "exclusive_files": len(exclusive), "bus_factor_risk": c.get("bus_factor_risk", "LOW"),
        "recent": [{"sha": m["short"], "message": _short(m["message"], 80), "date": m["date"]} for m in mine[:2]],
    }


def build_summary(p: Dict[str, Any]) -> str:
    """Exactly two lines: (1) what they work on, (2) ownership / review / risk."""
    name, repo = p["name"], p["repo"]
    if p["window_commits"]:
        l1 = f"{name} authored {p['window_commits']} of the last {p['window_size']} commits to {repo} ({p['share_pct']}%)"
        if p["top_areas"]:
            l1 += ", mostly in " + " and ".join(p["top_areas"])
        if p["recent"]:
            r = p["recent"][0]
            l1 += f"; latest: \"{r['message']}\" ({r['date']})"
        l1 += "."
    else:
        tot = f"{p['total_commits']} commits overall" if p.get("total_commits") else "earlier contributions"
        l1 = (f"{name} has {tot} in {repo} but none among the last {p['window_size']} commits"
              f"{' (since ' + p['window_since'] + ')' if p.get('window_since') else ''}, so recent work is not evidenced.")

    parts: List[str] = []
    fns = p["functions"]
    if fns:
        if all(f["basis"] == "blame" for f in fns):
            parts.append("owns " + ", ".join(f"{f['name']}() ({f['pct']:.0f}%)" for f in fns) + " by git blame")
        else:
            parts.append("main committer of " + ", ".join(f"{f['name']}()" for f in fns)
                         + " (file-level commit history, no blame)")
    elif p["top_files"]:
        parts.append("most-edited files: " + ", ".join(f"{f['path'].split('/')[-1]} ({f['commits']})" for f in p["top_files"]))
    if p["reviews_given"]:
        who = f", most for {p['review_partners'][0]}" if p["review_partners"] else ""
        parts.append(f"reviewed {p['reviews_given']} sampled PR{'s' if p['reviews_given'] != 1 else ''}{who}")
    if p["bus_factor_risk"] in ("HIGH", "MEDIUM") and p["exclusive_files"]:
        parts.append(f"dominant author of {p['exclusive_files']} actively edited files "
                     f"({p['bus_factor_risk'].lower()} bus-factor risk)")
    if not parts and p["collaborators"]:
        parts.append("closest collaborators: " + ", ".join(c["id"] for c in p["collaborators"]))
    l2 = (parts[0][0].upper() + parts[0][1:] + ("; " + "; ".join(parts[1:]) if len(parts) > 1 else "") + "."
          ) if parts else "No ownership, review, or file-level evidence in the sampled history."
    return f"{l1}\n{l2}"


def citations_for(state: Dict[str, Any], p: Dict[str, Any]) -> List[str]:
    cites = [f"[Commit #{r['sha']}]" for r in p["recent"]]
    cites += [f"[AST: {f['name']}() in {f['file']}:L{f['line']}]" for f in p["functions"]]
    return cites
