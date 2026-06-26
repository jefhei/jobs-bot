import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAdapter, searchAllSources, resetAdapters } from '../adapters/index';
import { JobSource, NormalizedJob } from '../types';

// ─── Test for getAdapter ────────────────────────────────────────────────────

describe('getAdapter', () => {
  it('should return an adapter for "indeed"', () => {
    const adapter = getAdapter('indeed');
    expect(adapter).toBeDefined();
    expect(adapter.config.name).toBe('indeed');
  });

  it('should return an adapter for "greenhouse"', () => {
    const adapter = getAdapter('greenhouse');
    expect(adapter).toBeDefined();
    expect(adapter.config.name).toBe('greenhouse');
  });

  it('should return an adapter for "lever"', () => {
    const adapter = getAdapter('lever');
    expect(adapter).toBeDefined();
    expect(adapter.config.name).toBe('lever');
  });

  it('should return an adapter for "linkedin"', () => {
    const adapter = getAdapter('linkedin');
    expect(adapter).toBeDefined();
    expect(adapter.config.name).toBe('linkedin');
  });

  it('should throw for unknown source', () => {
    expect(() => getAdapter('glassdoor' as JobSource)).toThrow('Unknown source');
  });

  it('should return the same adapter instance on repeated calls (singleton)', () => {
    const first = getAdapter('indeed');
    const second = getAdapter('indeed');
    expect(first).toBe(second);
  });

  it('all returned adapters should extend BaseSourceAdapter with search and testConnection', () => {
    const sources: JobSource[] = ['indeed', 'greenhouse', 'lever', 'linkedin'];
    for (const source of sources) {
      const adapter = getAdapter(source);
      expect(typeof adapter.search).toBe('function');
      expect(typeof adapter.testConnection).toBe('function');
    }
  });
});

// ─── Tests for searchAllSources ─────────────────────────────────────────────

describe('searchAllSources', () => {
  beforeEach(() => {
    resetAdapters();
  });

  it('should search all default sources by default', async () => {
    const results = await searchAllSources('engineer');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return SearchResult objects with source, jobs, totalCount fields', async () => {
    const results = await searchAllSources('developer');
    for (const result of results) {
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('jobs');
      expect(Array.isArray(result.jobs)).toBe(true);
      expect(result).toHaveProperty('totalCount');
      expect(typeof result.totalCount).toBe('number');
    }
  });

  it('should filter by specified sources', async () => {
    const results = await searchAllSources('engineer', {}, ['indeed']);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('indeed');
  });

  it('should handle errors gracefully per source (fail-open)', async () => {
    const results = await searchAllSources('test');
    // Each result should have source+error or source+jobs — never throw
    for (const result of results) {
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('jobs');
      expect(result).toHaveProperty('totalCount');
      if (result.error) {
        expect(typeof result.error).toBe('string');
        expect(result.jobs).toHaveLength(0);
        expect(result.totalCount).toBe(0);
      }
    }
  });

  it('should accept and forward SearchOptions', async () => {
    const results = await searchAllSources('designer', { location: 'Remote' }, ['indeed']);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('indeed');
  });

  it('should include latencyMs in results', async () => {
    const results = await searchAllSources('engineer', {}, ['indeed']);
    for (const result of results) {
      expect(result).toHaveProperty('latencyMs');
      if (result.latencyMs !== undefined) {
        expect(typeof result.latencyMs).toBe('number');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
