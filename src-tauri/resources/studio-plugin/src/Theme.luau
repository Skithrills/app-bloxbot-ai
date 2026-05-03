-- Theme.lua
-- Design tokens for the BloxBot Chat UI (dark mode)

local Theme = {
	-- Colors (Roblox official palette)
	BgPrimary = Color3.fromRGB(25, 26, 31),
	BgSecondary = Color3.fromRGB(25, 26, 31),
	BgTertiary = Color3.fromRGB(45, 45, 45),
	BgInput = Color3.fromRGB(50, 50, 50),
	BgCode = Color3.fromRGB(25, 26, 31),
	
	TextPrimary = Color3.fromRGB(184, 184, 184),
	TextSecondary = Color3.fromRGB(156, 163, 175),
	TextMuted = Color3.fromRGB(107, 114, 128),
	TextLink = Color3.fromRGB(20, 70, 255),
	
	Accent = Color3.fromRGB(20, 70, 255),
	AccentHover = Color3.fromRGB(14, 58, 204),
	
	UserBubbleBg = Color3.fromRGB(20, 70, 255),
	UserBubbleText = Color3.fromRGB(255, 255, 255),
	AssistantBubbleBg = Color3.fromRGB(45, 45, 45),
	AssistantBubbleText = Color3.fromRGB(184, 184, 184),
	
	Border = Color3.fromRGB(54, 54, 54),
	Divider = Color3.fromRGB(55, 55, 55),
	
	StatusConnected = Color3.fromRGB(0, 186, 101),
	StatusConnecting = Color3.fromRGB(255, 184, 32),
	StatusDisconnected = Color3.fromRGB(205, 23, 14),
	
	-- Session status aliases
	StatusWorking = Color3.fromRGB(255, 184, 32),
	StatusDone = Color3.fromRGB(0, 186, 101),
	StatusError = Color3.fromRGB(205, 23, 14),
	
	-- Fonts
	FontRegular = Enum.Font.BuilderSans,
	FontBold = Enum.Font.BuilderSansBold,
	FontCode = Enum.Font.Code,
	
	-- Sizes
	TextSizeSmall = 11,
	TextSizeRegular = 13,
	TextSizeLarge = 15,
	TextSizeHeader = 16,
	
	PaddingSmall = 4,
	PaddingRegular = 8,
	PaddingLarge = 12,
	
	BorderRadius = 6,
	BorderRadiusLarge = 8,
}

return Theme
