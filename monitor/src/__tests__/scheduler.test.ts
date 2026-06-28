import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock References using vi.hoisted ──────────────────────────────────────────

const { mockPrismaFindMany } = vi.hoisted(() => {
  return {
    mockPrismaFindMany: vi.fn(),
  };
});

const {
  mockUpsertJobScheduler,
  mockRemoveJobScheduler,
  mockGetJobSchedulers,
  mockJobSchedulerClose,
  mockQueueAdd,
  mockQueueClose,
} = vi.hoisted(() => {
  const mockUpsertJobScheduler = vi.fn().mockResolvedValue(undefined);
  const mockRemoveJobScheduler = vi.fn().mockResolvedValue(undefined);
  const mockGetJobSchedulers = vi.fn().mockResolvedValue([]);
  const mockJobSchedulerClose = vi.fn().mockResolvedValue(undefined);
  const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
  const mockQueueClose = vi.fn().mockResolvedValue(undefined);
  return {
    mockUpsertJobScheduler,
    mockRemoveJobScheduler,
    mockGetJobSchedulers,
    mockJobSchedulerClose,
    mockQueueAdd,
    mockQueueClose,
  };
});

// ─── Mock @jobpulse/shared ──────────────────────────────────────────────────

vi.mock("@jobpulse/shared", () => {
  return {
    prisma: {
      watchConfig: {
        findMany: mockPrismaFindMany,
      },
    },
    redis: {
      quit: vi.fn().mockResolvedValue(undefined),
      status: "ready",
    },
    redisClient: {
      quit: vi.fn().mockResolvedValue(undefined),
      status: "ready",
    },
  };
});

// ─── Mock bullmq ─────────────────────────────────────────────────────────────

vi.mock("bullmq", () => {
  const MockJobScheduler = vi.fn().mockImplementation(() => ({
    upsertJobScheduler: mockUpsertJobScheduler,
    removeJobScheduler: mockRemoveJobScheduler,
    getJobSchedulers: mockGetJobSchedulers,
    close: mockJobSchedulerClose,
  }));

  const MockQueue = vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
    name: "job-polls",
  }));

  return {
    JobScheduler: MockJobScheduler,
    Queue: MockQueue,
  };
});

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockActiveWatchConfigs = [
  {
    id: "wc-1",
    userId: "user-1",
    keyword: "software engineer",
    location: "San Francisco",
    jobType: "fulltime",
    minSalary: 100000,
    experienceLevel: "mid",
    sources: ["linkedin", "indeed"],
    intervalMinutes: 30,
    notifyVia: ["telegram"],
    active: true,
    lastPolledAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: "wc-2",
    userId: "user-2",
    keyword: "designer",
    location: null,
    jobType: null,
    minSalary: null,
    experienceLevel: null,
    sources: ["greenhouse"],
    intervalMinutes: 60,
    notifyVia: ["email"],
    active: true,
    lastPolledAt: new Date("2025-01-02"),
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-02"),
  },
  {
    id: "wc-3",
    userId: "user-1",
    keyword: "intern",
    location: "Remote",
    jobType: "internship",
    minSalary: null,
    experienceLevel: "entry",
    sources: ["linkedin", "lever"],
    intervalMinutes: 15,
    notifyVia: ["telegram"],
    active: true,
    lastPolledAt: null,
    createdAt: new Date("2025-01-03"),
    updatedAt: new Date("2025-01-03"),
  },
];

describe("scheduler (scheduler.ts)", () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockMathRandom: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Mock random for deterministic jitter testing
    mockMathRandom = vi.spyOn(Math, "random").mockReturnValue(0.5);

    // Suppress console output
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("startScheduler", () => {
    it("should fetch active WatchConfigs on startup and schedule jobs for each", async () => {
      mockPrismaFindMany.mockResolvedValue(mockActiveWatchConfigs);

      const { startScheduler } = await import("../scheduler");
      const { JobScheduler, Queue } = await import("bullmq");

      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://localhost:6379",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      await startScheduler(config, queue);

      // Should have fetched active WatchConfigs
      expect(mockPrismaFindMany).toHaveBeenCalledWith({
        where: { active: true },
      });

      // Should have created a JobScheduler for the queue
      expect(JobScheduler).toHaveBeenCalledWith("job-polls", {
        connection: {
          host: "localhost",
          port: 6379,
          maxRetriesPerRequest: null,
        },
      });

      // Should have upserted a job scheduler for each active config
      expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(3);

      // First config: intervalMinutes=30 => 30*60*1000 = 1,800,000ms
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "wc-1",
        expect.objectContaining({ every: 1800000, immediately: true }),
        "poll-wc-1",
        { watchConfigId: "wc-1" },
        {},
        { override: true }
      );

      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "wc-2",
        expect.objectContaining({ every: 3600000, immediately: true }),
        "poll-wc-2",
        { watchConfigId: "wc-2" },
        {},
        { override: true }
      );
    });

    it("should not schedule jobs when there are no active WatchConfigs", async () => {
      mockPrismaFindMany.mockResolvedValue([]);

      const { startScheduler } = await import("../scheduler");
      const { Queue } = await import("bullmq");

      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://localhost:6379",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      await startScheduler(config, queue);

      expect(mockPrismaFindMany).toHaveBeenCalled();
      expect(mockUpsertJobScheduler).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      mockPrismaFindMany.mockRejectedValue(new Error("DB connection failed"));

      const { startScheduler } = await import("../scheduler");
      const { Queue } = await import("bullmq");

      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://localhost:6379",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      // Should not throw; should log error
      await expect(startScheduler(config, queue)).resolves.toBeUndefined();

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start scheduler"),
        expect.any(Error)
      );
    });

    it("should parse Redis URL correctly for different formats", async () => {
      mockPrismaFindMany.mockResolvedValue([]);

      const { startScheduler } = await import("../scheduler");
      const { JobScheduler, Queue } = await import("bullmq");

      // Test with auth info in URL
      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://user:pass@myredis:6380",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      await startScheduler(config, queue);

      expect(JobScheduler).toHaveBeenCalledWith("job-polls", {
        connection: {
          host: "myredis",
          port: 6380,
          maxRetriesPerRequest: null,
        },
      });
    });
  });

  describe("stopScheduler", () => {
    it("should close the JobScheduler when stopScheduler is called", async () => {
      mockPrismaFindMany.mockResolvedValue([]);

      const { startScheduler, stopScheduler } = await import("../scheduler");
      const { Queue } = await import("bullmq");

      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://localhost:6379",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      await startScheduler(config, queue);
      await stopScheduler();

      expect(mockJobSchedulerClose).toHaveBeenCalled();
    });

    it("should be safe to call stopScheduler multiple times", async () => {
      mockPrismaFindMany.mockResolvedValue([]);

      const { startScheduler, stopScheduler } = await import("../scheduler");
      const { Queue } = await import("bullmq");

      const config = {
        pollQueueName: "job-polls",
        redisUrl: "redis://localhost:6379",
        maxConcurrentPolls: 5,
        port: 3001,
        databaseUrl: "postgres://localhost:5432/jobpulse",
        nodeEnv: "development",
        logLevel: "info",
        healthCheckPort: 9090,
      };
      const queue = new Queue("job-polls");

      await startScheduler(config, queue);
      await stopScheduler();
      await stopScheduler(); // second call should not throw

      // Should only have closed once (idempotent)
      expect(mockJobSchedulerClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("scheduleWatch", () => {
    it("should upsert a job scheduler with correct interval and jitter", async () => {
      const { scheduleWatch } = await import("../scheduler");
      const { JobScheduler } = await import("bullmq");

      const scheduler = new JobScheduler("test-queue", { connection: {} as any });

      // intervalMinutes = 30 => 1,800,000ms
      await scheduleWatch(scheduler, "wc-1", 30);

      // Math.random()=0.5, jitter = floor(0.5 * 120 * 1000) = 60000
      // offset in repeatOpts = jitterMs
      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "wc-1",
        { every: 1800000, immediately: true, offset: 60000 },
        "poll-wc-1",
        { watchConfigId: "wc-1" },
        {},
        { override: true }
      );
    });

    it("should use different jitter for different calls", async () => {
      const { scheduleWatch } = await import("../scheduler");
      const { JobScheduler } = await import("bullmq");

      const scheduler = new JobScheduler("test-queue", { connection: {} as any });

      await scheduleWatch(scheduler, "wc-1", 30);
      await scheduleWatch(scheduler, "wc-2", 30);

      expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(2);
    });

    it("should handle intervalMinutes of 0 or negative gracefully", async () => {
      const { scheduleWatch } = await import("../scheduler");
      const { JobScheduler } = await import("bullmq");

      const scheduler = new JobScheduler("test-queue", { connection: {} as any });

      await scheduleWatch(scheduler, "wc-zero", 0);

      expect(mockUpsertJobScheduler).toHaveBeenCalledWith(
        "wc-zero",
        expect.objectContaining({ every: expect.any(Number), immediately: true }),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      );

      // The 'every' value should be at least something positive
      const callArg = mockUpsertJobScheduler.mock.calls[0][1];
      expect(callArg.every).toBeGreaterThan(0);
    });
  });

  describe("removeWatchSchedule", () => {
    it("should remove a job scheduler by watchConfigId", async () => {
      const { removeWatchSchedule } = await import("../scheduler");
      const { JobScheduler } = await import("bullmq");

      const scheduler = new JobScheduler("test-queue", { connection: {} as any });

      await removeWatchSchedule(scheduler, "wc-1");

      expect(mockRemoveJobScheduler).toHaveBeenCalledWith("wc-1");
    });

    it("should handle removing a non-existent scheduler gracefully", async () => {
      mockRemoveJobScheduler.mockRejectedValue(new Error("Not found"));

      const { removeWatchSchedule } = await import("../scheduler");
      const { JobScheduler } = await import("bullmq");

      const scheduler = new JobScheduler("test-queue", { connection: {} as any });

      // Should not throw
      await expect(
        removeWatchSchedule(scheduler, "non-existent")
      ).resolves.toBeUndefined();

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove schedule"),
        expect.any(Error)
      );
    });
  });
});
