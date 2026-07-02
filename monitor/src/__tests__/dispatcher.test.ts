import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock References using vi.hoisted ──────────────────────────────────────────

const {
  mockWatchConfigFindUniqueOrThrow,
  mockJobMatchFindMany,
  mockJobMatchUpdateMany,
  mockRedisZadd,
  mockRedisZcount,
  mockRedisZremrangeByScore,
  mockRedisExpire,
  mockAxiosPost,
} = vi.hoisted(() => {
  const mockWatchConfigFindUniqueOrThrow = vi.fn();
  const mockJobMatchFindMany = vi.fn();
  const mockJobMatchUpdateMany = vi.fn();
  const mockRedisZadd = vi.fn().mockResolvedValue(1);
  const mockRedisZcount = vi.fn().mockResolvedValue(0);
  const mockRedisZremrangeByScore = vi.fn().mockResolvedValue(0);
  const mockRedisExpire = vi.fn().mockResolvedValue(1);
  const mockAxiosPost = vi.fn().mockResolvedValue({ status: 200, data: { ok: true } });

  return {
    mockWatchConfigFindUniqueOrThrow,
    mockJobMatchFindMany,
    mockJobMatchUpdateMany,
    mockRedisZadd,
    mockRedisZcount,
    mockRedisZremrangeByScore,
    mockRedisExpire,
    mockAxiosPost,
  };
});

// ─── Mock @jobpulse/shared ──────────────────────────────────────────────────

vi.mock("@jobpulse/shared", () => {
  return {
    prisma: {
      watchConfig: {
        findUniqueOrThrow: mockWatchConfigFindUniqueOrThrow,
      },
      jobMatch: {
        findMany: mockJobMatchFindMany,
        updateMany: mockJobMatchUpdateMany,
      },
    },
    redis: {
      zadd: mockRedisZadd,
      zcount: mockRedisZcount,
      zremrangebyscore: mockRedisZremrangeByScore,
      expire: mockRedisExpire,
      status: "ready",
    },
    redisClient: {
      zadd: mockRedisZadd,
      zcount: mockRedisZcount,
      zremrangebyscore: mockRedisZremrangeByScore,
      expire: mockRedisExpire,
      status: "ready",
    },
    NotifyChannel: {
      telegram: "telegram",
      email: "email",
      webhook: "webhook",
    },
  };
});

// ─── Mock axios ──────────────────────────────────────────────────────────────

vi.mock("axios", () => {
  return {
    default: {
      post: mockAxiosPost,
    },
    post: mockAxiosPost,
  };
});

// ─── Mock console ────────────────────────────────────────────────────────────

const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  telegramId: "123456789",
  email: "user@example.com",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const mockNotificationSettings = [
  {
    id: "ns-1",
    userId: "user-1",
    channel: "telegram",
    enabled: true,
    throttlePerHour: 20,
  },
  {
    id: "ns-2",
    userId: "user-1",
    channel: "email",
    enabled: true,
    throttlePerHour: 10,
  },
  {
    id: "ns-3",
    userId: "user-1",
    channel: "webhook",
    enabled: true,
    throttlePerHour: 30,
    webhookUrl: "https://hooks.example.com/jobpulse",
  },
];

const mockWatchConfig = {
  id: "wc-1",
  userId: "user-1",
  keyword: "software engineer",
  location: "San Francisco",
  jobType: "fulltime",
  minSalary: 100000,
  experienceLevel: "mid",
  sources: ["linkedin"],
  intervalMinutes: 30,
  notifyVia: ["telegram", "email", "webhook"],
  active: true,
  lastPolledAt: null as Date | null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  user: mockUser,
  notificationSettings: mockNotificationSettings,
};

const mockJobListing = {
  id: "linkedin:li-123",
  source: "linkedin",
  title: "Software Engineer",
  company: "TechCorp",
  location: "San Francisco, CA",
  type: "fulltime",
  salaryMin: 120000,
  salaryMax: 160000,
  postedAt: new Date("2025-06-28T10:00:00Z"),
  url: "https://linkedin.com/jobs/123",
  descriptionSnippet: "Great job opportunity",
  tags: ["react", "node"],
  createdAt: new Date("2025-06-28T10:00:00Z"),
};

const mockJobMatches = [
  {
    id: "jm-1",
    jobId: "linkedin:li-123",
    watchConfigId: "wc-1",
    notifiedAt: null,
    dismissed: false,
    createdAt: new Date("2025-06-28T10:00:00Z"),
    saved: false,
    job: mockJobListing,
  },
  {
    id: "jm-2",
    jobId: "linkedin:li-456",
    watchConfigId: "wc-1",
    notifiedAt: null,
    dismissed: false,
    createdAt: new Date("2025-06-28T10:01:00Z"),
    saved: false,
    job: {
      ...mockJobListing,
      id: "linkedin:li-456",
      title: "Senior Engineer",
      company: "StartupXYZ",
      location: "Remote",
      salaryMin: 150000,
      salaryMax: 200000,
      url: "https://linkedin.com/jobs/456",
      descriptionSnippet: "Senior role",
    },
  },
];

// ─── Helper to create dispatcher config ──────────────────────────────────────

const dispatcherConfig = {
  telegramBotToken: "test-bot-token",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("dispatcher (dispatcher.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("createDispatcher", () => {
    it("should create a dispatcher instance with dispatch and close methods", async () => {
      const { createDispatcher } = await import("../dispatcher");

      const dispatcher = createDispatcher(dispatcherConfig);

      expect(dispatcher).toHaveProperty("dispatch");
      expect(dispatcher).toHaveProperty("close");
      expect(typeof dispatcher.dispatch).toBe("function");
      expect(typeof dispatcher.close).toBe("function");
    });

    it("should close cleanly without errors", async () => {
      const { createDispatcher } = await import("../dispatcher");

      const dispatcher = createDispatcher(dispatcherConfig);
      await expect(dispatcher.close()).resolves.toBeUndefined();
    });
  });

  describe("dispatch", () => {
    it("should load WatchConfig with User and NotificationSettings", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        user: mockUser,
        notificationSettings: mockNotificationSettings,
      });
      mockJobMatchFindMany.mockResolvedValue(mockJobMatches);
      // Allow throttle: zcount returns 0 (not throttled)
      mockRedisZcount.mockResolvedValue(0);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1", "jm-2"]);

      expect(mockWatchConfigFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "wc-1" },
        include: {
          user: true,
          notificationSettings: true,
        },
      });
    });

    it("should load JobMatch records with JobListing data", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        user: mockUser,
        notificationSettings: mockNotificationSettings,
      });
      mockJobMatchFindMany.mockResolvedValue(mockJobMatches);
      mockRedisZcount.mockResolvedValue(0);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1", "jm-2"]);

      expect(mockJobMatchFindMany).toHaveBeenCalledWith({
        where: { id: { in: ["jm-1", "jm-2"] } },
        include: { job: true },
      });
    });

    it("should send Telegram notification with formatted message", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[0]],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should post to Telegram API
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token/sendMessage",
        expect.objectContaining({
          chat_id: "123456789",
          parse_mode: "HTML",
          disable_web_page_preview: true,
          text: expect.stringContaining("Software Engineer"),
        })
      );
    });

    it("should send webhook notification with jobs data", async () => {
      const webhookUrl = "https://hooks.example.com/jobpulse";
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["webhook"],
        user: { ...mockUser, telegramId: null },
        notificationSettings: [
          {
            id: "ns-3",
            userId: "user-1",
            channel: "webhook",
            enabled: true,
            throttlePerHour: 30,
            webhookUrl,
          },
        ],
      });
      mockJobMatchFindMany.mockResolvedValue(mockJobMatches);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1", "jm-2"]);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          event: "job_match",
          watchConfigId: "wc-1",
          jobs: expect.any(Array),
        }),
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("should log email notification as placeholder", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["email"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[1]],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should log that email would be sent
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("Email would be sent"),
        expect.any(String),
        expect.any(String)
      );
    });

    it("should skip channels where NotificationSetting is disabled", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram", "email", "webhook"],
        user: mockUser,
        notificationSettings: [
          { ...mockNotificationSettings[0], enabled: false }, // telegram disabled
          { ...mockNotificationSettings[1], enabled: true }, // email enabled
          { ...mockNotificationSettings[2], enabled: false }, // webhook disabled
        ],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Only email should fire (telegram and webhook skipped)
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("Email would be sent"),
        expect.any(String),
        expect.any(String)
      );
    });

    it("should respect throttling and skip if at limit", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [
          { ...mockNotificationSettings[0], throttlePerHour: 20 },
        ],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      // zcount returns 20, which equals throttlePerHour → skip
      mockRedisZcount.mockResolvedValue(20);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should NOT send Telegram since at throttle limit
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("throttle limit")
      );
    });

    it("should retry on failure (max 3 attempts)", async () => {
      // First two calls fail, third succeeds
      mockAxiosPost
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ status: 200, data: { ok: true } });

      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[0]],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should have retried 3 times (2 failures + 1 success)
      expect(mockAxiosPost).toHaveBeenCalledTimes(3);
    });

    it("should give up after 3 failures and log error", async () => {
      mockAxiosPost.mockRejectedValue(new Error("Network error"));

      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[0]],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should have retried 3 times all fail
      expect(mockAxiosPost).toHaveBeenCalledTimes(3);
      expect(mockConsoleError).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("Failed")
      );
    });

    it("should mark JobMatch.notifiedAt on successful notification", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[0]],
      });
      mockJobMatchFindMany.mockResolvedValue(mockJobMatches);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1", "jm-2"]);

      // Should update notifiedAt for all matches
      expect(mockJobMatchUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: ["jm-1", "jm-2"] } },
        data: { notifiedAt: expect.any(Date) },
      });
    });

    it("should format Telegram message with all job details", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [mockNotificationSettings[0]],
      });
      mockJobMatchFindMany.mockResolvedValue(mockJobMatches);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1", "jm-2"]);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: expect.stringContaining("New Job Match"),
        })
      );
    });

    it("should handle case with no notification settings gracefully", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram"],
        user: mockUser,
        notificationSettings: [],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should not attempt to send anything
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("No enabled notification settings")
      );
    });

    it("should use tracking key per user+channel for throttling", async () => {
      mockWatchConfigFindUniqueOrThrow.mockResolvedValue({
        ...mockWatchConfig,
        notifyVia: ["telegram", "email"],
        user: mockUser,
        notificationSettings: [
          mockNotificationSettings[0], // telegram, throttle: 20
          mockNotificationSettings[1], // email, throttle: 10
        ],
      });
      mockJobMatchFindMany.mockResolvedValue([mockJobMatches[0]]);
      mockRedisZcount.mockResolvedValue(0);
      mockRedisZadd.mockResolvedValue(1);

      const { createDispatcher } = await import("../dispatcher");
      const dispatcher = createDispatcher(dispatcherConfig);
      await dispatcher.dispatch("wc-1", ["jm-1"]);

      // Should have tracked at least one notification
      expect(mockRedisZadd).toHaveBeenCalled();
      const callArg = mockRedisZadd.mock.calls[0][0] as string;
      expect(callArg).toContain("throttle:notify:user-1:");
    });
  });
});
