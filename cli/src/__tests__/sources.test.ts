import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks must be established before any imports ────────────────────────────

vi.mock("@jobpulse/shared", () => ({
  searchAllSources: vi.fn(),
}));

// After mocks, we can import the modules under test
import { sourcesCommand } from "../commands/sources";

// ─── All known sources and their env vars ────────────────────────────────────

const ALL_SOURCES = [
  { name: "linkedin", envVar: "LINKEDIN_ACCESS_TOKEN" },
  { name: "indeed", envVar: "INDEED_API_KEY" },
  { name: "greenhouse", envVar: "GREENHOUSE_BOARD_TOKENS" },
  { name: "lever", envVar: "LEVER_COMPANY_IDS" },
  { name: "glassdoor", envVar: "GLASSDOOR_API_KEY" },
  { name: "workday", envVar: "WORKDAY_API_KEY" },
  { name: "hn", envVar: "HN_API_KEY" },
  { name: "remoteco", envVar: "REMOTECO_API_KEY" },
];

// ─── Helper ──────────────────────────────────────────────────────────────────

async function runAction(args: string[]): Promise<string> {
  const lines: string[] = [];

  const origLog = console.log;
  const origError = console.error;
  console.log = (...msgs: unknown[]) => {
    lines.push(msgs.map(String).join(" "));
  };
  console.error = (...msgs: unknown[]) => {
    lines.push(msgs.map(String).join(" "));
  };

  sourcesCommand.configureOutput({
    writeOut: (str: string) => {
      lines.push(str);
    },
    writeErr: (str: string) => {
      lines.push(str);
    },
  });
  sourcesCommand.exitOverride();

  try {
    await sourcesCommand.parseAsync(args, { from: "user" });
  } catch (err) {
    lines.push(String(err));
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  return lines.join("");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("sources command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === 1. sources list shows all sources ===

  it("1. should list all 8 sources when running 'sources list'", async () => {
    const output = await runAction(["list"]);
    // All source names should appear
    expect(output).toContain("linkedin");
    expect(output).toContain("indeed");
    expect(output).toContain("greenhouse");
    expect(output).toContain("lever");
    expect(output).toContain("glassdoor");
    expect(output).toContain("workday");
    expect(output).toContain("hn");
    expect(output).toContain("remoteco");
  });

  it("1b. should show status indicators for each source", async () => {
    // Clear env vars that might affect this
    const relevantEnvVars = ALL_SOURCES.map((s) => s.envVar);
    const originals: Record<string, string | undefined> = {};
    for (const v of relevantEnvVars) {
      originals[v] = process.env[v];
      delete process.env[v];
    }

    try {
      const output = await runAction(["list"]);
      // All should show "needs setup" since we cleared all env vars
      const needsSetupCount = (output.match(/needs setup/g) || []).length;
      expect(needsSetupCount).toBeGreaterThanOrEqual(8);
    } finally {
      // Restore
      for (const [v, val] of Object.entries(originals)) {
        if (val !== undefined) {
          process.env[v] = val;
        } else {
          delete process.env[v];
        }
      }
    }
  });

  it("1c. should show 'configured' for a source whose env var is set", async () => {
    const orig = process.env.INDEED_API_KEY;
    process.env.INDEED_API_KEY = "test-key-123";
    try {
      const output = await runAction(["list"]);
      expect(output).toContain("indeed");
      expect(output).toContain("configured");
    } finally {
      if (orig === undefined) {
        delete process.env.INDEED_API_KEY;
      } else {
        process.env.INDEED_API_KEY = orig;
      }
    }
  });

  // === 2. sources with no subcommand shows help ===

  it("2. should show help text when no subcommand is given", async () => {
    const output = await runAction([]);
    expect(output).toContain("Usage");
    expect(output).toContain("list");
    expect(output).toContain("test");
  });

  // === 3. sources test <name> shows source status ===

  it("3. should report source status for a valid source name", async () => {
    const orig = process.env.INDEED_API_KEY;
    process.env.INDEED_API_KEY = "test-key";
    try {
      const output = await runAction(["test", "indeed"]);
      expect(output).toContain("indeed");
      expect(output).toContain("configured");
    } finally {
      if (orig === undefined) {
        delete process.env.INDEED_API_KEY;
      } else {
        process.env.INDEED_API_KEY = orig;
      }
    }
  });

  it("3b. should show 'needs setup' for a source without env var", async () => {
    const orig = process.env.GLASSDOOR_API_KEY;
    delete process.env.GLASSDOOR_API_KEY;
    try {
      const output = await runAction(["test", "glassdoor"]);
      expect(output).toContain("glassdoor");
      expect(output).toContain("needs setup");
    } finally {
      if (orig !== undefined) {
        process.env.GLASSDOOR_API_KEY = orig;
      }
    }
  });

  it("3c. should report error for unknown source name", async () => {
    const output = await runAction(["test", "unknown-source"]);
    expect(output).toContain("unknown");
    expect(output).toContain("unknown-source");
  });

  // === 4. sources test without name shows error ===

  it("4. should show error when 'test' is called without a source name", async () => {
    const output = await runAction(["test"]);
    // Commander outputs the error to stderr before throwing, so the output
    // line may contain the error. Let's check for the word "error" or "required"
    // in the only error line that Commander outputs.
    const hasError =
      output.toLowerCase().includes("error") ||
      output.toLowerCase().includes("missing") ||
      output.toLowerCase().includes("required") ||
      output.toLowerCase().includes("argument") ||
      output.toLowerCase().includes("name");
    expect(hasError).toBe(true);
  });
});
