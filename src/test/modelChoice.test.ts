import { describe, expect, it } from "vitest";
import {
  compareCatalogModels,
  goneReason,
  isPaidModel,
  pickFreeModel,
  pickPaidModel,
  replacementModel,
} from "@/lib/modelChoice";
import type { ProviderListResponse } from "@/lib/opencode/types";

const model = (id: string, status = "active") => ({
  id,
  name: `${id} name`,
  status,
  capabilities: { toolcall: true, input: { text: true }, output: { text: true } },
});

/** OpenCode's free tier, with its default, plus a paid provider. */
function providers(): ProviderListResponse {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode Zen",
        source: "custom",
        models: {
          "big-pickle": model("big-pickle"),
          "crouton-alpha-free": model("crouton-alpha-free", "alpha"),
          "flash-free": model("flash-free"),
          "old-free": model("old-free", "deprecated"),
          "glm-free": model("glm-free"),
        },
      },
      {
        id: "anthropic",
        name: "Anthropic",
        source: "api",
        models: { sonnet: model("sonnet") },
      },
    ],
    connected: ["opencode", "anthropic"],
    default: { opencode: "flash-free", anthropic: "sonnet" },
  } as unknown as ProviderListResponse;
}

const none = new Set<string>();
const unrestricted = { hidden: none, unavailable: none, hideFreeModels: false };

describe("paid-only model choices", () => {
  it("keeps a connected paid account while excluding free Zen models even with a Zen key", () => {
    const list = providers();
    list.all[0].source = "api";
    expect(isPaidModel(list, "opencode/big-pickle")).toBe(false);
    expect(isPaidModel(list, "opencode/flash-free")).toBe(false);
    expect(isPaidModel(list, "anthropic/sonnet")).toBe(true);
    expect(
      pickPaidModel(list, {
        preferred: ["opencode/flash-free", "anthropic/sonnet"],
        unavailable: none,
        hidden: none,
      })?.key,
    ).toBe("anthropic/sonnet");
  });

  it("leaves the selection empty when there is no authenticated paid model", () => {
    const list = providers();
    list.connected = ["opencode"];
    expect(
      pickPaidModel(list, {
        preferred: ["anthropic/sonnet"],
        unavailable: none,
        hidden: none,
      }),
    ).toBeNull();
  });
});

describe("another free model", () => {
  it("prefers OpenCode's default free model over the rest", () => {
    expect(
      pickFreeModel(providers(), { avoid: ["opencode/big-pickle"], unavailable: none }),
    ).toEqual({ key: "opencode/flash-free", name: "flash-free name" });
  });

  it("skips the failed and selected models, refused, hidden and deprecated ones, then previews", () => {
    expect(
      pickFreeModel(providers(), {
        avoid: ["opencode/flash-free", "opencode/big-pickle"],
        unavailable: new Set(["opencode/glm-free"]),
      }),
    ).toEqual({ key: "opencode/crouton-alpha-free", name: "crouton-alpha-free name" });
    expect(
      pickFreeModel(providers(), {
        avoid: ["opencode/flash-free"],
        unavailable: none,
        hidden: new Set(["opencode/big-pickle"]),
      })?.key,
    ).toBe("opencode/glm-free");
  });

  it("offers nothing without the free tier, as a Zen key makes those models paid", () => {
    const list = providers();
    list.all[0].source = "api";
    expect(pickFreeModel(list, { avoid: [], unavailable: none })).toBeUndefined();
  });
});

describe("a saved model that's gone", () => {
  it("finds models OpenCode stopped listing, and ones refused in the region", () => {
    const refused = new Set(["opencode/crouton-alpha-free"]);
    expect(goneReason(providers(), "opencode/nemotron-3-ultra-free", none)).toBe("retired");
    expect(goneReason(providers(), "opencode/old-free", none)).toBe("retired");
    expect(goneReason(providers(), "opencode/crouton-alpha-free", refused)).toBe("region");
    expect(goneReason(providers(), "opencode/flash-free", refused)).toBeUndefined();
    // A provider that isn't listed is a disconnect, which is handled on its own.
    expect(goneReason(providers(), "openrouter/anything", none)).toBeUndefined();
  });

  it("moves to the provider's default, as OpenCode does with no model set", () => {
    expect(replacementModel(providers(), "opencode/space-bunny-free", unrestricted)).toEqual({
      key: "opencode/flash-free",
      name: "flash-free name",
    });
    expect(replacementModel(providers(), "anthropic/claude-2", unrestricted)?.key).toBe(
      "anthropic/sonnet",
    );
  });

  it("doesn't move a chat to a default OpenCode has marked as retiring", () => {
    const list = providers();
    list.default.opencode = "old-free";
    expect(replacementModel(list, "opencode/exo-free", unrestricted)?.key).toBe(
      "opencode/big-pickle",
    );
  });

  it("falls back to another free model when the default can't be used either", () => {
    expect(
      replacementModel(providers(), "opencode/exo-free", {
        ...unrestricted,
        unavailable: new Set(["opencode/flash-free"]),
      })?.key,
    ).toBe("opencode/big-pickle");
  });

  it("picks the newest eligible stable chat model on the same billing connection", () => {
    const list = providers();
    const zen = list.all[0];
    zen.source = "api";
    zen.models.paid = { ...zen.models["flash-free"], id: "paid", releasedAt: 600 };
    zen.models["crouton-alpha-free"].releasedAt = 500;
    zen.models["glm-free"].releasedAt = 300;
    zen.models["big-pickle"].releasedAt = 200;
    zen.models["flash-free"].releasedAt = 100;
    list.all[1].models.sonnet.releasedAt = 700;
    expect(replacementModel(list, "opencode/old-free", unrestricted)?.key).toBe(
      "opencode/glm-free",
    );
    expect(
      replacementModel(list, "opencode/old-free", {
        ...unrestricted,
        hidden: new Set(["opencode/glm-free"]),
      })?.key,
    ).toBe("opencode/big-pickle");
    expect(
      replacementModel(list, "opencode/old-free", {
        ...unrestricted,
        hideFreeModels: true,
        unavailable: new Set(["opencode/paid"]),
      }),
    ).toBeNull();
  });
});

it("orders the catalog by natural name or newest release, with undated models last", () => {
  const models = [
    { id: "10", name: "Model 10", releasedAt: 100 },
    { id: "3", name: "Model 3" },
    { id: "2", name: "Model 2", releasedAt: 100 },
    { id: "4", name: "Model 4", releasedAt: 200 },
  ];
  expect(
    [...models].sort((a, b) => compareCatalogModels(a, b, "name")).map(({ id }) => id),
  ).toEqual(["2", "3", "4", "10"]);
  expect(
    [...models].sort((a, b) => compareCatalogModels(a, b, "newest")).map(({ id }) => id),
  ).toEqual(["4", "2", "10", "3"]);
});
