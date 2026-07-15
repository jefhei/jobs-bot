import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Mocks must be established before any imports ────────────────────────────
vi.mock("@jobpulse/shared", () => ({}));

// After mocks, we can import the modules under test
import { configCommand } from "../commands/config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getConfigPath(): string {
  return path.join(os.homedir(), ".jobpulse", "config.json");
}

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

  configCommand.configureOutput({
    writeOut: (str: string) => {
      lines.push(str);
    },
    writeErr: (str: string) => {
      lines.push(str);
    },
  });
  configCommand.exitOverride();

  try {
    await configCommand.parseAsync(args, { from: "user" });
  } catch (err) {
    lines.push(String(err));
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  return lines.join("");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("config command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanConfig();
  });

  afterEach(() => {
    cleanConfig();
  });

  // === 1. config set <key> <value> writes to config file ===

  it("1. should write a key-value pair to ~/.jobpulse/config.json", async () => {
    const output = await runAction(["set", "api-key", "sk-123456"]);
    expect(output).toContain("api-key");
    expect(output).toContain("sk-123456");

    // Verify file was created
    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config["api-key"]).toBe("sk-123456");
  });

  it("1b. should overwrite an existing key-value pair", async () => {
    await runAction(["set", "theme", "dark"]);
    await runAction(["set", "theme", "light"]);

    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config["theme"]).toBe("light");
  });

  it("1c. should store multiple key-value pairs", async () => {
    await runAction(["set", "key1", "value1"]);
    await runAction(["set", "key2", "value2"]);
    await runAction(["set", "key3", "value3"]);

    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config["key1"]).toBe("value1");
    expect(config["key2"]).toBe("value2");
    expect(config["key3"]).toBe("value3");
  });

  // === 2. config get <key> reads from config file ===

  it("2. should read and display a config value", async () => {
    await runAction(["set", "api-key", "sk-789"]);
    const output = await runAction(["get", "api-key"]);
    expect(output).toContain("sk-789");
  });

  it("2b. should show error when key does not exist", async () => {
    const output = await runAction(["get", "nonexistent-key"]);
    expect(output).toContain("not found");
  });

  it("2c. should show error when config file does not exist", async () => {
    const output = await runAction(["get", "anything"]);
    expect(output).toContain("not found");
  });

  // === 3. config with no subcommand shows help ===

  it("3. should show help text when no subcommand is given", async () => {
    const output = await runAction([]);
    expect(output).toContain("Usage");
    expect(output).toContain("set");
    expect(output).toContain("get");
  });

  // === 4. config set without enough args shows error ===

  it("4. should show error when 'set' is called without key and value", async () => {
    // Just 'set' with no args — Commander should show error
    const output = await runAction(["set"]);
    const hasError =
      output.toLowerCase().includes("error") ||
      output.toLowerCase().includes("missing") ||
      output.toLowerCase().includes("required") ||
      output.toLowerCase().includes("argument") ||
      output.toLowerCase().includes("key") ||
      output.toLowerCase().includes("value");
    expect(hasError).toBe(true);
  });

  // === 5. API keys can be read from JOBPULSE_* env vars ===

  it("5. should read from JOBPULSE_* env var when key matches", async () => {
    // Set a JOBPULSE_ env var
    const orig = process.env.JOBPULSE_API_KEY;
    process.env.JOBPULSE_API_KEY = "env-value-987";
    try {
      const output = await runAction(["get", "api-key"]);
      expect(output).toContain("env-value-987");
    } finally {
      if (orig === undefined) {
        delete process.env.JOBPULSE_API_KEY;
      } else {
        process.env.JOBPULSE_API_KEY = orig;
      }
    }
  });

  it("5b. config file value takes precedence over env var", async () => {
    const orig = process.env.JOBPULSE_THEME;
    process.env.JOBPULSE_THEME = "env-dark";
    try {
      await runAction(["set", "theme", "file-light"]);
      const output = await runAction(["get", "theme"]);
      // Config file value should be shown (not env var)
      expect(output).toContain("file-light");
      expect(output).not.toContain("env-dark");
    } finally {
      if (orig === undefined) {
        delete process.env.JOBPULSE_THEME;
      } else {
        process.env.JOBPULSE_THEME = orig;
      }
    }
  });
});
