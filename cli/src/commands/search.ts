import { Command } from "commander";

export const searchCommand = new Command("search")
  .description("Search all job sources")
  .action(() => {
    console.log("Search command - not yet implemented");
  });
