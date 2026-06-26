import { JobSource, NormalizedJob, SearchResult } from "../types";
import { BaseSourceAdapter, SearchOptions } from "./base";
import { IndeedAdapter } from "./indeed";
import { GreenhouseAdapter } from "./greenhouse";
import { LeverAdapter } from "./lever";
import { LinkedInAdapter } from "./linkedin";

// ─── Module-level adapter cache ─────────────────────────────────────────────

const adapters = new Map<JobSource, BaseSourceAdapter>();

/**
 * Reset the adapter cache (useful for testing).
 */
export function resetAdapters(): void {
  adapters.clear();
}
/**
 * Create a new adapter instance for the given source.
 */
function createAdapter(source: JobSource): BaseSourceAdapter {
  switch (source) {
    case "indeed":
      return new IndeedAdapter();
    case "greenhouse":
      return new GreenhouseAdapter();
    case "lever":
      return new LeverAdapter();
    case "linkedin":
      return new LinkedInAdapter();
    default:
      throw new Error(`Unknown source: ${source}`);
  }
}

/**
 * Get (or create) a singleton source adapter by name.
 */
export function getAdapter(source: JobSource): BaseSourceAdapter {
  if (!adapters.has(source)) {
    adapters.set(source, createAdapter(source));
  }
  return adapters.get(source)!;
}

// ─── Default source list ────────────────────────────────────────────────────

const DEFAULT_SOURCES: JobSource[] = ["indeed", "greenhouse", "lever", "linkedin"];

/**
 * Search across multiple job sources in parallel.
 *
 * Each source is searched independently and errors are captured per-source
 * so a single failing source never blocks the others (fail-open).
 *
 * @param query     - The search query/keyword
 * @param options   - Optional filters (location, jobType, minSalary, experienceLevel)
 * @param sources   - Sources to search (defaults to all four implemented adapters)
 * @returns Array of SearchResult, one per source, in the same order as requested
 */
export async function searchAllSources(
  query: string,
  options?: SearchOptions,
  sources?: JobSource[]
): Promise<SearchResult[]> {
  const sourceList = sources ?? DEFAULT_SOURCES;

  const results = await Promise.allSettled(
    sourceList.map(async (source) => {
      const startTime = Date.now();
      try {
        const adapter = getAdapter(source);
        const jobs = await adapter.search(query, options);
        const latencyMs = Date.now() - startTime;
        return {
          source,
          jobs,
          totalCount: jobs.length,
          latencyMs,
        } satisfies SearchResult;
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        return {
          source,
          jobs: [] as NormalizedJob[],
          totalCount: 0,
          error: (err as Error).message,
          latencyMs,
        } satisfies SearchResult;
      }
    })
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          source: "indeed" as JobSource,
          jobs: [] as NormalizedJob[],
          totalCount: 0,
          error: (r.reason as Error)?.message ?? "Unexpected error",
        }
  );
}
