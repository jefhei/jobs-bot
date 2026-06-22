import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndeedAdapter } from '../adapters/indeed';
import { BaseSourceAdapter } from '../adapters/base';
import { NormalizedJob } from '../types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockHttpClient() {
  return {
    get: vi.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockIndeedJob = {
  jobkey: 'abc123',
  jobtitle: 'Software Engineer',
  company: 'Tech Corp',
  city: 'San Francisco',
  state: 'CA',
  formattedLocation: 'San Francisco, CA',
  salary: '$120,000',
  jobType: 'fulltime',
  postedDate: '2025-06-20T00:00:00Z',
  url: 'https://www.indeed.com/viewjob?jk=abc123',
  snippet: 'We are looking for a skilled software engineer...',
};

const mockIndeedResponse = {
  results: [mockIndeedJob],
  totalResults: 1,
  start: 0,
  end: 1,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IndeedAdapter', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let adapter: IndeedAdapter;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    adapter = new IndeedAdapter(httpClient as any);
  });

  // ─── Class structure ─────────────────────────────────────────────────────

  it('should extend BaseSourceAdapter', () => {
    expect(adapter).toBeInstanceOf(BaseSourceAdapter);
    expect(adapter).toBeInstanceOf(IndeedAdapter);
  });

  it('should have correct config values', () => {
    expect(adapter.config.name).toBe('indeed');
    expect(adapter.config.baseUrl).toBe('https://api.indeed.com/ads/apisearch');
    expect(adapter.config.rateLimitPerMin).toBe(30);
    expect(adapter.config.retryCount).toBe(3);
  });

  // ─── normalizeJob (private, tested via search) ─────────────────────────

  it('should normalize Indeed API response to NormalizedJob format', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockResolvedValue({ data: mockIndeedResponse });

    const jobs = await adapter.search('software engineer');

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe('indeed');
    expect(job.sourceId).toBe('abc123');
    expect(job.title).toBe('Software Engineer');
    expect(job.company).toBe('Tech Corp');
    expect(job.location).toBe('San Francisco, CA');
    expect(job.type).toBe('fulltime');
    expect(job.salaryMin).toBe(120000);
    expect(job.salaryMax).toBeNull();
    expect(job.url).toBe('https://www.indeed.com/viewjob?jk=abc123');
    expect(job.descriptionSnippet).toBe('We are looking for a skilled software engineer...');
    expect(job.tags).toEqual([]);
    expect(job.postedAt).toBe('2025-06-20T00:00:00.000Z');
  });

  // ─── search with options ───────────────────────────────────────────────

  it('should pass location and jobType and minSalary options to API', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockResolvedValue({ data: { results: [] } });

    await adapter.search('engineer', {
      location: 'Remote',
      jobType: 'contract',
      minSalary: 80000,
    });

    expect(httpClient.get).toHaveBeenCalledWith(
      'https://api.indeed.com/ads/apisearch',
      expect.objectContaining({
        params: expect.objectContaining({
          l: 'Remote',
          jt: 'contract',
          salary: 80000,
        }),
      })
    );
  });

  // ─── search without API key ───────────────────────────────────────────

  it('should return empty array when INDEED_API_KEY is not set', async () => {
    delete process.env.INDEED_API_KEY;
    httpClient.get.mockResolvedValue({ data: mockIndeedResponse });

    const jobs = await adapter.search('software engineer');

    expect(jobs).toEqual([]);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── search handles API errors gracefully ───────────────────────────────

  it('should return empty array when API call fails', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockRejectedValue(new Error('Network error'));

    const jobs = await adapter.search('software engineer');

    expect(jobs).toEqual([]);
  });

  // ─── search handles malformed responses ────────────────────────────────

  it('should handle missing results field', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockResolvedValue({ data: {} });

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  // ─── testConnection ─────────────────────────────────────────────────────

  it('should return true when testConnection succeeds', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockResolvedValue({ data: { results: [] } });

    const result = await adapter.testConnection();

    expect(result).toBe(true);
  });

  it('should return false when testConnection fails', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockRejectedValue(new Error('API error'));

    const result = await adapter.testConnection();

    expect(result).toBe(false);
  });

  it('should return false when no API key for testConnection', async () => {
    delete process.env.INDEED_API_KEY;

    const result = await adapter.testConnection();

    expect(result).toBe(false);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── search pagination ─────────────────────────────────────────────────

  it('should request up to 25 results per page', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    httpClient.get.mockResolvedValue({ data: { results: [] } });

    await adapter.search('engineer');

    expect(httpClient.get).toHaveBeenCalledWith(
      'https://api.indeed.com/ads/apisearch',
      expect.objectContaining({
        params: expect.objectContaining({
          limit: 25,
        }),
      })
    );
  });

  // ─── handle missing/null fields gracefully ─────────────────────────────

  it('should handle null fields gracefully', async () => {
    process.env.INDEED_API_KEY = 'test-api-key';
    const minimalJob = {
      jobkey: 'min-001',
      jobtitle: 'Minimal Job',
      company: 'Minimal Co',
    };
    httpClient.get.mockResolvedValue({ data: { results: [minimalJob] } });

    const jobs = await adapter.search('test');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeNull();
    expect(jobs[0].type).toBeNull();
    expect(jobs[0].salaryMin).toBeNull();
    expect(jobs[0].descriptionSnippet).toBeNull();
    expect(jobs[0].url).toBe('https://www.indeed.com/viewjob?jk=min-001');
  });
});
