/** Synthetic public metadata: deliberately not a shipped/known model ID. */
export function catalogFixture(id = "gpt-6.2-catalog-test") {
  return {
    openai: {
      models: {
        [id]: {
          id,
          type: "chat",
          name: "New catalog model",
          release_date: "2026-11-17",
          modalities: { input: ["text", "image/png"], output: ["text"] },
          capabilities: {
            tools: { supported: true },
            reasoning: { supported: true, effort: ["low", "high"] },
            service_tier: ["priority", "ultrafast"],
          },
          limit: { context: 1_050_000, input: 922_000, output: 128_000 },
          cost: {
            text: { input: { price: 2, cache: { read: 0.1 } }, output: { price: 10 } },
            multipliers: [
              { when: { service_tier: { equals: "priority" } }, factor: { text: 2 } },
              {
                when: { service_tier: { equals: "ultrafast" }, date: { lt: "2027-03-01" } },
                factor: { text: 3 },
              },
              {
                when: { service_tier: { equals: "ultrafast" }, date: { gte: "2027-03-01" } },
                factor: { text: 6 },
              },
            ],
          },
          api: {
            responses: {
              base_url: "https://untrusted.example/ignored",
              sdk: { opencodeai: "untrusted-package" },
            },
          },
          experimental: {
            modes: {
              fast: { body: { service_tier: "priority" } },
              pro: { body: { reasoning: { mode: "pro" } } },
              ultrafast: { body: { service_tier: "ultrafast" } },
            },
          },
        },
      },
    },
  };
}
