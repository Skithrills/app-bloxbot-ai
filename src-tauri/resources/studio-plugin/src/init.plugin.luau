-- init.server.lua
-- BloxBot Studio Chat Plugin - Entry Point
-- Standalone chat panel that talks directly to AI providers (OpenAI, Anthropic)
-- Preserves Verde explorer bridge and McpBridge from previous versions

local HttpService = game:GetService("HttpService")

-- Verify HttpService is enabled.
-- JSONEncode works offline and will throw *only* if HttpService is disabled in Game Settings.
local httpEnabled = pcall(function()
	HttpService:JSONEncode({ test = true })
end)

local ChatPanel = require(script.Chat.ChatPanel)

-- Tool modules self-register with the Registry on require
local StudioToolsModule = require(script.Tools.StudioTools)
local WebSearchModule = require(script.Tools.WebSearch)
local LintToolsModule = require(script.Tools.LintTools)

-- ── Verde Bridge (preserved from v0.3.1) ─────────────────────────────────
local function initVerde(plugin)
	local verdeModule = script:FindFirstChild("Verde")
		and script.Verde:FindFirstChild("verde")
	if verdeModule and verdeModule:IsA("ModuleScript") then
		local ok, Verde = pcall(require, verdeModule)
		if ok and Verde and Verde.Init then
			Verde.Init(plugin)
			print("[BloxBot] Verde bridge initialized")
		end
	end
end

-- ── McpBridge (preserved from v0.3.1) ────────────────────────────────────
local function initMcpBridge(plugin)
	local mcpModule = script:FindFirstChild("McpBridge")
	if mcpModule and mcpModule:IsA("ModuleScript") then
		local ok, McpBridge = pcall(require, mcpModule)
		if ok and McpBridge and McpBridge.Init then
			McpBridge.Init(plugin)
			print("[BloxBot] McpBridge initialized")
		end
	end
end

-- ── Plugin Entry ─────────────────────────────────────────────────────────

local toolbar = plugin:CreateToolbar("BloxBot")
local button = toolbar:CreateButton(
	"BloxBotChat",
	"Open BloxBot Chat",
	"rbxassetid://72863917376096"
)
button.ClickableWhenViewportHidden = true

-- Initialize subsystems
initVerde(plugin)
initMcpBridge(plugin)

-- Initialize chat panel (passes httpEnabled so it can show a blocking dialog if false)
ChatPanel.init(plugin, httpEnabled)

-- Toggle visibility
button.Click:Connect(function()
	local widget = ChatPanel._widget
	if widget then
		widget.Enabled = not widget.Enabled
	end
end)

-- Cleanup on unload
plugin.Unloading:Connect(function()
	ChatPanel.cleanup()

	local mcpModule = script:FindFirstChild("McpBridge")
	if mcpModule then
		local ok, McpBridge = pcall(require, mcpModule)
		if ok and McpBridge and McpBridge.Stop then
			McpBridge.Stop()
		end
	end
end)

if httpEnabled then
	print("[BloxBot] Studio Chat Plugin v0.6.0 loaded (standalone)")
else
	warn("[BloxBot] Studio Chat Plugin loaded, but HttpService is disabled. Enable it in Game Settings → Security.")
end
