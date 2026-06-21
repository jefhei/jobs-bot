import { describe, it, expect } from 'vitest';

describe('Prisma client wrapper (db.ts)', () => {
  it('should export a prisma instance that is an object', async () => {
    const { prisma } = await import('../db');
    expect(prisma).toBeTruthy();
    expect(typeof prisma).toBe('object');
  });

  it('should have expected PrismaClient methods ($connect, $disconnect)', async () => {
    const { prisma } = await import('../db');
    expect(prisma).toHaveProperty('$connect');
    expect(typeof prisma.$connect).toBe('function');
    expect(prisma).toHaveProperty('$disconnect');
    expect(typeof prisma.$disconnect).toBe('function');
  });

  it('should have model accessors matching the schema', async () => {
    const { prisma } = await import('../db');
    // Models from schema: User, WatchConfig, JobListing, JobMatch, NotificationSetting
    expect(prisma).toHaveProperty('user');
    expect(typeof prisma.user).toBe('object');
    expect(prisma).toHaveProperty('watchConfig');
    expect(typeof prisma.watchConfig).toBe('object');
    expect(prisma).toHaveProperty('jobListing');
    expect(typeof prisma.jobListing).toBe('object');
    expect(prisma).toHaveProperty('jobMatch');
    expect(typeof prisma.jobMatch).toBe('object');
    expect(prisma).toHaveProperty('notificationSetting');
    expect(typeof prisma.notificationSetting).toBe('object');
  });

  it('should be a singleton (same instance on multiple imports)', async () => {
    const mod1 = await import('../db');
    const mod2 = await import('../db');
    expect(mod1.prisma).toBe(mod2.prisma);
    expect(mod1.default).toBe(mod2.default);
  });

  it('should have default export match named export', async () => {
    const mod = await import('../db');
    expect(mod.default).toBe(mod.prisma);
  });

  it('should have PrismaClient constructor', async () => {
    const { prisma } = await import('../db');
    const { PrismaClient } = await import('@prisma/client');
    // Prisma 7 wraps the instance in a Proxy, but constructor identity still works
    expect(prisma.constructor).toBe(PrismaClient);
  });
});
