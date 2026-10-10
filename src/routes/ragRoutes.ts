import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { aiService } from '../services/aiService';
import { validateInput, validateSafetyAsync, sanitizeOutput } from '../services/guardrails';
import { graphContextService } from '../services/graphContextService';
import { vectorService } from '../services/vectorService';
import { cacheService } from '../services/cacheService';
import { circuitManager } from '../utils/circuitBreaker';

interface QueryBody {
  query: string;
  entities?: string[];
}

interface DocumentBody {
  id: string;
  content: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

interface ConstraintBody {
  entity: string;
  constraint: string;
}

const querySchema = {
  body: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1 },
      entities: {
        type: 'array',
        items: { type: 'string' },
        default: [],
      },
    },
  },
};

const documentSchema = {
  body: {
    type: 'object',
    required: ['id', 'content'],
    properties: {
      id: { type: 'string', minLength: 1 },
      content: { type: 'string', minLength: 1 },
      metadata: { type: 'object', default: {} },
      embedding: {
        type: 'array',
        items: { type: 'number' },
      },
    },
  },
};

const constraintSchema = {
  body: {
    type: 'object',
    required: ['entity', 'constraint'],
    properties: {
      entity: { type: 'string', minLength: 1 },
      constraint: { type: 'string', minLength: 1 },
    },
  },
};

export default async function ragRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  /**
   * Health & Circuit Status Endpoint
   */
  fastify.get('/circuits', async (_request: FastifyRequest, _reply: FastifyReply) => {
    return {
      circuits: circuitManager.getAllStatuses(),
    };
  });

  /**
   * Dual-Retrieval Verified RAG Query Endpoint (with Semantic Caching)
   */
  fastify.post<{ Body: QueryBody }>('/query', { schema: querySchema }, async (request, reply) => {
    const { query, entities = [] } = request.body;

    // 1. Input Guardrails Check
    validateInput(query);

    // Check cache for identical query + entity payload
    const sortedEntities = [...entities].sort().join(',');
    const cacheKey = `rag:query:${Buffer.from(query.trim().toLowerCase() + '::' + sortedEntities).toString('base64url')}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      request.log.info({ cacheKey }, 'Serving cached verified RAG response');
      return reply.send({ ...cached, cached: true });
    }

    // 2. Dual-Retrieval:
    // a. Semantic Vector Retrieval (pgvector)
    const vectorContext = await vectorService.searchSimilar(query, 3);
    request.log.info({ vectorMatches: vectorContext.length }, 'Retrieved vector context');

    // b. Deterministic Knowledge Graph Retrieval (Neo4j Hard Constraints)
    const constraints = await graphContextService.getHardConstraints(entities);
    request.log.info({ constraintsCount: constraints.length }, 'Retrieved hard constraints');

    // 3. AI Generation
    const rawResponse = await aiService.generateResponse({
      query,
      contextData: {
        constraints,
        vectorContext,
      },
    });

    // 4. Output Sanitization & Semantic Guardrail Verification
    const sanitized = sanitizeOutput(rawResponse);
    const safetyCheck = await validateSafetyAsync(sanitized, { hardConstraints: constraints });

    if (!safetyCheck.safe) {
      request.log.warn(
        { issues: safetyCheck.issues },
        'Generated output failed safety constraints'
      );
      return reply.status(403).send({
        error: 'E_GUARDRAIL',
        message: 'The generated response violated hard safety constraints.',
        issues: safetyCheck.issues,
        verification: safetyCheck.evaluationMetadata,
      });
    }

    const payload = {
      response: sanitized,
      constraints_applied: constraints,
      vector_sources: vectorContext.map((v) => ({ id: v.id, similarity: v.similarity })),
      provider: aiService.getProviderInfo(),
      safety_verified: true,
      verification_engine: safetyCheck.evaluationMetadata?.evaluatedBy || 'regex_fallback',
      verification_metadata: safetyCheck.evaluationMetadata,
      cached: false,
    };

    // Cache verified response with 1h TTL
    await cacheService.set(cacheKey, payload, 3600);

    return reply.send(payload);
  });

  /**
   * Real-Time Server-Sent Events (SSE) Streaming RAG Endpoint
   */
  fastify.post<{ Body: QueryBody }>('/stream', { schema: querySchema }, async (request, reply) => {
    const { query, entities = [] } = request.body;

    // 1. Input Guardrails
    validateInput(query);

    // 2. Dual-Retrieval:
    const [vectorContext, constraints] = await Promise.all([
      vectorService.searchSimilar(query, 3),
      graphContextService.getHardConstraints(entities),
    ]);

    // Set SSE headers on raw Node.js response
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    // Send initial retrieval metadata event
    reply.raw.write(
      `event: metadata\ndata: ${JSON.stringify({
        constraints_applied: constraints,
        vector_sources: vectorContext.map((v) => ({ id: v.id, similarity: v.similarity })),
        provider: aiService.getProviderInfo(),
      })}\n\n`
    );

    // 3. Stream AI Generation
    let synthesizedResponse = '';
    await aiService.streamResponse(
      {
        query,
        contextData: { constraints, vectorContext },
      },
      (chunk: string) => {
        synthesizedResponse += chunk;
        reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

    // 4. Output Sanitization & Semantic Guardrail Verification
    const sanitized = sanitizeOutput(synthesizedResponse);
    const safetyCheck = await validateSafetyAsync(sanitized, { hardConstraints: constraints });

    if (!safetyCheck.safe) {
      request.log.warn({ issues: safetyCheck.issues }, 'Streamed output failed safety constraints');
      reply.raw.write(
        `event: guardrail_violation\ndata: ${JSON.stringify({
          safe: false,
          error: 'E_GUARDRAIL',
          message: 'The generated response violated hard safety constraints.',
          issues: safetyCheck.issues,
          verification: safetyCheck.evaluationMetadata,
        })}\n\n`
      );
      return reply.raw.end();
    }

    reply.raw.write(
      `event: done\ndata: ${JSON.stringify({
        safe: true,
        response: sanitized,
        verification_engine: safetyCheck.evaluationMetadata?.evaluatedBy || 'regex_fallback',
        verification_metadata: safetyCheck.evaluationMetadata,
      })}\n\n`
    );

    return reply.raw.end();
  });

  /**
   * Document Ingestion Endpoint for Vector Database
   */
  fastify.post<{ Body: DocumentBody }>(
    '/documents',
    { schema: documentSchema },
    async (request, reply) => {
      const { id, content, metadata, embedding } = request.body;
      validateInput(content);

      await vectorService.upsertDocument(id, content, embedding, metadata);

      return reply.status(201).send({
        status: 'ok',
        message: `Document '${id}' successfully indexed into vector store.`,
        id,
      });
    }
  );

  /**
   * Knowledge Graph Constraint Ingestion Endpoint
   */
  fastify.post<{ Body: ConstraintBody }>(
    '/constraints',
    { schema: constraintSchema },
    async (request, reply) => {
      const { entity, constraint } = request.body;
      validateInput(constraint);

      graphContextService.registerConstraint(entity, constraint);

      return reply.status(201).send({
        status: 'ok',
        message: `Constraint for entity '${entity}' successfully registered.`,
        entity,
        constraint,
      });
    }
  );
}
