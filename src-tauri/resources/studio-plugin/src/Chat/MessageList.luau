-- Chat/MessageList.lua
-- Scrolling message list with auto-scroll, typing indicator, and streaming support

local Theme = require(script.Parent.Parent.Theme)
local MessageBubble = require(script.Parent.MessageBubble)

local TweenService = game:GetService("TweenService")
local TextService = game:GetService("TextService")

local MessageList = {}
MessageList._scrollingFrame = nil
MessageList._contentFrame = nil
MessageList._messages = {}
MessageList._typingBubble = nil
MessageList._typingConnection = nil
MessageList._streamingBubble = nil
MessageList._streamBuffer = ""
MessageList._streamLastRender = 0
MessageList._streamRenderPending = false
MessageList._userScrolledUp = false
MessageList._scrollToLatestBtn = nil
MessageList._activeScrollTween = nil
MessageList._typingDotTweens = {}
MessageList._loadingBubble = nil

local SCROLL_TWEEN_INFO = TweenInfo.new(
	0.5,
	Enum.EasingStyle.Cubic,
	Enum.EasingDirection.InOut
)

function MessageList.create(parent: Instance): ScrollingFrame
	local scrollingFrame = Instance.new("ScrollingFrame")
	scrollingFrame.Name = "MessageList"
	scrollingFrame.Size = UDim2.new(1, 0, 1, 0)
	scrollingFrame.BackgroundTransparency = 1
	scrollingFrame.BorderSizePixel = 0
	scrollingFrame.ScrollBarThickness = 4
	scrollingFrame.ScrollBarImageColor3 = Theme.Border
	scrollingFrame.ScrollBarImageTransparency = 0.5
	scrollingFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
	scrollingFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scrollingFrame.Parent = parent
	
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 2)
	layout.Parent = scrollingFrame
	
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, Theme.PaddingRegular)
	padding.PaddingBottom = UDim.new(0, Theme.PaddingRegular)
	padding.Parent = scrollingFrame
	
	MessageList._scrollingFrame = scrollingFrame
	MessageList._contentFrame = scrollingFrame
	MessageList._messages = {}
	MessageList._userScrolledUp = false
	
	-- Floating "Scroll to latest" button (sibling in parent, above chat input)
	local scrollBtn = Instance.new("TextButton")
	scrollBtn.Name = "ScrollToLatestBtn"
	scrollBtn.Size = UDim2.new(0, 110, 0, 26)
	scrollBtn.Position = UDim2.new(0.5, -55, 1, -130)
	scrollBtn.AnchorPoint = Vector2.new(0, 0)
	scrollBtn.BackgroundColor3 = Theme.BgSecondary
	scrollBtn.BorderSizePixel = 0
	scrollBtn.Text = "New messages ↓"
	scrollBtn.TextColor3 = Theme.TextPrimary
	scrollBtn.Font = Theme.FontBold
	scrollBtn.TextSize = Theme.TextSizeSmall
	scrollBtn.Visible = false
	scrollBtn.ZIndex = 10
	scrollBtn.Parent = parent
	
	local btnStroke = Instance.new("UIStroke")
	btnStroke.Color = Theme.Border
	btnStroke.Thickness = 1
	btnStroke.Parent = scrollBtn
	
	local btnCorner = Instance.new("UICorner")
	btnCorner.CornerRadius = UDim.new(0, Theme.BorderRadiusLarge)
	btnCorner.Parent = scrollBtn
	
	scrollBtn.Activated:Connect(function()
		MessageList._scrollToBottom(true)
		MessageList._userScrolledUp = false
		MessageList._updateScrollButton()
	end)
	
	MessageList._scrollToLatestBtn = scrollBtn
	
	-- Track user scroll position
	scrollingFrame:GetPropertyChangedSignal("CanvasPosition"):Connect(function()
		local isNearBottom = MessageList._isNearBottom()
		if not isNearBottom and not MessageList._userScrolledUp then
			MessageList._userScrolledUp = true
			MessageList._updateScrollButton()
		elseif isNearBottom and MessageList._userScrolledUp then
			MessageList._userScrolledUp = false
			MessageList._updateScrollButton()
		end
	end)
	
	-- Auto-scroll on new messages (only if user is near bottom)
	layout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
		local contentSize = layout.AbsoluteContentSize
		scrollingFrame.CanvasSize = UDim2.new(0, 0, 0, contentSize.Y + Theme.PaddingRegular * 2)
		
		if not MessageList._userScrolledUp then
			MessageList._tweenScrollTo(contentSize.Y)
		else
			MessageList._updateScrollButton()
		end
	end)
	
	return scrollingFrame
end

function MessageList._isNearBottom(): boolean
	if not MessageList._scrollingFrame then return true end
	local sf = MessageList._scrollingFrame
	local contentSize = sf.CanvasSize.Y.Offset
	local viewBottom = sf.CanvasPosition.Y + sf.AbsoluteSize.Y
	return viewBottom >= contentSize - 60
end

function MessageList._updateScrollButton()
	if not MessageList._scrollToLatestBtn then return end
	local hasNewContent = MessageList._userScrolledUp and MessageList._scrollingFrame ~= nil
	MessageList._scrollToLatestBtn.Visible = hasNewContent
end

function MessageList.addMessage(message: {
	role: "user" | "assistant",
	content: string,
	parts: {any}?,
}): Instance?
	if not MessageList._contentFrame then return nil end

	local content = message.content or ""
	local isError = content:match("^Error:") or content:match("^🚨")

	-- If this is a successful assistant message, clear all previous error messages
	if message.role == "assistant" and not isError then
		-- Remove error bubbles from UI
		for _, child in ipairs(MessageList._contentFrame:GetChildren()) do
			if child:IsA("Frame") and child.Name == "MessageContainer" then
				local bubble = child:FindFirstChild("Bubble")
				if bubble then
					local partsFrame = bubble:FindFirstChild("Parts")
					if partsFrame then
						local errPart = partsFrame:FindFirstChild("ErrorPart")
						if errPart then
							child:Destroy()
						end
					end
				end
			end
		end
		-- Remove error entries from messages array
		local cleaned = {}
		for _, msg in ipairs(MessageList._messages) do
			local msgContent = msg.content or ""
			local msgIsError = msgContent:match("^Error:") or msgContent:match("^🚨")
			if not (msg.role == "assistant" and msgIsError) then
				table.insert(cleaned, msg)
			end
		end
		MessageList._messages = cleaned
	end

	table.insert(MessageList._messages, message)

	local bubble = MessageBubble.create(MessageList._contentFrame, message)

	-- Error messages always sink to the bottom (below tool cards)
	if isError then
		bubble.LayoutOrder = 200000
	else
		bubble.LayoutOrder = #MessageList._messages
	end

	return bubble
end

-- ── Typing Indicator ─────────────────────────────────────────────────────

function MessageList.showTypingIndicator()
	if not MessageList._contentFrame then return end
	if MessageList._typingBubble then return end

	local container = Instance.new("Frame")
	container.Name = "TypingIndicator"
	container.Size = UDim2.new(1, 0, 0, 58)
	container.BackgroundTransparency = 1
	container.LayoutOrder = #MessageList._messages + 1
	container.Parent = MessageList._contentFrame

	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, Theme.PaddingSmall)
	pad.PaddingBottom = UDim.new(0, Theme.PaddingSmall)
	pad.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	pad.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	pad.Parent = container

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

	local bubble = Instance.new("Frame")
	bubble.Name = "Bubble"
	bubble.Size = UDim2.new(0, 120, 0, 36)
	bubble.Position = UDim2.new(0, 0, 0, 18)
	bubble.BackgroundColor3 = Theme.AssistantBubbleBg
	bubble.BorderSizePixel = 0
	bubble.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadiusLarge)
	corner.Parent = bubble

	local bubblePad = Instance.new("UIPadding")
	bubblePad.PaddingTop = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingBottom = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	bubblePad.Parent = bubble

	-- Content frame with horizontal layout for text + dots
	local contentFrame = Instance.new("Frame")
	contentFrame.Name = "Content"
	contentFrame.Size = UDim2.new(1, 0, 1, 0)
	contentFrame.BackgroundTransparency = 1
	contentFrame.Parent = bubble

	local contentLayout = Instance.new("UIListLayout")
	contentLayout.FillDirection = Enum.FillDirection.Horizontal
	contentLayout.SortOrder = Enum.SortOrder.LayoutOrder
	contentLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	contentLayout.Padding = UDim.new(0, 6)
	contentLayout.Parent = contentFrame

	local textLabel = Instance.new("TextLabel")
	textLabel.Name = "Text"
	textLabel.Size = UDim2.new(0, 0, 0, 20)
	textLabel.AutomaticSize = Enum.AutomaticSize.X
	textLabel.BackgroundTransparency = 1
	textLabel.Text = "Thinking"
	textLabel.TextColor3 = Theme.TextMuted
	textLabel.Font = Theme.FontRegular
	textLabel.TextSize = Theme.TextSizeRegular
	textLabel.TextXAlignment = Enum.TextXAlignment.Left
	textLabel.LayoutOrder = 1
	textLabel.Parent = contentFrame

	-- Dots frame with 3 animated dots
	local dotsFrame = Instance.new("Frame")
	dotsFrame.Name = "Dots"
	dotsFrame.Size = UDim2.new(0, 32, 0, 20)
	dotsFrame.BackgroundTransparency = 1
	dotsFrame.LayoutOrder = 2
	dotsFrame.Parent = contentFrame

	local dotsLayout = Instance.new("UIListLayout")
	dotsLayout.FillDirection = Enum.FillDirection.Horizontal
	dotsLayout.SortOrder = Enum.SortOrder.LayoutOrder
	dotsLayout.Padding = UDim.new(0, 4)
	dotsLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	dotsLayout.Parent = dotsFrame

	local dotsPadding = Instance.new("UIPadding")
	dotsPadding.PaddingTop = UDim.new(0, 7)
	dotsPadding.PaddingBottom = UDim.new(0, 7)
	dotsPadding.Parent = dotsFrame

	local dotTweens = {}
	for i = 1, 3 do
		local dot = Instance.new("Frame")
		dot.Name = "Dot" .. i
		dot.Size = UDim2.new(0, 6, 0, 6)
		dot.BackgroundColor3 = Theme.Accent
		dot.BorderSizePixel = 0
		dot.LayoutOrder = i
		dot.Parent = dotsFrame

		local dotCornerInstance = Instance.new("UICorner")
		dotCornerInstance.CornerRadius = UDim.new(1, 0)
		dotCornerInstance.Parent = dot

		-- UIGradient shimmer effect
		local gradient = Instance.new("UIGradient")
		gradient.Color = ColorSequence.new({
			ColorSequenceKeypoint.new(0, Theme.Accent),
			ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 255, 255)),
			ColorSequenceKeypoint.new(1, Theme.Accent),
		})
		gradient.Offset = Vector2.new(-1, 0)
		gradient.Parent = dot

		-- Staggered pulse animation
		local pulseInfo = TweenInfo.new(0.6, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
		local delay = (i - 1) * 0.2

		task.delay(delay, function()
			if not dot or not dot.Parent then return end
			local pulseTween = TweenService:Create(dot, pulseInfo, {BackgroundTransparency = 0.7})
			pulseTween:Play()
			table.insert(dotTweens, pulseTween)
		end)

		-- Shimmer sweep animation
		local shimmerInfo = TweenInfo.new(1.5, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1, false)
		task.delay(delay * 0.5, function()
			if not dot or not dot.Parent then return end
			local shimmerTween = TweenService:Create(gradient, shimmerInfo, {Offset = Vector2.new(1, 0)})
			shimmerTween:Play()
			table.insert(dotTweens, shimmerTween)
		end)
	end

	MessageList._typingBubble = container
	MessageList._typingDotTweens = dotTweens

	MessageList._scrollToBottom()
end

function MessageList.hideTypingIndicator()
	-- Cancel dot tweens
	for _, tween in ipairs(MessageList._typingDotTweens) do
		pcall(function() tween:Cancel() end)
	end
	MessageList._typingDotTweens = {}

	if MessageList._typingBubble then
		MessageList._typingBubble:Destroy()
		MessageList._typingBubble = nil
	end
end

function MessageList.showLoadingIndicator()
	if not MessageList._contentFrame then return end
	if MessageList._loadingBubble then return end

	local container = Instance.new("Frame")
	container.Name = "LoadingIndicator"
	container.Size = UDim2.new(1, 0, 0, 58)
	container.BackgroundTransparency = 1
	container.LayoutOrder = #MessageList._messages + 1
	container.Parent = MessageList._contentFrame

	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, Theme.PaddingSmall)
	pad.PaddingBottom = UDim.new(0, Theme.PaddingSmall)
	pad.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	pad.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	pad.Parent = container

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

	local bubble = Instance.new("Frame")
	bubble.Name = "Bubble"
	bubble.Size = UDim2.new(0, 120, 0, 36)
	bubble.Position = UDim2.new(0, 0, 0, 18)
	bubble.BackgroundColor3 = Theme.AssistantBubbleBg
	bubble.BorderSizePixel = 0
	bubble.Parent = container

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadiusLarge)
	corner.Parent = bubble

	local bubblePad = Instance.new("UIPadding")
	bubblePad.PaddingTop = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingBottom = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	bubblePad.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	bubblePad.Parent = bubble

	local contentFrame = Instance.new("Frame")
	contentFrame.Name = "Content"
	contentFrame.Size = UDim2.new(1, 0, 1, 0)
	contentFrame.BackgroundTransparency = 1
	contentFrame.Parent = bubble

	local contentLayout = Instance.new("UIListLayout")
	contentLayout.FillDirection = Enum.FillDirection.Horizontal
	contentLayout.SortOrder = Enum.SortOrder.LayoutOrder
	contentLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	contentLayout.Padding = UDim.new(0, 6)
	contentLayout.Parent = contentFrame

	local textLabel = Instance.new("TextLabel")
	textLabel.Name = "Text"
	textLabel.Size = UDim2.new(0, 0, 0, 20)
	textLabel.AutomaticSize = Enum.AutomaticSize.X
	textLabel.BackgroundTransparency = 1
	textLabel.Text = "Loading..."
	textLabel.TextColor3 = Theme.TextMuted
	textLabel.Font = Theme.FontRegular
	textLabel.TextSize = Theme.TextSizeRegular
	textLabel.TextXAlignment = Enum.TextXAlignment.Left
	textLabel.LayoutOrder = 1
	textLabel.Parent = contentFrame

	-- Spinner frame with 3 animated dots
	local dotsFrame = Instance.new("Frame")
	dotsFrame.Name = "Dots"
	dotsFrame.Size = UDim2.new(0, 32, 0, 20)
	dotsFrame.BackgroundTransparency = 1
	dotsFrame.LayoutOrder = 2
	dotsFrame.Parent = contentFrame

	local dotsLayout = Instance.new("UIListLayout")
	dotsLayout.FillDirection = Enum.FillDirection.Horizontal
	dotsLayout.SortOrder = Enum.SortOrder.LayoutOrder
	dotsLayout.Padding = UDim.new(0, 4)
	dotsLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	dotsLayout.Parent = dotsFrame

	for i = 1, 3 do
		local dot = Instance.new("Frame")
		dot.Name = "Dot" .. i
		dot.Size = UDim2.new(0, 6, 0, 6)
		dot.BackgroundColor3 = Theme.Accent
		dot.BorderSizePixel = 0
		dot.LayoutOrder = i
		dot.Parent = dotsFrame

		local dotCornerInstance = Instance.new("UICorner")
		dotCornerInstance.CornerRadius = UDim.new(1, 0)
		dotCornerInstance.Parent = dot

		local pulseInfo = TweenInfo.new(0.6, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
		local delay = (i - 1) * 0.2

		task.delay(delay, function()
			if not dot or not dot.Parent then return end
			local pulseTween = TweenService:Create(dot, pulseInfo, {BackgroundTransparency = 0.7})
			pulseTween:Play()
			table.insert(MessageList._typingDotTweens, pulseTween)
		end)
	end

	MessageList._loadingBubble = container
	MessageList._scrollToBottom()
end

function MessageList.hideLoadingIndicator()
	if MessageList._loadingBubble then
		MessageList._loadingBubble:Destroy()
		MessageList._loadingBubble = nil
	end
end

function MessageList.updateTypingText(text: string)
	if not MessageList._typingBubble then return end
	local bubble = MessageList._typingBubble:FindFirstChild("Bubble", true)
	if not bubble then return end
	local contentFrame = bubble:FindFirstChild("Content")
	if not contentFrame then return end

	local textLabel = contentFrame:FindFirstChild("Text")
	local dotsFrame = contentFrame:FindFirstChild("Dots")

	if textLabel then
		textLabel.Text = text
		textLabel.TextTruncate = Enum.TextTruncate.None
	end

	-- Show dots only for "Thinking", hide for custom text
	if dotsFrame then
		dotsFrame.Visible = (text == "Thinking")
	end

	-- Auto-size bubble to fit text
	local availableWidth = MessageList._contentFrame.AbsoluteSize.X - 40
	local fontSize = textLabel and textLabel.TextSize or Theme.TextSizeRegular
	local font = textLabel and textLabel.Font or Theme.FontRegular
	local textBounds = TextService:GetTextSize(
		text,
		fontSize,
		font,
		Vector2.new(availableWidth, 1000)
	)
	local dotsWidth = (text == "Thinking") and 38 or 0
	local newWidth = math.max(80, textBounds.X + 24 + dotsWidth)
	local newHeight = math.max(36, textBounds.Y + 16)
	bubble.Size = UDim2.new(0, newWidth, 0, newHeight)

	-- Also resize container
	MessageList._typingBubble.Size = UDim2.new(1, 0, 0, newHeight + 26)
end

-- ── Tool Status Cards ─────────────────────────────────────────────────────

function MessageList.addToolStatus(toolName: string, status: string)
	if not MessageList._contentFrame then return end

	-- Check if a card for this exact tool already exists (hasn't been completed yet)
	local existingCard = MessageList._contentFrame:FindFirstChild("ToolCard_" .. toolName)
	if existingCard then
		-- Card already exists for this tool run, skip duplicate
		return
	end

	local card = Instance.new("Frame")
	card.Name = "ToolCard_" .. toolName
	card.LayoutOrder = 10000 + (#MessageList._messages) -- Always after messages
	card.Size = UDim2.new(1, 0, 0, 0)
	card.BackgroundTransparency = 1
	card.AutomaticSize = Enum.AutomaticSize.Y
	card.Parent = MessageList._contentFrame

	local pad = Instance.new("UIPadding")
	pad.PaddingLeft = UDim.new(0, Theme.PaddingRegular)
	pad.PaddingRight = UDim.new(0, Theme.PaddingRegular)
	pad.PaddingTop = UDim.new(0, 2)
	pad.PaddingBottom = UDim.new(0, 2)
	pad.Parent = card

	local inner = Instance.new("Frame")
	inner.Name = "Inner"
	inner.Size = UDim2.new(1, 0, 0, 0)
	inner.BackgroundColor3 = Theme.BgSecondary
	inner.BorderSizePixel = 0
	inner.AutomaticSize = Enum.AutomaticSize.Y
	inner.Parent = card

	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = inner

	local innerPad = Instance.new("UIPadding")
	innerPad.PaddingLeft = UDim.new(0, 10)
	innerPad.PaddingRight = UDim.new(0, 8)
	innerPad.PaddingTop = UDim.new(0, 8)
	innerPad.PaddingBottom = UDim.new(0, 8)
	innerPad.Parent = inner

	local leftAccent = Instance.new("Frame")
	leftAccent.Name = "Accent"
	leftAccent.Size = UDim2.new(0, 3, 1, 0)
	leftAccent.Position = UDim2.new(0, -7, 0, 0)
	leftAccent.BackgroundColor3 = Theme.StatusConnecting
	leftAccent.BorderSizePixel = 0
	leftAccent.Parent = inner

	local label = Instance.new("TextLabel")
	label.Name = "StatusLabel"
	label.Size = UDim2.new(1, 0, 0, 20)
	label.BackgroundTransparency = 1
	label.Text = "⏳ " .. toolName
	label.TextColor3 = Theme.TextPrimary
	label.Font = Theme.FontBold
	label.TextSize = Theme.TextSizeSmall
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextYAlignment = Enum.TextYAlignment.Bottom
	label.Parent = inner

	local resultLabel = Instance.new("TextLabel")
	resultLabel.Name = "ResultLabel"
	resultLabel.Size = UDim2.new(1, 0, 0, 0)
	resultLabel.Position = UDim2.new(0, 0, 0, -5)
	resultLabel.BackgroundTransparency = 1
	resultLabel.Text = ""
	resultLabel.TextColor3 = Theme.TextSecondary
	resultLabel.Font = Theme.FontRegular
	resultLabel.TextSize = Theme.TextSizeSmall
	resultLabel.TextWrapped = true
	resultLabel.TextXAlignment = Enum.TextXAlignment.Left
	resultLabel.AutomaticSize = Enum.AutomaticSize.Y
	resultLabel.Visible = false
	resultLabel.Parent = inner

	MessageList._scrollToBottom()
end

function MessageList.updateToolStatus(toolName: string, status: string, resultText: string?)
	if not MessageList._contentFrame then return end

	-- Find the card for this tool
	local cardName = "ToolCard_" .. toolName
	local card = MessageList._contentFrame:FindFirstChild(cardName)
	if not card then return end

	local inner = card:FindFirstChild("Inner")
	if not inner then return end

	local accent = inner:FindFirstChild("Accent")
	local statusLabel = inner:FindFirstChild("StatusLabel")
	local resultLabel = inner:FindFirstChild("ResultLabel")

	if status == "completed" then
		if accent then accent.BackgroundColor3 = Theme.StatusConnected end
		if statusLabel then statusLabel.Text = "✅ " .. toolName end
	elseif status == "error" then
		if accent then accent.BackgroundColor3 = Theme.StatusDisconnected end
		if statusLabel then statusLabel.Text = "❌ " .. toolName end
	end

	if resultText and resultText ~= "" and resultLabel then
		resultLabel.Text = resultText
		resultLabel.Visible = true
	end

	MessageList._scrollToBottom()
end

-- ── Streaming Message ────────────────────────────────────────────────────

function MessageList.startStreamingMessage(reasoning: string?)
	if not MessageList._contentFrame then return end
	MessageList.hideTypingIndicator()
	MessageList._destroyStreamingBubble()

	-- Build message with optional reasoning part
	local parts = {}
	if reasoning and reasoning ~= "" then
		table.insert(parts, {
			type = "reasoning",
			text = reasoning,
		})
	end
	table.insert(parts, {
		type = "text",
		text = "",
	})

	-- Add placeholder message
	table.insert(MessageList._messages, {
		role = "assistant",
		content = "",
		parts = parts,
	})

	local bubble = MessageBubble.create(MessageList._contentFrame, {
		role = "assistant",
		content = "",
		parts = parts,
	})
	bubble.LayoutOrder = #MessageList._messages
	MessageList._streamingBubble = bubble
	MessageList._streamBuffer = ""
	MessageList._streamLastRender = DateTime.now().UnixTimestampMillis
	MessageList._streamRenderPending = false

	MessageList._scrollToBottom()
end

function MessageList.appendStreamingText(chunk: string)
	MessageList._streamBuffer = MessageList._streamBuffer .. chunk

	local now = DateTime.now().UnixTimestampMillis
	if now - MessageList._streamLastRender >= 50 then
		MessageList._renderStreamBuffer()
	elseif not MessageList._streamRenderPending then
		MessageList._streamRenderPending = true
		task.delay(0.05, function()
			MessageList._streamRenderPending = false
			MessageList._renderStreamBuffer()
		end)
	end
end

function MessageList._renderStreamBuffer()
	if not MessageList._streamingBubble then return end
	MessageList._streamLastRender = DateTime.now().UnixTimestampMillis

	local msg = MessageList._messages[#MessageList._messages]
	if msg then
		msg.content = MessageList._streamBuffer
	end

	MessageBubble.updateContent(MessageList._streamingBubble, MessageList._streamBuffer)
	
	if not MessageList._userScrolledUp then
		MessageList._scrollToBottom()
	end
end

function MessageList.finishStreamingMessage(): string
	local fullText = MessageList._streamBuffer

	-- Final render to ensure last characters are shown
	MessageList._renderStreamBuffer()

	-- Update the last message in our array
	if #MessageList._messages > 0 then
		local msg = MessageList._messages[#MessageList._messages]
		msg.content = fullText
		-- Also update the text part in parts array
		if msg.parts then
			for _, part in ipairs(msg.parts) do
				if part.type == "text" then
					part.text = fullText
				end
			end
		end
	end

	MessageList._streamingBubble = nil
	MessageList._streamBuffer = ""
	MessageList._streamRenderPending = false

	MessageList._scrollToBottom()
	return fullText
end

function MessageList._destroyStreamingBubble()
	-- The streaming bubble becomes a regular bubble, so we don't destroy it
	MessageList._streamingBubble = nil
	MessageList._streamBuffer = ""
end

function MessageList._tweenScrollTo(targetY: number)
	if not MessageList._scrollingFrame then return end
	if MessageList._activeScrollTween then
		MessageList._activeScrollTween:Cancel()
		MessageList._activeScrollTween = nil
	end
	local tween = TweenService:Create(
		MessageList._scrollingFrame,
		SCROLL_TWEEN_INFO,
		{CanvasPosition = Vector2.new(0, targetY)}
	)
	MessageList._activeScrollTween = tween
	tween.Completed:Connect(function()
		if MessageList._activeScrollTween == tween then
			MessageList._activeScrollTween = nil
		end
	end)
	tween:Play()
end

function MessageList._scrollToBottom(force: boolean?)
	local layout = MessageList._contentFrame and MessageList._contentFrame:FindFirstChildOfClass("UIListLayout")
	if layout and MessageList._scrollingFrame then
		if force or not MessageList._userScrolledUp then
			local contentSize = layout.AbsoluteContentSize
			MessageList._tweenScrollTo(contentSize.Y)
		end
	end
end

-- ── Lifecycle ────────────────────────────────────────────────────────────

function MessageList.clear()
	if not MessageList._contentFrame then return end

	MessageList.hideTypingIndicator()
	MessageList.hideLoadingIndicator()
	MessageList._destroyStreamingBubble()

	for _, child in ipairs(MessageList._contentFrame:GetChildren()) do
		if child:IsA("Frame") or child:IsA("TextLabel") or child:IsA("TextButton") then
			child:Destroy()
		end
	end
	
	MessageList._messages = {}
	MessageList._userScrolledUp = false
	if MessageList._scrollToLatestBtn then
		MessageList._scrollToLatestBtn.Visible = false
	end
end

function MessageList.setMessages(messages: {{
	role: "user" | "assistant",
	content: string,
	parts: {any}?,
}})
	MessageList.clear()
	for _, msg in ipairs(messages) do
		MessageList.addMessage(msg)
	end
end

function MessageList.destroy()
	if MessageList._activeScrollTween then
		MessageList._activeScrollTween:Cancel()
		MessageList._activeScrollTween = nil
	end
	for _, tween in ipairs(MessageList._typingDotTweens) do
		pcall(function() tween:Cancel() end)
	end
	MessageList._typingDotTweens = {}
	MessageList.hideTypingIndicator()
	MessageList.hideLoadingIndicator()
	MessageList._destroyStreamingBubble()
	if MessageList._scrollToLatestBtn then
		MessageList._scrollToLatestBtn:Destroy()
		MessageList._scrollToLatestBtn = nil
	end
	if MessageList._scrollingFrame then
		MessageList._scrollingFrame:Destroy()
		MessageList._scrollingFrame = nil
		MessageList._contentFrame = nil
		MessageList._messages = {}
	end
end

return MessageList
