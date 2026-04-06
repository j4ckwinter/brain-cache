import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { childLogger } from "../services/logger.js";
import { createMcpServer } from "./server.js";

const log = childLogger("mcp");

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("brain-cache MCP server running on stdio");
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${String(error)}\n`);
  process.exit(1);
});
