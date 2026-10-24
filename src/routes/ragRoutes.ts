import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { aiService } from '../services/aiService';
import {
  validateInput,
  validateSafety,
  validateSafetyAsync,
  sanitizeOutput,
} from '../services/guardrails';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export async function requireClientAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (env.API_KEY) {
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];
    const token =
      (typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined) ||
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

    if (!token || (token !== env.API_KEY && token !== env.ADMIN_API_KEY)) {
      throw new AppError(
        'Unauthorized: Valid API key required to access SafetyGraph endpoints',
        401,
        'E_UNAUTHORIZED'
      );
    }
  }
}

export async function requireAdminAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (env.ADMIN_API_KEY) {
    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];
    const token =
      (typeof apiKeyHeader === 'string' ? apiKeyHeader : undefined) ||
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

    if (!token || token !== env.ADMIN_API_KEY) {
      throw new AppError(
        'Unauthorized: Valid Admin API key required for ingestion',
        401,
        'E_UNAUTHORIZED'
      );
    }
  }
}
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
  fastify.post<{ Body: QueryBody }>('/query', { schema: querySchema, preHandler: [requireClientAuth] }, async (request, reply) => {
    const { query, entities = [] } = request.body;

    // 1. Input Guardrails Check
    validateInput(query);

    // Check cache for identical query + entity payload + provider/model
    const providerInfo = aiService.getProviderInfo();
    const sortedEntities = [...entities].sort().join(',');
    const cacheKey = `rag:query:${Buffer.from(`${providerInfo.name}:${providerInfo.model}::${query.trim().toLowerCase()}::${sortedEntities}`).toString('base64url')}`;
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
  fastify.post<{ Body: QueryBody }>('/stream', { schema: querySchema, preHandler: [requireClientAuth] }, async (request, reply) => {
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

    // Abort controller to terminate LLM generation if client disconnects
    const abortController = new AbortController();
    request.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    });

    // Send initial retrieval metadata event
    reply.raw.write(
      `event: metadata\ndata: ${JSON.stringify({
        constraints_applied: constraints,
        vector_sources: vectorContext.map((v) => ({ id: v.id, similarity: v.similarity })),
        provider: aiService.getProviderInfo(),
      })}\n\n`
    );

    // 3. Stream AI Generation with Real-Time Speculative Guardrail Validation
    let synthesizedResponse = '';
    let streamViolated = false;

    await aiService.streamResponse(
      {
        query,
        contextData: { constraints, vectorContext },
        abortSignal: abortController.signal,
      },
      (chunk: string) => {
        if (
          abortController.signal.aborted ||
          streamViolated ||
          reply.raw.destroyed ||
          reply.raw.writableEnded
        ) {
          return;
        }

        const candidateResponse = synthesizedResponse + chunk;

        // Real-time guardrail check on accumulated tokens before emitting to client
        if (constraints.length > 0) {
          const liveCheck = validateSafety(candidateResponse, { hardConstraints: constraints });
          if (!liveCheck.safe) {
            streamViolated = true;
            abortController.abort();
            request.log.warn(
              { issues: liveCheck.issues },
              'Streaming response aborted by real-time safety guardrail'
            );
            reply.raw.write(
              `event: guardrail_violation\ndata: ${JSON.stringify({
                safe: false,
                error: 'E_GUARDRAIL',
                message: 'The generated response violated hard safety constraints.',
                issues: liveCheck.issues,
                verification: { evaluatedBy: 'realtime_guardrail' },
              })}\n\n`
            );
            return reply.raw.end();
          }
        }

        synthesizedResponse = candidateResponse;
        reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
      }
    );

    if (
      streamViolated ||
      abortController.signal.aborted ||
      reply.raw.destroyed ||
      reply.raw.writableEnded
    ) {
      return;
    }

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
    { schema: documentSchema, preHandler: [requireAdminAuth] },
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
    { schema: constraintSchema, preHandler: [requireAdminAuth] },
    async (request, reply) => {
      const { entity, constraint } = request.body;
      validateInput(constraint);

      await graphContextService.registerConstraint(entity, constraint);

      return reply.status(201).send({
        status: 'ok',
        message: `Constraint for entity '${entity}' successfully registered.`,
        entity,
        constraint,
      });
    }
  );
}
