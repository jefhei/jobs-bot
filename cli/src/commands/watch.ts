import { Command } from "commander";

export const watchCommand = new Command("watch")
  .description("Watch for new jobs matching criteria")
  .action(() => {
    console.log("Watch command - not yet implemented");
  });
