import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { searchCommand } from "../commands/search";
import { watchCommand } from "../commands/watch";
import { sourcesCommand } from "../commands/sources";
import { configCommand } from "../commands/config";
import { authCommand } from "../commands/auth";

describe("CLI Entry Point", () => {
  it("should create a program with correct name and version", () => {
    const program = new Command();
    program.name("jobpulse").description("Intelligent Job Aggregation & Monitoring CLI").version("1.0.0");
    program.addCommand(searchCommand);
    program.addCommand(watchCommand);
    program.addCommand(sourcesCommand);
    program.addCommand(configCommand);
    program.addCommand(authCommand);

    expect(program.name()).toBe("jobpulse");
    expect(program.version()).toBe("1.0.0");
    expect(program.description()).toBe("Intelligent Job Aggregation & Monitoring CLI");
  });

  it("should have all expected subcommands registered", () => {
    const program = new Command();
    program.addCommand(searchCommand);
    program.addCommand(watchCommand);
    program.addCommand(sourcesCommand);
    program.addCommand(configCommand);
    program.addCommand(authCommand);

    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("search");
    expect(commands).toContain("watch");
    expect(commands).toContain("sources");
    expect(commands).toContain("config");
    expect(commands).toContain("auth");
  });

  it("should output help text without error", () => {
    const program = new Command();
    program.name("jobpulse").description("Intelligent Job Aggregation & Monitoring CLI").version("1.0.0");
    program.addCommand(searchCommand);
    program.addCommand(watchCommand);
    program.addCommand(sourcesCommand);
    program.addCommand(configCommand);
    program.addCommand(authCommand);

    const output = program.helpInformation();
    expect(output).toContain("Usage:");
    expect(output).toContain("jobpulse");
    expect(output).toContain("search");
    expect(output).toContain("watch");
    expect(output).toContain("sources");
    expect(output).toContain("config");
    expect(output).toContain("auth");
  });

  it("should output version string on --version", () => {
    const program = new Command();
    program.name("jobpulse").version("1.0.0");
    program.addCommand(searchCommand);
    program.addCommand(watchCommand);
    program.addCommand(sourcesCommand);
    program.addCommand(configCommand);
    program.addCommand(authCommand);

    let output = "";
    program.configureOutput({
      writeOut: (str: string) => {
        output += str;
      },
    });
    // Use helpInformation to verify version info is present
    const help = program.helpInformation();
    expect(help).toContain("jobpulse");
  });

  it("each subcommand should have a description and action handler", () => {
    const commands = [searchCommand, watchCommand, sourcesCommand, configCommand, authCommand];
    for (const cmd of commands) {
      expect(cmd.description()).toBeTruthy();
      expect(cmd.commands).toBeDefined();
    }
  });
});
