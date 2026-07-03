import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock References using vi.hoisted ──────────────────────────────────────────

const {
  mockRedisHgetall,
  mockRedisHset,
  mockRedisHincrby,
  mockRedisExpire,
  mockRedisDel,
  mockRedisKeys,
  mockAxiosPost,
} = vi.hoisted(() => {
  const mockRedisHgetall = vi.fn();
  const mockRedisHset = vi.fn().mockResolvedValue(1);
  const mockRedisHincrby = vi.fn().mockResolvedValue(1);
  const mockRedisExpire = vi.fn().mockResolvedValue(1);
  const mockRedisDel = vi.fn().mockResolvedValue(1);
  const mockRedisKeys = vi.fn().mockResolvedValue([]);
  const mockAxiosPost = vi.fn().mockResolvedValue({ status: 200, data: { ok: true } });

  return {
    mockRedisHgetall,
    mockRedisHset,
    mockRedisHincrby,
    mockRedisExpire,
    mockRedisDel,
    mockRedisKeys,
    mockAxiosPost,
  };
});

// ─── Mock @jobpulse/shared ──────────────────────────────────────────────────

vi.mock("@jobpulse/shared", () => {
  return {
    redis: {
      hgetall: mockRedisHgetall,
      hset: mockRedisHset,
      hincrby: mockRedisHincrby,
      expire: mockRedisExpire,
      del: mockRedisDel,
      keys: mockRedisKeys,
      status: "ready",
    },
    redisClient: {
      hgetall: mockRedisHgetall,
      hset: mockRedisHset,
      hincrby: mockRedisHincrby,
      expire: mockRedisExpire,
      del: mockRedisDel,
      keys: mockRedisKeys,
      status: "ready",
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("alerts (alerts.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("exports", () => {
    it("should export recordFailure, recordSuccess, getDegradedSources, and configureWebhook", async () => {
      const mod = await import("../alerts");
      expect(mod).toHaveProperty("recordFailure");
      expect(mod).toHaveProperty("recordSuccess");
      expect(mod).toHaveProperty("getDegradedSources");
      expect(mod).toHaveProperty("configureWebhook");
      expect(typeof mod.recordFailure).toBe("function");
      expect(typeof mod.recordSuccess).toBe("function");
      expect(typeof mod.getDegradedSources).toBe("function");
      expect(typeof mod.configureWebhook).toBe("function");
    });
  });

  describe("recordFailure", () => {
    it("should increment failure count in Redis hash", async () => {
      mockRedisHincrby.mockResolvedValue(1);
      mockRedisHgetall.mockResolvedValue(null);

      const { recordFailure } = await import("../alerts");
      const result = await recordFailure("linkedin", "Connection timeout");

      expect(mockRedisHincrby).toHaveBeenCalledWith("alert:failure:linkedin", "count", 1);
      expect(result).toEqual({ alerted: false });
    });

    it("should store failure reason and timestamp on first failure", async () => {
      mockRedisHincrby.mockResolvedValue(1);
      mockRedisHgetall.mockResolvedValue(null);

      const { recordFailure } = await import("../alerts");
      await recordFailure("linkedin", "Connection timeout");

      expect(mockRedisHset).toHaveBeenCalledWith(
        "alert:failure:linkedin",
        "lastFailure",
        expect.any(String),
        "reasons",
        expect.any(String)
      );
      // Verify TTL is set
      expect(mockRedisExpire).toHaveBeenCalledWith("alert:failure:linkedin", 3600);
    });

    it("should append reason to existing reasons array", async () => {
      mockRedisHincrby.mockResolvedValue(2);
      mockRedisHgetall.mockResolvedValue({
        count: "1",
        lastFailure: "2025-07-03T09:00:00.000Z",
        reasons: JSON.stringify(["Initial error"]),
      });

      const { recordFailure } = await import("../alerts");
      await recordFailure("linkedin", "Second error");

      expect(mockRedisHset).toHaveBeenCalledWith(
        "alert:failure:linkedin",
        "lastFailure",
        expect.any(String),
        "reasons",
        expect.any(String)
      );
      // The reasons should include both
      const reasonsArg = mockRedisHset.mock.calls[0][4];
      const parsed = JSON.parse(reasonsArg);
      expect(parsed).toEqual(["Initial error", "Second error"]);
    });

    it("should trigger alert when failure count reaches 3", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      const now = "2025-07-03T09:01:00.000Z";
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: now,
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure } = await import("../alerts");
      const result = await recordFailure("linkedin", "Error 3");

      expect(result).toEqual({ alerted: true });
      // Should console.error the alert
      expect(mockConsoleError).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("ALERT")
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("linkedin")
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        "[@jobpulse/monitor]",
        expect.stringContaining("3")
      );
    });

    it("should reset failure counter after alerting (delete Redis key)", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: "2025-07-03T09:01:00.000Z",
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure } = await import("../alerts");
      await recordFailure("linkedin", "Error 3");

      expect(mockRedisDel).toHaveBeenCalledWith("alert:failure:linkedin");
    });

    it("should NOT trigger alert for count below 3", async () => {
      mockRedisHincrby.mockResolvedValue(2);
      mockRedisHgetall.mockResolvedValue({
        count: "2",
        lastFailure: "2025-07-03T09:00:00.000Z",
        reasons: JSON.stringify(["Error 1"]),
      });

      const { recordFailure } = await import("../alerts");
      const result = await recordFailure("linkedin", "Error 2");

      expect(result).toEqual({ alerted: false });
      expect(mockConsoleError).not.toHaveBeenCalled();
      expect(mockRedisDel).not.toHaveBeenCalled();
    });

    it("should POST to webhookUrl if configured when alerting", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      const now = "2025-07-03T09:01:00.000Z";
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: now,
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure, configureWebhook } = await import("../alerts");
      configureWebhook("https://hooks.example.com/ops-alerts");
      await recordFailure("linkedin", "Error 3");

      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://hooks.example.com/ops-alerts",
        {
          event: "source_degraded",
          source: "linkedin",
          failureCount: 3,
          lastFailure: now,
          reasons: ["Error 1", "Error 2", "Error 3"],
        },
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    it("should not POST to webhook if not configured", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: "2025-07-03T09:01:00.000Z",
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure } = await import("../alerts");
      await recordFailure("linkedin", "Error 3");

      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it("should limit reasons array to last 10 failures", async () => {
      mockRedisHincrby.mockResolvedValue(2); // Below alert threshold
      const manyReasons = Array.from({ length: 10 }, (_, i) => `Error ${i + 1}`);
      mockRedisHgetall.mockResolvedValue({
        count: "1",
        lastFailure: "2025-07-03T09:10:00.000Z",
        reasons: JSON.stringify(manyReasons),
      });

      const { recordFailure } = await import("../alerts");
      await recordFailure("linkedin", "Error 11");

      expect(mockRedisHset).toHaveBeenCalled();
      const reasonsArg = mockRedisHset.mock.calls[0][4];
      const parsed = JSON.parse(reasonsArg);
      expect(parsed.length).toBe(10);
      // Should have the new reason and dropped the oldest
      expect(parsed).toContain("Error 11");
      expect(parsed).not.toContain("Error 1");
    });
  });

  describe("recordSuccess", () => {
    it("should delete the failure key for the source", async () => {
      const { recordSuccess } = await import("../alerts");
      await recordSuccess("linkedin");

      expect(mockRedisDel).toHaveBeenCalledWith("alert:failure:linkedin");
    });
  });

  describe("getDegradedSources", () => {
    it("should return empty array when no sources are degraded", async () => {
      mockRedisKeys.mockResolvedValue([]);

      const { getDegradedSources } = await import("../alerts");
      const result = await getDegradedSources();

      expect(result).toEqual([]);
      expect(mockRedisKeys).toHaveBeenCalledWith("alert:failure:*");
    });

    it("should return degraded sources with their data", async () => {
      mockRedisKeys.mockResolvedValue(["alert:failure:linkedin", "alert:failure:indeed"]);
      mockRedisHgetall
        .mockResolvedValueOnce({
          count: "2",
          lastFailure: "2025-07-03T09:00:00.000Z",
          reasons: JSON.stringify(["Error 1", "Error 2"]),
        })
        .mockResolvedValueOnce({
          count: "1",
          lastFailure: "2025-07-03T09:05:00.000Z",
          reasons: JSON.stringify(["Timeout"]),
        });

      const { getDegradedSources } = await import("../alerts");
      const result = await getDegradedSources();

      expect(result).toEqual([
        {
          source: "linkedin",
          failureCount: 2,
          lastFailure: "2025-07-03T09:00:00.000Z",
          reasons: ["Error 1", "Error 2"],
        },
        {
          source: "indeed",
          failureCount: 1,
          lastFailure: "2025-07-03T09:05:00.000Z",
          reasons: ["Timeout"],
        },
      ]);
    });
  });

  describe("configureWebhook", () => {
    it("should set the webhook URL for alerts", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: "2025-07-03T09:01:00.000Z",
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure, configureWebhook } = await import("../alerts");
      configureWebhook("https://hooks.example.com/ops");
      await recordFailure("linkedin", "Error 3");

      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://hooks.example.com/ops",
        expect.any(Object),
        expect.any(Object)
      );
    });

    it("should update the webhook URL when called again", async () => {
      mockRedisHincrby.mockResolvedValue(3);
      mockRedisHgetall.mockResolvedValue({
        count: "3",
        lastFailure: "2025-07-03T09:01:00.000Z",
        reasons: JSON.stringify(["Error 1", "Error 2", "Error 3"]),
      });

      const { recordFailure, configureWebhook } = await import("../alerts");
      configureWebhook("https://hooks.example.com/old");
      configureWebhook("https://hooks.example.com/new");
      await recordFailure("linkedin", "Error 3");

      expect(mockAxiosPost).toHaveBeenCalledWith(
        "https://hooks.example.com/new",
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
