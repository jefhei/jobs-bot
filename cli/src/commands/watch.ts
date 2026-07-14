import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WatchEntry {
  id: number;
  keyword: string;
  location?: string;
  jobType?: string;
  minSalary?: number;
  sources: string[];
  intervalMinutes: number;
  createdAt: string;
  active: boolean;
}

interface WatchConfig {
  watches: WatchEntry[];
}

// ─── Config helpers ──────────────────────────────────────────────────────────

function getConfigDir(): string {
  return path.join(os.homedir(), ".jobpulse");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function readConfig(): WatchConfig {
  const configPath = getConfigPath();
  try {
    const data = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(data);
    return { watches: parsed.watches ?? [] };
  } catch {
    return { watches: [] };
  }
}

function writeConfig(config: WatchConfig): void {
  const configDir = getConfigDir();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

function getNextId(watches: WatchEntry[]): number {
  if (watches.length === 0) return 1;
  return Math.max(...watches.map((w) => w.id)) + 1;
}

// ─── Default sources ─────────────────────────────────────────────────────────

const DEFAULT_SOURCES = ["linkedin", "indeed", "greenhouse", "lever"];

// ─── Command ─────────────────────────────────────────────────────────────────

export const watchCommand = new Command("watch")
  .description("Manage persistent job monitors")
  .helpOption("-h, --help", "Display help for watch command")
  .addHelpText(
    "after",
    `
Subcommands:
  add <query>           Register a new job monitor (use --dry-run to preview)
  list                  Show all active monitors
  remove <id>           Remove a monitor by ID

Examples:
  $ jobpulse watch add "software engineer" --location "Remote" --type fulltime
  $ jobpulse watch add "react developer" --dry-run
  $ jobpulse watch list
  $ jobpulse watch remove 1
`
  );

// ─── Subcommand: add ─────────────────────────────────────────────────────────

const addCommand = new Command("add")
  .description("Register a new monitor for job keywords")
  .argument("<query>", "search query / keywords to monitor")
  .option("-l, --location <location>", "location filter")
  .option("-t, --type <type>", "job type filter (fulltime, parttime, contract, internship)")
  .option("-s, --salary <salary>", "minimum salary filter", Number)
  .option("--sources <sources>", "comma-separated source list")
  .option("--interval <minutes>", "polling interval in minutes", Number)
  .option("--dry-run", "preview what would be monitored without saving")
  .action((query: string, options: Record<string, unknown>) => {
    const location = options.location as string | undefined;
    const jobType = options.type as string | undefined;
    const minSalary = options.salary as number | undefined;
    const intervalMinutes = (options.interval as number) ?? 30;
    const dryRun = options.dryRun === true;

    let sources: string[];
    if (options.sources) {
      sources = (options.sources as string).split(",").map((s: string) => s.trim());
    } else {
      sources = [...DEFAULT_SOURCES];
    }

    // Preview / Dry run
    if (dryRun) {
      console.log(chalk.yellow.bold("╔══════════════════════════════════════╗"));
      console.log(chalk.yellow.bold("║          DRY RUN — PREVIEW          ║"));
      console.log(chalk.yellow.bold("╚══════════════════════════════════════╝"));
      console.log("");
      console.log(`${chalk.bold("Keyword:")}       ${chalk.cyan(query)}`);
      console.log(`${chalk.bold("Location:")}       ${location ? chalk.green(location) : chalk.gray("(none)")}`);
      console.log(`${chalk.bold("Job Type:")}        ${jobType ? chalk.green(jobType) : chalk.gray("(none)")}`);
      console.log(`${chalk.bold("Min Salary:")}      ${minSalary ? chalk.green("$" + minSalary.toLocaleString()) : chalk.gray("(none)")}`);
      console.log(`${chalk.bold("Sources:")}         ${chalk.magenta(sources.join(", "))}`);
      console.log(`${chalk.bold("Interval:")}        ${chalk.blue(intervalMinutes + " min")}`);
      console.log("");
      console.log(chalk.yellow("(No watch was saved — use without --dry-run to register)"));
      return;
    }

    // Save to config
    const config = readConfig();
    const watch: WatchEntry = {
      id: getNextId(config.watches),
      keyword: query,
      location,
      jobType,
      minSalary,
      sources,
      intervalMinutes,
      createdAt: new Date().toISOString(),
      active: true,
    };
    config.watches.push(watch);
    writeConfig(config);

    console.log(chalk.green("✓ Watch added successfully!"));
    console.log("");
    console.log(`${chalk.bold("ID:")}            ${chalk.cyan(watch.id)}`);
    console.log(`${chalk.bold("Keyword:")}       ${chalk.cyan(query)}`);
    if (location) console.log(`${chalk.bold("Location:")}       ${chalk.green(location)}`);
    if (jobType) console.log(`${chalk.bold("Job Type:")}        ${chalk.green(jobType)}`);
    if (minSalary) console.log(`${chalk.bold("Min Salary:")}      ${chalk.green("$" + minSalary.toLocaleString())}`);
    console.log(`${chalk.bold("Sources:")}         ${chalk.magenta(sources.join(", "))}`);
    console.log(`${chalk.bold("Interval:")}        ${chalk.blue(intervalMinutes + " min")}`);
  });

// ─── Subcommand: list ────────────────────────────────────────────────────────

const listCommand = new Command("list")
  .description("Show all active monitors")
  .action(() => {
    const config = readConfig();

    if (config.watches.length === 0) {
      console.log(chalk.yellow("No watches configured. Use 'jobpulse watch add <query>' to create one."));
      return;
    }

    const table = new Table({
      head: [
        chalk.bold("ID"),
        chalk.bold("Keyword"),
        chalk.bold("Location"),
        chalk.bold("Type"),
        chalk.bold("Salary"),
        chalk.bold("Sources"),
        chalk.bold("Interval"),
        chalk.bold("Status"),
      ],
      colWidths: [6, 24, 20, 14, 14, 30, 10, 10],
      wordWrap: true,
    });

    for (const watch of config.watches) {
      table.push([
        chalk.cyan(String(watch.id)),
        chalk.white(watch.keyword),
        watch.location ?? chalk.gray("—"),
        watch.jobType ?? chalk.gray("—"),
        watch.minSalary ? chalk.green("$" + watch.minSalary.toLocaleString()) : chalk.gray("—"),
        chalk.magenta(watch.sources.join(", ")),
        chalk.blue(watch.intervalMinutes + "m"),
        watch.active ? chalk.green("active") : chalk.red("paused"),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.gray(`\nTotal: ${config.watches.length} watch(es)`));
  });

// ─── Subcommand: remove ──────────────────────────────────────────────────────

const removeCommand = new Command("remove")
  .description("Remove a monitor by ID")
  .argument("<id>", "ID of the watch to remove", Number)
  .action((id: number) => {
    const config = readConfig();
    const index = config.watches.findIndex((w) => w.id === id);

    if (index === -1) {
      console.error(chalk.red(`Watch with ID ${id} not found.`));
      return;
    }

    const removed = config.watches.splice(index, 1)[0];
    writeConfig(config);

    console.log(chalk.green(`✓ Watch "${removed.keyword}" (ID: ${removed.id}) removed.`));
  });

// ─── Register subcommands ────────────────────────────────────────────────────

watchCommand.addCommand(addCommand);
watchCommand.addCommand(listCommand);
watchCommand.addCommand(removeCommand);

// Show help by default
watchCommand.action(() => {
  watchCommand.outputHelp();
});
