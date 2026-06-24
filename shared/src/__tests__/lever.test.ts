import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeverAdapter } from '../adapters/lever';
import { BaseSourceAdapter } from '../adapters/base';
import { NormalizedJob } from '../types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockHttpClient() {
  return {
    get: vi.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockLeverJob = {
  id: 'abc123',
  text: 'Software Engineer',
  categories: {
    location: 'San Francisco, CA',
    commitment: 'Full-Time',
    team: 'Engineering',
    level: 'Senior',
    allLocations: ['San Francisco, CA'],
  },
  description: '<p>We are looking for...</p>',
  descriptionPlain: 'We are looking for a skilled software engineer to join our team.',
  lists: [
    {
      text: 'Requirements',
      content: '<ul><li>5+ years experience</li></ul>',
    },
  ],
  additional: '...',
  additionalPlain: '...',
  country: 'US',
  hostedUrl: 'https://jobs.lever.co/acme/abc123',
  applyUrl: 'https://jobs.lever.co/acme/abc123/apply',
  createdAt: 1748304000000,
  workplaceType: 'remote',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LeverAdapter', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let adapter: LeverAdapter;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    adapter = new LeverAdapter(httpClient as any);
  });

  // ─── Class structure ─────────────────────────────────────────────────────

  it('should extend BaseSourceAdapter', () => {
    expect(adapter).toBeInstanceOf(BaseSourceAdapter);
    expect(adapter).toBeInstanceOf(LeverAdapter);
  });

  it('should have correct config values', () => {
    expect(adapter.config.name).toBe('lever');
    expect(adapter.config.baseUrl).toBe('https://api.lever.co/v0/postings');
    expect(adapter.config.rateLimitPerMin).toBe(30);
    expect(adapter.config.retryCount).toBe(3);
  });

  // ─── search with company IDs ───────────────────────────────────────────

  it('should normalize Lever API response to NormalizedJob format', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    httpClient.get.mockResolvedValue({ data: [mockLeverJob] });

    const jobs = await adapter.search('software engineer');

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe('lever');
    expect(job.sourceId).toBe('abc123');
    expect(job.title).toBe('Software Engineer');
    expect(job.company).toBe('acme');
    expect(job.location).toBe('San Francisco, CA');
    expect(job.type).toBe('Full-Time');
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.url).toBe('https://jobs.lever.co/acme/abc123');
    expect(job.descriptionSnippet).toBe('We are looking for a skilled software engineer to join our team.');
    expect(job.tags).toEqual([]);
    expect(job.postedAt).toBe('2025-05-27T00:00:00.000Z');
  });

  // ─── multiple company IDs ───────────────────────────────────────────────

  it('should handle multiple company IDs', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme,otherco';
    const mockJob2 = {
      ...mockLeverJob,
      id: 'def456',
      text: 'DevOps Engineer',
      hostedUrl: 'https://jobs.lever.co/otherco/def456',
    };

    httpClient.get
      .mockResolvedValueOnce({ data: [mockLeverJob] })
      .mockResolvedValueOnce({ data: [mockJob2] });

    const jobs = await adapter.search('engineer');

    expect(jobs).toHaveLength(2);
    expect(jobs[0].sourceId).toBe('abc123');
    expect(jobs[1].sourceId).toBe('def456');
    expect(jobs[1].title).toBe('DevOps Engineer');
    expect(jobs[1].company).toBe('otherco');
    expect(httpClient.get).toHaveBeenCalledTimes(2);
  });

  // ─── no company IDs ───────────────────────────────────────────────────

  it('should return empty array when LEVER_COMPANY_IDS is not set', async () => {
    delete process.env.LEVER_COMPANY_IDS;
    httpClient.get.mockResolvedValue({ data: [mockLeverJob] });

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── handles API errors gracefully ─────────────────────────────────────

  it('should return empty array when API call fails', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    httpClient.get.mockRejectedValue(new Error('Network error'));

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  // ─── testConnection ─────────────────────────────────────────────────────

  it('should return true when testConnection succeeds', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    httpClient.get.mockResolvedValue({ data: [] });

    const result = await adapter.testConnection();

    expect(result).toBe(true);
  });

  it('should return false when testConnection fails', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    httpClient.get.mockRejectedValue(new Error('API error'));

    const result = await adapter.testConnection();

    expect(result).toBe(false);
  });

  it('should return false when no company IDs for testConnection', async () => {
    delete process.env.LEVER_COMPANY_IDS;

    const result = await adapter.testConnection();

    expect(result).toBe(false);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  // ─── handle missing/null fields gracefully ─────────────────────────────

  it('should handle null fields gracefully', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    const minimalJob = {
      id: 'min-001',
      text: 'Minimal Job',
      hostedUrl: 'https://jobs.lever.co/acme/min-001',
    };

    httpClient.get.mockResolvedValue({ data: [minimalJob] });

    const jobs = await adapter.search('test');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBeNull();
    expect(jobs[0].type).toBeNull();
    expect(jobs[0].salaryMin).toBeNull();
    expect(jobs[0].salaryMax).toBeNull();
    expect(jobs[0].descriptionSnippet).toBeNull();
    expect(jobs[0].company).toBe('acme');
    expect(jobs[0].title).toBe('Minimal Job');
  });

  // ─── verify API endpoint called correctly ──────────────────────────────

  it('should call the correct API endpoint with limit=100', async () => {
    process.env.LEVER_COMPANY_IDS = 'acme';
    httpClient.get.mockResolvedValue({ data: [] });

    await adapter.search('engineer');

    expect(httpClient.get).toHaveBeenCalledWith(
      'https://api.lever.co/v0/postings/acme?limit=100'
    );
  });
});
