import { env } from './config/env';
import { buildApp } from './app';
import pino from 'pino';
import { vectorService } from './services/vectorService';
import { graphContextService } from './services/graphContextService';
import { cacheService } from './services/cacheService';
import { kevService } from './services/kevService';

const logger = pino();
const PORT = env.PORT;

export async function startServer() {
  logger.info('Initializing SafetyGraph backend databases and caching...');

  // Initialize and verify database & cache backends concurrently
  const [pgConnected, neo4jConnected, redisConnected] = await Promise.all([
    vectorService.initSchema(),
    graphContextService.verifyConnectivity(),
    cacheService.init()
  ]);

  logger.info({
    postgres: pgConnected ? 'CONNECTED (pgvector active)' : 'OFFLINE (in-memory fallback active)',
    neo4j: neo4jConnected ? 'CONNECTED' : 'OFFLINE (in-memory fallback active)',
    redis: redisConnected ? 'CONNECTED' : 'OFFLINE (in-memory cache active)'
  }, 'Database and cache subsystem statuses');

  // Start local Kev System One decision engine if auto-manage is enabled
  if (env.KEV_ENABLED && env.KEV_AUTO_MANAGE) {
    await kevService.startLifecycle();
  }

  const app = buildApp();
  const address = await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`🚀 SafetyGraph Engine running on ${address}`);

  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received. Closing SafetyGraph cleanly...');
    try {
      await app.close();
      await kevService.stopLifecycle();
      logger.info('All database, cache, socket connections, and Kev engine closed cleanly.');
      process.exit(0);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error closing connections during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return app;
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.fatal({ err }, 'Failed to start SafetyGraph Engine');
    process.exit(1);
  });
}
