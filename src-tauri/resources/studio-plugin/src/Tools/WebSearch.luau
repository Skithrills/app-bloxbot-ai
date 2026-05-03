--!strict
-- ============================================================
-- Tools/WebSearch.luau | ModuleScript
-- Description: Web search tool with Gemini API primary and
--              DuckDuckGo scraping fallback.
-- ============================================================

local Registry = require(script.Parent.Registry)
local Http = require(script.Parent.Parent.Utils.Http)
local SettingsStore = require(script.Parent.Parent.Settings.SettingsStore)

local HttpService = game:GetService("HttpService")

local WebSearch = {}

-- [ PRIVATE FUNCTIONS ] --------------------------------------

local function searchViaGemini(query: string): (boolean, string)
	local apiKey = SettingsStore.getGeminiApiKey()
	if not apiKey or apiKey == "" then
		return false, "No Gemini API key configured"
	end

	local url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={apiKey}`

	local body = {
		contents = {
			{
				role = "user",
				parts = {
					{text = query},
				},
			},
		},
		tools = {
			{googleSearch = {}},
		},
	}

	local ok, data, status = Http.post(url, body, {
		["Content-Type"] = "application/json",
	})

	if not ok then
		return false, `Gemini API error (HTTP {status}): {tostring(data)}`
	end

	if not data or not data.candidates or not data.candidates[1] then
		return false, "Unexpected response from Gemini API"
	end

	local candidate = data.candidates[1]
	local text = ""

	if candidate.content and candidate.content.parts then
		for _, part in ipairs(candidate.content.parts) do
			if part.text then
				text = text .. part.text
			end
		end
	end

	-- Add citations if available
	local citations = {}
	if candidate.groundingMetadata and candidate.groundingMetadata.groundingChunks then
		for idx, chunk in ipairs(candidate.groundingMetadata.groundingChunks) do
			if chunk.web then
				table.insert(citations, `[{idx}] {chunk.web.title}: {chunk.web.uri}`)
			end
		end
	end

	if #citations > 0 then
		text = text .. "\n\n--- Sources ---\n" .. table.concat(citations, "\n")
	end

	if text == "" then
		return false, "No search results returned from Gemini"
	end

	return true, text
end

local function searchViaDuckDuckGo(query: string): (boolean, string)
	local encodedQuery = HttpService:UrlEncode(query)
	local url = `https://html.duckduckgo.com/html/?q={encodedQuery}`

	local ok, result = Http.request({
		Url = url,
		Method = "GET",
		Headers = {
			["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		},
	})

	if not ok or not result then
		return false, "DuckDuckGo request failed"
	end

	local html = result.Body
	local results = {}

	-- Extract result titles and snippets using pattern matching
	-- DuckDuckGo Lite HTML structure:
	-- <a class="result__a" href="...">Title</a>
	-- <a class="result__snippet">Snippet</a>

	local count = 0
	local startIdx = 1
	while count < 5 do
		local titleStart, titleEnd, title = html:find('<a[^>]-class="result__a"[^>]*>(.-)</a>', startIdx)
		if not titleStart then
			break
		end

		-- Clean title HTML entities
		title = title:gsub("&amp;", "&"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '\"')

		local snippetStart, snippetEnd, snippet = html:find('<a[^>]-class="result__snippet"[^>]*>(.-)</a>', titleEnd)
		if snippetStart then
			snippet = snippet:gsub("&amp;", "&"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&quot;", '\"')
			snippet = snippet:gsub("<.->", "") -- strip any remaining tags
		else
			snippet = ""
		end

		table.insert(results, `**{title}**\n{snippet}`)
		count += 1

		if snippetEnd then
			startIdx = snippetEnd + 1
		else
			startIdx = titleEnd + 1
		end
	end

	if #results == 0 then
		return false, "No results found on DuckDuckGo"
	end

	return true, table.concat(results, "\n\n")
end

-- [ TOOL DEFINITION ] ----------------------------------------

local function defineWebSearchTool()
	Registry.register({
		name = "web_search",
		description = "Searches the web for the given query and returns a summary of results with citations. Use this for live documentation, best practices, or current information.",
		parameters = {
			type = "object",
			properties = {
				query = {
					type = "string",
					description = "The search query.",
				},
			},
			required = {"query"},
		},
		execute = function(args)
			local query = args.query
			if typeof(query) ~= "string" or query == "" then
				return false, "query must be a non-empty string"
			end

			local provider = SettingsStore.getWebSearchProvider()

			-- Try Gemini first if available or auto
			if provider == "auto" or provider == "gemini" then
				local ok, result = searchViaGemini(query)
				if ok then
					return true, result
				elseif provider == "gemini" then
					return false, result
				end
				-- If auto and Gemini failed, fall through to DuckDuckGo
			end

			-- Try DuckDuckGo
			if provider == "auto" or provider == "duckduckgo" then
				local ok, result = searchViaDuckDuckGo(query)
				if ok then
					return true, result
				else
					return false, result
				end
			end

			return false, "Web search failed. No provider available."
		end,
	})
end

-- [ INIT ] ---------------------------------------------------

defineWebSearchTool()

return WebSearch
