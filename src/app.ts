import Fastify, { FastifyInstance, FastifyServerOptions, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import ragRoutes from './routes/ragRoutes';
import { vectorService } from './services/vectorService';
import { graphContextService } from './services/graphContextService';
import { cacheService } from './services/cacheService';
import { env } from './config/env';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      opts.logger !== undefined ? opts.logger : process.env.NODE_ENV === 'test' ? false : true,
    ...opts,
  });

  // Register CORS
  app.register(cors);

  // Register Rate Limiting with centralized error format
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: (_request, _context) => ({
      error: 'E_RATE_LIMITED',
      message: 'Too many requests, please try again later.',
    }),
  });

  // Health check endpoint
  app.get('/health', async (_request, _reply) => {
    return {
      status: 'ok',
      service: 'SafetyGraph Engine',
      databases: {
        postgres: vectorService.isReady(),
        neo4j: graphContextService.isReady(),
        redis: cacheService.isReady(),
      },
      timestamp: new Date().toISOString(),
    };
  });

  // Centralized Error Handler (eliminates route-level boilerplate try/catch blocks)
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const err = error as any;
    // Fastify schema validation error
    if (error.validation) {
      request.log.warn({ validation: error.validation }, 'Request validation failed');
      return reply.status(400).send({
        error: 'E_VALIDATION',
        message: error.message,
        errors: error.validation,
      });
    }

    const statusCode = error.statusCode || err.status || 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled application error');
    } else {
      request.log.warn({ err: error }, 'Operational client error');
    }

    return reply.status(statusCode).send({
      error: err.errorCode || 'E_INTERNAL',
      message: error.message || 'Internal Server Error',
      ...(err.issues ? { issues: err.issues } : {}),
      ...(err.verification ? { verification: err.verification } : {}),
    });
  });

  // Automatic Lifecycle Teardown Hook (consolidates server shutdown & test cleanup)
  app.addHook('onClose', async () => {
    await Promise.all([vectorService.close(), graphContextService.close(), cacheService.close()]);
  });

  // API Routes Plugin
  app.register(ragRoutes, { prefix: '/api/v1/rag' });

  return app;
}

export const app = buildApp();
export default app;
