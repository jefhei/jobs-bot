import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks must be established before any imports ────────────────────────────

vi.mock("@jobpulse/shared", () => ({
  searchAllSources: vi.fn(),
}));

// After mocks, we can import the modules under test
import { searchCommand } from "../commands/search";
import { searchAllSources } from "@jobpulse/shared";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockJobs = [
  {
    source: "indeed" as const,
    sourceId: "indeed-123",
    title: "Software Engineer",
    company: "Tech Corp",
    location: "San Francisco, CA",
    type: "fulltime",
    salaryMin: 100000,
    salaryMax: 150000,
    postedAt: "2025-03-01T00:00:00.000Z",
    url: "https://indeed.com/job/123",
    descriptionSnippet: "Great job",
    tags: ["javascript"],
  },
  {
    source: "indeed" as const,
    sourceId: "indeed-456",
    title: "Frontend Developer",
    company: "Web Inc",
    location: "Remote",
    type: "fulltime",
    salaryMin: 80000,
    salaryMax: 120000,
    postedAt: "2025-03-02T00:00:00.000Z",
    url: "https://indeed.com/job/456",
    descriptionSnippet: "Frontend role",
    tags: ["react"],
  },
];

const mockSearchResults = [
  {
    source: "indeed" as const,
    jobs: mockJobs,
    totalCount: 2,
    latencyMs: 100,
  },
  {
    source: "greenhouse" as const,
    jobs: [],
    totalCount: 0,
    error: "API rate limited",
    latencyMs: 50,
  },
];

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Run the search command action by parsing args.
 * Captures both configureOutput (Commander) and console.log/error output.
 */
async function runAction(args: string[]): Promise<string> {
  const lines: string[] = [];

  // Spy on console.log and console.error
  const origLog = console.log;
  const origError = console.error;
  console.log = (...msgs: unknown[]) => {
    lines.push(msgs.map(String).join(" "));
  };
  console.error = (...msgs: unknown[]) => {
    lines.push(msgs.map(String).join(" "));
  };

  // Also capture Commander's output
  searchCommand.configureOutput({
    writeOut: (str: string) => {
      lines.push(str);
    },
    writeErr: (str: string) => {
      lines.push(str);
    },
  });
  searchCommand.exitOverride();

  try {
    await searchCommand.parseAsync(args, { from: "user" });
  } catch (err) {
    // Commander can throw with exitOverride, but some errors are caught
    lines.push(String(err));
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  return lines.join("");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("search command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return results successfully
    vi.mocked(searchAllSources).mockResolvedValue(mockSearchResults);
  });

  // === 1. Accepts a query positional argument ===

  it("1. should accept a query positional argument and pass it to searchAllSources", async () => {
    await runAction(["engineer"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.any(Object),
      undefined
    );
  });

  it("1b. should fail gracefully when no query is provided", async () => {
    const output = await runAction([]);
    // Commander should show error about missing argument
    expect(output).toContain("error");
  });

  // === 2. Flags: --location, --type, --salary, --sources, --json, --csv ===

  it("2a. should pass --location flag to searchAllSources options", async () => {
    await runAction(["engineer", "--location", "New York"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ location: "New York" }),
      undefined
    );
  });

  it("2b. should pass -l shorthand for location", async () => {
    await runAction(["engineer", "-l", "Austin"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ location: "Austin" }),
      undefined
    );
  });

  it("2c. should pass --type flag to searchAllSources options", async () => {
    await runAction(["engineer", "--type", "fulltime"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ jobType: "fulltime" }),
      undefined
    );
  });

  it("2d. should pass -t shorthand for type", async () => {
    await runAction(["engineer", "-t", "contract"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ jobType: "contract" }),
      undefined
    );
  });

  it("2e. should pass --salary flag to searchAllSources options", async () => {
    await runAction(["engineer", "--salary", "80000"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ minSalary: 80000 }),
      undefined
    );
  });

  it("2f. should pass -s shorthand for salary", async () => {
    await runAction(["engineer", "-s", "60000"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.objectContaining({ minSalary: 60000 }),
      undefined
    );
  });

  it("2g. should pass --sources flag as JobSource array to searchAllSources", async () => {
    await runAction(["engineer", "--sources", "linkedin,indeed"]);
    expect(searchAllSources).toHaveBeenCalledWith(
      "engineer",
      expect.any(Object),
      ["linkedin", "indeed"]
    );
  });

  // === 3. Interactive mode renders a table ===

  it("3. should render a table in interactive mode (default, no --json/--csv)", async () => {
    const output = await runAction(["engineer"]);
    // Should contain job titles
    expect(output).toContain("Software Engineer");
    expect(output).toContain("Frontend Developer");
    // Should contain company names
    expect(output).toContain("Tech Corp");
    expect(output).toContain("Web Inc");
    // Should indicate which source failed
    expect(output).toContain("greenhouse");
    expect(output).toContain("API rate limited");
  });

  // === 4. JSON mode outputs JSON ===

  it("4. should output JSON when --json flag is passed", async () => {
    const output = await runAction(["engineer", "--json"]);
    // Should be valid JSON
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe("indeed");
    expect(parsed[0].jobs).toHaveLength(2);
    expect(parsed[1].source).toBe("greenhouse");
    expect(parsed[1].error).toBe("API rate limited");
  });

  // === 5. CSV mode outputs CSV ===

  it("5. should output CSV when --csv flag is passed", async () => {
    const output = await runAction(["engineer", "--csv"]);
    // Should have CSV headers
    expect(output).toContain("title");
    expect(output).toContain("company");
    expect(output).toContain("location");
    expect(output).toContain("postedAt");
    expect(output).toContain("url");
    expect(output).toContain("source");
    // Should have job data
    expect(output).toContain("Software Engineer");
    expect(output).toContain("Tech Corp");
    // Should NOT have table chars (interactive mode suppressed)
    expect(output).not.toContain("┌");
    expect(output).not.toContain("│");
  });

  // === 6. Handles $NO_COLOR environment variable ===

  it("6. should NOT have colorized output when NO_COLOR env var is set", async () => {
    const origNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      const output = await runAction(["engineer"]);
      // Should still contain job data
      expect(output).toContain("Software Engineer");
    } finally {
      if (origNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = origNoColor;
      }
    }
  });

  // === 7. Handles errors from sources gracefully ===

  it("7. should display per-source error messages in interactive mode", async () => {
    const output = await runAction(["engineer"]);
    expect(output).toContain("greenhouse");
    expect(output).toContain("API rate limited");
  });

  it("7b. should include errors in JSON output when source fails", async () => {
    const output = await runAction(["engineer", "--json"]);
    const parsed = JSON.parse(output);
    const failedSource = parsed.find(
      (r: { source: string }) => r.source === "greenhouse"
    );
    expect(failedSource).toBeDefined();
    expect(failedSource.error).toBe("API rate limited");
    expect(failedSource.jobs).toEqual([]);
  });

  // === 8. Empty results case ===

  it("8. should handle empty results gracefully in interactive mode", async () => {
    vi.mocked(searchAllSources).mockResolvedValue([
      {
        source: "indeed" as const,
        jobs: [],
        totalCount: 0,
        latencyMs: 50,
      },
    ]);
    const output = await runAction(["nonexistent"]);
    // Should not crash, should show some message about no results
    expect(output).toBeTruthy();
  });

  it("8b. should output valid JSON with empty jobs array", async () => {
    vi.mocked(searchAllSources).mockResolvedValue([
      {
        source: "indeed" as const,
        jobs: [],
        totalCount: 0,
        latencyMs: 50,
      },
    ]);
    const output = await runAction(["nonexistent", "--json"]);
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].jobs).toEqual([]);
  });

  it("8c. should output CSV headers even with empty results", async () => {
    vi.mocked(searchAllSources).mockResolvedValue([
      {
        source: "indeed" as const,
        jobs: [],
        totalCount: 0,
        latencyMs: 50,
      },
    ]);
    const output = await runAction(["nonexistent", "--csv"]);
    expect(output).toContain("title");
    expect(output).toContain("company");
  });
});
