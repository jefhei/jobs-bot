import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let queue: Queue | null = null;

export function getPollQueue(): Queue {
  if (!queue) {
    const redisUrl = new URL(REDIS_URL);
    queue = new Queue("job-polls", {
      connection: {
        host: redisUrl.hostname || "localhost",
        port: parseInt(redisUrl.port || "6379", 10),
        maxRetriesPerRequest: null,
      },
    });
  }
  return queue;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
