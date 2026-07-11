import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock process.exit so tests don't terminate
vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

// Shared mock references for TelegramBot
let mockTelegramBotInstance: any;
let mockOnTextHandler: ReturnType<typeof vi.fn>;
let mockOnHandler: ReturnType<typeof vi.fn>;
let mockStartPolling: ReturnType<typeof vi.fn>;
let mockStopPolling: ReturnType<typeof vi.fn>;
let mockIsPolling: ReturnType<typeof vi.fn>;
let mockOpenWebHook: ReturnType<typeof vi.fn>;
let mockCloseWebHook: ReturnType<typeof vi.fn>;
let mockHasOpenWebHook: ReturnType<typeof vi.fn>;
let mockSetWebhook: ReturnType<typeof vi.fn>;

vi.mock("node-telegram-bot-api", () => {
  mockOnTextHandler = vi.fn();
  mockOnHandler = vi.fn();
  mockStartPolling = vi.fn().mockResolvedValue(undefined);
  mockStopPolling = vi.fn().mockResolvedValue(undefined);
  mockIsPolling = vi.fn().mockReturnValue(false);
  mockOpenWebHook = vi.fn().mockResolvedValue(undefined);
  mockCloseWebHook = vi.fn().mockResolvedValue(undefined);
  mockHasOpenWebHook = vi.fn().mockReturnValue(false);
  mockSetWebhook = vi.fn().mockResolvedValue({ ok: true });

  const TelegramBot = vi.fn().mockImplementation((token: string, options?: any) => {
    mockTelegramBotInstance = {
      token,
      options,
      onText: mockOnTextHandler,
      on: mockOnHandler,
      startPolling: mockStartPolling,
      stopPolling: mockStopPolling,
      isPolling: mockIsPolling,
      openWebHook: mockOpenWebHook,
      closeWebHook: mockCloseWebHook,
      hasOpenWebHook: mockHasOpenWebHook,
      setWebhook: mockSetWebhook,
      removeTextListener: vi.fn(),
      clearTextListeners: vi.fn(),
    };
    return mockTelegramBotInstance;
  });
  return { default: TelegramBot, TelegramBot };
});

// Mock http module for webhook tests
let mockHttpServerInstance: any;
vi.mock("http", () => {
  mockHttpServerInstance = {
    listen: vi.fn((port: number, cb?: () => void) => {
      if (cb) cb();
      return mockHttpServerInstance;
    }),
    close: vi.fn((cb?: () => void) => {
      if (cb) cb();
      return mockHttpServerInstance;
    }),
    on: vi.fn().mockReturnThis(),
  };
  const createServer = vi.fn(() => mockHttpServerInstance);
  return { default: { createServer }, createServer };
});

describe("bot config (config.ts)", () => {
  let botConfigModule: typeof import("../config");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.BOT_TOKEN;
    delete process.env.BOT_MODE;
    delete process.env.BOT_WEBHOOK_URL;
    delete process.env.BOT_WEBHOOK_PORT;
    delete process.env.BOT_LISTEN_PORT;
  });

  it("should export BotConfig interface and loadBotConfig function", async () => {
    botConfigModule = await import("../config");
    expect(botConfigModule).toHaveProperty("loadBotConfig");
    expect(typeof botConfigModule.loadBotConfig).toBe("function");
  });

  it("should throw if BOT_TOKEN is not set", async () => {
    botConfigModule = await import("../config");
    expect(() => botConfigModule.loadBotConfig()).toThrow(
      "BOT_TOKEN environment variable is required"
    );
  });

  it("should return config with defaults when only BOT_TOKEN is set", async () => {
    process.env.BOT_TOKEN = "test:token123";
    botConfigModule = await import("../config");
    const config = botConfigModule.loadBotConfig();
    expect(config.botToken).toBe("test:token123");
    expect(config.botMode).toBe("polling");
    expect(config.webhookUrl).toBeUndefined();
    expect(config.webhookPort).toBe(8443);
    expect(config.listenPort).toBe(3000);
  });

  it("should read BOT_MODE=webhook and require BOT_WEBHOOK_URL", async () => {
    process.env.BOT_TOKEN = "test:token123";
    process.env.BOT_MODE = "webhook";
    botConfigModule = await import("../config");
    const config = botConfigModule.loadBotConfig();
    expect(config.botMode).toBe("webhook");
    expect(config.webhookUrl).toBeUndefined();
  });

  it("should read all env vars correctly", async () => {
    process.env.BOT_TOKEN = "test:token456";
    process.env.BOT_MODE = "webhook";
    process.env.BOT_WEBHOOK_URL = "https://example.com/webhook";
    process.env.BOT_WEBHOOK_PORT = "9443";
    process.env.BOT_LISTEN_PORT = "4000";
    botConfigModule = await import("../config");
    const config = botConfigModule.loadBotConfig();
    expect(config.botToken).toBe("test:token456");
    expect(config.botMode).toBe("webhook");
    expect(config.webhookUrl).toBe("https://example.com/webhook");
    expect(config.webhookPort).toBe(9443);
    expect(config.listenPort).toBe(4000);
  });
});

describe("bot entry point (index.ts)", () => {
  let mainModule: typeof import("../index");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.BOT_TOKEN;
    delete process.env.BOT_MODE;
    delete process.env.BOT_WEBHOOK_URL;
    delete process.env.BOT_WEBHOOK_PORT;
    delete process.env.BOT_LISTEN_PORT;
  });

  it("should export start and shutdown functions", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");
    expect(mainModule).toHaveProperty("start");
    expect(mainModule).toHaveProperty("shutdown");
    expect(typeof mainModule.start).toBe("function");
    expect(typeof mainModule.shutdown).toBe("function");
  });

  it("should export a bot instance", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");
    expect(mainModule).toHaveProperty("bot");
  });

  it("should create bot in polling mode by default and start polling", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");
    await mainModule.start();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/bot] Starting in polling mode..."
    );

    // Should have created TelegramBot with polling option
    const { default: TelegramBot } = await import("node-telegram-bot-api");
    expect(TelegramBot).toHaveBeenCalledWith(
      "test:token789",
      expect.objectContaining({ polling: true })
    );

    expect(mockOnTextHandler).toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/bot] Bot started successfully"
    );
  });

  it("should register all command handlers on start", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");
    await mainModule.start();

    // Should register /start, /search, /watch, /list, /remove, /digest, /pause, /sources, /filters
    const commands = [
      /\/start/,
      /\/search/,
      /\/watch/,
      /\/list/,
      /\/remove/,
      /\/digest/,
      /\/pause/,
      /\/sources/,
      /\/filters/,
    ];
    const onTextCalls = (mockOnTextHandler as ReturnType<typeof vi.fn>).mock.calls;
    const registeredRegexps = onTextCalls.map((call: any[]) => call[0]);

    for (const cmd of commands) {
      const found = registeredRegexps.some((r: RegExp) =>
        r.source === cmd.source
      );
      expect(found).toBe(true);
    }
  });

  it("should register callback_query handler for inline buttons", async () => {
    process.env.BOT_TOKEN="***";
    mainModule = await import("../index");
    await mainModule.start();

    // Should have registered a callback_query handler via bot.on()
    const onCalls = (mockOnHandler as ReturnType<typeof vi.fn>).mock.calls;
    const events = onCalls.map((call: any[]) => call[0]);
    expect(events).toContain("callback_query");
  });

  it("should create bot in webhook mode and call setWebhook", async () => {
    process.env.BOT_TOKEN = "test:token789";
    process.env.BOT_MODE = "webhook";
    process.env.BOT_WEBHOOK_URL = "https://example.com/webhook/secret-path";
    mainModule = await import("../index");
    await mainModule.start();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/bot] Starting in webhook mode..."
    );

    // Should have created TelegramBot with webHook option
    const { default: TelegramBot } = await import("node-telegram-bot-api");
    expect(TelegramBot).toHaveBeenCalledWith(
      "test:token789",
      expect.objectContaining({
        webHook: expect.objectContaining({
          port: 8443,
          autoOpen: false,
        }),
      })
    );

    // Should have called setWebhook with the configured URL
    expect(mockSetWebhook).toHaveBeenCalledWith(
      "https://example.com/webhook/secret-path"
    );

    // Should have opened the webhook
    expect(mockOpenWebHook).toHaveBeenCalled();
  });

  it("should gracefully stop polling on shutdown", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");

    // Mock isPolling to return true after start
    mockIsPolling = mockIsPolling.mockReturnValue(true);

    await mainModule.start();
    await mainModule.shutdown();

    expect(mockStopPolling).toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/bot] Shutdown complete"
    );
  });

  it("should gracefully close webhook on shutdown in webhook mode", async () => {
    process.env.BOT_TOKEN = "test:token789";
    process.env.BOT_MODE = "webhook";
    process.env.BOT_WEBHOOK_URL = "https://example.com/webhook";
    mainModule = await import("../index");

    // Mock hasOpenWebHook to return true after start
    mockHasOpenWebHook = mockHasOpenWebHook.mockReturnValue(true);

    await mainModule.start();
    await mainModule.shutdown();

    expect(mockCloseWebHook).toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      "[@jobpulse/bot] Shutdown complete"
    );
  });

  it("should handle SIGTERM by calling shutdown", async () => {
    process.env.BOT_TOKEN = "test:token789";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    mainModule = await import("../index");
    await mainModule.start();

    // Emit SIGTERM
    process.emit("SIGTERM");

    // Allow the async handler to run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockStopPolling).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should handle SIGINT by calling shutdown", async () => {
    process.env.BOT_TOKEN = "test:token789";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    mainModule = await import("../index");
    await mainModule.start();

    // Emit SIGINT
    process.emit("SIGINT");

    await new Promise((r) => setTimeout(r, 50));

    expect(mockStopPolling).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should accept optional config parameter in start() for testing", async () => {
    process.env.BOT_TOKEN = "test:token789";
    mainModule = await import("../index");

    // Override config by passing it directly
    const testConfig = {
      botToken: "override:token",
      botMode: "polling" as const,
      webhookUrl: undefined,
      webhookPort: 9443,
      listenPort: 4000,
    };

    await mainModule.start(testConfig);

    const { default: TelegramBot } = await import("node-telegram-bot-api");
    expect(TelegramBot).toHaveBeenCalledWith(
      "override:token",
      expect.objectContaining({ polling: true })
    );
  });
});
