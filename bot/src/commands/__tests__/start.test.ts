import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockUpsert = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      upsert: mockUpsert,
    },
  },
}));

// --- Mock TelegramBot ---
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockOnText = vi.fn();

describe("/start command handler", () => {
  let registerStartCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const startModule = await import("../start");
    registerStartCommand = startModule.registerStartCommand;
  });

  it("should export registerStartCommand function", () => {
    expect(registerStartCommand).toBeDefined();
    expect(typeof registerStartCommand).toBe("function");
  });

  it("should register /start onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerStartCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toBe("\\/start");
  });

  it("should call prisma.user.upsert with correct telegramId when /start is triggered", async () => {
    mockUpsert.mockResolvedValue({
      id: "user-1",
      telegramId: "12345",
      email: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerStartCommand(bot);

    // Extract the handler that was registered
    const handler = mockOnText.mock.calls[0][1];
    expect(handler).toBeDefined();

    const mockMsg = {
      chat: { id: 98765 },
      from: {
        id: 12345,
        first_name: "John",
        is_bot: false,
      },
    };

    await handler(mockMsg);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { telegramId: "12345" },
        update: { telegramId: "12345" },
        create: {
          telegramId: "12345",
          email: undefined,
        },
      })
    );
  });

  it("should send a welcome message via bot.sendMessage after upsert", async () => {
    mockUpsert.mockResolvedValue({
      id: "user-1",
      telegramId: "12345",
      email: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerStartCommand(bot);

    const handler = mockOnText.mock.calls[0][1];

    const mockMsg = {
      chat: { id: 98765 },
      from: {
        id: 12345,
        first_name: "John",
        is_bot: false,
      },
    };

    await handler(mockMsg);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentChatId = mockSendMessage.mock.calls[0][0];
    const sentText = mockSendMessage.mock.calls[0][1];
    const sentOptions = mockSendMessage.mock.calls[0][2];

    expect(sentChatId).toBe(98765);
    expect(sentText).toContain("Welcome");
    expect(sentText).toContain("JobPulse");
    // Should mention available commands
    expect(sentText).toContain("/search");
    expect(sentText).toContain("/watch");
    // Should include inline keyboard
    expect(sentOptions).toBeDefined();
    expect(sentOptions.reply_markup).toBeDefined();
    expect(sentOptions.reply_markup.inline_keyboard).toBeDefined();
    expect(Array.isArray(sentOptions.reply_markup.inline_keyboard)).toBe(true);
    expect(sentOptions.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });

  it("should handle missing msg.from gracefully", async () => {
    mockUpsert.mockResolvedValue({
      id: "user-1",
      telegramId: null,
      email: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerStartCommand(bot);

    const handler = mockOnText.mock.calls[0][1];

    // msg without from field
    const mockMsg = {
      chat: { id: 98765 },
    };

    // Should not throw
    await expect(handler(mockMsg)).resolves.toBeUndefined();

    // upsert should still be called (with undefined telegramId)
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    // sendMessage should still be called
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});
