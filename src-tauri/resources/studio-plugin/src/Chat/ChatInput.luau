-- Chat/ChatInput.lua
-- Text input area with send button, context toggles, thinking level, and instance attachments

local Theme = require(script.Parent.Parent.Theme)
local UserInputService = game:GetService("UserInputService")
local TweenService = game:GetService("TweenService")
local StudioService = game:GetService("StudioService")

local ChatInput = {}
ChatInput._frame = nil
ChatInput._textBox = nil
ChatInput._sendButton = nil
ChatInput._onSend = nil
ChatInput._onAttach = nil
ChatInput._onAttachmentClick = nil
ChatInput._onSnippetClick = nil
ChatInput._toggles = {}
ChatInput._preview = {}      -- from Studio selection (grey, not included in context)
ChatInput._attachments = {}  -- user-confirmed instances (included in context)
ChatInput._snippetPreview = nil   -- from editor selection (grey, not included)
ChatInput._snippetAttachment = nil -- user-confirmed snippet (included in context)
ChatInput._attachmentsFrame = nil
ChatInput._textBoxFrame = nil
ChatInput._inputContainer = nil
ChatInput._sendConnection = nil
ChatInput._stopConnection = nil
ChatInput._isStopMode = false

-- Placeholder icon for classes without icons (Studio's built-in placeholder)
local PLACEHOLDER_ICON = "rbxasset://studio_svg_textures/Shared/Placeholder/Dark/Standard/Placeholder.png"

function ChatInput.create(
	parent: Instance,
	onSend: (
		text: string,
		context: {selection: boolean, scripts: boolean, structure: boolean, thinkingLevel: string},
		attachments: {Instance},
		snippets: {{script: LuaSourceContainer, startLine: number, endLine: number, text: string}}
	) -> ()
): Frame
	ChatInput._onSend = onSend
	
	local frame = Instance.new("Frame")
	frame.Name = "ChatInput"
	frame.Size = UDim2.new(1, 0, 0, 100)
	frame.BackgroundColor3 = Theme.BgSecondary
	frame.BorderSizePixel = 0
	frame.Parent = parent
	
	local topBorder = Instance.new("Frame")
	topBorder.Name = "Border"
	topBorder.Size = UDim2.new(1, 0, 0, 1)
	topBorder.BackgroundColor3 = Theme.Border
	topBorder.BorderSizePixel = 0
	topBorder.Parent = frame
	
	-- Toggles + Attach button row
	local togglesFrame = Instance.new("Frame")
	togglesFrame.Name = "Toggles"
	togglesFrame.Size = UDim2.new(1, -Theme.PaddingRegular * 2, 0, 22)
	togglesFrame.Position = UDim2.new(0, Theme.PaddingRegular, 0, Theme.PaddingSmall)
	togglesFrame.BackgroundTransparency = 1
	togglesFrame.Parent = frame
	
	-- Context toggles
	local toggles = {
		{ id = "selection", label = "Selection", default = true },
		{ id = "scripts", label = "Scripts", default = false },
		{ id = "structure", label = "Place", default = false },
	}
	
	local xOffset = 0
	for _, toggleInfo in ipairs(toggles) do
		local toggle = ChatInput._createToggle(togglesFrame, toggleInfo, xOffset)
		ChatInput._toggles[toggleInfo.id] = toggle
		xOffset += 70
	end
	
	-- Thinking level toggle (3-state: off → low → high → off)
	local thinkingToggle = ChatInput._createThinkingToggle(togglesFrame, xOffset)
	ChatInput._toggles.thinking = thinkingToggle
	xOffset += 70
	
	-- Attach button
	local attachBtn = Instance.new("TextButton")
	attachBtn.Name = "AttachBtn"
	attachBtn.Size = UDim2.new(0, 22, 0, 22)
	attachBtn.Position = UDim2.new(1, -22, 0, 0)
	attachBtn.BackgroundTransparency = 1
	attachBtn.Text = "📎"
	attachBtn.TextColor3 = Theme.TextSecondary
	attachBtn.Font = Theme.FontRegular
	attachBtn.TextSize = 14
	attachBtn.Parent = togglesFrame
	
	attachBtn.Activated:Connect(function()
		if ChatInput._onAttach then
			ChatInput._onAttach()
		end
	end)
	
	-- Unified input container
	local inputContainer = Instance.new("Frame")
	inputContainer.Name = "InputContainer"
	inputContainer.Size = UDim2.new(1, -Theme.PaddingRegular * 2, 1, -34)
	inputContainer.Position = UDim2.new(0, Theme.PaddingRegular, 0, 30)
	inputContainer.BackgroundColor3 = Theme.BgInput
	inputContainer.BorderSizePixel = 0
	inputContainer.Parent = frame
	
	local inputStroke = Instance.new("UIStroke")
	inputStroke.Color = Theme.Border
	inputStroke.Thickness = 1
	inputStroke.Parent = inputContainer
	
	local inputCorner = Instance.new("UICorner")
	inputCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	inputCorner.Parent = inputContainer
	
	ChatInput._inputContainer = inputContainer
	ChatInput._inputStroke = inputStroke
	
	-- Attachments chips row (inside input container)
	local attachmentsFrame = Instance.new("Frame")
	attachmentsFrame.Name = "Attachments"
	attachmentsFrame.Size = UDim2.new(1, 0, 0, 26)
	attachmentsFrame.Position = UDim2.new(0, 0, 0, 0)
	attachmentsFrame.BackgroundTransparency = 1
	attachmentsFrame.Visible = false
	attachmentsFrame.ClipsDescendants = true
	attachmentsFrame.Parent = inputContainer
	
	local attLayout = Instance.new("UIListLayout")
	attLayout.SortOrder = Enum.SortOrder.LayoutOrder
	attLayout.FillDirection = Enum.FillDirection.Horizontal
	attLayout.Padding = UDim.new(0, 6)
	attLayout.VerticalAlignment = Enum.VerticalAlignment.Center
	attLayout.Parent = attachmentsFrame
	
	local attPad = Instance.new("UIPadding")
	attPad.PaddingLeft = UDim.new(0, 6)
	attPad.PaddingRight = UDim.new(0, 6)
	attPad.PaddingTop = UDim.new(0, 3)
	attPad.PaddingBottom = UDim.new(0, 3)
	attPad.Parent = attachmentsFrame
	
	ChatInput._attachmentsFrame = attachmentsFrame
	
	-- Text box + send button area (inside input container)
	local textBoxFrame = Instance.new("Frame")
	textBoxFrame.Name = "TextBoxFrame"
	textBoxFrame.Size = UDim2.new(1, 0, 1, 0)
	textBoxFrame.Position = UDim2.new(0, 0, 0, 0)
	textBoxFrame.BackgroundTransparency = 1
	textBoxFrame.Parent = inputContainer
	
	ChatInput._textBoxFrame = textBoxFrame
	
	local textBox = Instance.new("TextBox")
	textBox.Name = "TextBox"
	textBox.Size = UDim2.new(1, -44, 1, -8)
	textBox.Position = UDim2.new(0, 10, 0, 4)
	textBox.BackgroundTransparency = 1
	textBox.Text = ""
	textBox.PlaceholderText = "Ask Assistant..."
	textBox.TextColor3 = Theme.TextPrimary
	textBox.PlaceholderColor3 = Theme.TextMuted
	textBox.Font = Theme.FontRegular
	textBox.TextSize = Theme.TextSizeRegular
	textBox.TextXAlignment = Enum.TextXAlignment.Left
	textBox.TextYAlignment = Enum.TextYAlignment.Top
	textBox.TextWrapped = true
	textBox.ClearTextOnFocus = false
	textBox.Parent = textBoxFrame
	
	local sendButton = Instance.new("TextButton")
	sendButton.Name = "SendButton"
	sendButton.Size = UDim2.new(0, 32, 0, 28)
	sendButton.Position = UDim2.new(1, -36, 1, -32)
	sendButton.BackgroundColor3 = Theme.Accent
	sendButton.BorderSizePixel = 0
	sendButton.Text = "→"
	sendButton.TextColor3 = Color3.fromRGB(255, 255, 255)
	sendButton.Font = Theme.FontBold
	sendButton.TextSize = 16
	sendButton.Parent = textBoxFrame
	
	local sendCorner = Instance.new("UICorner")
	sendCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	sendCorner.Parent = sendButton
	
	-- Events
	textBox.FocusLost:Connect(function(enterPressed)
		if enterPressed and not UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then
			ChatInput._submit()
		end
	end)
	
	ChatInput._sendConnection = sendButton.Activated:Connect(function()
		ChatInput._submit()
	end)

	-- Focus ring animation: accent glow on focus, border on blur
	textBox.Focused:Connect(function()
		if ChatInput._inputStroke then
			TweenService:Create(ChatInput._inputStroke, TweenInfo.new(0.2), {Color = Theme.Accent}):Play()
		end
	end)

	textBox.FocusLost:Connect(function()
		if ChatInput._inputStroke then
			TweenService:Create(ChatInput._inputStroke, TweenInfo.new(0.2), {Color = Theme.Border}):Play()
		end
	end)
	
	ChatInput._frame = frame
	ChatInput._textBox = textBox
	ChatInput._sendButton = sendButton
	ChatInput._preview = {}
	ChatInput._attachments = {}
	ChatInput._snippetPreview = nil
	ChatInput._snippetAttachment = nil
	ChatInput._isStopMode = false
	
	return frame
end

function ChatInput._createToggle(parent: Instance, info: {id: string, label: string, default: boolean}, x: number): {button: TextButton, getActive: () -> boolean}
	local toggle = Instance.new("TextButton")
	toggle.Name = info.id .. "Toggle"
	toggle.Size = UDim2.new(0, 64, 0, 18)
	toggle.Position = UDim2.new(0, x, 0, 2)
	toggle.BackgroundColor3 = info.default and Theme.Accent or Theme.BgTertiary
	toggle.BorderSizePixel = 0
	toggle.Text = info.label
	toggle.TextColor3 = info.default and Color3.fromRGB(255, 255, 255) or Theme.TextSecondary
	toggle.Font = Theme.FontRegular
	toggle.TextSize = Theme.TextSizeSmall
	toggle.AutoButtonColor = true
	toggle.Parent = parent
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = toggle
	
	local active = info.default
	toggle.Activated:Connect(function()
		active = not active
		toggle.BackgroundColor3 = active and Theme.Accent or Theme.BgTertiary
		toggle.TextColor3 = active and Color3.fromRGB(255, 255, 255) or Theme.TextSecondary
	end)
	
	return { button = toggle, getActive = function() return active end }
end

function ChatInput._createThinkingToggle(parent: Instance, x: number): {button: TextButton, getLevel: () -> string}
	local toggle = Instance.new("TextButton")
	toggle.Name = "ThinkingToggle"
	toggle.Size = UDim2.new(0, 64, 0, 18)
	toggle.Position = UDim2.new(0, x, 0, 2)
	toggle.BackgroundColor3 = Theme.BgTertiary
	toggle.BorderSizePixel = 0
	toggle.Text = "Think: Off"
	toggle.TextColor3 = Theme.TextSecondary
	toggle.Font = Theme.FontRegular
	toggle.TextSize = Theme.TextSizeSmall
	toggle.AutoButtonColor = true
	toggle.Parent = parent
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = toggle
	
	local levels = {"off", "low", "high"}
	local labels = {"Think: Off", "Think: Low", "Think: High"}
	local idx = 1
	
	toggle.Activated:Connect(function()
		idx = idx % #levels + 1
		local level = levels[idx]
		toggle.Text = labels[idx]
		toggle.BackgroundColor3 = level == "off" and Theme.BgTertiary or Theme.Accent
		toggle.TextColor3 = level == "off" and Theme.TextSecondary or Color3.fromRGB(255, 255, 255)
	end)
	
	return { button = toggle, getLevel = function() return levels[idx] end }
end

-- ── Selection Preview ────────────────────────────────────────────────────

function ChatInput.setSelectionPreview(instances: {Instance})
	ChatInput._preview = {}
	for _, instance in ipairs(instances) do
		if instance and instance.Parent then
			table.insert(ChatInput._preview, instance)
		end
	end
	ChatInput._refreshAttachments()
end

-- ── Snippet Preview / Attachment ─────────────────────────────────────────

function ChatInput.setSnippetPreview(snippet: {script: LuaSourceContainer, startLine: number, endLine: number, text: string}?)
	local changed = false
	if snippet and ChatInput._snippetPreview then
		if snippet.script ~= ChatInput._snippetPreview.script
			or snippet.startLine ~= ChatInput._snippetPreview.startLine
			or snippet.endLine ~= ChatInput._snippetPreview.endLine then
			changed = true
		end
	elseif snippet ~= ChatInput._snippetPreview then
		changed = true
	end

	if changed then
		ChatInput._snippetPreview = snippet
		ChatInput._refreshAttachments()
	end
end

function ChatInput.addSnippetAttachment(snippet: {script: LuaSourceContainer, startLine: number, endLine: number, text: string})
	if not snippet or not snippet.script or not snippet.script.Parent then return end
	ChatInput._snippetAttachment = snippet
	ChatInput._refreshAttachments()
end

function ChatInput.removeSnippetAttachment()
	ChatInput._snippetAttachment = nil
	ChatInput._refreshAttachments()
end

function ChatInput.getSnippetAttachments(): {{script: LuaSourceContainer, startLine: number, endLine: number, text: string}}
	if ChatInput._snippetAttachment and ChatInput._snippetAttachment.script and ChatInput._snippetAttachment.script.Parent then
		return {ChatInput._snippetAttachment}
	end
	return {}
end

-- ── Attachments ──────────────────────────────────────────────────────────

function ChatInput.setOnAttach(callback: () -> ())
	ChatInput._onAttach = callback
end

function ChatInput.setOnAttachmentClick(callback: (instance: Instance) -> ())
	ChatInput._onAttachmentClick = callback
end

function ChatInput.setOnSnippetClick(callback: (snippet: {script: LuaSourceContainer, startLine: number, endLine: number, text: string}) -> ())
	ChatInput._onSnippetClick = callback
end

function ChatInput.addAttachment(instance: Instance)
	if not ChatInput._attachmentsFrame then return end
	
	-- Prevent duplicates
	for _, att in ipairs(ChatInput._attachments) do
		if att == instance then
			return
		end
	end
	
	table.insert(ChatInput._attachments, instance)
	ChatInput._refreshAttachments()
end

function ChatInput.removeAttachment(instance: Instance)
	for i, att in ipairs(ChatInput._attachments) do
		if att == instance then
			table.remove(ChatInput._attachments, i)
			break
		end
	end
	ChatInput._refreshAttachments()
end

function ChatInput.clearAttachments()
	ChatInput._attachments = {}
	ChatInput._snippetAttachment = nil
	ChatInput._refreshAttachments()
end

function ChatInput.getAttachments(): {Instance}
	local result = {}
	for _, instance in ipairs(ChatInput._attachments) do
		if instance and instance.Parent then
			table.insert(result, instance)
		end
	end
	return result
end

function ChatInput._isConfirmed(instance: Instance): boolean
	for _, att in ipairs(ChatInput._attachments) do
		if att == instance then
			return true
		end
	end
	return false
end

function ChatInput._refreshAttachments()
	if not ChatInput._attachmentsFrame then return end
	
	-- Clear existing chips
	for _, child in ipairs(ChatInput._attachmentsFrame:GetChildren()) do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
	
	-- Build a combined list: confirmed first, then previews (excluding confirmed)
	local combined = {}
	
	-- Confirmed snippet
	if ChatInput._snippetAttachment and ChatInput._snippetAttachment.script and ChatInput._snippetAttachment.script.Parent then
		table.insert(combined, {type = "snippet", data = ChatInput._snippetAttachment, confirmed = true})
	end
	
	-- Preview snippet (only if not already confirmed)
	if ChatInput._snippetPreview and ChatInput._snippetPreview.script and ChatInput._snippetPreview.script.Parent then
		local alreadyConfirmed = ChatInput._snippetAttachment
			and ChatInput._snippetAttachment.script == ChatInput._snippetPreview.script
			and ChatInput._snippetAttachment.startLine == ChatInput._snippetPreview.startLine
			and ChatInput._snippetAttachment.endLine == ChatInput._snippetPreview.endLine
		
		if not alreadyConfirmed then
			table.insert(combined, {type = "snippet", data = ChatInput._snippetPreview, confirmed = false})
		end
	end
	
	-- Confirmed instances
	for _, instance in ipairs(ChatInput._attachments) do
		if instance and instance.Parent then
			table.insert(combined, {type = "instance", data = instance, confirmed = true})
		end
	end
	
	-- Preview instances
	for _, instance in ipairs(ChatInput._preview) do
		if instance and instance.Parent and not ChatInput._isConfirmed(instance) then
			table.insert(combined, {type = "instance", data = instance, confirmed = false})
		end
	end
	
	local hasAttachments = #combined > 0
	ChatInput._attachmentsFrame.Visible = hasAttachments
	
	if hasAttachments then
		ChatInput._textBoxFrame.Size = UDim2.new(1, 0, 1, -28)
		ChatInput._textBoxFrame.Position = UDim2.new(0, 0, 0, 26)
	else
		ChatInput._textBoxFrame.Size = UDim2.new(1, 0, 1, 0)
		ChatInput._textBoxFrame.Position = UDim2.new(0, 0, 0, 0)
	end
	
	for _, item in ipairs(combined) do
		if item.type == "snippet" then
			ChatInput._renderSnippetChip(item.data, item.confirmed)
		else
			ChatInput._renderInstanceChip(item.data, item.confirmed)
		end
	end
end

function ChatInput._renderSnippetChip(snippet: {script: LuaSourceContainer, startLine: number, endLine: number, text: string}, confirmed: boolean)
	local chip = Instance.new("TextButton")
	chip.Name = confirmed and "SnippetChip" or "SnippetPreviewChip"
	chip.Size = UDim2.new(0, 0, 0, 20)
	chip.AutomaticSize = Enum.AutomaticSize.X
	chip.BackgroundColor3 = confirmed and Theme.Accent or Theme.BgTertiary
	chip.BorderSizePixel = 0
	chip.Text = `{snippet.script.Name}:{snippet.startLine}-{snippet.endLine}`
	chip.TextColor3 = Color3.fromRGB(255, 255, 255)
	chip.Font = Theme.FontBold
	chip.TextSize = Theme.TextSizeSmall
	chip.TextXAlignment = Enum.TextXAlignment.Right
	chip.AutoButtonColor = false
	chip.Parent = ChatInput._attachmentsFrame
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = chip
	
	local chipPad = Instance.new("UIPadding")
	chipPad.PaddingLeft = UDim.new(0, 20)
	chipPad.PaddingRight = UDim.new(0, 20)
	chipPad.Parent = chip
	
	local icon = Instance.new("TextLabel")
	icon.Name = "Icon"
	icon.Size = UDim2.new(0, 14, 0, 14)
	icon.Position = UDim2.new(0, -50, 0.5, -7)
	icon.BackgroundTransparency = 1
	icon.Text = confirmed and "✓" or "+"
	icon.TextSize = 12
	icon.Font = Theme.FontBold
	icon.TextColor3 = Color3.fromRGB(255, 255, 255)
	icon.Parent = chip
	
	if confirmed then
		local removeBtn = Instance.new("TextButton")
		removeBtn.Name = "Remove"
		removeBtn.Size = UDim2.new(0, 14, 0, 14)
		removeBtn.Position = UDim2.new(1, -50, 0.5, -7)
		removeBtn.BackgroundTransparency = 1
		removeBtn.Text = "×"
		removeBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		removeBtn.Font = Theme.FontBold
		removeBtn.TextSize = 12
		removeBtn.Parent = chip
		
		removeBtn.Activated:Connect(function()
			ChatInput.removeSnippetAttachment()
		end)
		
		local snippetRef = snippet
		chip.Activated:Connect(function()
			if ChatInput._onSnippetClick then
				ChatInput._onSnippetClick(snippetRef)
			end
		end)
	else
		local snippetRef = snippet
		chip.Activated:Connect(function()
			ChatInput.addSnippetAttachment(snippetRef)
		end)
	end
end

function ChatInput._renderInstanceChip(instance: Instance, confirmed: boolean)
	-- Get class icon from StudioService
	local classIcon = StudioService:GetClassIcon(instance.ClassName)
	local iconImage = classIcon and classIcon.Image or ""
	local hasClassIcon = iconImage and iconImage ~= ""
	
	-- Fallback to diamond placeholder if no class icon
	if not hasClassIcon then
		iconImage = PLACEHOLDER_ICON
	end
	
	local chip = Instance.new("TextButton")
	chip.Name = confirmed and "AttachmentChip" or "PreviewChip"
	chip.Size = UDim2.new(0, 0, 0, 20)
	chip.AutomaticSize = Enum.AutomaticSize.X
	chip.BackgroundColor3 = confirmed and Theme.Accent or Theme.BgTertiary
	chip.BorderSizePixel = 0
	chip.Text = instance.Name
	chip.TextColor3 = Color3.fromRGB(255, 255, 255)
	chip.Font = Theme.FontBold
	chip.TextSize = Theme.TextSizeSmall
	chip.TextXAlignment = Enum.TextXAlignment.Right
	chip.AutoButtonColor = false
	chip.Parent = ChatInput._attachmentsFrame
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 4)
	corner.Parent = chip
	
	-- Class icon (ImageLabel with sprite sheet coordinates)
	local classIconLabel = Instance.new("ImageLabel")
	classIconLabel.Name = "ClassIcon"
	classIconLabel.Size = UDim2.new(0, 14, 0, 14)
	classIconLabel.Position = UDim2.new(0, 4, 0.5, -7)
	classIconLabel.BackgroundTransparency = 1
	classIconLabel.Image = iconImage
	classIconLabel.ImageColor3 = Color3.fromRGB(255, 255, 255)
	if hasClassIcon and classIcon.ImageRectOffset and classIcon.ImageRectSize then
		classIconLabel.ImageRectOffset = classIcon.ImageRectOffset
		classIconLabel.ImageRectSize = classIcon.ImageRectSize
	end
	classIconLabel.Parent = chip
	
	local chipPad = Instance.new("UIPadding")
	chipPad.PaddingLeft = UDim.new(0, 22)
	chipPad.PaddingRight = UDim.new(0, 18)
	chipPad.Parent = chip

	-- Status icon (checkmark for confirmed, plus for preview)
	local icon = Instance.new("TextLabel")
	icon.Name = "Icon"
	icon.Size = UDim2.new(0, 14, 0, 14)
	icon.Position = UDim2.new(0, 22, 0.5, -7)
	icon.BackgroundTransparency = 1
	icon.Text = confirmed and "✓" or "+"
	icon.TextSize = 12
	icon.Font = Theme.FontBold
	icon.TextColor3 = Color3.fromRGB(255, 255, 255)
	icon.Parent = chip
	
	if confirmed then
		local removeBtn = Instance.new("TextButton")
		removeBtn.Name = "Remove"
		removeBtn.Size = UDim2.new(0, 14, 0, 14)
		removeBtn.Position = UDim2.new(1, -16, 0.5, -7)
		removeBtn.BackgroundTransparency = 1
		removeBtn.Text = "×"
		removeBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
		removeBtn.Font = Theme.FontBold
		removeBtn.TextSize = 12
		removeBtn.Parent = chip
		
		local instRef = instance
		removeBtn.Activated:Connect(function()
			ChatInput.removeAttachment(instRef)
		end)
		
		chip.Activated:Connect(function()
			if ChatInput._onAttachmentClick then
				ChatInput._onAttachmentClick(instRef)
			end
		end)
	else
		local instRef = instance
		chip.Activated:Connect(function()
			ChatInput.addAttachment(instRef)
		end)
	end
end

-- ── Submit ───────────────────────────────────────────────────────────────

function ChatInput._submit()
	if ChatInput._isStopMode then return end
	if not ChatInput._textBox or not ChatInput._onSend then return end
	local text = ChatInput._textBox.Text:gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then return end
	
	local context = {
		selection = ChatInput._toggles.selection and ChatInput._toggles.selection.getActive() or false,
		scripts = ChatInput._toggles.scripts and ChatInput._toggles.scripts.getActive() or false,
		structure = ChatInput._toggles.structure and ChatInput._toggles.structure.getActive() or false,
		thinkingLevel = ChatInput._toggles.thinking and ChatInput._toggles.thinking.getLevel() or "off",
	}
	
	local attachments = ChatInput.getAttachments()
	local snippets = ChatInput.getSnippetAttachments()
	
	ChatInput._onSend(text, context, attachments, snippets)
	ChatInput._textBox.Text = ""
	ChatInput.clearAttachments()
end

function ChatInput.setEnabled(enabled: boolean)
	if ChatInput._textBox then
		ChatInput._textBox.Interactable = enabled
	end
	if ChatInput._sendButton then
		if ChatInput._isStopMode then
			-- In stop mode, button stays red/interactable regardless
			ChatInput._sendButton.Interactable = true
		else
			ChatInput._sendButton.Interactable = enabled
			ChatInput._sendButton.BackgroundColor3 = enabled and Theme.Accent or Theme.BgTertiary
		end
	end
end

function ChatInput.setStopMode(stopMode: boolean, onStop: (() -> ())?)
	if not ChatInput._sendButton then return end

	if stopMode then
		ChatInput._isStopMode = true
		-- Disconnect the send connection so clicking the button doesn't submit
		if ChatInput._sendConnection then
			ChatInput._sendConnection:Disconnect()
			ChatInput._sendConnection = nil
		end
		ChatInput._sendButton.Text = "■"
		ChatInput._sendButton.BackgroundColor3 = Color3.fromRGB(220, 50, 50)
		ChatInput._sendButton.Interactable = true
		ChatInput._stopConnection = ChatInput._sendButton.Activated:Connect(function()
			if onStop then
				onStop()
			end
		end)
	else
		ChatInput._isStopMode = false
		-- Disconnect stop connection
		if ChatInput._stopConnection then
			ChatInput._stopConnection:Disconnect()
			ChatInput._stopConnection = nil
		end
		-- Re-connect the send handler
		ChatInput._sendConnection = ChatInput._sendButton.Activated:Connect(function()
			ChatInput._submit()
		end)
		ChatInput._sendButton.Text = "→"
		ChatInput._sendButton.BackgroundColor3 = Theme.Accent
	end
end

function ChatInput.destroy()
	if ChatInput._frame then
		ChatInput._frame:Destroy()
		ChatInput._frame = nil
		ChatInput._textBox = nil
		ChatInput._sendButton = nil
		ChatInput._onSend = nil
		ChatInput._onAttach = nil
		ChatInput._onAttachmentClick = nil
		ChatInput._onSnippetClick = nil
		ChatInput._toggles = {}
		ChatInput._preview = {}
		ChatInput._attachments = {}
		ChatInput._snippetPreview = nil
		ChatInput._snippetAttachment = nil
		ChatInput._attachmentsFrame = nil
		ChatInput._textBoxFrame = nil
		ChatInput._inputContainer = nil
		ChatInput._inputStroke = nil
		ChatInput._sendConnection = nil
		ChatInput._stopConnection = nil
		ChatInput._isStopMode = false
	end
end

return ChatInput
