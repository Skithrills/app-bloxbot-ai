-- API/OpenCodeClient.lua
-- HTTP wrapper for OpenCode server REST API
-- Returns (success: boolean, data: any?, error: string?)

local Http = require(script.Parent.Parent.Utils.Http)
local Config = require(script.Parent.Parent.Config)

local OpenCodeClient = {}
OpenCodeClient.baseUrl = nil

function OpenCodeClient.setBaseUrl(url: string)
	OpenCodeClient.baseUrl = url
end

function OpenCodeClient.isReady(): boolean
	return OpenCodeClient.baseUrl ~= nil and OpenCodeClient.baseUrl ~= ""
end

function OpenCodeClient._url(path: string): string
	return `{OpenCodeClient.baseUrl}{path}`
end

-- Helper: extract array/data from various response shapes
local function extractData(response: any): any?
	if not response then return nil end
	if typeof(response) == "table" then
		-- OpenCode wraps lists in { data: [...] }
		if response.data ~= nil then
			return response.data
		end
		-- Some endpoints return the array directly
		if #response > 0 then
			return response
		end
	end
	return response
end

-- ── Discovery ────────────────────────────────────────────────────────────

function OpenCodeClient.discover(): (string?, string?)
	for port = Config.PORT_RANGE_START, Config.PORT_RANGE_END do
		local url = `http://127.0.0.1:{port}`
		local ok, data, status = Http.get(`{url}/global/health`)
		if ok and status == 200 then
			return url, nil
		end
	end
	return nil, "No OpenCode server found on ports " .. Config.PORT_RANGE_START .. "-" .. Config.PORT_RANGE_END
end

-- ── Sessions ─────────────────────────────────────────────────────────────

function OpenCodeClient.listSessions(): (boolean, {any}?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.get(OpenCodeClient._url("/session"))
	if not ok then
		return false, nil, `listSessions failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

function OpenCodeClient.createSession(): (boolean, any?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.post(OpenCodeClient._url("/session"), {})
	if not ok then
		return false, nil, `createSession failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

function OpenCodeClient.deleteSession(sessionID: string): (boolean, string?)
	if not OpenCodeClient.isReady() then return false, "Not connected" end
	local ok, _, status = Http.delete(OpenCodeClient._url(`/session/{sessionID}`))
	if not ok then
		return false, `deleteSession failed (HTTP {status or 0})`
	end
	return true, nil
end

function OpenCodeClient.renameSession(sessionID: string, title: string): (boolean, any?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.patch(OpenCodeClient._url(`/session/{sessionID}`), { title = title })
	if not ok then
		return false, nil, `renameSession failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

-- ── Messages ─────────────────────────────────────────────────────────────

function OpenCodeClient.getMessages(sessionID: string): (boolean, {any}?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.get(OpenCodeClient._url(`/session/{sessionID}/message`))
	if not ok then
		return false, nil, `getMessages failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

export type MessagePart = {
	type: string,
	text: string?,
	mime: string?,
	url: string?,
	filename: string?,
}

function OpenCodeClient.sendMessage(sessionID: string, parts: {MessagePart}, options: {
	model: {providerID: string, modelID: string}?,
	agent: string?,
	variant: string?,
}?): (boolean, any?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end

	local body: any = {
		parts = parts,
	}

	if options then
		if options.model then body.model = options.model end
		if options.agent then body.agent = options.agent end
		if options.variant then body.variant = options.variant end
	end

	local ok, data, status = Http.post(
		OpenCodeClient._url(`/session/{sessionID}/prompt`),
		body
	)
	if not ok then
		return false, nil, `sendMessage failed (HTTP {status or 0})`
	end
	return true, data, nil
end

-- ── Status ───────────────────────────────────────────────────────────────

function OpenCodeClient.getStatus(): (boolean, any?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.get(OpenCodeClient._url("/session/status"))
	if not ok then
		return false, nil, `getStatus failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

-- ── Providers ────────────────────────────────────────────────────────────

function OpenCodeClient.listProviders(): (boolean, any?, string?)
	if not OpenCodeClient.isReady() then return false, nil, "Not connected" end
	local ok, data, status = Http.get(OpenCodeClient._url("/provider"))
	if not ok then
		return false, nil, `listProviders failed (HTTP {status or 0})`
	end
	return true, extractData(data), nil
end

return OpenCodeClient
