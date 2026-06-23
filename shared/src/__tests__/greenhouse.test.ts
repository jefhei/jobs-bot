import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GreenhouseAdapter } from '../adapters/greenhouse';
import { BaseSourceAdapter } from '../adapters/base';
import { NormalizedJob } from '../types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockHttpClient() {
  return {
    get: vi.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockGreenhouseJob = {
  id: 123456,
  title: 'Software Engineer',
  offices: [{ name: 'San Francisco' }],
  departments: [{ name: 'Engineering' }],
  metadata: [
    { name: 'Employment Type', value: 'Full-Time' },
    { name: 'Salary Range', value: '$100,000 - $150,000' },
  ],
  updated_at: '2025-06-20T12:00:00Z',
  absolute_url: 'https://boards.greenhouse.io/acme/jobs/123456',
};

const mockGreenhouseJobDetail = {
  id: 123456,
  title: 'Software Engineer',
  content: '<div>We are looking for a skilled software engineer...</div>',
  offices: [{ name: 'San Francisco' }],
  departments: [{ name: 'Engineering' }],
  metadata: [
    { name: 'Employment Type', value: 'Full-Time' },
    { name: 'Salary Range', value: '$100,000 - $150,000' },
  ],
  updated_at: '2025-06-20T12:00:00Z',
  absolute_url: 'https://boards.greenhouse.io/acme/jobs/123456',
  education: 'B.S. in Computer Science',
  minimum_compensation: { value: '100000', unit: '$' },
  maximum_compensation: { value: '150000', unit: '$' },
};

const mockListResponse = {
  jobs: [mockGreenhouseJob],
  meta: { total: 1, page: 1, count: 1 },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GreenhouseAdapter', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let adapter: GreenhouseAdapter;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    adapter = new GreenhouseAdapter(httpClient as any);
  });

  // ─── Class structure ─────────────────────────────────────────────────────

  it('should extend BaseSourceAdapter', () => {
    expect(adapter).toBeInstanceOf(BaseSourceAdapter);
    expect(adapter).toBeInstanceOf(GreenhouseAdapter);
  });

  it('should have correct config values', () => {
    expect(adapter.config.name).toBe('greenhouse');
    expect(adapter.config.baseUrl).toBe('https://boards-api.greenhouse.io/v1/boards');
    expect(adapter.config.rateLimitPerMin).toBe(30);
    expect(adapter.config.retryCount).toBe(3);
  });

  // ─── search with board tokens ──────────────────────────────────────────

  it('should normalize Greenhouse API response to NormalizedJob format', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme';
    httpClient.get
      .mockResolvedValueOnce({ data: mockListResponse })
      .mockResolvedValueOnce({ data: mockGreenhouseJobDetail });

    const jobs = await adapter.search('software engineer');

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe('greenhouse');
    expect(job.sourceId).toBe('123456');
    expect(job.title).toBe('Software Engineer');
    expect(job.company).toBe('acme');
    expect(job.location).toBe('San Francisco');
    expect(job.type).toBe('Full-Time');
    expect(job.salaryMin).toBe(100000);
    expect(job.salaryMax).toBe(150000);
    expect(job.url).toBe('https://boards.greenhouse.io/acme/jobs/123456');
    expect(job.descriptionSnippet).toContain('software engineer');
    expect(job.tags).toEqual([]);
    expect(job.postedAt).toBe('2025-06-20T12:00:00.000Z');
  });

  // ─── multiple board tokens ──────────────────────────────────────────────

  it('should handle multiple board tokens', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme,otherco';
    const mockJob2 = { ...mockGreenhouseJob, id: 789, title: 'DevOps Engineer', absolute_url: 'https://boards.greenhouse.io/otherco/jobs/789' };
    const mockDetail2 = { ...mockGreenhouseJobDetail, id: 789, title: 'DevOps Engineer', absolute_url: 'https://boards.greenhouse.io/otherco/jobs/789' };

    httpClient.get
      // Board 1 list
      .mockResolvedValueOnce({ data: mockListResponse })
      // Board 1 detail
      .mockResolvedValueOnce({ data: mockGreenhouseJobDetail })
      // Board 2 list
      .mockResolvedValueOnce({ data: { jobs: [mockJob2], meta: { total: 1 } } })
      // Board 2 detail
      .mockResolvedValueOnce({ data: mockDetail2 });

    const jobs = await adapter.search('engineer');

    expect(jobs).toHaveLength(2);
    expect(jobs[0].sourceId).toBe('123456');
    expect(jobs[1].sourceId).toBe('789');
    expect(jobs[1].title).toBe('DevOps Engineer');
    expect(jobs[1].company).toBe('otherco');
    expect(httpClient.get).toHaveBeenCalledTimes(4);
  });

  // ─── no board tokens ───────────────────────────────────────────────────

  it('should return empty array when GREENHOUSE_BOARD_TOKENS is not set', async () => {
    delete process.env.GREENHOUSE_BOARD_TOKENS;
    httpClient.get.mockResolvedValue({ data: mockListResponse });

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── handles API errors gracefully ─────────────────────────────────────

  it('should return empty array when API call fails', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme';
    httpClient.get.mockRejectedValue(new Error('Network error'));

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  // ─── testConnection ─────────────────────────────────────────────────────

  it('should return true when testConnection succeeds', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme';
    httpClient.get.mockResolvedValue({ data: { jobs: [], meta: {} } });

    const result = await adapter.testConnection();

    expect(result).toBe(true);
  });

  it('should return false when testConnection fails', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme';
    httpClient.get.mockRejectedValue(new Error('API error'));

    const result = await adapter.testConnection();

    expect(result).toBe(false);
  });

  it('should return false when no board tokens for testConnection', async () => {
    delete process.env.GREENHOUSE_BOARD_TOKENS;

    const result = await adapter.testConnection();

    expect(result).toBe(false);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── handle missing/null fields gracefully ─────────────────────────────

  it('should handle missing/null fields gracefully', async () => {
    process.env.GREENHOUSE_BOARD_TOKENS = 'acme';
    const minimalJob = {
      id: 999,
      title: 'Minimal Job',
      updated_at: '2025-06-21T00:00:00Z',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/999',
    };
    const minimalDetail = {
      id: 999,
      title: 'Minimal Job',
      updated_at: '2025-06-21T00:00:00Z',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/999',
    };

    httpClient.get
      .mockResolvedValueOnce({ data: { jobs: [minimalJob], meta: { total: 1 } } })
      .mockResolvedValueOnce({ data: minimalDetail });

    const jobs = await adapter.search('test');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeNull();
    expect(jobs[0].type).toBeNull();
    expect(jobs[0].salaryMin).toBeNull();
    expect(jobs[0].salaryMax).toBeNull();
    expect(jobs[0].descriptionSnippet).toBeNull();
    expect(jobs[0].company).toBe('acme');
  });
});
