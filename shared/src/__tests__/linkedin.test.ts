import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LinkedInAdapter } from '../adapters/linkedin';
import { BaseSourceAdapter } from '../adapters/base';
import { NormalizedJob } from '../types';

// ─── Mock factory ────────────────────────────────────────────────────────────

function createMockHttpClient() {
  return {
    get: vi.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockApiJob = {
  jobId: 'li-api-001',
  title: 'Full Stack Engineer',
  companyDetails: { name: 'LinkedIn Corp' },
  description: { text: 'Build the future of professional networking...' },
  location: 'Sunnyvale, CA',
  employmentType: 'FULL_TIME',
  listedAt: 1750000000000, // epoch ms
  applyUrl: 'https://www.linkedin.com/jobs/li-api-001',
};

const mockApiResponse = {
  data: {
    elements: [mockApiJob],
    paging: { count: 25, start: 0, total: 1 },
  },
};

// Simulated HTML for scrape fallback
const mockScrapeHtml = `
<html><body>
<div class="base-card">
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/li-scrape-001"></a>
  <h3 class="base-search-card__title">React Developer</h3>
  <h4 class="base-search-card__subtitle">Startup Inc</h4>
  <div class="base-search-card__metadata">
    <span class="job-search-card__location">Remote</span>
    <time class="job-search-card__listdate">2025-06-22</time>
  </div>
</div>
<div class="base-card">
  <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/li-scrape-002"></a>
  <h3 class="base-search-card__title">Backend Engineer</h3>
  <h4 class="base-search-card__subtitle">Another Co</h4>
  <div class="base-search-card__metadata">
    <span class="job-search-card__location">New York, NY</span>
    <time class="job-search-card__listdate">2025-06-23</time>
  </div>
</div>
</body></html>
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LinkedInAdapter', () => {
  let httpClient: ReturnType<typeof createMockHttpClient>;
  let adapter: LinkedInAdapter;

  beforeEach(() => {
    httpClient = createMockHttpClient();
    adapter = new LinkedInAdapter(httpClient as any);
  });

  afterEach(() => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
  });

  // ─── Class structure ─────────────────────────────────────────────────────

  it('should extend BaseSourceAdapter', () => {
    expect(adapter).toBeInstanceOf(BaseSourceAdapter);
    expect(adapter).toBeInstanceOf(LinkedInAdapter);
  });

  it('should have correct config values', () => {
    expect(adapter.config.name).toBe('linkedin');
    expect(adapter.config.baseUrl).toBe('https://api.linkedin.com/v2/jobs/search');
    expect(adapter.config.rateLimitPerMin).toBe(10);
    expect(adapter.config.retryCount).toBe(3);
  });

  // ─── API mode (with token) ─────────────────────────────────────────────

  it('should use API when LINKEDIN_ACCESS_TOKEN is set', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'mock-token';
    httpClient.get.mockResolvedValue({ data: mockApiResponse.data });

    const jobs = await adapter.search('full stack engineer');

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.source).toBe('linkedin');
    expect(job.sourceId).toBe('li-api-001');
    expect(job.title).toBe('Full Stack Engineer');
    expect(job.company).toBe('LinkedIn Corp');
    expect(job.location).toBe('Sunnyvale, CA');
    expect(job.type).toBe('FULL_TIME');
    expect(job.url).toBe('https://www.linkedin.com/jobs/li-api-001');
    expect(job.tags).toEqual([]);
  });

  it('should pass query and location params to LinkedIn API', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'mock-token';
    httpClient.get.mockResolvedValue({ data: { elements: [], paging: {} } });

    await adapter.search('engineer', { location: 'San Francisco' });

    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('api.linkedin.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token',
        }),
        params: expect.objectContaining({
          keywords: 'engineer',
          location: 'San Francisco',
        }),
      })
    );
  });

  // ─── Scrape fallback (no token) ─────────────────────────────────────────

  it('should fall back to HTML scrape when LINKEDIN_ACCESS_TOKEN is not set', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockResolvedValue({ data: mockScrapeHtml });

    const jobs = await adapter.search('react developer');

    expect(jobs).toHaveLength(2);
    expect(jobs[0].source).toBe('linkedin');
    expect(jobs[0].sourceId).toBe('li-scrape-001');
    expect(jobs[0].title).toBe('React Developer');
    expect(jobs[0].company).toBe('Startup Inc');
    expect(jobs[0].location).toBe('Remote');
    expect(jobs[1].title).toBe('Backend Engineer');
    expect(jobs[1].company).toBe('Another Co');
    expect(jobs[1].location).toBe('New York, NY');
  });

  it('should configure scrape URL with query and location', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockResolvedValue({ data: mockScrapeHtml });

    await adapter.search('data scientist', { location: 'Austin, TX' });

    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('linkedin.com/jobs/search'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla'),
        }),
        params: expect.objectContaining({
          keywords: 'data scientist',
          location: 'Austin, TX',
        }),
      })
    );
  });

  // ─── Handles errors gracefully ─────────────────────────────────────────

  it('should return empty array when API call fails and no fallback needed', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'mock-token';
    httpClient.get.mockRejectedValue(new Error('API error'));

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  it('should return empty array when scrape fails', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockRejectedValue(new Error('Network error'));

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  it('should return empty array when scrape returns empty HTML', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockResolvedValue({ data: '<html><body></body></html>' });

    const jobs = await adapter.search('engineer');

    expect(jobs).toEqual([]);
  });

  // ─── testConnection ─────────────────────────────────────────────────────

  it('should return true when API testConnection succeeds', async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = 'mock-token';
    httpClient.get.mockResolvedValue({ data: { elements: [], paging: {} } });

    const result = await adapter.testConnection();

    expect(result).toBe(true);
    // Should hit the API endpoint
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('api.linkedin.com'),
      expect.any(Object)
    );
  });

  it('should return true when scrape testConnection succeeds', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockResolvedValue({ data: mockScrapeHtml });

    const result = await adapter.testConnection();

    expect(result).toBe(true);
    // Should hit the scrape endpoint
    expect(httpClient.get).toHaveBeenCalledWith(
      expect.stringContaining('linkedin.com'),
      expect.any(Object)
    );
  });

  it('should return false when testConnection fails', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    httpClient.get.mockRejectedValue(new Error('Network error'));

    const result = await adapter.testConnection();

    expect(result).toBe(false);
  });

  // ─── handle missing/null fields gracefully ─────────────────────────────

  it('should handle missing fields in scrape results', async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    const partialHtml = `
    <html><body>
    <div class="base-card">
      <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/li-min-001"></a>
      <h3 class="base-search-card__title">Unknown Role</h3>
    </div>
    </body></html>`;
    httpClient.get.mockResolvedValue({ data: partialHtml });

    const jobs = await adapter.search('test');

    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe('');
    expect(jobs[0].location).toBeNull();
  });
});
