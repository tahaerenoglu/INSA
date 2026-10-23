/** ModelClient on the Anthropic Messages API (streaming). */
import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient, ModelResponse } from "./agent.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export class AnthropicClient implements ModelClient {
  private client: Anthropic;
  constructor(apiKey: string, readonly model = DEFAULT_MODEL) { this.client = new Anthropic({ apiKey }); }

  async run(req: Parameters<ModelClient["run"]>[0], onText: (d: string) => void): Promise<ModelResponse> {
    const stream = this.client.messages.stream({
      model: this.model, max_tokens: req.maxTokens, system: req.system,
      messages: req.messages as any, tools: req.tools as any,
    }, { signal: req.signal });
    stream.on("text", (delta) => onText(delta));
    const msg = await stream.finalMessage();
    return { content: msg.content as any, stop_reason: msg.stop_reason };
  }
}
