import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock prisma ---
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@jobpulse/shared/db", () => ({
  prisma: {
    jobMatch: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      update: mockUpdate,
    },
  },
}));

// --- Mock TelegramBot ---
const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
const mockAnswerCallbackQuery = vi.fn().mockResolvedValue(true);
const mockOn = vi.fn();

// Make the callback handler available to tests via a captured reference
let capturedCallbackHandler: ((query: any) => Promise<void>) | null = null;

const mockBot = {
  on: mockOn,
  sendMessage: mockSendMessage,
  answerCallbackQuery: mockAnswerCallbackQuery,
};

// --- In-memory state helpers ---
// The handler module exports these for testing
let savedJobs: Map<string, boolean>;
let dismissedJobs: Map<string, boolean>;
let jobDetails: Map<string, any>;
let searchResults: Map<number, any[]>;

describe("inline button handlers", () => {
  let registerInlineHandlers: (bot: any) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    capturedCallbackHandler = null;

    // Make on() capture the handler
    mockOn.mockImplementation((event: string, handler: any) => {
      if (event === "callback_query") {
        capturedCallbackHandler = handler;
      }
    });

    const inlineModule = await import("../inline");
    registerInlineHandlers = inlineModule.registerInlineHandlers;

    // Reset the in-memory state
    savedJobs = inlineModule.savedJobs;
    dismissedJobs = inlineModule.dismissedJobs;
    jobDetails = inlineModule.jobDetails;
    searchResults = inlineModule.searchResults;

    savedJobs.clear();
    dismissedJobs.clear();
    jobDetails.clear();
    searchResults.clear();
  });

  it("should export registerInlineHandlers function", () => {
    expect(registerInlineHandlers).toBeDefined();
    expect(typeof registerInlineHandlers).toBe("function");
  });

  it("should register a callback_query handler on the bot", () => {
    registerInlineHandlers(mockBot);

    expect(mockOn).toHaveBeenCalledTimes(1);
    expect(mockOn.mock.calls[0][0]).toBe("callback_query");
    expect(typeof mockOn.mock.calls[0][1]).toBe("function");
  });

  // ─── save ──────────────────────────────────────────────────────────────────

  it("should handle save: callback by acknowledging and storing job", async () => {
    // Seed job details
    jobDetails.set("linkedin:job-123", {
      source: "linkedin",
      sourceId: "job-123",
      title: "Software Engineer",
      company: "Acme Corp",
    });

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-1",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 100 },
      data: "save:linkedin:job-123",
    };

    await capturedCallbackHandler!(query);

    // Should acknowledge
    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-1");

    // Should store the job as saved
    expect(savedJobs.get("linkedin:job-123")).toBe(true);

    // Should notify
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("Saved"),
      { parse_mode: "HTML", reply_to_message_id: 100 }
    );
  });

  it("should handle save: callback and update DB via prisma if available", async () => {
    mockFindUnique.mockResolvedValue({
      id: "match-1",
      source: "linkedin",
      sourceId: "job-123",
      saved: false,
      dismissed: false,
    });
    mockUpdate.mockResolvedValue({
      id: "match-1",
      source: "linkedin",
      sourceId: "job-123",
      saved: true,
      dismissed: false,
    });

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-2",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 101 },
      data: "save:linkedin:job-123",
    };

    await capturedCallbackHandler!(query);

    // Should have queried DB for the match
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { source_sourceId: { source: "linkedin", sourceId: "job-123" } },
    });

    // Should have updated the match
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "match-1" },
      data: { saved: true },
    });
  });

  it("should handle save: callback gracefully when job not found in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-3",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 102 },
      data: "save:linkedin:job-unknown",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-3");
    // Should still save in-memory
    expect(savedJobs.get("linkedin:job-unknown")).toBe(true);
  });

  // ─── dismiss ────────────────────────────────────────────────────────────────

  it("should handle dismiss: callback by acknowledging and dismissing job", async () => {
    jobDetails.set("linkedin:job-456", {
      source: "linkedin",
      sourceId: "job-456",
      title: "Product Manager",
      company: "Beta Inc",
    });

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-10",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 200 },
      data: "dismiss:linkedin:job-456",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-10");
    expect(dismissedJobs.get("linkedin:job-456")).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("Dismissed"),
      { parse_mode: "HTML", reply_to_message_id: 200 }
    );
  });

  it("should handle dismiss: callback and update DB via prisma", async () => {
    mockFindUnique.mockResolvedValue({
      id: "match-2",
      source: "linkedin",
      sourceId: "job-456",
      saved: false,
      dismissed: false,
    });
    mockUpdate.mockResolvedValue({
      id: "match-2",
      source: "linkedin",
      sourceId: "job-456",
      saved: false,
      dismissed: true,
    });

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-11",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 201 },
      data: "dismiss:linkedin:job-456",
    };

    await capturedCallbackHandler!(query);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { source_sourceId: { source: "linkedin", sourceId: "job-456" } },
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "match-2" },
      data: { dismissed: true },
    });
  });

  // ─── similar ────────────────────────────────────────────────────────────────

  it("should handle similar: callback by searching with job title as query", async () => {
    jobDetails.set("linkedin:job-789", {
      source: "linkedin",
      sourceId: "job-789",
      title: "Senior Software Engineer",
      company: "Gamma LLC",
    });

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-20",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 300 },
      data: "similar:linkedin:job-789",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-20");
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("Software Engineer"),
      { parse_mode: "HTML", reply_to_message_id: 300 }
    );
  });

  it("should handle similar: callback gracefully when job details not found", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-21",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 301 },
      data: "similar:linkedin:job-unknown",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-21");
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("Sorry"),
      { parse_mode: "HTML", reply_to_message_id: 301 }
    );
  });

  // ─── page ──────────────────────────────────────────────────────────────────

  it("should handle page: callback by sending the requested page of results", async () => {
    // Seed search results for chat 98765
    const jobs = Array.from({ length: 12 }, (_, i) => ({
      source: "linkedin",
      sourceId: `job-${i}`,
      title: `Engineer ${i + 1}`,
      company: `Company ${i + 1}`,
      url: `https://example.com/job/${i}`,
      location: "Remote",
      salaryMin: null,
      salaryMax: null,
      postedAt: "2026-07-01T00:00:00.000Z",
      type: "fulltime",
      descriptionSnippet: null,
      tags: [],
    }));
    searchResults.set(98765, jobs);

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-30",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 400 },
      data: "page:2",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-30");
    // Should edit the message with page 2 content
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("Engineer 6"),
      expect.objectContaining({
        parse_mode: "HTML",
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      })
    );
  });

  it("should handle page: callback and edit the existing message", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => ({
      source: "linkedin",
      sourceId: `job-${i}`,
      title: `Engineer ${i + 1}`,
      company: `Co ${i + 1}`,
      url: `https://example.com/job/${i}`,
      location: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: "2026-07-01T00:00:00.000Z",
      type: null,
      descriptionSnippet: null,
      tags: [],
    }));
    searchResults.set(98765, jobs);

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-31",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 400 },
      data: "page:1",
    };

    await capturedCallbackHandler!(query);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentOptions = mockSendMessage.mock.calls[0][2];
    // Should have inline keyboard with nav buttons
    expect(sentOptions.reply_markup.inline_keyboard).toBeDefined();
  });

  it("should handle page: callback gracefully when no search results stored", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-32",
      from: { id: 12345 },
      message: { chat: { id: 99999 }, message_id: 401 },
      data: "page:1",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-32");
    expect(mockSendMessage).toHaveBeenCalledWith(
      99999,
      expect.stringContaining("expired"),
      { parse_mode: "HTML", reply_to_message_id: 401 }
    );
  });

  // ─── refresh ────────────────────────────────────────────────────────────────

  it("should handle refresh: callback by re-sending current page results", async () => {
    const jobs = Array.from({ length: 3 }, (_, i) => ({
      source: "linkedin",
      sourceId: `job-${i}`,
      title: `Engineer ${i + 1}`,
      company: `Co ${i + 1}`,
      url: `https://example.com/job/${i}`,
      location: null,
      salaryMin: null,
      salaryMax: null,
      postedAt: "2026-07-01T00:00:00.000Z",
      type: null,
      descriptionSnippet: null,
      tags: [],
    }));
    searchResults.set(98765, jobs);

    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    // First navigate to page 2
    const jobs12 = Array.from({ length: 12 }, (_, i) => ({
      source: "linkedin",
      sourceId: `job-${i}`,
      title: `Engineer ${i + 1}`,
      company: `Company ${i + 1}`,
      url: `https://example.com/job/${i}`,
      location: "Remote",
      salaryMin: null,
      salaryMax: null,
      postedAt: "2026-07-01T00:00:00.000Z",
      type: "fulltime",
      descriptionSnippet: null,
      tags: [],
    }));
    searchResults.set(98765, jobs12);

    const query = {
      id: "query-40",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 500 },
      data: "refresh:1712345678000",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-40");
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    // Should include header with search results
    const sentText = mockSendMessage.mock.calls[0][1];
    expect(sentText).toContain("Engineer 1");
    expect(sentText).toContain("Search Results");
  });

  it("should handle refresh: callback gracefully when no search results stored", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-41",
      from: { id: 12345 },
      message: { chat: { id: 99999 }, message_id: 501 },
      data: "refresh:1712345678000",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-41");
    expect(mockSendMessage).toHaveBeenCalledWith(
      99999,
      expect.stringContaining("expired"),
      { parse_mode: "HTML", reply_to_message_id: 501 }
    );
  });

  // ─── noop ──────────────────────────────────────────────────────────────────

  it("should handle noop callback by just acknowledging", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-50",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 600 },
      data: "noop",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-50");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ─── search (from start.ts) ────────────────────────────────────────────────

  it("should handle 'search' callback by prompting to type /search", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-60",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 700 },
      data: "search",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-60");
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("/search"),
      { parse_mode: "HTML" }
    );
  });

  // ─── watch (from start.ts) ────────────────────────────────────────────────

  it("should handle 'watch' callback by prompting to type /watch", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-70",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 800 },
      data: "watch",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-70");
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("/watch"),
      { parse_mode: "HTML" }
    );
  });

  // ─── sources (from start.ts) ──────────────────────────────────────────────

  it("should handle 'sources' callback by calling /sources command", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-80",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 900 },
      data: "sources",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-80");
    expect(mockSendMessage).toHaveBeenCalledWith(
      98765,
      expect.stringContaining("/sources"),
      { parse_mode: "HTML" }
    );
  });

  // ─── unknown callback data ────────────────────────────────────────────────

  it("should handle unknown callback data gracefully", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-90",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 1000 },
      data: "unknown:data:here",
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-90");
    // Should still acknowledge
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("should handle empty or undefined callback data gracefully", async () => {
    registerInlineHandlers(mockBot);
    expect(capturedCallbackHandler).toBeDefined();

    const query = {
      id: "query-91",
      from: { id: 12345 },
      message: { chat: { id: 98765 }, message_id: 1001 },
      data: undefined,
    };

    await capturedCallbackHandler!(query);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith("query-91");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ─── Exported state maps ──────────────────────────────────────────────────

  it("should export savedJobs, dismissedJobs, jobDetails, searchResults Maps", async () => {
    const inlineModule = await import("../inline");
    expect(inlineModule.savedJobs).toBeInstanceOf(Map);
    expect(inlineModule.dismissedJobs).toBeInstanceOf(Map);
    expect(inlineModule.jobDetails).toBeInstanceOf(Map);
    expect(inlineModule.searchResults).toBeInstanceOf(Map);
  });
});
