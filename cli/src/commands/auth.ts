import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Config helpers ──────────────────────────────────────────────────────────

function getConfigDir(): string {
  return path.join(os.homedir(), ".jobpulse");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function readConfig(): Record<string, string> {
  const configPath = getConfigPath();
  try {
    const data = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, string>): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

function maskKey(key: string): string {
  if (key.length <= 4) return key + "...";
  return key.slice(0, 4) + "...";
}

// ─── Subcommand: login ───────────────────────────────────────────────────────

const loginCommand = new Command("login")
  .description("Authenticate CLI with the JobPulse backend using an API key")
  .argument("<api-key>", "Your JobPulse API key")
  .action((apiKey: string) => {
    const config = readConfig();
    config["auth.api_key"] = apiKey;
    writeConfig(config);

    const masked = maskKey(apiKey);
    console.log(chalk.green(`✓ Authenticated successfully`));
    console.log(chalk.gray(`  API key: ${chalk.white(masked)}`));
    console.log(chalk.gray(`  Stored in: ${getConfigPath()}`));
  });

// ─── Subcommand: status ──────────────────────────────────────────────────────

const statusCommand = new Command("status")
  .description("Show current authentication status")
  .action(() => {
    const config = readConfig();
    const apiKey = config["auth.api_key"];

    if (apiKey) {
      const masked = maskKey(apiKey);
      console.log(chalk.green(`✓ Authenticated`));
      console.log(chalk.gray(`  API key: ${chalk.white(masked)}`));
    } else {
      console.log(chalk.yellow(`⚠ Not authenticated`));
      console.log(chalk.gray(`  Use 'jobpulse auth login <api-key>' to authenticate.`));
    }
  });

// ─── Subcommand: logout ──────────────────────────────────────────────────────

const logoutCommand = new Command("logout")
  .description("Clear stored credentials and log out")
  .action(() => {
    const config = readConfig();
    delete config["auth.api_key"];
    writeConfig(config);

    console.log(chalk.green(`✓ Logged out`));
    console.log(chalk.gray(`  Credentials cleared from: ${getConfigPath()}`));
  });

// ─── Main command ────────────────────────────────────────────────────────────

export const authCommand = new Command("auth")
  .description("Authenticate CLI with the JobPulse backend")
  .addCommand(loginCommand)
  .addCommand(statusCommand)
  .addCommand(logoutCommand);

// Show help by default when no subcommand is given
authCommand.action(() => {
  authCommand.outputHelp();
});
