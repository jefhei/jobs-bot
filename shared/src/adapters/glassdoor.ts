import { BaseSourceAdapter, SourceAdapterConfig, SearchOptions } from './base';
import { NormalizedJob, JobSource } from '../types';
import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';

// ─── Interfaces for Glassdoor scraping ─────────────────────────────────────

interface GlassdoorScrapedJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  datePosted: string | null;
  url: string;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class GlassdoorAdapter extends BaseSourceAdapter {
  private httpClient: AxiosInstance;
  private scrapeBaseUrl = 'https://www.glassdoor.com/Job/jobs.htm';

  constructor(httpClient?: AxiosInstance) {
    super({
      name: 'glassdoor',
      baseUrl: 'https://www.glassdoor.com/Job',
      rateLimitPerMin: 10,
      retryCount: 2,
    });
    this.httpClient = httpClient || axios.create();
  }

  async search(query: string, options?: SearchOptions): Promise<NormalizedJob[]> {
    return this.searchViaScrape(query, options);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.httpClient.get(this.scrapeBaseUrl, {
        headers: this.getScrapeHeaders(),
        params: { keyword: 'test', countryRedirect: true },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private: Scrape mode ──────────────────────────────────────────────

  private async searchViaScrape(
    query: string,
    options?: SearchOptions
  ): Promise<NormalizedJob[]> {
    try {
      const params: Record<string, any> = {
        keyword: query,
        countryRedirect: true,
      };

      if (options?.location) params.loc = options.location;
      if (options?.jobType) params.jt = options.jobType;

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

  private parseScrapedHtml(html: string): GlassdoorScrapedJob[] {
    const $ = cheerio.load(html);
    const jobs: GlassdoorScrapedJob[] = [];

    // Glassdoor job listing cards typically use selectors like:
    //   .jobListing (or [data-test="jobListing"])
    //   .job-title
    //   .employer-name
    //   .location
    $('li[data-test="jobListing"], .react-job-listing, .jobListing').each(
      (_i: number, el: any) => {
        const $el = $(el);

        const titleEl =
          $el.find(
            '.jobTitle a, .job-title, [data-test="job-title"] a, a.job-link'
          );
        const title = titleEl.text().trim();
        const linkHref = titleEl.attr('href') || '';

        const company =
          $el
            .find(
              '.employer-name, .company-name, [data-test="employer-name"]'
            )
            .text()
            .trim() || '';

        const location =
          $el
            .find(
              '.location, .job-location, [data-test="location"]'
            )
            .text()
            .trim() || null;

        const salary =
          $el
            .find(
              '.salary-estimate, .salary, [data-test="salary"]'
            )
            .text()
            .trim() || null;

        const datePosted =
          $el
            .find(
              '.date, .job-age, .listing-age, [data-test="date"]'
            )
            .text()
            .trim() || null;

        // Extract job ID from the listing or generate from URL
        const jobId =
          $el.attr('data-jobid') ||
          $el.attr('id') ||
          this.extractJobId(linkHref) ||
          String(Date.now());

        if (title && company) {
          jobs.push({
            id: jobId,
            title,
            company,
            location,
            salary,
            datePosted,
            url: linkHref.startsWith('http')
              ? linkHref
              : `https://www.glassdoor.com${linkHref}`,
          });
        }
      }
    );

    return jobs;
  }

  private extractJobId(url: string): string | null {
    // Glassdoor job URLs: /Job/job-title-jobs-SRCH_KO0,<id>.htm
    const idMatch = url.match(/SRCH_KO0,(\d+)/);
    if (idMatch) return idMatch[1];

    // Alternative: /partner/jobListing.htm?jobListingId=<id>
    const paramMatch = url.match(/jobListingId=(\d+)/);
    if (paramMatch) return paramMatch[1];

    return null;
  }

  private normalizeFromScrape(raw: GlassdoorScrapedJob): NormalizedJob {
    // Parse salary string like "$70K-$100K" or "$50,000 - $80,000"
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;
    if (raw.salary) {
      const cleaned = raw.salary.replace(/[^0-9KkMmBb\-–—]/g, '').trim();
      const parts = cleaned.split(/[-–—]/).map((s) => s.trim());
      if (parts.length >= 2) {
        salaryMin = this.parseSalaryString(parts[0]);
        salaryMax = this.parseSalaryString(parts[1]);
      } else if (parts.length === 1) {
        salaryMin = this.parseSalaryString(parts[0]);
      }
    }

    let postedAt: string;
    try {
      postedAt = raw.datePosted
        ? new Date(raw.datePosted).toISOString()
        : new Date().toISOString();
    } catch {
      postedAt = new Date().toISOString();
    }

    return {
      source: 'glassdoor',
      sourceId: raw.id,
      title: raw.title,
      company: raw.company,
      location: raw.location || null,
      type: null,
      salaryMin,
      salaryMax,
      postedAt,
      url: raw.url,
      descriptionSnippet: null,
      tags: [],
    };
  }

  private parseSalaryString(s: string): number | null {
    const isK = /k/i.test(s);
    const isM = /m/i.test(s);
    const num = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return null;
    if (isM) return Math.round(num * 1000000);
    if (isK) return Math.round(num * 1000);
    return Math.round(num);
  }
}
