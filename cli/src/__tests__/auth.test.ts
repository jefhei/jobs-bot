import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Mocks must be established before any imports ────────────────────────────
vi.mock("@jobpulse/shared", () => ({}));

// After mocks, we can import the modules under test
import { authCommand } from "../commands/auth";

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

  authCommand.configureOutput({
    writeOut: (str: string) => {
      lines.push(str);
    },
    writeErr: (str: string) => {
      lines.push(str);
    },
  });
  authCommand.exitOverride();

  try {
    await authCommand.parseAsync(args, { from: "user" });
  } catch (err) {
    lines.push(String(err));
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  return lines.join("");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("auth command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanConfig();
  });

  afterEach(() => {
    cleanConfig();
  });

  // === 1. auth login <api-key> stores API key in config file and shows confirmation ===

  it("1. should store API key in config file and show confirmation", async () => {
    const output = await runAction(["login", "sk-test-key-12345"]);

    // Should show confirmation with masked key (first 4 chars + ...)
    expect(output).toContain("sk-t");
    expect(output).toContain("...");
    expect(output).toContain("Authenticated");

    // Verify file was created with the key under auth.api_key
    const configPath = getConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config["auth.api_key"]).toBe("sk-test-key-12345");
  });

  // === 2. auth login without key shows error ===

  it("2. should show error when login is called without an API key", async () => {
    const output = await runAction(["login"]);

    // Commander should show error about missing required argument
    const hasError =
      output.toLowerCase().includes("error") ||
      output.toLowerCase().includes("missing") ||
      output.toLowerCase().includes("required") ||
      output.toLowerCase().includes("argument");
    expect(hasError).toBe(true);

    // Config file should NOT have been created
    expect(fs.existsSync(getConfigPath())).toBe(false);
  });

  // === 3. auth status shows "not authenticated" when no key stored ===

  it("3. should show not authenticated when no key is stored", async () => {
    const output = await runAction(["status"]);

    expect(output).toContain("Not authenticated");
    expect(output).toContain("login");
  });

  // === 4. auth status shows "authenticated" with masked key after login ===

  it("4. should show authenticated with masked key after login", async () => {
    // First login
    await runAction(["login", "sk-secret-99999"]);

    // Then check status
    const output = await runAction(["status"]);

    expect(output).toContain("Authenticated");
    expect(output).toContain("sk-s");
    expect(output).toContain("...");
  });

  // === 5. auth logout removes the API key from config file ===

  it("5. should remove the API key from config file on logout", async () => {
    // First login
    await runAction(["login", "sk-to-be-removed"]);

    // Verify key exists
    const configAfterLogin = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(configAfterLogin["auth.api_key"]).toBe("sk-to-be-removed");

    // Logout
    const output = await runAction(["logout"]);
    expect(output).toContain("Logged out");
    expect(output).toContain("cleared");

    // Verify key is removed
    const configAfterLogout = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(configAfterLogout["auth.api_key"]).toBeUndefined();
  });

  // === 6. auth logout works when already logged out (no error) ===

  it("6. should gracefully handle logout when already logged out", async () => {
    // No login before — config file doesn't exist
    const output = await runAction(["logout"]);

    // Should still show success message, no crash
    expect(output).toContain("Logged out");
    expect(output).toContain("cleared");
  });

  // === 7. auth with no subcommand shows help text ===

  it("7. should show help text when no subcommand is given", async () => {
    const output = await runAction([]);

    expect(output).toContain("Usage");
    expect(output).toContain("login");
    expect(output).toContain("status");
    expect(output).toContain("logout");
  });

  // === 8. auth login <key> overwrites existing key ===

  it("8. should overwrite existing API key on re-login", async () => {
    // First login
    await runAction(["login", "old-api-key"]);

    // Re-login with new key
    await runAction(["login", "new-api-key"]);

    // Verify new key is stored
    const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(config["auth.api_key"]).toBe("new-api-key");
    expect(config["auth.api_key"]).not.toBe("old-api-key");
  });
});
