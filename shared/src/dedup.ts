import { createHash } from "crypto";
import { redis } from "./redis";

const DEDUP_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export function makeFingerprint(userId: string, jobId: string, source: string): string {
  return createHash("sha256")
    .update(`${userId}:${jobId}:${source}`)
    .digest("hex");
}

export async function isDuplicate(userId: string, jobId: string, source: string): Promise<boolean> {
  const fp = makeFingerprint(userId, jobId, source);
  const exists = await redis.get(fp);
  return exists !== null;
}

export async function markSeen(userId: string, jobId: string, source: string): Promise<void> {
  const fp = makeFingerprint(userId, jobId, source);
  await redis.setex(fp, DEDUP_TTL, "1");
}
