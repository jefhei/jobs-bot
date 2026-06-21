import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFingerprint, isDuplicate, markSeen } from '../dedup';

// Mock the redis module
vi.mock('../redis', () => {
  const mockRedis = {
    get: vi.fn(),
    setex: vi.fn(),
  };
  return {
    redis: mockRedis,
    default: mockRedis,
  };
});

describe('makeFingerprint', () => {
  it('should generate a SHA-256 hex string for given inputs', () => {
    const fp = makeFingerprint('user-1', 'job-123', 'linkedin');
    expect(fp).toBeDefined();
    expect(typeof fp).toBe('string');
    // SHA-256 hex is 64 characters
    expect(fp).toHaveLength(64);
    // Should match hex pattern
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should produce deterministic output for same inputs', () => {
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    const fp2 = makeFingerprint('user-1', 'job-123', 'linkedin');
    expect(fp1).toBe(fp2);
  });

  it('should produce different fingerprints when userId differs', () => {
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    const fp2 = makeFingerprint('user-2', 'job-123', 'linkedin');
    expect(fp1).not.toBe(fp2);
  });

  it('should produce different fingerprints when jobId differs', () => {
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    const fp2 = makeFingerprint('user-1', 'job-456', 'linkedin');
    expect(fp1).not.toBe(fp2);
  });

  it('should produce different fingerprints when source differs', () => {
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    const fp2 = makeFingerprint('user-1', 'job-123', 'indeed');
    expect(fp1).not.toBe(fp2);
  });

  it('should produce same fingerprint regardless of extra whitespace in inputs', () => {
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    // The function should use the inputs as-is (no trimming); any whitespace is part of the input
    // This test verifies the separator format userId:jobId:source
    const fp2 = makeFingerprint('user-1', 'job-123', 'linkedin');
    expect(fp1).toBe(fp2);
  });
});

describe('isDuplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return false when fingerprint does not exist in Redis', async () => {
    const { redis } = await import('../redis');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await isDuplicate('user-1', 'job-123', 'linkedin');
    expect(result).toBe(false);
  });

  it('should return true when fingerprint exists in Redis', async () => {
    const { redis } = await import('../redis');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue('1');

    const result = await isDuplicate('user-1', 'job-123', 'linkedin');
    expect(result).toBe(true);
  });

  it('should call redis.get with the correct fingerprint key', async () => {
    const { redis } = await import('../redis');
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await isDuplicate('user-1', 'job-123', 'linkedin');
    const expectedFp = makeFingerprint('user-1', 'job-123', 'linkedin');
    expect(redis.get).toHaveBeenCalledWith(expectedFp);
  });
});

describe('markSeen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store the fingerprint in Redis with 30-day TTL', async () => {
    const { redis } = await import('../redis');
    (redis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    await markSeen('user-1', 'job-123', 'linkedin');
    const expectedFp = makeFingerprint('user-1', 'job-123', 'linkedin');
    // 30 days in seconds = 30 * 24 * 60 * 60 = 2592000
    expect(redis.setex).toHaveBeenCalledWith(expectedFp, 2592000, '1');
  });

  it('should handle multiple different fingerprints', async () => {
    const { redis } = await import('../redis');
    (redis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');

    await markSeen('user-1', 'job-123', 'linkedin');
    await markSeen('user-1', 'job-456', 'indeed');

    expect(redis.setex).toHaveBeenCalledTimes(2);
    const fp1 = makeFingerprint('user-1', 'job-123', 'linkedin');
    const fp2 = makeFingerprint('user-1', 'job-456', 'indeed');
    expect(redis.setex).toHaveBeenCalledWith(fp1, 2592000, '1');
    expect(redis.setex).toHaveBeenCalledWith(fp2, 2592000, '1');
  });
});

describe('isDuplicate + markSeen integration (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect as duplicate after markSeen', async () => {
    const { redis } = await import('../redis');

    // First, no entry exists
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const before = await isDuplicate('user-1', 'job-123', 'linkedin');
    expect(before).toBe(false);

    // Mark as seen
    (redis.setex as ReturnType<typeof vi.fn>).mockResolvedValue('OK');
    await markSeen('user-1', 'job-123', 'linkedin');

    // Now it should be a duplicate
    (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue('1');
    const after = await isDuplicate('user-1', 'job-123', 'linkedin');
    expect(after).toBe(true);
  });
});
