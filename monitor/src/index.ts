import { prisma, redis } from "@jobpulse/shared";
import { Queue } from "bullmq";
import http from "http";
import { loadConfig, MonitorConfig } from "./config";

// ─── Config ──────────────────────────────────────────────────────────────────

export const config: MonitorConfig = loadConfig();

// ─── State ───────────────────────────────────────────────────────────────────

let queue: Queue | null = null;
let httpServer: http.Server | null = null;
let isShuttingDown = false;

// ─── Placeholder scheduler reference ─────────────────────────────────────────

// Scheduler will be implemented in Task 2.2
// import { startScheduler } from "./scheduler";
function startScheduler(_config: MonitorConfig, _queue: Queue): void {
  // Placeholder - no-op until Task 2.2
}

// ─── Health Check HTTP Server ────────────────────────────────────────────────

function createHealthServer(): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  });

  server.listen(config.healthCheckPort, () => {
    console.log(
      `[@jobpulse/monitor] Health check server listening on port ${config.healthCheckPort}`
    );
  });

  return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

export async function start(): Promise<void> {
  console.log("[@jobpulse/monitor] Starting...");

  // 1. Connect to Prisma
  await prisma.$connect();
  console.log("[@jobpulse/monitor] Connected to database");

  // 2. Verify Redis connection
  const redisStatus = redis.status;
  console.log(`[@jobpulse/monitor] Redis status: ${redisStatus}`);

  // 3. Initialize BullMQ queue
  queue = new Queue(config.pollQueueName, {
    connection: {
      host: new URL(config.redisUrl).hostname || "localhost",
      port: parseInt(new URL(config.redisUrl).port || "6379", 10),
      maxRetriesPerRequest: null,
    },
  });
  console.log(`[@jobpulse/monitor] Queue "${config.pollQueueName}" initialized`);

  // 4. Create health check HTTP server
  httpServer = createHealthServer();

  // 5. Start scheduler (placeholder until Task 2.2)
  startScheduler(config, queue);

  console.log("[@jobpulse/monitor] Started successfully");
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

export async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("[@jobpulse/monitor] Shutting down gracefully...");

  // 1. Close HTTP server
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
    console.log("[@jobpulse/monitor] HTTP server closed");
  }

  // 2. Close BullMQ queue
  if (queue) {
    await queue.close();
    console.log("[@jobpulse/monitor] Queue closed");
  }

  // 3. Disconnect Prisma
  await prisma.$disconnect();
  console.log("[@jobpulse/monitor] Database disconnected");

  // 4. Quit Redis
  await redis.quit();
  console.log("[@jobpulse/monitor] Redis disconnected");

  console.log("[@jobpulse/monitor] Shutdown complete");
}

// ─── Signal Handling ─────────────────────────────────────────────────────────

process.on("SIGTERM", async () => {
  console.log("[@jobpulse/monitor] Received SIGTERM");
  await shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[@jobpulse/monitor] Received SIGINT");
  await shutdown();
  process.exit(0);
});
