import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { loadConfig, MonitorConfig } from "../config";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    // Clear env vars to defaults for clean test
    delete process.env.PORT;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.POLL_QUEUE_NAME;
    delete process.env.MAX_CONCURRENT_POLLS;
    delete process.env.HEALTH_CHECK_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return default values when no env vars are set", () => {
    const config = loadConfig();
    expect(config).toEqual<MonitorConfig>({
      port: 3001,
      redisUrl: "redis://localhost:6379",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/jobpulse",
      nodeEnv: "development",
      logLevel: "info",
      pollQueueName: "job-polls",
      maxConcurrentPolls: 5,
      healthCheckPort: 9090,
    });
  });

  it("should read PORT from environment", () => {
    process.env.PORT = "4000";
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });

  it("should read REDIS_URL from environment", () => {
    process.env.REDIS_URL = "redis://myredis:6379";
    const config = loadConfig();
    expect(config.redisUrl).toBe("redis://myredis:6379");
  });

  it("should read DATABASE_URL from environment", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/db";
    const config = loadConfig();
    expect(config.databaseUrl).toBe("postgresql://user:pass@host:5432/db");
  });

  it("should read NODE_ENV from environment", () => {
    process.env.NODE_ENV = "production";
    const config = loadConfig();
    expect(config.nodeEnv).toBe("production");
  });

  it("should read LOG_LEVEL from environment", () => {
    process.env.LOG_LEVEL = "debug";
    const config = loadConfig();
    expect(config.logLevel).toBe("debug");
  });

  it("should read POLL_QUEUE_NAME from environment", () => {
    process.env.POLL_QUEUE_NAME = "custom-polls";
    const config = loadConfig();
    expect(config.pollQueueName).toBe("custom-polls");
  });

  it("should read MAX_CONCURRENT_POLLS from environment", () => {
    process.env.MAX_CONCURRENT_POLLS = "10";
    const config = loadConfig();
    expect(config.maxConcurrentPolls).toBe(10);
  });

  it("should read HEALTH_CHECK_PORT from environment", () => {
    process.env.HEALTH_CHECK_PORT = "8080";
    const config = loadConfig();
    expect(config.healthCheckPort).toBe(8080);
  });

  it("should handle NODE_ENV being set to development", () => {
    process.env.NODE_ENV = "development";
    const config = loadConfig();
    expect(config.nodeEnv).toBe("development");
  });

  it("should handle all env vars set simultaneously", () => {
    process.env.PORT = "5000";
    process.env.REDIS_URL = "redis://custom:6379";
    process.env.DATABASE_URL = "postgresql://custom:pass@custom:5432/db";
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "warn";
    process.env.POLL_QUEUE_NAME = "my-queue";
    process.env.MAX_CONCURRENT_POLLS = "20";
    process.env.HEALTH_CHECK_PORT = "7070";

    const config = loadConfig();
    expect(config).toEqual<MonitorConfig>({
      port: 5000,
      redisUrl: "redis://custom:6379",
      databaseUrl: "postgresql://custom:pass@custom:5432/db",
      nodeEnv: "production",
      logLevel: "warn",
      pollQueueName: "my-queue",
      maxConcurrentPolls: 20,
      healthCheckPort: 7070,
    });
  });
});
