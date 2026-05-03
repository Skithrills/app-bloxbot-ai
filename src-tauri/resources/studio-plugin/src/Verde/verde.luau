-- Verde/verde.luau
-- WebSocket bridge between Roblox Studio and the BloxBot desktop app.
-- Connects to ws://127.0.0.1:9000 and sends live DataModel snapshots + deltas.

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local Verde = {}

-- ── Config ─────────────────────────────────────────────────────────────
local WS_URL = "ws://127.0.0.1:9000"
local RECONNECT_DELAY = 3
local HEARTBEAT_INTERVAL = 4
local MAX_DEPTH = 50
local MAX_NODES = 5000

-- ── Valid Services (developer-visible only) ──────────────────────────
local VALID_SERVICES = {
	["Workspace"] = true,
	["Players"] = true,
	["Lighting"] = true,
	["ReplicatedFirst"] = true,
	["ReplicatedStorage"] = true,
	["ServerStorage"] = true,
	["ServerScriptService"] = true,
	["StarterPlayer"] = true,
	["StarterPack"] = true,
	["StarterGui"] = true,
	["StarterUI"] = true,
	["SoundService"] = true,
	["Chat"] = true,
	["LocalizationService"] = true,
	["TestService"] = true,
	["AssetService"] = true,
	["CollectionService"] = true,
	["Debris"] = true,
	["HttpService"] = true,
	["MarketplaceService"] = true,
	["RunService"] = true,
}

local function isValidInstance(instance)
	local service = instance
	while service do
		if service.Parent == game then
			return VALID_SERVICES[service.ClassName] == true
		end
		service = service.Parent
	end
	return false
end

-- ── State ──────────────────────────────────────────────────────────────
local wsClient = nil
local connections = {}
local nodeIdMap = {}      -- Instance -> string id (full path)
local idToInstance = {}   -- string id -> Instance
local isConnected = false
local heartbeatConn = nil
local lastHeartbeat = 0
local pendingDeltas = {}
local deltaLock = false
local snapshotInProgress = false

-- ── Helpers ────────────────────────────────────────────────────────────

local function generateId(instance)
	if instance == game then
		return "game"
	end
	local parent = instance.Parent
	if parent then
		return generateId(parent) .. "." .. instance.Name
	end
	return instance.Name
end

local function getClassName(instance)
	local ok, className = pcall(function()
		return instance.ClassName
	end)
	if ok then
		return className
	end
	return "Instance"
end

local SCRIPT_CLASS_NAMES = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

local function isScript(instance)
	local ok, className = pcall(function()
		return instance.ClassName
	end)
	return ok and SCRIPT_CLASS_NAMES[className] == true
end

local function buildNode(instance)
	local id = generateId(instance)
	nodeIdMap[instance] = id
	idToInstance[id] = instance

	local children = {}
	for _, child in ipairs(instance:GetChildren()) do
		table.insert(children, generateId(child))
	end

	return {
		id = id,
		name = instance.Name,
		className = getClassName(instance),
		parentId = instance.Parent and generateId(instance.Parent) or nil,
		children = children,
	}
end

local function buildSnapshot(rootInstance)
	local nodes = {}
	local rootIds = {}
	local nodeCount = 0

	local function traverse(inst, depth)
		if depth > MAX_DEPTH then
			return
		end
		if nodeCount >= MAX_NODES then
			return
		end
		if not isValidInstance(inst) then
			return
		end

		local node = buildNode(inst)
		table.insert(nodes, node)
		nodeCount += 1

		for _, child in ipairs(inst:GetChildren()) do
			traverse(child, depth + 1)
		end
	end

	if rootInstance then
		traverse(rootInstance, 0)
		 table.insert(rootIds, generateId(rootInstance))
	else
		-- Full DataModel - only traverse valid services
		for _, child in ipairs(game:GetChildren()) do
			if isValidInstance(child) then
				traverse(child, 0)
				 table.insert(rootIds, generateId(child))
			end
		end
	end

	return {
		nodes = nodes,
		rootIds = rootIds,
	}
end

local function sendJson(payload)
	if not wsClient or not isConnected then
		return false
	end
	local ok, json = pcall(HttpService.JSONEncode, HttpService, payload)
	if not ok then
		warn("[Verde] JSON encode failed:", json)
		return false
	end
	local sendOk = pcall(function()
		wsClient:Send(json)
	end)
	return sendOk
end

-- ── Delta tracking ─────────────────────────────────────────────────────

local function flushDeltas()
	if deltaLock or #pendingDeltas == 0 or not isConnected then
		return
	end
	deltaLock = true
	local batch = table.clone(pendingDeltas)
	pendingDeltas = {}

	sendJson({
		type = "explorer_delta",
		ops = batch,
	})

	deltaLock = false
end

local function recordDelta(op)
	 table.insert(pendingDeltas, op)
	-- Flush on next heartbeat or immediately if batch is large
	if #pendingDeltas > 50 then
		flushDeltas()
	end
end

local function onChildAdded(parent, child)
	if snapshotInProgress then
		return
	end
	if not isValidInstance(child) then
		return
	end
	local parentId = generateId(parent)
	local subtree = buildSnapshot(child)
	recordDelta({
		type = "add_subtree",
		timestamp = os.clock(),
		rootId = generateId(child),
		parentId = parentId,
		nodes = subtree.nodes,
	})
end

local function onChildRemoved(parent, child)
	if snapshotInProgress then
		return
	end
	local id = generateId(child)
	nodeIdMap[child] = nil
	idToInstance[id] = nil
	recordDelta({
		type = "remove_node",
		timestamp = os.clock(),
		id = id,
	})
end

local function onPropertyChanged(instance, property)
	if snapshotInProgress then
		return
	end
	if property == "Name" then
		-- Rebuild id mapping since path changed
		local oldId = nodeIdMap[instance]
		if oldId then
			nodeIdMap[instance] = nil
			idToInstance[oldId] = nil
		end
		local newId = generateId(instance)
		nodeIdMap[instance] = newId
		idToInstance[newId] = instance
		recordDelta({
			type = "update_node",
			timestamp = os.clock(),
			id = newId,
			name = instance.Name,
		})
	end
end

-- ── Connection ─────────────────────────────────────────────────────────

local function disconnect()
	isConnected = false
	for _, conn in ipairs(connections) do
		pcall(function()
			conn:Disconnect()
		end)
	end
	connections = {}
	if heartbeatConn then
		pcall(function()
			heartbeatConn:Disconnect()
		end)
		heartbeatConn = nil
	end
	if wsClient then
		pcall(function()
			wsClient:Close()
		end)
		wsClient = nil
	end
end

local function setupTreeListeners()
	local function hookInstance(inst)
		if not isValidInstance(inst) then
			return
		end
		local added = inst.ChildAdded:Connect(function(child)
			onChildAdded(inst, child)
			hookInstance(child)
		end)
		 table.insert(connections, added)

		local removed = inst.ChildRemoved:Connect(function(child)
			onChildRemoved(inst, child)
		end)
		 table.insert(connections, removed)

		local renamed = inst:GetPropertyChangedSignal("Name"):Connect(function()
			onPropertyChanged(inst, "Name")
		end)
		 table.insert(connections, renamed)

		for _, child in ipairs(inst:GetChildren()) do
			hookInstance(child)
		end
	end

	for _, child in ipairs(game:GetChildren()) do
		if isValidInstance(child) then
			hookInstance(child)
		end
	end
end

local function sendSnapshot()
	snapshotInProgress = true
	nodeIdMap = {}
	idToInstance = {}
	local snapshot = buildSnapshot()
	sendJson({
		type = "explorer_snapshot",
		payload = snapshot,
	})
	snapshotInProgress = false
end

local function handleMessage(rawMessage)
	local ok, msg = pcall(HttpService.JSONDecode, HttpService, rawMessage)
	if not ok then
		warn("[Verde] Failed to decode message:", rawMessage)
		return
	end

	if msg.type == "request_snapshot" then
		sendSnapshot()
	elseif msg.type == "operation" then
		local op = msg.operation
		if not op then
			return
		end
		local id = op.nodeId or op.targetNodeId
		local instance = id and idToInstance[id]

		if op.type == "delete_instance" and instance then
			pcall(function()
				instance:Destroy()
			end)
		elseif op.type == "rename_instance" and instance then
			pcall(function()
				instance.Name = op.newName
			end)
		elseif op.type == "set_property" and instance then
			pcall(function()
				instance[op.propertyName] = op.propertyValue
			end)
		elseif op.type == "create_instance" then
			local parent = idToInstance[op.parentId]
			if parent then
				pcall(function()
					local new = Instance.new(op.className)
					new.Parent = parent
				end)
			end
		elseif op.type == "move_node" and instance then
			local newParent = idToInstance[op.newParentId]
			if newParent then
				pcall(function()
					instance.Parent = newParent
				end)
			end
		end

	elseif msg.type == "read_script" then
		local requestId = msg.requestId
		local path = msg.path
		local instance = path and idToInstance[path]

		if not instance then
			sendJson({
				type = "script_content",
				requestId = requestId,
				success = false,
				error = "Instance not found: " .. tostring(path),
			})
			return
		end

		if not isScript(instance) then
			sendJson({
				type = "script_content",
				requestId = requestId,
				success = false,
				error = "Not a script: " .. instance.ClassName,
			})
			return
		end

		local ok, source = pcall(function()
			return instance.Source
		end)

		if not ok then
			sendJson({
				type = "script_content",
				requestId = requestId,
				success = false,
				error = "Failed to read source: " .. tostring(source),
			})
		else
			sendJson({
				type = "script_content",
				requestId = requestId,
				success = true,
				source = source,
				path = path,
			})
		end

	elseif msg.type == "write_script" then
		local requestId = msg.requestId
		local path = msg.path
		local source = msg.source
		local instance = path and idToInstance[path]

		if not instance then
			sendJson({
				type = "script_written",
				requestId = requestId,
				success = false,
				error = "Instance not found: " .. tostring(path),
			})
			return
		end

		if not isScript(instance) then
			sendJson({
				type = "script_written",
				requestId = requestId,
				success = false,
				error = "Not a script: " .. instance.ClassName,
			})
			return
		end

		local ok, err = pcall(function()
			instance.Source = source
		end)

		if not ok then
			sendJson({
				type = "script_written",
				requestId = requestId,
				success = false,
				error = "Failed to write source: " .. tostring(err),
			})
		else
			sendJson({
				type = "script_written",
				requestId = requestId,
				success = true,
				path = path,
			})
		end
	end
end

local function connect()
	disconnect()

	local ok, client = pcall(HttpService.CreateWebStreamClient, HttpService, Enum.WebStreamClientType.WebSocket, {
		Url = WS_URL,
	})
	if not ok then
		warn("[Verde] WebSocket creation failed:", client)
		return false
	end

	wsClient = client

	local openConn = client.Opened:Connect(function()
		print("[Verde] WebSocket connected to", WS_URL)
		isConnected = true
		setupTreeListeners()
		sendSnapshot()
	end)
	 table.insert(connections, openConn)

	local msgConn = client.MessageReceived:Connect(function(message)
		handleMessage(message)
	end)
	 table.insert(connections, msgConn)

	local closeConn = client.Closed:Connect(function()
		warn("[Verde] WebSocket closed")
		isConnected = false
	end)
	 table.insert(connections, closeConn)

	local errConn = client.Error:Connect(function(err)
		warn("[Verde] WebSocket error:", err)
		isConnected = false
	end)
	 table.insert(connections, errConn)

	-- Heartbeat to keep connection alive and flush deltas
	heartbeatConn = RunService.Heartbeat:Connect(function()
		if not isConnected then
			return
		end
		local now = os.clock()
		if now - lastHeartbeat >= HEARTBEAT_INTERVAL then
			lastHeartbeat = now
			flushDeltas()
			pcall(function()
				wsClient:Send("{\"type\":\"heartbeat\"}")
			end)
		end
	end)

	return true
end

local function startReconnectLoop()
	task.spawn(function()
		while true do
			if not isConnected then
				local ok = connect()
				if not ok then
					task.wait(RECONNECT_DELAY)
				end
			end
			task.wait(RECONNECT_DELAY)
		end
	end)
end

-- ── Public API ─────────────────────────────────────────────────────────

function Verde.Init(_plugin)
	print("[Verde] Initializing...")
	startReconnectLoop()
end

function Verde.Stop()
	disconnect()
end

return Verde
