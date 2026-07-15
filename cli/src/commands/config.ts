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

/**
 * Get a config value, prioritizing config file over JOBPULSE_* env vars.
 */
function getConfigValue(key: string): { value: string; source: string } | null {
  // First check config file
  const config = readConfig();
  if (config[key] !== undefined) {
    return { value: config[key], source: "config file" };
  }

  // Then check JOBPULSE_* env var
  const envVar = `JOBPULSE_${key.toUpperCase().replace(/-/g, "_")}`;
  if (process.env[envVar]) {
    return { value: process.env[envVar]!, source: `env var ${envVar}` };
  }

  return null;
}

// ─── Subcommand: set ─────────────────────────────────────────────────────────

const setCommand = new Command("set")
  .description("Set a configuration value")
  .argument("<key>", "Configuration key")
  .argument("<value>", "Configuration value")
  .action((key: string, value: string) => {
    const config = readConfig();
    config[key] = value;
    writeConfig(config);

    console.log(chalk.green(`✓ Set ${chalk.cyan(key)} = ${chalk.white(value)}`));
  });

// ─── Subcommand: get ─────────────────────────────────────────────────────────

const getCommand = new Command("get")
  .description("Get a configuration value")
  .argument("<key>", "Configuration key")
  .action((key: string) => {
    const result = getConfigValue(key);

    if (!result) {
      console.error(chalk.yellow(`Key "${key}" not found.`));
      console.log(chalk.gray("Tip: Use 'jobpulse config set <key> <value>' to set it, or set env var JOBPULSE_" + key.toUpperCase().replace(/-/g, "_") + "."));
      return;
    }

    console.log(chalk.white(result.value));
    console.log(chalk.gray(`(from ${result.source})`));
  });

// ─── Main command ────────────────────────────────────────────────────────────

export const configCommand = new Command("config")
  .description("Manage CLI configuration")
  .addCommand(setCommand)
  .addCommand(getCommand);

// Show help by default when no subcommand is given
configCommand.action(() => {
  configCommand.outputHelp();
});
