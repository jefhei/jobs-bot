import { Worker } from "bullmq";
import { prisma, redis, isDuplicate, markSeen, searchAllSources } from "@jobpulse/shared";
import type { MonitorConfig } from "./config";
import { JobSource, NormalizedJob, SearchOptions } from "@jobpulse/shared";

// ─── Logging Helper ──────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
  console.log("[@jobpulse/monitor]", ...args);
}

// ─── Backoff Strategy ─────────────────────────────────────────────────────────

const BACKOFF_DELAYS = [5 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000]; // 5, 10, 30 min

function backoffStrategy(attempt: number): number {
  const idx = Math.min(attempt - 1, BACKOFF_DELAYS.length - 1);
  return BACKOFF_DELAYS[idx];
}

// ─── Degradation Key ─────────────────────────────────────────────────────────

const DEGRADED_TTL = 60 * 60; // 1 hour in seconds
const MAX_CONSECUTIVE_FAILURES = 3;

function degradedKey(source: string): string {
  return `degraded:${source}`;
}

// ─── Poller Factory ──────────────────────────────────────────────────────────

export interface PollerInstance {
  worker: Worker;
  close: () => Promise<void>;
}

export function createPoller(config: MonitorConfig): PollerInstance {
  // Parse Redis URL for connection config
  const redisUrlObj = new URL(config.redisUrl);
  const connection = {
    host: redisUrlObj.hostname,
    port: parseInt(redisUrlObj.port || "6379", 10),
    maxRetriesPerRequest: null,
  };

  // Track consecutive failures per watch config for degradation
  const consecutiveFailures = new Map<string, number>();

  async function processJob(job: { data: { watchConfigId: string }; id?: string; attemptsMade?: number }): Promise<void> {
    const { watchConfigId } = job.data;
    const startTime = Date.now();

    try {
      // 1. Fetch WatchConfig
      const watchConfig = await prisma.watchConfig.findUniqueOrThrow({
        where: { id: watchConfigId },
      });

      const { userId, keyword, location, jobType, minSalary, experienceLevel, sources } = watchConfig;

      // 2. Check for degraded sources
      const activeSources: JobSource[] = [];
      for (const source of sources as JobSource[]) {
        const degraded = await redis.get(degradedKey(source));
        if (degraded) {
          log(`Skipping degraded source: ${source} for watchConfig=${watchConfigId}`);
        } else {
          activeSources.push(source);
        }
      }

      if (activeSources.length === 0) {
        log(`All sources degraded for watchConfig=${watchConfigId}, skipping poll`);
        return;
      }

      // 3. Search all sources
      const searchOptions: SearchOptions = {
        location: location ?? undefined,
        jobType: jobType ?? undefined,
        minSalary: minSalary ?? undefined,
        experienceLevel: experienceLevel ?? undefined,
      };

      // We search each source individually for better control of per-source dedup
      // Use searchAllSources which handles per-source errors gracefully
      const searchResults = await searchAllSources(keyword, searchOptions, activeSources);

      // 4. Process results
      let totalResults = 0;
      let newResults = 0;
      const allErrors: string[] = [];

      for (const result of searchResults) {
        totalResults += result.totalCount;

        if (result.error) {
          allErrors.push(`${result.source}: ${result.error}`);
          // Track failure for degradation
          const source = result.source;
          const currentFailures = (consecutiveFailures.get(source) || 0) + 1;
          consecutiveFailures.set(source, currentFailures);

          if (currentFailures >= MAX_CONSECUTIVE_FAILURES) {
            log(`Source ${source} degraded after ${currentFailures} consecutive failures`);
            await redis.setex(degradedKey(source), DEGRADED_TTL, "1");
            consecutiveFailures.delete(source);
          }
          continue;
        }

        // Reset consecutive failures on success
        consecutiveFailures.delete(result.source);

        for (const jobItem of result.jobs) {
          const fingerprint = `${jobItem.source}:${jobItem.sourceId}`;

          // 5. Dedup check
          const duplicate = await isDuplicate(userId, jobItem.sourceId, jobItem.source);
          if (duplicate) {
            continue;
          }

          // 6. Mark as seen
          await markSeen(userId, jobItem.sourceId, jobItem.source);

          // 7. Upsert JobListing
          await prisma.jobListing.upsert({
            where: { id: fingerprint },
            create: {
              id: fingerprint,
              source: jobItem.source,
              title: jobItem.title,
              company: jobItem.company,
              location: jobItem.location,
              type: jobItem.type,
              salaryMin: jobItem.salaryMin ?? null,
              salaryMax: jobItem.salaryMax ?? null,
              postedAt: new Date(jobItem.postedAt),
              url: jobItem.url,
              descriptionSnippet: jobItem.descriptionSnippet,
              tags: jobItem.tags,
            },
            update: {},
          });

          // 8. Create JobMatch (try/catch for unique constraint)
          try {
            await prisma.jobMatch.create({
              data: {
                jobId: fingerprint,
                watchConfigId,
              },
            });
          } catch (err: unknown) {
            // Ignore unique constraint violation (duplicate match)
            if (err instanceof Error && err.message.includes("Unique constraint")) {
              // Already matched, skip
            } else {
              throw err;
            }
          }

          newResults++;
        }
      }

      // 9. Update lastPolledAt
      await prisma.watchConfig.update({
        where: { id: watchConfigId },
        data: { lastPolledAt: new Date() },
      });

      // 10. Structured log
      const latencyMs = Date.now() - startTime;
      // Log per-source breakdown
      for (const result of searchResults) {
        const sourceNewCount = result.jobs.filter((j) => {
          // We can't easily track per-source new count here without more data
          // Use an approximation
          return !result.error;
        }).length;

        log(
          `Poll cycle — watchConfigId=${watchConfigId}, source=${result.source}, keyword=${keyword}, location=${location ?? "any"}, results_count=${result.totalCount}, new_count=${newResults}, latency_ms=${latencyMs}`
        );
      }

      // Log any errors
      if (allErrors.length > 0) {
        log(`Poll errors for watchConfig=${watchConfigId}: ${allErrors.join("; ")}`);
      }
    } catch (err) {
      log(`Poll failed for watchConfig=${watchConfigId}: ${(err as Error).message}`);
      throw err; // Re-throw for BullMQ retry
    }
  }

  // Create the BullMQ Worker
  const worker = new Worker(config.pollQueueName, processJob, {
    connection,
    maxStalledCount: 0,
    settings: {
      backoffStrategy,
    },
  });

  // Listen for failed jobs to track consecutive failures
  worker.on("failed", (job, err) => {
    if (job) {
      const { watchConfigId } = job.data;
      const attempts = job.attemptsMade || 0;
      log(`Job failed for watchConfig=${watchConfigId} (attempt ${attempts + 1}): ${err.message}`);
    }
  });

  let closed = false;

  return {
    worker,
    close: async () => {
      if (closed) return;
      closed = true;
      await worker.close();
    },
  };
}
