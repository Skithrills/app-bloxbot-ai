--!strict
-- ============================================================
-- Tools/LintTools.luau | ModuleScript
-- Description: Registers studio_lint_script tool with the Registry.
--              Uses loadstring for syntax checking and pattern-based
--              checks for common Luau pitfalls.
-- ============================================================

local Registry = require(script.Parent.Registry)

local LintTools = {}

-- [ FORWARD DECLARATIONS ] -----------------------------------

local lintCode
local checkReservedKeywordsAsBareKeys
local checkDeprecatedAPIs
local checkInstanceNewParent
local checkGlobalAssignments

-- [ CONSTANTS ] ----------------------------------------------

local RESERVED_KEYWORDS = {
	"and", "break", "do", "else", "elseif", "end",
	"for", "function", "if", "in", "local", "not",
	"or", "repeat", "return", "then", "until", "while",
}

-- [ PRIVATE FUNCTIONS ] --------------------------------------

-- Check for reserved keywords used as bare table keys
-- e.g. `function = {` instead of `["function"] = {`
checkReservedKeywordsAsBareKeys = function(code: string): {string}
	local warnings = {}

	-- Split code into lines for line-number reporting
	local lines = code:split("\n")

	-- Track whether we're inside a table constructor
	local depth = 0
	for lineNum, line in ipairs(lines) do
		-- Count opening and closing braces to track table depth
		local i = 1
		while i <= #line do
			local char = line:sub(i, i)
			if char == "{" then
				depth += 1
			elseif char == "}" then
				depth = math.max(0, depth - 1)
			end
			i += 1
		end

		-- Only check for reserved keywords when inside a table constructor
		if depth > 0 then
			for _, keyword in ipairs(RESERVED_KEYWORDS) do
				-- Match: `keyword =` but not `["keyword"] =`
				-- Pattern: keyword at word boundary followed by `=`
				-- We need to avoid matching inside strings or bracket syntax
				local pattern = "^%s*" .. keyword .. "%s*="
				if line:match(pattern) then
					-- Check it's not inside a bracket expression like ["function"]
					local beforeKeyword = line:sub(1, line:find(keyword, 1, true) - 1)
					if not beforeKeyword:match("%[\"$") and not beforeKeyword:match("%[%[%'$") then
						table.insert(warnings, string.format(
							"Line %d: Reserved keyword `%s` used as bare table key — use `[\"%s\"]` instead",
							lineNum, keyword, keyword
						))
					end
				end
			end
		end
	end

	return warnings
end

-- Check for deprecated API calls
checkDeprecatedAPIs = function(code: string): {string}
	local warnings = {}
	local lines = code:split("\n")

	for lineNum, line in ipairs(lines) do
		-- Skip comments
		if line:match("^%s*%-%-") then
			continue
		end

		-- Check: wait() → task.wait()
		for match in line:gmatch("wait%s*%(") do
			-- Make sure it's not task.wait or a method call like :wait()
			local stripped = line:gsub("^%s*", "")
			if not stripped:match("^task%.wait") and not stripped:match(":wait%s*%(") then
				-- Check if it's just `wait(` (standalone function call)
				local beforeWait = line:sub(1, line:find("wait%s*%(") - 1)
				if beforeWait:match("^%s*$") or beforeWait:match("[%s,=({]") then
					-- Avoid double-reporting if task.wait is on the same line
					if not line:match("task%.wait") then
						table.insert(warnings, string.format(
							"Line %d: `wait()` is deprecated — use `task.wait()` instead",
							lineNum
						))
					end
				end
			end
		end

		-- Check: spawn() → task.spawn()
		if line:match("[^%.]spawn%s*%(") and not line:match("task%.spawn") then
			table.insert(warnings, string.format(
				"Line %d: `spawn()` is deprecated — use `task.spawn()` instead",
				lineNum
			))
		end

		-- Check: delay() → task.defer()
		if line:match("[^%.]delay%s*%(") and not line:match("task%.delay") then
			table.insert(warnings, string.format(
				"Line %d: `delay()` is deprecated — use `task.defer()` instead",
				lineNum
			))
		end
	end

	return warnings
end

-- Check for Instance.new with parent in constructor
checkInstanceNewParent = function(code: string): {string}
	local warnings = {}
	local lines = code:split("\n")

	for lineNum, line in ipairs(lines) do
		-- Match: Instance.new("ClassName", parent)
		-- The second argument is the parent, which should be set separately
		local className, rest = line:match("Instance%.new%s*%(%s*\"([^\"]+)\"%s*,%s*(.*)")
		if className and rest then
			-- Check if rest ends with ) — meaning there's a second arg
			if rest:match("^") and rest:sub(-1) == ")" then
				-- There's a parent argument
				table.insert(warnings, string.format(
					"Line %d: `Instance.new(\"%s\", ...)` — parent should be set last, not in the constructor",
					lineNum, className
				))
			end
		end
	end

	return warnings
end

-- Check for global assignments (missing `local`)
checkGlobalAssignments = function(code: string): {string}
	local warnings = {}
	local lines = code:split("\n")

	for lineNum, line in ipairs(lines) do
		-- Skip comments and empty lines
		local stripped = line:match("^%s*(.-)%s*$")
		if stripped == "" or stripped:sub(1, 2) == "--" then
			continue
		end

		-- Match: `identifier = value` at the start of a line (not `local identifier`)
		-- But not: `identifier:method()`, `identifier.property =`, `identifier[key] =`
		-- Also skip function definitions: `function name(`
		if stripped:match("^[a-zA-Z_][a-zA-Z0-9_]*%s*=[^=]") then
			-- It's a simple assignment at module scope without `local`
			-- Check it's not inside a function (rough heuristic: indented lines are inside blocks)
			local indent = #line - #line:gsub("^%s+", "")
			if indent == 0 then
				-- Top-level assignment without local — likely a global
				local varName = stripped:match("^([a-zA-Z_][a-zA-Z0-9_]*)%s*=")
				if varName then
					-- Skip common allowed globals in plugin context
					local allowedGlobals = {
						["Plugin"] = true,
						["plugin"] = true,
					}
					if not allowedGlobals[varName] then
						table.insert(warnings, string.format(
							"Line %d: Global assignment `%s = ...` — consider adding `local`",
							lineNum, varName
						))
					end
				end
			end
		end
	end

	return warnings
end

-- Main lint function: syntax check + pattern checks
lintCode = function(code: string, filePath: string?): (boolean, string)
	local errors = {}
	local warnings = {}
	local pathLabel = filePath or "script"

	-- 1. Syntax check via loadstring
	local ok, err = pcall(function()
		local fn, loadErr = loadstring(code)
		if not fn then
			error(loadErr or "Unknown syntax error")
		end
	end)

	if not ok then
		-- loadstring error format: "script:LINE: message"
		local errMsg = tostring(err)
		table.insert(errors, errMsg)
	end

	-- 2. Pattern-based checks (run even if syntax check failed, some may still apply)
	local keywordWarnings = checkReservedKeywordsAsBareKeys(code)
	for _, w in ipairs(keywordWarnings) do
		table.insert(warnings, w)
	end

	local deprecatedWarnings = checkDeprecatedAPIs(code)
	for _, w in ipairs(deprecatedWarnings) do
		table.insert(warnings, w)
	end

	local instanceWarnings = checkInstanceNewParent(code)
	for _, w in ipairs(instanceWarnings) do
		table.insert(warnings, w)
	end

	local globalWarnings = checkGlobalAssignments(code)
	for _, w in ipairs(globalWarnings) do
		table.insert(warnings, w)
	end

	-- 3. Build report
	if #errors == 0 and #warnings == 0 then
		return true, string.format("✅ No issues found in %s.", pathLabel)
	end

	local lines = {}
	table.insert(lines, string.format("## Lint Results for %s", pathLabel))

	if #errors > 0 then
		table.insert(lines, "")
		table.insert(lines, "### Errors")
		for _, e in ipairs(errors) do
			table.insert(lines, "- " .. e)
		end
	end

	if #warnings > 0 then
		table.insert(lines, "")
		table.insert(lines, "### Warnings")
		for _, w in ipairs(warnings) do
			table.insert(lines, "- " .. w)
		end
	end

	return #errors == 0, table.concat(lines, "\n")
end

-- [ TOOL REGISTRATION ] -------------------------------------

local function defineLintTools()
	Registry.register({
		name = "studio_lint_script",
		description = "Lints Luau source code for syntax errors and common pitfalls. Returns a structured report of errors and warnings.",
		parameters = {
			type = "object",
			properties = {
				code = {
					type = "string",
					description = "The Luau source code to lint.",
				},
				path = {
					type = "string",
					description = "Optional file path or name for context in error messages.",
				},
			},
			required = {"code"},
		},
		execute = function(args)
			local code = args.code
			local filePath = args.path

			if typeof(code) ~= "string" then
				return false, "code must be a string"
			end

			if typeof(filePath) ~= "string" then
				filePath = "script"
			end

			local ok, report = lintCode(code, filePath)
			return ok, report
		end,
	})
end

-- [ INIT ] ---------------------------------------------------

defineLintTools()

return LintTools