#!/usr/bin/env -S npx tsx
/** stdio entry point: `npm run mcp` (configure in Claude Desktop / Claude Code). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlatform, actorFromEnv, DEFAULT_PROJECT } from "./runtime.js";
import { buildServer } from "./server.js";
import { compatibleSchema } from "./schema-compat.js";
import { projectTypeFromState, hasInfrastructureModel } from "@insa/core";

class CodexCompatibleTransport extends StdioServerTransport {
  override async send(message: Parameters<StdioServerTransport["send"]>[0]): Promise<void> {
    if ("result" in message && Array.isArray(message.result.tools)) {
      message = { ...message, result: { ...message.result, tools: message.result.tools.map((tool: any) =>
        ({ ...tool, inputSchema: compatibleSchema(tool.inputSchema) })) } };
    }
    await super.send(message);
  }
}

const actor = actorFromEnv("INSA_ACTOR", { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] });
const platform=createPlatform();
const [bimState,infraState]=await Promise.all([platform.state<any>(DEFAULT_PROJECT,"bim").catch(()=>({})),platform.state<any>(DEFAULT_PROJECT,"infra").catch(()=>({}))]);
const selectedType=projectTypeFromState(bimState,hasInfrastructureModel(infraState));
const server = buildServer(platform, actor, selectedType);
await server.connect(new CodexCompatibleTransport());
console.error(`INSA manager MCP ready · actor ${actor.id} (${actor.roles.join(",")})`);
