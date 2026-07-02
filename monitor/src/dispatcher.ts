import axios from "axios";
import { prisma, redis } from "@jobpulse/shared";
import type { NotifyChannel } from "@jobpulse/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DispatcherConfig {
  telegramBotToken: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
}

export interface DispatcherInstance {
  dispatch: (watchConfigId: string, jobMatchIds: string[]) => Promise<void>;
  close: () => Promise<void>;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface NotificationSettingRow {
  id: string;
  userId: string;
  channel: string;
  enabled: boolean;
  throttlePerHour: number;
  webhookUrl?: string | null;
}

interface JobMatchRow {
  id: string;
  jobId: string;
  watchConfigId: string;
  notifiedAt: Date | null;
  dismissed: boolean;
  createdAt: Date;
  saved: boolean;
  job: {
    id: string;
    source: string;
    title: string;
    company: string;
    location: string | null;
    type: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    postedAt: Date;
    url: string;
    descriptionSnippet: string | null;
    tags: string[];
  };
}

interface UserRow {
  id: string;
  telegramId: string | null;
  email: string | null;
}

interface WatchConfigWithUser {
  id: string;
  userId: string;
  keyword: string;
  location: string | null;
  jobType: string | null;
  minSalary: number | null;
  experienceLevel: string | null;
  sources: string[];
  intervalMinutes: number;
  notifyVia: string[];
  active: boolean;
  lastPolledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: UserRow;
  notificationSettings: NotificationSettingRow[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const THROTTLE_TTL_SECONDS = 3600; // 1 hour
const THROTTLE_REDIS_PREFIX = "throttle:notify:";

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
  console.log("[@jobpulse/monitor]", ...args);
}

function logError(...args: unknown[]): void {
  console.error("[@jobpulse/monitor]", ...args);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function throttleKey(userId: string, channel: string): string {
  return `${THROTTLE_REDIS_PREFIX}${userId}:${channel}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format a list of job matches into a Telegram HTML message.
 */
function formatTelegramMessage(
  keyword: string,
  location: string | null,
  jobs: JobMatchRow["job"][]
): string {
  const lines: string[] = [];
  lines.push("🎯 <b>New Job Match!</b>\n");

  const locStr = location ? `📍 ${location}` : "📍 Anywhere";
  lines.push(`🔍 <b>${escapeHtml(keyword)}</b> | ${locStr}\n`);

  jobs.forEach((job, idx) => {
    const num = idx + 1;
    const salary =
      job.salaryMin != null && job.salaryMax != null
        ? `$${job.salaryMin.toLocaleString()} - $${job.salaryMax.toLocaleString()}`
        : job.salaryMin != null
          ? `$${job.salaryMin.toLocaleString()}+`
          : job.salaryMax != null
            ? `Up to $${job.salaryMax.toLocaleString()}`
            : "Not specified";

    const jobType = job.type ?? "N/A";
    const snippet = job.descriptionSnippet
      ? escapeHtml(job.descriptionSnippet.substring(0, 200))
      : "";

    lines.push(
      `${num}. <b>${escapeHtml(job.title)}</b>`,
      `   🏢 ${escapeHtml(job.company)} | 📍 ${escapeHtml(job.location ?? "Remote")}`,
      `   💰 ${salary} | 🕐 ${jobType}`
    );

    if (snippet) {
      lines.push(`   📝 ${snippet}`);
    }

    lines.push(`   🔗 ${job.url}\n`);
  });

  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Retry an async function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  label: string = "operation"
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s, 8s max
        log(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after ${maxRetries} attempts`);
}

// ─── Channel Dispatchers ──────────────────────────────────────────────────────

async function dispatchTelegram(
  botToken: string,
  chatId: string,
  message: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  await withRetry(
    async () => {
      await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    },
    MAX_RETRIES,
    "Telegram dispatch"
  );
}

async function dispatchEmail(
  email: string,
  subject: string,
  body: string
): Promise<void> {
  // Placeholder: log the email instead of actually sending
  // In production, this would use nodemailer with SMTP config
  log(`[dispatcher] Email would be sent to ${email}:`, subject, body.substring(0, 100));
}

async function dispatchWebhook(
  webhookUrl: string,
  payload: Record<string, unknown>
): Promise<void> {
  await withRetry(
    async () => {
      await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
      });
    },
    MAX_RETRIES,
    "Webhook dispatch"
  );
}

// ─── Throttling Check ─────────────────────────────────────────────────────────

async function checkThrottle(
  userId: string,
  channel: string,
  throttleLimit: number
): Promise<boolean> {
  if (throttleLimit <= 0) return true; // Unlimited

  const key = throttleKey(userId, channel);
  const now = Date.now();
  const oneHourAgo = now - THROTTLE_TTL_SECONDS * 1000;

  const count = await redis.zcount(key, oneHourAgo, now);

  return count >= throttleLimit;
}

async function recordNotification(
  userId: string,
  channel: string
): Promise<void> {
  const key = throttleKey(userId, channel);
  const now = Date.now();
  const score = now;
  const member = `${now}:${Math.random().toString(36).substring(2, 10)}`;

  await redis.zadd(key, score, member);
  // Set TTL on the key to auto-cleanup after 1 hour + 5 min buffer
  await redis.expire(key, THROTTLE_TTL_SECONDS + 300);
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export function createDispatcher(config: DispatcherConfig): DispatcherInstance {
  return {
    async dispatch(watchConfigId: string, jobMatchIds: string[]): Promise<void> {
      // 1. Load WatchConfig with User and NotificationSettings
      const watchConfig = await prisma.watchConfig.findUniqueOrThrow({
        where: { id: watchConfigId },
        include: {
          user: true,
          notificationSettings: true,
        },
      }) as unknown as WatchConfigWithUser;

      // 2. Load JobMatch records with JobListing data
      const jobMatches = await prisma.jobMatch.findMany({
        where: { id: { in: jobMatchIds } },
        include: { job: true },
      }) as unknown as JobMatchRow[];

      if (jobMatches.length === 0) {
        log(`[dispatcher] No job matches found for watchConfig=${watchConfigId}`);
        return;
      }

      const user = watchConfig.user;
      const notifyVia = watchConfig.notifyVia as NotifyChannel[];

      // 3. Build notification settings lookup
      const settingsMap = new Map<string, NotificationSettingRow>();
      for (const ns of watchConfig.notificationSettings) {
        settingsMap.set(ns.channel, ns);
      }

      // Filter to enabled channels that the user has configured
      const activeSettings = notifyVia
        .map((channel) => settingsMap.get(channel))
        .filter((ns): ns is NotificationSettingRow => ns !== undefined && ns.enabled);

      if (activeSettings.length === 0) {
        log(`[dispatcher] No enabled notification settings for watchConfig=${watchConfigId}`);
        return;
      }

      const jobs = jobMatches.map((jm) => jm.job);

      // 4. Dispatch for each channel
      for (const setting of activeSettings) {
        const channel = setting.channel as NotifyChannel;

        // Check throttling
        const throttled = await checkThrottle(user.id, channel, setting.throttlePerHour);
        if (throttled) {
          log(`[dispatcher] Skipping ${channel} for user=${user.id}: at throttle limit (${setting.throttlePerHour}/hr)`);
          continue;
        }

        try {
          switch (channel) {
            case "telegram": {
              if (!user.telegramId) {
                log(`[dispatcher] Skipping telegram for user=${user.id}: no telegramId`);
                continue;
              }
              const message = formatTelegramMessage(
                watchConfig.keyword,
                watchConfig.location,
                jobs
              );
              await dispatchTelegram(config.telegramBotToken, user.telegramId, message);
              // Rate limit: 1 msg/sec per chat
              await sleep(1000);
              break;
            }

            case "email": {
              if (!user.email) {
                log(`[dispatcher] Skipping email for user=${user.id}: no email`);
                continue;
              }
              const subject = `JobPulse: ${jobMatches.length} new job match${jobMatches.length > 1 ? "es" : ""} for "${watchConfig.keyword}"`;
              const body = JSON.stringify(
                {
                  keyword: watchConfig.keyword,
                  location: watchConfig.location,
                  jobs: jobs.map((j) => ({
                    title: j.title,
                    company: j.company,
                    location: j.location,
                    url: j.url,
                    salaryMin: j.salaryMin,
                    salaryMax: j.salaryMax,
                  })),
                },
                null,
                2
              );
              await dispatchEmail(user.email, subject, body);
              break;
            }

            case "webhook": {
              const webhookUrl = (setting as any).webhookUrl;
              if (!webhookUrl) {
                log(`[dispatcher] Skipping webhook for user=${user.id}: no webhookUrl configured`);
                continue;
              }
              const payload = {
                event: "job_match",
                watchConfigId,
                jobs: jobs.map((j) => ({
                  source: j.source,
                  title: j.title,
                  company: j.company,
                  location: j.location,
                  type: j.type,
                  salaryMin: j.salaryMin,
                  salaryMax: j.salaryMax,
                  url: j.url,
                  descriptionSnippet: j.descriptionSnippet,
                })),
              };
              await dispatchWebhook(webhookUrl, payload);
              break;
            }
          }

          // Record notification for throttling
          await recordNotification(user.id, channel);
        } catch (err) {
          logError(`[dispatcher] Failed to send ${channel} notification for user=${user.id}: ${(err as Error).message}`);
        }
      }

      // 5. Mark JobMatch.notifiedAt on success (if at least one channel dispatched)
      const hasDispatchedSomewhere = activeSettings.some((s) => {
        const channel = s.channel as NotifyChannel;
        if (channel === "telegram" && !user.telegramId) return false;
        if (channel === "email" && !user.email) return false;
        if (channel === "webhook" && !(s as any).webhookUrl) return false;
        return true;
      });

      if (hasDispatchedSomewhere) {
        await prisma.jobMatch.updateMany({
          where: { id: { in: jobMatchIds } },
          data: { notifiedAt: new Date() },
        });
      }
    },

    async close(): Promise<void> {
      // No open connections to close for now
      // In future: could close HTTP keep-alive connections
    },
  };
}
