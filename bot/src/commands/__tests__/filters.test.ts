import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
    watchConfig: {
      findMany: mockFindMany,
      updateMany: mockUpdateMany,
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

// ======================================================================
// /filters command tests
// ======================================================================
describe("/filters command handler", () => {
  let registerFiltersCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const filtersModule = await import("../filters");
    registerFiltersCommand = filtersModule.registerFiltersCommand;
  });

  it("should export registerFiltersCommand function", () => {
    expect(registerFiltersCommand).toBeDefined();
    expect(typeof registerFiltersCommand).toBe("function");
  });

  it("should register /filters onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("filters");
  });

  it("should show filters across all watches", async () => {
    const watches = [
      makeWatch({
        id: "watch-1",
        keyword: "Software Engineer",
        jobType: "fulltime",
        minSalary: 100000,
        experienceLevel: "senior",
      }),
      makeWatch({
        id: "watch-2",
        keyword: "Product Manager",
        jobType: null,
        minSalary: null,
        experienceLevel: null,
      }),
    ];
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue(watches);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/filters",
    };

    await handler(mockMsg);

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];

    // Should show filter info for each watch
    expect(sentText).toContain("Active Filters");
    expect(sentText).toContain("Software Engineer");
    expect(sentText).toContain("fulltime");
    expect(sentText).toContain("$100,000");
    expect(sentText).toContain("senior");
    expect(sentText).toContain("Product Manager");
    // No filters on second watch
    expect(sentText).toContain("None");
  });

  it("should show 'no watches' message when user has no watches", async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue([]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/filters",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("no watches");
    expect(sentText).toContain("/watch");
  });

  it("should handle filter display with partial filters", async () => {
    const watches = [
      makeWatch({
        id: "watch-1",
        keyword: "Engineer",
        jobType: "fulltime",
        minSalary: null,
        experienceLevel: null,
      }),
    ];
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue(watches);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/filters",
    };

    await handler(mockMsg);

    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Engineer");
    expect(sentText).toContain("fulltime");
    // minSalary and experienceLevel should show as None
    expect(sentText).toContain("None");
  });

  it("should handle missing user gracefully", async () => {
    mockFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/filters",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("register");
    expect(sentText).toContain("/start");
  });

  it("should handle errors gracefully", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerFiltersCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/filters",
    };

    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});
