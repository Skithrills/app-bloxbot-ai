-- Chat/SessionList.lua
-- Sidebar with session list, new/delete/rename

local Theme = require(script.Parent.Parent.Theme)
local TweenService = game:GetService("TweenService")

local SessionList = {}
SessionList._frame = nil
SessionList._contentFrame = nil
SessionList._sessions = {}
SessionList._activeSessionId = nil
SessionList._sessionStatuses = {}
SessionList._onSelect = nil
SessionList._onNew = nil
SessionList._onDelete = nil

function SessionList.create(parent: Instance, onSelect: (sessionId: string) -> (), onNew: () -> (), onDelete: (sessionId: string) -> ()): Frame
	SessionList._onSelect = onSelect
	SessionList._onNew = onNew
	SessionList._onDelete = onDelete
	
	local frame = Instance.new("Frame")
	frame.Name = "SessionList"
	frame.Size = UDim2.new(0, 200, 1, 0)
	frame.BackgroundColor3 = Theme.BgSecondary
	frame.BorderSizePixel = 0
	frame.Parent = parent
	
	local rightBorder = Instance.new("Frame")
	rightBorder.Name = "Border"
	rightBorder.Size = UDim2.new(0, 1, 1, 0)
	rightBorder.Position = UDim2.new(1, -1, 0, 0)
	rightBorder.BackgroundColor3 = Theme.Border
	rightBorder.BorderSizePixel = 0
	rightBorder.Parent = frame
	
	-- Header
	local header = Instance.new("Frame")
	header.Name = "Header"
	header.Size = UDim2.new(1, -1, 0, 36)
	header.BackgroundTransparency = 1
	header.Parent = frame
	
	local headerLabel = Instance.new("TextLabel")
	headerLabel.Name = "Title"
	headerLabel.Size = UDim2.new(1, -40, 1, 0)
	headerLabel.Position = UDim2.new(0, 12, 0, 0)
	headerLabel.BackgroundTransparency = 1
	headerLabel.Text = "Sessions"
	headerLabel.TextColor3 = Theme.TextPrimary
	headerLabel.Font = Theme.FontBold
	headerLabel.TextSize = Theme.TextSizeRegular
	headerLabel.TextXAlignment = Enum.TextXAlignment.Left
	headerLabel.Parent = header
	
	local newButton = Instance.new("TextButton")
	newButton.Name = "NewButton"
	newButton.Size = UDim2.new(0, 24, 0, 24)
	newButton.Position = UDim2.new(1, -32, 0.5, -12)
	newButton.BackgroundColor3 = Theme.Accent
	newButton.BorderSizePixel = 0
	newButton.Text = "+"
	newButton.TextColor3 = Color3.fromRGB(255, 255, 255)
	newButton.Font = Theme.FontBold
	newButton.TextSize = 16
	newButton.Parent = header
	
	local newCorner = Instance.new("UICorner")
	newCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	newCorner.Parent = newButton
	
	newButton.Activated:Connect(function()
		if SessionList._onNew then
			SessionList._onNew()
		end
	end)
	
	-- Scrollable session list
	local scrollFrame = Instance.new("ScrollingFrame")
	scrollFrame.Name = "Scroll"
	scrollFrame.Size = UDim2.new(1, -1, 1, -36)
	scrollFrame.Position = UDim2.new(0, 0, 0, 36)
	scrollFrame.BackgroundTransparency = 1
	scrollFrame.BorderSizePixel = 0
	scrollFrame.ScrollBarThickness = 3
	scrollFrame.ScrollBarImageColor3 = Theme.Border
	scrollFrame.ScrollBarImageTransparency = 0.6
	scrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	scrollFrame.Parent = frame
	
	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, 1)
	layout.Parent = scrollFrame
	
	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, Theme.PaddingSmall)
	padding.PaddingBottom = UDim.new(0, Theme.PaddingSmall)
	padding.PaddingLeft = UDim.new(0, Theme.PaddingSmall)
	padding.PaddingRight = UDim.new(0, Theme.PaddingSmall)
	padding.Parent = scrollFrame
	
	SessionList._frame = frame
	SessionList._contentFrame = scrollFrame
	SessionList._sessions = {}
	
	return frame
end

function SessionList.setSessions(sessions: {any})
	SessionList._sessions = sessions
	SessionList._refresh()
end

function SessionList.setActiveSession(sessionId: string?)
	SessionList._activeSessionId = sessionId
	SessionList._refresh()
end

function SessionList.setSessionStatus(sessionId: string, status: string?)
	SessionList._sessionStatuses[sessionId] = status
	SessionList._refresh()
end

function SessionList._refresh()
	if not SessionList._contentFrame then return end
	
	-- Clear existing
	for _, child in ipairs(SessionList._contentFrame:GetChildren()) do
		if child:IsA("Frame") or child:IsA("TextButton") then
			child:Destroy()
		end
	end
	
	-- Sort by updated time (newest first)
	local sorted = table.create(#SessionList._sessions)
	for _, s in ipairs(SessionList._sessions) do
		table.insert(sorted, s)
	end
	table.sort(sorted, function(a, b)
		return (a.updatedAt or 0) > (b.updatedAt or 0)
	end)
	
	for idx, session in ipairs(sorted) do
		local isActive = session.id == SessionList._activeSessionId
		local item = SessionList._createSessionItem(session, isActive, idx)
		item.Parent = SessionList._contentFrame
	end
end

function SessionList._createSessionItem(session: any, isActive: boolean, layoutOrder: number): Frame
	local frame = Instance.new("Frame")
	frame.Name = session.id
	frame.Size = UDim2.new(1, 0, 0, 40)
	frame.BackgroundColor3 = isActive and Theme.BgTertiary or Theme.BgSecondary
	frame.BorderSizePixel = 0
	frame.LayoutOrder = layoutOrder
	
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	corner.Parent = frame
	
	-- Status dot
	local sessionStatus = SessionList._sessionStatuses[session.id]
	local dotVisible = sessionStatus ~= nil
	local dotColor = Theme.TextMuted
	if sessionStatus == "working" then
		dotColor = Theme.StatusWorking
	elseif sessionStatus == "error" then
		dotColor = Theme.StatusError
	elseif sessionStatus == "done" then
		dotColor = Theme.StatusDone
	end
	
	local dot = Instance.new("Frame")
	dot.Name = "StatusDot"
	dot.Size = UDim2.new(0, 8, 0, 8)
	dot.Position = UDim2.new(0, 8, 0.5, -4)
	dot.BackgroundColor3 = dotColor
	dot.BackgroundTransparency = dotVisible and 0 or 1
	dot.BorderSizePixel = 0
	local dotCorner = Instance.new("UICorner")
	dotCorner.CornerRadius = UDim.new(1, 0)
	dotCorner.Parent = dot
	dot.Parent = frame
	
	-- Pulsing animation for working status
	if sessionStatus == "working" then
		local pulseTween = TweenService:Create(
			dot,
			TweenInfo.new(0.8, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),
			{BackgroundTransparency = 0.7}
		)
		pulseTween:Play()
	end
	
	-- Click area
	local button = Instance.new("TextButton")
	button.Name = "ClickArea"
	button.Size = UDim2.new(1, 0, 1, 0)
	button.BackgroundTransparency = 1
	button.Text = ""
	button.ZIndex = 2
	button.Parent = frame

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.new(1, -52, 0, 18)
	title.Position = UDim2.new(0, 20, 0, 4)
	title.BackgroundTransparency = 1
	title.Text = session.title or "Untitled"
	title.TextColor3 = isActive and Theme.TextPrimary or Theme.TextSecondary
	title.Font = isActive and Theme.FontBold or Theme.FontRegular
	title.TextSize = Theme.TextSizeRegular
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.TextTruncate = Enum.TextTruncate.AtEnd
	title.ZIndex = 2
	title.Parent = frame

	local timeLabel = Instance.new("TextLabel")
	timeLabel.Name = "Time"
	timeLabel.Size = UDim2.new(1, -52, 0, 14)
	timeLabel.Position = UDim2.new(0, 20, 0, 22)
	timeLabel.BackgroundTransparency = 1
	timeLabel.Text = SessionList._formatTime(session.updatedAt)
	timeLabel.TextColor3 = Theme.TextMuted
	timeLabel.Font = Theme.FontRegular
	timeLabel.TextSize = Theme.TextSizeSmall
	timeLabel.TextXAlignment = Enum.TextXAlignment.Left
	timeLabel.ZIndex = 2
	timeLabel.Parent = frame

	-- Buttons container (hidden by default, shown on hover)
	local buttonsContainer = Instance.new("Frame")
	buttonsContainer.Name = "Buttons"
	buttonsContainer.Size = UDim2.new(0, 28, 1, 0)
	buttonsContainer.Position = UDim2.new(1, -30, 0, 0)
	buttonsContainer.BackgroundTransparency = 0
	buttonsContainer.BackgroundColor3 = isActive and Theme.BgTertiary or Theme.BgSecondary
	buttonsContainer.BorderSizePixel = 0
	buttonsContainer.Visible = false
	buttonsContainer.ZIndex = 3
	buttonsContainer.Parent = frame

	-- Delete button
	local deleteBtn = Instance.new("TextButton")
	deleteBtn.Name = "Delete"
	deleteBtn.Size = UDim2.new(0, 20, 0, 20)
	deleteBtn.Position = UDim2.new(0.5, -10, 0.5, -10)
	deleteBtn.BackgroundTransparency = 1
	deleteBtn.Text = "×"
	deleteBtn.TextColor3 = Theme.TextMuted
	deleteBtn.Font = Theme.FontBold
	deleteBtn.TextSize = 16
	deleteBtn.ZIndex = 4
	deleteBtn.Parent = buttonsContainer

	deleteBtn.Activated:Connect(function()
		if SessionList._onDelete then
			SessionList._onDelete(session.id)
		end
	end)

	-- Hover behavior: show buttons container
	local hoverCount = 0
	local function onEnter()
		hoverCount += 1
		buttonsContainer.Visible = true
	end
	local function onLeave()
		hoverCount -= 1
		if hoverCount <= 0 then
			hoverCount = 0
			buttonsContainer.Visible = false
		end
	end

	frame.MouseEnter:Connect(onEnter)
	frame.MouseLeave:Connect(onLeave)
	buttonsContainer.MouseEnter:Connect(onEnter)
	buttonsContainer.MouseLeave:Connect(onLeave)
	deleteBtn.MouseEnter:Connect(function()
		deleteBtn.TextColor3 = Theme.StatusError
	end)
	deleteBtn.MouseLeave:Connect(function()
		deleteBtn.TextColor3 = Theme.TextMuted
	end)

	button.Activated:Connect(function()
		if SessionList._onSelect then
			SessionList._onSelect(session.id)
		end
	end)

	return frame
end

function SessionList._formatTime(timestamp: number?): string
	if not timestamp then return "" end
	local now = DateTime.now().UnixTimestampMillis
	local diff = now - timestamp
	local seconds = math.floor(diff / 1000)
	
	if seconds < 60 then
		return "Just now"
	elseif seconds < 3600 then
		return `{math.floor(seconds / 60)}m ago`
	elseif seconds < 86400 then
		return `{math.floor(seconds / 3600)}h ago`
	else
		return `{math.floor(seconds / 86400)}d ago`
	end
end

function SessionList.setVisible(visible: boolean)
	if SessionList._frame then
		SessionList._frame.Visible = visible
	end
end

function SessionList.destroy()
	if SessionList._frame then
		SessionList._frame:Destroy()
		SessionList._frame = nil
		SessionList._contentFrame = nil
		SessionList._sessions = {}
		SessionList._activeSessionId = nil
		SessionList._sessionStatuses = {}
	end
end

return SessionList
