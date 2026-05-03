-- Utils/Http.lua
-- HttpService wrapper with retry logic and JSON handling

local HttpService = game:GetService("HttpService")
local Config = require(script.Parent.Parent.Config)

local Http = {}

function Http.request(options: {
	Url: string,
	Method: string?,
	Headers: {[string]: string}?,
	Body: any?
}): (boolean, {Success: boolean, StatusCode: number, Body: string, StatusMessage: string}?)
	local method = options.Method or "GET"
	local headers = options.Headers or {}
	headers["Content-Type"] = headers["Content-Type"] or "application/json"
	
	local body = options.Body
	if body and typeof(body) ~= "string" then
		body = HttpService:JSONEncode(body)
	end
	
	local requestOptions = {
		Url = options.Url,
		Method = method,
		Headers = headers,
		Body = body,
	}
	
	local retries = 0
	local lastError
	
	while retries < Config.HTTP_MAX_RETRIES do
		local success, result = pcall(function()
			return HttpService:RequestAsync(requestOptions)
		end)
		
		if success then
			return true, result
		end
		
		lastError = result
		retries += 1
		
		if retries < Config.HTTP_MAX_RETRIES then
			task.wait(math.min(Config.HTTP_TIMEOUT * (Config.HTTP_RETRY_BACKOFF ^ (retries - 1)), 10))
		end
	end
	
	return false, nil
end

function Http.get(url: string, headers: {[string]: string}?): (boolean, any?, number?)
	local success, result = Http.request({
		Url = url,
		Method = "GET",
		Headers = headers,
	})

	if not success or not result then
		return false, nil, 0
	end

	if result.StatusCode >= 200 and result.StatusCode < 300 then
		local parseOk, data = pcall(function()
			return HttpService:JSONDecode(result.Body)
		end)
		return true, parseOk and data or result.Body, result.StatusCode
	end

	return false, result.Body, result.StatusCode
end

function Http.post(url: string, body: any, headers: {[string]: string}?): (boolean, any?, number?)
	local success, result = Http.request({
		Url = url,
		Method = "POST",
		Headers = headers,
		Body = body,
	})

	if not success or not result then
		return false, nil, 0
	end

	if result.StatusCode >= 200 and result.StatusCode < 300 then
		local parseOk, data = pcall(function()
			return HttpService:JSONDecode(result.Body)
		end)
		return true, parseOk and data or result.Body, result.StatusCode
	end

	return false, result.Body, result.StatusCode
end

function Http.delete(url: string, headers: {[string]: string}?): (boolean, any?, number?)
	local success, result = Http.request({
		Url = url,
		Method = "DELETE",
		Headers = headers,
	})

	if not success or not result then
		return false, nil, 0
	end

	if result.StatusCode >= 200 and result.StatusCode < 300 then
		local parseOk, data = pcall(function()
			return HttpService:JSONDecode(result.Body)
		end)
		return true, parseOk and data or result.Body, result.StatusCode
	end

	return false, result.Body, result.StatusCode
end

function Http.patch(url: string, body: any, headers: {[string]: string}?): (boolean, any?, number?)
	local success, result = Http.request({
		Url = url,
		Method = "PATCH",
		Headers = headers,
		Body = body,
	})

	if not success or not result then
		return false, nil, 0
	end

	if result.StatusCode >= 200 and result.StatusCode < 300 then
		local parseOk, data = pcall(function()
			return HttpService:JSONDecode(result.Body)
		end)
		return true, parseOk and data or result.Body, result.StatusCode
	end

	return false, result.Body, result.StatusCode
end

return Http
