import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";

// ─── All known sources and their required env vars ───────────────────────────

interface SourceInfo {
  name: string;
  envVar: string;
  label: string;
}

const ALL_SOURCES: SourceInfo[] = [
  { name: "linkedin", envVar: "LINKEDIN_ACCESS_TOKEN", label: "LinkedIn" },
  { name: "indeed", envVar: "INDEED_API_KEY", label: "Indeed" },
  { name: "greenhouse", envVar: "GREENHOUSE_BOARD_TOKENS", label: "Greenhouse" },
  { name: "lever", envVar: "LEVER_COMPANY_IDS", label: "Lever" },
  { name: "glassdoor", envVar: "GLASSDOOR_API_KEY", label: "Glassdoor" },
  { name: "workday", envVar: "WORKDAY_API_KEY", label: "Workday" },
  { name: "hn", envVar: "HN_API_KEY", label: "Hacker News" },
  { name: "remoteco", envVar: "REMOTECO_API_KEY", label: "Remote.co" },
];

// ─── Helper: check if a source is configured ─────────────────────────────────

function isConfigured(source: SourceInfo): boolean {
  return !!process.env[source.envVar];
}

function getStatusText(source: SourceInfo): string {
  return isConfigured(source)
    ? chalk.green("✓ configured")
    : chalk.yellow("⚠ needs setup");
}

// ─── Helper: get JOBPULSE_* env var config value ─────────────────────────────

function getConfigValue(key: string): string | undefined {
  // Check JOBPULSE_* env vars first
  const envVar = `JOBPULSE_${key.toUpperCase()}`;
  if (process.env[envVar]) {
    return process.env[envVar];
  }
  return undefined;
}

// ─── Subcommand: list ─────────────────────────────────────────────────────────

const listCommand = new Command("list")
  .description("List all available job sources and their API status")
  .action(() => {
    const table = new Table({
      head: [
        chalk.bold("Source"),
        chalk.bold("Name"),
        chalk.bold("Status"),
        chalk.bold("API Key Env Var"),
      ],
      colWidths: [14, 20, 20, 30],
      wordWrap: true,
    });

    for (const source of ALL_SOURCES) {
      table.push([
        chalk.cyan(source.name),
        chalk.white(source.label),
        getStatusText(source),
        chalk.gray(source.envVar),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.gray("\nUse 'jobpulse sources test <name>' to check a specific source."));
  });

// ─── Subcommand: test ────────────────────────────────────────────────────────

const testCommand = new Command("test")
  .description("Test connectivity for a specific job source")
  .argument("<name>", "Source name (e.g., linkedin, indeed)")
  .action((name: string) => {
    const source = ALL_SOURCES.find((s) => s.name === name);

    if (!source) {
      console.error(chalk.red(`Unknown source: "${name}".`));
      console.log(chalk.yellow(`Valid sources: ${ALL_SOURCES.map((s) => s.name).join(", ")}`));
      return;
    }

    const configured = isConfigured(source);

    console.log(chalk.bold(`Source:    ${chalk.cyan(source.name)}`));
    console.log(chalk.bold(`Name:      ${chalk.white(source.label)}`));
    console.log(chalk.bold(`Env Var:   ${chalk.gray(source.envVar)}`));
    console.log(chalk.bold(`Status:    ${getStatusText(source)}`));
    console.log("");

    if (configured) {
      console.log(chalk.green(`✓ ${source.label} (${source.name}) is configured and ready to use.`));
      console.log(chalk.green(`  API key found in ${source.envVar} environment variable.`));
    } else {
      console.log(chalk.yellow(`⚠ ${source.label} (${source.name}) needs setup.`));
      console.log(chalk.yellow(`  Set the ${source.envVar} environment variable to configure this source.`));
    }
  });

// ─── Main command ────────────────────────────────────────────────────────────

export const sourcesCommand = new Command("sources")
  .description("Manage job sources and check API connectivity")
  .addCommand(listCommand)
  .addCommand(testCommand);

// Show help by default when no subcommand is given
sourcesCommand.action(() => {
  sourcesCommand.outputHelp();
});
