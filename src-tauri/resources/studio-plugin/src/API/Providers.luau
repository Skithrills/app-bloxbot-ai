-- API/Providers.lua
-- Direct API wrappers for AI model providers (OpenAI, Anthropic, OpenCode)
-- Updated to support native tool/function calling.

local Http = require(script.Parent.Parent.Utils.Http)

local Providers = {}

-- ── Types ────────────────────────────────────────────────────────────────

export type ToolCall = {
	id: string?,
	name: string,
	arguments: {[string]: any},
}

export type ProviderResponse = {
	type: "text",
	content: string,
	reasoning: string?,
	finishReason: string?,
} | {
	type: "tool_calls",
	calls: {ToolCall},
	finishReason: string?,
}

-- ── OpenAI ───────────────────────────────────────────────────────────────

Providers.OPENAI = {
	name = "openai",
	displayName = "OpenAI",
	models = {"gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"},

	sendMessage = function(apiKey: string, model: string, messages: {{role: string, content: string}}, options: {baseUrl: string?, thinkingLevel: string?, tools: {{[string]: any}}?}?): (boolean, ProviderResponse | string?, string?)
		local body: any = {
			model = model,
			messages = messages,
			temperature = 0.7,
		}

		local thinkingLevel = options and options.thinkingLevel or "off"
		if thinkingLevel ~= "off" and (model:match("^o[13]") or model:match("^o4")) then
			body.reasoning_effort = thinkingLevel
			body.temperature = nil -- o-series does not support temperature
		end

		-- Add tools if provided
		local tools = options and options.tools
		if tools and #tools > 0 then
			body.tools = tools
			body.tool_choice = "auto"
		end

		local ok, data, status = Http.post(
			"https://api.openai.com/v1/chat/completions",
			body,
			{["Authorization"] = "Bearer " .. apiKey}
		)

		if not ok then
			return false, nil, data or "HTTP " .. (status or 0)
		end

		if data and data.error then
			return false, nil, tostring(data.error.message or data.error.type or "OpenAI API error")
		end

		if not data or not data.choices or not data.choices[1] or not data.choices[1].message then
			return false, nil, "Unexpected response from OpenAI"
		end

		local choice = data.choices[1]
		local message = choice.message
		local finishReason = choice.finish_reason or "stop"

		-- Check for tool calls
		if message.tool_calls and #message.tool_calls > 0 then
			local calls: {ToolCall} = {}
			for _, tc in ipairs(message.tool_calls) do
				local args = {}
				if tc["function"] and tc["function"].arguments then
					local parseOk, parsed = pcall(function()
						return game:GetService("HttpService"):JSONDecode(tc["function"].arguments)
					end)
					if parseOk then
						args = parsed
					end
				end
				table.insert(calls, {
					id = tc.id,
					name = tc["function"] and tc["function"].name or "unknown",
					arguments = args,
				})
			end
			return true, {
				type = "tool_calls",
				calls = calls,
				finishReason = finishReason,
			}, nil
		end

		-- Regular text response
		if message.content then
			local reasoning = nil
			if message.reasoning_content or message.reasoning then
				reasoning = message.reasoning_content or message.reasoning
			end
			return true, {
				type = "text",
				content = message.content,
				reasoning = reasoning,
				finishReason = finishReason,
			}, nil
		end

		return false, nil, "Unexpected response from OpenAI"
	end,

	fetchModels = function(apiKey: string): (boolean, {string}?, string?)
		local ok, data, status = Http.get(
			"https://api.openai.com/v1/models",
			{["Authorization"] = "Bearer " .. apiKey}
		)

		if not ok then
			return false, nil, data or "HTTP " .. (status or 0)
		end

		if data and data.error then
			return false, nil, tostring(data.error.message or data.error.type or "OpenAI API error")
		end

		if not data or not data.data then
			return false, nil, "Unexpected response from OpenAI"
		end

		local models = {}
		for _, m in ipairs(data.data) do
			if m.id and (
				m.id:match("^gpt%-") or
				m.id:match("^o1") or
				m.id:match("^o3") or
				m.id:match("^o4")
			) then
				table.insert(models, m.id)
			end
		end
		table.sort(models)

		if #models == 0 then
			return false, nil, "No chat models found"
		end

		return true, models, nil
	end,
}

-- ── Anthropic ────────────────────────────────────────────────────────────

Providers.ANTHROPIC = {
	name = "anthropic",
	displayName = "Anthropic",
	models = {"claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"},

	sendMessage = function(apiKey: string, model: string, messages: {{[string]: any}}, options: {baseUrl: string?, thinkingLevel: string?, tools: {{[string]: any}}?, system: string?}?): (boolean, ProviderResponse | string?, string?)
		local anthropicMessages = {}
		local systemPrompt = options and options.system or nil

		for _, msg in ipairs(messages) do
			if msg.role == "system" then
				if not systemPrompt then
					systemPrompt = (typeof(msg.content) == "string") and msg.content or tostring(msg.content)
				end
			elseif msg.role == "assistant" then
				local content: {any} = {}

				if msg.content and msg.content ~= "" then
					table.insert(content, {
						type = "text",
						text = (typeof(msg.content) == "string") and msg.content or tostring(msg.content),
					})
				end

				if msg.tool_calls then
					for _, tc in ipairs(msg.tool_calls) do
						local args = {}
						if tc["function"] and tc["function"].arguments then
							local parseOk, parsed = pcall(function()
								return game:GetService("HttpService"):JSONDecode(tc["function"].arguments)
							end)
							if parseOk then
								args = parsed
							end
						end
						table.insert(content, {
							type = "tool_use",
							id = tc.id,
							name = tc["function"] and tc["function"].name or tc.name or "unknown",
							input = args,
						})
					end
				end

				table.insert(anthropicMessages, {
					role = "assistant",
					content = content,
				})
			elseif msg.role == "tool" then
				table.insert(anthropicMessages, {
					role = "user",
					content = {
						{
							type = "tool_result",
							tool_use_id = msg.tool_call_id,
							content = (typeof(msg.content) == "string") and msg.content or tostring(msg.content),
						},
					},
				})
			else
				table.insert(anthropicMessages, {
					role = msg.role,
					content = (typeof(msg.content) == "string") and msg.content or tostring(msg.content),
				})
			end
		end

		local body: any = {
			model = model,
			max_tokens = 4096,
			messages = anthropicMessages,
		}

		if systemPrompt then
			body.system = systemPrompt
		end

		local thinkingLevel = options and options.thinkingLevel or "off"
		if thinkingLevel ~= "off" and (model:match("claude%-3%-7") or model:match("claude%-3%.7")) then
			local budget = thinkingLevel == "high" and 16000 or 4096
			body.thinking = {
				type = "enabled",
				budget_tokens = budget,
			}
			body.max_tokens = math.max(body.max_tokens, budget + 4096)
		end

		-- Add tools if provided
		local tools = options and options.tools
		if tools and #tools > 0 then
			body.tools = tools
		end

		local ok, data, status = Http.post(
			"https://api.anthropic.com/v1/messages",
			body,
			{
				["x-api-key"] = apiKey,
				["anthropic-version"] = "2023-06-01",
			}
		)

		if not ok then
			return false, nil, data or "HTTP " .. (status or 0)
		end

		if data and data.error then
			return false, nil, tostring(data.error.message or data.error.type or "Anthropic API error")
		end

		if not data or not data.content then
			return false, nil, "Unexpected response from Anthropic"
		end

		local finishReason = data.stop_reason or "stop"

		-- Parse content blocks
		local textParts = {}
		local reasoningParts = {}
		local toolCalls: {ToolCall} = {}

		for _, block in ipairs(data.content) do
			if block.type == "text" and block.text then
				table.insert(textParts, block.text)
			elseif block.type == "thinking" and block.thinking then
				table.insert(reasoningParts, block.thinking)
			elseif block.type == "tool_use" then
				table.insert(toolCalls, {
					id = block.id,
					name = block.name or "unknown",
					arguments = block.input or {},
				})
			end
		end

		if #toolCalls > 0 then
			return true, {
				type = "tool_calls",
				calls = toolCalls,
				finishReason = finishReason,
			}, nil
		end

		if #textParts > 0 then
			return true, {
				type = "text",
				content = table.concat(textParts, ""),
				reasoning = #reasoningParts > 0 and table.concat(reasoningParts, "\n") or nil,
				finishReason = finishReason,
			}, nil
		end

		return false, nil, "Unexpected response from Anthropic"
	end,

	fetchModels = function(apiKey: string): (boolean, {string}?, string?)
		return true, Providers.ANTHROPIC.models, nil
	end,
}

-- ── OpenCode ─────────────────────────────────────────────────────────────

Providers.OPENCODE = {
	name = "opencode",
	displayName = "OpenCode",
	models = {}, -- populated dynamically by plan

	-- Models by plan, from opencode.ai/docs
	zenModels = {
		-- Free models (no API key needed, IP-based rate limits)
		"big-pickle", "minimax-m2.5-free", "minimax-m2.1-free", "glm-4.7-free", "glm-5-free",
		"kimi-k2.5-free", "mimo-v2-pro-free", "mimo-v2-omni-free", "mimo-v2-flash-free",
		"nemotron-3-super-free", "ling-2.6-flash-free", "hy3-preview-free", "gpt-5-nano",
		-- Paid models
		"gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano",
		"gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2", "gpt-5.2-codex",
		"gpt-5.1", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini",
		"gpt-5", "gpt-5-codex",
		"claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1",
		"claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
		"claude-haiku-4-5", "claude-3-5-haiku",
		"gemini-3.1-pro", "gemini-3-flash",
		"qwen3.6-plus", "qwen3.5-plus",
		"minimax-m2.7", "minimax-m2.5", "glm-5.1", "glm-5",
		"kimi-k2.5", "kimi-k2.6",
	},

	goModels = {
		"glm-5.1", "glm-5",
		"kimi-k2.5", "kimi-k2.6",
		"mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5-pro", "mimo-v2.5",
		"minimax-m2.5", "minimax-m2.7",
		"qwen3.5-plus", "qwen3.6-plus",
		"deepseek-v4-pro", "deepseek-v4-flash",
	},

	getModelsForPlan = function(plan: string): {string}
		if plan == "go" then
			return Providers.OPENCODE.goModels
		end
		return Providers.OPENCODE.zenModels
	end,

	sendMessage = function(apiKey: string, model: string, messages: {{role: string, content: string}}, options: {baseUrl: string?, thinkingLevel: string?, tools: {{[string]: any}}?}?): (boolean, ProviderResponse | string?, string?)
		local baseUrl = options and options.baseUrl or ""
		if baseUrl == "" then
			return false, nil, "No base URL configured for OpenCode. Set it in Settings."
		end

		baseUrl = baseUrl:gsub("/$", "")

		if model == "" then
			return false, nil, "No model configured for OpenCode. Set it in Settings."
		end

		local body = {
			model = model,
			messages = messages,
			temperature = 0.7,
		}

		local thinkingLevel = options and options.thinkingLevel or "off"
		if thinkingLevel ~= "off" then
			if model:match("^o[13]") or model:match("^o4") or model:match("gpt%-5") then
				body.reasoning_effort = thinkingLevel
				body.temperature = nil
			elseif model:match("claude") then
				local budget = thinkingLevel == "high" and 16000 or 4096
				body.thinking = {
					type = "enabled",
					budget_tokens = budget,
				}
			end
		end

		-- Add tools if provided
		local tools = options and options.tools
		if tools and #tools > 0 then
			body.tools = tools
			body.tool_choice = "auto"
		end

		local ok, data, status = Http.post(
			baseUrl .. "/chat/completions",
			body,
			{["Authorization"] = "Bearer " .. apiKey}
		)

		if not ok then
			return false, nil, data or "HTTP " .. (status or 0)
		end

		if data and data.error then
			return false, nil, tostring(data.error.message or data.error.type or "OpenCode API error")
		end

		if not data or not data.choices or not data.choices[1] or not data.choices[1].message then
			return false, nil, "Unexpected response from OpenCode"
		end

		local choice = data.choices[1]
		local message = choice.message
		local finishReason = choice.finish_reason or "stop"

		-- Check for tool calls (OpenAI-compatible format)
		if message.tool_calls and #message.tool_calls > 0 then
			local calls: {ToolCall} = {}
			for _, tc in ipairs(message.tool_calls) do
				local args = {}
				if tc["function"] and tc["function"].arguments then
					local parseOk, parsed = pcall(function()
						return game:GetService("HttpService"):JSONDecode(tc["function"].arguments)
					end)
					if parseOk then
						args = parsed
					end
				end
				table.insert(calls, {
					id = tc.id,
					name = tc["function"] and tc["function"].name or "unknown",
					arguments = args,
				})
			end
			return true, {
				type = "tool_calls",
				calls = calls,
				finishReason = finishReason,
			}, nil
		end

		-- Regular text response
		if message.content then
			local reasoning = nil
			if message.reasoning_content or message.reasoning then
				reasoning = message.reasoning_content or message.reasoning
			end
			return true, {
				type = "text",
				content = message.content,
				reasoning = reasoning,
				finishReason = finishReason,
			}, nil
		end

		return false, nil, "Unexpected response from OpenCode"
	end,

	fetchModels = function(apiKey: string, baseUrl: string?, plan: string?): (boolean, {string}?, string?)
		local models = Providers.OPENCODE.getModelsForPlan(plan or "zen")
		return true, models, nil
	end,
}

-- ── Registry ─────────────────────────────────────────────────────────────

function Providers.getProvider(name: string)
	if name == "anthropic" then
		return Providers.ANTHROPIC
	elseif name == "opencode" then
		return Providers.OPENCODE
	end
	return Providers.OPENAI
end

function Providers.listProviderNames(): {string}
	return {"openai", "anthropic", "opencode"}
end

return Providers
