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
}

export interface FileNode {
  id: string;
  type: 'file';
  label: string;
  full_path: string;
  language: string;
  lines: number;
  color: string;
  file_url?: string;
  x?: number;
  y?: number;
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
  primary_owner: string;
  primary_ownership_pct: number;
  cyclomatic_complexity: number;
  docstring_preview: string;
  github_url?: string;
}

export interface RepoFile {
  path: string;
  language: string;
  lines: number;
  contributors: string[];
  file_url?: string;
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
}

export interface GroundedEvidenceDoc {
  id: string;
  text: string;
  type: string;
  citation: string;
  metadata: Record<string, any>;
}

export interface RagResponse {
  answer: string;
  citations: string[];
  evidence: GroundedEvidenceDoc[];
  query: string;
}
