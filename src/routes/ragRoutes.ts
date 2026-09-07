import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { aiService } from '../services/aiService';
import { validateInput, validateSafety, sanitizeOutput } from '../services/guardrails';
import { graphContextService } from '../services/graphContextService';
import { vectorService } from '../services/vectorService';
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
 * Dual-Retrieval Verified RAG Query Endpoint
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

      return res.json({
        response: sanitized,
        constraints_applied: constraints,
        vector_sources: vectorContext.map(v => ({ id: v.id, similarity: v.similarity })),
        provider: aiService.getProviderInfo(),
        safety_verified: true
      });
    } catch (error: any) {
      logger.error(error, 'Error executing /query');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        error: error.errorCode || 'E_INTERNAL',
        message: error.message || 'An internal error occurred.'
      });
    }
});

export default router;
