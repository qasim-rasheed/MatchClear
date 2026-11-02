import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { WorkspaceError } from "./workspace";
export const TEXT_MODEL = "nvidia/nemotron-3.5-super-vl:free";
export function textModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    throw new WorkspaceError(
      "Configure OPENROUTER_API_KEY in .env.local to enable the text helper.",
      503,
    );
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => ({
      ...body,
      provider: { require_parameters: true },
      reasoning: { enabled: false },
    }),
  }).chatModel(TEXT_MODEL);
}
