# BloxBot

Build Roblox games by describing what you want.

**[Download](https://github.com/Skithrills/app-bloxbot-ai/releases/latest)** | **[Website](https://bloxbot.ai)**

BloxBot is a free, open-source desktop app that connects AI models to Roblox Studio. It can read your place, write scripts, build UI and change objects while you watch. It uses [Studio's official MCP server](https://create.roblox.com/docs/studio/mcp), so there's no plugin to install.

## Why BloxBot

Roblox Studio can work with AI tools, but getting there usually means setting up a coding agent, config files and API keys. BloxBot does that for you: install it, turn on one setting in Studio, and start building. Free models work out of the box, and because it's open source, you can see exactly what it does in your place.

## Features

- **Any model:** free models, your own API key, or OAuth. You can also use your Claude plan through your own Claude Code login, at your own risk.
- **Explorer:** browse even very large places, edit properties, attributes and tags by hand, and drag any object into your message.
- **Instructions:** tell BloxBot what to keep in mind in every chat.
- **Notifications:** get a ping when a chat finishes or needs you, while you work in Studio.

## Get started

1. [Download BloxBot](https://github.com/Skithrills/app-bloxbot-ai/releases/latest) for macOS (Apple Silicon), Windows or Debian/Ubuntu.
2. Open a place in Roblox Studio.
3. In Studio, open **Assistant** settings (three-dot menu) → **MCP Servers** and turn on **Studio as MCP server**.
4. Open BloxBot and start building. Add your own models any time in Settings → Providers.

On Windows, SmartScreen may warn about a new release. Click "More info", then "Run anyway".

### Instance references in chat

Instance chips retain a full Studio path and, for new references, the recorded class. This keeps the icon available after reopening the chat without Studio running. Older untyped references need one confirmed lookup in their original place before their class can be remembered; names alone are not enough to determine the type.

Click your sent chip to show its original markup, then click again to restore the chip. In model replies, the chip opens a currently resolved object in Explorer; the code button shows the raw reference. Unresolved references can still show their raw text. The model receives the path and class, not an opaque display ID.

## Updates for this fork

This fork checks published stable releases from [Skithrills/app-bloxbot-ai](https://github.com/Skithrills/app-bloxbot-ai/releases). Pushing commits does not publish an application update. After increasing the version and adding release notes, push the changes and run the **Release** workflow from `main`; see [the release guide](docs/RELEASING.md).

Install version 0.15.2 manually once if your older local build reports a missing `app-update.yml`. Later releases can be downloaded and installed through the app. Chats and settings keep the same application identity. The fork currently builds unsigned Windows installers.

## Contributing

Bug reports and pull requests are welcome. For anything big, [open an issue](https://github.com/Skithrills/app-bloxbot-ai/issues) first so we can talk it through.

You'll need [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/) 10+.

```sh
pnpm install
pnpm dev
```

Before opening a pull request, run `pnpm test`, `pnpm typecheck` and `pnpm lint`, and add anything users will notice to the [changelog](CHANGELOG.md).

### Test the fork locally

Run `pnpm dev`, then use these checks in the desktop window.

1. **Tool images.** Open an Edit place with Studio MCP enabled. Choose an image-capable model and ask it to take two captures, then embed the second in its reply. Hover the thumbnails on the collapsed activity row to preview them. Open one and use the arrow buttons or arrow keys to navigate. Check zoom, resolution, capture time, arguments, Copy Image, and Save PNG. Reopen the chat to check that the captures and reply embed are still there.
2. **Subagents.** In **Settings → Subagents**, choose a model for Planner. Ask the main agent to delegate a plan to Planner. Open the child chat from the task card, drag the drawer edge, and send a steering message or a follow-up. Use **Send Summary Back to Main Agent** once the child has replied.
3. **Explorer icons.** Open Explorer in a connected place. Compare the icons for a Folder, Part, and Script in both themes. To override an icon, put an SVG or PNG named for its class, such as `Part.svg`, in the Electron app's `userData/icons` folder and restart BloxBot.
4. **OpenAI profiles.** Under **Settings → Providers → OpenAI**, connect **ChatGPT Subscription** and **OpenAI API Key** separately. Check each connection from its own card and confirm both billing sources appear in the model picker. Choose **Ultrafast** for supported API models and verify that the picker labels those models accordingly.
5. **Free-model filter.** Choose a **Paid default model** in Providers, select a free model, then open the picker with `/model` and turn on **Hide free models**. The selection should switch to your paid default. Confirm free models are also absent from **Settings → Subagents**, and restart BloxBot to check that the preference persisted.

## Built on

[OpenCode](https://opencode.ai) runs the AI, and [Roblox Studio MCP](https://create.roblox.com/docs/studio/mcp) connects it to Studio.

## License

Based on [the original BloxBot](https://github.com/paralov/app-bloxbot-ai). Original copyright and [MIT license](LICENSE) are retained.
