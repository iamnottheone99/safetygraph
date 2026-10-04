import { buildApp } from '../app';
import { FastifyInstance } from 'fastify';

describe('RAG API Routes Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    test('should return 200 OK with service status and database health', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.service).toBe('SafetyGraph Engine');
      expect(body).toHaveProperty('databases');
    });
  });

  describe('GET /api/v1/rag/circuits', () => {
    test('should return circuit breaker status list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/rag/circuits',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('circuits');
      expect(Array.isArray(body.circuits)).toBe(true);
    });
  });

  describe('POST /api/v1/rag/query', () => {
    test('should reject missing query with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/query',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toHaveProperty('errors');
    });

    test('should reject malicious script injection input with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/query',
        payload: { query: '<script>alert("hack")</script>' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('E_GUARDRAIL');
    });

    test('should execute full verified dual-retrieval pipeline for valid queries', async () => {
      const queryPayload = {
        query: 'Is acetaminophen safe for pain relief in asthma?',
        entities: ['asthma', 'acetaminophen'],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/query',
        payload: queryPayload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('response');
      expect(body).toHaveProperty('constraints_applied');
      expect(body).toHaveProperty('vector_sources');
      expect(body.safety_verified).toBe(true);
      expect(body.cached).toBe(false);

      // Repeated query should hit cache
      const cachedRes = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/query',
        payload: queryPayload,
      });

      expect(cachedRes.statusCode).toBe(200);
      const cachedBody = cachedRes.json();
      expect(cachedBody.cached).toBe(true);
      expect(cachedBody.response).toBe(body.response);
    });
  });

  describe('POST /api/v1/rag/stream', () => {
    test('should reject invalid or malicious query with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/stream',
        payload: { query: '<script>evil()</script>' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('E_GUARDRAIL');
    });

    test('should stream response as Server-Sent Events with metadata, chunks, and verification', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/stream',
        payload: {
          query: 'What are safe pain relief options for asthmatic patients?',
          entities: ['asthma'],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('event: metadata');
      expect(res.body).toContain('event: chunk');
      expect(res.body).toContain('event: done');
      expect(res.body).toContain('"safe":true');
    });
  });

  describe('POST /api/v1/rag/documents', () => {
    test('should reject invalid document payloads with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/documents',
        payload: { id: '' },
      });
      expect(res.statusCode).toBe(400);
    });

    test('should successfully ingest document into vector store', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/documents',
        payload: {
          id: 'doc_ingest_test_01',
          content: 'Beta-blockers can cause bronchospasm in susceptible asthmatic patients.',
          metadata: { category: 'cardiology' },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.id).toBe('doc_ingest_test_01');
    });
  });

  describe('POST /api/v1/rag/constraints', () => {
    test('should reject invalid constraint payloads with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/constraints',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    test('should successfully register hard constraint for entity', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/constraints',
        payload: {
          entity: 'propranolol',
          constraint: 'Contraindicated in bronchial asthma',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.entity).toBe('propranolol');
    });
  });
});
