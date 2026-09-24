import { env } from './config/env';
import app from './app';
import pino from 'pino';
import { vectorService } from './services/vectorService';
import { graphContextService } from './services/graphContextService';
import { cacheService } from './services/cacheService';

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

  const server = app.listen(PORT, () => {
    logger.info(`🚀 SafetyGraph Engine running on http://localhost:${PORT}`);
  });

  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received. Closing SafetyGraph cleanly...');
    server.close(async () => {
      try {
        await Promise.all([
          vectorService.close(),
          graphContextService.close(),
          cacheService.close()
        ]);
        logger.info('All database, cache, and socket connections closed cleanly.');
        process.exit(0);
      } catch (err: any) {
        logger.error({ err: err.message }, 'Error closing connections during shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.fatal({ err }, 'Failed to start SafetyGraph Engine');
    process.exit(1);
  });
}
