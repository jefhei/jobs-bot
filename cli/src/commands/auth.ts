import { Command } from "commander";

export const authCommand = new Command("auth")
  .description("Manage authentication")
  .action(() => {
    console.log("Auth command - not yet implemented");
  });
