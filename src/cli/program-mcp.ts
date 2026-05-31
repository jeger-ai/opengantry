import type { Command } from "commander";

export function registerMcpCommands(program: Command): void {
  const mcp = program.command("mcp").description("Model Context Protocol bridge for GXT workflows");

  mcp
    .command("serve")
    .description("Start stdio MCP server exposing gxt_* tools")
    .action(async () => {
      // Lazy-load: @modelcontextprotocol/sdk is optional for init/check/doctor paths.
      const { runMcpServe } = await import("./commands/mcp-serve.js");
      await runMcpServe();
    });
}
