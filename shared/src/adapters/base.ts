import { NormalizedJob, JobSource } from "../types";

// ─── Configuration Interface ────────────────────────────────────────────────

export interface SourceAdapterConfig {
  name: JobSource;
  baseUrl: string;
  rateLimitPerMin?: number;
  retryCount?: number;
}

// ─── Search Options ─────────────────────────────────────────────────────────

export interface SearchOptions {
  location?: string;
  jobType?: string;
  minSalary?: number;
  experienceLevel?: string;
}

// ─── Abstract Base Class ────────────────────────────────────────────────────

export abstract class BaseSourceAdapter {
  public readonly config: SourceAdapterConfig;

  constructor(config: SourceAdapterConfig) {
    this.config = config;
  }

  /**
   * Search for jobs matching the given query and optional filters.
   */
  abstract search(
    query: string,
    options?: SearchOptions
  ): Promise<NormalizedJob[]>;

  /**
   * Test whether the source adapter can successfully connect to its target API.
   */
  abstract testConnection(): Promise<boolean>;
}
