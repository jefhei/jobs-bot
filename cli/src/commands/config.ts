import { Command } from "commander";

export const configCommand = new Command("config")
  .description("Manage CLI configuration")
  .action(() => {
    console.log("Config command - not yet implemented");
  });
