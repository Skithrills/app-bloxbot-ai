export interface ExternalChatSummary {
  ref: string;
  title: string;
  source: "codex" | "claude";
  cwd: string;
  updatedAt: number;
}

export interface ExternalChatTranscript extends ExternalChatSummary {
  messages: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
  warnings: string[];
}
