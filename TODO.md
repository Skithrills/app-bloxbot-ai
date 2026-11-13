# BloxBot TODO

- [x] Make Explorer, Context, and the chat sidebar resizable. Reuse the Subagents drawer’s pointer and keyboard resize behavior where possible. Keep the sidebar collapse control.
- [x] Add a transcript navigation rail. Hover a marker to preview its message and click it to jump to that message, including rows outside the currently rendered range.
- [x] **Model selection.** Restore each chat's selected model and supported effort after restart. If the saved model is removed or deprecated, choose the newest eligible stable chat model from the same provider connection and show which model replaced it. Use the provider default when release dates are missing, and preserve the user's model visibility and billing preferences.
- [x] **Model catalog order.** Within each provider, sort names alphabetically with numeric segments compared as numbers (for example, Model 2 before Model 10). Offer **Newest first** using catalog release dates, with undated models last and name order as the tie-breaker.

## Feature roadmap

- [ ] **Rojo launcher.** Choose an existing `.project.json` and start or stop the installed Rojo CLI from BloxBot. Run `rojo serve` in the background and show the connection address, status, and logs on demand.
- [ ] **Learned preferences (`taste.md`).** Add a **Remember this correction** action and let the user review and edit the rule before saving it. Use saved rules in future chats. Offer the working model or an eligible free model to draft rules, and add project-specific rules when project folders are available.
- [x] **Project folders.** Group chats by game folder, move chats between folders, and start new chats in a folder with its saved Studio place.
- [ ] **Multi-game Rojo.** Remember the Rojo project file per project and give concurrent Rojo servers distinct ports so they can keep running when switching chats.
- [ ] **Mobile remote control.** Pair a mobile browser with BloxBot Desktop through an authenticated relay. Start with live chat progress, captures, and follow-up questions, then add approvals, steering, queueing, and stop. Keep Studio and project files on the connected desktop.
