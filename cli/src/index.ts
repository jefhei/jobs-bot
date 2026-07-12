#!/usr/bin/env node
import { Command } from "commander";
import { searchCommand } from "./commands/search";
import { watchCommand } from "./commands/watch";
import { sourcesCommand } from "./commands/sources";
import { configCommand } from "./commands/config";
import { authCommand } from "./commands/auth";

const program = new Command();

program
  .name("jobpulse")
  .description("Intelligent Job Aggregation & Monitoring CLI")
  .version("1.0.0");

program.addCommand(searchCommand);
program.addCommand(watchCommand);
program.addCommand(sourcesCommand);
program.addCommand(configCommand);
program.addCommand(authCommand);

program.parse(process.argv);
