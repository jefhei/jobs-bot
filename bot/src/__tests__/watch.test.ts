import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockUserFindUnique = vi.fn();
const mockWatchConfigCreate = vi.fn();

vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
    },
    watchConfig: {
      create: mockWatchConfigCreate,
    },
  },
}));

// ─── Mock queue ──────────────────────────────────────────────────────────────

const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
const mockGetPollQueue = vi.fn(() => ({
  add: mockQueueAdd,
}));

vi.mock("../queue", () => ({
  getPollQueue: mockGetPollQueue,
}));

// ─── Mock TelegramBot ────────────────────────────────────────────────────────

const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

function createMockBot(onTextHandler?: any) {
  return {
    onText: onTextHandler ?? vi.fn(),
    sendMessage: mockSendMessage,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMessage(text: string, overrides: Record<string, any> = {}) {
  return {
    message_id: 123,
    from: { id: 987654321, is_bot: false, first_name: "TestUser" },
    chat: { id: -123456789 },
    text,
    date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("registerWatchCommand", () => {
  let registerWatchCommand: typeof import("../commands/watch").registerWatchCommand;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import fresh each time to reset module state
    const mod = await import("../commands/watch");
    registerWatchCommand = mod.registerWatchCommand;
  });

  it("should export registerWatchCommand function", () => {
    expect(registerWatchCommand).toBeDefined();
    expect(typeof registerWatchCommand).toBe("function");
  });

  it("should register /watch onText handler on the bot", () => {
    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    expect(onText).toHaveBeenCalledOnce();
    const [regex] = onText.mock.calls[0];
    expect(regex).toBeInstanceOf(RegExp);
    // Should match /watch
    expect(regex.test("/watch")).toBe(true);
    expect(regex.test("/watch software engineer")).toBe(true);
    expect(regex.test("/watch@JobPulseBot engineer in Remote")).toBe(true);
  });

  it("should extract keyword from message text (removes /watch prefix)", async () => {
    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    // Call the handler that was registered
    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch software engineer");
    await handler(msg);

    // Verify user lookup occurred
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { telegramId: "987654321" },
    });
  });

  it("should parse keyword and optional location", async () => {
    // Mock user found
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-abc-123",
      keyword: "software engineer",
      location: "Remote",
      userId: "user-123",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch software engineer in Remote");
    await handler(msg);

    expect(mockWatchConfigCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-123",
        keyword: "software engineer",
        location: "Remote",
        sources: ["linkedin", "indeed", "greenhouse", "lever"],
        intervalMinutes: 30,
        notifyVia: ["telegram"],
        active: true,
      },
    });
  });

  it("should create WatchConfig with correct fields via prisma", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-456", telegramId: "1122334455" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-xyz-789",
      keyword: "rust developer",
      location: null,
      userId: "user-456",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch rust developer");
    await handler(msg);

    expect(mockWatchConfigCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-456",
        keyword: "rust developer",
        location: undefined,
        sources: ["linkedin", "indeed", "greenhouse", "lever"],
        intervalMinutes: 30,
        notifyVia: ["telegram"],
        active: true,
      },
    });
  });

  it("should send confirmation message with watch ID", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-abc-123",
      keyword: "software engineer",
      location: null,
      userId: "user-123",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch software engineer");
    await handler(msg);

    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("watch-abc-123"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
    // Should mention the keyword in the response
    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("software engineer"),
      expect.any(Object)
    );
  });

  it("should handle missing query text (send usage instructions)", async () => {
    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    // No text after /watch
    const msg = makeMessage("/watch");
    await handler(msg);

    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("Usage"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
    // Should NOT try to create a watch config
    expect(mockWatchConfigCreate).not.toHaveBeenCalled();
  });

  it("should handle missing text property entirely", async () => {
    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    // Message without text
    const msg = makeMessage("", { text: undefined });
    await handler(msg);

    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("Usage"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
    expect(mockWatchConfigCreate).not.toHaveBeenCalled();
  });

  it("should handle missing user (tell to /start first)", async () => {
    // User not found in DB
    mockUserFindUnique.mockResolvedValue(null);

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch data scientist");
    await handler(msg);

    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("/start"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
    expect(mockWatchConfigCreate).not.toHaveBeenCalled();
  });

  it("should handle DB errors gracefully", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockRejectedValue(new Error("Database connection failed"));

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch frontend developer");
    await handler(msg);

    // Should send error message
    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("error"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
  });

  it("should extract location after 'in' keyword", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-loc-123",
      keyword: "product manager",
      location: "San Francisco",
      userId: "user-123",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch product manager in San Francisco");
    await handler(msg);

    expect(mockWatchConfigCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        keyword: "product manager",
        location: "San Francisco",
      }),
    });

    // Should mention location in confirmation
    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("San Francisco"),
      expect.any(Object)
    );
  });

  // ─── NEW TESTS for Task 5.1 ────────────────────────────────────────────

  it("should enqueue an immediate BullMQ poll job after creating WatchConfig", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-abc-123",
      keyword: "software engineer",
      location: null,
      userId: "user-123",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch software engineer");
    await handler(msg);

    // Verify getPollQueue was called
    expect(mockGetPollQueue).toHaveBeenCalledOnce();
    // Verify queue.add was called with correct job name and data
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "poll-watch-abc-123",
      { watchConfigId: "watch-abc-123" }
    );
  });

  it("should still succeed when enqueuing the immediate poll job fails", async () => {
    mockUserFindUnique.mockResolvedValue({ id: "user-123", telegramId: "987654321" });
    mockWatchConfigCreate.mockResolvedValue({
      id: "watch-xyz-789",
      keyword: "rust developer",
      location: null,
      userId: "user-123",
      sources: ["linkedin", "indeed", "greenhouse", "lever"],
      intervalMinutes: 30,
      active: true,
      createdAt: new Date(),
    });
    // Make queue.add reject
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis connection failed"));

    const onText = vi.fn();
    const bot = createMockBot(onText);
    registerWatchCommand(bot);

    const handler = onText.mock.calls[0][1];
    const msg = makeMessage("/watch rust developer");
    await handler(msg);

    // Watch creation should still succeed (confirmation sent)
    expect(mockWatchConfigCreate).toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(
      msg.chat.id,
      expect.stringContaining("Watch Created"),
      expect.any(Object)
    );
  });
});
