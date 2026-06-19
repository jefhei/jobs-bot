// Type definitions for JobPulse shared core

// ─── Union Types ────────────────────────────────────────────────────────────

export type JobSource =
  | 'linkedin'
  | 'indeed'
  | 'greenhouse'
  | 'lever'
  | 'glassdoor'
  | 'workday'
  | 'hn'
  | 'remoteco';

// ─── Enum-like Const Objects ────────────────────────────────────────────────

export const JobType = {
  fulltime: 'fulltime',
  parttime: 'parttime',
  contract: 'contract',
  internship: 'internship',
} as const;

export type JobType = (typeof JobType)[keyof typeof JobType];

export const ExperienceLevel = {
  entry: 'entry',
  mid: 'mid',
  senior: 'senior',
  lead: 'lead',
  exec: 'exec',
} as const;

export type ExperienceLevel = (typeof ExperienceLevel)[keyof typeof ExperienceLevel];

export const NotifyChannel = {
  telegram: 'telegram',
  email: 'email',
  webhook: 'webhook',
} as const;

export type NotifyChannel = (typeof NotifyChannel)[keyof typeof NotifyChannel];

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface JobListing {
  id: string;
  source: JobSource;
  title: string;
  company: string;
  location: string | null;
  type: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string; // ISO date string
  url: string;
  descriptionSnippet: string | null;
  tags: string[];
  fingerprint: string; // SHA-256 hash for dedup
}

export interface WatchConfigInput {
  keyword: string;
  location?: string;
  jobType?: JobType;
  minSalary?: number;
  experienceLevel?: ExperienceLevel;
  sources: JobSource[];
  intervalMinutes?: number; // default 30
  notifyVia?: NotifyChannel[];
}

export interface NormalizedJob {
  source: JobSource;
  sourceId: string; // the original ID from the source
  title: string;
  company: string;
  location: string | null;
  type: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  postedAt: string; // ISO date string
  url: string;
  descriptionSnippet: string | null;
  tags: string[];
}

export interface SearchQuery {
  query: string;
  location?: string;
  jobType?: JobType;
  minSalary?: number;
  experienceLevel?: ExperienceLevel;
  sources?: JobSource[];
}

export interface SearchResult {
  source: JobSource;
  jobs: NormalizedJob[];
  totalCount: number;
  error?: string;
  latencyMs?: number;
}
