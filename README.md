# SafetyGraph / VerifiedRAG 🛡️

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-40%20Passing-brightgreen.svg)](https://jestjs.io/)

**SafetyGraph** is an open-source, headless hybrid RAG engine designed to enforce **deterministic guardrails** and hard constraints onto LLM generation pipelines.

By synthesizing the semantic adaptability of **Vector Search (`pgvector`)** with the non-negotiable relational logic of a **Knowledge Graph (`Neo4j`)**, SafetyGraph prevents hallucinations, enforces domain compliance, and protects downstream applications across any LLM provider.

---

## 🏗️ Architecture

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

- **Dual-Retrieval Pipeline**: Simultaneously queries PostgreSQL `pgvector` for broad semantic relevance and Neo4j for strict entity-constraint mappings.
- **Provider-Agnostic LLM Tier**: Switch effortlessly between **Anthropic**, **OpenAI**, local **Ollama** (free/offline), **Groq**, **DeepSeek**, **OpenRouter**, or custom OpenAI-compatible endpoints with auto-detection and resilient mock fallback.
- **Deterministic Guardrails**: Validates input against prompt injection patterns and semantically verifies AI completions against active domain rules before dispatching to users.
- **Fault-Tolerant Circuit Breakers**: Built-in state machine breakers (`CLOSED` → `OPEN` → `HALF_OPEN`) safeguarding calls to LLM providers, Neo4j, and PostgreSQL.
- **Offline & Testing Resilient**: Seamless in-memory fallback stores allow the engine to be tested or evaluated in local environments even before external database containers are booted.
- **Standardized REST API**: Ready-to-integrate Express engine with route-level rate limiting, OpenAPI-ready validation, and structured Pino logging.

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

### 3. Start Database Infrastructure
Spin up PostgreSQL (with `pgvector`), Neo4j, and Redis:
```bash
docker compose up -d
```

### 4. Install Dependencies & Build
```bash
npm install
npm run build
```

### 5. Launch the Development Server
```bash
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
  "safety_verified": true
}
```

**Guardrail Violation Response (HTTP 403):**
```json
{
  "error": "E_GUARDRAIL",
  "message": "The generated response violated hard safety constraints.",
  "issues": [
    "Advice actively recommends 'ibuprofen', which violates constraint: 'Patient has severe asthma; avoid NSAIDs like ibuprofen'"
  ]
}
```

---

## 🧪 Testing

The repository contains automated unit and integration tests powered by Jest:

```bash
# Run test suite (40 tests across circuits, guardrails, providers, and routes)
npm test

# Run test suite with coverage report
npm run test:coverage
```

---

## 📜 License

Licensed under the [Apache License, Version 2.0](LICENSE).
