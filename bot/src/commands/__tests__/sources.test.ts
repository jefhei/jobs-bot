import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockUserFindUnique = vi.fn();
const mockWatchFindMany = vi.fn();
const mockNotifFindUnique = vi.fn();
const mockNotifUpsert = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    watchConfig: {
      findMany: mockWatchFindMany,
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

// ======================================================================
// /sources command tests
// ======================================================================
describe("/sources command handler", () => {
  let registerSourcesCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const sourcesModule = await import("../sources");
    registerSourcesCommand = sourcesModule.registerSourcesCommand;
  });

  it("should export registerSourcesCommand function", () => {
    expect(registerSourcesCommand).toBeDefined();
    expect(typeof registerSourcesCommand).toBe("function");
  });

  it("should register /sources onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("sources");
  });

  it("should show available sources list with descriptions", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];

    // Should list all available sources with descriptions
    expect(sentText).toContain("linkedin");
    expect(sentText).toContain("indeed");
    expect(sentText).toContain("greenhouse");
    expect(sentText).toContain("lever");
    expect(sentText).toContain("glassdoor");
    expect(sentText).toContain("workday");
    expect(sentText).toContain("hn");
    expect(sentText).toContain("remoteco");
    expect(sentText).toContain("Available Job Sources");
  });

  it("should show sources with enabled/disabled status on '/sources list'", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources list",
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("linkedin");
    expect(sentText).toContain("indeed");
    expect(sentText).toContain("greenhouse");
    expect(sentText).toContain("Available");
  });

  it("should toggle a source on via '/sources toggle <name>'", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });
    mockNotifFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources toggle linkedin",
    };

    await handler(mockMsg);

    expect(mockNotifUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_channel: { userId: "user-1", channel: "sources_pref" },
        },
        create: expect.objectContaining({
          userId: "user-1",
          channel: "sources_pref",
        }),
      })
    );

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("linkedin");
    expect(sentText).toContain("disabled");
  });

  it("should show error for unknown source name in toggle", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-1", telegramId: "12345" });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources toggle unknown_source",
    };

    await handler(mockMsg);

    expect(mockNotifUpsert).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("unknown");
    expect(sentText).toContain("unknown_source");
  });

  it("should handle missing user gracefully", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources",
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
    registerSourcesCommand(bot);
    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: { id: 12345 },
      text: "/sources",
    };

    await expect(handler(mockMsg)).resolves.toBeUndefined();

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
  });
});
