# SafetyGraph / VerifiedRAG 🛡️

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-black.svg)](https://fastify.dev/)
[![Tests](https://img.shields.io/badge/Tests-76%20Passing-brightgreen.svg)](https://jestjs.io/)
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

## 💡 Primary Use Cases & Decision Matrix

SafetyGraph is engineered for **high-stakes, zero-tolerance environments** where hallucinations, missed contraindications, or compliance breaches carry severe regulatory, financial, or physical liability.

### 1. Clinical Decision Support & Pharmacology (Healthcare)
* **The Problem**: Pure vector search retrieves medical literature discussing various treatments. When asked about symptom management for a complex patient, LLMs frequently synthesize plausible-sounding but lethal recommendations (e.g., suggesting Ibuprofen or Naproxen to a patient with severe asthma, NSAID-induced bronchospasm, or renal insufficiency).
* **SafetyGraph Solution**: Hard contraindications are encoded in the Neo4j Knowledge Graph as deterministic relationships (e.g. `(:Condition {name: "Asthma"})-[:CONTRAINDICATES]->(:Medication {name: "Ibuprofen"})`). SafetyGraph extracts active patient entities, fetches these non-negotiable boundaries, injects them as mandatory prompt constraints, and runs post-generation semantic validation (regex patterns + local Ollama-hosted System One `tev1:0.8b`) to guarantee prohibited substances are never recommended.

### 2. Financial Regulatory & Investment Advisory (FinTech)
* **The Problem**: Conversational wealth-management bots or research tools can inadvertently make unauthorized return guarantees, recommend restricted products to non-accredited retail investors, or breach cross-border jurisdictional marketing regulations (e.g., SEC Rule 506(c), FINRA 2210, MiFID II).
* **SafetyGraph Solution**: Client accreditation tiers, jurisdiction-specific offering limits, and restricted asset lists are queried in Neo4j. If an LLM response suggests an unapproved equity or fails mandatory risk disclosure clauses, SafetyGraph blocks the completion and issues a structured `E_GUARDRAIL` violation.

### 3. Legal Contracts & Corporate Policy Enforcement
* **The Problem**: Legal copilot assistants reviewing vendor agreements or answering employee policy questions can misinterpret liability caps, indemnity obligations, or confidentiality durations across complex multi-document binders.
* **SafetyGraph Solution**: Contractual covenants and corporate safety thresholds act as non-negotiable graph constraints evaluated in tandem with semantic vector chunks from company policies.

### 4. Mission-Critical Industrial & Safety SOPs (Aviation, Energy, Manufacturing)
* **The Problem**: Field technicians querying technical manuals under time pressure may receive speculative workarounds from standard LLMs that inadvertently omit mandatory Lockout/Tagout (LOTO) procedures, toxic gas clearance steps, or high-voltage grounding checks.
* **SafetyGraph Solution**: Operational procedures and safety prerequisites are modeled as directed acyclic graph dependencies in Neo4j, ensuring mandatory procedural steps cannot be bypassed or re-ordered by generative models.

### 5. Architectural Decision Matrix: When to Choose SafetyGraph

| Evaluation Factor | Standard Vector RAG (LangChain / LlamaIndex) | GraphRAG Alone | SafetyGraph Verified Dual-Retrieval |
| :--- | :--- | :--- | :--- |
| **Retrieval Mechanism** | Probabilistic vector embeddings only | Entity graph traversals only | **Dual-Retrieval** (PostgreSQL `pgvector` + Neo4j) |
| **Negative Constraints** | ❌ Weak (LLMs ignore negative system prompt rules) | ⚠️ Partial (Complex Cypher required) | ✅ **Deterministic & Enforced** via graph & guardrails |
| **Post-Gen Validation** | ❌ None (Relies entirely on model obedience) | ❌ None | ✅ **Two-Tier Semantic Guard** (Regex + System One `tev1:0.8b`) |
| **Hallucination Risk** | High in edge cases or contradictory context | Moderate | **Near-Zero for monitored domain entities** |
| **Model Independence** | Tied to prompt formatting per model | Model-dependent prompts | ✅ **100% Provider-Agnostic** (OpenAI, Anthropic, Ollama, etc.) |
| **Resilience / Fallback** | Hard failure if database drops | Hard failure if graph drops | ✅ **Built-in Circuit Breakers & In-Memory Fallbacks** |

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

## 💻 Implementation Guide & Integration Examples

Below are production-ready code examples demonstrating how to integrate SafetyGraph into your applications and ingestion pipelines.

### Pattern 1: End-to-End Setup & Ingestion Workflow (cURL)

#### Step 1: Ingest Domain Documents into Vector Store
Index authoritative clinical or compliance guidelines into PostgreSQL `pgvector`:
```bash
curl -X POST http://localhost:4000/api/v1/rag/documents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "doc_guideline_analgesics_2026",
    "content": "Acetaminophen (paracetamol) is the first-line antipyretic and analgesic for patients with reactive airway disease or aspirin-induced asthma. NSAIDs including ibuprofen, naproxen, and ketorolac carry high risk of precipitating acute bronchospasm.",
    "metadata": { "specialty": "pulmonology", "evidence_level": "A" }
  }'
```

#### Step 2: Register Knowledge Graph Hard Constraints
Bind non-negotiable entity rules into Neo4j:
```bash
curl -X POST http://localhost:4000/api/v1/rag/constraints \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "asthma",
    "constraint": "Patient has severe reactive airway disease; strictly avoid all NSAIDs (ibuprofen, aspirin, naproxen, ketorolac)."
  }'
```

#### Step 3: Execute Verified Query
Query SafetyGraph with the active patient entities:
```bash
curl -X POST http://localhost:4000/api/v1/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What can I take for a severe headache?",
    "entities": ["asthma"]
  }'
```

---

### Pattern 2: TypeScript / Node.js Client Implementation

```typescript
import { fetch } from 'undici'; // or native globalThis.fetch in Node >= 18

interface RagResponse {
  response: string;
  constraints_applied: string[];
  vector_sources: Array<{ id: string; similarity: number }>;
  safety_verified: boolean;
  verification_engine: string;
  cached: boolean;
}

const SAFETYGRAPH_URL = process.env.SAFETYGRAPH_URL || 'http://localhost:4000';

/**
 * 1. Synchronous Verified RAG Query
 */
async function queryVerifiedRag(prompt: string, entities: string[]): Promise<RagResponse> {
  const response = await fetch(`${SAFETYGRAPH_URL}/api/v1/rag/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: prompt, entities }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    if (response.status === 403 && errorData.error === 'E_GUARDRAIL') {
      console.error('🚨 Guardrail Violation Intercepted:', errorData.issues);
      throw new Error(`SafetyGraph Guardrail Block: ${errorData.message}`);
    }
    throw new Error(`SafetyGraph Request Failed (${response.status}): ${JSON.stringify(errorData)}`);
  }

  return response.json() as Promise<RagResponse>;
}

/**
 * 2. Real-Time Server-Sent Events (SSE) Stream Consumer
 */
async function streamVerifiedRag(
  prompt: string,
  entities: string[],
  callbacks: {
    onMetadata?: (meta: any) => void;
    onChunk?: (token: string) => void;
    onDone?: (final: any) => void;
    onViolation?: (violation: any) => void;
  }
) {
  const response = await fetch(`${SAFETYGRAPH_URL}/api/v1/rag/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: prompt, entities }),
  });

  if (!response.body) throw new Error('Response body unavailable for streaming');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const eventBlock of events) {
      if (!eventBlock.trim()) continue;
      const lines = eventBlock.split('\n');
      const eventType = lines.find((l) => l.startsWith('event:'))?.replace('event:', '').trim();
      const dataStr = lines.find((l) => l.startsWith('data:'))?.replace('data:', '').trim();

      if (!dataStr) continue;
      const data = JSON.parse(dataStr);

      switch (eventType) {
        case 'metadata':
          callbacks.onMetadata?.(data);
          break;
        case 'chunk':
          callbacks.onChunk?.(data.chunk);
          break;
        case 'guardrail_violation':
          callbacks.onViolation?.(data);
          break;
        case 'done':
          callbacks.onDone?.(data);
          break;
      }
    }
  }
}

// Example usage:
async function run() {
  const result = await queryVerifiedRag('Can I take ibuprofen?', ['asthma']);
  console.log('Verified Output:', result.response);
}
```

---

### Pattern 3: Python Client Implementation (`httpx`)

```python
import json
import httpx

SAFETYGRAPH_URL = "http://localhost:4000"

def query_safetygraph(query: str, entities: list[str]) -> dict:
    """Execute synchronous verified RAG query."""
    with httpx.Client(base_url=SAFETYGRAPH_URL, timeout=30.0) as client:
        res = client.post(
            "/api/v1/rag/query",
            json={"query": query, "entities": entities}
        )
        if res.status_code == 403:
            err = res.json()
            print(f"🚨 Blocked by Guardrail: {err.get('issues')}")
            return {"blocked": True, "error": err}
        
        res.raise_for_status()
        return res.json()

def stream_safetygraph(query: str, entities: list[str]):
    """Stream real-time tokens and handle verification events via SSE."""
    with httpx.Client(base_url=SAFETYGRAPH_URL, timeout=60.0) as client:
        with client.stream(
            "POST",
            "/api/v1/rag/stream",
            json={"query": query, "entities": entities}
        ) as response:
            buffer = ""
            for line in response.iter_lines():
                if not line.strip():
                    continue
                if line.startswith("event: "):
                    event_type = line[len("event: "):].strip()
                elif line.startswith("data: "):
                    payload = json.loads(line[len("data: "):])
                    if event_type == "metadata":
                        print(f"📦 Context retrieved from: {payload.get('vector_sources')}")
                    elif event_type == "chunk":
                        print(payload.get("chunk"), end="", flush=True)
                    elif event_type == "guardrail_violation":
                        print(f"\n🚨 Intercepted Violation: {payload.get('issues')}")
                    elif event_type == "done":
                        print(f"\n✅ Generation verified safe via {payload.get('verification_engine')}")

if __name__ == "__main__":
    stream_safetygraph(
        query="What antipyretic medication is safe for acute fever?",
        entities=["asthma"]
    )
```

---

### Pattern 4: Direct In-Process Service Integration (Internal Node.js Microservice)

If you are incorporating SafetyGraph directly inside an existing Node.js or TypeScript application without HTTP overhead:

```typescript
import { buildApp } from './app';
import { vectorService } from './services/vectorService';
import { graphContextService } from './services/graphContextService';
import { aiService } from './services/aiService';
import { validateSafetyAsync, sanitizeOutput } from './services/guardrails';

async function executeInternalVerifiedPipeline(query: string, entities: string[]) {
  // 1. Dual-retrieval
  const [vectorDocs, hardConstraints] = await Promise.all([
    vectorService.searchSimilar(query, 3),
    graphContextService.getHardConstraints(entities)
  ]);

  // 2. Synthesize AI completion
  const rawCompletion = await aiService.generateResponse({
    query,
    contextData: { constraints: hardConstraints, vectorContext: vectorDocs }
  });

  // 3. Post-generation semantic guardrail validation (Regex + System One tev1:0.8b)
  const sanitized = sanitizeOutput(rawCompletion);
  const safety = await validateSafetyAsync(sanitized, { hardConstraints });

  if (!safety.safe) {
    throw new Error(`Safety violation: ${safety.issues.join(', ')}`);
  }

  return {
    response: sanitized,
    sources: vectorDocs,
    constraints: hardConstraints,
    verification: safety.evaluationMetadata
  };
}
```

---

### Pattern 5: Guardrail Violation Handling & Audit Logging

When an LLM attempts to generate a response violating domain constraints, SafetyGraph returns HTTP 403:

```json
{
  "error": "E_GUARDRAIL",
  "message": "The generated response violated hard safety constraints.",
  "issues": [
    "Output recommends prohibited entity 'ibuprofen' which violates constraint: 'Patient has severe reactive airway disease; strictly avoid all NSAIDs.'"
  ],
  "verification": {
    "evaluatedBy": "systemone",
    "latencyMs": 42,
    "confidenceScore": 0.98
  }
}
```

Client applications should handle this response by:
1. **Fallback Routing**: Providing a verified fallback (e.g., standard clinical disclaimer or escalation message).
2. **Compliance Auditing**: Forwarding `issues` and `verification` metadata to security or compliance incident queues.
3. **Model Fine-Tuning / RLHF Loop**: Storing blocked queries to refine prompt schemas or fine-tune downstream reasoning models.

---

## 🧪 Testing

The repository contains automated unit and integration tests powered by Jest and Fastify's native in-memory `app.inject()` harness:

```bash
# Run test suite (76 tests across circuits, guardrails, providers, caching, lifecycle, and routes)
npm test

# Run test suite with coverage report
npm run test:coverage
```

---

## 📜 License

Licensed under the [Apache License, Version 2.0](LICENSE).
