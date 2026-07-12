import { Command } from "commander";

export const sourcesCommand = new Command("sources")
  .description("Manage job sources")
  .action(() => {
    console.log("Sources command - not yet implemented");
  });
