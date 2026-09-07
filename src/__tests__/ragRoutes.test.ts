import request from 'supertest';
import app from '../app';
import { graphContextService } from '../services/graphContextService';
import { vectorService } from '../services/vectorService';

describe('RAG API Routes Integration', () => {
  afterAll(async () => {
    await graphContextService.close();
    await vectorService.close();
  });

  describe('GET /health', () => {
    test('should return 200 OK with service status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('SafetyGraph Engine');
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
      const res = await request(app)
        .post('/api/v1/rag/query')
        .send({
          query: 'Is acetaminophen safe for pain relief in asthma?',
          entities: ['asthma', 'acetaminophen'],
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('response');
      expect(res.body).toHaveProperty('constraints_applied');
      expect(res.body).toHaveProperty('vector_sources');
      expect(res.body.safety_verified).toBe(true);
    });
  });
});
