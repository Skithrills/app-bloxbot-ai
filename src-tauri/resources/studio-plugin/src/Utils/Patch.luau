--!strict
-- ============================================================
-- Utils/Patch.luau | ModuleScript
-- Description: Diff/patch utility for surgical script edits.
-- ============================================================

local Patch = {}

-- [ PUBLIC FUNCTIONS ] ---------------------------------------

function Patch.applyPatch(source: string, oldText: string, newText: string): (boolean, string?)
	if oldText == "" then
		return false, nil
	end

	-- Escape special pattern characters in oldText for string.find
	local escaped = oldText:gsub("([%%%.%+%-%*%?%[%]%^%$%(%)])", "%%%1")

	-- Count occurrences
	local count = 0
	local startIdx = 1
	while true do
		local s, e = source:find(escaped, startIdx, true)
		if not s then
			break
		end
		count += 1
		startIdx = e + 1
	end

	if count == 0 then
		return false, nil
	end

	if count > 1 then
		return false, nil
	end

	-- Exact single match — safe to replace
	local newSource = source:gsub(escaped, newText:gsub("%%", "%%%%"), 1)
	return true, newSource
end

function Patch.applyPatchOrReplace(source: string, oldText: string, newText: string): string
	local ok, result = Patch.applyPatch(source, oldText, newText)
	if ok and result then
		return result
	end
	-- Fallback: full replacement
	return newText
end

return Patch
