import { BaseSourceAdapter, SourceAdapterConfig, SearchOptions } from './base';
import { NormalizedJob, JobSource } from '../types';
import axios, { AxiosInstance } from 'axios';

// ─── Interfaces for Lever API response ───────────────────────────────────────

interface LeverJobCategories {
  location?: string;
  commitment?: string;
  team?: string;
  level?: string;
  allLocations?: string[];
}

interface LeverJob {
  id: string;
  text?: string;
  categories?: LeverJobCategories;
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additional?: string;
  additionalPlain?: string;
  country?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class LeverAdapter extends BaseSourceAdapter {
  private httpClient: AxiosInstance;

  constructor(httpClient?: AxiosInstance) {
    super({
      name: 'lever',
      baseUrl: 'https://api.lever.co/v0/postings',
      rateLimitPerMin: 30,
      retryCount: 3,
    });
    this.httpClient = httpClient || axios.create();
  }

  async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
    try {
      const companyIds = this.getCompanyIds();
      if (companyIds.length === 0) return [];

      const allJobs: NormalizedJob[] = [];

      for (const companyId of companyIds) {
        try {
          const url = `${this.config.baseUrl}/${companyId}?limit=100`;
          const response = await this.httpClient.get(url);
          const jobs: LeverJob[] = response.data || [];

          for (const job of jobs) {
            allJobs.push(this.normalizeJob(job, companyId));
          }
        } catch {
          // If a company fetch fails, continue to the next one
          continue;
        }
      }

      return allJobs;
    } catch (error) {
      return [];
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const companyIds = this.getCompanyIds();
      if (companyIds.length === 0) return false;

      const url = `${this.config.baseUrl}/${companyIds[0]}?limit=1`;
      await this.httpClient.get(url);
      return true;
    } catch {
      return false;
    }
  }

  private getCompanyIds(): string[] {
    const ids = process.env.LEVER_COMPANY_IDS;
    if (!ids || ids.trim() === '') return [];
    return ids.split(',').map((id) => id.trim()).filter(Boolean);
  }

  private normalizeJob(raw: LeverJob, companyId: string): NormalizedJob {
    // Parse date
    let postedAt: string;
    try {
      postedAt = raw.createdAt
        ? new Date(raw.createdAt).toISOString()
        : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    // Get description snippet from descriptionPlain
    let descriptionSnippet: string | null = null;
    if (raw.descriptionPlain) {
      descriptionSnippet = raw.descriptionPlain.substring(0, 500);
    }

    return {
      source: 'lever',
      sourceId: String(raw.id),
      title: raw.text || '',
      company: companyId,
      location: raw.categories?.location || null,
      type: raw.categories?.commitment || null,
      salaryMin: null,
      salaryMax: null,
      postedAt,
      url: raw.hostedUrl || '',
      descriptionSnippet,
      tags: [],
    };
  }
}
