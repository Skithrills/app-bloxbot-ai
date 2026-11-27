# Model catalog ownership

## Upstream review (2026-11-27)

- The [original BloxBot](https://github.com/paralov/app-bloxbot-ai) reads models from OpenCode's `model.list` API. Its [provider configuration](https://github.com/paralov/app-bloxbot-ai/blob/main/electron/opencodeConfig.ts) does not contain the fork's independent, hardcoded OpenAI API-key model list.
- Original BloxBot's [release workflow](https://github.com/paralov/app-bloxbot-ai/blob/main/.github/workflows/release.yml) is manually dispatched. A push is not an installed-app update.
- [OpenCode 2.2.7](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/models-dev.ts) has a bundled catalog as an offline/startup fallback, plus a live catalog fetch every five minutes. It uses `https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image` and publishes a refresh event when the data changes.
- OpenCode's [release workflow](https://github.com/anomalyco/opencode/blob/v2.2.7/.github/workflows/release.yml) fetches a shared catalog snapshot for each release build run. That supplements live discovery; it is not the only way to obtain newer models.
- This fork introduced an independent `openai-api` provider so API keys cannot accidentally inherit ChatGPT subscription routing. Preserve that credential and endpoint boundary when changing catalog discovery.

The public catalog describes supported models, not account entitlements. Appearance in the picker does not prove a particular account can run a model. Catalog checks must not send credentials or make billable inference requests.

## Fork implementation

`electron/openAiCatalog.ts` fetches public metadata at startup and every five minutes, with an eight-second timeout. Successful catalogs are cached in BloxBot's engine folder; failed fetches keep the last-good metadata. The bundled fallback includes GPT-6.2 Astra/Sol. No provider credentials are sent during catalog discovery.

Both OpenAI profiles receive the discovered model metadata. API-key requests keep their own credential and public Responses endpoint. Fast entries use the catalog's `priority` tier and prices; Ultrafast capability and date-dependent multipliers come from the catalog. Subscription entries retain zero displayed API cost, native routing, context caps, and disabled Pro policy.

Refreshes share the engine-settings write lock, write atomically, and skip unchanged provider data. Model/provider events invalidate the renderer's catalog; a periodic renderer refresh recovers missed events. Compatible new catalog entries can therefore appear without an app release. A future incompatible catalog schema or provider protocol change can still require a code update.

## Regression checklist

- A newly published catalog model appears under both connected OpenAI profiles without changing the app version.
- ChatGPT requests still use the native OAuth integration; API-key requests still use the public Responses endpoint.
- A timeout, invalid response, or offline launch retains a usable last-good catalog or bundled fallback.
- Rechecking identical data does not repeatedly rewrite configuration or interrupt active chats.
- Model settings, reasoning variants, service tiers and unrelated configuration survive refreshes.
- Test discovery independently of inference. Use disposable credentials and a local response-capture endpoint for routing tests, not a paid account.

Source changes need to be built and installed once. After that, catalog refreshes should not require another app release. Neither a local build nor a Git push publishes an update to installed copies.
