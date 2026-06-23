import { BaseSourceAdapter, SourceAdapterConfig, SearchOptions } from './base';
import { NormalizedJob, JobSource } from '../types';
import axios, { AxiosInstance } from 'axios';

interface GreenhouseMetadataItem {
  name: string;
  value: string;
}

interface GreenhouseOffice {
  name: string;
}

interface GreenhouseDepartment {
  name: string;
}

interface GreenhouseCompensation {
  value: string;
  unit: string;
}

interface GreenhouseJobSummary {
  id: number;
  title: string;
  offices?: GreenhouseOffice[];
  departments?: GreenhouseDepartment[];
  metadata?: GreenhouseMetadataItem[];
  updated_at: string;
  absolute_url: string;
}

interface GreenhouseJobDetail {
  id: number;
  title: string;
  content?: string;
  offices?: GreenhouseOffice[];
  departments?: GreenhouseDepartment[];
  metadata?: GreenhouseMetadataItem[];
  updated_at: string;
  absolute_url: string;
  education?: string;
  minimum_compensation?: GreenhouseCompensation;
  maximum_compensation?: GreenhouseCompensation;
}

export class GreenhouseAdapter extends BaseSourceAdapter {
  private httpClient: AxiosInstance;

  constructor(httpClient?: AxiosInstance) {
    super({
      name: 'greenhouse',
      baseUrl: 'https://boards-api.greenhouse.io/v1/boards',
      rateLimitPerMin: 30,
      retryCount: 3,
    });
    this.httpClient = httpClient || axios.create();
  }

  async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
    try {
      const boardTokens = this.getBoardTokens();
      if (boardTokens.length === 0) return [];

      const allJobs: NormalizedJob[] = [];

      for (const token of boardTokens) {
        try {
          // Fetch job listings for this board
          const listUrl = `${this.config.baseUrl}/${token}/jobs`;
          const listResponse = await this.httpClient.get(listUrl);
          const listData = listResponse.data;
          const jobSummaries: GreenhouseJobSummary[] = listData.jobs || [];

          for (const summary of jobSummaries) {
            try {
              // Fetch individual job details
              const detailUrl = `${this.config.baseUrl}/${token}/jobs/${summary.id}`;
              const detailResponse = await this.httpClient.get(detailUrl);
              const detail: GreenhouseJobDetail = detailResponse.data;

              allJobs.push(this.normalizeJob(detail, token));
            } catch {
              // If detail fetch fails, normalize from summary data
              allJobs.push(this.normalizeJob(summary as any, token));
            }
          }
        } catch {
          // If board fetch fails, continue to next board
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
      const boardTokens = this.getBoardTokens();
      if (boardTokens.length === 0) return false;

      const url = `${this.config.baseUrl}/${boardTokens[0]}/jobs`;
      await this.httpClient.get(url);
      return true;
    } catch {
      return false;
    }
  }

  private getBoardTokens(): string[] {
    const tokens = process.env.GREENHOUSE_BOARD_TOKENS;
    if (!tokens || tokens.trim() === '') return [];
    return tokens.split(',').map((t) => t.trim()).filter(Boolean);
  }

  private extractSalary(
    meta: GreenhouseMetadataItem[] | undefined,
    detail: { minimum_compensation?: GreenhouseCompensation; maximum_compensation?: GreenhouseCompensation }
  ): { salaryMin: number | null; salaryMax: number | null } {
    // Try metadata first
    if (meta) {
      for (const item of meta) {
        if (item.name.toLowerCase().includes('salary') || item.name.toLowerCase().includes('compensation')) {
          const cleaned = item.value.replace(/[^0-9\-.,]/g, '').replace(/,/g, '');
          const parts = cleaned.split('-').map((s) => s.trim());
          if (parts.length >= 2) {
            const min = parseInt(parts[0].replace(/\./g, ''), 10);
            const max = parseInt(parts[1].replace(/\./g, ''), 10);
            return {
              salaryMin: isNaN(min) ? null : min,
              salaryMax: isNaN(max) ? null : max,
            };
          }
          const single = parseInt(cleaned.replace(/\./g, ''), 10);
          if (!isNaN(single)) {
            return { salaryMin: single, salaryMax: null };
          }
        }
      }
    }

    // Try compensation fields
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;

    if (detail.minimum_compensation) {
      const val = parseInt(detail.minimum_compensation.value, 10);
      if (!isNaN(val)) salaryMin = val;
    }
    if (detail.maximum_compensation) {
      const val = parseInt(detail.maximum_compensation.value, 10);
      if (!isNaN(val)) salaryMax = val;
    }

    return { salaryMin, salaryMax };
  }

  private normalizeJob(raw: GreenhouseJobDetail, boardToken: string): NormalizedJob {
    // Extract location from offices array
    let location: string | null = null;
    if (raw.offices && raw.offices.length > 0) {
      location = raw.offices.map((o) => o.name).filter(Boolean).join(', ');
    }

    // Extract type from metadata
    let type: string | null = null;
    if (raw.metadata) {
      for (const item of raw.metadata) {
        const name = item.name.toLowerCase();
        if (name.includes('type') || name.includes('employment') || name.includes('work')) {
          type = item.value;
          break;
        }
      }
    }

    // Extract salary
    const { salaryMin, salaryMax } = this.extractSalary(raw.metadata, raw);

    // Parse date
    let postedAt: string;
    try {
      postedAt = raw.updated_at
        ? new Date(raw.updated_at).toISOString()
        : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    // Get description snippet from content HTML
    let descriptionSnippet: string | null = null;
    if (raw.content) {
      descriptionSnippet = raw.content.replace(/<[^>]*>/g, '').trim().substring(0, 500) || null;
    }

    return {
      source: 'greenhouse',
      sourceId: String(raw.id),
      title: raw.title || '',
      company: boardToken,
      location: location,
      type: type,
      salaryMin,
      salaryMax,
      postedAt,
      url: raw.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${raw.id}`,
      descriptionSnippet,
      tags: [],
    };
  }
}
