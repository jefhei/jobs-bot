import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockUserFindUnique = vi.fn();
const mockWatchFindMany = vi.fn();
const mockWatchUpdateMany = vi.fn();
const mockNotifFindUnique = vi.fn();
const mockNotifUpsert = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    watchConfig: {
      findMany: mockWatchFindMany,
      updateMany: mockWatchUpdateMany,
    },
    notificationSetting: {
      findUnique: mockNotifFindUnique,
      upsert: mockNotifUpsert,
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
// /pause command tests
// ======================================================================
describe("/pause command handler", () => {
  let registerPauseCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const pauseModule = await import("../pause");
    registerPauseCommand = pauseModule.registerPauseCommand;
  });

  it("should export registerPauseCommand function", () => {
    expect(registerPauseCommand).toBeDefined();
    expect(typeof registerPauseCommand).toBe("function");
  });

  it("should register /pause onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("pause");
  });

  it("should show current pause status when no args provided", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([
      makeWatch({ id: "watch-1", active: true }),
      makeWatch({ id: "watch-2", active: true }),
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause",
    };

    await handler(mockMsg);

    expect(mockWatchFindMany).toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("active");
    expect(sentText).not.toContain("paused");
  });

  it("should show pause status when all watches are paused", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([
      makeWatch({ id: "watch-1", active: false }),
      makeWatch({ id: "watch-2", active: false }),
    ]);
    mockNotifFindUnique.mockResolvedValue({
      id: "ns-1",
      userId: "user-1",
      channel: "pause_state",
      enabled: true,
      throttlePerHour: 60,
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("paused");
  });

  it("should show partial pause status when some watches are active", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([
      makeWatch({ id: "watch-1", active: true }),
      makeWatch({ id: "watch-2", active: false }),
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Partially paused");
  });

  it("should pause all active watches when duration is provided", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([
      makeWatch({ id: "watch-1", active: true }),
      makeWatch({ id: "watch-2", active: false }),
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause 1h",
    };

    await handler(mockMsg);

    expect(mockWatchUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", active: true },
      data: { active: false },
    });

    expect(mockNotifUpsert).toHaveBeenCalledWith({
      where: {
        userId_channel: { userId: "user-1", channel: "pause_state" },
      },
      update: {
        enabled: true,
        throttlePerHour: 60,
      },
      create: {
        userId: "user-1",
        channel: "pause_state",
        enabled: true,
        throttlePerHour: 60,
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Paused");
    expect(sentText).toContain("1 hour");
  });

  it("should handle '30m' duration format", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([makeWatch({ active: true })]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause 30m",
    };

    await handler(mockMsg);

    expect(mockWatchUpdateMany).toHaveBeenCalled();
    expect(mockNotifUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ throttlePerHour: 30 }),
      })
    );

    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("30 minutes");
  });

  it("should handle '2h' duration format", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([makeWatch({ active: true })]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause 2h",
    };

    await handler(mockMsg);

    expect(mockNotifUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ throttlePerHour: 120 }),
      })
    );

    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("2 hours");
  });

  it("should resume all paused watches with '/pause resume'", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockWatchFindMany.mockResolvedValue([
      makeWatch({ id: "watch-1", active: false }),
      makeWatch({ id: "watch-2", active: false }),
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause resume",
    };

    await handler(mockMsg);

    expect(mockWatchUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", active: false },
      data: { active: true },
    });

    expect(mockNotifUpsert).toHaveBeenCalledWith({
      where: {
        userId_channel: { userId: "user-1", channel: "pause_state" },
      },
      update: { enabled: false },
      create: {
        userId: "user-1",
        channel: "pause_state",
        enabled: false,
        throttlePerHour: 0,
      },
    });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Resumed");
    expect(sentText).toContain("active");
  });

  it("should handle resume when no watches are paused", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    // Mock findMany to return empty when filtering for active:false (no paused watches)
    mockWatchFindMany.mockImplementation((args: any) => {
      if (args?.where?.active === false) return Promise.resolve([]);
      return Promise.resolve([
        makeWatch({ id: "watch-1", active: true }),
        makeWatch({ id: "watch-2", active: true }),
      ]);
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause resume",
    };

    await handler(mockMsg);

    expect(mockWatchUpdateMany).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("already active");
  });

  it("should handle unknown duration format gracefully", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause invalid",
    };

    await handler(mockMsg);

    expect(mockWatchFindMany).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Usage");
  });

  it("should handle missing user gracefully", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("register");
    expect(sentText).toContain("/start");
  });

  it("should handle errors gracefully", async () => {
    mockUserFindUnique.mockRejectedValue(new Error("DB error"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerPauseCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/pause",
    };

    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});
