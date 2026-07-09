import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockGroupBy = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
    watchConfig: {
      findMany: mockFindMany,
    },
    jobMatch: {
      findMany: mockFindMany, // reuse since they're different queries
      groupBy: mockGroupBy,
      count: vi.fn(),
    },
    jobListing: {
      findMany: mockFindMany,
    },
  },
}));

// --- Mock TelegramBot ---
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockOnText = vi.fn();

// --- Shared test helpers ---

function makeWatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "watch-1",
    userId: "user-1",
    keyword: "Software Engineer",
    location: "Remote",
    jobType: null,
    minSalary: null,
    experienceLevel: null,
    sources: ["linkedin", "indeed"],
    intervalMinutes: 30,
    notifyVia: ["telegram"],
    active: true,
    lastPolledAt: new Date("2026-07-07T10:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-07T10:00:00.000Z"),
    ...overrides,
  };
}

function makeJobMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "match-1",
    jobId: "job-1",
    watchConfigId: "watch-1",
    notifiedAt: new Date("2026-07-09T08:00:00.000Z"),
    dismissed: false,
    saved: false,
    createdAt: new Date("2026-07-09T08:00:00.000Z"),
    job: {
      id: "job-1",
      source: "linkedin",
      title: "Senior Software Engineer",
      company: "Acme Corp",
      location: "San Francisco",
      type: "fulltime",
      salaryMin: 150000,
      salaryMax: 200000,
      postedAt: new Date("2026-07-08T00:00:00.000Z"),
      url: "https://linkedin.com/jobs/view/1",
      descriptionSnippet: "We are looking for a senior engineer...",
      tags: ["engineering", "senior"],
    },
    ...overrides,
  };
}

// ======================================================================
// /digest command tests
// ======================================================================
describe("/digest command handler", () => {
  let registerDigestCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const digestModule = await import("../digest");
    registerDigestCommand = digestModule.registerDigestCommand;
  });

  it("should export registerDigestCommand function", () => {
    expect(registerDigestCommand).toBeDefined();
    expect(typeof registerDigestCommand).toBe("function");
  });

  it("should register /digest onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("digest");
  });

  it("should query user by telegramId on /digest", async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue([]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await handler(mockMsg);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { telegramId: "12345" },
    });
  });

  it("should handle missing user gracefully", async () => {
    mockFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("register");
    expect(sentText).toContain("/start");
  });

  it('should show "no active watches" when user has no watches', async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue([]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("no active watches");
    expect(sentText).toContain("/watch");
  });

  it("should show digest with matches grouped by watch config", async () => {
    const watches = [
      makeWatch({ id: "watch-1", keyword: "Software Engineer", location: "Remote" }),
      makeWatch({ id: "watch-2", keyword: "Product Manager", location: "San Francisco" }),
    ];

    const matches = [
      makeJobMatch({
        watchConfigId: "watch-1",
        job: {
          id: "job-1",
          source: "linkedin",
          title: "Senior Software Engineer",
          company: "Acme Corp",
          location: "San Francisco",
          salaryMin: 150000,
          salaryMax: 200000,
          url: "https://linkedin.com/jobs/view/1",
          postedAt: new Date("2026-07-08T00:00:00.000Z"),
          tags: ["engineering", "senior"],
        },
      }),
      makeJobMatch({
        id: "match-2",
        watchConfigId: "watch-1",
        jobId: "job-2",
        job: {
          id: "job-2",
          source: "indeed",
          title: "Junior Software Engineer",
          company: "Startup Inc",
          location: "Remote",
          salaryMin: 80000,
          salaryMax: 100000,
          url: "https://indeed.com/job/2",
          postedAt: new Date("2026-07-07T00:00:00.000Z"),
          tags: ["engineering", "junior"],
        },
      }),
      makeJobMatch({
        id: "match-3",
        watchConfigId: "watch-2",
        jobId: "job-3",
        job: {
          id: "job-3",
          source: "greenhouse",
          title: "Senior Product Manager",
          company: "Big Corp",
          location: "San Francisco",
          salaryMin: null,
          salaryMax: null,
          url: "https://greenhouse.com/job/3",
          postedAt: new Date("2026-07-06T00:00:00.000Z"),
          tags: ["product", "senior"],
        },
      }),
    ];

    // First call: findUnique returns user
    // Second+ calls: findMany with watchConfigIds returns appropriate data
    let callCount = 0;
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockImplementation((args: any) => {
      callCount++;
      if (callCount === 1) return watches; // first findMany = user's watches
      // subsequent findMany for matches filtered by watchConfig IDs
      return matches.filter(
        (m) => args?.where?.watchConfigId?.in?.includes(m.watchConfigId) ?? true
      );
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];

    // Should mention heading (with HTML bold tags)
    expect(sentText).toContain("Daily Digest");

    // Should group by watch - first watch has 2 matches
    expect(sentText).toContain("Software Engineer");
    expect(sentText).toContain("Remote");
    expect(sentText).toContain("2 new matches");

    // Should include job titles
    expect(sentText).toContain("Senior Software Engineer");
    expect(sentText).toContain("Junior Software Engineer");

    // Second watch has 1 match
    expect(sentText).toContain("Product Manager");
    expect(sentText).toContain("San Francisco");
    expect(sentText).toContain("1 new match");

    expect(sentText).toContain("Senior Product Manager");
  });

  it("should show empty digest when no matches in last 24h", async () => {
    const watches = [
      makeWatch({ id: "watch-1", keyword: "Software Engineer" }),
    ];

    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue(watches);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("0 new matches");
  });

  it("should handle errors gracefully", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerDigestCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/digest",
    };

    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});
