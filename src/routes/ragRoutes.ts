import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { aiService } from '../services/aiService';
import { validateInput, validateSafety, sanitizeOutput } from '../services/guardrails';
import { graphContextService } from '../services/graphContextService';
import { vectorService } from '../services/vectorService';
import { cacheService } from '../services/cacheService';
import { circuitManager } from '../utils/circuitBreaker';
import pino from 'pino';

const logger = pino();
const router = Router();

/**
 * Health & Circuit Status Endpoint
 */
router.get('/circuits', (req: Request, res: Response) => {
  res.json({
    circuits: circuitManager.getAllStatuses()
  });
});

/**
 * Dual-Retrieval Verified RAG Query Endpoint (with Semantic Caching)
 */
router.post('/query', 
  body('query').isString().notEmpty().withMessage('query string is required'),
  body('entities').isArray().optional().withMessage('entities must be an array of strings'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { query, entities = [] } = req.body;
      
      // 1. Input Guardrails
      validateInput(query);

      // Check cache for identical query + entity payload
      const sortedEntities = [...entities].sort().join(',');
      const cacheKey = `rag:query:${Buffer.from(query.trim().toLowerCase() + '::' + sortedEntities).toString('base64url')}`;
      const cached = await cacheService.get<any>(cacheKey);
      if (cached) {
        logger.info({ cacheKey }, 'Serving cached verified RAG response');
        return res.json({ ...cached, cached: true });
      }

      // 2. Dual-Retrieval:
      // a. Semantic Vector Retrieval (pgvector)
      const vectorContext = await vectorService.searchSimilar(query, 3);
      logger.info({ vectorMatches: vectorContext.length }, 'Retrieved vector context');

      // b. Deterministic Knowledge Graph Retrieval (Neo4j Hard Constraints)
      const constraints = await graphContextService.getHardConstraints(entities);
      logger.info({ constraintsCount: constraints.length }, 'Retrieved hard constraints');

      // 3. AI Generation
      const rawResponse = await aiService.generateResponse({
        query,
        contextData: { 
          constraints,
          vectorContext
        }
      });

      // 4. Output Sanitization & Semantic Guardrail Verification
      const sanitized = sanitizeOutput(rawResponse);
      const safetyCheck = validateSafety(sanitized, { hardConstraints: constraints });

      if (!safetyCheck.safe) {
        logger.warn({ issues: safetyCheck.issues }, 'Generated output failed safety constraints');
        return res.status(403).json({
          error: 'E_GUARDRAIL',
          message: 'The generated response violated hard safety constraints.',
          issues: safetyCheck.issues
        });
      }

      const payload = {
        response: sanitized,
        constraints_applied: constraints,
        vector_sources: vectorContext.map(v => ({ id: v.id, similarity: v.similarity })),
        provider: aiService.getProviderInfo(),
        safety_verified: true,
        cached: false,
      };

      // Cache verified response with 1h TTL
      await cacheService.set(cacheKey, payload, 3600);

      return res.json(payload);
    } catch (error: any) {
      logger.error(error, 'Error executing /query');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        error: error.errorCode || 'E_INTERNAL',
        message: error.message || 'An internal error occurred.'
      });
    }
});

/**
 * Real-Time Server-Sent Events (SSE) Streaming RAG Endpoint
 */
router.post('/stream',
  body('query').isString().notEmpty().withMessage('query string is required'),
  body('entities').isArray().optional().withMessage('entities must be an array of strings'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { query, entities = [] } = req.body;

      // 1. Input Guardrails
      validateInput(query);

      // 2. Dual-Retrieval:
      const [vectorContext, constraints] = await Promise.all([
        vectorService.searchSimilar(query, 3),
        graphContextService.getHardConstraints(entities)
      ]);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send initial retrieval metadata event
      res.write(`event: metadata\ndata: ${JSON.stringify({
        constraints_applied: constraints,
        vector_sources: vectorContext.map(v => ({ id: v.id, similarity: v.similarity })),
        provider: aiService.getProviderInfo()
      })}\n\n`);

      // 3. Stream AI Generation
      let synthesizedResponse = '';
      await aiService.streamResponse({
        query,
        contextData: { constraints, vectorContext }
      }, (chunk: string) => {
        synthesizedResponse += chunk;
        res.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
      });

      // 4. Output Sanitization & Semantic Guardrail Verification
      const sanitized = sanitizeOutput(synthesizedResponse);
      const safetyCheck = validateSafety(sanitized, { hardConstraints: constraints });

      if (!safetyCheck.safe) {
        logger.warn({ issues: safetyCheck.issues }, 'Streamed output failed safety constraints');
        res.write(`event: guardrail_violation\ndata: ${JSON.stringify({
          safe: false,
          error: 'E_GUARDRAIL',
          message: 'The generated response violated hard safety constraints.',
          issues: safetyCheck.issues
        })}\n\n`);
        return res.end();
      }

      res.write(`event: done\ndata: ${JSON.stringify({
        safe: true,
        response: sanitized
      })}\n\n`);

      return res.end();
    } catch (error: any) {
      logger.error(error, 'Error executing /stream');
      const statusCode = error.statusCode || 500;
      if (!res.headersSent) {
        res.status(statusCode).json({
          error: error.errorCode || 'E_INTERNAL',
          message: error.message || 'An internal error occurred.'
        });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({
          error: error.errorCode || 'E_INTERNAL',
          message: error.message || 'Stream terminated abnormally.'
        })}\n\n`);
        res.end();
      }
    }
});

/**
 * Document Ingestion Endpoint for Vector Database
 */
router.post('/documents',
  body('id').isString().notEmpty().withMessage('id is required'),
  body('content').isString().notEmpty().withMessage('content is required'),
  body('metadata').isObject().optional().withMessage('metadata must be an object'),
  body('embedding').isArray().optional().withMessage('embedding must be an array of numbers'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id, content, metadata, embedding } = req.body;
      validateInput(content);

      await vectorService.upsertDocument(id, content, embedding, metadata);

      return res.status(201).json({
        status: 'ok',
        message: `Document '${id}' successfully indexed into vector store.`,
        id
      });
    } catch (error: any) {
      logger.error(error, 'Error ingesting document');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        error: error.errorCode || 'E_INTERNAL',
        message: error.message || 'An internal error occurred.'
      });
    }
});

/**
 * Knowledge Graph Constraint Ingestion Endpoint
 */
router.post('/constraints',
  body('entity').isString().notEmpty().withMessage('entity is required'),
  body('constraint').isString().notEmpty().withMessage('constraint is required'),
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { entity, constraint } = req.body;
      validateInput(constraint);

      graphContextService.registerConstraint(entity, constraint);

      return res.status(201).json({
        status: 'ok',
        message: `Constraint for entity '${entity}' successfully registered.`,
        entity,
        constraint
      });
    } catch (error: any) {
      logger.error(error, 'Error registering constraint');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        error: error.errorCode || 'E_INTERNAL',
        message: error.message || 'An internal error occurred.'
      });
    }
});

export default router;
