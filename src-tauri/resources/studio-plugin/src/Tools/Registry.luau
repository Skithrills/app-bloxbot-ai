--!strict
-- ============================================================
-- Tools/Registry.luau | ModuleScript
-- Description: Central registry for all AI-callable tools.
--              Tools self-register and expose a schema + execute function.
-- ============================================================

local Registry = {}

-- [ PRIVATE VARIABLES ] --------------------------------------

local _tools: {[string]: Tool} = {}

-- [ TYPES ] --------------------------------------------------

export type ToolParameter = {
	type: string,
	description: string,
	enum: {string}?,
}

export type Tool = {
	name: string,
	description: string,
	parameters: {
		type: string,
		properties: {[string]: ToolParameter},
		required: {string}?
	},
	execute: (args: {[string]: any}) -> (boolean, string)
}

-- [ PUBLIC FUNCTIONS ] ---------------------------------------

function Registry.register(tool: Tool)
	if typeof(tool.name) ~= "string" or tool.name == "" then
		error("Tool must have a non-empty name")
	end
	if typeof(tool.execute) ~= "function" then
		error("Tool must have an execute function")
	end
	_tools[tool.name] = tool
end

function Registry.get(name: string): Tool?
	return _tools[name]
end

function Registry.getAll(): {Tool}
	local list = {}
	for _, tool in pairs(_tools) do
		table.insert(list, tool)
	end
	-- Sort by name for deterministic ordering
	table.sort(list, function(a: Tool, b: Tool)
		return a.name < b.name
	end)
	return list
end

function Registry.getSchemaList(): {{[string]: any}}
	local schemas = {}
	for _, tool in ipairs(Registry.getAll()) do
		table.insert(schemas, {
			type = "function",
			["function"] = {
				name = tool.name,
				description = tool.description,
				parameters = tool.parameters,
			}
		})
	end
	return schemas
end

function Registry.execute(name: string, args: {[string]: any}): (boolean, string)
	local tool = _tools[name]
	if not tool then
		return false, `Tool "{name}" not found. Available: {Registry.listNames()}`
	end

	-- Validate required parameters
	if tool.parameters.required then
		for _, paramName in ipairs(tool.parameters.required) do
			if args[paramName] == nil then
				return false, `Missing required parameter "{paramName}" for tool "{name}"`
			end
		end
	end

	local success, result = pcall(tool.execute, args)
	if not success then
		return false, `Tool "{name}" execution error: {tostring(result)}`
	end
	return true, result
end

function Registry.listNames(): string
	local names = {}
	for _, tool in ipairs(Registry.getAll()) do
		table.insert(names, tool.name)
	end
	return table.concat(names, ", ")
end

function Registry.clear()
	table.clear(_tools)
end

return Registry
