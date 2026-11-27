# Claude Code / Codex chat handoff into BloxBot

Status: implementation plan only, 2026-11-27. No chat has been imported or modified.

## Product decision

Start with **local, one-way discovery and Continue in BloxBot**, not bidirectional transcript synchronization. Keep the source conversation read-only and create a separate BloxBot continuation. This works with BloxBot's existing OpenCode backend and lets the user choose any connected model.

Two distinct future modes must not be confused:

1. **Import and continue (recommended first):** translate supported conversation history into OpenCode. New turns belong to BloxBot. Provider-native runtime state is not preserved.
2. **Native continuation (later):** BloxBot acts as a client of Claude Agent SDK or Codex app-server, resuming the original thread through that runtime. Higher fidelity, but requires additional agent execution, streaming, approval, cancellation, and Studio-tool adapters. It is not just another model provider.

## Verified starting points

- Claude Code transcripts exist locally under `~/.claude/projects/`; sampled records have UUID/parent UUID, session ID, working directory, user/assistant content, tool records, and administrative events. Do not infer project paths by reversing encoded folder names.
- Codex transcripts exist under `~/.codex/sessions/` and may also be archived. Sampled records include `session_meta`, `response_item`, `event_msg`, `turn_context`, and token-usage records. The same visible message can be represented in multiple event streams.
- Official Claude Agent SDK supports `listSessions()` and `getSessionMessages()`. Codex app-server supports read-only history methods such as `thread/list`, `thread/read`, `thread/turns/list`, and `thread/items/list`.
- BloxBot already wraps session creation, listing, messages, model selection, and continuation in `src/lib/opencode/client.ts`. Its installed OpenCode client exposes an experimental session import API. Verify the running backend's schema and behavior before implementation; experimental contracts can change.
- Local discovery does not imply access to cloud-only Codex/ChatGPT or Claude web conversations. Those need an explicitly supported export or connector. Signing in to a model provider is not permission or an API for reading its entire chat history.

## Architecture

### 1. Read-only source adapters in Electron

Introduce `ExternalChats` with independent `ClaudeCodeSource` and `CodexSource` adapters. Renderer receives validated descriptors, never arbitrary filesystem access.

- Detect default roots, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`; support explicit folder selection, including separately selected WSL profiles.
- Prefer documented history APIs where installed versions support them. Use a versioned JSONL reader as a fallback; do not read or mutate provider SQLite databases, authentication stores, or lock files.
- List metadata first: source, stable ID, title, project path, branch, update time, active/archive state, and import status. Load transcript content lazily on preview/import.
- Parse in a worker with streaming, cancellation, file/line/attachment size bounds, concurrency limits, and progress. Tolerate an incomplete last line during an active write; report malformed interior records rather than silently dropping history.
- Treat file watchers as hints. Reconcile on startup, focus, and manual refresh to recover missed events. Only watch sources the user enabled.

### 2. Normalized transcript and provenance

Use a provider-neutral intermediate representation with source IDs, branch/parent IDs, roles, text, tool calls/results, attachments, timestamps, compaction boundaries, and explicit unsupported-record warnings.

- Follow Claude parent/leaf links; keep subagents/sidechains separate instead of concatenating branches.
- For Codex select one canonical message stream and deduplicate events; preserve visible conversation order, rollbacks, and compacted history boundaries.
- Keep historical tool activity as inert evidence. Never replay commands, tool calls, pending approvals, hooks, or imported MCP configuration.
- Exclude private reasoning/signatures, opaque provider state, access tokens, native system policies, and account data from cross-provider continuation. Historical costs are annotations, not new BloxBot billing.
- Preserve a viewable source transcript; normalize supported messages for context. Unsupported native tool exchanges become explicitly labeled historical text, not fabricated successful tool results.

### 3. Safe OpenCode import and context handoff

Add a narrow import operation beside BloxBot's existing session adapter using the authenticated OpenCode API, never direct database writes.

- First spike: import a tiny fixture with user/assistant/tool history into an isolated backend, restart, then send a follow-up to a scripted local model. Prove the model actually receives the history; displaying it in the UI alone is insufficient.
- Use fresh target IDs with a deterministic source-to-target message mapping. Do not synthesize execution events or forge provider response IDs.
- Keep the complete supported transcript in the conversation store. For oversized/unsupported histories offer an explicit handoff context (goal, decisions, changed files, last verified results, open tasks, recent turns). Do not silently truncate. Generated summaries require consent and disclose model usage; deterministic excerpts are the offline default.
- Select an available model and project/worktree before the first continuation. Explain that new inference uses the selected BloxBot provider/subscription or API credits, not necessarily the original runtime's billing.
- Imported instructions are historical data, not new system permissions. Apply current BloxBot/project instructions and permissions. Confirm Studio assignment through the normal picker; never infer the correct open Studio from old transcript paths.
- Conversation import does not restore files, git branches, terminal sessions, checkpoints, or live Studio objects. Check the current project state before continuing work.

### 4. Idempotency, incremental updates, and divergence

Keep a versioned import index owned by BloxBot: source installation/root identity, source session and branch ID, file identity/offset or API cursor, record hashes, target session ID, import boundary, and last successful sync.

- Repeating an import does not create duplicate chats/messages. Persist the mapping only after successful import and recover safely from partial failure.
- Before BloxBot has new user/assistant turns, new completed source turns may refresh the mirrored import using a verified safe import/update strategy. The backend spike must establish whether replacement is supported; do not assume an append-message endpoint exists.
- Once either side diverges, show **New activity in source → Create updated continuation**. Never interleave two independently executing conversations or overwrite a BloxBot continuation.
- Source rewrites/truncation trigger reconciliation, not blind byte-offset appends. Source deletion or archive changes do not delete the imported copy.
- UI deletion removes BloxBot-owned copies only. No writes back to Claude/Codex in the first release.

## UI flow

Add **Import chats** to chat navigation and **Settings → Chats → External sources** for opt-in roots and automatic discovery.

1. Choose Claude Code / Codex and enable the local source.
2. Search/filter by project, title, date, source, and archive state.
3. Preview a chat, warnings, attachments, and available history.
4. Click **Continue in BloxBot**; choose project/worktree, model, and optionally a Studio.
5. Open the imported history with a source badge and handoff boundary; no inference runs until the user sends a message.

Show `Not imported`, `Up to date`, `New source activity`, `Continued here`, `Source unavailable`, or a recoverable import error. Include refresh, retry, cancel, and remove-copy actions. Do not require importing the whole history library.

## Security and privacy

- Local-only indexing by default; no transcript upload for discovery or preview. Explain exactly what history will be sent to the selected model on continuation.
- Scope all IPC requests to approved roots; validate canonical paths and reject traversal/symlink escapes. Validate attachment paths separately, never auto-fetch remote URLs, and mark missing attachments.
- Do not import credentials, native permission grants, or executable configuration. Redact transcript snippets and paths from telemetry/error logs.
- Provide source opt-out and BloxBot-cache deletion independently of original chats. Protect the import index and copied attachments with normal per-user app storage permissions.

## Delivery sequence

1. **Compatibility spike:** inspect installed source versions; validate history APIs/fallback formats and OpenCode import + follow-up + restart with synthetic fixtures. Decide full-role import versus labeled handoff fallback based on evidence.
2. **Manual import MVP:** adapters, preview, selected-chat import, provenance, project/model choice, and Continue in BloxBot.
3. **Opt-in live discovery:** background indexing, watchers/reconciliation, restart-safe deduplication, new-source-activity branches.
4. **Native-runtime option only if needed:** Codex app-server resume and Claude SDK resume/fork, with separate runtime UI and approval/tool adapters. Prefer official protocols to writing native transcript files.

## Acceptance tests

- Realistic synthetic fixtures: plain messages, tool calls/results, interruptions, compaction, subagents, forks, archive, attachments, unknown records, truncated lines, large logs, Unicode/Windows paths, alternate roots, and unavailable worktrees.
- Import twice, restart mid-import, mutate/truncate source, and receive new source turns: no duplication or data loss; originals remain byte-identical.
- A local scripted model answers a follow-up using a fact present only in imported history, including after backend restart. No tools from history execute.
- New BloxBot turns followed by new source turns produce a visible branch instead of a merged conversation.
- Electron end-to-end: list → preview → import → reopen → continue; no automatic generation, credential reads, or unsolicited Studio selection.
- Test source format/version mismatches and offline operation. Paid model calls and source-account cloud history are not required for the MVP verification.

## References

- [Claude session storage and lifecycle](https://code.claude.com/docs/en/how-claude-code-works#work-with-sessions)
- [Claude Agent SDK session APIs](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Codex app-server history and continuation APIs](https://developers.openai.com/codex/app-server)
- [OpenCode experimental session import/export](https://opencode.ai/docs/api)

## T3 Code comparison (2026-11-27)

Reviewed official `pingdotgg/t3code` at commit `4f7c5290859dd0185643d7c1ae788e80f8152540`, separately from community sync mods.

- `AgentSessionScanner.ts` discovers local provider transcripts, including Codex `.jsonl.zst`; it follows conversation branches and records file identity (path, device/inode, birthtime, size, mtime).
- `AgentSessionImporter.ts` creates a T3 history projection **and binds it to the original native session**. Its persisted Claude resume cursor contains `resume: providerSessionId`; Codex uses the native thread ID. Claude's adapter calls the Agent SDK with that resume ID; Codex's adapter issues `thread/resume`. The next turn runs in the original agent runtime, not a fresh model request containing only copied text.
- Visible imported history is deliberately partial: first user message plus recent visible user/assistant text, at most 200 messages; tools and attachments are omitted by the documented onboarding importer. Full model continuity relies on the source runtime's session still being available, not on that 200-message projection.
- Import is exposed through `agentSessions.scan` and `agentSessions.import`, reached from Welcome (reopenable in Settings → About). The documented default window is 30 days, with 100 conversations and 4 GiB read budget per project/pass, plus per-session record/memory bounds.
- Current importer source is more capable than old reports of strictly one-time import: unchanged file identities skip work; changed transcripts can refresh an imported thread under its mutation lock **before it has native runs**, but it refuses to overwrite modified/diverged history. This is not arbitrary two-way transcript merging or proof of an always-on external-session watcher.
- Stable IDs use provider-instance ID plus native-session ID. History events and native bindings are written through T3's orchestration layer. Do not copy a community tool's direct-database writing approach into BloxBot.

### What this changes for BloxBot

Offer two clearly labeled actions rather than promising they are interchangeable:

1. **Continue with original agent:** T3-style native binding through Claude Agent SDK / Codex app-server. Highest fidelity and shared CLI continuation; requires runtime integration and one-writer protection. Move this ahead of cross-provider conversion if seamless CLI ↔ BloxBot handoff is the priority.
2. **Copy into BloxBot:** the OpenCode import described above, allowing another model/provider, with explicit conversion and context-loss boundaries. Keep the original session untouched.

Reuse T3's provenance, bounded scanning, stable identities, and guarded refresh ideas, but do not silently enforce its 30-day/200-message product limits. Expose exclusions and truncation clearly.

Source links: [scanner](https://github.com/pingdotgg/t3code/blob/4f7c5290859dd0185643d7c1ae788e80f8152540/apps/server/src/project/AgentSessionScanner.ts), [importer](https://github.com/pingdotgg/t3code/blob/4f7c5290859dd0185643d7c1ae788e80f8152540/apps/server/src/project/AgentSessionImporter.ts), [Claude adapter](https://github.com/pingdotgg/t3code/blob/4f7c5290859dd0185643d7c1ae788e80f8152540/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts), [Codex adapter](https://github.com/pingdotgg/t3code/blob/4f7c5290859dd0185643d7c1ae788e80f8152540/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts), [Welcome/import limits](https://github.com/pingdotgg/t3code/blob/4f7c5290859dd0185643d7c1ae788e80f8152540/docs/user/welcome-page.md).
