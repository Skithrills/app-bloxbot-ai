import { useEffect, useRef, useState } from "react";
import AgentIcon from "@/components/AgentIcon";
import { useAllAgents } from "@/hooks/useCustomAgents";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { BloxBotAgent } from "@/types";

function AgentPicker() {
  const { selectedAgent, setSelectedAgent } = usePreferences();
  const allAgents = useAllAgents();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentAgent = allAgents.find((a) => a.id === selectedAgent) ?? allAgents[0];

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleSelect(agent: BloxBotAgent) {
    setSelectedAgent(agent.id);
    setOpen(false);
  }

  // Group agents: built-in first, then custom
  const builtinAgents = allAgents.filter((a) => a.isBuiltin);
  const customAgents = allAgents.filter((a) => !a.isBuiltin);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-accent"
        title={`Current agent: ${currentAgent?.name ?? selectedAgent}`}
      >
        <AgentIcon agentId={currentAgent?.id ?? "studio"} size={14} />
        <span className="max-w-[80px] truncate">
          {currentAgent?.name ?? selectedAgent ?? "Studio"}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border bg-card shadow-lg">
          {/* Built-in agents */}
          {builtinAgents.length > 0 && (
            <div>
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Built-in
              </div>
              {builtinAgents.map((agent) => (
                <AgentOption
                  key={agent.id}
                  agent={agent}
                  isSelected={agent.id === selectedAgent}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {/* Custom agents */}
          {customAgents.length > 0 && (
            <div>
              {builtinAgents.length > 0 && <div className="mx-3 my-1 h-px bg-border" />}
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Custom
              </div>
              {customAgents.map((agent) => (
                <AgentOption
                  key={agent.id}
                  agent={agent}
                  isSelected={agent.id === selectedAgent}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          )}

          {allAgents.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No agents available
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentOption({
  agent,
  isSelected,
  onSelect,
}: {
  agent: BloxBotAgent;
  isSelected: boolean;
  onSelect: (agent: BloxBotAgent) => void;
}) {
  return (
    <button
      onClick={() => onSelect(agent)}
      className={`flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent ${
        isSelected ? "bg-accent" : ""
      }`}
    >
      <AgentIcon agentId={agent.id} size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{agent.name}</span>
          {agent.isBuiltin && (
            <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
              built-in
            </span>
          )}
          {!agent.isBuiltin && agent.version && (
            <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
              v{agent.version}
            </span>
          )}
        </div>
        {agent.description && (
          <p className="truncate text-[10px] text-muted-foreground">{agent.description}</p>
        )}
      </div>
      {isSelected && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-1 shrink-0 text-emerald-500"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

export default AgentPicker;
