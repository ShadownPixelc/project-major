
from typing import Dict, List, Any, Tuple, Optional, Set
import math
import json

try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False


class ContributorGraphEngine:
    def __init__(self):
        if HAS_NETWORKX:
            self.graph = nx.Graph()
            self.di_graph = nx.DiGraph()
        else:
            self.graph = None
            self.di_graph = None

    def build_bipartite_graph(
        self,
        contributors: List[Dict[str, Any]],
        files: List[Dict[str, Any]],
        ownership_matrix: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        nodes = []
        edges = []

        # Add Contributor nodes
        for c in contributors:
            c_name = c.get("name") or c.get("login") or c["id"]
            nodes.append({
                "id": c["id"],
                "name": c_name,
                "label": c_name,
                "type": "contributor",
                "badge": c.get("badge", "DEV"),
                "color": c.get("color", "#00e5ff"),
                "avatar_url": c.get("avatar_url", ""),
                "commits_count": c.get("commits_count", 0),
                "prs_reviewed": c.get("prs_reviewed", 0)
            })

        # Add File nodes
        for f in files:
            nodes.append({
                "id": f["path"],
                "type": "file",
                "label": f["path"].split("/")[-1],
                "full_path": f["path"],
                "language": f.get("language", "Python"),
                "lines": f.get("lines", 100),
                "color": "#64748b"
            })

        # Add Edges
        for link in ownership_matrix:
            edges.append({
                "source": link["contributor_id"],
                "target": link["file_path"],
                "weight": link.get("commit_count", 1),
                "type": "authored",
                "color": "#ffd600"
            })

        return {"nodes": nodes, "edges": edges}

    def project_contributor_network(
        self,
        contributors: List[Dict[str, Any]],
        ownership_matrix: List[Dict[str, Any]],
        pr_reviews: Optional[List[Dict[str, Any]]] = None,
        function_co_edits: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        pr_reviews = pr_reviews or []
        function_co_edits = function_co_edits or []

        # Group file edits by file
        file_to_contribs: Dict[str, Dict[str, int]] = {}
        for row in ownership_matrix:
            f = row["file_path"]
            c = row["contributor_id"]
            cnt = row.get("commit_count", 1) + row.get("lines_added", 10) // 50
            if f not in file_to_contribs:
                file_to_contribs[f] = {}
            file_to_contribs[f][c] = file_to_contribs[f].get(c, 0) + cnt

        # Compute pair co-edit edge weights
        pair_weights: Dict[Tuple[str, str], Dict[str, Any]] = {}

        for f, contribs in file_to_contribs.items():
            c_list = list(contribs.keys())
            for i in range(len(c_list)):
                for j in range(i + 1, len(c_list)):
                    c1, c2 = sorted([c_list[i], c_list[j]])
                    weight = min(contribs[c1], contribs[c2])
                    if (c1, c2) not in pair_weights:
                        pair_weights[(c1, c2)] = {
                            "shared_files": [],
                            "weight": 0,
                            "co_edits": 0,
                            "pr_reviews": 0,
                            "function_co_ownership": 0
                        }
                    pair_weights[(c1, c2)]["shared_files"].append(f.split("/")[-1])
                    pair_weights[(c1, c2)]["co_edits"] += weight
                    pair_weights[(c1, c2)]["weight"] += weight * 1.5

        # Incorporate PR review interactions
        for pr in pr_reviews:
            author = pr.get("author")
            reviewer = pr.get("reviewer")
            if author and reviewer and author != reviewer:
                c1, c2 = sorted([author, reviewer])
                if (c1, c2) not in pair_weights:
                    pair_weights[(c1, c2)] = {
                        "shared_files": [],
                        "weight": 0,
                        "co_edits": 0,
                        "pr_reviews": 0,
                        "function_co_ownership": 0
                    }
                pair_weights[(c1, c2)]["pr_reviews"] += 1
                pair_weights[(c1, c2)]["weight"] += 2.5

        # Incorporate Tree-sitter function-level co-ownership
        for fco in function_co_edits:
            c1, c2 = sorted([fco["author_a"], fco["author_b"]])
            if (c1, c2) not in pair_weights:
                pair_weights[(c1, c2)] = {
                    "shared_files": [],
                    "weight": 0,
                    "co_edits": 0,
                    "pr_reviews": 0,
                    "function_co_ownership": 0
                }
            pair_weights[(c1, c2)]["function_co_ownership"] += 1
            pair_weights[(c1, c2)]["weight"] += 3.0

        # Construct NetworkX graph if available
        if HAS_NETWORKX:
            G = nx.Graph()
            for c in contributors:
                G.add_node(c["id"], **c)
            for (c1, c2), data in pair_weights.items():
                G.add_edge(c1, c2, weight=data["weight"], **data)

            # Centrality metrics
            deg_centrality = nx.degree_centrality(G)
            between_centrality = nx.betweenness_centrality(G, weight="weight")
            try:
                pagerank = nx.pagerank(G, weight="weight")
            except Exception:
                pagerank = {c["id"]: 1.0 / max(1, len(contributors)) for c in contributors}
            try:
                # Modularity communities
                communities = list(nx.community.greedy_modularity_communities(G))
                community_map = {}
                for idx, comm in enumerate(communities):
                    for member in comm:
                        community_map[member] = idx
            except Exception:
                community_map = {c["id"]: 0 for c in contributors}
        else:
            deg_centrality, between_centrality, pagerank, community_map = self._pure_python_metrics(
                contributors, pair_weights
            )

        edges = []
        for (c1, c2), data in pair_weights.items():
            w = data["weight"]
            color = "#ff1744" if w > 5 else ("#ffd600" if data["pr_reviews"] > 0 else "#00e5ff")
            edges.append({
                "source": c1,
                "target": c2,
                "weight": round(w, 2),
                "co_edits": data["co_edits"],
                "pr_reviews": data["pr_reviews"],
                "function_co_ownership": data["function_co_ownership"],
                "shared_files": data["shared_files"][:4],
                "color": color,
                "glow": w > 4
            })

        # Enrich contributors with metrics
        enriched_contributors = []
        for c in contributors:
            cid = c["id"]
            c_name = c.get("name") or c.get("login") or cid
            enriched_contributors.append({
                **c,
                "type": "contributor",
                "name": c_name,
                "label": c_name,
                "degree_centrality": round(deg_centrality.get(cid, 0.0), 3),
                "betweenness_centrality": round(between_centrality.get(cid, 0.0), 3),
                "pagerank": round(pagerank.get(cid, 0.0), 3),
                "community_cluster": community_map.get(cid, 0),
                "bus_factor_risk": "HIGH" if between_centrality.get(cid, 0) > 0.4 else ("MEDIUM" if between_centrality.get(cid, 0) > 0.2 else "LOW")
            })

        return {
            "nodes": enriched_contributors,
            "edges": edges,
            "network_stats": {
                "total_contributors": len(contributors),
                "total_collaborations": len(edges),
                "graph_density": round(2 * len(edges) / max(1, len(contributors) * (len(contributors) - 1)), 3),
                "has_networkx": HAS_NETWORKX
            }
        }

    def filter_by_depth(self, full_graph: Dict[str, Any], depth_level: int) -> Dict[str, Any]:

        nodes = full_graph.get("nodes", [])
        edges = full_graph.get("edges", [])

        if depth_level <= 1:
            # Low depth: only core contributors and top edges
            filtered_edges = [e for e in edges if e.get("weight", 0) >= 3.0]
            connected_node_ids = set()
            for e in filtered_edges:
                connected_node_ids.add(e["source"])
                connected_node_ids.add(e["target"])
            filtered_nodes = [n for n in nodes if n["id"] in connected_node_ids or n.get("degree_centrality", 0) > 0.3]
            if len(filtered_nodes) < 3:
                filtered_nodes = sorted(nodes, key=lambda x: x.get("commits_count", 0), reverse=True)[:5]
                kept_ids = {n["id"] for n in filtered_nodes}
                filtered_edges = [e for e in edges if e["source"] in kept_ids and e["target"] in kept_ids]
            return {"nodes": filtered_nodes, "edges": filtered_edges, "depth": depth_level}

        elif depth_level == 2:
            # All contributors and significant edges
            filtered_edges = [e for e in edges if e.get("weight", 0) >= 1.5]
            return {"nodes": nodes, "edges": filtered_edges, "depth": depth_level}

        # For depth 3+, caller or graph engine integrates file/AST nodes
        return {"nodes": nodes, "edges": edges, "depth": depth_level}

    def _pure_python_metrics(
        self,
        contributors: List[Dict[str, Any]],
        pair_weights: Dict[Tuple[str, str], Dict[str, Any]]
    ) -> Tuple[Dict[str, float], Dict[str, float], Dict[str, float], Dict[str, int]]:
        """Fallback graph metric calculation without NetworkX dependency."""
        n = len(contributors)
        c_ids = [c["id"] for c in contributors]
        adj: Dict[str, Set[str]] = {cid: set() for cid in c_ids}
        adj_weighted: Dict[str, Dict[str, float]] = {cid: {} for cid in c_ids}

        for (u, v), data in pair_weights.items():
            w = data.get("weight", 1.0)
            if u in adj and v in adj:
                adj[u].add(v)
                adj[v].add(u)
                adj_weighted[u][v] = w
                adj_weighted[v][u] = w

        deg = {cid: len(adj[cid]) / max(1, n - 1) for cid in c_ids}

        # Simplified betweenness (shortest paths via BFS)
        betweenness = {cid: 0.0 for cid in c_ids}
        for s in c_ids:
            for t in c_ids:
                if s == t:
                    continue
                # BFS shortest path
                queue = [[s]]
                visited = {s}
                found_paths = []
                while queue:
                    path = queue.pop(0)
                    curr = path[-1]
                    if curr == t:
                        found_paths.append(path)
                        continue
                    for nbr in adj[curr]:
                        if nbr not in visited or nbr == t:
                            queue.append(path + [nbr])
                            visited.add(nbr)
                if found_paths:
                    for p in found_paths:
                        for inter in p[1:-1]:
                            betweenness[inter] += 1.0 / len(found_paths)

        max_b = max(list(betweenness.values()) + [1.0])
        betweenness = {k: v / max_b for k, v in betweenness.items()}

        # PageRank iterative
        pr = {cid: 1.0 / max(1, n) for cid in c_ids}
        for _ in range(20):
            next_pr = {}
            for cid in c_ids:
                rank_sum = sum(pr[nbr] / max(1, len(adj[nbr])) for nbr in adj[cid])
                next_pr[cid] = 0.15 / n + 0.85 * rank_sum
            pr = next_pr

        # Community clustering by adjacency
        communities = {}
        curr_comm = 0
        visited = set()
        for cid in c_ids:
            if cid not in visited:
                q = [cid]
                visited.add(cid)
                while q:
                    curr = q.pop(0)
                    communities[curr] = curr_comm
                    for nbr in adj[curr]:
                        if nbr not in visited:
                            visited.add(nbr)
                            q.append(nbr)
                curr_comm += 1

        return deg, betweenness, pr, communities
