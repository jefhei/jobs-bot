import { describe, it, expect } from 'vitest';

describe('Redis client wrapper (redis.ts)', () => {
  it('should export a redis instance that is an object', async () => {
    const { redis } = await import('../redis');
    expect(redis).toBeTruthy();
    expect(typeof redis).toBe('object');
  });

  it('should have expected Redis methods (get, set, setex, del, etc.)', async () => {
    const { redis } = await import('../redis');
    expect(redis).toHaveProperty('get');
    expect(typeof redis.get).toBe('function');
    expect(redis).toHaveProperty('set');
    expect(typeof redis.set).toBe('function');
    expect(redis).toHaveProperty('setex');
    expect(typeof redis.setex).toBe('function');
    expect(redis).toHaveProperty('del');
    expect(typeof redis.del).toBe('function');
    expect(redis).toHaveProperty('exists');
    expect(typeof redis.exists).toBe('function');
    expect(redis).toHaveProperty('expire');
    expect(typeof redis.expire).toBe('function');
  });

  it('should be a singleton (same instance on multiple imports)', async () => {
    const mod1 = await import('../redis');
    const mod2 = await import('../redis');
    expect(mod1.redis).toBe(mod2.redis);
    expect(mod1.default).toBe(mod2.default);
  });

  it('should have default export match named export', async () => {
    const mod = await import('../redis');
    expect(mod.default).toBe(mod.redis);
  });

  it('should have Redis constructor available', async () => {
    const { redis } = await import('../redis');
    const Redis = (await import('ioredis')).default;
    expect(redis).toBeInstanceOf(Redis);
  });
});
