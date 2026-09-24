import { createClient, RedisClientType } from 'redis';
import pino from 'pino';
import { circuitManager } from '../utils/circuitBreaker';

const logger = pino();

export interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export class CacheService {
  private client: RedisClientType | null = null;
  private breaker = circuitManager.getBreaker('redis', { failureThreshold: 3, timeout: 15000 });
  private isConnected = false;
  private memoryStore: Map<string, CacheEntry<any>> = new Map();

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const redisUrl = process.env.REDIS_URL || 
      `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`;

    try {
      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: false,
          connectTimeout: 1000,
        },
      }) as RedisClientType;

      this.client.on('error', (err) => {
        logger.debug({ err: err.message }, 'Redis client socket error; using in-memory cache');
        this.isConnected = false;
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Redis client initialization deferred; operating in memory-only mode');
      this.isConnected = false;
    }
  }

  /**
   * Connect to Redis asynchronously
   */
  async init(): Promise<boolean> {
    if (!this.client) return false;

    try {
      return await this.breaker.execute(async () => {
        if (!this.client!.isOpen) {
          await this.client!.connect();
        }
        this.isConnected = true;
        logger.info('Redis cache connected and ready');
        return true;
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Redis connection unavailable; operating with in-memory cache fallback');
      this.isConnected = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.isConnected;
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.client && this.isConnected) {
      try {
        return await this.breaker.execute(async () => {
          const data = await this.client!.get(key);
          if (data) {
            return JSON.parse(data) as T;
          }
          return null;
        });
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Redis GET failed; falling back to memory store');
      }
    }

    // In-memory fallback
    const entry = this.memoryStore.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryStore.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    const serialized = JSON.stringify(value);

    // Update in-memory fallback
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.memoryStore.set(key, { value, expiresAt });

    if (this.client && this.isConnected) {
      try {
        await this.breaker.execute(async () => {
          if (ttlSeconds > 0) {
            await this.client!.setEx(key, ttlSeconds, serialized);
          } else {
            await this.client!.set(key, serialized);
          }
        });
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Redis SET failed; stored in memory fallback');
      }
    }
  }

  async del(key: string): Promise<void> {
    this.memoryStore.delete(key);

    if (this.client && this.isConnected) {
      try {
        await this.breaker.execute(async () => {
          await this.client!.del(key);
        });
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Redis DEL failed');
      }
    }
  }

  async clear(): Promise<void> {
    this.memoryStore.clear();

    if (this.client && this.isConnected) {
      try {
        await this.breaker.execute(async () => {
          await this.client!.flushDb();
        });
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Redis flushDb failed');
      }
    }
  }

  async close(): Promise<void> {
    if (this.client && this.client.isOpen) {
      try {
        await this.client.disconnect();
      } catch (err: any) {
        logger.debug({ err: err.message }, 'Error disconnecting Redis client');
      } finally {
        this.client = null;
        this.isConnected = false;
      }
    }
  }
}

export const cacheService = new CacheService();
