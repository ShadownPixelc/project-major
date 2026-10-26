export interface ContributorNode {
  id: string;
  name: string;
  badge: string;
  color: string;
  domain: string;
  commits_count: number;
  prs_reviewed: number;
  profile_url?: string;
  avatar_url?: string;
  degree_centrality?: number;
  betweenness_centrality?: number;
  pagerank?: number;
  community_cluster?: number;
  bus_factor_risk?: 'HIGH' | 'MEDIUM' | 'LOW';
  type?: 'contributor';
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  total_commits?: number | null;
  window_commits?: number;
  reviews_received?: number;
  exclusive_files?: number;
}

export interface FileNode {
  id: string;
  type: 'file';
  label: string;
  full_path: string;
  language: string;
  lines?: number | null;
  color: string;
  file_url?: string;
  x?: number;
  y?: number;
  commits?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface AstFunctionNode {
  id: string;
  type: 'ast_function';
  label: string;
  file_path: string;
  complexity: number;
  color: string;
  github_url?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  name?: string;
  owner?: string | null;
  ownership_pct?: number | null;
  ownership_basis?: string;
}

export type GraphNode = ContributorNode | FileNode | AstFunctionNode;

export interface GraphEdge {
  source: any;
  target: any;
  weight: number;
  co_edits?: number;
  pr_reviews?: number;
  function_co_ownership?: number;
  shared_files?: string[];
  color: string;
  glow?: boolean;
  type?: string;
  raw_weight?: number;
  commits?: number;
}

export interface NetworkStats {
  total_contributors: number;
  total_collaborations: number;
  graph_density: number;
  has_networkx: boolean;
}

export interface AstFunction {
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  parameters: string[];
  primary_owner: string | null;
  primary_ownership_pct: number | null;
  cyclomatic_complexity: number;
  docstring_preview: string;
  github_url?: string;
  ownership_basis?: string;
}

export interface RepoFile {
  path: string;
  language: string;
  contributors: string[];
  file_url?: string;
  lines?: number | null;
  commits?: number;
  contributor_commits?: Record<string, number>;

}

export interface CommitItem {
  sha: string;
  author: string;
  message: string;
  files: string[];
  date: string;
  commit_url?: string;
}

export interface PullRequestItem {
  id: number;
  title: string;
  author: string;
  reviewers: string[];
  state: string;
  body: string;
  pr_url?: string;
}

export interface RepoAnalysisData {
  repo_name: string;
  repo_url?: string;
  depth: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  network_stats: NetworkStats;
  ast_functions: AstFunction[];
  files: RepoFile[];
  commits?: CommitItem[];
  prs?: PullRequestItem[];
  data_source?: { token_used: boolean; blame_used: boolean; parser: string; warnings: string[]; fetched_at: string };
}

export interface GroundedEvidenceDoc {
  id: string;
  text: string;
  type: string;
  citation: string;
  metadata: Record<string, any>;
  url?: string;
  people?: string[]
}

export interface RagResponse {
  answer: string;
  citations: string[];
  evidence: GroundedEvidenceDoc[];
  query: string;
}
