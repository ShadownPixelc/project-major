# Repo-Contributor Graph Visualizer with RAG

A system that models GitHub repositories as contributor graphs and leverages Retrieval-Augmented Generation (RAG) to provide grounded insights into code ownership, collaboration patterns, and developer roles.

## Overview

Modern software repositories accumulate contributions from many developers, making it difficult for newcomers to identify code ownership and understand relationships between contributors. This project solves this by visualizing the repository as a graph, where nodes represent contributors and edges capture relationships based on shared files, function-level ownership, and pull request review activity.

The system integrates an AI-driven RAG pipeline to generate citation-grounded explanations for contributor roles, areas of ownership, and the reasons behind specific collaboration patterns.

## Key Features

- **Graph Visualization**: Interactive graph representation using `React` and `TypeScript`.
- **AST Attribution**: Uses `Tree-sitter` for precise function-level attribution.
- **AI-Powered Insights**: RAG pipeline providing natural-language explanations for graph connections.
- **Semantic Retrieval**: `ChromaDB` integration for querying commit history, pull requests, and codebase semantics.
- **Data Integration**: Uses GitHub REST/GraphQL APIs with `OAuth` for secure repository access.

## Technology Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript |
| **Backend** | FastAPI |
| **Graph Logic** | NetworkX |
| **Vector DB** | ChromaDB |
| **Code Parsing** | Tree-sitter |
| **Storage** | PostgreSQL |
| **Deployment** | Docker Compose, GitHub Actions |

## Development Roadmap

- [ ] Build Repository Ingestion & Code Parsing Pipeline (Tree-sitter)
- [ ] Implement Code Dependency Graph & Metadata Storage (NetworkX + PostgreSQL)
- [ ] Build RAG Pipeline & Vector Search (ChromaDB)
- [ ] Integrate Contribution Insights & Graph-RAG Analysis (FastAPI)
- [ ] Create Interactive Repository Visualization (React + TypeScript)
- [ ] Dockerize & Automate Deployment (Docker Compose + GitHub Actions)
