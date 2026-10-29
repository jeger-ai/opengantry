import type { Command } from "commander";

export function registerMcpCommands(program: Command): void {
  program
    .command("mcp")
    .description("Model Context Protocol bridge for GXT workflows")
    .command("serve")
    .description("Start stdio MCP server exposing gxt_* tools")
    // Lazy-load: @modelcontextprotocol/sdk is optional for init/check/doctor paths.
    .action(async () => (await import("./commands/mcp-serve.js")).runMcpServe());
}
