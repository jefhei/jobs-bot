import { redis } from "@jobpulse/shared";
import axios from "axios";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALERTS_KEY_PREFIX = "alert:failure:";
const FAILURE_TTL = 60 * 60; // 1 hour in seconds
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_REASONS = 10;

// ─── Module-level state ──────────────────────────────────────────────────────

let webhookUrl: string | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function failureKey(source: string): string {
  return `${ALERTS_KEY_PREFIX}${source}`;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Configure the webhook URL for ops alerts.
 */
export function configureWebhook(url: string): void {
  webhookUrl = url;
}

/**
 * Record a failure for a source.
 * Increments the failure counter. If the count reaches 3, triggers an alert
 * and resets the counter.
 */
export async function recordFailure(
  source: string,
  reason: string
): Promise<{ alerted: boolean }> {
  const key = failureKey(source);

  // Increment the failure count
  const newCount = await redis.hincrby(key, "count", 1);

  if (newCount >= MAX_CONSECUTIVE_FAILURES) {
    // Threshold reached: read the hash for full data, send alert, then reset
    const data = await redis.hgetall(key);
    const failureCount = parseInt(data?.count || "0", 10);
    const lastFailure = data?.lastFailure || new Date().toISOString();
    const reasons: string[] = data?.reasons ? JSON.parse(data.reasons) : [];

    await sendAlert(source, failureCount, lastFailure, reasons);

    // Reset after alerting
    await redis.del(key);
    return { alerted: true };
  }

  // Below threshold: update the hash with the new reason and timestamp
  const existing = await redis.hgetall(key);
  const existingReasons: string[] = existing?.reasons
    ? JSON.parse(existing.reasons)
    : [];

  // Append new reason (keep last MAX_REASONS)
  const updatedReasons = [...existingReasons, reason].slice(-MAX_REASONS);

  // Update lastFailure timestamp and reasons
  await redis.hset(key, "lastFailure", new Date().toISOString(), "reasons", JSON.stringify(updatedReasons));

  // Set TTL on the hash key
  await redis.expire(key, FAILURE_TTL);

  return { alerted: false };
}

/**
 * Record a successful poll for a source — resets the failure counter.
 */
export async function recordSuccess(source: string): Promise<void> {
  const key = failureKey(source);
  await redis.del(key);
}

/**
 * Get all currently degraded sources (those with tracked failures).
 */
export async function getDegradedSources(): Promise<
  Array<{
    source: string;
    failureCount: number;
    lastFailure: string;
    reasons: string[];
  }>
> {
  const keys = await redis.keys(`${ALERTS_KEY_PREFIX}*`);
  const results: Array<{
    source: string;
    failureCount: number;
    lastFailure: string;
    reasons: string[];
  }> = [];

  for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data) continue;

    const source = key.replace(ALERTS_KEY_PREFIX, "");
    results.push({
      source,
      failureCount: parseInt(data.count || "0", 10),
      lastFailure: data.lastFailure || "",
      reasons: data.reasons ? JSON.parse(data.reasons) : [],
    });
  }

  return results;
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function sendAlert(
  source: string,
  failureCount: number,
  lastFailure: string,
  reasons: string[]
): Promise<void> {
  const message = `ALERT: Source "${source}" degraded after ${failureCount} consecutive failures at ${lastFailure}. Reasons: ${reasons.join("; ")}`;
  console.error("[@jobpulse/monitor]", message);

  // POST to webhook if configured
  if (webhookUrl) {
    try {
      await axios.post(
        webhookUrl,
        {
          event: "source_degraded",
          source,
          failureCount,
          lastFailure,
          reasons,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );
    } catch (err) {
      console.error("[@jobpulse/monitor]", `Failed to send webhook alert for ${source}:`, (err as Error).message);
    }
  }
}
