import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockFindUnique,
    },
    watchConfig: {
      findMany: mockFindMany,
      findUnique: mockUpdate, // reuse fn since we mock both findUnique and update
      update: mockUpdate,
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
// /list tests
// ======================================================================
describe("/list command handler", () => {
  let registerListCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const listModule = await import("../list");
    registerListCommand = listModule.registerListCommand;
  });

  it("should export registerListCommand function", () => {
    expect(registerListCommand).toBeDefined();
    expect(typeof registerListCommand).toBe("function");
  });

  it("should register /list onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("list");
  });

  it("should query active WatchConfigs for the user", async () => {
    const watches = [makeWatch()];
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue(watches);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/list",
    };

    await handler(mockMsg);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { telegramId: "12345" },
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", active: true },
    });
  });

  it("should format active watches with keyword, location, interval", async () => {
    const watches = [
      makeWatch({
        id: "watch-a",
        keyword: "Software Engineer",
        location: "San Francisco",
        sources: ["linkedin"],
        intervalMinutes: 60,
        lastPolledAt: new Date("2026-07-07T12:00:00.000Z"),
      }),
      makeWatch({
        id: "watch-b",
        keyword: "Data Scientist",
        location: null,
        sources: ["linkedin", "indeed", "greenhouse"],
        intervalMinutes: 30,
        lastPolledAt: null,
      }),
    ];
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue(watches);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/list",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    const sentOptions = mockSendMessage.mock.calls[0][2];

    // Check first watch formatting
    expect(sentText).toContain("🆔");
    expect(sentText).toContain("watch-a");
    expect(sentText).toContain("Software Engineer");
    expect(sentText).toContain("San Francisco");
    expect(sentText).toContain("60min");
    expect(sentText).toContain("linkedin");
    expect(sentText).toContain("Last polled:");

    // Check second watch - no location, multiple sources, never polled
    expect(sentText).toContain("watch-b");
    expect(sentText).toContain("Data Scientist");
    expect(sentText).toContain("Anywhere");
    expect(sentText).toContain("linkedin, indeed, greenhouse");
    expect(sentText).toContain("Never");

    // Should include HTML parse_mode
    expect(sentOptions).toBeDefined();
    expect(sentOptions.parse_mode).toBe("HTML");
  });

  it('should show "no active watches" message when none found', async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockFindMany.mockResolvedValue([]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/list",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("no active watches");
    expect(sentText).toContain("/watch");
  });

  it("should handle missing user gracefully", async () => {
    mockFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/list",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("register");
    expect(sentText).toContain("/start");
  });

  it("should handle errors gracefully (prisma throws)", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerListCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/list",
    };

    // Should not throw
    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});

// ======================================================================
// /remove tests
// ======================================================================
describe("/remove command handler", () => {
  let registerRemoveCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const removeModule = await import("../remove");
    registerRemoveCommand = removeModule.registerRemoveCommand;
  });

  it("should export registerRemoveCommand function", () => {
    expect(registerRemoveCommand).toBeDefined();
    expect(typeof registerRemoveCommand).toBe("function");
  });

  it("should register /remove onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("remove");
  });

  it("should extract watch ID from message text", async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockUpdate.mockResolvedValue(makeWatch({ keyword: "Software Engineer" }));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove watch-123",
    };

    await handler(mockMsg);

    // Should have queried for the watch by id + userId
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "watch-123", userId: "user-1" },
      data: { active: false },
    });
  });

  it("should set active=false on the matching WatchConfig", async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockUpdate.mockResolvedValue(makeWatch({ keyword: "Software Engineer" }));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove watch-abc",
    };

    await handler(mockMsg);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mockUpdate.mock.calls[0];
    expect(updateCall[0].where).toEqual({ id: "watch-abc", userId: "user-1" });
    expect(updateCall[0].data).toEqual({ active: false });
  });

  it("should send confirmation with the keyword", async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockUpdate.mockResolvedValue(makeWatch({ keyword: "Software Engineer" }));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove watch-abc",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Watch for");
    expect(sentText).toContain("Software Engineer");
    expect(sentText).toContain("stopped");
  });

  it("should show usage when no ID provided", async () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove",
    };

    await handler(mockMsg);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Usage");
    expect(sentText).toContain("/remove");
    expect(sentText).toContain("/list");
  });

  it('should show "not found" when watch does not exist', async () => {
    mockFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    // Simulate Prisma's update throwing when record not found
    mockUpdate.mockRejectedValue(new Error("RecordNotFound"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove nonexistent-id",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });

  it("should handle errors gracefully", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB error"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerRemoveCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/remove watch-abc",
    };

    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});
