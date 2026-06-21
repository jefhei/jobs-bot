import { describe, it, expect } from 'vitest';
import {
  BaseSourceAdapter,
  SourceAdapterConfig,
  SearchOptions,
} from '../adapters/base';
import { JobSource, NormalizedJob } from '../types';

// ─── Test concrete subclass ──────────────────────────────────────────────────

class TestAdapter extends BaseSourceAdapter {
  async search(
    query: string,
    options?: SearchOptions
  ): Promise<NormalizedJob[]> {
    return [
      {
        source: this.config.name,
        sourceId: 'test-001',
        title: `Test: ${query}`,
        company: 'Test Corp',
        location: options?.location ?? null,
        type: options?.jobType ?? null,
        salaryMin: options?.minSalary ?? null,
        salaryMax: null,
        postedAt: new Date().toISOString(),
        url: 'https://example.com/jobs/test-001',
        descriptionSnippet: null,
        tags: [],
      },
    ];
  }

  async testConnection(): Promise<boolean> {
    return true;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BaseSourceAdapter', () => {
  it('should be a class that can be extended', () => {
    expect(typeof BaseSourceAdapter).toBe('function');
    expect(BaseSourceAdapter.prototype).toBeDefined();
  });

  it('should allow concrete subclass instantiation', () => {
    const adapter = new TestAdapter({
      name: 'linkedin',
      baseUrl: 'https://www.linkedin.com/jobs',
    });
    expect(adapter).toBeInstanceOf(BaseSourceAdapter);
    expect(adapter).toBeInstanceOf(TestAdapter);
  });

  it('should store the config passed to constructor', () => {
    const config: SourceAdapterConfig = {
      name: 'indeed',
      baseUrl: 'https://www.indeed.com',
      rateLimitPerMin: 30,
      retryCount: 3,
    };
    const adapter = new TestAdapter(config);
    expect(adapter.config).toEqual(config);
    expect(adapter.config.name).toBe('indeed');
    expect(adapter.config.baseUrl).toBe('https://www.indeed.com');
    expect(adapter.config.rateLimitPerMin).toBe(30);
    expect(adapter.config.retryCount).toBe(3);
  });

  it('should allow config without optional fields', () => {
    const config: SourceAdapterConfig = {
      name: 'hn',
      baseUrl: 'https://hn.algolia.com',
    };
    const adapter = new TestAdapter(config);
    expect(adapter.config.rateLimitPerMin).toBeUndefined();
    expect(adapter.config.retryCount).toBeUndefined();
  });

  it('should search and return NormalizedJob[]', async () => {
    const adapter = new TestAdapter({
      name: 'greenhouse',
      baseUrl: 'https://boards.greenhouse.io',
    });
    const jobs = await adapter.search('engineer', { location: 'Remote' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].source).toBe('greenhouse');
    expect(jobs[0].sourceId).toBe('test-001');
    expect(jobs[0].title).toContain('engineer');
    expect(jobs[0].company).toBe('Test Corp');
    expect(jobs[0].location).toBe('Remote');
  });

  it('should search with all SearchOptions', async () => {
    const adapter = new TestAdapter({
      name: 'lever',
      baseUrl: 'https://jobs.lever.co',
    });
    const jobs = await adapter.search('designer', {
      location: 'San Francisco',
      jobType: 'fulltime',
      minSalary: 100000,
      experienceLevel: 'senior',
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBe('San Francisco');
    expect(jobs[0].type).toBe('fulltime');
    expect(jobs[0].salaryMin).toBe(100000);
  });

  it('should test connection and return boolean', async () => {
    const adapter = new TestAdapter({
      name: 'glassdoor',
      baseUrl: 'https://www.glassdoor.com',
    });
    const result = await adapter.testConnection();
    expect(typeof result).toBe('boolean');
    expect(result).toBe(true);
  });
});

describe('SourceAdapterConfig', () => {
  it('should accept valid JobSource values', () => {
    const sources: JobSource[] = [
      'linkedin', 'indeed', 'greenhouse', 'lever',
      'glassdoor', 'workday', 'hn', 'remoteco',
    ];
    for (const source of sources) {
      const config: SourceAdapterConfig = {
        name: source,
        baseUrl: `https://example.com/${source}`,
      };
      expect(config.name).toBe(source);
    }
  });
});

describe('SearchOptions', () => {
  it('should accept all optional fields', () => {
    const options: SearchOptions = {
      location: 'Remote',
      jobType: 'contract',
      minSalary: 50000,
      experienceLevel: 'mid',
    };
    expect(options.location).toBe('Remote');
    expect(options.jobType).toBe('contract');
    expect(options.minSalary).toBe(50000);
    expect(options.experienceLevel).toBe('mid');
  });

  it('should allow partial options', () => {
    const options: SearchOptions = {
      location: 'New York',
    };
    expect(options.location).toBe('New York');
    expect(options.jobType).toBeUndefined();
    expect(options.minSalary).toBeUndefined();
    expect(options.experienceLevel).toBeUndefined();
  });
});
