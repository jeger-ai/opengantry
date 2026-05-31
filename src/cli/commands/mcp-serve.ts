import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CLI_VERSION } from "../lib/constants.js";
import { registerGxtMcpTools } from "../lib/mcp-tools-register.js";

export async function runMcpServe(): Promise<void> {
  const server = new McpServer({
    name: "opengantry-gxt",
    version: CLI_VERSION,
  });

  registerGxtMcpTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
