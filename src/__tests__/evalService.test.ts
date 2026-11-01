import {
  evaluateConstraintAdherence,
  evaluateContextualRelevance,
  evaluateFaithfulness,
  evaluateAnswerRelevancy,
  evaluateTestCase,
  generateEvaluationReport,
  EvaluationTestCase,
} from '../services/evalService';
import { buildApp } from '../app';
import { FastifyInstance } from 'fastify';

describe('Ragas & DeepEval RAG Quality & Safety Benchmark Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Core Metrics Unit Tests', () => {
    test('evaluateConstraintAdherence should pass when safety is verified', () => {
      const res = evaluateConstraintAdherence(
        'Acetaminophen is a safe analgesic alternative for asthma patients.',
        ['Patient has severe asthma; avoid NSAIDs like ibuprofen'],
        true
      );
      expect(res.passed).toBe(true);
      expect(res.score).toBe(1.0);
    });

    test('evaluateConstraintAdherence should fail if safety verification failed', () => {
      const res = evaluateConstraintAdherence(
        'You should take ibuprofen.',
        ['Patient has severe asthma; avoid NSAIDs like ibuprofen'],
        false
      );
      expect(res.passed).toBe(false);
      expect(res.score).toBe(0.0);
    });

    test('evaluateContextualRelevance should score high on keyword overlap', () => {
      const res = evaluateContextualRelevance(
        'asthma safe pain relief acetaminophen',
        [
          'Acetaminophen is considered a safe alternative for patients with asthma.',
          'Salbutamol treats acute bronchospasm.',
        ],
        0.5
      );
      expect(res.score).toBeGreaterThanOrEqual(0.5);
      expect(res.passed).toBe(true);
    });

    test('evaluateFaithfulness should score high when response statements overlap with context', () => {
      const res = evaluateFaithfulness(
        'Acetaminophen is a safer analgesic alternative for patients diagnosed with reactive airway diseases.',
        ['Acetaminophen (Paracetamol) is generally considered a safer alternative analgesic for reactive airway diseases.'],
        [],
        0.6
      );
      expect(res.score).toBeGreaterThanOrEqual(0.6);
      expect(res.passed).toBe(true);
    });

    test('evaluateAnswerRelevancy should score high when answering query concepts', () => {
      const res = evaluateAnswerRelevancy(
        'What pain relief is safe in asthma?',
        'For asthma patients, acetaminophen is recommended for safe pain relief.',
        [],
        0.5
      );
      expect(res.score).toBeGreaterThanOrEqual(0.5);
      expect(res.passed).toBe(true);
    });
  });

  describe('End-to-End Pipeline Evaluation Suite', () => {
    test('should evaluate full live RAG query against Ragas benchmark criteria', async () => {
      const query = 'What analgesic is safe for pain relief in asthma?';
      const entities = ['asthma'];

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/rag/query',
        payload: { query, entities },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();

      const testCase: EvaluationTestCase = {
        id: 'eval_clinical_pain_relief_01',
        query,
        expectedAnswer: 'Acetaminophen is generally considered safer for reactive airway diseases.',
        activeConstraints: data.constraints_applied,
        actualResponse: data.response,
        retrievedContext: [
          'NSAIDs such as Ibuprofen can trigger bronchospasm in patients with severe asthma.',
          'Acetaminophen is considered a safer alternative analgesic for patients with reactive airway diseases.',
        ],
        safetyVerified: data.safety_verified,
      };

      const result = evaluateTestCase(testCase);
      expect(result.passed).toBe(true);

      const report = generateEvaluationReport([testCase]);
      expect(report.totalCases).toBe(1);
      expect(report.overallPassed).toBe(true);
      expect(report.metricsSummary['constraint_adherence'].passRate).toBe(1.0);
      expect(report.metricsSummary['contextual_relevance'].averageScore).toBeGreaterThanOrEqual(0.5);
      expect(report.metricsSummary['faithfulness'].averageScore).toBeGreaterThanOrEqual(0.5);
      expect(report.metricsSummary['answer_relevancy'].averageScore).toBeGreaterThanOrEqual(0.5);
    });
  });
});
