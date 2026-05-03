-- Chat/ChatPanel.lua
-- Main chat panel orchestrator: manages UI components, local sessions, and direct AI provider calls

local Theme = require(script.Parent.Parent.Theme)
local Config = require(script.Parent.Parent.Config)
local SettingsStore = require(script.Parent.Parent.Settings.SettingsStore)
local SettingsPanel = require(script.Parent.Parent.Settings.SettingsPanel)
local Providers = require(script.Parent.Parent.API.Providers)
local Agent = require(script.Parent.Parent.Agent)
local StudioContext = require(script.Parent.Parent.Context.StudioContext)
local MarkdownParser = require(script.Parent.Parent.Chat.Markdown.MarkdownParser)
local StatusBar = require(script.Parent.StatusBar)
local SessionList = require(script.Parent.SessionList)
local MessageList = require(script.Parent.MessageList)
local ChatInput = require(script.Parent.ChatInput)

local HttpService = game:GetService("HttpService")
local TextService = game:GetService("TextService")

local ChatPanel = {}
ChatPanel._widget = nil
ChatPanel._screenGui = nil
ChatPanel._activeSessionId = nil
ChatPanel._sessions = {}
ChatPanel._isBusy = false
ChatPanel._connectionState = "ready"
ChatPanel._cancelToken = Agent.getCancelToken()
ChatPanel._pendingReasoning = nil
ChatPanel._settingsPanel = nil
ChatPanel._contentFrame = nil
ChatPanel._chatFrame = nil
ChatPanel._sessionListVisible = true
ChatPanel._autoCollapsed = false
ChatPanel._resizeConnection = nil
ChatPanel._selectionConnection = nil
ChatPanel._editorSelectionDisconnect = nil
ChatPanel._docCloseConnection = nil
ChatPanel._sessionExecutionApproved = false -- per-session approval flag
ChatPanel._titleLabel = nil
ChatPanel._titleEditBox = nil
ChatPanel._messageQueue = {}

-- ── Initialization ───────────────────────────────────────────────────────

function ChatPanel.init(plugin: Plugin, httpEnabled: boolean)
	ChatPanel._plugin = plugin
	SettingsStore.init(plugin)

	local widgetInfo = DockWidgetPluginGuiInfo.new(
		Enum.InitialDockState.Right,
		false,
		false,
		320,
		500,
		250,
		300
	)

	local widget = plugin:CreateDockWidgetPluginGuiAsync(Config.WINDOW_ID, widgetInfo)
	widget.Title = Config.WINDOW_TITLE
	widget.Name = Config.WINDOW_ID

	ChatPanel._widget = widget

	-- Main layout (directly inside the DockWidgetPluginGui — no ScreenGui)
	local mainFrame = Instance.new("Frame")
	mainFrame.Name = "Main"
	mainFrame.Size = UDim2.new(1, 0, 1, 0)
	mainFrame.BackgroundColor3 = Theme.BgPrimary
	mainFrame.BorderSizePixel = 0
	mainFrame.Parent = widget

	-- ── HttpService disabled overlay ──────────────────────────────────────
	if not httpEnabled then
		ChatPanel._showHttpDisabledDialog(mainFrame)
		return
	end

	-- Status bar (top)
	local statusBar = StatusBar.create(mainFrame)
	statusBar.Position = UDim2.new(0, 0, 0, 0)

	-- Content area
	local contentFrame = Instance.new("Frame")
	contentFrame.Name = "Content"
	contentFrame.Size = UDim2.new(1, 0, 1, -24)
	contentFrame.Position = UDim2.new(0, 0, 0, 24)
	contentFrame.BackgroundTransparency = 1
	contentFrame.Parent = mainFrame

	-- Session sidebar
	local sessionList = SessionList.create(
		contentFrame,
		function(sessionId) ChatPanel._selectSession(sessionId) end,
		function() ChatPanel._createSession() end,
		function(sessionId) ChatPanel._deleteSession(sessionId) end
	)

	-- Chat area
	local chatFrame = Instance.new("Frame")
	chatFrame.Name = "ChatArea"
	chatFrame.Size = UDim2.new(1, -200, 1, 0)
	chatFrame.Position = UDim2.new(0, 200, 0, 0)
	chatFrame.BackgroundTransparency = 1
	chatFrame.Parent = contentFrame

	-- Chat title bar (editable session name)
	local titleBar = Instance.new("Frame")
	titleBar.Name = "TitleBar"
	titleBar.Size = UDim2.new(1, 0, 0, 32)
	titleBar.Position = UDim2.new(0, 0, 0, 0)
	titleBar.BackgroundTransparency = 1
	titleBar.Parent = chatFrame

	local titleLabel = Instance.new("TextLabel")
	titleLabel.Name = "TitleLabel"
	titleLabel.Size = UDim2.new(1, -24, 1, 0)
	titleLabel.Position = UDim2.new(0, 12, 0, 0)
	titleLabel.BackgroundTransparency = 1
	titleLabel.Text = "New Chat"
	titleLabel.TextColor3 = Theme.TextPrimary
	titleLabel.Font = Theme.FontBold
	titleLabel.TextSize = Theme.TextSizeRegular
	titleLabel.TextXAlignment = Enum.TextXAlignment.Left
	titleLabel.TextTruncate = Enum.TextTruncate.AtEnd
	titleLabel.Parent = titleBar
	ChatPanel._titleLabel = titleLabel

	local titleEditBox = Instance.new("TextBox")
	titleEditBox.Name = "TitleEdit"
	titleEditBox.Size = UDim2.new(1, -24, 1, 0)
	titleEditBox.Position = UDim2.new(0, 12, 0, 0)
	titleEditBox.BackgroundTransparency = 1
	titleEditBox.Text = "New Chat"
	titleEditBox.TextColor3 = Theme.TextPrimary
	titleEditBox.Font = Theme.FontBold
	titleEditBox.TextSize = Theme.TextSizeRegular
	titleEditBox.TextXAlignment = Enum.TextXAlignment.Left
	titleEditBox.ClearTextOnFocus = false
	titleEditBox.Visible = false
	titleEditBox.Parent = titleBar
	ChatPanel._titleEditBox = titleEditBox

	local titleUnderline = Instance.new("Frame")
	titleUnderline.Name = "Underline"
	titleUnderline.Size = UDim2.new(0, 0, 0, 1)
	titleUnderline.Position = UDim2.new(0, 12, 1, -1)
	titleUnderline.BackgroundColor3 = Theme.Accent
	titleUnderline.BorderSizePixel = 0
	titleUnderline.Visible = false
	titleUnderline.Parent = titleBar

	titleLabel.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			titleLabel.Visible = false
			titleEditBox.Visible = true
			titleUnderline.Visible = true
			titleEditBox.Text = titleLabel.Text
			titleEditBox:CaptureFocus()
		end
	end)

	local function finishEditing()
		titleLabel.Visible = true
		titleEditBox.Visible = false
		titleUnderline.Visible = false
		local newTitle = titleEditBox.Text:gsub("^%s+", ""):gsub("%s+$", "")
		if newTitle ~= "" and newTitle ~= titleLabel.Text then
			titleLabel.Text = newTitle
			local session = ChatPanel._findSession(ChatPanel._activeSessionId)
			if session then
				session.title = newTitle
				SessionList.setSessions(ChatPanel._sessions)
				ChatPanel._saveSessions()
			end
		end
	end

	titleEditBox.FocusLost:Connect(function()
		finishEditing()
	end)

	titleEditBox.Focused:Connect(function()
		local textBounds = TextService:GetTextSize(
			titleEditBox.Text,
			titleEditBox.TextSize,
			titleEditBox.Font,
			Vector2.new(1000, 32)
		)
		titleUnderline.Size = UDim2.new(0, math.min(textBounds.X, titleBar.AbsoluteSize.X - 24), 0, 1)
	end)

	-- Message list
	local messageList = MessageList.create(chatFrame)
	messageList.Size = UDim2.new(1, 0, 1, -132)
	messageList.Position = UDim2.new(0, 0, 0, 32)

	-- Greeting frame (shown when no session is active)
	local greetingFrame = Instance.new("Frame")
	greetingFrame.Name = "Greeting"
	greetingFrame.Size = UDim2.new(1, 0, 1, -132)
	greetingFrame.Position = UDim2.new(0, 0, 0, 32)
	greetingFrame.BackgroundTransparency = 1
	greetingFrame.Visible = false
	greetingFrame.Parent = chatFrame

	local greetingText = Instance.new("TextLabel")
	greetingText.Name = "GreetingText"
	greetingText.Size = UDim2.new(1, -40, 0, 60)
	greetingText.Position = UDim2.new(0, 20, 0.5, -30)
	greetingText.BackgroundTransparency = 1
	greetingText.Text = "Hello! What would you like to build?"
	greetingText.TextColor3 = Theme.TextPrimary
	greetingText.Font = Enum.Font.PatrickHand
	greetingText.TextSize = 30
	greetingText.TextXAlignment = Enum.TextXAlignment.Center
	greetingText.TextYAlignment = Enum.TextYAlignment.Center
	greetingText.TextWrapped = true
	greetingText.Parent = greetingFrame

	-- Chat input
	local chatInput = ChatInput.create(chatFrame, function(text, context, attachments, snippets)
		ChatPanel._sendMessage(text, context, attachments, snippets)
	end)
	chatInput.Size = UDim2.new(1, 0, 0, 100)
	chatInput.Position = UDim2.new(0, 0, 1, -100)

	ChatInput.setOnAttach(function()
		local selection = game:GetService("Selection"):Get()
		if #selection > 0 then
			for _, instance in ipairs(selection) do
				ChatInput.addAttachment(instance)
			end
		else
			-- Prefer code snippet from editor selection, then fall back to whole script
			local snippet = StudioContext.getActiveEditorSelection()
			if snippet then
				ChatInput.addSnippetAttachment(snippet)
			else
				local activeScript = StudioContext.getActiveScript()
				if activeScript then
					ChatInput.addAttachment(activeScript)
				end
			end
		end
	end)

	ChatInput.setOnAttachmentClick(function(instance: Instance)
		if instance:IsA("LuaSourceContainer") then
			pcall(function()
				game:GetService("ScriptEditorService"):OpenScript(instance)
			end)
		end
		game:GetService("Selection"):Set({instance})
	end)

	ChatInput.setOnSnippetClick(function(snippet)
		pcall(function()
			local ses = game:GetService("ScriptEditorService")
			ses:OpenScript(snippet.script)
			if StudioContext._activeDocument and StudioContext._activeDocument:GetScript() == snippet.script then
				StudioContext._activeDocument:SetSelectionAsync(
					snippet.startLine - 1, 0,
					snippet.endLine - 1, 0
				)
			end
		end)
		game:GetService("Selection"):Set({snippet.script})
	end)

	-- Auto-populate preview attachments from Studio selection
	ChatPanel._selectionConnection = game:GetService("Selection").SelectionChanged:Connect(function()
		local selection = game:GetService("Selection"):Get()
		ChatInput.setSelectionPreview(selection)
	end)

	-- Initialize preview with current selection
	ChatInput.setSelectionPreview(game:GetService("Selection"):Get())

	-- Listen for script editor text selection changes (event-driven, no polling)
	ChatPanel._editorSelectionDisconnect = StudioContext.listenEditorSelection(function(snippet)
		ChatInput.setSnippetPreview(snippet)
	end)

	-- Initial snippet check
	local initialSnippet = StudioContext.getActiveEditorSelection()
	if initialSnippet then
		ChatInput.setSnippetPreview(initialSnippet)
	end

	-- Clear confirmed snippets when their editor tab is closed
	local ses = game:FindService("ScriptEditorService")
	if ses then
		local closeOk, closeConn = pcall(function()
			return ses.TextDocumentDidClose:Connect(function(doc)
				local docScriptOk, docScript = pcall(function()
					return doc:GetScript()
				end)
				if docScriptOk and docScript then
					local confirmed = ChatInput.getSnippetAttachments()
					if confirmed[1] and confirmed[1].script == docScript then
						ChatInput.removeSnippetAttachment()
					end
				end
			end)
		end)
		if closeOk and closeConn then
			ChatPanel._docCloseConnection = closeConn
		end
	end

	ChatPanel._mainFrame = mainFrame
	ChatPanel._contentFrame = contentFrame
	ChatPanel._chatFrame = chatFrame
	ChatPanel._sessionList = sessionList
	ChatPanel._messageList = messageList
	ChatPanel._greetingFrame = greetingFrame
	ChatPanel._chatInput = chatInput
	ChatPanel._sessionListVisible = true
	ChatPanel._autoCollapsed = false

	-- Auto-collapse session list when window is narrow
	ChatPanel._resizeConnection = contentFrame:GetPropertyChangedSignal("AbsoluteSize"):Connect(function()
		ChatPanel._onContentResized()
	end)
	ChatPanel._onContentResized()

	-- Load sessions and update status
	ChatPanel._loadSessions()
	ChatPanel._updateStatus()

	-- Settings button callback
	StatusBar.setOnSettings(function()
		ChatPanel._toggleSettings()
	end)

	-- Toggle sessions button callback
	StatusBar.setOnToggleSessions(function()
		ChatPanel._toggleSessionList()
	end)

	-- Code block action handler (Insert + Run buttons)
	MarkdownParser.setCodeActionHandler(function(action: string, code: string)
		if action == "insert" then
			local result = StudioContext.insertCode(code)
			StatusBar.setStatus("ready", result)
		elseif action == "run" then
			local result = StudioContext.runCode(code)
			if result.success then
				if result.output ~= "" then
					StatusBar.setStatus("ready", "Executed. Output: " .. result.output:sub(1, 120))
					-- Add output as a system message in the chat for context
					ChatPanel._addMessageToUI({
						role = "assistant",
						content = "**Executed successfully**\n```\n" .. result.output .. "\n```",
					})
				else
					StatusBar.setStatus("ready", "Executed successfully")
				end
			else
				StatusBar.setStatus("error", "Execution failed: " .. (result.error or "Unknown error"))
				ChatPanel._addMessageToUI({
					role = "assistant",
					content = "**Execution failed**\n```\n" .. (result.error or "Unknown error") .. "\n```",
				})
			end
		end
	end)
end

function ChatPanel._showHttpDisabledDialog(parent: Instance)
	local overlay = Instance.new("Frame")
	overlay.Name = "HttpDisabledDialog"
	overlay.Size = UDim2.new(1, 0, 1, 0)
	overlay.BackgroundColor3 = Theme.BgPrimary
	overlay.BorderSizePixel = 0
	overlay.ZIndex = 100
	overlay.Parent = parent

	local icon = Instance.new("TextLabel")
	icon.Name = "Icon"
	icon.Size = UDim2.new(0, 48, 0, 48)
	icon.Position = UDim2.new(0.5, -24, 0, 60)
	icon.BackgroundTransparency = 1
	icon.Text = "🔒"
	icon.TextSize = 36
	icon.Font = Theme.FontRegular
	icon.TextColor3 = Theme.TextPrimary
	icon.Parent = overlay

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.new(1, -40, 0, 24)
	title.Position = UDim2.new(0, 20, 0, 120)
	title.BackgroundTransparency = 1
	title.Text = "HttpService is Disabled"
	title.TextColor3 = Theme.TextPrimary
	title.Font = Theme.FontBold
	title.TextSize = Theme.TextSizeLarge
	title.TextXAlignment = Enum.TextXAlignment.Center
	title.Parent = overlay

	local body = Instance.new("TextLabel")
	body.Name = "Body"
	body.Size = UDim2.new(1, -48, 0, 80)
	body.Position = UDim2.new(0, 24, 0, 152)
	body.BackgroundTransparency = 1
	body.Text = "BloxBot Chat needs HttpService to communicate with AI providers.\n\nEnable it in Game Settings → Security → Allow HTTP Requests."
	body.TextColor3 = Theme.TextSecondary
	body.Font = Theme.FontRegular
	body.TextSize = Theme.TextSizeRegular
	body.TextXAlignment = Enum.TextXAlignment.Center
	body.TextYAlignment = Enum.TextYAlignment.Top
	body.TextWrapped = true
	body.Parent = overlay

	local retryBtn = Instance.new("TextButton")
	retryBtn.Name = "RetryButton"
	retryBtn.Size = UDim2.new(0, 140, 0, 32)
	retryBtn.Position = UDim2.new(0.5, -70, 0, 250)
	retryBtn.BackgroundColor3 = Theme.Accent
	retryBtn.BorderSizePixel = 0
	retryBtn.Text = "Retry"
	retryBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
	retryBtn.Font = Theme.FontBold
	retryBtn.TextSize = Theme.TextSizeRegular
	retryBtn.AutoButtonColor = true
	retryBtn.Parent = overlay

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = retryBtn

	retryBtn.Activated:Connect(function()
		local nowEnabled = pcall(function()
			game:GetService("HttpService"):JSONEncode({ test = true })
		end)
		if nowEnabled then
			overlay:Destroy()
			ChatPanel.init(ChatPanel._plugin, true)
		else
			body.Text = "Still disabled. Please enable HttpService in Game Settings → Security, then click Retry."
		end
	end)
end

-- ── Greeting ────────────────────────────────────────────────────────────

-- Time-period greetings (indexed by os.date("*t").hour range)
local TIME_GREETINGS = {
	morning = { -- 5:00-11:59
		"Good morning, {name}! Ready to build something amazing today?",
		"Rise and shine, {name}! What are we creating today?",
		"Morning, {name}! Fresh day, fresh builds. Let's go!",
	},
	afternoon = { -- 12:00-16:59
		"Good afternoon, {name}! What project are we tackling?",
		"Hey {name}! Hope your day's going well. Ready to code?",
		"Afternoon, {name}! Let's make some progress on your game.",
	},
	evening = { -- 17:00-21:59
		"Good evening, {name}! Winding down with some coding?",
		"Evening, {name}! Perfect time to build something cool.",
		"Hey {name}! Late evening coding session? I'm here for it.",
	},
	night = { -- 22:00-4:59
		"Burning the midnight oil, {name}? Let's build!",
		"Late night, {name}! Best ideas happen after dark.",
		"Night owl {name}! What are we creating tonight?",
	},
}

-- Generic greetings (always in the pool)
local GENERIC_GREETINGS = {
	"Hey {name}! What would you like to build?",
	"Welcome back, {name}! Ready to create?",
	"Hello, {name}! Let's make something awesome.",
	"Hi {name}! What's the plan today?",
	"Greetings, {name}! Your Roblox adventure awaits.",
	"Ready to code, {name}? I'm here to help!",
	"Let's build together, {name}! What's on your mind?",
	"Hey {name}! Got a game idea? Let's make it happen.",
}

--- Determine time of day from local system clock.
local function _getTimeOfDay(): string
	local ok, dateTable = pcall(function()
		return os.date("*t")
	end)
	if not ok or not dateTable then
		return "afternoon" -- fallback if os.date fails
	end

	local hour = dateTable.hour
	if hour >= 5 and hour < 12 then
		return "morning"
	elseif hour >= 12 and hour < 17 then
		return "afternoon"
	elseif hour >= 17 and hour < 22 then
		return "evening"
	else
		return "night"
	end
end

--- Pick a random greeting, avoiding the last-used one.
--- Uses the plugin settings to persist the previous greeting across reloads.
local function _pickGreeting(playerName: string): string
	local timeOfDay = _getTimeOfDay()

	-- Build pool: time-period greetings + generic ones
	local pool = {}
	local timeEntries = TIME_GREETINGS[timeOfDay] or {}
	for _, g in ipairs(timeEntries) do
		table.insert(pool, g)
	end
	for _, g in ipairs(GENERIC_GREETINGS) do
		table.insert(pool, g)
	end

	-- Avoid repeating the last-used greeting
	local lastGreeting = ""
	if ChatPanel._plugin then
		lastGreeting = ChatPanel._plugin:GetSetting("BloxBot_LastGreeting") or ""
	end

	local filtered = {}
	for _, g in ipairs(pool) do
		if g ~= lastGreeting then
			table.insert(filtered, g)
		end
	end
	if #filtered == 0 then
		filtered = pool -- fallback: only one greeting total
	end

	local chosen = filtered[math.random(1, #filtered)]

	-- Persist for next time
	if ChatPanel._plugin then
		ChatPanel._plugin:SetSetting("BloxBot_LastGreeting", chosen)
	end

	return chosen:gsub("{name}", playerName)
end

function ChatPanel._showGreeting()
	if not ChatPanel._greetingFrame then return end

	local ok, player = pcall(function()
		return game:GetService("Players").LocalPlayer
	end)
	local playerName = "Builder"
	if ok and player then
		playerName = player.DisplayName
	end

	ChatPanel._greetingFrame.Visible = true
	local text = ChatPanel._greetingFrame:FindFirstChild("GreetingText")
	if text then
		text.Text = _pickGreeting(playerName)
	end
	if ChatPanel._messageList then
		ChatPanel._messageList.Visible = false
	end
end

function ChatPanel._hideGreeting()
	if ChatPanel._greetingFrame then
		ChatPanel._greetingFrame.Visible = false
	end
	if ChatPanel._messageList then
		ChatPanel._messageList.Visible = true
	end
end

-- ── Status ───────────────────────────────────────────────────────────────

function ChatPanel._updateStatus()
	local provider = SettingsStore.getProvider()
	local model = SettingsStore.getModel(provider)
	local apiKey = SettingsStore.getApiKey(provider)

	if not apiKey or apiKey == "" then
		ChatPanel._connectionState = "disconnected"
		StatusBar.setStatus("disconnected", "No API key configured")
		return
	end

	if provider == "opencode" then
		local baseUrl = SettingsStore.getBaseUrl("opencode")
		if not baseUrl or baseUrl == "" then
			ChatPanel._connectionState = "disconnected"
			StatusBar.setStatus("disconnected", "No base URL configured")
			return
		end
	end

	ChatPanel._connectionState = "ready"
	StatusBar.setStatus("ready", `{provider} / {model}`)
end

-- ── Settings ─────────────────────────────────────────────────────────────

function ChatPanel._toggleSettings()
	if ChatPanel._settingsPanel then
		ChatPanel._settingsPanel:Destroy()
		ChatPanel._settingsPanel = nil
	else
		ChatPanel._settingsPanel = SettingsPanel.create(ChatPanel._mainFrame, function()
			if ChatPanel._settingsPanel then
				ChatPanel._settingsPanel:Destroy()
			end
			ChatPanel._settingsPanel = nil
			ChatPanel._updateStatus()
		end)
	end
end

-- ── Session List Toggle / Auto-collapse ──────────────────────────────────

function ChatPanel._toggleSessionList()
	ChatPanel._sessionListVisible = not ChatPanel._sessionListVisible
	-- If user manually toggles, clear auto-collapsed flag
	if ChatPanel._sessionListVisible then
		ChatPanel._autoCollapsed = false
	end
	ChatPanel._applySessionListLayout()
end

function ChatPanel._applySessionListLayout()
	local sidebarWidth = ChatPanel._sessionListVisible and 200 or 0
	SessionList.setVisible(ChatPanel._sessionListVisible)
	if ChatPanel._chatFrame then
		ChatPanel._chatFrame.Size = UDim2.new(1, -sidebarWidth, 1, 0)
		ChatPanel._chatFrame.Position = UDim2.new(0, sidebarWidth, 0, 0)
	end
end

function ChatPanel._onContentResized()
	if not ChatPanel._contentFrame then return end
	local width = ChatPanel._contentFrame.AbsoluteSize.X
	local narrowThreshold = 500

	if width < narrowThreshold and ChatPanel._sessionListVisible and not ChatPanel._autoCollapsed then
		-- Auto-collapse when too narrow
		ChatPanel._sessionListVisible = false
		ChatPanel._autoCollapsed = true
		ChatPanel._applySessionListLayout()
	elseif width >= narrowThreshold + 40 and not ChatPanel._sessionListVisible and ChatPanel._autoCollapsed then
		-- Auto-expand when wide enough again (only if it was auto-collapsed)
		ChatPanel._sessionListVisible = true
		ChatPanel._autoCollapsed = false
		ChatPanel._applySessionListLayout()
	end
end

-- ── Sessions ─────────────────────────────────────────────────────────────

function ChatPanel._loadSessions()
	local saved = ChatPanel._plugin:GetSetting("BloxBot_Sessions")
	if saved and #saved > 0 then
		ChatPanel._sessions = saved
		-- Load messages for each session
		for _, session in ipairs(ChatPanel._sessions) do
			local savedMessages = ChatPanel._plugin:GetSetting("BloxBot_Messages_" .. session.id)
			if savedMessages then
				session.messages = savedMessages
			else
				session.messages = {}
			end
		end
		SessionList.setSessions(ChatPanel._sessions)

		-- Auto-select first session if none active
		if not ChatPanel._activeSessionId and #ChatPanel._sessions > 0 then
			ChatPanel._selectSession(ChatPanel._sessions[1].id)
		end
	else
		ChatPanel._showGreeting()
	end
end

function ChatPanel._saveSessions()
	-- Save session metadata (without messages to keep size reasonable)
	local toSave = {}
	for _, session in ipairs(ChatPanel._sessions) do
		table.insert(toSave, {
			id = session.id,
			title = session.title,
			createdAt = session.createdAt,
			updatedAt = session.updatedAt,
		})
	end
	ChatPanel._plugin:SetSetting("BloxBot_Sessions", toSave)

	-- Save messages separately per session
	for _, session in ipairs(ChatPanel._sessions) do
		if session.messages and #session.messages > 0 then
			ChatPanel._plugin:SetSetting("BloxBot_Messages_" .. session.id, session.messages)
		else
			ChatPanel._plugin:SetSetting("BloxBot_Messages_" .. session.id, nil)
		end
	end
end

function ChatPanel._findSession(sessionId: string)
	for _, s in ipairs(ChatPanel._sessions) do
		if s.id == sessionId then
			return s
		end
	end
	return nil
end

function ChatPanel._selectSession(sessionId: string)
	ChatPanel._activeSessionId = sessionId
	ChatPanel._sessionExecutionApproved = false -- reset approval on session switch
	ChatPanel._hideGreeting()
	SessionList.setActiveSession(sessionId)

	local session = ChatPanel._findSession(sessionId)
	if session then
		if ChatPanel._titleLabel then
			ChatPanel._titleLabel.Text = session.title or "New Chat"
		end
		if ChatPanel._titleEditBox then
			ChatPanel._titleEditBox.Text = session.title or "New Chat"
		end
		MessageList.clear()
		MessageList.showLoadingIndicator()

		-- Defer loading so the UI shows the spinner immediately
		task.defer(function()
			for _, msg in ipairs(session.messages or {}) do
				-- Sanitize corrupted data: coerce non-string content/reasoning
				if typeof(msg.content) ~= "string" then
					msg.content = tostring(msg.content or "")
				end
				if msg.reasoning ~= nil and typeof(msg.reasoning) ~= "string" then
					msg.reasoning = tostring(msg.reasoning)
				end
				ChatPanel._addMessageToUI(msg)
			end
			MessageList.hideLoadingIndicator()
		end)
	end
end

function ChatPanel._createSession()
	ChatPanel._sessionExecutionApproved = false -- reset approval for new session
	local now = DateTime.now().UnixTimestampMillis
	local session = {
		id = HttpService:GenerateGUID(false),
		title = "New Chat",
		messages = {},
		createdAt = now,
		updatedAt = now,
	}
	table.insert(ChatPanel._sessions, 1, session)
	SessionList.setSessions(ChatPanel._sessions)
	ChatPanel._selectSession(session.id)
	ChatPanel._saveSessions()
end

function ChatPanel._deleteSession(sessionId: string)
	local idx = nil
	for i, s in ipairs(ChatPanel._sessions) do
		if s.id == sessionId then
			idx = i
			break
		end
	end
	if idx then
		table.remove(ChatPanel._sessions, idx)
		ChatPanel._plugin:SetSetting("BloxBot_Messages_" .. sessionId, nil)
	end

	if ChatPanel._activeSessionId == sessionId then
		ChatPanel._activeSessionId = nil
		MessageList.clear()
		if #ChatPanel._sessions > 0 then
			ChatPanel._selectSession(ChatPanel._sessions[1].id)
		else
			ChatPanel._showGreeting()
		end
	end

	SessionList.setSessions(ChatPanel._sessions)
	ChatPanel._saveSessions()
end

-- ── Messages ─────────────────────────────────────────────────────────────

function ChatPanel._sendMessage(text: string, context: {selection: boolean, scripts: boolean, structure: boolean, thinkingLevel: string}, attachments: {Instance}?, snippets: {{script: LuaSourceContainer, startLine: number, endLine: number, text: string}}?)
	-- Auto-create session if none is active
	if not ChatPanel._activeSessionId then
		ChatPanel._createSession()
		ChatPanel._hideGreeting()
	end

	local providerName = SettingsStore.getProvider()
	local apiKey = SettingsStore.getApiKey(providerName)
	if not apiKey or apiKey == "" then
		ChatPanel._addMessageToUI({
			role = "assistant",
			content = "Please configure your API key in Settings (⚙).",
		})
		return
	end

	if providerName == "opencode" then
		local baseUrl = SettingsStore.getBaseUrl("opencode")
		if not baseUrl or baseUrl == "" then
			ChatPanel._addMessageToUI({
				role = "assistant",
				content = "Please configure the OpenCode base URL in Settings (⚙).",
			})
			return
		end
	end

	local session = ChatPanel._findSession(ChatPanel._activeSessionId)
	if not session then
		return
	end

	-- Build content with context (skip empty parts)
	local fullText = text
	local contextParts = {}
	if context.selection then
		local sel = StudioContext.getSelection()
		if sel ~= "" then
			table.insert(contextParts, sel)
		end
	end
	if context.scripts then
		local src = StudioContext.getScriptSources()
		if src ~= "" then
			table.insert(contextParts, src)
		end
	end
	if context.structure then
		local str = StudioContext.getPlaceStructure()
		if str ~= "" then
			table.insert(contextParts, str)
		end
	end

	local attachmentContext = StudioContext.getAttachmentContext(attachments or {})
	if attachmentContext ~= "" then
		table.insert(contextParts, attachmentContext)
	end

	local snippetContext = StudioContext.getSnippetContext(snippets or {})
	if snippetContext ~= "" then
		table.insert(contextParts, snippetContext)
	end

	if #contextParts > 0 then
		fullText = fullText .. "\n\n--- Context ---\n\n" .. table.concat(contextParts, "\n\n")
	end

	-- If agent is busy, queue the message and show it in the UI immediately
	if ChatPanel._isBusy then
		table.insert(ChatPanel._messageQueue, {
			text = text,
			context = context,
			attachments = attachments,
			snippets = snippets,
		})
		ChatPanel._addMessageToUI({
			role = "user",
			content = fullText,
		})
		return
	end

	-- Add user message to UI (Agent.run will add it to session.messages)
	ChatPanel._addMessageToUI({
		role = "user",
		content = fullText,
	})

	-- Update session title if first user message
	local userMsgCount = 0
	for _, m in ipairs(session.messages) do
		if m.role == "user" then
			userMsgCount += 1
		end
	end
	if userMsgCount == 0 then
		session.title = text:sub(1, 30) .. (text:len() > 30 and "..." or "")
		if ChatPanel._titleLabel then
			ChatPanel._titleLabel.Text = session.title
		end
		if ChatPanel._titleEditBox then
			ChatPanel._titleEditBox.Text = session.title
		end
		SessionList.setSessions(ChatPanel._sessions)
	end

	ChatPanel._isBusy = true
	Agent.resetCancel()
	ChatInput.setStopMode(true, function()
		Agent.requestCancel()
	end)
	local isAgentMode = SettingsStore.getEnableAgentMode()
	StatusBar.setStatus("connecting", isAgentMode and "Thinking..." or "Connecting...")
	SessionList.setSessionStatus(session.id, "working")
	if isAgentMode then
		MessageList.showTypingIndicator()
	end

	task.spawn(function()
		local provider = Providers.getProvider(providerName)
		local model = SettingsStore.getModel(providerName)

		local options = {thinkingLevel = context.thinkingLevel or "off"}
		if providerName == "opencode" then
			options.baseUrl = SettingsStore.getBaseUrl("opencode")
		end

		local agentStats = Agent.run(session, fullText, providerName, provider, apiKey, model, options, function(update: {type: string, [string]: any})
			if update.type == "user_message" then
				-- Already shown in UI above, skip
			elseif update.type == "status" then
				StatusBar.setStatus("connecting", update.message or "Thinking...")
			elseif update.type == "reasoning" then
				-- Show reasoning summary in typing indicator
				local summary = (typeof(update.content) == "string") and update.content or tostring(update.content or "")
				if #summary > 120 then
					summary = summary:sub(1, 120) .. "..."
				end
				if isAgentMode then
					MessageList.updateTypingText("Reasoning: " .. summary)
				end
				-- Store reasoning for the upcoming text_start
				ChatPanel._pendingReasoning = update.content
			elseif update.type == "text_start" then
				if isAgentMode then
					MessageList.hideTypingIndicator()
				end
				MessageList.startStreamingMessage(ChatPanel._pendingReasoning)
				ChatPanel._pendingReasoning = nil
			elseif update.type == "text_chunk" then
				MessageList.appendStreamingText(update.chunk or "")
			elseif update.type == "text_end" then
				MessageList.finishStreamingMessage()
			elseif update.type == "tool_start" then
				if isAgentMode then
					MessageList.hideTypingIndicator()
				end
				StatusBar.setStatus("connecting", `Running: {update.name or "tool"}...`)
			elseif update.type == "tool_end" then
				StatusBar.setStatus("connecting", isAgentMode and "Thinking..." or "Connecting...")
			elseif update.type == "tool_calls" then
				-- Tool calls batch received; individual tool_start/status updates follow
			elseif update.type == "error" then
				MessageList.hideTypingIndicator()
				ChatPanel._pendingReasoning = nil
				ChatPanel._addMessageToUI({
					role = "assistant",
					content = "Error: " .. (update.message or "Unknown error occurred."),
				})
				SessionList.setSessionStatus(session.id, "error")
				StatusBar.setStatus("error", "Request failed")
			end
		end)

		-- Session may have been deleted while request was in flight
		local currentSession = ChatPanel._findSession(session.id)
		if not currentSession then
			ChatPanel._isBusy = false
			ChatInput.setEnabled(true)
			ChatInput.setStopMode(false)
			ChatPanel._updateStatus()
			return
		end

		currentSession.updatedAt = DateTime.now().UnixTimestampMillis
		ChatPanel._saveSessions()
		ChatPanel._isBusy = false
		ChatInput.setEnabled(true)
		ChatInput.setStopMode(false)
		SessionList.setSessions(ChatPanel._sessions)
		SessionList.setSessionStatus(session.id, "done")

		-- Show completion stats in status bar, then revert to ready after a delay
		if agentStats and agentStats.duration then
			local durationStr = string.format("%.1fs", agentStats.duration)
			local toolStr = agentStats.toolCount > 0 and ` · {agentStats.toolCount} tool{agentStats.toolCount == 1 and "" or "s"}` or ""
			StatusBar.setStatus("ready", `Done in {durationStr}{toolStr}`)
			task.delay(4, function()
				if ChatPanel._connectionState == "ready" then
					StatusBar.setStatus("ready", `{providerName} / {model}`)
				end
			end)
		else
			StatusBar.setStatus("ready", `{providerName} / {model}`)
		end

		-- Process next queued message if any
		if #ChatPanel._messageQueue > 0 then
			local nextMsg = table.remove(ChatPanel._messageQueue, 1)
			ChatPanel._sendMessage(nextMsg.text, nextMsg.context, nextMsg.attachments, nextMsg.snippets)
		end
	end)
end

-- ── Permission & Auto-Execution ──────────────────────────────────────────

local EXECUTE_MARKER = "--[bloxbot:execute]"

local function extractExecutableBlocks(content: string): {string}
	local blocks = {}
	local pattern = "```lua\n(.-)\n```"
	local startIdx = 1
	while true do
		local s, e, block = content:find(pattern, startIdx)
		if not s then break end
		if block:find(EXECUTE_MARKER, 1, true) then
			-- Remove the marker from the executable code
			local cleanCode = block:gsub("^%-%-\[bloxbot:execute\]\n?", "")
			table.insert(blocks, cleanCode)
		end
		startIdx = e + 1
	end
	return blocks
end

local function showPermissionBar(parent: Instance, code: string, onDecision: (decision: "once" | "session" | "deny") -> ())
	-- Parent to the message bubble's Parts frame so it lays out below the code block
	local partsFrame = parent:FindFirstChild("Bubble") and parent.Bubble:FindFirstChild("Parts")
	if not partsFrame then
		partsFrame = parent
	end

	local bar = Instance.new("Frame")
	bar.Name = "PermissionBar"
	bar.Size = UDim2.new(1, 0, 0, 40)
	bar.BackgroundColor3 = Theme.BgSecondary
	bar.BorderSizePixel = 0
	bar.ZIndex = 10
	bar.Parent = partsFrame

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = bar

	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 6)
	pad.PaddingBottom = UDim.new(0, 6)
	pad.PaddingLeft = UDim.new(0, 10)
	pad.PaddingRight = UDim.new(0, 10)
	pad.Parent = bar

	local icon = Instance.new("TextLabel")
	icon.Size = UDim2.new(0, 24, 0, 24)
	icon.Position = UDim2.new(0, 0, 0.5, -12)
	icon.BackgroundTransparency = 1
	icon.Text = "⚡"
	icon.TextSize = 18
	icon.Font = Theme.FontRegular
	icon.TextColor3 = Theme.TextPrimary
	icon.ZIndex = 11
	icon.Parent = bar

	local text = Instance.new("TextLabel")
	text.Size = UDim2.new(1, -230, 1, 0)
	text.Position = UDim2.new(0, 28, 0, 0)
	text.BackgroundTransparency = 1
	text.Text = "AI wants to execute code"
	text.TextColor3 = Theme.TextSecondary
	text.Font = Theme.FontBold
	text.TextSize = Theme.TextSizeRegular
	text.TextXAlignment = Enum.TextXAlignment.Left
	text.ZIndex = 11
	text.Parent = bar

	local function createBtn(label: string, bgColor: Color3, xPos: number, width: number)
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.new(0, width, 0, 26)
		btn.Position = UDim2.new(1, xPos, 0.5, -13)
		btn.BackgroundColor3 = bgColor
		btn.BorderSizePixel = 0
		btn.Text = label
		btn.TextColor3 = Color3.fromRGB(255, 255, 255)
		btn.Font = Theme.FontBold
		btn.TextSize = Theme.TextSizeSmall
		btn.ZIndex = 11
		btn.Parent = bar
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(0, 4)
		c.Parent = btn
		return btn
	end

	local denyBtn = createBtn("Deny", Theme.StatusDisconnected, -70, 62)
	local onceBtn = createBtn("Once", Theme.Accent, -138, 60)
	local sessionBtn = createBtn("Allow Session", Theme.StatusConnected, -236, 92)

	denyBtn.Activated:Connect(function()
		bar:Destroy()
		onDecision("deny")
	end)

	onceBtn.Activated:Connect(function()
		bar:Destroy()
		onDecision("once")
	end)

	sessionBtn.Activated:Connect(function()
		bar:Destroy()
		onDecision("session")
	end)

	return bar
end

local function executeCodeAndShowResult(code: string, parentFrame: Instance)
	local result = StudioContext.runCode(code)
	if result.success then
		if result.output ~= "" then
			ChatPanel._addMessageToUI({
				role = "assistant",
				content = "**Output**\n```\n" .. result.output .. "\n```",
			})
		end
	else
		ChatPanel._addMessageToUI({
			role = "assistant",
			content = "**Execution failed**\n```\n" .. (result.error or "Unknown error") .. "\n```",
		})
	end
end

function ChatPanel._processExecutableBlocks(content: string, messageBubble: Instance?)
	local allowExecution = SettingsStore.getAllowCodeExecution()
	if not allowExecution then
		return -- Just show the code blocks with Insert/Run buttons
	end

	local blocks = extractExecutableBlocks(content)
	if #blocks == 0 then
		return -- No executable blocks
	end

	local requireApproval = SettingsStore.getRequireApproval()

	if not requireApproval or ChatPanel._sessionExecutionApproved then
		-- Auto-execute all blocks
		for _, code in ipairs(blocks) do
			executeCodeAndShowResult(code, nil)
		end
		return
	end

	-- Need approval - show permission bar for the first block
	if messageBubble then
		showPermissionBar(messageBubble, blocks[1], function(decision)
			if decision == "deny" then
				return
			elseif decision == "session" then
				ChatPanel._sessionExecutionApproved = true
			end
			-- Execute all blocks
			for _, code in ipairs(blocks) do
				executeCodeAndShowResult(code, nil)
			end
		end)
	end
end

function ChatPanel._addMessageToUI(message: any)
	local role = message.role or "assistant"

	-- Skip hidden tool messages: tool results and assistant tool-call requests
	-- are stored for API history but should not appear as chat bubbles.
	if role == "tool" then
		return
	end
	if role == "assistant" and message.tool_calls then
		return
	end

	-- Coerce content to string (defense against corrupted session data)
	local content = (typeof(message.content) == "string") and message.content or tostring(message.content or "")

	-- Build parts array for messages with reasoning
	local parts = nil
	if role == "assistant" and message.reasoning and typeof(message.reasoning) == "string" and message.reasoning ~= "" then
		parts = {
			{type = "reasoning", text = message.reasoning},
			{type = "text", text = content},
		}
	end

	local bubble = MessageList.addMessage({
		role = role,
		content = content,
		parts = parts,
	})

	-- Only assistant messages can have executable blocks
	if role == "assistant" then
		ChatPanel._processExecutableBlocks(content, bubble)
	end
end

-- ── Cleanup ──────────────────────────────────────────────────────────────

function ChatPanel.cleanup()
	if ChatPanel._resizeConnection then
		ChatPanel._resizeConnection:Disconnect()
		ChatPanel._resizeConnection = nil
	end

	if ChatPanel._selectionConnection then
		ChatPanel._selectionConnection:Disconnect()
		ChatPanel._selectionConnection = nil
	end

	if ChatPanel._editorSelectionDisconnect then
		ChatPanel._editorSelectionDisconnect()
		ChatPanel._editorSelectionDisconnect = nil
	end

	if ChatPanel._docCloseConnection then
		ChatPanel._docCloseConnection:Disconnect()
		ChatPanel._docCloseConnection = nil
	end

	if ChatPanel._settingsPanel then
		ChatPanel._settingsPanel:Destroy()
		ChatPanel._settingsPanel = nil
	end

	if ChatPanel._widget then
		ChatPanel._widget:Destroy()
		ChatPanel._widget = nil
	end

	StatusBar.destroy()
	SessionList.destroy()
	MessageList.destroy()
	ChatInput.destroy()
end

return ChatPanel
