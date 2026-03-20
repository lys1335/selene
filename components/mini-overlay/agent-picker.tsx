"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { OverlayAgent } from "@/app/api/overlay/agents/route";

interface AgentPickerProps {
  agents: OverlayAgent[];
  selectedAgent: OverlayAgent | null;
  onSelectAgent: (agent: OverlayAgent) => void;
}

function AgentAvatar({ agent, size = 20 }: { agent: OverlayAgent; size?: number }) {
  const initial = agent.name.charAt(0).toUpperCase();
  if (agent.avatarUrl) {
    return (
      <img
        src={agent.avatarUrl}
        alt={agent.name}
        width={size}
        height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-primary/20 text-primary flex items-center justify-center font-medium shrink-0 text-[10px]"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

function formatTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export function AgentPicker({ agents, selectedAgent, onSelectAgent }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Reset focused index when dropdown opens
  useEffect(() => {
    if (open) {
      const idx = agents.findIndex((a) => a.id === selectedAgent?.id);
      setFocusedIndex(idx >= 0 ? idx : 0);
    }
  }, [open, agents, selectedAgent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const next = (i + 1) % agents.length;
          itemRefs.current[next]?.focus();
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => {
          const prev = (i - 1 + agents.length) % agents.length;
          itemRefs.current[prev]?.focus();
          return prev;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [open, agents.length]
  );

  const handleSelect = useCallback(
    (agent: OverlayAgent) => {
      onSelectAgent(agent);
      setOpen(false);
    },
    [onSelectAgent]
  );

  // Single agent — render as a non-interactive label
  if (agents.length <= 1) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-foreground"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {selectedAgent && <AgentAvatar agent={selectedAgent} size={18} />}
        <span className="font-medium truncate max-w-[180px]">
          {selectedAgent?.name ?? "Agent"}
        </span>
      </div>
    );
  }

  return (
    <div className="webkit-app-region-no-drag">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring webkit-app-region-no-drag"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            {selectedAgent && <AgentAvatar agent={selectedAgent} size={18} />}
            <span className="font-medium truncate max-w-[180px]">
              {selectedAgent?.name ?? "Select agent"}
            </span>
            <ChevronDown
              className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="p-1 w-64 webkit-app-region-no-drag"
          align="start"
          side="bottom"
          sideOffset={4}
          // Keep the floating list inside the overlay's non-draggable region so mouse clicks land.
          avoidCollisions
          collisionPadding={8}
        >
          <ScrollArea className="max-h-40">
            <div role="listbox" aria-label="Select agent">
              {agents.map((agent, idx) => {
                const isSelected = agent.id === selectedAgent?.id;
                return (
                  <button
                    key={agent.id}
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={focusedIndex === idx ? 0 : -1}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring webkit-app-region-no-drag",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60 text-foreground",
                    )}
                    onClick={() => handleSelect(agent)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onKeyDown={handleKeyDown}
                  >
                    <AgentAvatar agent={agent} size={22} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-medium truncate leading-tight">
                        {agent.name}
                      </span>
                      {agent.lastSessionUpdatedAt ? (
                        <span className="text-[10px] text-muted-foreground truncate leading-tight">
                          Last chat: {formatTimeAgo(agent.lastSessionUpdatedAt)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground leading-tight">
                          No recent chats
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
