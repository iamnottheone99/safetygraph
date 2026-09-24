# SafetyGraph / VerifiedRAG 🛡️

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-69%20Passing-brightgreen.svg)](https://jestjs.io/)
[![Model-Provider Agnostic](https://img.shields.io/badge/LLM-Model--Provider%20Agnostic-orange.svg)](#-supported-llm-providers)

**SafetyGraph** is an open-source, **model-provider-agnostic**, headless hybrid RAG engine designed to enforce **deterministic guardrails** and hard constraints onto LLM generation pipelines.

By synthesizing the semantic adaptability of **Vector Search (`pgvector`)** with the non-negotiable relational logic of a **Knowledge Graph (`Neo4j`)**, SafetyGraph prevents hallucinations, enforces domain compliance, and protects downstream applications across any LLM provider (Anthropic, OpenAI, local Ollama, Groq, DeepSeek, OpenRouter, or custom endpoints).

---

## 🏗️ Architecture

> 💡 **Interactive Architecture Diagram**: An interactive, full-system architecture diagram is viewable at [`safetygraph-architecture.html`](safetygraph-architecture.html) (authored and rendered via Archify).

```
                                  ┌────────────────────────┐
                                  │   User Request Query   │
                                  └───────────┬────────────┘
                                              │
                                              ▼
                             ┌─────────────────────────────────┐
                             │    1. Input Guardrails Check    │
                             │  (XSS, SQLi, Prompt Injections) │
                             └───────────────┬─────────────────┘
                                             │
                      ┌──────────────────────┴──────────────────────┐
                      ▼                                             ▼
       ┌──────────────────────────────┐              ┌──────────────────────────────┐
       │   Semantic Vector Search     │              │    Deterministic Knowledge   │
       │    (PostgreSQL / pgvector)   │              │         Graph (Neo4j)        │
       │    Context Chunks & Docs     │              │    Hard Entity Constraints   │
       └──────────────┬───────────────┘              └──────────────┬───────────────┘
                      │                                             │
                      └──────────────────────┬──────────────────────┘
                                             │
                                             ▼
                             ┌─────────────────────────────────┐
                             │       Prompt Synthesizer        │
                             │  (Context + Mandatory Guidance) │
                             └───────────────┬─────────────────┘
                                             │
                                             ▼
                             ┌─────────────────────────────────┐
                             │  LLM Generation (Any Provider)  │
                             │ Anthropic / OpenAI / Ollama /   │
                             │ Groq / DeepSeek / OpenRouter    │
                             │    Circuit-Breaker Protected    │
                             └───────────────┬─────────────────┘
                                             │
                                             ▼
                             ┌─────────────────────────────────┐
                             │    2. Semantic Output Guard     │
                             │  (Deterministic Contraindication│
                             │    Verification & Sanitization) │
                             └───────────────┬─────────────────┘
                                             │
                                             ▼
                               ┌───────────────────────────┐
                               │ Verified Safe RAG Payload │
                               └───────────────────────────┘
```

---

## ✨ Features

- **Dual-Retrieval Pipeline**: Simultaneously queries PostgreSQL `pgvector` for broad semantic relevance (using true cosine distance `<=>`) and Neo4j for strict entity-constraint mappings.
- **Provider-Agnostic LLM Tier**: Switch effortlessly between **Anthropic**, **OpenAI**, local **Ollama** (free/offline), **Groq**, **DeepSeek**, **OpenRouter**, or custom OpenAI-compatible endpoints with auto-detection and resilient mock fallback.
- **Real-Time SSE Streaming**: Native Server-Sent Events (`POST /api/v1/rag/stream`) emit initial retrieval context, real-time token chunks, and final guardrail verification.
- **Resilient Multi-Tier Caching**: Backed by Redis with automatic fallback to an in-memory TTL store, caching verified responses to cut latency and API token costs.
- **Deterministic Guardrails**: Validates input against prompt injection patterns and semantically verifies AI completions against active domain rules before dispatching to users.
- **Fault-Tolerant Circuit Breakers**: Built-in state machine breakers (`CLOSED` → `OPEN` → `HALF_OPEN`) safeguarding calls to LLM providers, Neo4j, PostgreSQL, and Redis.
- **Dynamic Ingestion APIs**: Standard REST endpoints for indexing vector documents (`POST /documents`) and registering knowledge graph constraints (`POST /constraints`).
- **Offline & Testing Resilient**: Seamless in-memory fallback stores allow the engine to be tested or evaluated in local environments even before external database containers are booted.

---

## 🤖 Supported LLM Providers

SafetyGraph is completely decoupled from any single LLM vendor. Configure your provider in `.env` using `LLM_PROVIDER`:

| Provider | `LLM_PROVIDER` | Default Model | Configuration Required |
| :--- | :--- | :--- | :--- |
| **Mock (Default)** | `mock` | `deterministic-mock-v1` | None (Runs offline, zero cost) |
| **Anthropic** | `anthropic` | `claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `openai` | `gpt-4o` | `OPENAI_API_KEY` |
| **Local Ollama** | `ollama` | `llama3.2` | `OLLAMA_BASE_URL` (default: `http://localhost:11434/v1`) |
| **Groq Cloud** | `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| **DeepSeek** | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| **OpenRouter** | `openrouter` | `anthropic/claude-3.5-sonnet` | `OPENROUTER_API_KEY` |
| **Custom Endpoint** | `custom` | `custom-model` | `CUSTOM_LLM_BASE_URL`, `CUSTOM_LLM_API_KEY` |

> 💡 **Auto-Detection:** If `LLM_PROVIDER` is not set, SafetyGraph automatically selects the provider matching whichever API key is set in `.env` (e.g. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`), falling back to `mock` if none are found.

---

## 🚀 Quickstart

### 1. Prerequisites
- **Node.js** >= 18
- **Docker** & **Docker Compose** (for database infrastructure)

### 2. Setup Environment
Clone the repository and copy the environment template:
```bash
cp .env.example .env
```

### 3. Start Infrastructure & App via Docker
Spin up PostgreSQL (with `pgvector`), Neo4j, Redis, and the SafetyGraph Engine:
```bash
docker compose up -d
```

Or run locally with Node.js:
```bash
npm install
npm run build
npm run dev
```
The server will start at `http://localhost:4000`.

---

## 📡 API Reference

### Health Check
```http
GET /health
```
**Response:**
```json
{
  "status": "ok",
  "service": "SafetyGraph Engine",
  "databases": {
    "postgres": true,
    "neo4j": true,
    "redis": true
  },
  "timestamp": "2026-09-07T07:50:00.000Z"
}
```

### Circuit Breakers Status
```http
GET /api/v1/rag/circuits
```
Returns real-time operational status and failure metrics for all active service circuits:
```json
{
  "circuits": [
    {
      "name": "llm-provider",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 0,
      "lastFailureTime": null
    },
    {
      "name": "neo4j",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 0,
      "lastFailureTime": null
    },
    {
      "name": "postgres",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 0,
      "lastFailureTime": null
    },
    {
      "name": "redis",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 0,
      "lastFailureTime": null
    }
  ]
}
```

### Execute Verified Query
```http
POST /api/v1/rag/query
Content-Type: application/json

{
  "query": "Should the patient take ibuprofen for severe fever?",
  "entities": ["asthma", "ibuprofen"]
}
```

**Compliant Response (HTTP 200):**
```json
{
  "response": "Based on verified clinical guidelines, ibuprofen is contraindicated due to asthma. Acetaminophen may be considered as an alternative.",
  "constraints_applied": [
    "Patient has severe asthma; avoid NSAIDs like ibuprofen"
  ],
  "vector_sources": [
    { "id": "doc_med_01", "similarity": 0.9 }
  ],
  "provider": {
    "name": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  },
  "safety_verified": true,
  "cached": false
}
```

### Real-Time SSE Streaming Query
```http
POST /api/v1/rag/stream
Content-Type: application/json

{
  "query": "What are safe analgesic alternatives for patients with asthma?",
  "entities": ["asthma"]
}
```

**Stream Protocol (`text/event-stream`):**
```
event: metadata
data: {"constraints_applied":["Patient has severe asthma; avoid NSAIDs like ibuprofen"],"vector_sources":[{"id":"doc_med_02","similarity":0.9}],"provider":{"name":"mock","model":"deterministic-mock-v1"}}

event: chunk
data: {"chunk":"According "}

event: chunk
data: {"chunk":"to verified "}

event: chunk
data: {"chunk":"reference material: ..."}

event: done
data: {"safe":true,"response":"According to verified reference material: Acetaminophen..."}
```

### Document Ingestion
```http
POST /api/v1/rag/documents
Content-Type: application/json

{
  "id": "doc_cardio_01",
  "content": "Beta-blockers can induce bronchospasm in asthmatic patients.",
  "metadata": { "category": "cardiology" }
}
```

### Knowledge Graph Constraint Ingestion
```http
POST /api/v1/rag/constraints
Content-Type: application/json

{
  "entity": "propranolol",
  "constraint": "Contraindicated in patients with active asthma"
}
```

---

## 🧪 Testing

The repository contains automated unit and integration tests powered by Jest:

```bash
# Run test suite (69 tests across circuits, guardrails, providers, caching, lifecycle, and routes)
npm test

# Run test suite with coverage report
npm run test:coverage
```

---

## 📜 License

Licensed under the [Apache License, Version 2.0](LICENSE).
