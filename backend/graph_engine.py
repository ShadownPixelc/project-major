"""Equinox - NetworkX collaboration graph + depth views.

All inputs come from real GitHub data (file edit history, PR reviews, git blame).
Nothing is synthesized here.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx

PALETTE = ["#00e5ff", "#ff1744", "#ffd600", "#00e676", "#2979ff", "#d500f9", "#ff9100", "#00b0ff"]
W_CO_EDIT, W_REVIEW, W_FUNC = 1.0, 2.0, 1.5


def _pair(a: str, b: str) -> Tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _blank() -> Dict[str, Any]:
    return {"files": set(), "co_edits": 0.0, "reviews": 0, "func": 0}


class ContributorGraphEngine:
    def build_collaboration_graph(
        self,
        contributors: List[Dict[str, Any]],
        file_stats: Dict[str, Dict[str, int]],      # path -> {login: commits}
        reviews: List[Dict[str, Any]],              # {author, reviewer, pr}
        functions: List[Dict[str, Any]],            # with ownership_breakdown
    ) -> Dict[str, Any]:
        ids = [c["id"] for c in contributors]
        known = set(ids)
        pairs: Dict[Tuple[str, str], Dict[str, Any]] = {}

        # 1) Co-editing: two people committed to the same file in the sampled history.
        for path, by in file_stats.items():
            people = [p for p in by if p in known]
            for i in range(len(people)):
                for j in range(i + 1, len(people)):
                    d = pairs.setdefault(_pair(people[i], people[j]), _blank())
                    d["files"].add(path)
                    d["co_edits"] += min(by[people[i]], by[people[j]])

        # 2) PR review interactions.
        for r in reviews:
            a, b = r.get("author"), r.get("reviewer")
            if a in known and b in known and a != b:
                pairs.setdefault(_pair(a, b), _blank())["reviews"] += 1

        # 3) Function-level co-ownership from real blame (>=20% of a function's lines each).
        for fn in functions:
            if fn.get("ownership_basis") != "blame":
                continue
            owners = [o["contributor"] for o in fn.get("ownership_breakdown", [])
                      if o["pct"] >= 20 and o["contributor"] in known]
            for i in range(len(owners)):
                for j in range(i + 1, len(owners)):
                    pairs.setdefault(_pair(owners[i], owners[j]), _blank())["func"] += 1

        raw = {k: d["co_edits"] * W_CO_EDIT + d["reviews"] * W_REVIEW + d["func"] * W_FUNC for k, d in pairs.items()}
        raw = {k: v for k, v in raw.items() if v > 0}
        max_raw = max(raw.values()) if raw else 1.0

        G = nx.Graph()
        G.add_nodes_from(ids)
        for (a, b), w in raw.items():
            G.add_edge(a, b, weight=w, distance=1.0 / w)  # strong tie => short path

        n = len(ids)
        deg = nx.degree_centrality(G) if n > 1 else {i: 0.0 for i in ids}
        btw = nx.betweenness_centrality(G, weight="distance") if n > 2 else {i: 0.0 for i in ids}
        try:
            pr = nx.pagerank(G, weight="weight") if n else {}
        except nx.PowerIterationFailedConvergence:
            pr = {i: 1.0 / max(1, n) for i in ids}
        community: Dict[str, int] = {i: 0 for i in ids}
        if G.number_of_edges() > 0:
            try:
                comms = sorted(nx.community.greedy_modularity_communities(G, weight="weight"), key=len, reverse=True)
                community = {m: idx for idx, c in enumerate(comms) for m in c}
            except Exception:
                pass

        risk_info = self._bus_factor(ids, file_stats)

        nodes = []
        for c in contributors:
            cid = c["id"]
            ri = risk_info[cid]
            nodes.append({
                **c, "type": "contributor", "label": c.get("name") or cid,
                "degree_centrality": round(deg.get(cid, 0.0), 3),
                "betweenness_centrality": round(btw.get(cid, 0.0), 3),
                "pagerank": round(pr.get(cid, 0.0), 3),
                "community_cluster": community.get(cid, 0),
                "color": PALETTE[community.get(cid, 0) % len(PALETTE)],
                **ri,
            })

        edges = []
        for (a, b), w in sorted(raw.items(), key=lambda kv: -kv[1]):
            d = pairs[(a, b)]
            nw = round(10.0 * w / max_raw, 2)
            color = "#ff1744" if nw >= 6.5 else ("#ffd600" if d["reviews"] > 0 else "#00e5ff")
            edges.append({
                "source": a, "target": b, "weight": nw, "raw_weight": round(w, 2), "type": "collaboration",
                "co_edits": int(d["co_edits"]), "pr_reviews": d["reviews"], "function_co_ownership": d["func"],
                "shared_files": sorted(d["files"])[:4], "shared_files_count": len(d["files"]),
                "color": color, "glow": nw >= 4,
            })

        counts = sorted((c.get("window_commits", 0) for c in contributors), reverse=True)
        total = sum(counts)
        truck, acc = 0, 0
        for v in counts:
            if total == 0:
                break
            acc += v
            truck += 1
            if acc >= total / 2:
                break

        return {"nodes": nodes, "edges": edges, "network_stats": {
            "total_contributors": n, "total_collaborations": len(edges),
            "graph_density": round(nx.density(G), 3) if n > 1 else 0.0, "has_networkx": True,
            "communities": len(set(community.values())) if n else 0, "bus_factor": truck or None}}

    @staticmethod
    def _bus_factor(ids: List[str], file_stats: Dict[str, Dict[str, int]]) -> Dict[str, Dict[str, Any]]:
        """A contributor is a risk when they are the dominant (>=80%) author of many actively edited files."""
        active = {p: by for p, by in file_stats.items() if sum(by.values()) >= 2}
        dominated = {i: 0 for i in ids}
        for by in active.values():
            tot = sum(by.values())
            top = max(by, key=by.get)
            if top in dominated and by[top] / tot >= 0.8:
                dominated[top] += 1
        out = {}
        for i in ids:
            n, ratio = dominated[i], dominated[i] / max(1, len(active))
            risk = "HIGH" if (ratio >= 0.25 and n >= 3) else ("MEDIUM" if (ratio >= 0.10 and n >= 2) else "LOW")
            out[i] = {"bus_factor_risk": risk, "exclusive_files": n, "exclusive_files_pct": round(100 * ratio, 1)}
        return out


# ------------------------------------------------------------------ depth views
def fn_node_id(fn: Dict[str, Any]) -> str:
    return f"fn:{fn['file_path']}#{fn['name']}:{fn['start_line']}"


def file_node_id(path: str) -> str:
    return f"file:{path}"


def build_view(state: Dict[str, Any], depth: int) -> Dict[str, Any]:
    """Depth 1 backbone -> 2 all contributors -> 3 + files -> 4 + AST functions -> 5 everything + containment."""
    contributors = state["contributors"]
    edges = state["edges"]
    ids = {c["id"] for c in contributors}

    if depth <= 1:
        k = max(3, min(8, round(len(contributors) * 0.4)))
        top = sorted(contributors, key=lambda c: (c.get("commits_count", 0), c.get("prs_reviewed", 0)), reverse=True)[:k]
        keep = {c["id"] for c in top}
        nodes = [c for c in contributors if c["id"] in keep]
        out_edges = [e for e in edges if e["source"] in keep and e["target"] in keep]
    else:
        nodes = list(contributors)
        out_edges = list(edges[:200])

    nodes = [dict(n) for n in nodes]
    out_edges = [dict(e) for e in out_edges]

    files = sorted(state["files"], key=lambda f: (f.get("commits", 0), f.get("parsed", False)), reverse=True)
    functions = state["ast_functions"]
    head = state.get("head_sha") or state.get("default_branch", "HEAD")
    repo_url = state["repo_url"]

    file_ids = set()
    if depth >= 3:
        cap = 60 if depth >= 5 else 30
        chosen = [f for f in files if f.get("commits", 0) > 0 or f.get("parsed")][:cap]
        if depth >= 5:  # make sure every file that owns a function is present
            have = {f["path"] for f in chosen}
            chosen += [f for f in files if f.get("parsed") and f["path"] not in have]
        for f in chosen:
            fid = file_node_id(f["path"])
            file_ids.add(fid)
            nodes.append({"id": fid, "type": "file", "label": f["path"].split("/")[-1], "full_path": f["path"],
                          "language": f.get("language"), "lines": f.get("lines"), "color": "#64748b",
                          "file_url": f.get("file_url") or f"{repo_url}/blob/{head}/{f['path']}",
                          "commits": f.get("commits", 0)})
            by = f.get("contributor_commits", {})
            tot = sum(by.values()) or 1
            for login, n in sorted(by.items(), key=lambda kv: -kv[1])[:3]:
                if login in ids:
                    out_edges.append({"source": login, "target": fid, "type": "authored_file", "color": "#475569",
                                      "weight": round(1 + 4 * n / tot, 2), "commits": n})

    if depth >= 4:
        ranked = sorted(functions, key=lambda f: (f.get("cyclomatic_complexity", 1)), reverse=True)
        chosen_fns = ranked[:150] if depth >= 5 else ranked[:40]
        for fn in chosen_fns:
            fid = fn_node_id(fn)
            short = fn["name"].split(".")[-1]
            nodes.append({"id": fid, "type": "ast_function", "label": f"{short}()", "name": fn["name"],
                          "file_path": fn["file_path"], "complexity": fn.get("cyclomatic_complexity", 1),
                          "color": "#a855f7", "github_url": fn.get("github_url"),
                          "owner": fn.get("primary_owner"), "ownership_pct": fn.get("primary_ownership_pct"),
                          "ownership_basis": fn.get("ownership_basis")})
            for o in (fn.get("ownership_breakdown") or [])[:2]:
                if o["contributor"] in ids and (o is fn["ownership_breakdown"][0] or o["pct"] >= 25):
                    out_edges.append({"source": o["contributor"], "target": fid, "type": "owns_ast_function",
                                      "color": "#00e5ff", "weight": round(max(1.0, o["pct"] / 20), 2)})
            if depth >= 5:
                parent = file_node_id(fn["file_path"])
                if parent in file_ids:
                    out_edges.append({"source": parent, "target": fid, "type": "contains", "color": "#6b21a8",
                                      "weight": 1.5})

    node_ids = {n["id"] for n in nodes}
    out_edges = [e for e in out_edges if e["source"] in node_ids and e["target"] in node_ids]
    return {"nodes": nodes, "edges": out_edges}
