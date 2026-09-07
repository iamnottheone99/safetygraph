import 'dotenv/config';
import app from './app';
import pino from 'pino';

const logger = pino();
const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 SafetyGraph Engine running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
