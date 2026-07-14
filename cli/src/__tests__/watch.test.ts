import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Mocks must be established before any imports ────────────────────────────
vi.mock("@jobpulse/shared", () => ({
  searchAllSources: vi.fn(),
}));

// After mocks, we can import the modules under test
import { watchCommand } from "../commands/watch";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Run the watch command action by parsing args.
 * Captures both configureOutput (Commander) and console.log/error output.
 */
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

  watchCommand.configureOutput({
    writeOut: (str: string) => {
      lines.push(str);
    },
    writeErr: (str: string) => {
      lines.push(str);
    },
  });
  watchCommand.exitOverride();

  try {
    await watchCommand.parseAsync(args, { from: "user" });
  } catch (err) {
    lines.push(String(err));
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  return lines.join("");
}

/**
 * Get the config file path used by the module
 */
function getConfigPath(): string {
  return path.join(os.homedir(), ".jobpulse", "config.json");
}

/**
 * Delete config directory for clean test state
 */
function cleanConfig(): void {
  const p = getConfigPath();
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore
  }
  try {
    fs.rmdirSync(path.dirname(p));
  } catch {
    // ignore
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("watch command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanConfig();
  });

  afterEach(() => {
    cleanConfig();
  });

  // === 1. watch add <query> saves a watch ===

  it("1. should save a watch when adding with a query", async () => {
    const output = await runAction(["add", "software engineer"]);
    // Should print success message
    expect(output).toContain("Watch added");
    // Config file should exist with the watch
    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.watches).toBeDefined();
    expect(config.watches).toHaveLength(1);
    expect(config.watches[0].keyword).toBe("software engineer");
    expect(config.watches[0].active).toBe(true);
    expect(config.watches[0].id).toBe(1);
    expect(config.watches[0].sources).toEqual(["linkedin", "indeed", "greenhouse", "lever"]);
    expect(config.watches[0].intervalMinutes).toBe(30);
    expect(config.watches[0].createdAt).toBeDefined();
  });

  it("1b. should save consecutive watches with incrementing IDs", async () => {
    await runAction(["add", "engineer"]);
    await runAction(["add", "designer"]);
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config.watches).toHaveLength(2);
    expect(config.watches[0].id).toBe(1);
    expect(config.watches[0].keyword).toBe("engineer");
    expect(config.watches[1].id).toBe(2);
    expect(config.watches[1].keyword).toBe("designer");
  });

  it("1c. should apply optional flags when adding a watch", async () => {
    await runAction([
      "add", "react developer",
      "--location", "Remote",
      "--type", "fulltime",
      "--salary", "100000",
      "--sources", "linkedin,greenhouse",
      "--interval", "60",
    ]);
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config.watches).toHaveLength(1);
    expect(config.watches[0].keyword).toBe("react developer");
    expect(config.watches[0].location).toBe("Remote");
    expect(config.watches[0].jobType).toBe("fulltime");
    expect(config.watches[0].minSalary).toBe(100000);
    expect(config.watches[0].sources).toEqual(["linkedin", "greenhouse"]);
    expect(config.watches[0].intervalMinutes).toBe(60);
  });

  // === 2. watch add --dry-run does NOT save ===

  it("2. should NOT save a watch when --dry-run flag is used", async () => {
    const output = await runAction(["add", "software engineer", "--dry-run"]);
    // Should show preview
    expect(output).toContain("DRY RUN");
    expect(output).toContain("software engineer");
    // Config file should NOT exist
    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("2b. should show preview details with --dry-run", async () => {
    const output = await runAction([
      "add", "data scientist",
      "--location", "New York",
      "--type", "fulltime",
      "--salary", "120000",
      "--sources", "linkedin,indeed,greenhouse,lever",
      "--interval", "60",
      "--dry-run",
    ]);
    expect(output).toContain("DRY RUN");
    expect(output).toContain("data scientist");
    expect(output).toContain("New York");
    expect(output).toContain("fulltime");
    // Salary is formatted with $ and comma separators
    expect(output).toContain("$120,000");
    expect(output).toContain("linkedin");
    expect(output).toContain("60");
  });

  // === 3. watch list shows saved watches ===

  it("3. should display saved watches in a table", async () => {
    // Add a watch first
    await runAction(["add", "backend developer", "--location", "San Francisco"]);
    const output = await runAction(["list"]);
    // Should show the watch details
    expect(output).toContain("backend developer");
    expect(output).toContain("San Francisco");
    expect(output).toContain("1"); // id
  });

  it("3b. should show empty message when no watches exist", async () => {
    const output = await runAction(["list"]);
    expect(output).toContain("No watches");
  });

  // === 4. watch remove <id> removes a watch ===

  it("4. should remove a watch by ID", async () => {
    await runAction(["add", "rust developer"]);
    const output = await runAction(["remove", "1"]);
    expect(output).toContain("removed");
    // Config should have no watches
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config.watches).toHaveLength(0);
  });

  it("4b. should remove only the specified watch (not others)", async () => {
    await runAction(["add", "frontend"]);
    await runAction(["add", "backend"]);
    await runAction(["add", "fullstack"]);
    await runAction(["remove", "2"]);
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config.watches).toHaveLength(2);
    expect(config.watches[0].keyword).toBe("frontend");
    expect(config.watches[0].id).toBe(1);
    expect(config.watches[1].keyword).toBe("fullstack");
    expect(config.watches[1].id).toBe(3);
  });

  it("4c. should show error for invalid watch ID", async () => {
    const output = await runAction(["remove", "99"]);
    expect(output).toContain("not found");
  });

  // === 5. watch with no subcommand shows help ===

  it("5. should show help when no subcommand is given", async () => {
    const output = await runAction([]);
    // Should show usage or help text
    expect(output).toContain("Usage");
    expect(output).toContain("add");
    expect(output).toContain("list");
    expect(output).toContain("remove");
  });

  // === 6. Error handling ===

  it("6. should show error when no query is provided for add", async () => {
    const output = await runAction(["add"]);
    // Commander outputs error about missing required argument
    // It may throw CommanderError after writing the error message
    const hasErrorOutput = output.includes("missing required argument") || output.includes("query") || output.includes("process.exit");
    expect(hasErrorOutput).toBe(true);
  });

  it("6b. should show error for invalid subcommand", async () => {
    const output = await runAction(["invalid"]);
    const hasErrorOutput = output.includes("error") || output.includes("invalid") || output.includes("add") || output.includes("list");
    expect(hasErrorOutput).toBe(true);
  });
});
