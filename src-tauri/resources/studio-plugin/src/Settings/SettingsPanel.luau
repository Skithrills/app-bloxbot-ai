-- Settings/SettingsPanel.lua
-- Configuration UI for provider, model, API key, and base URL

local Theme = require(script.Parent.Parent.Theme)
local SettingsStore = require(script.Parent.SettingsStore)
local Providers = require(script.Parent.Parent.API.Providers)

local SettingsPanel = {}

-- OpenCode plan base URLs
local OPENCODE_PLANS = {
	zen = "https://opencode.ai/zen/v1",
	go = "https://opencode.ai/zen/go/v1",
}

function SettingsPanel.create(parent: Instance, onClose: () -> ()): Frame
	local frame = Instance.new("Frame")
	frame.Name = "SettingsPanel"
	frame.Size = UDim2.new(1, 0, 1, 0)
	frame.BackgroundColor3 = Theme.BgPrimary
	frame.BorderSizePixel = 0
	frame.ZIndex = 50
	frame.Parent = parent

	local contentFrame = Instance.new("ScrollingFrame")
	contentFrame.Name = "Content"
	contentFrame.Size = UDim2.new(1, 0, 1, 0)
	contentFrame.Position = UDim2.new(0, 0, 0, 0)
	contentFrame.BackgroundTransparency = 1
	contentFrame.BorderSizePixel = 0
	contentFrame.ZIndex = 51
	contentFrame.ScrollBarThickness = 6
	contentFrame.ScrollBarImageColor3 = Theme.TextMuted
	
	contentFrame.ScrollingDirection = Enum.ScrollingDirection.Y
	contentFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
	contentFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	contentFrame.Parent = frame

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, Theme.PaddingLarge)
	padding.PaddingBottom = UDim.new(0, Theme.PaddingLarge)
	padding.PaddingLeft = UDim.new(0, Theme.PaddingLarge)
	padding.PaddingRight = UDim.new(0, Theme.PaddingLarge)
	padding.Parent = contentFrame

	local layout = Instance.new("UIListLayout")
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, Theme.PaddingRegular)
	layout.Parent = contentFrame

	-- Title
	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.new(1, 0, 0, 24)
	title.BackgroundTransparency = 1
	title.Text = "Settings"
	title.TextColor3 = Theme.TextPrimary
	title.Font = Theme.FontBold
	title.TextSize = Theme.TextSizeLarge
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.LayoutOrder = 1
	title.ZIndex = 51
	title.Parent = contentFrame

	-- Helper: create label
	local function createLabel(text: string, layoutOrder: number): TextLabel
		local label = Instance.new("TextLabel")
		label.Size = UDim2.new(1, 0, 0, 18)
		label.BackgroundTransparency = 1
		label.Text = text
		label.TextColor3 = Theme.TextSecondary
		label.Font = Theme.FontBold
		label.TextSize = Theme.TextSizeRegular
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.LayoutOrder = layoutOrder
		label.ZIndex = 51
		label.Parent = contentFrame
		return label
	end

	-- Helper: create cycle button
	local function createCycleButton(text: string, parent: Instance, layoutOrder: number?): TextButton
		local btn = Instance.new("TextButton")
		btn.Size = UDim2.new(1, 0, 0, 28)
		btn.BackgroundColor3 = Theme.BgInput
		btn.BorderSizePixel = 0
		btn.Text = text
		btn.TextColor3 = Theme.TextPrimary
		btn.Font = Theme.FontRegular
		btn.TextSize = Theme.TextSizeRegular
		btn.ZIndex = 51
		if layoutOrder then
			btn.LayoutOrder = layoutOrder
		end
		btn.Parent = parent

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
		corner.Parent = btn

		return btn
	end

	-- Helper: create text input
	local function createInput(placeholder: string, text: string, parent: Instance, layoutOrder: number?, font: Enum.Font?): TextBox
		local input = Instance.new("TextBox")
		input.Size = UDim2.new(1, 0, 0, 28)
		input.BackgroundColor3 = Theme.BgInput
		input.BorderSizePixel = 0
		input.Text = text
		input.PlaceholderText = placeholder
		input.TextColor3 = Theme.TextPrimary
		input.PlaceholderColor3 = Theme.TextMuted
		input.Font = font or Theme.FontRegular
		input.TextSize = Theme.TextSizeRegular
		input.ZIndex = 51
		if layoutOrder then
			input.LayoutOrder = layoutOrder
		end
		input.Parent = parent

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
		corner.Parent = input

		return input
	end

	-- Provider section
	createLabel("Provider", 2)

	local providerNames = Providers.listProviderNames()
	local currentProvider = SettingsStore.getProvider()
	local providerIdx = 1
	for i, name in ipairs(providerNames) do
		if name == currentProvider then
			providerIdx = i
			break
		end
	end

	local providerBtn = createCycleButton(Providers.getProvider(currentProvider).displayName, contentFrame, 3)

	-- OpenCode Plan section (only for opencode)
	local planLabel = createLabel("Plan", 4)
	local planNames = {"zen", "go"}
	local currentPlan = SettingsStore.getOpencodePlan()
	local planIdx = 1
	for i, name in ipairs(planNames) do
		if name == currentPlan then
			planIdx = i
			break
		end
	end
	local planBtn = createCycleButton(currentPlan:gsub("^%l", string.upper), contentFrame, 5)
	planLabel.Visible = (currentProvider == "opencode")
	planBtn.Visible = (currentProvider == "opencode")

	-- Model section
	createLabel("Model", 6)

	-- Container that holds model selector
	local modelContainer = Instance.new("Frame")
	modelContainer.Name = "ModelContainer"
	modelContainer.Size = UDim2.new(1, 0, 0, 28)
	modelContainer.BackgroundTransparency = 1
	modelContainer.BorderSizePixel = 0
	modelContainer.LayoutOrder = 7
	modelContainer.ZIndex = 51
	modelContainer.Parent = contentFrame

	local modelBtn: TextButton? = nil

	-- Base URL section (only for opencode)
	local baseUrlLabel = createLabel("Base URL", 8)
	local baseUrlInput = createInput("https://opencode.ai/zen/v1", SettingsStore.getBaseUrl(currentProvider), contentFrame, 9)
	baseUrlLabel.Visible = (currentProvider == "opencode")
	baseUrlInput.Visible = (currentProvider == "opencode")

	-- API Key section
	local keyLabel = createLabel("API Key", 10)
	local keyInput = createInput("sk-...", SettingsStore.getApiKey(currentProvider) or "", contentFrame, 11, Theme.FontCode)

	-- ── Permissions Section ────────────────────────────────────────────────

	createLabel("Permissions", 12)

	local allowExecution = SettingsStore.getAllowCodeExecution()
	local requireApproval = SettingsStore.getRequireApproval()

	-- Helper: create toggle row
	local function createToggleRow(text: string, initialValue: boolean, layoutOrder: number): (Frame, TextButton)
		local row = Instance.new("Frame")
		row.Size = UDim2.new(1, 0, 0, 28)
		row.BackgroundTransparency = 1
		row.LayoutOrder = layoutOrder
		row.ZIndex = 51
		row.Parent = contentFrame

		local label = Instance.new("TextLabel")
		label.Size = UDim2.new(1, -50, 1, 0)
		label.BackgroundTransparency = 1
		label.Text = text
		label.TextColor3 = Theme.TextSecondary
		label.Font = Theme.FontRegular
		label.TextSize = Theme.TextSizeRegular
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.ZIndex = 51
		label.Parent = row

		local toggle = Instance.new("TextButton")
		toggle.Size = UDim2.new(0, 44, 0, 22)
		toggle.Position = UDim2.new(1, -44, 0.5, -11)
		toggle.BackgroundColor3 = initialValue and Theme.StatusConnected or Theme.BgTertiary
		toggle.BorderSizePixel = 0
		toggle.Text = initialValue and "ON" or "OFF"
		toggle.TextColor3 = Color3.fromRGB(255, 255, 255)
		toggle.Font = Theme.FontBold
		toggle.TextSize = Theme.TextSizeSmall
		toggle.ZIndex = 51
		toggle.Parent = row

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 11)
		corner.Parent = toggle

		return row, toggle
	end

	local _, allowExecToggle = createToggleRow("Allow AI code execution", allowExecution, 13)
	local approvalRow, approvalToggle = createToggleRow("Require approval before run", requireApproval, 14)
	approvalRow.Visible = allowExecution

	allowExecToggle.Activated:Connect(function()
		local isOn = allowExecToggle.Text == "OFF"
		allowExecToggle.Text = isOn and "ON" or "OFF"
		allowExecToggle.BackgroundColor3 = isOn and Theme.StatusConnected or Theme.BgTertiary
		approvalRow.Visible = isOn
	end)

	approvalToggle.Activated:Connect(function()
		local isOn = approvalToggle.Text == "OFF"
		approvalToggle.Text = isOn and "ON" or "OFF"
		approvalToggle.BackgroundColor3 = isOn and Theme.StatusConnected or Theme.BgTertiary
	end)

	-- ── Agent Mode Section ────────────────────────────────────────────────

	createLabel("Agent Mode", 15)

	local agentModeEnabled = SettingsStore.getEnableAgentMode()
	local agentModeRow, agentModeToggle = createToggleRow("Enable iterative tool calling", agentModeEnabled, 16)

	-- Description text
	local agentModeDesc = Instance.new("TextLabel")
	agentModeDesc.Size = UDim2.new(1, 0, 0, 16)
	agentModeDesc.BackgroundTransparency = 1
	agentModeDesc.Text = "Allows the AI to use tools and web search iteratively"
	agentModeDesc.TextColor3 = Theme.TextMuted
	agentModeDesc.Font = Theme.FontRegular
	agentModeDesc.TextSize = Theme.TextSizeSmall
	agentModeDesc.TextXAlignment = Enum.TextXAlignment.Left
	agentModeDesc.LayoutOrder = 17
	agentModeDesc.ZIndex = 51
	agentModeDesc.Parent = contentFrame

	-- ── Gemini API Key ────────────────────────────────────────────────────

	local geminiKeyLabel = createLabel("Gemini API Key", 18)
	local geminiKeyInput = createInput("AIza...", SettingsStore.getGeminiApiKey() or "", contentFrame, 19, Theme.FontCode)

	-- ── Web Search Provider ───────────────────────────────────────────────

	local searchProviderLabel = createLabel("Web Search Provider", 20)

	local searchProviders = { "gemini", "duckduckgo" }
	local searchProviderDisplayNames = { gemini = "Gemini (Google Search)", duckduckgo = "DuckDuckGo" }
	local currentSearchProvider = SettingsStore.getWebSearchProvider()
	local searchProviderIdx = 1
	for i, name in ipairs(searchProviders) do
		if name == currentSearchProvider then
			searchProviderIdx = i
			break
		end
	end

	local searchProviderBtn = createCycleButton(
		searchProviderDisplayNames[currentSearchProvider] or currentSearchProvider,
		contentFrame,
		21
	)

	searchProviderBtn.Activated:Connect(function()
		searchProviderIdx = searchProviderIdx % #searchProviders + 1
		currentSearchProvider = searchProviders[searchProviderIdx]
		searchProviderBtn.Text = searchProviderDisplayNames[currentSearchProvider] or currentSearchProvider
	end)

	-- ── Max Tool Iterations ───────────────────────────────────────────────

	local maxIterLabel = createLabel("Max Tool Iterations", 22)

	local maxIterations = SettingsStore.getMaxToolIterations()

	local sliderContainer = Instance.new("Frame")
	sliderContainer.Name = "MaxIterationsSlider"
	sliderContainer.Size = UDim2.new(1, 0, 0, 36)
	sliderContainer.BackgroundTransparency = 1
	sliderContainer.BorderSizePixel = 0
	sliderContainer.LayoutOrder = 23
	sliderContainer.ZIndex = 51
	sliderContainer.Parent = contentFrame

	-- Value display
	local sliderValueLabel = Instance.new("TextLabel")
	sliderValueLabel.Size = UDim2.new(0, 30, 0, 16)
	sliderValueLabel.Position = UDim2.new(1, -30, 0, 0)
	sliderValueLabel.BackgroundTransparency = 1
	sliderValueLabel.Text = tostring(maxIterations)
	sliderValueLabel.TextColor3 = Theme.TextPrimary
	sliderValueLabel.Font = Theme.FontBold
	sliderValueLabel.TextSize = Theme.TextSizeRegular
	sliderValueLabel.TextXAlignment = Enum.TextXAlignment.Right
	sliderValueLabel.ZIndex = 51
	sliderValueLabel.Parent = sliderContainer

	-- Slider track
	local sliderTrack = Instance.new("Frame")
	sliderTrack.Size = UDim2.new(1, 0, 0, 6)
	sliderTrack.Position = UDim2.new(0, 0, 0, 20)
	sliderTrack.BackgroundColor3 = Theme.BgTertiary
	sliderTrack.BorderSizePixel = 0
	sliderTrack.ZIndex = 51
	sliderTrack.Parent = sliderContainer

	local sliderTrackCorner = Instance.new("UICorner")
	sliderTrackCorner.CornerRadius = UDim.new(0, 3)
	sliderTrackCorner.Parent = sliderTrack

	-- Slider fill
	local sliderFill = Instance.new("Frame")
	sliderFill.Size = UDim2.new((maxIterations - 1) / 24, 0, 1, 0)
	sliderFill.BackgroundColor3 = Theme.Accent
	sliderFill.BorderSizePixel = 0
	sliderFill.ZIndex = 52
	sliderFill.Parent = sliderTrack

	local sliderFillCorner = Instance.new("UICorner")
	sliderFillCorner.CornerRadius = UDim.new(0, 3)
	sliderFillCorner.Parent = sliderFill

	-- Slider knob
	local sliderKnob = Instance.new("Frame")
	sliderKnob.Size = UDim2.new(0, 14, 0, 14)
	sliderKnob.Position = UDim2.new((maxIterations - 1) / 24, -7, 0.5, -7)
	sliderKnob.BackgroundColor3 = Theme.TextPrimary
	sliderKnob.BorderSizePixel = 0
	sliderKnob.ZIndex = 53
	sliderKnob.Parent = sliderTrack

	local sliderKnobCorner = Instance.new("UICorner")
	sliderKnobCorner.CornerRadius = UDim.new(0, 7)
	sliderKnobCorner.Parent = sliderKnob

	-- Slider visual update helper
	local function updateSliderVisual()
		local pct = (maxIterations - 1) / 24
		sliderFill.Size = UDim2.new(pct, 0, 1, 0)
		sliderKnob.Position = UDim2.new(pct, -7, 0.5, -7)
		sliderValueLabel.Text = tostring(maxIterations)
	end

	-- Slider click/drag interaction
	local sliderDragging = false

	sliderTrack.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			sliderDragging = true
			local relX = math.clamp((input.Position.X - sliderTrack.AbsolutePosition.X) / sliderTrack.AbsoluteSize.X, 0, 1)
			maxIterations = math.clamp(math.round(relX * 24) + 1, 1, 25)
			updateSliderVisual()
		end
	end)

	sliderTrack.InputChanged:Connect(function(input)
		if sliderDragging then
			local relX = math.clamp((input.Position.X - sliderTrack.AbsolutePosition.X) / sliderTrack.AbsoluteSize.X, 0, 1)
			maxIterations = math.clamp(math.round(relX * 24) + 1, 1, 25)
			updateSliderVisual()
		end
	end)

	sliderTrack.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			sliderDragging = false
		end
	end)

	-- Agent Mode visibility: hide related controls when Agent Mode is off
	local agentModeControls = {
		geminiKeyLabel,
		geminiKeyInput,
		searchProviderLabel,
		searchProviderBtn,
		maxIterLabel,
		sliderContainer,
	}

	local function updateAgentModeVisibility()
		local isOn = agentModeToggle.Text == "ON"
		for _, ctrl in ipairs(agentModeControls) do
			ctrl.Visible = isOn
		end
	end

	-- Initialize visibility based on current state
	updateAgentModeVisibility()

	agentModeToggle.Activated:Connect(function()
		local isOn = agentModeToggle.Text == "OFF"
		agentModeToggle.Text = isOn and "ON" or "OFF"
		agentModeToggle.BackgroundColor3 = isOn and Theme.StatusConnected or Theme.BgTertiary
		updateAgentModeVisibility()
	end)

	-- Buttons row
	local buttonFrame = Instance.new("Frame")
	buttonFrame.Name = "ButtonFrame"
	buttonFrame.Size = UDim2.new(1, 0, 0, 32)
	buttonFrame.BackgroundTransparency = 1
	buttonFrame.LayoutOrder = 24
	buttonFrame.ZIndex = 51
	buttonFrame.Parent = contentFrame

	local saveBtn = Instance.new("TextButton")
	saveBtn.Name = "SaveBtn"
	saveBtn.Size = UDim2.new(0.48, 0, 1, 0)
	saveBtn.BackgroundColor3 = Theme.Accent
	saveBtn.BorderSizePixel = 0
	saveBtn.Text = "Save"
	saveBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
	saveBtn.Font = Theme.FontBold
	saveBtn.TextSize = Theme.TextSizeRegular
	saveBtn.ZIndex = 51
	saveBtn.Parent = buttonFrame

	local saveCorner = Instance.new("UICorner")
	saveCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	saveCorner.Parent = saveBtn

	local closeBtn = Instance.new("TextButton")
	closeBtn.Name = "CloseBtn"
	closeBtn.Size = UDim2.new(0.48, 0, 1, 0)
	closeBtn.Position = UDim2.new(0.52, 0, 0, 0)
	closeBtn.BackgroundColor3 = Theme.BgTertiary
	closeBtn.BorderSizePixel = 0
	closeBtn.Text = "Cancel"
	closeBtn.TextColor3 = Theme.TextPrimary
	closeBtn.Font = Theme.FontBold
	closeBtn.TextSize = Theme.TextSizeRegular
	closeBtn.ZIndex = 51
	closeBtn.Parent = buttonFrame

	local closeCorner = Instance.new("UICorner")
	closeCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	closeCorner.Parent = closeBtn

	-- ── Model Selector Logic ───────────────────────────────────────────────

	local function clearModelContainer()
		for _, child in ipairs(modelContainer:GetChildren()) do
			if child:IsA("GuiObject") then
				child:Destroy()
			end
		end
		modelBtn = nil
	end

	local function getCurrentModel(): string
		if modelBtn then
			return modelBtn.Text
		end
		return ""
	end

	local function createModelCycleButton(models: {string}, selected: string)
		clearModelContainer()

		-- Selected model display button
		local btn = Instance.new("TextButton")
		btn.Name = "ModelBtn"
		btn.Size = UDim2.new(1, 0, 1, 0)
		btn.BackgroundColor3 = Theme.BgInput
		btn.BorderSizePixel = 0
		btn.Text = selected
		btn.TextColor3 = Theme.TextPrimary
		btn.Font = Theme.FontRegular
		btn.TextSize = Theme.TextSizeRegular
		btn.TextTruncate = Enum.TextTruncate.AtEnd
		btn.ZIndex = 51
		btn.Parent = modelContainer

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
		corner.Parent = btn

		-- Dropdown arrow indicator
		local arrow = Instance.new("TextLabel")
		arrow.Name = "Arrow"
		arrow.Size = UDim2.new(0, 20, 1, 0)
		arrow.Position = UDim2.new(1, -24, 0, 0)
		arrow.BackgroundTransparency = 1
		arrow.Text = "▾"
		arrow.TextColor3 = Theme.TextMuted
		arrow.Font = Theme.FontRegular
		arrow.TextSize = Theme.TextSizeRegular
		arrow.ZIndex = 52
		arrow.Parent = btn

		modelBtn = btn

		-- Dropdown state
		local dropdownOpen = false
		local dropdownPanel: Frame? = nil
		local closeConnection: RBXScriptConnection? = nil

		local function closeDropdown()
			if dropdownPanel then
				dropdownPanel:Destroy()
				dropdownPanel = nil
			end
			if closeConnection then
				closeConnection:Disconnect()
				closeConnection = nil
			end
			dropdownOpen = false
		end

		local function openDropdown()
			if dropdownOpen then
				closeDropdown()
				return
			end
			dropdownOpen = true

			-- Calculate position relative to the main frame
			local frameAbsPos = frame.AbsolutePosition
			local containerAbsPos = modelContainer.AbsolutePosition
			local containerAbsSize = modelContainer.AbsoluteSize

			local offsetX = containerAbsPos.X - frameAbsPos.X
			local offsetY = containerAbsPos.Y - frameAbsPos.Y + containerAbsSize.Y

			dropdownPanel = Instance.new("Frame")
			dropdownPanel.Name = "ModelDropdown"
			dropdownPanel.Position = UDim2.new(0, offsetX, 0, offsetY)
			dropdownPanel.BackgroundColor3 = Theme.BgInput
			dropdownPanel.BorderSizePixel = 0
			dropdownPanel.ZIndex = 100
			dropdownPanel.ClipsDescendants = true
			dropdownPanel.Parent = frame

			local dropdownCorner = Instance.new("UICorner")
			dropdownCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
			dropdownCorner.Parent = dropdownPanel

			local dropdownStroke = Instance.new("UIStroke")
			dropdownStroke.Color = Theme.Divider
			dropdownStroke.Thickness = 1
			dropdownStroke.Parent = dropdownPanel

			local scrollFrame = Instance.new("ScrollingFrame")
			scrollFrame.Name = "ScrollList"
			scrollFrame.Size = UDim2.new(1, 0, 1, 0)
			scrollFrame.BackgroundTransparency = 1
			scrollFrame.BorderSizePixel = 0
			scrollFrame.ScrollBarThickness = 6
			scrollFrame.ScrollBarImageColor3 = Theme.TextMuted
			scrollFrame.ScrollingDirection = Enum.ScrollingDirection.Y
			scrollFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
			scrollFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
			scrollFrame.ZIndex = 101
			scrollFrame.Parent = dropdownPanel

			local listLayout = Instance.new("UIListLayout")
			listLayout.SortOrder = Enum.SortOrder.LayoutOrder
			listLayout.Parent = scrollFrame

			local maxVisibleItems = 8
			local itemHeight = 28
			local totalHeight = math.min(#models, maxVisibleItems) * itemHeight + 4
			dropdownPanel.Size = UDim2.new(0, containerAbsSize.X, 0, totalHeight)

			for i, model in ipairs(models) do
				local item = Instance.new("TextButton")
				item.Name = "Item_" .. model
				item.Size = UDim2.new(1, 0, 0, itemHeight)
				item.BackgroundTransparency = (model == btn.Text) and 0 or 1
				item.BackgroundColor3 = Theme.Accent
				item.Text = model
				item.TextColor3 = (model == btn.Text) and Color3.fromRGB(255, 255, 255) or Theme.TextPrimary
				item.Font = Theme.FontRegular
				item.TextSize = Theme.TextSizeRegular
				item.TextXAlignment = Enum.TextXAlignment.Left
				item.ZIndex = 102
				item.LayoutOrder = i
				item.Parent = scrollFrame

				local itemPadding = Instance.new("UIPadding")
				itemPadding.PaddingLeft = UDim.new(0, 8)
				itemPadding.Parent = item

				item.Activated:Connect(function()
					btn.Text = model
					closeDropdown()
				end)

				item.MouseEnter:Connect(function()
					if model ~= btn.Text then
						item.BackgroundTransparency = 0.5
						item.BackgroundColor3 = Theme.BgTertiary
					end
				end)

				item.MouseLeave:Connect(function()
					if model ~= btn.Text then
						item.BackgroundTransparency = 1
					end
				end)
			end

			-- Close dropdown when clicking outside
			closeConnection = frame.InputBegan:Connect(function(input)
				if dropdownOpen and input.UserInputType == Enum.UserInputType.MouseButton1 then
					task.defer(closeDropdown)
				end
			end)
		end

		btn.Activated:Connect(function()
			if dropdownOpen then
				closeDropdown()
			else
				openDropdown()
			end
		end)
	end

	-- ── Custom Model Input ─────────────────────────────────────────────

	local customModelLabel = Instance.new("TextLabel")
	customModelLabel.Name = "Label"
	customModelLabel.Size = UDim2.new(1, -50, 0, 16)
	customModelLabel.BackgroundTransparency = 1
	customModelLabel.Text = "Custom Model (optional)"
	customModelLabel.TextColor3 = Theme.TextSecondary
	customModelLabel.Font = Theme.FontRegular
	customModelLabel.TextSize = Theme.TextSizeRegular
	customModelLabel.TextXAlignment = Enum.TextXAlignment.Left
	customModelLabel.LayoutOrder = 8
	customModelLabel.ZIndex = 51
	customModelLabel.Parent = contentFrame

	local customModelInput = Instance.new("TextBox")
	customModelInput.Name = "CustomModelInput"
	customModelInput.Size = UDim2.new(1, 0, 0, 28)
	customModelInput.Position = UDim2.new(0, 0, 0, 36)
	customModelInput.BackgroundColor3 = Theme.BgInput
	customModelInput.BorderSizePixel = 0
	customModelInput.Text = SettingsStore.getCustomModel(currentProvider)
	customModelInput.TextColor3 = Theme.TextPrimary
	customModelInput.PlaceholderText = "e.g., custom-model-name"
	customModelInput.PlaceholderColor3 = Theme.TextMuted
	customModelInput.Font = Theme.FontRegular
	customModelInput.TextSize = Theme.TextSizeRegular
	customModelInput.TextXAlignment = Enum.TextXAlignment.Left
	customModelInput.ZIndex = 51
	customModelInput.Parent = contentFrame

	local customModelCorner = Instance.new("UICorner")
	customModelCorner.CornerRadius = UDim.new(0, Theme.BorderRadius)
	customModelCorner.Parent = customModelInput

	local customModelPad = Instance.new("UIPadding")
	customModelPad.PaddingLeft = UDim.new(0, 8)
	customModelPad.Parent = customModelInput

	-- Get models for current provider + plan
	local function getModelList(): {string}
		local provider = Providers.getProvider(currentProvider)
		if currentProvider == "opencode" then
			return provider.getModelsForPlan(currentPlan)
		end
		return provider.models
	end

	local function refreshModelSelector()
		local models = getModelList()
		local savedModel = SettingsStore.getModel(currentProvider)

		local selected = models[1]
		for _, m in ipairs(models) do
			if m == savedModel then
				selected = m
				break
			end
		end

		createModelCycleButton(models, selected)
	end

	-- Initialize model selector
	refreshModelSelector()

	-- ── Events ─────────────────────────────────────────────────────────────

	providerBtn.Activated:Connect(function()
		providerIdx = providerIdx % #providerNames + 1
		currentProvider = providerNames[providerIdx]
		providerBtn.Text = Providers.getProvider(currentProvider).displayName

		-- Update key input
		keyInput.Text = SettingsStore.getApiKey(currentProvider) or ""

		-- Toggle plan visibility
		local isOpencode = (currentProvider == "opencode")
		planLabel.Visible = isOpencode
		planBtn.Visible = isOpencode
		baseUrlLabel.Visible = isOpencode
		baseUrlInput.Visible = isOpencode
		if isOpencode then
			local plan = SettingsStore.getOpencodePlan()
			baseUrlInput.Text = OPENCODE_PLANS[plan] or OPENCODE_PLANS.zen
		end

		-- Refresh model selector
		refreshModelSelector()
	end)

	planBtn.Activated:Connect(function()
		planIdx = planIdx % #planNames + 1
		currentPlan = planNames[planIdx]
		planBtn.Text = currentPlan:gsub("^%l", string.upper)

		-- Update base URL
		local newUrl = OPENCODE_PLANS[currentPlan] or OPENCODE_PLANS.zen
		baseUrlInput.Text = newUrl

		-- Refresh model selector for new plan
		refreshModelSelector()
	end)

	saveBtn.Activated:Connect(function()
		SettingsStore.setProvider(currentProvider)
		SettingsStore.setModel(currentProvider, getCurrentModel())
		SettingsStore.setCustomModel(currentProvider, customModelInput.Text)
		SettingsStore.setApiKey(currentProvider, keyInput.Text)
		if currentProvider == "opencode" then
			SettingsStore.setBaseUrl(currentProvider, baseUrlInput.Text)
			SettingsStore.setOpencodePlan(currentPlan)
		end
		SettingsStore.setAllowCodeExecution(allowExecToggle.Text == "ON")
		SettingsStore.setRequireApproval(approvalToggle.Text == "ON")
		SettingsStore.setEnableAgentMode(agentModeToggle.Text == "ON")
		SettingsStore.setGeminiApiKey(geminiKeyInput.Text)
		SettingsStore.setWebSearchProvider(currentSearchProvider)
		SettingsStore.setMaxToolIterations(maxIterations)
		onClose()
	end)

	closeBtn.Activated:Connect(function()
		onClose()
	end)

	return frame
end

return SettingsPanel
