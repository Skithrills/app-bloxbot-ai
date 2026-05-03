--!strict
-- ============================================================
-- Tools/StudioTools.luau | ModuleScript
-- Description: Structured wrappers around Roblox Studio APIs
--              for AI tool calling.
-- ============================================================

local Registry = require(script.Parent.Registry)
local StudioContext = require(script.Parent.Parent.Context.StudioContext)
local Patch = require(script.Parent.Parent.Utils.Patch)

local StudioTools = {}

-- [ PRIVATE FUNCTIONS ] --------------------------------------

local function resolvePath(path: string): Instance?
	if path == "" or path == "game" then
		return game
	end

	local parts = path:split(".")
	if #parts == 0 then
		return nil
	end

	local current: Instance? = game
	for _, part in ipairs(parts) do
		if not current then
			return nil
		end
		local child = current:FindFirstChild(part)
		if not child then
			return nil
		end
		current = child
	end
	return current
end

local function getInstancePath(instance: Instance): string
	local parts = {}
	local current = instance
	while current and current ~= game do
		table.insert(parts, 1, current.Name)
		current = current.Parent
	end
	return table.concat(parts, ".")
end

local function serializeProperties(instance: Instance): {[string]: any}
	local props = {}

	if instance:IsA("BasePart") then
		props.Position = tostring(instance.Position)
		props.Size = tostring(instance.Size)
		props.Color = tostring(instance.Color)
		props.Anchored = instance.Anchored
		props.CanCollide = instance.CanCollide
		props.Transparency = instance.Transparency
		props.Material = tostring(instance.Material)
	elseif instance:IsA("Model") then
		props.PrimaryPart = instance.PrimaryPart and instance.PrimaryPart.Name or nil
		props.Children = #instance:GetChildren()
	elseif instance:IsA("ValueBase") then
		props.Value = tostring(instance.Value)
	end

	-- Common properties
	props.Name = instance.Name
	props.ClassName = instance.ClassName

	return props
end

-- [ TOOL DEFINITIONS ] ---------------------------------------

local function defineStudioTools()
	Registry.register({
		name = "studio_get_selection",
		description = "Returns the currently selected instances in Roblox Studio with their paths and class names.",
		parameters = {
			type = "object",
			properties = {
				verbose = {
					type = "boolean",
					description = "Optional. If true, include additional metadata for each selected instance (ignored if absent).",
				},
			},
			required = {},
		},
		execute = function(args)
			local selection = game:GetService("Selection"):Get()
			if #selection == 0 then
				return true, "No instances are currently selected."
			end

			local verbose = args.verbose == true
			local lines = {"## Selected Instances"}
			for _, instance in ipairs(selection) do
				local path = getInstancePath(instance)
				table.insert(lines, `- {instance.Name} ({instance.ClassName}) at {path}`)
				if verbose then
					local props = serializeProperties(instance)
					for k, v in pairs(props) do
						table.insert(lines, `  - {k}: {tostring(v)}`)
					end
				end
			end
			return true, table.concat(lines, "\n")
		end,
	})

	Registry.register({
		name = "studio_get_instance_tree",
		description = "Returns the children of a given instance path. Use this to explore the datamodel.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the instance, e.g. 'Workspace' or 'ServerScriptService.MyScript'",
				},
			},
			required = {"path"},
		},
		execute = function(args)
			local path = args.path
			if typeof(path) ~= "string" then
				return false, "path must be a string"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			local lines = {`## Children of {path}`}
			local children = instance:GetChildren()
			if #children == 0 then
				table.insert(lines, "No children.")
			else
				for _, child in ipairs(children) do
					table.insert(lines, `- {child.Name} ({child.ClassName})`)
				end
			end
			return true, table.concat(lines, "\n")
		end,
	})

	Registry.register({
		name = "studio_get_properties",
		description = "Returns key properties of an instance at the given path.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the instance.",
				},
			},
			required = {"path"},
		},
		execute = function(args)
			local path = args.path
			if typeof(path) ~= "string" then
				return false, "path must be a string"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			local props = serializeProperties(instance)
			local lines = {`## Properties of {path}`}
			for key, value in pairs(props) do
				table.insert(lines, `- {key}: {tostring(value)}`)
			end
			return true, table.concat(lines, "\n")
		end,
	})

	Registry.register({
		name = "studio_set_property",
		description = "Sets a property value on an instance at the given path.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the instance.",
				},
				property = {
					type = "string",
					description = "Name of the property to set.",
				},
				value = {
					type = "string",
					description = "New value as a string. For Color3 use 'R,G,B' (0-1). For Vector3 use 'X,Y,Z'. For booleans use 'true' or 'false'. For enums use the enum item name.",
				},
			},
			required = {"path", "property", "value"},
		},
		execute = function(args)
			local path = args.path
			local property = args.property
			local valueStr = args.value

			if typeof(path) ~= "string" or typeof(property) ~= "string" or typeof(valueStr) ~= "string" then
				return false, "path, property, and value must be strings"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			local ok, result = pcall(function()
				local currentValue = (instance :: any)[property]
				local valueType = typeof(currentValue)

				local parsedValue: any
				if valueType == "boolean" then
					parsedValue = (valueStr:lower() == "true")
				elseif valueType == "number" then
					parsedValue = tonumber(valueStr)
					if parsedValue == nil then
						error(`Could not parse "{valueStr}" as a number`)
					end
				elseif valueType == "string" then
					parsedValue = valueStr
				elseif valueType == "Color3" then
					local r, g, b = valueStr:match("^([%d%.]+),([%d%.]+),([%d%.]+)$")
					if r and g and b then
						parsedValue = Color3.new(tonumber(r), tonumber(g), tonumber(b))
					else
						-- Try hex
						local hex = valueStr:match("^#?(%x%x%x%x%x%x)$")
						if hex then
							parsedValue = Color3.fromHex(hex)
						else
							error(`Could not parse "{valueStr}" as Color3. Use R,G,B (0-1) or hex.`)
						end
					end
				elseif valueType == "Vector3" then
					local x, y, z = valueStr:match("^([%d%-%.]+),([%d%-%.]+),([%d%-%.]+)$")
					if x and y and z then
						parsedValue = Vector3.new(tonumber(x), tonumber(y), tonumber(z))
					else
						error(`Could not parse "{valueStr}" as Vector3. Use X,Y,Z.`)
					end
				elseif valueType == "EnumItem" then
					local enumItem = nil
					local enumName = tostring(currentValue.EnumType)
					local enumType = Enum[enumName]
					if enumType then
						for _, item in ipairs(enumType:GetEnumItems()) do
							if item.Name == valueStr then
								enumItem = item
								break
							end
						end
					end
					if enumItem then
						parsedValue = enumItem
					else
						error(`Could not find enum item "{valueStr}" in {enumName}`)
					end
				else
					-- Fallback: try direct assignment as string
					parsedValue = valueStr
				end

				(instance :: any)[property] = parsedValue
				return parsedValue
			end)

			if not ok then
				return false, `Failed to set property: {tostring(result)}`
			end

			return true, `Set {path}.{property} = {tostring(result)}`
		end,
	})

	Registry.register({
		name = "studio_create_instance",
		description = "Creates a new instance of a given class and parents it to the specified path.",
		parameters = {
			type = "object",
			properties = {
				className = {
					type = "string",
					description = "The class name of the instance to create, e.g. 'Part', 'Script', 'RemoteEvent'.",
				},
				parentPath = {
					type = "string",
					description = "Dot-notation path to the parent instance.",
				},
				name = {
					type = "string",
					description = "Optional name for the new instance. Defaults to the class name.",
				},
			},
			required = {"className", "parentPath"},
		},
		execute = function(args)
			local className = args.className
			local parentPath = args.parentPath
			local name = args.name

			if typeof(className) ~= "string" or typeof(parentPath) ~= "string" then
				return false, "className and parentPath must be strings"
			end

			local parent = resolvePath(parentPath)
			if not parent then
				return false, `Parent not found at path: {parentPath}`
			end

			local ok, newInstance = pcall(function()
				return Instance.new(className)
			end)

			if not ok or not newInstance then
				return false, `Failed to create instance of class "{className}"`
			end

			if typeof(name) == "string" and name ~= "" then
				newInstance.Name = name
			end

			newInstance.Parent = parent
			local newPath = getInstancePath(newInstance)
			return true, `Created {newInstance.ClassName} "{newInstance.Name}" at {newPath}`
		end,
	})

	Registry.register({
		name = "studio_delete_instance",
		description = "Deletes an instance at the given path.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the instance to delete.",
				},
			},
			required = {"path"},
		},
		execute = function(args)
			local path = args.path
			if typeof(path) ~= "string" then
				return false, "path must be a string"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			local name = instance.Name
			local className = instance.ClassName
			instance:Destroy()
			return true, `Deleted {className} "{name}" from {path}`
		end,
	})

	Registry.register({
		name = "studio_get_script_source",
		description = "Returns the full Lua source code of a script at the given path.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the LuaSourceContainer.",
				},
			},
			required = {"path"},
		},
		execute = function(args)
			local path = args.path
			if typeof(path) ~= "string" then
				return false, "path must be a string"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			if not instance:IsA("LuaSourceContainer") then
				return false, `Instance at {path} is not a script (it's a {instance.ClassName})`
			end

			local source = (instance :: any).Source or ""
			return true, source
		end,
	})

	Registry.register({
		name = "studio_set_script_source",
		description = "Replaces the full source of a script at the given path. For targeted edits, use studio_apply_patch instead.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the LuaSourceContainer.",
				},
				source = {
					type = "string",
					description = "The new full source code.",
				},
			},
			required = {"path", "source"},
		},
		execute = function(args)
			local path = args.path
			local source = args.source

			if typeof(path) ~= "string" or typeof(source) ~= "string" then
				return false, "path and source must be strings"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			if not instance:IsA("LuaSourceContainer") then
				return false, `Instance at {path} is not a script (it's a {instance.ClassName})`
			end

			(instance :: any).Source = source
			return true, `Updated source of {path}`
		end,
	})

	Registry.register({
		name = "studio_apply_patch",
		description = "Applies a surgical patch to a script. Finds oldText in the script and replaces it with newText. Falls back to full replacement if the patch doesn't match exactly once.",
		parameters = {
			type = "object",
			properties = {
				path = {
					type = "string",
					description = "Dot-notation path to the LuaSourceContainer.",
				},
				oldText = {
					type = "string",
					description = "The exact text to find and replace. Must appear exactly once in the script.",
				},
				newText = {
					type = "string",
					description = "The replacement text.",
				},
			},
			required = {"path", "oldText", "newText"},
		},
		execute = function(args)
			local path = args.path
			local oldText = args.oldText
			local newText = args.newText

			if typeof(path) ~= "string" or typeof(oldText) ~= "string" or typeof(newText) ~= "string" then
				return false, "path, oldText, and newText must be strings"
			end

			local instance = resolvePath(path)
			if not instance then
				return false, `Instance not found at path: {path}`
			end

			if not instance:IsA("LuaSourceContainer") then
				return false, `Instance at {path} is not a script (it's a {instance.ClassName})`
			end

			local currentSource = (instance :: any).Source or ""
			local ok, result = Patch.applyPatch(currentSource, oldText, newText)

			if ok and result then
				(instance :: any).Source = result
				return true, `Patched {path} successfully.`
			else
				-- Fallback to full replacement
				(instance :: any).Source = newText
				return true, `Patch did not match exactly once in {path}. Replaced entire source instead.`
			end
		end,
	})

	Registry.register({
		name = "studio_run_luau",
		description = "Executes arbitrary Luau code in Studio and returns the output. Use this for complex operations not covered by other tools.",
		parameters = {
			type = "object",
			properties = {
				code = {
					type = "string",
					description = "The Luau code to execute.",
				},
			},
			required = {"code"},
		},
		execute = function(args)
			local code = args.code
			if typeof(code) ~= "string" then
				return false, "code must be a string"
			end

			local result = StudioContext.runCode(code)
			if result.success then
				local output = result.output
				if output == "" then
					output = "(no output)"
				end
				return true, output
			else
				return false, `Execution failed: {result.error or "Unknown error"}`
			end
		end,
	})

	Registry.register({
		name = "studio_insert_model",
		description = "Searches the Roblox Creator Store for a model matching the query and inserts it into Workspace at the camera position.",
		parameters = {
			type = "object",
			properties = {
				query = {
					type = "string",
					description = "Search query for the Creator Store, e.g. 'sword', 'car', 'tree'.",
				},
			},
			required = {"query"},
		},
		execute = function(args)
			local query = args.query
			if typeof(query) ~= "string" then
				return false, "query must be a string"
			end

			-- Try to use McpBridge if available
			local mcpModule = script.Parent.Parent.Parent:FindFirstChild("McpBridge")
			if mcpModule then
				local ok, McpBridge = pcall(require, mcpModule)
				if ok and McpBridge and McpBridge.InsertModel then
					local insertOk, result = pcall(McpBridge.InsertModel, query)
					if insertOk then
						return true, `Inserted model for "{query}": {tostring(result)}`
					else
						return false, `Insert failed: {tostring(result)}`
					end
				end
			end

			return false, "McpBridge not available. Cannot insert models."
		end,
	})
end

-- [ INIT ] ---------------------------------------------------

defineStudioTools()

return StudioTools
