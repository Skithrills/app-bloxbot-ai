-- Chat/Markdown/MarkdownParser.lua
-- Lightweight markdown parser for Roblox RichText
-- Handles blocks (paragraphs, code fences, headers, lists) and inline formatting

local Theme = require(script.Parent.Parent.Parent.Theme)

local MarkdownParser = {}
MarkdownParser._onCodeAction = nil

-- Safely coerce any value to a string (nil/false → "", booleans/numbers → tostring)
local function asString(value: any): string
	if value == nil then return "" end
	if typeof(value) == "string" then return value end
	return tostring(value)
end

function MarkdownParser.setCodeActionHandler(handler: (action: string, code: string) -> ())
	MarkdownParser._onCodeAction = handler
end

-- ── Inline formatting ────────────────────────────────────────────────────

local INLINE_PATTERNS = {
	-- In Lua patterns, %* = literal asterisk (unescaped * is a quantifier)
	{ pattern = "%*%*%*([^%*]-)%*%*%*",  replacement = "<b><i>%1</i></b>" }, -- ***text***
	{ pattern = "%*%*([^%*]-)%*%*",      replacement = "<b>%1</b>" },         -- **text**
	{ pattern = "%*([^%*]-)%*",          replacement = "<i>%1</i>" },         -- *text*
	{ pattern = "__([^_]-)__",            replacement = "<u>%1</u>" },         -- __text__
	{ pattern = "~~([^~]-)~~",            replacement = "<s>%1</s>" },         -- ~~text~~
	{ pattern = "`([^`]-)`",              replacement = `<font face="{Theme.FontCode.Name}" color="#e5e7eb">%1</font>` }, -- `code`
}

function MarkdownParser.parseInline(text: string): string
	text = asString(text)
	-- Escape XML special chars first
	text = text:gsub("&", "&amp;")
	text = text:gsub("<", "&lt;")
	text = text:gsub(">", "&gt;")
	
	-- Then apply formatting
	for _, rule in ipairs(INLINE_PATTERNS) do
		text = text:gsub(rule.pattern, rule.replacement)
	end
	
	-- Links: [text](url) → colored underlined text (no clickable href in RichText)
	text = text:gsub("%[([^%]]-)%]%(([^%)]-)%)", `<u><font color="#{Theme.TextLink:ToHex()}">%1</font></u>`)
	
	return text
end

-- ── Block parsing ────────────────────────────────────────────────────────

export type Block = {
	type: "text" | "code" | "header" | "list" | "divider",
	content: string,
	language: string?, -- for code blocks
	level: number?,    -- for headers
}

function MarkdownParser.parseBlocks(markdown: string): {Block}
	markdown = asString(markdown)
	local blocks = {}
	local lines = markdown:split("\n")
	local i = 1
	
	while i <= #lines do
		local line = lines[i]
		
		-- Empty line
		if line:match("^%s*$") then
			i += 1
			continue
		end
		
		-- Code fence
		if line:match("^```") then
			local lang = line:match("^```(%w*)") or ""
			local codeLines = {}
			i += 1
			while i <= #lines and not lines[i]:match("^```") do
				table.insert(codeLines, lines[i])
				i += 1
			end
			i += 1 -- skip closing ```
			table.insert(blocks, {
				type = "code",
				content = table.concat(codeLines, "\n"),
				language = lang,
			})
			continue
		end
		
		-- Header
		local headerLevel, headerText = line:match("^(#+)%s*(.+)")
		if headerLevel and #headerLevel <= 3 then
			table.insert(blocks, {
				type = "header",
				content = MarkdownParser.parseInline(headerText),
				level = #headerLevel,
			})
			i += 1
			continue
		end
		
		-- Divider
		if line:match("^%-%-%-+%s*$") or line:match("^%*%*%*+%s*$") then
			table.insert(blocks, { type = "divider", content = "" })
			i += 1
			continue
		end
		
		-- List item
		if line:match("^%s*[-*+]%s+") or line:match("^%s*%d+%.%s+") then
			local listLines = {}
			while i <= #lines do
				local l = lines[i]
				if l:match("^%s*[-*+]%s+") or l:match("^%s*%d+%.%s+") then
					table.insert(listLines, l)
					i += 1
				elseif l:match("^%s+") and #l > 0 then
					-- Continuation line
					table.insert(listLines, l)
					i += 1
				else
					break
				end
			end
			
			local listText = {}
			for _, l in ipairs(listLines) do
				local item = l:match("^%s*[-*+]%s+(.+)") or l:match("^%s*%d+%.%s+(.+)") or l
				table.insert(listText, "• " .. MarkdownParser.parseInline(item))
			end
			
			table.insert(blocks, {
				type = "list",
				content = table.concat(listText, "\n"),
			})
			continue
		end
		
		-- Paragraph / text block
		local textLines = {}
		while i <= #lines do
			local l = lines[i]
			if l:match("^%s*$") or l:match("^```") or l:match("^#") 
				or l:match("^%s*[-*+]%s+") or l:match("^%s*%d+%.%s+")
				or l:match("^%-%-%-+") or l:match("^%*%*%*+") then
				break
			end
			table.insert(textLines, l)
			i += 1
		end
		
		if #textLines > 0 then
			local raw = table.concat(textLines, " ")
			table.insert(blocks, {
				type = "text",
				content = MarkdownParser.parseInline(raw),
			})
		end
	end
	
	return blocks
end

-- ── Render blocks to GUI instances ───────────────────────────────────────

function MarkdownParser.renderToFrame(blocks: {Block}, parent: Instance)
	local yOffset = 0
	local padding = Theme.PaddingRegular
	local richTextBuffer: {string} = {}

	local function flushTextBox()
		if #richTextBuffer == 0 then return end
		local text = table.concat(richTextBuffer, "\n\n")
		local textBox = Instance.new("TextBox")
		textBox.Name = "RichTextBlock"
		textBox.Size = UDim2.new(1, -padding * 2, 0, 0)
		textBox.Position = UDim2.new(0, padding, 0, yOffset)
		textBox.BackgroundTransparency = 1
		textBox.Text = text
		textBox.TextColor3 = Theme.TextPrimary
		textBox.Font = Theme.FontRegular
		textBox.TextSize = Theme.TextSizeRegular
		textBox.RichText = true
		textBox.TextWrapped = true
		textBox.TextXAlignment = Enum.TextXAlignment.Left
		textBox.TextYAlignment = Enum.TextYAlignment.Top
		textBox.AutomaticSize = Enum.AutomaticSize.Y
		textBox.TextEditable = false
		textBox.ClearTextOnFocus = false
		textBox.MultiLine = true
		textBox.Parent = parent
		yOffset += textBox.AbsoluteSize.Y + padding
		richTextBuffer = {}
	end

	for _, block in ipairs(blocks) do
		if block.type == "code" then
			flushTextBox()

			local frame = Instance.new("Frame")
			frame.Name = "CodeBlock"
			frame.Size = UDim2.new(1, -padding * 2, 0, 0)
			frame.Position = UDim2.new(0, padding, 0, yOffset)
			frame.BackgroundColor3 = Theme.BgCode
			frame.BorderSizePixel = 0
			frame.AutomaticSize = Enum.AutomaticSize.Y

			local corner = Instance.new("UICorner")
			corner.CornerRadius = UDim.new(0, Theme.BorderRadius)
			corner.Parent = frame

			local innerPadding = Instance.new("UIPadding")
			innerPadding.PaddingTop = UDim.new(0, padding + 22)
			innerPadding.PaddingBottom = UDim.new(0, padding)
			innerPadding.PaddingLeft = UDim.new(0, padding)
			innerPadding.PaddingRight = UDim.new(0, padding)
			innerPadding.Parent = frame

			-- Language label + action buttons bar
			local topBar = Instance.new("Frame")
			topBar.Name = "TopBar"
			topBar.Size = UDim2.new(1, 0, 0, 22)
			topBar.BackgroundTransparency = 1
			topBar.ZIndex = 2
			topBar.Parent = frame

			local langLabel = Instance.new("TextLabel")
			langLabel.Name = "Lang"
			langLabel.Size = UDim2.new(0.3, 0, 1, 0)
			langLabel.Position = UDim2.new(0, padding, 0, 0)
			langLabel.BackgroundTransparency = 1
			langLabel.Text = block.language ~= "" and block.language or "code"
			langLabel.TextColor3 = Theme.TextMuted
			langLabel.Font = Theme.FontCode
			langLabel.TextSize = Theme.TextSizeSmall
			langLabel.TextXAlignment = Enum.TextXAlignment.Left
			langLabel.ZIndex = 2
			langLabel.Parent = topBar

			local isLua = block.language == "lua" or block.language == "luau"
			local btnWidth = isLua and 40 or 50
			local btnSpacing = 4
			local totalBtnWidth = isLua and (btnWidth * 2 + btnSpacing) or btnWidth

			-- Insert button
			local insertBtn = Instance.new("TextButton")
			insertBtn.Name = "InsertBtn"
			insertBtn.Size = UDim2.new(0, btnWidth, 0, 18)
			insertBtn.Position = UDim2.new(1, -padding - totalBtnWidth, 0.5, -9)
			insertBtn.BackgroundColor3 = Theme.BgTertiary
			insertBtn.BorderSizePixel = 0
			insertBtn.Text = "Insert"
			insertBtn.TextColor3 = Theme.TextSecondary
			insertBtn.Font = Theme.FontBold
			insertBtn.TextSize = Theme.TextSizeSmall
			insertBtn.ZIndex = 2
			insertBtn.Parent = topBar

			local btnCorner = Instance.new("UICorner")
			btnCorner.CornerRadius = UDim.new(0, 4)
			btnCorner.Parent = insertBtn

			local codeContent = block.content
			insertBtn.Activated:Connect(function()
				if MarkdownParser._onCodeAction then
					MarkdownParser._onCodeAction("insert", codeContent)
				end
				-- Brief visual feedback
				insertBtn.Text = "Done"
				insertBtn.TextColor3 = Theme.StatusConnected
				task.wait(1.2)
				if insertBtn and insertBtn.Parent then
					insertBtn.Text = "Insert"
					insertBtn.TextColor3 = Theme.TextSecondary
				end
			end)

			-- Run button (only for lua/luau blocks)
			local runBtn = nil
			if isLua then
				runBtn = Instance.new("TextButton")
				runBtn.Name = "RunBtn"
				runBtn.Size = UDim2.new(0, btnWidth, 0, 18)
				runBtn.Position = UDim2.new(1, -padding - btnWidth, 0.5, -9)
				runBtn.BackgroundColor3 = Theme.Accent
				runBtn.BorderSizePixel = 0
				runBtn.Text = "Run"
				runBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
				runBtn.Font = Theme.FontBold
				runBtn.TextSize = Theme.TextSizeSmall
				runBtn.ZIndex = 2
				runBtn.Parent = topBar

				local runCorner = Instance.new("UICorner")
				runCorner.CornerRadius = UDim.new(0, 4)
				runCorner.Parent = runBtn

				runBtn.Activated:Connect(function()
					if MarkdownParser._onCodeAction then
						MarkdownParser._onCodeAction("run", codeContent)
					end
					-- Brief visual feedback
					runBtn.Text = "Done"
					task.wait(1.2)
					if runBtn and runBtn.Parent then
						runBtn.Text = "Run"
					end
				end)
			end

			local textBox = Instance.new("TextBox")
			textBox.Name = "CodeText"
			textBox.Size = UDim2.new(1, 0, 0, 0)
			textBox.Position = UDim2.new(0, 0, 0, 22)
			textBox.BackgroundTransparency = 1
			textBox.Text = block.content
			textBox.TextColor3 = Theme.TextPrimary
			textBox.Font = Theme.FontCode
			textBox.TextSize = Theme.TextSizeRegular
			textBox.TextWrapped = true
			textBox.TextXAlignment = Enum.TextXAlignment.Left
			textBox.TextYAlignment = Enum.TextYAlignment.Top
			textBox.ClearTextOnFocus = false
			textBox.TextEditable = false
			textBox.MultiLine = true
			textBox.AutomaticSize = Enum.AutomaticSize.Y
			textBox.ZIndex = 1
			textBox.Parent = frame

			frame.Parent = parent
			yOffset += frame.AbsoluteSize.Y + padding

		elseif block.type == "text" then
			table.insert(richTextBuffer, block.content)

		elseif block.type == "header" then
			local size = block.level == 1 and "24" or block.level == 2 and "20" or "18"
			table.insert(richTextBuffer, `<b><font size="{size}">{block.content}</font></b>`)

		elseif block.type == "list" then
			table.insert(richTextBuffer, block.content)

		elseif block.type == "divider" then
			local hex = string.format("%02x%02x%02x",
				math.round(Theme.Divider.R * 255),
				math.round(Theme.Divider.G * 255),
				math.round(Theme.Divider.B * 255))
			table.insert(richTextBuffer,
				`<font color="#{hex}">────────────────────────────────────────</font>`)
		end
	end

	flushTextBox()
	return yOffset
end

return MarkdownParser
