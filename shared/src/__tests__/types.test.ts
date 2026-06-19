import { describe, it, expect } from 'vitest';
import {
  JobSource,
  JobType,
  ExperienceLevel,
  NotifyChannel,
  JobListing,
  WatchConfigInput,
  NormalizedJob,
  SearchQuery,
  SearchResult,
} from '../types';

describe('JobSource union type', () => {
  it('should allow valid JobSource values', () => {
    const sources: JobSource[] = [
      'linkedin',
      'indeed',
      'greenhouse',
      'lever',
      'glassdoor',
      'workday',
      'hn',
      'remoteco',
    ];
    expect(sources).toHaveLength(8);
    expect(sources).toContain('linkedin');
    expect(sources).toContain('indeed');
    expect(sources).toContain('greenhouse');
    expect(sources).toContain('lever');
    expect(sources).toContain('glassdoor');
    expect(sources).toContain('workday');
    expect(sources).toContain('hn');
    expect(sources).toContain('remoteco');
  });

  it('should not allow invalid source values (compile-time check)', () => {
    const invalid = 'invalidSource' as JobSource;
    // This is a runtime check to complement compile-time safety
    const validSources: readonly string[] = [
      'linkedin', 'indeed', 'greenhouse', 'lever',
      'glassdoor', 'workday', 'hn', 'remoteco',
    ] as const;
    expect(validSources).not.toContain(invalid);
  });
});

describe('JobType enum (as const object)', () => {
  it('should have correct keys and values', () => {
    expect(JobType.fulltime).toBe('fulltime');
    expect(JobType.parttime).toBe('parttime');
    expect(JobType.contract).toBe('contract');
    expect(JobType.internship).toBe('internship');
  });

  it('should have exactly 4 keys', () => {
    expect(Object.keys(JobType)).toHaveLength(4);
  });
});

describe('ExperienceLevel enum (as const object)', () => {
  it('should have correct keys and values', () => {
    expect(ExperienceLevel.entry).toBe('entry');
    expect(ExperienceLevel.mid).toBe('mid');
    expect(ExperienceLevel.senior).toBe('senior');
    expect(ExperienceLevel.lead).toBe('lead');
    expect(ExperienceLevel.exec).toBe('exec');
  });

  it('should have exactly 5 keys', () => {
    expect(Object.keys(ExperienceLevel)).toHaveLength(5);
  });
});

describe('NotifyChannel enum (as const object)', () => {
  it('should have correct keys and values', () => {
    expect(NotifyChannel.telegram).toBe('telegram');
    expect(NotifyChannel.email).toBe('email');
    expect(NotifyChannel.webhook).toBe('webhook');
  });

  it('should have exactly 3 keys', () => {
    expect(Object.keys(NotifyChannel)).toHaveLength(3);
  });
});

describe('JobListing interface', () => {
  it('should allow constructing a valid JobListing with all fields', () => {
    const job: JobListing = {
      id: 'abc-123',
      source: 'linkedin',
      title: 'Software Engineer',
      company: 'Acme Corp',
      location: 'San Francisco, CA',
      type: 'fulltime',
      salaryMin: 100000,
      salaryMax: 150000,
      postedAt: '2025-01-15T10:00:00.000Z',
      url: 'https://linkedin.com/jobs/123',
      descriptionSnippet: 'We are looking for a software engineer...',
      tags: ['javascript', 'typescript', 'react'],
      fingerprint: 'a1b2c3d4e5f6...',
    };
    expect(job.id).toBe('abc-123');
    expect(job.source).toBe('linkedin');
    expect(job.fingerprint).toBe('a1b2c3d4e5f6...');
    expect(job.tags).toEqual(['javascript', 'typescript', 'react']);
  });

  it('should allow null fields', () => {
    const job: JobListing = {
      id: 'def-456',
      source: 'indeed',
      title: 'Junior Developer',
      company: 'Startup Inc',
      location: null,
      type: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: '2025-02-01T08:00:00.000Z',
      url: 'https://indeed.com/jobs/456',
      descriptionSnippet: null,
      tags: [],
      fingerprint: 'xyz789',
    };
    expect(job.location).toBeNull();
    expect(job.type).toBeNull();
    expect(job.salaryMin).toBeNull();
    expect(job.salaryMax).toBeNull();
    expect(job.descriptionSnippet).toBeNull();
    expect(job.tags).toEqual([]);
    expect(job.fingerprint).toBe('xyz789');
  });
});

describe('WatchConfigInput interface', () => {
  it('should allow constructing with required fields only', () => {
    const watch: WatchConfigInput = {
      keyword: 'software engineer',
      sources: ['linkedin', 'indeed'],
    };
    expect(watch.keyword).toBe('software engineer');
    expect(watch.sources).toEqual(['linkedin', 'indeed']);
    expect(watch.intervalMinutes).toBeUndefined();
  });

  it('should allow constructing with all optional fields', () => {
    const watch: WatchConfigInput = {
      keyword: 'react developer',
      location: 'Remote',
      jobType: 'fulltime',
      minSalary: 80000,
      experienceLevel: 'mid',
      sources: ['greenhouse', 'lever'],
      intervalMinutes: 60,
      notifyVia: ['telegram', 'email'],
    };
    expect(watch.keyword).toBe('react developer');
    expect(watch.location).toBe('Remote');
    expect(watch.jobType).toBe('fulltime');
    expect(watch.minSalary).toBe(80000);
    expect(watch.experienceLevel).toBe('mid');
    expect(watch.intervalMinutes).toBe(60);
    expect(watch.notifyVia).toEqual(['telegram', 'email']);
  });

  it('should use typed enum values for jobType and experienceLevel', () => {
    const watch: WatchConfigInput = {
      keyword: 'senior engineer',
      jobType: 'contract',
      experienceLevel: 'senior',
      sources: ['hn'],
    };
    expect(watch.jobType).toBe('contract');
    expect(watch.experienceLevel).toBe('senior');
  });
});

describe('NormalizedJob interface', () => {
  it('should have sourceId but NOT fingerprint', () => {
    const job: NormalizedJob = {
      source: 'glassdoor',
      sourceId: 'original-id-789',
      title: 'Data Scientist',
      company: 'Big Data Co',
      location: 'New York, NY',
      type: 'fulltime',
      salaryMin: 120000,
      salaryMax: 180000,
      postedAt: '2025-03-01T12:00:00.000Z',
      url: 'https://glassdoor.com/jobs/789',
      descriptionSnippet: 'Looking for a data scientist...',
      tags: ['python', 'machine-learning'],
    };
    expect(job.sourceId).toBe('original-id-789');
    expect(job.source).toBe('glassdoor');
    // @ts-expect-error - fingerprint should NOT exist on NormalizedJob
    expect(job.fingerprint).toBeUndefined();
  });

  it('should allow null fields', () => {
    const job: NormalizedJob = {
      source: 'workday',
      sourceId: 'wd-001',
      title: 'Analyst',
      company: 'Workplace Inc',
      location: null,
      type: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: '2025-04-01T00:00:00.000Z',
      url: 'https://workday.com/jobs/001',
      descriptionSnippet: null,
      tags: [],
    };
    expect(job.location).toBeNull();
    expect(job.descriptionSnippet).toBeNull();
    expect(job.tags).toEqual([]);
  });
});

describe('SearchQuery interface', () => {
  it('should allow constructing with required query only', () => {
    const q: SearchQuery = {
      query: 'typescript developer',
    };
    expect(q.query).toBe('typescript developer');
    expect(q.location).toBeUndefined();
    expect(q.sources).toBeUndefined();
  });

  it('should allow constructing with all search filters', () => {
    const q: SearchQuery = {
      query: 'react native',
      location: 'Remote',
      jobType: 'contract',
      minSalary: 50000,
      experienceLevel: 'senior',
      sources: ['linkedin', 'hn'],
    };
    expect(q.query).toBe('react native');
    expect(q.location).toBe('Remote');
    expect(q.jobType).toBe('contract');
    expect(q.minSalary).toBe(50000);
    expect(q.experienceLevel).toBe('senior');
    expect(q.sources).toEqual(['linkedin', 'hn']);
  });
});

describe('SearchResult interface', () => {
  it('should allow constructing a valid SearchResult', () => {
    const result: SearchResult = {
      source: 'linkedin',
      jobs: [
        {
          source: 'linkedin',
          sourceId: 'li-001',
          title: 'Full Stack Engineer',
          company: 'Tech Co',
          location: 'Austin, TX',
          type: 'fulltime',
          salaryMin: null,
          salaryMax: null,
          postedAt: '2025-05-01T09:00:00.000Z',
          url: 'https://linkedin.com/jobs/001',
          descriptionSnippet: null,
          tags: ['node', 'react'],
        },
      ],
      totalCount: 1,
    };
    expect(result.source).toBe('linkedin');
    expect(result.jobs).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeUndefined();
  });

  it('should allow error and latencyMs fields', () => {
    const result: SearchResult = {
      source: 'indeed',
      jobs: [],
      totalCount: 0,
      error: 'Rate limited',
      latencyMs: 1500,
    };
    expect(result.error).toBe('Rate limited');
    expect(result.latencyMs).toBe(1500);
  });
});
