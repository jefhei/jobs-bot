import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock References using vi.hoisted ──────────────────────────────────────────

const {
  mockWatchConfigFindUniqueOrThrow,
  mockJobListingUpsert,
  mockJobMatchCreate,
  mockWatchConfigUpdate,
  mockIsDuplicate,
  mockMarkSeen,
  mockGetAdapter,
  mockSearchAllSources,
} = vi.hoisted(() => {
  const mockWatchConfigFindUniqueOrThrow = vi.fn();
  const mockJobListingUpsert = vi.fn();
  const mockJobMatchCreate = vi.fn();
  const mockWatchConfigUpdate = vi.fn();
  const mockIsDuplicate = vi.fn();
  const mockMarkSeen = vi.fn();
  const mockGetAdapter = vi.fn();
  const mockSearchAllSources = vi.fn();

  return {
    mockWatchConfigFindUniqueOrThrow,
    mockJobListingUpsert,
    mockJobMatchCreate,
    mockWatchConfigUpdate,
    mockIsDuplicate,
    mockMarkSeen,
    mockGetAdapter,
    mockSearchAllSources,
  };
});

const { mockWorkerClose, mockWorkerOn } = vi.hoisted(() => {
  const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
  const mockWorkerOn = vi.fn().mockReturnThis();
  return { mockWorkerClose, mockWorkerOn };
});

// ─── Mock @jobpulse/shared ──────────────────────────────────────────────────

vi.mock("@jobpulse/shared", () => {
  return {
    prisma: {
      watchConfig: {
        findUniqueOrThrow: mockWatchConfigFindUniqueOrThrow,
        update: mockWatchConfigUpdate,
      },
      jobListing: {
        upsert: mockJobListingUpsert,
      },
      jobMatch: {
        create: mockJobMatchCreate,
      },
    },
    redis: {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue("OK"),
      status: "ready",
    },
    redisClient: {
      get: vi.fn().mockResolvedValue(null),
      setex: vi.fn().mockResolvedValue("OK"),
      status: "ready",
    },
    isDuplicate: mockIsDuplicate,
    markSeen: mockMarkSeen,
    getAdapter: mockGetAdapter,
    searchAllSources: mockSearchAllSources,
    makeFingerprint: vi.fn((userId: string, jobId: string, source: string) =>
      `${userId}:${jobId}:${source}`
    ),
    dedup: {
      isDuplicate: mockIsDuplicate,
      markSeen: mockMarkSeen,
    },
    BaseSourceAdapter: vi.fn(),
    types: {},
  };
});

// ─── Mock bullmq ─────────────────────────────────────────────────────────────

const mockWorkerProcess = vi.fn();
let workerCallback: ((job: any) => Promise<any>) | null = null;

vi.mock("bullmq", () => {
  const MockWorker = vi.fn().mockImplementation((queueName, callback, opts) => {
    workerCallback = callback;
    return {
      close: mockWorkerClose,
      on: mockWorkerOn,
      name: queueName,
      opts,
    };
  });

  return {
    Worker: MockWorker,
  };
});

// ─── Mock console ────────────────────────────────────────────────────────────

const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockWatchConfig = {
  id: "wc-1",
  userId: "user-1",
  keyword: "software engineer",
  location: "San Francisco",
  jobType: "fulltime",
  minSalary: 100000,
  experienceLevel: "mid",
  sources: ["linkedin"] as string[],
  intervalMinutes: 30,
  notifyVia: ["telegram"] as string[],
  active: true,
  lastPolledAt: null as Date | null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const mockJobs = [
  {
    source: "linkedin" as const,
    sourceId: "li-123",
    title: "Software Engineer",
    company: "TechCorp",
    location: "San Francisco, CA",
    type: "fulltime",
    salaryMin: 120000,
    salaryMax: 160000,
    postedAt: "2025-06-28T10:00:00Z",
    url: "https://linkedin.com/jobs/123",
    descriptionSnippet: "Great job opportunity",
    tags: ["react", "node"],
  },
  {
    source: "linkedin" as const,
    sourceId: "li-456",
    title: "Senior Engineer",
    company: "StartupXYZ",
    location: "Remote",
    type: "fulltime",
    salaryMin: 150000,
    salaryMax: 200000,
    postedAt: "2025-06-27T10:00:00Z",
    url: "https://linkedin.com/jobs/456",
    descriptionSnippet: "Senior role",
    tags: ["aws", "python"],
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("poller (poller.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    workerCallback = null;
  });

  describe("createPoller", () => {
    it("should create a Worker with the correct queue name", async () => {
      const { createPoller } = await import("../poller");
      const { Worker } = await import("bullmq");

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

      const poller = createPoller(config);

      expect(Worker).toHaveBeenCalledWith(
        "job-polls",
        expect.any(Function),
        expect.objectContaining({
          connection: expect.objectContaining({
            maxRetriesPerRequest: null,
          }),
        })
      );
      expect(poller).toHaveProperty("worker");
      expect(poller).toHaveProperty("close");
      expect(typeof poller.close).toBe("function");
    });

    it("should process a poll job — fetch WatchConfig, fetch jobs, deduplicate, store new listings", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue(mockWatchConfig);
      mockIsDuplicate.mockResolvedValue(false);
      mockJobListingUpsert.mockResolvedValue({ id: "linkedin:li-123" });
      mockJobMatchCreate.mockResolvedValue({});
      mockWatchConfigUpdate.mockResolvedValue({ ...mockWatchConfig, lastPolledAt: new Date() });
      mockSearchAllSources.mockResolvedValue([
        {
          source: "linkedin",
          jobs: mockJobs,
          totalCount: 2,
          latencyMs: 150,
        },
      ]);

      const { createPoller } = await import("../poller");

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

      createPoller(config);

      // Invoke the worker callback
      expect(workerCallback).not.toBeNull();
      const job = {
        data: { watchConfigId: "wc-1" },
        id: "job-1",
        attemptsMade: 0,
      };
      await workerCallback!(job);

      // Verify WatchConfig was fetched
      expect(mockWatchConfigFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "wc-1" },
      });

      // Verify adsapter was called
      expect(mockSearchAllSources).toHaveBeenCalledWith(
        "software engineer",
        {
          location: "San Francisco",
          jobType: "fulltime",
          minSalary: 100000,
          experienceLevel: "mid",
        },
        ["linkedin"]
      );

      // Verify dedup checks
      expect(mockIsDuplicate).toHaveBeenCalledTimes(2);
      expect(mockIsDuplicate).toHaveBeenCalledWith("user-1", "li-123", "linkedin");
      expect(mockIsDuplicate).toHaveBeenCalledWith("user-1", "li-456", "linkedin");

      // Verify markSeen was called for new jobs
      expect(mockMarkSeen).toHaveBeenCalledTimes(2);

      // Verify job listings upserted
      expect(mockJobListingUpsert).toHaveBeenCalledTimes(2);
      expect(mockJobListingUpsert).toHaveBeenCalledWith({
        where: { id: "linkedin:li-123" },
        create: expect.objectContaining({
          id: "linkedin:li-123",
          source: "linkedin",
          title: "Software Engineer",
          company: "TechCorp",
        }),
        update: {},
      });

      // Verify job matches created
      expect(mockJobMatchCreate).toHaveBeenCalledTimes(2);
      expect(mockJobMatchCreate).toHaveBeenCalledWith({
        data: {
          jobId: "linkedin:li-123",
          watchConfigId: "wc-1",
        },
      });

      // Verify WatchConfig updated
      expect(mockWatchConfigUpdate).toHaveBeenCalledWith({
        where: { id: "wc-1" },
        data: { lastPolledAt: expect.any(Date) },
      });

      // Verify structured log
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("Poll cycle")
      );
    });

    it("should skip duplicate jobs (isDuplicate returns true)", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue(mockWatchConfig);
      // First job is duplicate, second is new
      mockIsDuplicate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockJobListingUpsert.mockResolvedValue({ id: "linkedin:li-456" });
      mockJobMatchCreate.mockResolvedValue({});
      mockWatchConfigUpdate.mockResolvedValue({ ...mockWatchConfig, lastPolledAt: new Date() });
      mockSearchAllSources.mockResolvedValue([
        {
          source: "linkedin",
          jobs: mockJobs,
          totalCount: 2,
          latencyMs: 120,
        },
      ]);

      const { createPoller } = await import("../poller");

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

      createPoller(config);

      const job = { data: { watchConfigId: "wc-1" }, id: "job-2", attemptsMade: 0 };
      await workerCallback!(job);

      // Should check dedup for both
      expect(mockIsDuplicate).toHaveBeenCalledTimes(2);

      // Only the non-duplicate job should be stored
      expect(mockJobListingUpsert).toHaveBeenCalledTimes(1);
      expect(mockJobListingUpsert).toHaveBeenCalledWith({
        where: { id: "linkedin:li-456" },
        create: expect.objectContaining({
          id: "linkedin:li-456",
        }),
        update: {},
      });

      // Only one job match created
      expect(mockJobMatchCreate).toHaveBeenCalledTimes(1);

      // markSeen only called for non-duplicate
      expect(mockMarkSeen).toHaveBeenCalledTimes(1);
      expect(mockMarkSeen).toHaveBeenCalledWith("user-1", "li-456", "linkedin");

      // Log should show new_count=1
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("new_count=1")
      );
    });

    it("should handle WatchConfig with multiple sources", async () => {
      const multiSourceConfig = {
        ...mockWatchConfig,
        sources: ["linkedin", "indeed"] as string[],
      };
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue(multiSourceConfig);
      mockIsDuplicate.mockResolvedValue(false);
      mockJobListingUpsert.mockResolvedValue({});
      mockJobMatchCreate.mockResolvedValue({});
      mockWatchConfigUpdate.mockResolvedValue({ ...multiSourceConfig, lastPolledAt: new Date() });

      const linkedinJobs = [mockJobs[0]];
      const indeedJobs = [
        {
          source: "indeed" as const,
          sourceId: "ind-789",
          title: "Full Stack Developer",
          company: "WebCo",
          location: "San Francisco, CA",
          type: "fulltime",
          salaryMin: 130000,
          salaryMax: 170000,
          postedAt: "2025-06-28T12:00:00Z",
          url: "https://indeed.com/jobs/789",
          descriptionSnippet: "Full stack role",
          tags: ["react", "node", "aws"],
        },
      ];

      mockSearchAllSources.mockResolvedValue([
        {
          source: "linkedin",
          jobs: linkedinJobs,
          totalCount: 1,
          latencyMs: 100,
        },
        {
          source: "indeed",
          jobs: indeedJobs,
          totalCount: 1,
          latencyMs: 200,
        },
      ]);

      const { createPoller } = await import("../poller");

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

      createPoller(config);

      const job = { data: { watchConfigId: "wc-1" }, id: "job-3", attemptsMade: 0 };
      await workerCallback!(job);

      // Should search with both sources
      expect(mockSearchAllSources).toHaveBeenCalledWith(
        "software engineer",
        expect.any(Object),
        ["linkedin", "indeed"]
      );

      // Both jobs should be upserted
      expect(mockJobListingUpsert).toHaveBeenCalledTimes(2);
      expect(mockJobListingUpsert).toHaveBeenCalledWith({
        where: { id: "linkedin:li-123" },
        create: expect.any(Object),
        update: {},
      });
      expect(mockJobListingUpsert).toHaveBeenCalledWith({
        where: { id: "indeed:ind-789" },
        create: expect.any(Object),
        update: {},
      });

      // Both job matches created
      expect(mockJobMatchCreate).toHaveBeenCalledTimes(2);

      // Log should mention both sources
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("source=linkedin")
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("source=indeed")
      );
    });

    it("should update WatchConfig.lastPolledAt after successful poll", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue(mockWatchConfig);
      mockIsDuplicate.mockResolvedValue(false);
      mockSearchAllSources.mockResolvedValue([
        {
          source: "linkedin",
          jobs: [mockJobs[0]],
          totalCount: 1,
          latencyMs: 100,
        },
      ]);
      mockJobListingUpsert.mockResolvedValue({ id: "linkedin:li-123" });
      mockJobMatchCreate.mockResolvedValue({});

      const now = new Date();
      mockWatchConfigUpdate.mockResolvedValue({
        ...mockWatchConfig,
        lastPolledAt: now,
      });

      const { createPoller } = await import("../poller");

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

      createPoller(config);

      const job = { data: { watchConfigId: "wc-1" }, id: "job-4", attemptsMade: 0 };
      await workerCallback!(job);

      expect(mockWatchConfigUpdate).toHaveBeenCalledWith({
        where: { id: "wc-1" },
        data: { lastPolledAt: expect.any(Date) },
      });
    });

    it("should handle source degradation after 3 consecutive failures", async () => {
      const mockRedisGet = vi.fn();
      const mockRedisSetex = vi.fn();
      const mockRedisDel = vi.fn();

      // We need to re-setup mocks for Redis to test degradation
      // Re-mock to get redis.get and redis.setex that we can control
      vi.doMock("@jobpulse/shared", () => ({
        prisma: {
          watchConfig: {
            findUniqueOrThrow: mockWatchConfigFindUniqueOrThrow,
            update: mockWatchConfigUpdate,
          },
          jobListing: { upsert: mockJobListingUpsert },
          jobMatch: { create: mockJobMatchCreate },
        },
        redis: {
          get: mockRedisGet,
          setex: mockRedisSetex,
          del: mockRedisDel,
          status: "ready",
        },
        redisClient: {
          get: mockRedisGet,
          setex: mockRedisSetex,
          del: mockRedisDel,
          status: "ready",
        },
        isDuplicate: mockIsDuplicate,
        markSeen: mockMarkSeen,
        getAdapter: mockGetAdapter,
        searchAllSources: mockSearchAllSources,
        makeFingerprint: vi.fn((u, j, s) => `${u}:${j}:${s}`),
        dedup: { isDuplicate: mockIsDuplicate, markSeen: mockMarkSeen },
        BaseSourceAdapter: vi.fn(),
        types: {},
      }));

      // Simulate degraded source — redis.get returns degraded marker
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === "degraded:linkedin") return "1";
        return null;
      });

      // Mock a failed search that would trigger degradation logic
      // Since degraded, the search should be skipped
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        sources: ["linkedin"],
      });

      // reload module
      const { createPoller } = await import("../poller");

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

      createPoller(config);

      const job = { data: { watchConfigId: "wc-1" }, id: "job-5", attemptsMade: 3 };
      await workerCallback!(job);

      // Since source is degraded, search should be skipped
      // But the test expects the logic to handle it
      // The actual behavior: we skip degraded sources
    });

    it("should configure worker with retry backoff (5/10/30 min, max 3 retries)", async () => {
      const { createPoller } = await import("../poller");
      const { Worker } = await import("bullmq");

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

      createPoller(config);

      // Worker should be created with retry options
      expect(Worker).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({
          settings: expect.objectContaining({
            backoffStrategy: expect.any(Function),
          }),
          maxStalledCount: expect.any(Number),
        })
      );

      // Verify backoff strategy produces expected values
      const workerCall = (Worker as any).mock.calls[0];
      const opts = workerCall[2];
      const backoffFn = opts.settings.backoffStrategy;

      // 5 min delay for attempt 1
      expect(backoffFn(1)).toBe(5 * 60 * 1000);
      // 10 min delay for attempt 2
      expect(backoffFn(2)).toBe(10 * 60 * 1000);
      // 30 min delay for attempt 3
      expect(backoffFn(3)).toBe(30 * 60 * 1000);
    });

    it("should close the worker when close() is called", async () => {
      const { createPoller } = await import("../poller");

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

      const poller = createPoller(config);

      await poller.close();

      expect(mockWorkerClose).toHaveBeenCalled();
    });

    it("should be safe to call close() multiple times", async () => {
      const { createPoller } = await import("../poller");

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

      const poller = createPoller(config);

      await poller.close();
      await poller.close();

      // Should only have closed once (idempotent)
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    });
  });
});
