import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGxtMcpTools } from "../lib/mcp-tools-register.js";

export async function runMcpServe(): Promise<void> {
  const server = new McpServer({
    name: "opengantry-gxt",
    version: "0.8.1",
  });

  registerGxtMcpTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
