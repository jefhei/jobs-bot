export interface MonitorConfig {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  nodeEnv: string;
  logLevel: string;
  pollQueueName: string;
  maxConcurrentPolls: number;
  healthCheckPort: number;
}

export function loadConfig(): MonitorConfig {
  return {
    port: parseInt(process.env.PORT || "3001", 10),
    redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/jobpulse",
    nodeEnv: process.env.NODE_ENV || "development",
    logLevel: process.env.LOG_LEVEL || "info",
    pollQueueName: process.env.POLL_QUEUE_NAME || "job-polls",
    maxConcurrentPolls: parseInt(process.env.MAX_CONCURRENT_POLLS || "5", 10),
    healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT || "9090", 10),
  };
}

const config = loadConfig();
export default config;
