import {
  OPENAI_API_KEY_ENV,
  type OpenAiServiceTier,
  supportsUltrafast,
} from "../src/lib/openAiProfiles";

const GPT6_EFFORTS = "low medium high xhigh max";
const GPT5_EFFORTS = "none low medium high xhigh";

// Public Responses chat models from OpenCode's models.dev catalog. Keep this provider
// independent: inheriting the live OpenAI catalog would also inherit its OAuth routing.
type CatalogEntry = [
  id: string,
  name: string,
  releaseDate: string,
  context: number,
  output: number,
  inputPrice: number,
  outputPrice: number,
  cacheReadPrice: number,
  reasoningEfforts: string,
];

const MODELS: CatalogEntry[] = [
  ["gpt-6.1-sol", "GPT-6.1 Sol", "2026-09-29", 1_050_000, 128_000, 2, 10, 0.1, GPT6_EFFORTS],
  ["gpt-6-astra", "GPT-6 Astra", "2026-09-04", 1_050_000, 128_000, 10, 50, 1, GPT6_EFFORTS],
  ["gpt-6.1-terra", "GPT-6.1 Terra", "2026-10-26", 1_050_000, 128_000, 1, 5, 0.05, `none ${GPT6_EFFORTS}`],
  ["gpt-6-luna", "GPT-6 Luna", "2026-09-22", 1_050_000, 128_000, 0.1, 0.5, 0.01, `none ${GPT6_EFFORTS}`],
  ["gpt-6-sol", "GPT-6 Sol", "2026-09-22", 1_050_000, 128_000, 2, 10, 0.2, `none ${GPT6_EFFORTS}`],
  ["gpt-5.6-sol", "GPT-5.6 Sol", "2026-07-09", 1_050_000, 128_000, 4, 20, 0.4, `none ${GPT6_EFFORTS}`],
  ["gpt-5.6-terra", "GPT-5.6 Terra", "2026-07-09", 1_050_000, 128_000, 2, 12, 0.2, `none ${GPT6_EFFORTS}`],
  ["gpt-5.6-luna", "GPT-5.6 Luna", "2026-07-09", 1_050_000, 128_000, 0.2, 1.2, 0.02, `none ${GPT6_EFFORTS}`],
  ["gpt-5.6", "GPT-5.6", "2026-07-09", 1_050_000, 128_000, 4, 20, 0.4, `none ${GPT6_EFFORTS}`],
  ["gpt-5.5", "GPT-5.5", "2026-04-23", 1_050_000, 128_000, 5, 30, 0.5, GPT5_EFFORTS],
  ["gpt-5.5-pro", "GPT-5.5 Pro", "2026-04-23", 1_050_000, 128_000, 30, 180, 0, "medium high xhigh"],
  ["gpt-5.4", "GPT-5.4", "2026-03-05", 1_050_000, 128_000, 2.5, 15, 0.25, GPT5_EFFORTS],
  ["gpt-5.4-mini", "GPT-5.4 mini", "2026-03-17", 400_000, 128_000, 0.75, 4.5, 0.075, GPT5_EFFORTS],
  ["gpt-5.4-nano", "GPT-5.4 nano", "2026-03-17", 400_000, 128_000, 0.2, 1.25, 0.02, GPT5_EFFORTS],
  ["gpt-5.4-pro", "GPT-5.4 Pro", "2026-03-05", 1_050_000, 128_000, 30, 180, 0, "medium high xhigh"],
  ["gpt-5.3-codex", "GPT-5.3 Codex", "2026-02-05", 400_000, 128_000, 1.75, 14, 0.175, GPT5_EFFORTS],
  ["gpt-5.2", "GPT-5.2", "2025-12-11", 400_000, 128_000, 1.75, 14, 0.175, GPT5_EFFORTS],
  ["gpt-5.2-pro", "GPT-5.2 Pro", "2025-12-11", 400_000, 128_000, 21, 168, 0, "medium high xhigh"],
  ["gpt-5.1", "GPT-5.1", "2025-11-13", 400_000, 128_000, 1.25, 10, 0.125, "none low medium high"],
  ["gpt-5", "GPT-5", "2025-08-07", 400_000, 128_000, 1.25, 10, 0.125, "minimal low medium high"],
  ["gpt-5-mini", "GPT-5 Mini", "2025-08-07", 400_000, 128_000, 0.25, 2, 0.025, "minimal low medium high"],
  ["gpt-5-nano", "GPT-5 Nano", "2025-08-07", 400_000, 128_000, 0.05, 0.4, 0.005, "minimal low medium high"],
  ["gpt-4.1", "GPT-4.1", "2025-04-14", 1_047_576, 32_768, 2, 8, 0.5, ""],
  ["gpt-4.1-mini", "GPT-4.1 mini", "2025-04-14", 1_047_576, 32_768, 0.4, 1.6, 0.1, ""],
  ["o3", "o3", "2025-04-16", 200_000, 100_000, 2, 8, 0.5, "low medium high"],
];

export function openAiApiProvider(serviceTier: OpenAiServiceTier) {
  return {
    name: "OpenAI API Key",
    env: [OPENAI_API_KEY_ENV],
    package: "@opencode/ai/providers/openai/responses",
    settings: { baseURL: "https://api.openai.com/v1", transport: "http" },
    models: Object.fromEntries(
      MODELS.map(([id, name, releaseDate, context, output, inputPrice, outputPrice, cacheReadPrice, efforts]) => {
        const tier = supportsUltrafast(id) ? serviceTier : undefined;
        const multiplier = tier === "ultrafast" ? 6 : 1;
        return [id, {
          name,
          releaseDate,
          limit: { context, output },
          capabilities: {
            tools: true,
            input: ["text", "image"],
            output: ["text"],
            ...(efforts && { reasoning: { supported: true, effort: efforts.split(" ") } }),
          },
          cost: {
            input: inputPrice * multiplier,
            output: outputPrice * multiplier,
            cache: { read: cacheReadPrice * multiplier },
          },
          ...(tier && { body: { service_tier: tier } }),
        }];
      }),
    ),
  };
}
