# Repo-Contributor Graph Visualizer with RAG

A system that models GitHub repositories as contributor graphs and leverages Retrieval-Augmented Generation (RAG) to provide grounded insights into code ownership, collaboration patterns, and developer roles.

### Overview

Modern software repositories accumulate contributions from many developers, making it difficult for newcomers to identify code ownership and understand relationships between contributors. This project solves this by visualizing the repository as a graph, where nodes represent contributors and edges capture relationships based on shared files, function-level ownership, and pull request review activity.

The system integrates an AI-driven RAG pipeline to generate citation-grounded explanations for contributor roles, areas of ownership, and the reasons behind specific collaboration patterns.

### Key Features

- **Graph Visualization**: Interactive graph representation using `React` and `TypeScript`.
- **AST Attribution**: Uses `Tree-sitter` for precise function-level attribution.
- **AI-Powered Insights**: RAG pipeline providing natural-language explanations for graph connections.
- **Semantic Retrieval**: `ChromaDB` integration for querying commit history, pull requests, and codebase semantics.
- **Data Integration**: Uses GitHub REST/GraphQL APIs with `OAuth` for secure repository access.

### Technology Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | React, TypeScript |
| **Backend** | FastAPI |
| **Graph Logic** | NetworkX |
| **Vector DB** | ChromaDB |
| **Code Parsing** | Tree-sitter |
| **Storage** | PostgreSQL |
| **Deployment** | Docker Compose, GitHub Actions |

### Architecture

The system follows a modular architecture to ingest, process, and serve repository insights.

```mermaid
flowchart TD
  %% Source Data
  GH[GitHub API] --> Pipeline[Ingestion Pipeline]
  
  subgraph DataProcessing [Data Processing & Storage]
    Pipeline --> AST[Tree-sitter AST Analysis]
    Pipeline --> GitData[Commit/PR History]
    AST --> Graph[NetworkX Graph Construction]
    GitData --> Chroma[ChromaDB Vector Store]
    Graph --> PG[(PostgreSQL)]
  end
  
  subgraph Intelligence [RAG Engine]
    PG --> RAG[FastAPI + RAG Logic]
    Chroma --> RAG
    RAG --> LLM[LLM / Query Processor]
  end
  
  subgraph Frontend [User Interface]
    Client[React/TypeScript Dashboard]
    Client --> Viz[Graph Visualization]
    Client --> Explanation[Citation-Grounded Explanations]
  end
  
  %% Connections
  Graph --> Client
  LLM --> Explanation
  
  %% Deployment
  Docker[Docker Compose] -- orchestrates --> DataProcessing
  Docker -- orchestrates --> Intelligence
  Docker -- orchestrates --> Client
