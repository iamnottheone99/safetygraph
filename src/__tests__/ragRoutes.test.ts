import request from 'supertest';
import app from '../app';
import { graphContextService } from '../services/graphContextService';
import { vectorService } from '../services/vectorService';
import { cacheService } from '../services/cacheService';

describe('RAG API Routes Integration', () => {
  afterAll(async () => {
    await graphContextService.close();
    await vectorService.close();
    await cacheService.close();
  });

  describe('GET /health', () => {
    test('should return 200 OK with service status and database health', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('SafetyGraph Engine');
      expect(res.body).toHaveProperty('databases');
    });
  });

  describe('GET /api/v1/rag/circuits', () => {
    test('should return circuit breaker status list', async () => {
      const res = await request(app).get('/api/v1/rag/circuits');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('circuits');
      expect(Array.isArray(res.body.circuits)).toBe(true);
    });
  });

  describe('POST /api/v1/rag/query', () => {
    test('should reject missing query with 400', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('errors');
    });

    test('should reject malicious script injection input with 400', async () => {
      const res = await request(app)
        .post('/api/v1/rag/query')
        .send({ query: '<script>alert("hack")</script>' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('E_GUARDRAIL');
    });

    test('should execute full verified dual-retrieval pipeline for valid queries', async () => {
      const queryPayload = {
        query: 'Is acetaminophen safe for pain relief in asthma?',
        entities: ['asthma', 'acetaminophen'],
      };

      const res = await request(app)
        .post('/api/v1/rag/query')
        .send(queryPayload);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('response');
      expect(res.body).toHaveProperty('constraints_applied');
      expect(res.body).toHaveProperty('vector_sources');
      expect(res.body.safety_verified).toBe(true);
      expect(res.body.cached).toBe(false);

      // Repeated query should hit cache
      const cachedRes = await request(app)
        .post('/api/v1/rag/query')
        .send(queryPayload);

      expect(cachedRes.status).toBe(200);
      expect(cachedRes.body.cached).toBe(true);
      expect(cachedRes.body.response).toBe(res.body.response);
    });
  });

  describe('POST /api/v1/rag/stream', () => {
    test('should reject invalid or malicious query with 400', async () => {
      const res = await request(app)
        .post('/api/v1/rag/stream')
        .send({ query: '<script>evil()</script>' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('E_GUARDRAIL');
    });

    test('should stream response as Server-Sent Events with metadata, chunks, and verification', async () => {
      const res = await request(app)
        .post('/api/v1/rag/stream')
        .send({
          query: 'What are safe pain relief options for asthmatic patients?',
          entities: ['asthma']
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: metadata');
      expect(res.text).toContain('event: chunk');
      expect(res.text).toContain('event: done');
      expect(res.text).toContain('"safe":true');
    });
  });

  describe('POST /api/v1/rag/documents', () => {
    test('should reject invalid document payloads with 400', async () => {
      const res = await request(app)
        .post('/api/v1/rag/documents')
        .send({ id: '' });
      expect(res.status).toBe(400);
    });

    test('should successfully ingest document into vector store', async () => {
      const res = await request(app)
        .post('/api/v1/rag/documents')
        .send({
          id: 'doc_ingest_test_01',
          content: 'Beta-blockers can cause bronchospasm in susceptible asthmatic patients.',
          metadata: { category: 'cardiology' }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.id).toBe('doc_ingest_test_01');
    });
  });

  describe('POST /api/v1/rag/constraints', () => {
    test('should reject invalid constraint payloads with 400', async () => {
      const res = await request(app)
        .post('/api/v1/rag/constraints')
        .send({});
      expect(res.status).toBe(400);
    });

    test('should successfully register hard constraint for entity', async () => {
      const res = await request(app)
        .post('/api/v1/rag/constraints')
        .send({
          entity: 'propranolol',
          constraint: 'Contraindicated in bronchial asthma'
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.entity).toBe('propranolol');
    });
  });
});
