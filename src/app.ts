import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import ragRoutes from './routes/ragRoutes';

const logger = pino();
const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Rate Limiting on API endpoints
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  message: { error: 'E_RATE_LIMITED', message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'SafetyGraph Engine',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/v1/rag', apiLimiter, ragRoutes);

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err }, 'Unhandled application error');
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.errorCode || 'E_INTERNAL',
    message: err.message || 'Internal Server Error'
  });
});

export default app;
