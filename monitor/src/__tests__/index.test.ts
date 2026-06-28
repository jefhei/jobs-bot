import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock process.exit so tests don't terminate
vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

// Shared mock references
let mockPrismaConnect: ReturnType<typeof vi.fn>;
let mockPrismaDisconnect: ReturnType<typeof vi.fn>;
let mockRedisQuit: ReturnType<typeof vi.fn>;
let mockQueueClose: ReturnType<typeof vi.fn>;
let mockServerInstance: any;

// Mock shared package
vi.mock("@jobpulse/shared", () => {
  mockPrismaConnect = vi.fn().mockResolvedValue(undefined);
  mockPrismaDisconnect = vi.fn().mockResolvedValue(undefined);
  mockRedisQuit = vi.fn().mockResolvedValue(undefined);
  return {
    prisma: {
      $connect: mockPrismaConnect,
      $disconnect: mockPrismaDisconnect,
    },
    redis: {
      quit: mockRedisQuit,
      status: "ready",
    },
    redisClient: {
      quit: vi.fn().mockResolvedValue(undefined),
      status: "ready",
    },
  };
});

// Mock BullMQ Queue and JobScheduler
let mockJobSchedulerInstance: any;
vi.mock("bullmq", () => {
  mockQueueClose = vi.fn().mockResolvedValue(undefined);
  mockJobSchedulerInstance = {
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Queue: vi.fn().mockImplementation((name: string) => ({
      close: mockQueueClose,
      name,
      client: { status: "ready" },
    })),
    JobScheduler: vi.fn().mockImplementation(() => mockJobSchedulerInstance),
  };
});

// Mock http module
vi.mock("http", () => {
  mockServerInstance = {
    listen: vi.fn((port: number, cb?: () => void) => {
      if (cb) cb();
      return mockServerInstance;
    }),
    close: vi.fn((cb?: () => void) => {
      if (cb) cb();
      return mockServerInstance;
    }),
    on: vi.fn().mockReturnThis(),
  };
  const createServer = vi.fn(() => mockServerInstance);
  return { default: { createServer }, createServer };
});

describe("monitor entry point (index.ts)", () => {
  let mainModule: typeof import("../index");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mainModule = await import("../index");
  });

  it("should export start and shutdown functions", () => {
    expect(mainModule).toHaveProperty("start");
    expect(mainModule).toHaveProperty("shutdown");
    expect(typeof mainModule.start).toBe("function");
    expect(typeof mainModule.shutdown).toBe("function");
  });

  it("should export a config object", () => {
    expect(mainModule).toHaveProperty("config");
    expect(mainModule.config).toHaveProperty("port");
    expect(mainModule.config).toHaveProperty("redisUrl");
    expect(mainModule.config).toHaveProperty("databaseUrl");
    expect(mainModule.config).toHaveProperty("nodeEnv");
    expect(mainModule.config).toHaveProperty("logLevel");
    expect(mainModule.config).toHaveProperty("pollQueueName");
    expect(mainModule.config).toHaveProperty("maxConcurrentPolls");
    expect(mainModule.config).toHaveProperty("healthCheckPort");
  });

  it("should have default config values", () => {
    expect(mainModule.config.pollQueueName).toBe("job-polls");
    expect(mainModule.config.healthCheckPort).toBe(9090);
    expect(mainModule.config.maxConcurrentPolls).toBe(5);
  });

  it("should log startup info when start() is called", async () => {
    await mainModule.start();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/monitor] Starting..."
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/monitor] Started successfully"
    );
  });

  it("should call prisma.$connect when start() is called", async () => {
    await mainModule.start();
    expect(mockPrismaConnect).toHaveBeenCalledTimes(1);
  });

  it("should initialize BullMQ Queue with correct name", async () => {
    const { Queue } = await import("bullmq");
    await mainModule.start();
    expect(Queue).toHaveBeenCalledWith("job-polls", expect.objectContaining({
      connection: expect.objectContaining({
        maxRetriesPerRequest: null,
      }),
    }));
  });

  it("should create an HTTP server on healthCheckPort", async () => {
    await mainModule.start();
    expect(mockServerInstance.listen).toHaveBeenCalledWith(
      9090,
      expect.any(Function)
    );
  });

  it("should gracefully close connections on shutdown", async () => {
    await mainModule.start();
    await mainModule.shutdown();

    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockPrismaDisconnect).toHaveBeenCalled();
    expect(mockRedisQuit).toHaveBeenCalled();
    expect(mockServerInstance.close).toHaveBeenCalled();
  });

  it("should handle SIGTERM by calling shutdown", async () => {
    // Spy on process.exit to verify flow
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await mainModule.start();

    // Verify shutdown hasn't been called yet
    expect(mockQueueClose).not.toHaveBeenCalled();

    // Emit SIGTERM
    process.emit("SIGTERM");

    // Allow the async handler to run
    await new Promise((r) => setTimeout(r, 50));

    // Verify cleanup actions were triggered by the signal handler
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockPrismaDisconnect).toHaveBeenCalled();
    expect(mockRedisQuit).toHaveBeenCalled();
    expect(mockServerInstance.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should handle SIGINT by calling shutdown", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await mainModule.start();

    expect(mockQueueClose).not.toHaveBeenCalled();

    // Emit SIGINT
    process.emit("SIGINT");

    await new Promise((r) => setTimeout(r, 50));

    // Verify cleanup actions were triggered
    expect(mockQueueClose).toHaveBeenCalled();
    expect(mockPrismaDisconnect).toHaveBeenCalled();
    expect(mockRedisQuit).toHaveBeenCalled();
    expect(mockServerInstance.close).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
