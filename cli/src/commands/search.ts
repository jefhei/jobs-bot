import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { searchAllSources, type JobSource, type SearchOptions } from "@jobpulse/shared";

export const searchCommand = new Command("search")
  .description("Search all job sources")
  .argument("<query>", "search query / keywords")
  .option("-l, --location <location>", "location filter")
  .option(
    "-t, --type <type>",
    "job type filter (fulltime, parttime, contract, internship)"
  )
  .option("-s, --salary <salary>", "minimum salary filter", Number)
  .option("--sources <sources>", "comma-separated source list")
  .option("--json", "output as JSON")
  .option("--csv", "output as CSV")
  .action(async (query: string, options: Record<string, unknown>) => {
    // Respect NO_COLOR
    if (process.env.NO_COLOR) {
      // chalk.level = 0 is the proper way, but chalk also checks NO_COLOR itself
    }

    const searchOptions: SearchOptions = {};
    if (options.location) {
      searchOptions.location = options.location as string;
    }
    if (options.type) {
      searchOptions.jobType = options.type as string;
    }
    if (options.salary) {
      searchOptions.minSalary = options.salary as number;
    }

    let sources: JobSource[] | undefined;
    if (options.sources) {
      sources = (options.sources as string).split(",").map((s: string) => s.trim()) as JobSource[];
    }

    const isJson = options.json === true;
    const isCsv = options.csv === true;

    try {
      const results = await searchAllSources(query, searchOptions, sources);

      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (isCsv) {
        const headers = ["title", "company", "location", "postedAt", "url", "source"];
        const escapedCsv = (val: unknown): string => {
          const str = String(val ?? "");
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };
        console.log(headers.join(","));
        for (const result of results) {
          for (const job of result.jobs) {
            const row = [
              escapedCsv(job.title),
              escapedCsv(job.company),
              escapedCsv(job.location ?? ""),
              escapedCsv(job.postedAt),
              escapedCsv(job.url),
              escapedCsv(job.source),
            ];
            console.log(row.join(","));
          }
        }
        return;
      }

      // Interactive mode: render table
      const allJobs = results.flatMap((r) => r.jobs);
      const failedSources = results.filter((r) => r.error);

      if (allJobs.length === 0 && failedSources.length === 0) {
        console.log(chalk.yellow("No jobs found matching your criteria."));
        return;
      }

      if (allJobs.length > 0) {
        const table = new Table({
          head: [
            chalk.bold("Title"),
            chalk.bold("Company"),
            chalk.bold("Location"),
            chalk.bold("Posted"),
            chalk.bold("Link"),
            chalk.bold("Source"),
          ],
          colWidths: [30, 20, 20, 12, 40, 12],
          wordWrap: true,
        });

        for (const job of allJobs) {
          const postedDate = job.postedAt
            ? new Date(job.postedAt).toLocaleDateString()
            : "N/A";
          table.push([
            chalk.cyan(job.title),
            chalk.green(job.company),
            job.location ?? "N/A",
            postedDate,
            chalk.blue(job.url),
            chalk.magenta(job.source),
          ]);
        }

        console.log(table.toString());
      }

      if (failedSources.length > 0) {
        console.log(chalk.red("\n⚠ Some sources failed:"));
        for (const fs of failedSources) {
          console.log(chalk.yellow(`  ${fs.source}: ${fs.error}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });
