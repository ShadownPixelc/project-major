"""
Equinox - PostgreSQL / SQLAlchemy Data Models
Stores repository metadata, contributor profiles, Tree-sitter AST function entities,
commit histories, and precomputed NetworkX graph topology caches.
"""

from typing import Optional, List
from datetime import datetime

try:
    from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, JSON, Boolean
    from sqlalchemy.orm import declarative_base, relationship
    Base = declarative_base()
except ImportError:
    # Pure Python representation if SQLAlchemy is not installed
    class Base:
        pass


class RepositoryModel:
    """PostgreSQL table schema: repositories"""
    __tablename__ = "repositories"

    id = "id"  # String(120), primary_key=True
    owner = "owner"  # String(100), nullable=False
    name = "name"  # String(100), nullable=False
    url = "url"  # String(255)
    default_branch = "default_branch"
    stars_count = "stars_count"
    forks_count = "forks_count"
    language = "language"
    created_at = "created_at"
    last_analyzed = "last_analyzed"


class ContributorModel:
    """PostgreSQL table schema: contributors"""
    __tablename__ = "contributors"

    id = "id"  # String(100), primary_key=True
    repo_id = "repo_id"  # ForeignKey('repositories.id')
    github_login = "github_login"
    display_name = "display_name"
    avatar_url = "avatar_url"
    commits_count = "commits_count"
    prs_reviewed = "prs_reviewed"
    degree_centrality = "degree_centrality"
    betweenness_centrality = "betweenness_centrality"
    pagerank = "pagerank"
    bus_factor_risk = "bus_factor_risk"
    community_cluster = "community_cluster"
    domain_specialty = "domain_specialty"


class AstFunctionModel:
    """PostgreSQL table schema: ast_functions"""
    __tablename__ = "ast_functions"

    id = "id"  # String(150), primary_key=True
    repo_id = "repo_id"
    file_path = "file_path"
    function_name = "function_name"
    start_line = "start_line"
    end_line = "end_line"
    cyclomatic_complexity = "cyclomatic_complexity"
    parameters = "parameters"  # JSON
    primary_owner = "primary_owner"
    ownership_percentage = "ownership_percentage"


class GraphCacheModel:
    """PostgreSQL table schema: graph_cache"""
    __tablename__ = "graph_cache"

    repo_id = "repo_id"  # primary_key
    depth_level = "depth_level"  # primary_key
    graph_json = "graph_json"  # JSON
    density = "density"
    generated_at = "generated_at"
