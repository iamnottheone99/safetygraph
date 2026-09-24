import { CacheService } from '../services/cacheService';
import { validateEnv } from '../config/env';

describe('Phase 2: Cache & Config Verification', () => {
  describe('CacheService (In-Memory & Redis Fallback)', () => {
    let cache: CacheService;

    beforeEach(() => {
      cache = new CacheService();
    });

    afterEach(async () => {
      await cache.close();
    });

    test('should store and retrieve values in cache', async () => {
      await cache.set('test_key', { foo: 'bar' }, 60);
      const val = await cache.get<{ foo: string }>('test_key');
      expect(val).toEqual({ foo: 'bar' });
    });

    test('should return null for non-existent keys', async () => {
      const val = await cache.get('non_existent_key');
      expect(val).toBeNull();
    });

    test('should delete keys from cache', async () => {
      await cache.set('delete_me', 'value', 60);
      expect(await cache.get('delete_me')).toBe('value');
      await cache.del('delete_me');
      expect(await cache.get('delete_me')).toBeNull();
    });

    test('should expire keys after TTL', async () => {
      // Set key with -1 TTL (already expired)
      const memStore = (cache as any).memoryStore;
      memStore.set('expired_key', { value: 'old', expiresAt: Date.now() - 1000 });
      const val = await cache.get('expired_key');
      expect(val).toBeNull();
    });

    test('should handle init gracefully when Redis server is offline', async () => {
      const isConnected = await cache.init();
      expect(typeof isConnected).toBe('boolean');
      expect(cache.isReady()).toBe(isConnected);
    });
  });

  describe('Environment Configuration (envalid)', () => {
    test('should validate defaults correctly', () => {
      const config = validateEnv({
        NODE_ENV: 'test',
        PORT: '5000',
      });
      expect(config.NODE_ENV).toBe('test');
      expect(config.PORT).toBe(5000);
      expect(config.LLM_PROVIDER).toBe('mock');
      expect(config.POSTGRES_DB).toBe('safetygraph');
      expect(config.CACHE_TTL_SECONDS).toBe(3600);
    });

    test('should reject invalid PORT values', () => {
      expect(() => {
        validateEnv({
          PORT: 'not-a-number'
        });
      }).toThrow();
    });
  });
});
