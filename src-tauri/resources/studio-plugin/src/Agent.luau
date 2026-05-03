--!strict
-- ============================================================
-- Agent.luau | ModuleScript
-- Description: Agent loop that orchestrates LLM calls and tool
--              execution with iterative re-prompting.
-- ============================================================

local Registry = require(script.Parent.Tools.Registry)
local SettingsStore = require(script.Parent.Settings.SettingsStore)
local Config = require(script.Parent.Config)

-- Code-writing tools that trigger auto-lint
local CODE_WRITING_TOOLS = {
	studio_set_script_source = true,
	studio_apply_patch = true,
}

local HttpService = game:GetService("HttpService")

local Agent = {}

-- [ CONSTANTS ] ----------------------------------------------

local MAX_ITERATIONS = 30

-- [ CANCEL TOKEN ] -------------------------------------------
-- Shared table; set cancelRequested = true to abort Agent.run
local cancelToken = { cancelRequested = false }

-- [ FORWARD DECLARATIONS ] -----------------------------------

local extractTextFromResponse
local extractReasoningFromResponse
local extractToolCallsFromResponse

-- [ PRIVATE FUNCTIONS ] --------------------------------------

extractTextFromResponse = function(response: any): string?
	if typeof(response) == "string" then
		return response
	end
	if typeof(response) == "table" and response.type == "text" then
		local content = response.content
		if typeof(content) == "string" then return content end
		if content ~= nil then return tostring(content) end
		return nil
	end
	return nil
end

extractReasoningFromResponse = function(response: any): string?
	if typeof(response) == "table" and response.type == "text" then
		local reasoning = response.reasoning
		if typeof(reasoning) == "string" then return reasoning end
	end
	return nil
end

extractToolCallsFromResponse = function(response: any): {Registry.ToolCall}?
	if typeof(response) == "table" and response.type == "tool_calls" then
		return response.calls
	end
	return nil
end

-- [ PUBLIC FUNCTIONS ] ---------------------------------------

function Agent.getCancelToken(): {cancelRequested: boolean}
	return cancelToken
end

function Agent.requestCancel()
	cancelToken.cancelRequested = true
end

function Agent.resetCancel()
	cancelToken.cancelRequested = false
end

function Agent.run(
	session: any,
	userMessage: string,
	providerName: string,
	provider: any,
	apiKey: string,
	model: string,
	options: any,
	onUpdate: (update: {type: string, [string]: any}) -> ()
): {duration: number, toolCount: number}
	local startTime = DateTime.now().UnixTimestampMillis
	local toolCount = 0

	-- Append user message to session
	table.insert(session.messages, {
		role = "user",
		content = userMessage,
	})

	onUpdate({type = "user_message", content = userMessage})

	local tools = Registry.getSchemaList()
	local hasTools = #tools > 0

	-- Check if agent mode is enabled
	if not SettingsStore.getEnableAgentMode() then
		hasTools = false
	end

	for iteration = 1, MAX_ITERATIONS do
		-- Check for cancellation
		if cancelToken.cancelRequested then
			onUpdate({type = "error", message = "Request cancelled."})
			return {duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000, toolCount = toolCount}
		end

		-- Build API messages (strip non-standard fields like `reasoning`)
		local apiMessages = {}

		-- Include system prompt
		table.insert(apiMessages, {
			role = "system",
			content = Config.SYSTEM_PROMPT,
		})

		-- Add session messages — only include fields the API expects
		for _, msg in ipairs(session.messages) do
			local apiMsg: any = {
				role = msg.role,
			}
			-- Only include content if it exists and is non-empty
			-- (assistant tool_call messages have no content)
			if msg.content and msg.content ~= "" then
				apiMsg.content = (typeof(msg.content) == "string") and msg.content or tostring(msg.content)
			elseif msg.role == "user" or msg.role == "system" then
				-- User/system messages must have content
				local content = (typeof(msg.content) == "string") and msg.content or tostring(msg.content or "")
				apiMsg.content = content
			end
			if msg.tool_calls then
				apiMsg.tool_calls = msg.tool_calls
			end
			if msg.tool_call_id then
				apiMsg.tool_call_id = msg.tool_call_id
			end
			if msg.name then
				apiMsg.name = msg.name
			end
			-- Forward reasoning_content if present (required by some providers like Moonshot AI with thinking mode)
			if msg.reasoning_content then
				apiMsg.reasoning_content = msg.reasoning_content
			end
			table.insert(apiMessages, apiMsg)
		end

		-- Send to provider
		onUpdate({type = "status", message = "Thinking..."})

		local sendOptions: any = {}
		if options then
			for k, v in pairs(options) do
				sendOptions[k] = v
			end
		end

		if hasTools then
			sendOptions.tools = tools
		end

		local ok, response, err = provider.sendMessage(apiKey, model, apiMessages, sendOptions)

			if not ok then
				onUpdate({
					type = "error",
					message = err or "Provider request failed",
				})
				return {duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000, toolCount = toolCount}
			end

		-- Handle text response
		local text = extractTextFromResponse(response)
		if text then
			-- Emit reasoning if present
			local reasoning = extractReasoningFromResponse(response)
			if reasoning and reasoning ~= "" then
				onUpdate({type = "reasoning", content = reasoning})
			end

			onUpdate({type = "text_start"})

			-- Stream character by character (simulated)
			local charsPerTick = 3
			local delayPerTick = 0.015
			local i = 1
			while i <= text:len() do
			if cancelToken.cancelRequested then
				onUpdate({type = "error", message = "Request cancelled."})
				return {duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000, toolCount = toolCount}
			end
			local chunk = text:sub(i, i + charsPerTick - 1)
			onUpdate({type = "text_chunk", chunk = chunk})
			i += charsPerTick
			task.wait(delayPerTick)
		end

		onUpdate({type = "text_end"})

		-- Append assistant message to session (with reasoning if present)
		local assistantMessage: any = {
			role = "assistant",
			content = text,
		}
		if reasoning and reasoning ~= "" then
			assistantMessage.reasoning = reasoning
		end
		table.insert(session.messages, assistantMessage)

		local duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000
		return {duration = duration, toolCount = toolCount}
		end

		-- Handle tool calls
		local toolCalls = extractToolCallsFromResponse(response)
		if toolCalls and #toolCalls > 0 then
			onUpdate({
				type = "tool_calls",
				calls = toolCalls,
			})

			-- Store assistant's tool call message in session (OpenAI format)
			local toolCallEntries = {}
			for _, tc in ipairs(toolCalls) do
				local args = tc.arguments
				-- Providers require arguments to be a JSON object, not a list/array.
				-- If the model generated array-like arguments, wrap them.
				if typeof(args) == "table" then
					local isArray = false
					for k, _ in pairs(args) do
						if typeof(k) == "number" then
							isArray = true
							break
						end
					end
					if isArray then
						args = {items = args}
					end
				elseif typeof(args) ~= "table" then
					-- Non-table args also need to be an object
					args = {value = args}
				end

				table.insert(toolCallEntries, {
					id = tc.id or HttpService:GenerateGUID(false),
					type = "function",
					["function"] = {
						name = tc.name,
						arguments = HttpService:JSONEncode(args),
					},
				})
			end

			table.insert(session.messages, {
				role = "assistant",
				content = nil,
				tool_calls = toolCallEntries,
				-- Some providers (Moonshot AI with thinking mode) require reasoning_content on all assistant messages
				reasoning_content = "",
			})

			-- Execute each tool
			for _, tc in ipairs(toolCalls) do
				-- Check for cancellation between tool executions
				if cancelToken.cancelRequested then
					onUpdate({type = "error", message = "Request cancelled."})
					return {duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000, toolCount = toolCount}
				end

				toolCount += 1
				onUpdate({
					type = "tool_start",
					name = tc.name,
					arguments = tc.arguments,
				})

				local toolOk, toolResult = Registry.execute(tc.name, tc.arguments)

				onUpdate({
					type = "tool_end",
					name = tc.name,
					success = toolOk,
					result = toolResult,
				})

				-- Append tool result to session
				table.insert(session.messages, {
					role = "tool",
					tool_call_id = tc.id or "",
					name = tc.name,
					content = toolResult,
				})

				-- Auto-lint after code-writing tools
				if Config.AUTO_LINT_AFTER_CODE_EDIT and CODE_WRITING_TOOLS[tc.name] then
					local lintSource = tc.arguments and tc.arguments.source or tc.arguments and tc.arguments.newText or ""
					local lintPath = tc.arguments and tc.arguments.path or "script"

					if lintSource ~= "" then
						local lintOk, lintReport = Registry.execute("studio_lint_script", {
							code = lintSource,
							path = lintPath,
						})

						if not lintOk or not lintReport:find("No issues found") then
							-- Feed lint errors back as a tool result so the LLM can self-correct
							onUpdate({
								type = "tool_start",
								name = "studio_lint_script",
								arguments = { code = lintSource, path = lintPath },
							})

							onUpdate({
								type = "tool_end",
								name = "studio_lint_script",
								success = lintOk,
								result = lintReport,
							})

							table.insert(session.messages, {
								role = "tool",
								tool_call_id = HttpService:GenerateGUID(false),
								name = "studio_lint_script",
								content = lintReport,
							})
						end
					end
				end
			end

			-- Continue to next iteration to re-prompt LLM with results
			-- Luau doesn't have continue, so we just let the loop proceed
		else
		-- Unexpected response format
		onUpdate({
			type = "error",
			message = "Unexpected response format from provider",
		})
		return {duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000, toolCount = toolCount}
	end
end

	-- Max iterations reached
	if #session.messages > 0 then
		local lastMsg = session.messages[#session.messages]
		if lastMsg.role ~= "assistant" then
			onUpdate({
				type = "error",
				message = "Maximum tool iterations reached. The agent was unable to complete the task.",
			})
		end
	end

	local duration = (DateTime.now().UnixTimestampMillis - startTime) / 1000
	return {duration = duration, toolCount = toolCount}
end

return Agent
