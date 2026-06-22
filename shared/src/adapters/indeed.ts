import { BaseSourceAdapter, SourceAdapterConfig, SearchOptions } from './base';
import { NormalizedJob, JobSource } from '../types';
import axios, { AxiosInstance } from 'axios';

export class IndeedAdapter extends BaseSourceAdapter {
  private httpClient: AxiosInstance;

  constructor(httpClient?: AxiosInstance) {
    super({
      name: 'indeed',
      baseUrl: 'https://api.indeed.com/ads/apisearch',
      rateLimitPerMin: 30,
      retryCount: 3,
    });
    this.httpClient = httpClient || axios.create();
  }

  async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
    try {
      const apiKey = process.env.INDEED_API_KEY;
      if (!apiKey) return [];

      const params: Record<string, any> = {
        publisher: apiKey,
        q: query,
        format: 'json',
        v: '2',
        limit: 25,
      };
      if (options?.location) params.l = options.location;
      if (options?.jobType) params.jt = options.jobType;
      if (options?.minSalary) params.salary = options.minSalary;

      const response = await this.httpClient.get(this.config.baseUrl, { params });
      const data = response.data;
      const results = data.results || [];

      return results.map((job: any) => this.normalizeJob(job));
    } catch (error) {
      return [];
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const apiKey = process.env.INDEED_API_KEY;
      if (!apiKey) return false;
      await this.httpClient.get(this.config.baseUrl, {
        params: { publisher: apiKey, q: 'test', format: 'json', v: '2', limit: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  private normalizeJob(raw: any): NormalizedJob {
    const location = [raw.city, raw.state].filter(Boolean).join(', ') || raw.formattedLocation || null;

    let salaryMin: number | null = null;
    if (raw.salary) {
      const cleaned = String(raw.salary).replace(/[^0-9]/g, '');
      if (cleaned.length > 0) {
        salaryMin = parseInt(cleaned, 10);
      }
    }

    let postedAt: string;
    try {
      postedAt = raw.postedDate
        ? new Date(raw.postedDate).toISOString()
        : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    return {
      source: 'indeed',
      sourceId: raw.jobkey || String(raw.jobkey),
      title: raw.jobtitle || '',
      company: raw.company || '',
      location: location,
      type: raw.jobType || null,
      salaryMin: salaryMin,
      salaryMax: null,
      postedAt,
      url: raw.url || `https://www.indeed.com/viewjob?jk=${raw.jobkey}`,
      descriptionSnippet: raw.snippet || null,
      tags: [],
    };
  }
}
