-- Chat/MessageBubble.lua
-- Individual chat message bubble with rich part rendering

local Theme = require(script.Parent.Parent.Theme)
local MarkdownParser = require(script.Parent.Markdown.MarkdownParser)

local MessageBubble = {}

-- Safely coerce any value to a string (same helper as MarkdownParser)
local function asString(value: any): string
	if value == nil then return "" end
	if typeof(value) == "string" then return value end
	return tostring(value)
end

local HttpService = game:GetService("HttpService")

-- Cached avatar URL for the logged-in developer
local _avatarUrl: string? = nil

local function _getAvatarUrl(): string?
	if _avatarUrl ~= nil then
		return _avatarUrl ~= "" and _avatarUrl or nil
	end

	local ok, userId = pcall(function()
		return game:GetService("StudioService"):GetUserId()
	end)

	if ok and userId and userId > 0 then
		local success, url = pcall(function()
			return game:GetService("Players"):GetUserThumbnailAsync(
				userId,
				Enum.ThumbnailType.HeadShot,
				Enum.ThumbnailSize.Size48x48
			)
		end)
		if success and url and url ~= "" then
			_avatarUrl = url
			return url
		end
	end

	_avatarUrl = ""
	return nil
end

-- ── Part Renderers ───────────────────────────────────────────────────────

local function renderTextPart(part: any, parent: Instance): Frame
	local frame = Instance.new("Frame")
	frame.Name = "TextPart"
	frame.Size = UDim2.new(1, 0, 0, 0)
	frame.BackgroundTransparency = 1
	frame.AutomaticSize = Enum.AutomaticSize.Y
	frame.Parent = parent

	local blocks = MarkdownParser.parseBlocks(asString(part.text))
	MarkdownParser.renderToFrame(blocks, frame)

	return frame
end

local function renderReasoningPart(part: any, parent: Instance): Frame
	local container = Instance.new("Frame")
	container.Name = "ReasoningPart"
	container.Size = UDim2.new(1, 0, 0, 0)
	container.BackgroundTransparency = 1
	container.AutomaticSize = Enum.AutomaticSize.Y
	container.Parent = parent

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 0)
	layout.Parent = container

	-- Header (clickable)
	local header = Instance.new("TextButton")
	header.Name = "Header"
	header.Size = UDim2.new(1, 0, 0, 22)
	header.BackgroundTransparency = 1
	header.Text = " ▶ Reasoning"
	header.TextColor3 = Theme.TextMuted
	header.Font = Theme.FontRegular
	header.TextSize = Theme.TextSizeSmall
	header.TextXAlignment = Enum.TextXAlignment.Left
	header.Parent = container

	-- Body (hidden by default)
	local body = Instance.new("Frame")
	body.Name = "Body"
	body.Size = UDim2.new(1, -16, 0, 0)
	body.BackgroundTransparency = 1
	body.Visible = false
	body.AutomaticSize = Enum.AutomaticSize.Y
	body.Parent = container

	local leftBorder = Instance.new("Frame")
	leftBorder.Name = "Border"
	leftBorder.Size = UDim2.new(0, 2, 1, 0)
	leftBorder.BackgroundColor3 = Theme.Divider
	leftBorder.BorderSizePixel = 0
	leftBorder.Parent = body

	local textBox = Instance.new("TextBox")
	textBox.Name = "Text"
	textBox.Size = UDim2.new(1, -10, 0, 0)
	textBox.Position = UDim2.new(0, 8, 0, 0)
	textBox.BackgroundTransparency = 1
	textBox.Text = asString(part.text)
	textBox.TextColor3 = Theme.TextSecondary
	textBox.Font = Theme.FontRegular
	textBox.TextSize = Theme.TextSizeSmall
	textBox.TextWrapped = true
	textBox.TextXAlignment = Enum.TextXAlignment.Left
	textBox.TextYAlignment = Enum.TextYAlignment.Top
	textBox.AutomaticSize = Enum.AutomaticSize.Y
	textBox.TextEditable = false
	textBox.ClearTextOnFocus = false
	textBox.MultiLine = true
	textBox.Parent = body

	local expanded = false
	header.Activated:Connect(function()
		expanded = not expanded
		body.Visible = expanded
		header.Text = expanded and " ▼ Reasoning" or " ▶ Reasoning"
	end)

	return container
end

local STATUS_COLORS = {
	pending = Theme.TextMuted,
	running = Theme.StatusWorking,
	completed = Theme.StatusDone,
	error = Theme.StatusError,
}

local STATUS_EMOJI = {
	pending = "⏸",
	running = "⏳",
	completed = "✅",
	error = "❌",
}

local function renderToolPart(part: any, parent: Instance): Frame
	local container = Instance.new("Frame")
	container.Name = "ToolPart"
	container.Size = UDim2.new(1, 0, 0, 0)
	container.BackgroundTransparency = 1
	container.AutomaticSize = Enum.AutomaticSize.Y
	container.Parent = parent

	local state = part.state or {}
	local status = state.status or "pending"
	local input = state.input or {}
	local output = state.output
	local toolName = asString(part.tool or "tool")

	-- Strip mcp_ prefix like the frontend does
	toolName = toolName:gsub("^mcp_[^_]+_", "")

	local color = STATUS_COLORS[status] or Theme.TextMuted
	local emoji = STATUS_EMOJI[status] or "🔧"

	-- Styled card
	local card = Instance.new("Frame")
	card.Name = "Card"
	card.Size = UDim2.new(1, 0, 0, 0)
	card.BackgroundColor3 = Theme.BgSecondary
	card.BorderSizePixel = 0
	card.AutomaticSize = Enum.AutomaticSize.Y
	card.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = card

	local leftAccent = Instance.new("Frame")
	leftAccent.Name = "Accent"
	leftAccent.Size = UDim2.new(0, 3, 1, 0)
	leftAccent.Position = UDim2.new(0, -7, 0, 0)
	leftAccent.BackgroundColor3 = color
	leftAccent.BorderSizePixel = 0
	leftAccent.Parent = card

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 6)
	padding.PaddingBottom = UDim.new(0, 6)
	padding.PaddingLeft = UDim.new(0, 10)
	padding.PaddingRight = UDim.new(0, 8)
	padding.Parent = card

	-- Clickable header row
	local header = Instance.new("TextButton")
	header.Name = "Header"
	header.Size = UDim2.new(1, 0, 0, 18)
	header.BackgroundTransparency = 1
	header.Text = `{emoji} {toolName}  ▶`
	header.TextColor3 = Theme.TextPrimary
	header.Font = Theme.FontBold
	header.TextSize = Theme.TextSizeSmall
	header.TextXAlignment = Enum.TextXAlignment.Left
	header.Parent = card

	-- Content container (hidden by default for completed, shown for errors/running)
	local content = Instance.new("Frame")
	content.Name = "Content"
	content.Size = UDim2.new(1, 0, 0, 0)
	content.Position = UDim2.new(0, 0, 0, 20)
	content.BackgroundTransparency = 1
	content.Visible = (status == "error" or status == "running")
	content.AutomaticSize = Enum.AutomaticSize.Y
	content.Parent = card

	local expanded = content.Visible
	header.Activated:Connect(function()
		expanded = not expanded
		content.Visible = expanded
		header.Text = expanded and `{emoji} {toolName}  ▼` or `{emoji} {toolName}  ▶`
	end)

	local yOffset = 0

	-- Parameters section
	local paramKeys = {}
	for k, _ in pairs(input) do
		table.insert(paramKeys, k)
	end
	if #paramKeys > 0 then
		table.sort(paramKeys)
		local paramLabel = Instance.new("TextLabel")
		paramLabel.Name = "ParamsLabel"
		paramLabel.Size = UDim2.new(1, 0, 0, 14)
		paramLabel.BackgroundTransparency = 1
		paramLabel.Text = "Parameters"
		paramLabel.TextColor3 = Theme.TextMuted
		paramLabel.Font = Theme.FontBold
		paramLabel.TextSize = Theme.TextSizeSmall
		paramLabel.TextXAlignment = Enum.TextXAlignment.Left
		paramLabel.Parent = content
		yOffset += 16

		for _, key in ipairs(paramKeys) do
			local val = input[key]
			local valStr = typeof(val) == "string" and val or HttpService:JSONEncode(val)
			-- Truncate long values
			if #valStr > 120 then
				valStr = valStr:sub(1, 120) .. "..."
			end
			local line = Instance.new("TextLabel")
			line.Name = "Param_" .. key
			line.Size = UDim2.new(1, 0, 0, 0)
			line.Position = UDim2.new(0, 0, 0, yOffset)
			line.BackgroundTransparency = 1
			line.Text = `  {key}: {valStr}`
			line.TextColor3 = Theme.TextSecondary
			line.Font = Theme.FontCode
			line.TextSize = Theme.TextSizeSmall
			line.TextWrapped = true
			line.TextXAlignment = Enum.TextXAlignment.Left
			line.AutomaticSize = Enum.AutomaticSize.Y
			line.Parent = content
			yOffset += line.AbsoluteSize.Y + 1
		end
		yOffset += 4
	end

	-- Output (if completed)
	if status == "completed" and output and typeof(output) == "string" and #output > 0 then
		local outLabel = Instance.new("TextLabel")
		outLabel.Name = "OutputLabel"
		outLabel.Size = UDim2.new(1, 0, 0, 14)
		outLabel.Position = UDim2.new(0, 0, 0, yOffset)
		outLabel.BackgroundTransparency = 1
		outLabel.Text = "Output"
		outLabel.TextColor3 = Theme.TextMuted
		outLabel.Font = Theme.FontBold
		outLabel.TextSize = Theme.TextSizeSmall
		outLabel.TextXAlignment = Enum.TextXAlignment.Left
		outLabel.Parent = content
		yOffset += 16

		local outputBox = Instance.new("TextBox")
		outputBox.Name = "Output"
		outputBox.Size = UDim2.new(1, 0, 0, 0)
		outputBox.Position = UDim2.new(0, 0, 0, yOffset)
		outputBox.BackgroundTransparency = 1
		outputBox.Text = output:sub(1, 2000) .. (output:len() > 2000 and "..." or "")
		outputBox.TextColor3 = Theme.TextSecondary
		outputBox.Font = Theme.FontRegular
		outputBox.TextSize = Theme.TextSizeSmall
		outputBox.TextWrapped = true
		outputBox.TextXAlignment = Enum.TextXAlignment.Left
		outputBox.TextYAlignment = Enum.TextYAlignment.Top
		outputBox.AutomaticSize = Enum.AutomaticSize.Y
		outputBox.TextEditable = false
		outputBox.ClearTextOnFocus = false
		outputBox.MultiLine = true
		outputBox.Parent = content
	end

	-- Error
	if status == "error" and state.error then
		local errBox = Instance.new("TextBox")
		errBox.Name = "Error"
		errBox.Size = UDim2.new(1, 0, 0, 0)
		errBox.Position = UDim2.new(0, 0, 0, yOffset)
		errBox.BackgroundTransparency = 1
		errBox.Text = tostring(state.error)
		errBox.TextColor3 = Theme.StatusDisconnected
		errBox.Font = Theme.FontRegular
		errBox.TextSize = Theme.TextSizeSmall
		errBox.TextWrapped = true
		errBox.TextXAlignment = Enum.TextXAlignment.Left
		errBox.TextYAlignment = Enum.TextYAlignment.Top
		errBox.AutomaticSize = Enum.AutomaticSize.Y
		errBox.TextEditable = false
		errBox.ClearTextOnFocus = false
		errBox.MultiLine = true
		errBox.Parent = content
	end

	return container
end

local function renderStepFinishPart(part: any, parent: Instance): Frame
	local frame = Instance.new("Frame")
	frame.Name = "StepFinish"
	frame.Size = UDim2.new(1, 0, 0, 16)
	frame.BackgroundTransparency = 1
	frame.Parent = parent

	local tokens = part.tokens
	local cost = part.cost
	if not tokens then return frame end

	local parts = {}
	if cost and cost > 0 then
		table.insert(parts, `$${string.format("%.4f", cost)}`)
	end
	table.insert(parts, `{tokens.input or 0} in / {tokens.output or 0} out`)
	if tokens.cache and tokens.cache.read then
		table.insert(parts, `{tokens.cache.read} cached`)
	end

	local label = Instance.new("TextLabel")
	label.Name = "Summary"
	label.Size = UDim2.new(1, 0, 0, 16)
	label.BackgroundTransparency = 1
	label.Text = table.concat(parts, " | ")
	label.TextColor3 = Theme.TextMuted
	label.Font = Theme.FontRegular
	label.TextSize = Theme.TextSizeSmall
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = frame

	return frame
end

local function renderRetryPart(part: any, parent: Instance): Frame
	local frame = Instance.new("Frame")
	frame.Name = "Retry"
	frame.Size = UDim2.new(1, 0, 0, 20)
	frame.BackgroundTransparency = 1
	frame.Parent = parent

	local label = Instance.new("TextLabel")
	label.Name = "Text"
	label.Size = UDim2.new(1, 0, 0, 20)
	label.BackgroundTransparency = 1
	label.Text = `🔄 Retrying (attempt {part.attempt or "?"})`
	label.TextColor3 = Theme.StatusConnecting
	label.Font = Theme.FontRegular
	label.TextSize = Theme.TextSizeSmall
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Parent = frame

	return frame
end

-- ── Error Banner ─────────────────────────────────────────────────────────

local function renderErrorPart(errorData: any, parent: Instance): Frame
	local container = Instance.new("Frame")
	container.Name = "ErrorPart"
	container.Size = UDim2.new(1, 0, 0, 0)
	container.BackgroundTransparency = 1
	container.AutomaticSize = Enum.AutomaticSize.Y
	container.Parent = parent

	local banner = Instance.new("Frame")
	banner.Name = "Banner"
	banner.Size = UDim2.new(1, 0, 0, 0)
	banner.BackgroundColor3 = Theme.StatusDisconnected
	banner.BackgroundTransparency = 0.85
	banner.BorderSizePixel = 0
	banner.AutomaticSize = Enum.AutomaticSize.Y
	banner.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = banner

	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, 10)
	pad.PaddingBottom = UDim.new(0, 10)
	pad.PaddingLeft = UDim.new(0, 12)
	pad.PaddingRight = UDim.new(0, 12)
	pad.Parent = banner

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.Parent = banner

	-- Title row
	local titleRow = Instance.new("Frame")
	titleRow.Name = "TitleRow"
	titleRow.Size = UDim2.new(1, 0, 0, 20)
	titleRow.BackgroundTransparency = 1
	titleRow.LayoutOrder = 1
	titleRow.Parent = banner

	local titleLayout = Instance.new("UIListLayout")
	titleLayout.FillDirection = Enum.FillDirection.Horizontal
	titleLayout.SortOrder = Enum.SortOrder.LayoutOrder
	titleLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	titleLayout.Padding = UDim.new(0, 6)
	titleLayout.Parent = titleRow

	local icon = Instance.new("TextLabel")
	icon.Name = "Icon"
	icon.Size = UDim2.new(0, 20, 0, 20)
	icon.BackgroundTransparency = 1
	icon.Text = "🚨"
	icon.TextSize = 16
	icon.LayoutOrder = 1
	icon.Parent = titleRow

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.new(1, -26, 0, 20)
	title.AutomaticSize = Enum.AutomaticSize.Y
	title.BackgroundTransparency = 1
	title.Text = "Error"
	title.TextColor3 = Theme.StatusDisconnected
	title.Font = Theme.FontBold
	title.TextSize = Theme.TextSizeRegular
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.LayoutOrder = 2
	title.Parent = titleRow

	-- Extract message and raw JSON
	local errMessage = ""
	local rawJson = ""
	local HttpService = game:GetService("HttpService")

	if typeof(errorData) == "table" then
		errMessage = errorData.message
			or (typeof(errorData.error) == "table" and errorData.error.message)
			or errorData.error
			or "Unknown error"
		rawJson = HttpService:JSONEncode(errorData)
	elseif typeof(errorData) == "string" then
		errMessage = errorData
		rawJson = errorData
	else
		errMessage = tostring(errorData)
		rawJson = tostring(errorData)
	end

	-- Error message
	local msgLabel = Instance.new("TextLabel")
	msgLabel.Name = "Message"
	msgLabel.Size = UDim2.new(1, 0, 0, 0)
	msgLabel.BackgroundTransparency = 1
	msgLabel.Text = errMessage
	msgLabel.TextColor3 = Theme.TextPrimary
	msgLabel.Font = Theme.FontRegular
	msgLabel.TextSize = Theme.TextSizeRegular
	msgLabel.TextWrapped = true
	msgLabel.TextXAlignment = Enum.TextXAlignment.Left
	msgLabel.AutomaticSize = Enum.AutomaticSize.Y
	msgLabel.LayoutOrder = 2
	msgLabel.Parent = banner

	-- Click hint
	local hint = Instance.new("TextLabel")
	hint.Name = "Hint"
	hint.Size = UDim2.new(1, 0, 0, 16)
	hint.BackgroundTransparency = 1
	hint.Text = "Click to view raw error"
	hint.TextColor3 = Theme.TextMuted
	hint.Font = Theme.FontRegular
	hint.TextSize = Theme.TextSizeSmall
	hint.TextXAlignment = Enum.TextXAlignment.Left
	hint.LayoutOrder = 3
	hint.Parent = banner

	-- Raw error TextBox (hidden by default)
	local rawBox = Instance.new("TextBox")
	rawBox.Name = "RawError"
	rawBox.Size = UDim2.new(1, 0, 0, 200)
	rawBox.BackgroundColor3 = Theme.BgCode
	rawBox.BackgroundTransparency = 0
	rawBox.BorderSizePixel = 0
	rawBox.Text = rawJson
	rawBox.TextColor3 = Theme.TextPrimary
	rawBox.Font = Theme.FontCode
	rawBox.TextSize = Theme.TextSizeSmall
	rawBox.TextWrapped = true
	rawBox.TextXAlignment = Enum.TextXAlignment.Left
	rawBox.TextYAlignment = Enum.TextYAlignment.Top
	rawBox.ClearTextOnFocus = false
	rawBox.TextEditable = false
	rawBox.MultiLine = true
	rawBox.Visible = false
	rawBox.LayoutOrder = 4
	rawBox.Parent = banner

	local rawCorner = Instance.new("UICorner")
	rawCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	rawCorner.Parent = rawBox

	local rawPad = Instance.new("UIPadding")
	rawPad.PaddingTop = UDim.new(0, 8)
	rawPad.PaddingBottom = UDim.new(0, 8)
	rawPad.PaddingLeft = UDim.new(0, 10)
	rawPad.PaddingRight = UDim.new(0, 10)
	rawPad.Parent = rawBox

	-- Click to toggle raw view
	local showingRaw = false
	banner.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch then
			showingRaw = not showingRaw
			rawBox.Visible = showingRaw
			hint.Text = showingRaw and "Click to hide raw error" or "Click to view raw error"
		end
	end)

	return container
end

-- Detect if message content represents an error
local function detectError(content: string): (boolean, any)
	if not content or content == "" then
		return false, nil
	end
	content = asString(content)

	-- Direct error prefix (from API errors, etc.)
	if content:match("^Error:") or content:match("^🚨") then
		return true, content
	end

	-- Try to find JSON in the content (code blocks or raw)
	local jsonStr = content:match("```json\n(.-)\n```")
		or content:match("```\n(.-)\n```")
		or content

	local HttpService = game:GetService("HttpService")
	local ok, parsed = pcall(function()
		return HttpService:JSONDecode(jsonStr)
	end)

	if ok and parsed and typeof(parsed) == "table" then
		if parsed.error or parsed.message or parsed.code or parsed.type == "error" then
			return true, parsed
		end
	end

	return false, nil
end

-- ── Main Bubble ──────────────────────────────────────────────────────────

function MessageBubble.create(parent: Instance, message: {
	role: "user" | "assistant",
	content: string,
	parts: {any}?,
}): Frame
	local isUser = message.role == "user"

	-- Outer container for alignment
	local container = Instance.new("Frame")
	container.Name = "MessageContainer"
	container.Size = UDim2.new(1, 0, 0, 0)
	container.BackgroundTransparency = 1
	container.AutomaticSize = Enum.AutomaticSize.Y
	container.Parent = parent

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, Theme.PaddingSmall)
	padding.PaddingBottom = UDim.new(0, Theme.PaddingSmall)
	padding.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	padding.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	padding.Parent = container

	-- Role label / user header with avatar
	if isUser then
		local headerFrame = Instance.new("Frame")
		headerFrame.Name = "Header"
		headerFrame.Size = UDim2.new(1, 0, 0, 34)
		headerFrame.BackgroundTransparency = 1
		headerFrame.Parent = container

		local headerLayout = Instance.new("UIListLayout")
		headerLayout.FillDirection = Enum.FillDirection.Horizontal
		headerLayout.SortOrder = Enum.SortOrder.LayoutOrder
		headerLayout.HorizontalAlignment = Enum.HorizontalAlignment.Right
		headerLayout.VerticalAlignment = Enum.VerticalAlignment.Center
		headerLayout.Padding = UDim.new(0, 6)
		headerLayout.Parent = headerFrame

		local nameLabel = Instance.new("TextLabel")
		nameLabel.Name = "Name"
		nameLabel.Size = UDim2.new(0, 0, 0, 16)
		nameLabel.AutomaticSize = Enum.AutomaticSize.X
		nameLabel.BackgroundTransparency = 1
		nameLabel.Text = "You"
		nameLabel.TextColor3 = Theme.TextMuted
		nameLabel.Font = Theme.FontBold
		nameLabel.TextSize = Theme.TextSizeSmall
		nameLabel.LayoutOrder = 1
		nameLabel.Parent = headerFrame

		local avatarUrl = _getAvatarUrl()
		if avatarUrl then
			local avatar = Instance.new("ImageLabel")
			avatar.Name = "Avatar"
			avatar.Size = UDim2.new(0, 32, 0, 32)
			avatar.BackgroundTransparency = 1
			avatar.Image = avatarUrl
			avatar.LayoutOrder = 2
			avatar.Parent = headerFrame
		end
	else
		local roleLabel = Instance.new("TextLabel")
		roleLabel.Name = "RoleLabel"
		roleLabel.Size = UDim2.new(1, 0, 0, 16)
		roleLabel.BackgroundTransparency = 1
		roleLabel.Text = "Assistant"
		roleLabel.TextColor3 = Theme.TextMuted
		roleLabel.Font = Theme.FontBold
		roleLabel.TextSize = Theme.TextSizeSmall
		roleLabel.TextXAlignment = Enum.TextXAlignment.Left
		roleLabel.Parent = container
	end

	-- Bubble frame
	local bubble = Instance.new("Frame")
	bubble.Name = "Bubble"
	bubble.Size = UDim2.new(0.85, 0, 0, 0)
	bubble.Position = isUser and UDim2.new(1, -Theme.PaddingRegular, 0, 38) or UDim2.new(0, Theme.PaddingRegular, 0, 18)
	bubble.AnchorPoint = isUser and Vector2.new(1, 0) or Vector2.new(0, 0)
	bubble.BackgroundColor3 = isUser and Theme.UserBubbleBg or Theme.AssistantBubbleBg
	bubble.BorderSizePixel = 0
	bubble.AutomaticSize = Enum.AutomaticSize.Y
	bubble.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadiusLarge)
	corner.Parent = bubble

	local bubblePadding = Instance.new("UIPadding")
	bubblePadding.PaddingTop = UDim.new(0, Theme.PaddingRegular)
	bubblePadding.PaddingBottom = UDim.new(0, Theme.PaddingRegular)
	bubblePadding.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	bubblePadding.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	bubblePadding.Parent = bubble

	-- Parts container
	local partsFrame = Instance.new("Frame")
	partsFrame.Name = "Parts"
	partsFrame.Size = UDim2.new(1, 0, 0, 0)
	partsFrame.BackgroundTransparency = 1
	partsFrame.AutomaticSize = Enum.AutomaticSize.Y
	partsFrame.Parent = bubble

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 6)
	layout.Parent = partsFrame

	if isUser then
		-- User: simple text
		local label = Instance.new("TextLabel")
		label.Name = "Text"
		label.Size = UDim2.new(1, 0, 0, 0)
		label.BackgroundTransparency = 1
		label.Text = asString(message.content)
		label.TextColor3 = Theme.UserBubbleText
		label.Font = Theme.FontRegular
		label.TextSize = Theme.TextSizeRegular
		label.TextWrapped = true
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.AutomaticSize = Enum.AutomaticSize.Y
		label.Parent = partsFrame
	else
		-- Assistant: check for errors first
		local isError, errorData = detectError(message.content)
		if isError then
			renderErrorPart(errorData, partsFrame)
		elseif message.parts and #message.parts > 0 then
			-- Check if there's a reasoning part before a text part (for streaming)
			local hasReasoningBeforeText = false
			for i, part in ipairs(message.parts) do
				if part.type == "reasoning" then
					hasReasoningBeforeText = true
				elseif part.type == "text" and hasReasoningBeforeText then
					break
				end
			end

			for idx, part in ipairs(message.parts) do
				local partType = part.type
				local rendered = nil

				if partType == "text" and hasReasoningBeforeText then
					-- Wrap text part in a StreamingText frame so it can be updated independently
					local streamingFrame = Instance.new("Frame")
					streamingFrame.Name = "StreamingText"
					streamingFrame.Size = UDim2.new(1, 0, 0, 0)
					streamingFrame.BackgroundTransparency = 1
					streamingFrame.AutomaticSize = Enum.AutomaticSize.Y
					streamingFrame.Parent = partsFrame

					local text = asString(part.text)
					if text ~= "" then
						local blocks = MarkdownParser.parseBlocks(text)
						MarkdownParser.renderToFrame(blocks, streamingFrame)
					end

					rendered = streamingFrame
				elseif partType == "text" then
					rendered = renderTextPart(part, partsFrame)
				elseif partType == "reasoning" then
					rendered = renderReasoningPart(part, partsFrame)
				elseif partType == "tool" then
					rendered = renderToolPart(part, partsFrame)
				elseif partType == "step-finish" then
					rendered = renderStepFinishPart(part, partsFrame)
				elseif partType == "retry" then
					rendered = renderRetryPart(part, partsFrame)
				elseif partType == "compaction" then
					local label = Instance.new("TextLabel")
					label.Size = UDim2.new(1, 0, 0, 16)
					label.BackgroundTransparency = 1
					label.Text = "📦 Context compacted"
					label.TextColor3 = Theme.TextMuted
					label.Font = Theme.FontRegular
					label.TextSize = Theme.TextSizeSmall
					label.TextXAlignment = Enum.TextXAlignment.Left
					label.Parent = partsFrame
					rendered = label
				end

				if rendered then
					rendered.LayoutOrder = idx
				end
			end
		else
			-- No parts — show content as fallback
			local blocks = MarkdownParser.parseBlocks(asString(message.content))
			MarkdownParser.renderToFrame(blocks, partsFrame)
		end
	end

	return container
end

-- Update an existing assistant bubble with new content (used for live streaming)
function MessageBubble.updateContent(container: Frame, newContent: string)
	local bubble = container:FindFirstChild("Bubble")
	if not bubble then return end

	local partsFrame = bubble:FindFirstChild("Parts")
	if not partsFrame then return end

	-- Check if there's a dedicated streaming text frame
	local streamingFrame = partsFrame:FindFirstChild("StreamingText")
	if streamingFrame then
		-- Only update the streaming text portion, preserve reasoning etc.
		for _, child in ipairs(streamingFrame:GetChildren()) do
			if child:IsA("GuiObject") then
				child:Destroy()
			end
		end
		local blocks = MarkdownParser.parseBlocks(newContent or "")
		MarkdownParser.renderToFrame(blocks, streamingFrame)
	else
		-- No streaming frame — clear and re-render everything
		for _, child in ipairs(partsFrame:GetChildren()) do
			if child:IsA("GuiObject") then
				child:Destroy()
			end
		end

		local blocks = MarkdownParser.parseBlocks(newContent or "")
		MarkdownParser.renderToFrame(blocks, partsFrame)
	end
end

return MessageBubble
