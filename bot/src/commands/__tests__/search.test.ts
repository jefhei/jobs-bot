import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock searchAllSources from @jobpulse/shared ---
const mockSearchAllSources = vi.fn();
vi.mock("@jobpulse/shared", () => ({
  searchAllSources: mockSearchAllSources,
  NormalizedJob: {},
  SearchResult: {},
}));

// --- Mock TelegramBot ---
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockOnText = vi.fn();

// Helper to create a sample NormalizedJob for testing
function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    source: "linkedin",
    sourceId: "job-1",
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Remote",
    type: "fulltime",
    salaryMin: 100000,
    salaryMax: 150000,
    postedAt: "2026-06-01T00:00:00.000Z",
    url: "https://example.com/job/1",
    descriptionSnippet: "Great job opportunity",
    tags: ["engineering", "remote"],
    ...overrides,
  };
}

describe("/search command handler", () => {
  let registerSearchCommand: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const searchModule = await import("../search");
    registerSearchCommand = searchModule.registerSearchCommand;
  });

  it("should export registerSearchCommand function", () => {
    expect(registerSearchCommand).toBeDefined();
    expect(typeof registerSearchCommand).toBe("function");
  });

  it("should register /search onText handler on the bot", () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    expect(mockOnText).toHaveBeenCalledTimes(1);
    const regexArg = mockOnText.mock.calls[0][0];
    expect(regexArg).toBeInstanceOf(RegExp);
    expect(regexArg.source).toContain("search");
  });

  it("should extract query text from message (removes /search prefix)", async () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    expect(handler).toBeDefined();

    const mockMsg = {
      chat: { id: 98765 },
      text: "/search software engineer",
      from: { id: 12345, first_name: "John" },
    };

    await handler(mockMsg, null);

    // Should call searchAllSources with the extracted query
    expect(mockSearchAllSources).toHaveBeenCalledTimes(1);
    const queryArg = mockSearchAllSources.mock.calls[0][0];
    expect(queryArg).toBe("software engineer");
  });

  it("should parse 'in' keyword for location extraction", async () => {
    mockSearchAllSources.mockResolvedValue([]);
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search software engineer in Remote",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).toHaveBeenCalledTimes(1);
    const queryArg = mockSearchAllSources.mock.calls[0][0];
    const optionsArg = mockSearchAllSources.mock.calls[0][1];
    expect(queryArg).toBe("software engineer");
    expect(optionsArg).toEqual({ location: "Remote" });
  });

  it("should parse location after dash separator", async () => {
    mockSearchAllSources.mockResolvedValue([]);
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search software engineer - New York",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).toHaveBeenCalledTimes(1);
    expect(mockSearchAllSources.mock.calls[0][0]).toBe("software engineer");
    expect(mockSearchAllSources.mock.calls[0][1]).toEqual({ location: "New York" });
  });

  it("should call searchAllSources with correct parameters when no location", async () => {
    mockSearchAllSources.mockResolvedValue([]);
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search software engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).toHaveBeenCalledWith(
      "software engineer",
      { location: undefined }
    );
  });

  it("should format results with title, company, location", async () => {
    const jobs = [
      makeJob({ title: "Senior Engineer", company: "Tech Co", location: "San Francisco" }),
      makeJob({ title: "Junior Engineer", company: "Startup Inc", location: "New York" }),
    ];
    mockSearchAllSources.mockResolvedValue([
      { source: "linkedin", jobs, totalCount: 2 },
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Senior Engineer");
    expect(sentText).toContain("Tech Co");
    expect(sentText).toContain("San Francisco");
    expect(sentText).toContain("Junior Engineer");
    expect(sentText).toContain("Startup Inc");
    expect(sentText).toContain("New York");
  });

  it("should include salary info when available in formatted results", async () => {
    const jobs = [
      makeJob({ salaryMin: 80000, salaryMax: 120000 }),
    ];
    mockSearchAllSources.mockResolvedValue([
      { source: "linkedin", jobs, totalCount: 1 },
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("$80,000");
    expect(sentText).toContain("$120,000");
  });

  it("should paginate results (5 per page)", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) =>
      makeJob({
        sourceId: `job-${i}`,
        title: `Engineer ${i + 1}`,
        company: `Company ${i + 1}`,
      })
    );
    mockSearchAllSources.mockResolvedValue([
      { source: "linkedin", jobs, totalCount: 12 },
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    // Should send 3 messages: page 1 (5 jobs), page 2 (5 jobs), page 3 (2 jobs)
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    expect(mockSendMessage.mock.calls[0][1]).toContain("Engineer 1");
    expect(mockSendMessage.mock.calls[0][1]).toContain("Engineer 5");
    expect(mockSendMessage.mock.calls[1][1]).toContain("Engineer 6");
    expect(mockSendMessage.mock.calls[1][1]).toContain("Engineer 10");
    expect(mockSendMessage.mock.calls[2][1]).toContain("Engineer 11");
    expect(mockSendMessage.mock.calls[2][1]).toContain("Engineer 12");
  });

  it("should include inline keyboard with action buttons", async () => {
    const jobs = [
      makeJob({ sourceId: "job-save-1" }),
    ];
    mockSearchAllSources.mockResolvedValue([
      { source: "linkedin", jobs, totalCount: 1 },
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentOptions = mockSendMessage.mock.calls[0][2];
    expect(sentOptions).toBeDefined();
    expect(sentOptions.reply_markup).toBeDefined();
    expect(sentOptions.reply_markup.inline_keyboard).toBeDefined();

    // Each job should have a row with Save | Apply | Dismiss | Similar buttons
    const keyboard = sentOptions.reply_markup.inline_keyboard;
    expect(keyboard.length).toBeGreaterThan(0);
    // First row should be the job buttons
    expect(keyboard[0].some((btn: any) => btn.text === "💾 Save")).toBe(true);
    expect(keyboard[0].some((btn: any) => btn.text === "🔗 Apply")).toBe(true);
    expect(keyboard[0].some((btn: any) => btn.text === "❌ Dismiss")).toBe(true);
    expect(keyboard[0].some((btn: any) => btn.text === "🔍 Similar")).toBe(true);
  });

  it("should handle empty search results gracefully", async () => {
    mockSearchAllSources.mockResolvedValue([]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search nonexistentjob123",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("No jobs found");
    expect(sentText).toContain("nonexistentjob123");
  });

  it("should handle no query text gracefully (send usage instructions)", async () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Usage");
    expect(sentText).toContain("/search");
  });

  it("should handle when msg.text is missing", async () => {
    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      // no text field
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Usage");
  });

  it("should handle search errors gracefully", async () => {
    mockSearchAllSources.mockRejectedValue(new Error("API failure"));

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    expect(mockSearchAllSources).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("error");
    expect(sentText).toContain("searching");
  });

  it("should show posted date in results", async () => {
    const jobs = [
      makeJob({ postedAt: "2026-07-04T00:00:00.000Z" }), // recently
    ];
    mockSearchAllSources.mockResolvedValue([
      { source: "linkedin", jobs, totalCount: 1 },
    ]);

    const bot = { onText: mockOnText, sendMessage: mockSendMessage };
    registerSearchCommand(bot);

    const handler = mockOnText.mock.calls[0][1];
    const mockMsg = {
      chat: { id: 98765 },
      text: "/search engineer",
      from: { id: 12345 },
    };

    await handler(mockMsg, null);

    const sentText = mockSendMessage.mock.calls[0][1];
    // Should contain the posted date (formatted as relative or absolute)
    expect(sentText).toContain("Posted");
  });
});
