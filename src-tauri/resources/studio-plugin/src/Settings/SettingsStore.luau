-- Settings/SettingsStore.lua
-- Persistent storage for API keys and provider configuration using plugin settings

local SettingsStore = {}
SettingsStore._plugin = nil

function SettingsStore.init(plugin: Plugin)
	SettingsStore._plugin = plugin
end

function SettingsStore.getProvider(): string
	return SettingsStore._plugin:GetSetting("BloxBot_Provider") or "opencode"
end

function SettingsStore.setProvider(provider: string)
	SettingsStore._plugin:SetSetting("BloxBot_Provider", provider)
end

function SettingsStore.getApiKey(provider: string): string?
	return SettingsStore._plugin:GetSetting("BloxBot_ApiKey_" .. provider)
end

function SettingsStore.setApiKey(provider: string, key: string)
	SettingsStore._plugin:SetSetting("BloxBot_ApiKey_" .. provider, key)
end

function SettingsStore.getModel(provider: string): string
	local defaults = {
		openai = "gpt-4o",
		anthropic = "claude-3-5-sonnet-20241022",
		opencode = "minimax-m2.5-free",
	}
	-- Check for custom model first
	local customModel = SettingsStore._plugin:GetSetting("BloxBot_CustomModel_" .. provider)
	if customModel and customModel ~= "" then
		return customModel
	end
	return SettingsStore._plugin:GetSetting("BloxBot_Model_" .. provider) or defaults[provider] or ""
end

function SettingsStore.setModel(provider: string, model: string)
	SettingsStore._plugin:SetSetting("BloxBot_Model_" .. provider, model)
end

function SettingsStore.getCustomModel(provider: string): string
	return SettingsStore._plugin:GetSetting("BloxBot_CustomModel_" .. provider) or ""
end

function SettingsStore.setCustomModel(provider: string, model: string)
	SettingsStore._plugin:SetSetting("BloxBot_CustomModel_" .. provider, model)
end

function SettingsStore.getBaseUrl(provider: string): string
	local defaults = {
		openai = "",
		anthropic = "",
		opencode = "https://opencode.ai/zen/v1",
	}
	return SettingsStore._plugin:GetSetting("BloxBot_BaseUrl_" .. provider) or defaults[provider] or ""
end

function SettingsStore.setBaseUrl(provider: string, url: string)
	SettingsStore._plugin:SetSetting("BloxBot_BaseUrl_" .. provider, url)
end

function SettingsStore.getOpencodePlan(): string
	return SettingsStore._plugin:GetSetting("BloxBot_OpencodePlan") or "zen"
end

function SettingsStore.setOpencodePlan(plan: string)
	SettingsStore._plugin:SetSetting("BloxBot_OpencodePlan", plan)
end

function SettingsStore.getFetchedModels(provider: string): {string}?
	return SettingsStore._plugin:GetSetting("BloxBot_FetchedModels_" .. provider)
end

function SettingsStore.setFetchedModels(provider: string, models: {string}?)
	SettingsStore._plugin:SetSetting("BloxBot_FetchedModels_" .. provider, models)
end

-- ── Permissions ──────────────────────────────────────────────────────────

function SettingsStore.getAllowCodeExecution(): boolean
	return SettingsStore._plugin:GetSetting("BloxBot_AllowCodeExecution") ~= false
end

function SettingsStore.setAllowCodeExecution(allowed: boolean)
	SettingsStore._plugin:SetSetting("BloxBot_AllowCodeExecution", allowed)
end

function SettingsStore.getRequireApproval(): boolean
	return SettingsStore._plugin:GetSetting("BloxBot_RequireApproval") ~= false
end

function SettingsStore.setRequireApproval(required: boolean)
	SettingsStore._plugin:SetSetting("BloxBot_RequireApproval", required)
end

-- ── Agent Mode ──────────────────────────────────────────────────────────

function SettingsStore.getEnableAgentMode(): boolean
	return SettingsStore._plugin:GetSetting("BloxBot_EnableAgentMode") == true
end

function SettingsStore.setEnableAgentMode(enabled: boolean)
	SettingsStore._plugin:SetSetting("BloxBot_EnableAgentMode", enabled)
end

function SettingsStore.getGeminiApiKey(): string?
	return SettingsStore._plugin:GetSetting("BloxBot_GeminiApiKey")
end

function SettingsStore.setGeminiApiKey(key: string)
	SettingsStore._plugin:SetSetting("BloxBot_GeminiApiKey", key)
end

function SettingsStore.getWebSearchProvider(): string
	return SettingsStore._plugin:GetSetting("BloxBot_WebSearchProvider") or "gemini"
end

function SettingsStore.setWebSearchProvider(provider: string)
	SettingsStore._plugin:SetSetting("BloxBot_WebSearchProvider", provider)
end

function SettingsStore.getMaxToolIterations(): number
	local val = SettingsStore._plugin:GetSetting("BloxBot_MaxToolIterations")
	if typeof(val) == "number" then
		return math.clamp(val, 1, 25)
	end
	return 10
end

function SettingsStore.setMaxToolIterations(iterations: number)
	SettingsStore._plugin:SetSetting("BloxBot_MaxToolIterations", math.clamp(iterations, 1, 25))
end

return SettingsStore
