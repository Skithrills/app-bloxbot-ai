-- Context/StudioContext.lua
-- Gather live Roblox Studio context for message attachments

local Config = require(script.Parent.Parent.Config)

local StudioContext = {}
StudioContext._activeScript = nil
StudioContext._activeDocument = nil
StudioContext._onSelectionChanged = nil

-- ── ScriptEditorService tracking ─────────────────────────────────────────

local function _tryTrackDocument(document)
	if not document then return end
	local ok, script = pcall(function()
		return document:GetScript()
	end)
	if ok and script then
		StudioContext._activeScript = script
		StudioContext._activeDocument = document
	end
end

local scriptEditorService = game:FindService("ScriptEditorService")
if scriptEditorService then
	pcall(function()
		-- Track newly opened documents
		scriptEditorService.TextDocumentDidOpen:Connect(function(document)
			_tryTrackDocument(document)
		end)

		scriptEditorService.TextDocumentDidClose:Connect(function(document)
			if StudioContext._activeDocument == document then
				StudioContext._activeDocument = nil
			end
		end)

		-- Try to capture already-open documents (plugin may load after scripts are open)
		pcall(function()
			local docs = scriptEditorService:GetScriptDocuments()
			if docs and #docs > 0 then
				_tryTrackDocument(docs[#docs])
			end
		end)
	end)
end

function StudioContext.getActiveScript(): LuaSourceContainer?
	return StudioContext._activeScript
end

-- Read the current text selection from a ScriptDocument using modern APIs.
local function _readDocSelection(doc): {script: LuaSourceContainer, startLine: number, endLine: number, text: string}?
	local ok, script = pcall(function()
		return doc:GetScript()
	end)
	if not ok or not script then
		return nil
	end

	-- Modern API: HasSelectedText + GetSelectedText
	local hasSelOk, hasSelected = pcall(function()
		return doc:HasSelectedText()
	end)

	if not hasSelOk or not hasSelected then
		return nil
	end

	local textOk, selectedText = pcall(function()
		return doc:GetSelectedText()
	end)

	if not textOk or not selectedText or selectedText == "" then
		return nil
	end

	-- Try to get line range for display (ScriptName:10-25)
	-- Fall back gracefully if GetSelection() isn't available
	local startLine = 1
	local endLine = 1

	local selOk, sel = pcall(function()
		return doc:GetSelection()
	end)

	if selOk and sel and typeof(sel) == "table" then
		local sLine = sel.StartLine or sel.startLine or 0
		local eLine = sel.EndLine or sel.endLine or 0
		startLine = sLine + 1
		endLine = eLine + 1
		if startLine > endLine then
			startLine, endLine = endLine, startLine
		end
	else
		-- Estimate line count from text for display
		local textLines = selectedText:split("\n")
		endLine = startLine + math.max(0, #textLines - 1)
	end

	return {
		script = script,
		startLine = startLine,
		endLine = endLine,
		text = selectedText,
	}
end

-- Try to read the current text selection from the active ScriptDocument.
-- Falls back to scanning all open documents if the tracked document has no selection.
-- Returns {script, startLine, endLine, text} or nil if unsupported/no selection.
function StudioContext.getActiveEditorSelection(): {script: LuaSourceContainer, startLine: number, endLine: number, text: string}?
	-- 1. Try the tracked active document first
	if StudioContext._activeDocument then
		local result = _readDocSelection(StudioContext._activeDocument)
		if result then
			return result
		end
	end

	-- 2. Fall back to scanning all open documents
	local ses = game:FindService("ScriptEditorService")
	if not ses then
		return nil
	end

	local ok, docs = pcall(function()
		return ses:GetScriptDocuments()
	end)
	if not ok or not docs then
		return nil
	end

	for _, doc in ipairs(docs) do
		local result = _readDocSelection(doc)
		if result then
			-- Update tracked document for next time
			StudioContext._activeDocument = doc
			StudioContext._activeScript = result.script
			return result
		end
	end

	return nil
end

-- Returns true if the given script currently has an open editor document.
function StudioContext.isScriptOpenInEditor(script: LuaSourceContainer): boolean
	local ses = game:FindService("ScriptEditorService")
	if not ses then
		return false
	end

	local ok, docs = pcall(function()
		return ses:GetScriptDocuments()
	end)
	if not ok or not docs then
		return false
	end

	for _, doc in ipairs(docs) do
		local docOk, docScript = pcall(function()
			return doc:GetScript()
		end)
		if docOk and docScript == script then
			return true
		end
	end

	return false
end

-- Listen for editor selection changes and fire a callback.
-- Returns a disconnect function.
function StudioContext.listenEditorSelection(callback: (snippet: {script: LuaSourceContainer, startLine: number, endLine: number, text: string}?) -> ()): () -> ()
	local ses = game:FindService("ScriptEditorService")
	if not ses then
		return function() end
	end

	local connections = {}
	local docSelections: {[any]: any} = {}

	local function fireBestSnippet()
		local bestSnippet = nil
		for _, snippet in pairs(docSelections) do
			if snippet then
				bestSnippet = snippet
				break
			end
		end
		callback(bestSnippet)
	end

	local function onDocSelectionChanged(doc)
		local snippet = _readDocSelection(doc)
		docSelections[doc] = snippet
		fireBestSnippet()
	end

	local function onDocOpened(doc)
		local connOk, conn = pcall(function()
			return doc.SelectionChanged:Connect(function()
				onDocSelectionChanged(doc)
			end)
		end)
		if connOk and conn then
			table.insert(connections, conn)
			-- Initial read
			onDocSelectionChanged(doc)
		end
	end

	-- Existing docs
	local ok, docs = pcall(function()
		return ses:GetScriptDocuments()
	end)
	if ok and docs then
		for _, doc in ipairs(docs) do
			onDocOpened(doc)
		end
	end

	-- Future docs
	local openConnOk, openConn = pcall(function()
		return ses.TextDocumentDidOpen:Connect(onDocOpened)
	end)
	if openConnOk and openConn then
		table.insert(connections, openConn)
	end

	-- Doc closing: clear selection and re-evaluate
	local closeConnOk, closeConn = pcall(function()
		return ses.TextDocumentDidClose:Connect(function(doc)
			docSelections[doc] = nil
			fireBestSnippet()
		end)
	end)
	if closeConnOk and closeConn then
		table.insert(connections, closeConn)
	end

	return function()
		for _, conn in ipairs(connections) do
			pcall(function()
				conn:Disconnect()
			end)
		end
		table.clear(connections)
		table.clear(docSelections)
	end
end

-- ── Context builders ─────────────────────────────────────────────────────

function StudioContext.getSelection(): string
	local selection = game:GetService("Selection"):Get()
	if #selection == 0 then
		return ""
	end
	
	local lines = { "## Selected Instances" }
	for _, instance in ipairs(selection) do
		local path = StudioContext._getPath(instance)
		table.insert(lines, `- {instance.Name} ({instance.ClassName}) at {path}`)
	end
	
	return table.concat(lines, "\n")
end

function StudioContext.getScriptSources(): string
	local selection = game:GetService("Selection"):Get()
	local scripts = {}
	
	for _, instance in ipairs(selection) do
		if instance:IsA("LuaSourceContainer") then
			table.insert(scripts, instance)
		end
	end
	
	if #scripts == 0 then
		return ""
	end
	
	local lines = { "## Selected Scripts" }
	for _, src in ipairs(scripts) do
		local path = StudioContext._getPath(src)
		local source = src.Source or ""
		local sourceLines = source:split("\n")
		local totalLines = #sourceLines
		
		table.insert(lines, `### {src.Name} ({src.ClassName})`)
		table.insert(lines, `Path: {path}`)
		table.insert(lines, `Lines: {totalLines}`)
		table.insert(lines, "```lua")
		
		if totalLines <= Config.MAX_SCRIPT_TOTAL_LINES then
			for _, line in ipairs(sourceLines) do
				table.insert(lines, line)
			end
		else
			for i = 1, math.min(Config.MAX_SCRIPT_LINES, totalLines) do
				table.insert(lines, sourceLines[i])
			end
			table.insert(lines, `... ({totalLines - Config.MAX_SCRIPT_LINES} more lines)`)
		end
		
		table.insert(lines, "```")
	end
	
	return table.concat(lines, "\n")
end

function StudioContext.getPlaceStructure(): string
	local lines = { "## Place Structure" }
	local services = {
		"Workspace",
		"ServerScriptService",
		"ServerStorage",
		"ReplicatedStorage",
		"StarterGui",
		"StarterPlayer",
		"Lighting",
		"SoundService",
	}
	
	for _, serviceName in ipairs(services) do
		local service = game:GetService(serviceName)
		if service then
			table.insert(lines, `### {serviceName}`)
			local children = service:GetChildren()
			table.insert(lines, `Children: {#children}`)
			
			local count = 0
			for _, child in ipairs(children) do
				if count >= 20 then
					table.insert(lines, `... ({#children - 20} more)`)
					break
				end
				table.insert(lines, `- {child.Name} ({child.ClassName})`)
				count += 1
			end
		end
	end
	
	return table.concat(lines, "\n")
end

function StudioContext.getSnippetContext(snippets: {{script: LuaSourceContainer, startLine: number, endLine: number, text: string}}): string
	if #snippets == 0 then
		return ""
	end

	local lines = {"## Attached Code Snippets"}

	for _, snippet in ipairs(snippets) do
		if not snippet.script or not snippet.script.Parent then
			continue
		end

		local path = StudioContext._getPath(snippet.script)
		table.insert(lines, `### {snippet.script.Name} ({snippet.script.ClassName})`)
		table.insert(lines, `Path: {path}`)
		table.insert(lines, `Lines: {snippet.startLine}-{snippet.endLine}`)
		table.insert(lines, "```lua")

		local textLines = snippet.text:split("\n")
		for _, lineText in ipairs(textLines) do
			table.insert(lines, lineText)
		end

		table.insert(lines, "```")
	end

	return table.concat(lines, "\n")
end

function StudioContext.getAttachmentContext(attachments: {Instance}): string
	if #attachments == 0 then
		return ""
	end

	local lines = {"## Attached Instances"}

	for _, instance in ipairs(attachments) do
		if not instance or not instance.Parent then
			continue
		end

		local path = StudioContext._getPath(instance)

		if instance:IsA("LuaSourceContainer") then
			local source = instance.Source or ""
			local sourceLines = source:split("\n")
			local totalLines = #sourceLines

			table.insert(lines, `### {instance.Name} ({instance.ClassName})`)
			table.insert(lines, `Path: {path}`)
			table.insert(lines, `Lines: {totalLines}`)
			table.insert(lines, "```lua")

			if totalLines <= Config.MAX_SCRIPT_TOTAL_LINES then
				for _, line in ipairs(sourceLines) do
					table.insert(lines, line)
				end
			else
				for i = 1, math.min(Config.MAX_SCRIPT_LINES, totalLines) do
					table.insert(lines, sourceLines[i])
				end
				table.insert(lines, `... ({totalLines - Config.MAX_SCRIPT_LINES} more lines)`)
			end

			table.insert(lines, "```")
		else
			table.insert(lines, `- {instance.Name} ({instance.ClassName}) at {path}`)

			local props = {}
			if instance:IsA("BasePart") then
				table.insert(props, `Position: {tostring(instance.Position)}`)
				table.insert(props, `Size: {tostring(instance.Size)}`)
			elseif instance:IsA("ValueBase") then
				table.insert(props, `Value: {tostring(instance.Value)}`)
			elseif instance:IsA("Model") then
				table.insert(props, `Children: {#instance:GetChildren()}`)
			end

			if #props > 0 then
				table.insert(lines, `  Properties: {table.concat(props, ", ")}`)
			end
		end
	end

	return table.concat(lines, "\n")
end

function StudioContext._getPath(instance: Instance): string
	local parts = {}
	local current = instance
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return table.concat(parts, ".")
end

-- Insert code into the selected LuaSourceContainer, or create a new Script in ServerScriptService
function StudioContext.insertCode(code: string): string
	local selection = game:GetService("Selection"):Get()
	
	-- Find first LuaSourceContainer in selection
	local target = nil
	for _, instance in ipairs(selection) do
		if instance:IsA("LuaSourceContainer") then
			target = instance
			break
		end
	end
	
	if target then
		local current = target.Source or ""
		if current ~= "" and not current:match("%s$") then
			current = current .. "\n"
		end
		target.Source = current .. "\n" .. code
		return `Inserted into {target.Name}`
	else
		-- Create a new Script in ServerScriptService
		local sss = game:GetService("ServerScriptService")
		local newScript = Instance.new("Script")
		newScript.Name = "BloxBot_Generated"
		newScript.Source = code
		newScript.Parent = sss
		game:GetService("Selection"):Set({newScript})
		return "Created new Script in ServerScriptService"
	end
end

-- Execute Luau code in Studio and capture output.
-- Returns { success: boolean, output: string, error: string? }
function StudioContext.runCode(code: string): { success: boolean, output: string, error: string? }
	local outputLines = {}
	
	local function appendLine(prefix: string, ...)
		local parts = table.pack(...)
		local lineParts = {}
		for i = 1, parts.n do
			local val = parts[i]
			if typeof(val) == "Instance" then
				table.insert(lineParts, val:GetFullName())
			elseif typeof(val) == "table" then
				local ok, encoded = pcall(game:GetService("HttpService").JSONEncode, game:GetService("HttpService"), val)
				table.insert(lineParts, ok and encoded or tostring(val))
			else
				table.insert(lineParts, tostring(val))
			end
		end
		table.insert(outputLines, prefix .. " " .. table.concat(lineParts, "\t"))
	end
	
	local chunk, compileErr = loadstring(code)
	if not chunk then
		return {
			success = false,
			output = "",
			error = "Compile error: " .. tostring(compileErr),
		}
	end
	
	local env = getfenv(chunk)
	local oldPrint = env.print
	local oldWarn = env.warn
	local oldError = env.error
	
	env.print = function(...)
		appendLine("[PRINT]", ...)
		if oldPrint then oldPrint(...) end
	end
	env.warn = function(...)
		appendLine("[WARN]", ...)
		if oldWarn then oldWarn(...) end
	end
	env.error = function(...)
		appendLine("[ERROR]", ...)
		if oldError then oldError(...) end
	end
	
	local results = table.pack(pcall(chunk))
	local success = results[1]
	
	if success then
		-- Capture return values
		if results.n > 1 then
			local returnVals = {}
			for i = 2, results.n do
				table.insert(returnVals, tostring(results[i]))
			end
			if #returnVals > 0 then
				table.insert(outputLines, "[RETURN] " .. table.concat(returnVals, "\t"))
			end
		end
	else
		table.insert(outputLines, "[RUNTIME ERROR] " .. tostring(results[2]))
	end
	
	return {
		success = success,
		output = table.concat(outputLines, "\n"),
		error = not success and tostring(results[2]) or nil,
	}
end

return StudioContext
