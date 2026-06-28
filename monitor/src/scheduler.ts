import { Queue, JobScheduler } from "bullmq";
import { MonitorConfig } from "./config";
import { prisma } from "@jobpulse/shared";

let activeScheduler: JobScheduler | null = null;

export async function startScheduler(
  config: MonitorConfig,
  queue: Queue
): Promise<void> {
  console.log("[@jobpulse/monitor] Scheduler starting...");
  
  // Parse Redis URL
  const redisUrl = new URL(config.redisUrl);
  
  // Create JobScheduler instance
  activeScheduler = new JobScheduler(config.pollQueueName, {
    connection: {
      host: redisUrl.hostname || "localhost",
      port: parseInt(redisUrl.port || "6379", 10),
      maxRetriesPerRequest: null,
    },
  });

  // Load all active WatchConfigs
  try {
    const watchConfigs = await prisma.watchConfig.findMany({
      where: { active: true },
    });

    if (watchConfigs.length === 0) {
      console.log("[@jobpulse/monitor] No active WatchConfigs found to schedule");
      return;
    }

    for (const wc of watchConfigs) {
      await scheduleWatch(activeScheduler, wc.id, wc.intervalMinutes);
    }

    console.log(`[@jobpulse/monitor] Scheduled ${watchConfigs.length} WatchConfig(s)`);
  } catch (error) {
    console.error("[@jobpulse/monitor] Failed to start scheduler:", error);
  }
}

export async function stopScheduler(): Promise<void> {
  if (activeScheduler) {
    await activeScheduler.close();
    activeScheduler = null;
    console.log("[@jobpulse/monitor] Scheduler stopped");
  }
}

export async function scheduleWatch(
  scheduler: JobScheduler,
  watchConfigId: string,
  intervalMinutes: number
): Promise<void> {
  // Ensure minimum interval of 1 minute
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  // Randomized jitter (0–120s) applied as offset to spread out polling
  // across WatchConfigs with the same interval, avoiding rate limit spikes
  const jitterMs = Math.floor(Math.random() * 120 * 1000);

  // Job name, data, and repeat options
  const jobName = `poll-${watchConfigId}`;
  const jobData = { watchConfigId };
  const repeatOpts = { every: intervalMs, immediately: true, offset: jitterMs };

  // In BullMQ v5, JobScheduler.upsertJobScheduler takes individual params:
  // (jobSchedulerId, repeatOpts, jobName, jobData, opts, { override })
  await scheduler.upsertJobScheduler(
    watchConfigId,
    repeatOpts,
    jobName,
    jobData,
    {} as any,
    { override: true }
  );
}

export async function removeWatchSchedule(
  scheduler: JobScheduler,
  watchConfigId: string
): Promise<void> {
  try {
    await scheduler.removeJobScheduler(watchConfigId);
  } catch (error) {
    console.error(
      `[@jobpulse/monitor] Failed to remove schedule for WatchConfig ${watchConfigId}:`,
      error
    );
  }
}
