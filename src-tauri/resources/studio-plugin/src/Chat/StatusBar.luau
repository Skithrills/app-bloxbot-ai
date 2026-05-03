-- Chat/StatusBar.lua
-- Connection status indicator bar

local Theme = require(script.Parent.Parent.Theme)
local SettingsStore = require(script.Parent.Parent.Settings.SettingsStore)
local Providers = require(script.Parent.Parent.API.Providers)
local TweenService = game:GetService("TweenService")

local StatusBar = {}
StatusBar._gui = nil
StatusBar._statusLabel = nil
StatusBar._dot = nil
StatusBar._pulseTween = nil
StatusBar._onSettings = nil
StatusBar._modelBtn = nil
StatusBar._onModelChange = nil
StatusBar._availableModels = {}
StatusBar._currentModelIndex = 1

function StatusBar.create(parent: Instance): Frame
	local frame = Instance.new("Frame")
	frame.Name = "StatusBar"
	frame.Size = UDim2.new(1, 0, 0, 24)
	frame.BackgroundColor3 = Theme.BgSecondary
	frame.BorderSizePixel = 0
	frame.Parent = parent
	
	local bottomBorder = Instance.new("Frame")
	bottomBorder.Name = "Border"
	bottomBorder.Size = UDim2.new(1, 0, 0, 1)
	bottomBorder.Position = UDim2.new(0, 0, 1, -1)
	bottomBorder.BackgroundColor3 = Theme.Border
	bottomBorder.BorderSizePixel = 0
	bottomBorder.Parent = frame
	
	local dot = Instance.new("Frame")
	dot.Name = "StatusDot"
	dot.Size = UDim2.new(0, 8, 0, 8)
	dot.Position = UDim2.new(0, 10, 0.5, -4)
	dot.BackgroundColor3 = Theme.StatusDisconnected
	dot.BorderSizePixel = 0
	local dotCorner = Instance.new("UICorner")
	dotCorner.CornerRadius = UDim.new(1, 0)
	dotCorner.Parent = dot
	dot.Parent = frame
	
	local label = Instance.new("TextLabel")
	label.Name = "StatusText"
	label.Size = UDim2.new(1, -80, 1, 0)
	label.Position = UDim2.new(0, 48, 0, 0)
	label.BackgroundTransparency = 1
	label.Text = "Waiting for BloxBot..."
	label.TextColor3 = Theme.TextSecondary
	label.Font = Theme.FontRegular
	label.TextSize = Theme.TextSizeSmall
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.TextTruncate = Enum.TextTruncate.AtEnd
	label.Parent = frame

	-- Toggle sessions button
	local toggleBtn = Instance.new("TextButton")
	toggleBtn.Name = "ToggleSessionsBtn"
	toggleBtn.Size = UDim2.new(0, 24, 0, 24)
	toggleBtn.Position = UDim2.new(0, 24, 0.5, -12)
	toggleBtn.BackgroundTransparency = 1
	toggleBtn.Text = "≡"
	toggleBtn.TextColor3 = Theme.TextSecondary
	toggleBtn.Font = Theme.FontRegular
	toggleBtn.TextSize = 14
	toggleBtn.Parent = frame

	toggleBtn.Activated:Connect(function()
		if StatusBar._onToggleSessions then
			StatusBar._onToggleSessions()
		end
	end)
	
	-- Model selector button (expanded for longer names)
	local modelBtn = Instance.new("TextButton")
	modelBtn.Name = "ModelBtn"
	modelBtn.Size = UDim2.new(0, 68, 0, 24)
	modelBtn.Position = UDim2.new(1, -100, 0.5, -12)
	modelBtn.BackgroundTransparency = 1
	modelBtn.Text = "—"
	modelBtn.TextColor3 = Theme.TextSecondary
	modelBtn.Font = Theme.FontRegular
	modelBtn.TextSize = Theme.TextSizeSmall
	modelBtn.TextTruncate = Enum.TextTruncate.AtEnd
	modelBtn.TextXAlignment = Enum.TextXAlignment.Right
	modelBtn.Parent = frame

	-- Settings button
	local settingsBtn = Instance.new("TextButton")
	settingsBtn.Name = "SettingsBtn"
	settingsBtn.Size = UDim2.new(0, 24, 0, 24)
	settingsBtn.Position = UDim2.new(1, -28, 0, -5)
	settingsBtn.BackgroundTransparency = 1
	settingsBtn.Text = "…"
	settingsBtn.TextColor3 = Theme.TextSecondary
	settingsBtn.Font = Theme.FontRegular
	settingsBtn.FontFace.Weight = Enum.FontWeight.Bold
	settingsBtn.TextSize = 14
	settingsBtn.Parent = frame

	settingsBtn.Activated:Connect(function()
		if StatusBar._onSettings then
			StatusBar._onSettings()
		end
	end)

	StatusBar._gui = frame
	StatusBar._statusLabel = label
	StatusBar._dot = dot
	StatusBar._modelBtn = modelBtn

	local currentProvider = SettingsStore.getProvider()
	-- Get available models based on provider
	local models: {string} = {}
	local plan = SettingsStore.getOpencodePlan()
	
	if currentProvider == "opencode" then
		models = plan == "go" and Providers.OPENCODE.goModels or Providers.OPENCODE.zenModels
	elseif currentProvider == "openai" then
		models = Providers.OPENAI.models
	elseif currentProvider == "anthropic" then
		models = Providers.ANTHROPIC.models
	end

	-- Add custom model if set
	local customModel = SettingsStore.getCustomModel(currentProvider)
	if customModel and customModel ~= "" then
		table.insert(models, 1, customModel)
	end
	StatusBar._availableModels = models
	StatusBar._currentModelIndex = 1

	-- Set initial model from settings or defaults
	local currentModel = SettingsStore.getModel(currentProvider)
	if currentModel ~= "" then
		modelBtn.Text = currentModel
		for i, m in ipairs(models) do
			if m == currentModel then
				StatusBar._currentModelIndex = i
				break
			end
		end
	elseif #models > 0 then
		modelBtn.Text = models[1]
	end

	-- Model button - show dropdown with all models
	local dropdownOpen = false
	local dropdownPanel = nil

	local function closeDropdown()
		if dropdownPanel then
			dropdownPanel:Destroy()
			dropdownPanel = nil
		end
		dropdownOpen = false
	end

	local function openDropdown()
		if dropdownOpen then
			closeDropdown()
			return
		end
		if #StatusBar._availableModels == 0 then
			if StatusBar._onSettings then
				StatusBar._onSettings()
			end
			return
		end
		dropdownOpen = true

		-- Get button position
		local btnPos = modelBtn.AbsolutePosition
		local btnSize = modelBtn.AbsoluteSize
		local parentPos = frame.AbsolutePosition
		local parentSize = frame.AbsoluteSize

		-- Create dropdown panel above the button
		dropdownPanel = Instance.new("Frame")
		dropdownPanel.Name = "ModelDropdown"
		dropdownPanel.Size = UDim2.new(0, btnSize.X, 0, math.min(#StatusBar._availableModels, 6) * 24 + 4)
		dropdownPanel.Position = UDim2.new(1, -btnSize.X - 4, 0, -math.min(#StatusBar._availableModels, 6) * 24 - 8)
		dropdownPanel.BackgroundColor3 = Theme.BgInput
		dropdownPanel.BorderSizePixel = 0
		dropdownPanel.ZIndex = 100
		dropdownPanel.ClipsDescendants = true
		dropdownPanel.Parent = frame

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 4)
		corner.Parent = dropdownPanel

		local stroke = Instance.new("UIStroke")
		stroke.Color = Theme.Divider
		stroke.Thickness = 1
		stroke.Parent = dropdownPanel

		local listLayout = Instance.new("UIListLayout")
		listLayout.SortOrder = Enum.SortOrder.LayoutOrder
		listLayout.Padding = UDim.new(0, 0)
		listLayout.Parent = dropdownPanel

		-- Add each model as an item
		for i, modelName in ipairs(StatusBar._availableModels) do
			local item = Instance.new("TextButton")
			item.Name = "ModelItem_" .. modelName
			item.Size = UDim2.new(1, 0, 0, 24)
			item.BackgroundTransparency = (modelName == modelBtn.Text) and 0 or 1
			item.BackgroundColor3 = Theme.Accent
			item.Text = modelName
			item.TextColor3 = (modelName == modelBtn.Text) and Color3.fromRGB(255, 255, 255) or Theme.TextPrimary
			item.TextXAlignment = Enum.TextXAlignment.Right
			item.Font = Theme.FontRegular
			item.TextSize = 12
			item.TextTruncate = Enum.TextTruncate.AtEnd
			item.ZIndex = 101
			item.LayoutOrder = i
			item.Parent = dropdownPanel

			local pad = Instance.new("UIPadding")
			pad.PaddingRight = UDim.new(0, 4)
			pad.Parent = item

			item.Activated:Connect(function()
				local provider = SettingsStore.getProvider()
				SettingsStore.setModel(provider, modelName)
				modelBtn.Text = modelName
				closeDropdown()
				if StatusBar._onModelChange then
					StatusBar._onModelChange(provider, modelName)
				end
			end)

			item.MouseEnter:Connect(function()
				if modelName ~= modelBtn.Text then
					item.BackgroundTransparency = 0.5
					item.BackgroundColor3 = Theme.BgTertiary
				end
			end)

			item.MouseLeave:Connect(function()
				if modelName ~= modelBtn.Text then
					item.BackgroundTransparency = 1
				end
			end)
		end
	end

	-- Model button click handler (open dropdown)
	modelBtn.Activated:Connect(function()
		if dropdownOpen then
			closeDropdown()
		else
			openDropdown()
		end
	end)


	-- Close dropdown when clicking elsewhere
	frame.InputBegan:Connect(function(input)
		if dropdownOpen and input.UserInputType == Enum.UserInputType.MouseButton1 then
			task.defer(closeDropdown)
		end
	end)

	return frame
end

function StatusBar.setOnSettings(callback: () -> ())
	StatusBar._onSettings = callback
end

function StatusBar.setOnToggleSessions(callback: () -> ())
	StatusBar._onToggleSessions = callback
end

function StatusBar.setOnModelChange(callback: (string, string) -> ())
	StatusBar._onModelChange = callback
end

function StatusBar.setModelText(modelName: string)
	if StatusBar._modelBtn then
		StatusBar._modelBtn.Text = string.sub(modelName, 1, 8)
	end
end

function StatusBar.getAvailableModels(): {string}
	return StatusBar._availableModels
end

function StatusBar.setStatus(status: "connected" | "ready" | "connecting" | "disconnected" | "error", detail: string?)
	if not StatusBar._dot or not StatusBar._statusLabel then return end

	-- Cancel any existing pulse animation
	if StatusBar._pulseTween then
		StatusBar._pulseTween:Cancel()
		StatusBar._pulseTween = nil
	end

	local color = Theme.StatusDisconnected
	local text = detail or "Disconnected"

	if status == "connected" or status == "ready" then
		color = Theme.StatusConnected
		text = detail or "Ready"
	elseif status == "connecting" then
		color = Theme.StatusConnecting
		text = detail or "Thinking..."
	elseif status == "error" then
		color = Theme.StatusDisconnected
		text = detail or "Error"
	end

	StatusBar._dot.BackgroundColor3 = color
	StatusBar._statusLabel.Text = text
	StatusBar._statusLabel.TextColor3 = (status == "disconnected" or status == "error") and Theme.StatusDisconnected or Theme.TextSecondary

	-- Pulsing animation for connecting/working state
	if status == "connecting" then
		StatusBar._dot.BackgroundTransparency = 0
		StatusBar._pulseTween = TweenService:Create(
			StatusBar._dot,
			TweenInfo.new(1, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),
			{BackgroundTransparency = 0.7}
		)
		StatusBar._pulseTween:Play()
	else
		StatusBar._dot.BackgroundTransparency = 0
	end
end

function StatusBar.destroy()
	if StatusBar._pulseTween then
		StatusBar._pulseTween:Cancel()
		StatusBar._pulseTween = nil
	end
	if StatusBar._gui then
		StatusBar._gui:Destroy()
		StatusBar._gui = nil
		StatusBar._statusLabel = nil
		StatusBar._dot = nil
	end
end

return StatusBar
