import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../api";
import { prisma as mockPrisma } from "../db";

// ─── Mock prisma ──────────────────────────────────────────────────────────────

const mockUser = {
  id: "user-1",
  telegramId: "12345",
  email: "test@example.com",
  apiKey: "test-api-key-abc123",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const mockWatchConfig = {
  id: "watch-1",
  userId: "user-1",
  keyword: "software engineer",
  location: "Remote",
  jobType: "fulltime",
  minSalary: 100000,
  experienceLevel: "senior",
  sources: ["linkedin", "indeed"],
  intervalMinutes: 30,
  notifyVia: ["telegram"],
  active: true,
  lastPolledAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

vi.mock("../db", () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    watchConfig: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    default: mockPrisma,
  };
});

// ─── Helper ────────────────────────────────────────────────────────────────────

// mockPrisma is imported directly from "../db" (mocked via vi.mock above)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("API Server", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(async () => {
    try {
      await app.close();
    } catch {
      // ignore if already closed
    }
  });

  describe("Auth middleware", () => {
    it("should return 401 when x-api-key header is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/watch",
        payload: { keyword: "engineer" },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe("unauthorized");
    });

    it("should return 401 when x-api-key header is invalid", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/api/watch",
        headers: { "x-api-key": "invalid-key" },
        payload: { keyword: "engineer" },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe("unauthorized");
    });
  });

  describe("POST /api/watch", () => {
    it("should create a watch config successfully", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.create.mockResolvedValue(mockWatchConfig);

      const res = await app.inject({
        method: "POST",
        url: "/api/watch",
        headers: { "x-api-key": "test-api-key-abc123" },
        payload: {
          keyword: "software engineer",
          location: "Remote",
          jobType: "fulltime",
          minSalary: 100000,
          experienceLevel: "senior",
          sources: ["linkedin", "indeed"],
          intervalMinutes: 30,
          notifyVia: ["telegram"],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.watch.keyword).toBe("software engineer");
      expect(body.watch.location).toBe("Remote");
      expect(body.watch.id).toBe("watch-1");
    });

    it("should use defaults for optional fields", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.create.mockResolvedValue({
        ...mockWatchConfig,
        keyword: "engineer",
        location: null,
        jobType: null,
        minSalary: null,
        experienceLevel: null,
        sources: ["linkedin", "indeed", "greenhouse", "lever"],
        intervalMinutes: 30,
        notifyVia: ["telegram"],
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/watch",
        headers: { "x-api-key": "test-api-key-abc123" },
        payload: { keyword: "engineer" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.watch.keyword).toBe("engineer");
    });

    it("should return 400 when keyword is missing", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await app.inject({
        method: "POST",
        url: "/api/watch",
        headers: { "x-api-key": "test-api-key-abc123" },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/watch", () => {
    it("should list all watches for the authenticated user", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.findMany.mockResolvedValue([mockWatchConfig]);

      const res = await app.inject({
        method: "GET",
        url: "/api/watch",
        headers: { "x-api-key": "test-api-key-abc123" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.watches).toHaveLength(1);
      expect(body.watches[0].keyword).toBe("software engineer");
    });

    it("should return empty array when no watches exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.findMany.mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/watch",
        headers: { "x-api-key": "test-api-key-abc123" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.watches).toEqual([]);
    });
  });

  describe("DELETE /api/watch/:id", () => {
    it("should deactivate a watch config", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.update.mockResolvedValue({
        ...mockWatchConfig,
        active: false,
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/watch/watch-1",
        headers: { "x-api-key": "test-api-key-abc123" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it("should return 404 when watch id does not exist", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.watchConfig.update.mockRejectedValue(
        new Error("RecordNotFound")
      );

      const res = await app.inject({
        method: "DELETE",
        url: "/api/watch/non-existent-id",
        headers: { "x-api-key": "test-api-key-abc123" },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
