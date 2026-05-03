-- Utils/Poll.lua
-- Background polling lifecycle manager with start/stop/cleanup

local Poll = {}
local activePolls = {}

function Poll.start(id: string, intervalSeconds: number, callback: () -> boolean?)
	Poll.stop(id)
	
	local running = true
	activePolls[id] = {
		running = running,
		connection = nil,
	}
	
	task.spawn(function()
		while running do
			if not activePolls[id] or not activePolls[id].running then
				break
			end
			
			local ok, shouldStop = pcall(callback)
			if not ok then
				warn(`[Poll] Error in poll '{id}': {shouldStop}`)
			end
			
			if shouldStop == true then
				break
			end
			
			if activePolls[id] and activePolls[id].running then
				task.wait(intervalSeconds)
			end
		end
		
		activePolls[id] = nil
	end)
end

function Poll.stop(id: string)
	if activePolls[id] then
		activePolls[id].running = false
		activePolls[id] = nil
	end
end

function Poll.stopAll()
	for id, _ in pairs(activePolls) do
		Poll.stop(id)
	end
end

return Poll
