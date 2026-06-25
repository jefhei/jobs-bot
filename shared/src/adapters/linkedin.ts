import { BaseSourceAdapter, SourceAdapterConfig, SearchOptions } from './base';
import { NormalizedJob, JobSource } from '../types';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

// ─── Interfaces for LinkedIn API response ────────────────────────────────────

interface LinkedInApiJob {
  jobId?: string;
  title?: string;
  companyDetails?: { name?: string };
  description?: { text?: string };
  location?: string;
  employmentType?: string;
  listedAt?: number; // epoch ms
  applyUrl?: string;
}

interface LinkedInApiResponse {
  elements?: LinkedInApiJob[];
  paging?: { count?: number; start?: number; total?: number };
}

interface ScrapedJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  date: string | null;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class LinkedInAdapter extends BaseSourceAdapter {
  private httpClient: AxiosInstance;
  private apiBaseUrl = 'https://api.linkedin.com/v2/jobs/search';
  private scrapeBaseUrl = 'https://www.linkedin.com/jobs/search';

  constructor(httpClient?: AxiosInstance) {
    super({
      name: 'linkedin',
      baseUrl: 'https://api.linkedin.com/v2/jobs/search',
      rateLimitPerMin: 10,
      retryCount: 3,
    });
    this.httpClient = httpClient || axios.create();
  }

  async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN;

    if (token) {
      return this.searchViaApi(query, options, token);
    }

    return this.searchViaScrape(query, options);
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = process.env.LINKEDIN_ACCESS_TOKEN;

      if (token) {
        await this.httpClient.get(this.apiBaseUrl, {
          headers: { Authorization: `Bearer ${token}` },
          params: { keywords: 'test', count: 1 },
        });
      } else {
        await this.httpClient.get(this.scrapeBaseUrl, {
          headers: this.getScrapeHeaders(),
          params: { keywords: 'test' },
        });
      }

      return true;
    } catch {
      return false;
    }
  }

  // ─── Private: API mode ─────────────────────────────────────────────────

  private async searchViaApi(
    query: string,
    options?: SearchOptions,
    token?: string
  ): Promise<NormalizedJob[]> {
    try {
      const params: Record<string, any> = {
        keywords: query,
        count: 25,
      };

      if (options?.location) params.location = options.location;
      if (options?.jobType) {
        params.employmentType = this.mapJobType(options.jobType);
      }

      const response = await this.httpClient.get(this.apiBaseUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        params,
      });

      const data: LinkedInApiResponse = response.data;
      const elements = data.elements || [];

      return elements.map((job) => this.normalizeFromApi(job));
    } catch {
      return [];
    }
  }

  private normalizeFromApi(raw: LinkedInApiJob): NormalizedJob {
    let postedAt: string;
    try {
      postedAt = raw.listedAt
        ? new Date(raw.listedAt).toISOString()
        : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    return {
      source: 'linkedin',
      sourceId: raw.jobId || String(Date.now()),
      title: raw.title || '',
      company: raw.companyDetails?.name || '',
      location: raw.location || null,
      type: raw.employmentType || null,
      salaryMin: null,
      salaryMax: null,
      postedAt,
      url: raw.applyUrl || '',
      descriptionSnippet: raw.description?.text
        ? raw.description.text.substring(0, 500)
        : null,
      tags: [],
    };
  }

  // ─── Private: Scrape mode ──────────────────────────────────────────────

  private async searchViaScrape(
    query: string,
    options?: SearchOptions
  ): Promise<NormalizedJob[]> {
    try {
      const params: Record<string, any> = {
        keywords: query,
      };

      if (options?.location) params.location = options.location;

      const response = await this.httpClient.get(this.scrapeBaseUrl, {
        headers: this.getScrapeHeaders(),
        params,
      });

      const html: string = response.data;
      const scrapedJobs = this.parseScrapedHtml(html);

      return scrapedJobs.map((job) => this.normalizeFromScrape(job));
    } catch {
      return [];
    }
  }

  private getScrapeHeaders(): Record<string, string> {
    return {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };
  }

  private parseScrapedHtml(html: string): ScrapedJob[] {
    const $ = cheerio.load(html);
    const jobs: ScrapedJob[] = [];

    // LinkedIn job cards use these selectors (as of 2025)
    $('.base-card').each((_i: number, el: any) => {
      const $el = $(el);

      // Extract job ID from the apply link
      const linkHref =
        $el.find('a.base-card__full-link').attr('href') || '';
      const jobId = this.extractJobId(linkHref);

      const title =
        $el.find('.base-search-card__title').text().trim() || '';

      const company =
        $el.find('.base-search-card__subtitle').text().trim() || '';

      const location =
        $el.find('.job-search-card__location').text().trim() || null;

      const dateStr =
        $el.find('time.job-search-card__listdate').attr('datetime') ||
        $el.find('time.job-search-card__listdate').text().trim() ||
        null;

      if (title && jobId) {
        jobs.push({
          id: jobId,
          title,
          company,
          location,
          date: dateStr,
        });
      }
    });

    return jobs;
  }

  private extractJobId(url: string): string {
    // LinkedIn job URLs: /jobs/view/1234567890 or /jobs/collections/...
    const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];

    // Fallback: use the last path segment
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || String(Date.now());
  }

  private normalizeFromScrape(raw: ScrapedJob): NormalizedJob {
    let postedAt: string;
    try {
      postedAt = raw.date ? new Date(raw.date).toISOString() : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    return {
      source: 'linkedin',
      sourceId: raw.id,
      title: raw.title,
      company: raw.company,
      location: raw.location || null,
      type: null,
      salaryMin: null,
      salaryMax: null,
      postedAt,
      url: `https://www.linkedin.com/jobs/view/${raw.id}`,
      descriptionSnippet: null,
      tags: [],
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private mapJobType(jobType: string): string {
    const mapping: Record<string, string> = {
      fulltime: 'FULL_TIME',
      parttime: 'PART_TIME',
      contract: 'CONTRACT',
      internship: 'INTERNSHIP',
    };
    return mapping[jobType] || jobType.toUpperCase();
  }
}
