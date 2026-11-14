# Releasing the BloxBot fork

BloxBot checks [Skithrills/app-bloxbot-ai Releases](https://github.com/Skithrills/app-bloxbot-ai/releases) for stable versions. A commit or tag alone does not make a build available to installed copies. The updater needs a published release with its installer and update metadata.

## Publish a release

1. Increase the version in `package.json` and add a matching section to `CHANGELOG.md`. Use Markdown headings such as `### Added`, `### Improved`, and `### Fixed`, with short bullets and bold feature names. Merge the changes into `main` on the fork.
2. Open **Actions → Release → Run workflow** on `main`. The fork may require you to enable Actions on its Actions tab first.
3. Wait for all build jobs and the publish job to succeed. The workflow builds the installers, verifies the packaged Windows feed, uploads and verifies the assets on a draft, then publishes the version as `v<version>`.
4. Send friends the [latest release link](https://github.com/Skithrills/app-bloxbot-ai/releases/latest). On Windows, they run `BloxBot-Setup-<version>.exe` once. After that, BloxBot offers newer releases in the app.

The workflow publishes the version’s Markdown from `CHANGELOG.md` with installer links. **What’s new** renders the same published notes inside BloxBot. Run `node scripts/release-notes.ts 0.16.4` to preview the generated Markdown for v0.16.4 locally.

The Windows `.exe`, `.exe.blockmap` and `latest.yml` must stay together on the release. The installer is unsigned and Windows may display a SmartScreen warning. macOS in-app installation requires a consistently signed app. The workflow can package the Apple Silicon download without a Developer ID certificate, for manual installation. To sign and notarize it, configure the fork's `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets.

An older build that reports a missing `app-update.yml` needs a one-time manual installation of a fork release. The same applies to a copy installed from the upstream project.

## Build a local Windows installer

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec electron-builder --win --x64 --publish never
```

`--publish never` keeps the fork update configuration in the packaged app and writes the release manifest locally. The installer, blockmap and manifest are in `release/`. The configuration is in `release/win-unpacked/resources/app-update.yml`.

## Local 0.15.2 verification

- Renderer, Electron and release-script type checks and the production build passed. The full Vitest run passed 984 tests and skipped 56; one OpenCode binary rollback test failed under that run's load, then its entire 71-test file passed on isolated rerun. All 12 release/updater tests passed.
- The Windows package contains the fork's `app-update.yml` and original MIT license. The `latest.yml` installer size and SHA-512 match the generated installer, and its blockmap is present.
- A read-only Electron updater check using the packaged configuration reaches the fork and reports that no stable release has been published yet.
- Native Studio Model and Placeholder icons loaded in an isolated Electron rendering fixture. Message bubbles and long reference names stayed within their bounds at approximately 320px and 520px viewport widths. This does not replace testing live Explorer selection in a connected Studio session.
- The source changes have not been committed, pushed or published. Next: review and push the fork changes, run the Release workflow, then verify an actual older-to-newer update on a test installation. The GitHub Actions build and end-to-end download/install remain unverified.


## Local 0.15.3 verification

- Instance reference classes are serialized into new messages. Legacy class metadata is bounded per transcript session and keyed by text part/path, learned only against the recorded place. Never-recorded legacy types remain unknown offline.
- 171 focused reference/composer/Explorer tests and 16 system-instruction tests passed. Production build and type checks passed.
- An isolated Electron fixture verified a Model icon without a connected Studio, exact raw markup toggling and restoration, and no overflow at 360px. Live model instruction compliance and a connected Studio navigation click remain unverified.
- Windows installer and update metadata were built under `release/fork-0.15.3`. No Git commit, push or release publication was performed.


## Local 0.15.4 verification

- About distinguishes available, up-to-date, no stable releases, and unsupported development builds. The titlebar displays a download action only when an update is available. Shared checks run at startup, every 30 minutes and on stale window focus; installation requires a click and prevents duplicate downloads.
- Type checks, 27 focused renderer tests, six updater tests and scoped lint passed. Backend tests verify that download succeeds before quitAndInstall(false, true), and that failures remain retryable.
- Read-only Electron smoke against the fork returned {status: "no-releases"} normally. The Windows installer contains the fork updater feed. Real update download/install/relaunch and GitHub publication remain unverified; no release was published by this task.

## Release 0.15.5 validation (2026-11-13)

- Resumed Claude's final Explorer review: skipped reads retain failures, forced sync and five-minute expiry retry them, and a walk with no successful reads reports the latest real error. Deep map reads stay capped at 30,000 rows; a discarded depth-4 response falls back to depth 2 without repeating that deep read until the branch changes.
- Final full suite: 1,026 Vitest tests passed, 57 skipped, and all 14 release/updater tests passed. Renderer, Electron and script type checks, production build, and lint passed (28 existing warnings). The 162 focused Explorer/skills/logging tests also passed.
- A production-build startup in a throwaway profile reached the application with OpenCode 2.2.7. This is a startup check, not live Studio, device, paid-provider, or system-audio verification.
- Built the Windows x64 installer, blockmap and latest.yml under release/fork-0.15.5. Verified the manifest version, installer size and SHA-512, packaged fork update configuration, and original MIT license. The installer is unsigned.
- This release ships Windows assets only. macOS/Linux packaging and a real installer-driven update/relaunch remain unverified. The workflow above supports future multi-platform releases; the Windows files can also be uploaded together to a draft targeting the tested commit and published after upload verification.

## Local 0.16.4 review (2026-11-14)

- The model picker treats the standard and Fast catalog entries as one model and shows the standard name on the Last used card. The installed OpenCode 2.2.7 catalog lists the same provider model and context limit for the two GPT-6 Fast pairs. A tier change can resend context, and actual ChatGPT subscription cache reuse remains unverified. The Fast toggle keeps its usage hint. [OpenCode continuation logic](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/ai/src/protocols/open-responses-continuation.ts#L103-L160) · [OpenAI usage guidance](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex)
- Windows Electron verification started two Rojo servers from the launcher using fixture project files and simulated native picker results. Both endpoints answered on separate loopback ports. Closing the launcher kept both servers running. App exit closed both ports, and the next launch remembered both files with servers stopped. The service also passed with direct Rojo 7.5.1 and the installed Rokit cache's Rojo 7.7.1. The Rokit fallback uses the latest installed stable version from the official Rojo cache. Studio plugin sync and macOS/Linux runtime behavior remain unverified.
- Type checks and the production build passed. Vitest passed 1,061 tests with 57 skipped, including the opt-in Windows Rojo test. All 14 release and updater tests passed. Scoped lint passed. Repository-wide lint still reports the existing compaction status markup error in `ChatMessages.tsx`.
- The unsigned Windows review installer and unpacked build are in `release/fork-0.16.4-review`. The installer size and SHA-512 match `latest.yml`, and the app archive matches the production build. The unpacked app was launched for review. Release is pending owner review.

## Local theme preview (2026-11-14)

- Settings → Personalisation manages named themes, separate Light and Dark palettes, app-wide preview, interface and code fonts, text size, corner radius, and versioned JSON import/export. The existing appearance mode chooses which palette to apply. Default uses the built-in colors and selected accent. Ctrl+Shift+0 or Cmd+Shift+0 selects Default and retains saved themes.
- The theme editor uses a fixed neutral palette, and custom colors can reach app surfaces, chat bubbles, code, context charts, diffs, and statuses. Existing provider and Studio icons and media colors are outside the theme palette.
- Windows Electron verified preview and cancel, light and dark switching, JSON import/export, save and reopen, typography and corner application, and the recovery shortcut. Type checks, the production build, 1,086 Vitest tests and 14 release tests passed. Biome passed with 27 existing warnings. Native color picker, clipboard copy, and macOS/Linux behavior remain unverified.
- The unpacked Windows preview is `release/theme-preview/win-unpacked/BloxBot.exe`, packaged as `0.16.5-theme.1`. The 0.16.4 review artifacts remain in their separate directory. Both builds use the same app identity. If you switch back to 0.16.4 after saving a theme, export the theme JSON first because older settings writes can omit the theme library.

## Combined Windows review build (2026-11-14)

- The launcher saves multiple manifests per project folder and reads older single-manifest settings. It honors explicit ports and exact official Rojo versions pinned in the project's Rokit configuration. In DeltaSurvivors, Combat Framework Staging's full and narrow manifests alternate on 34873, Blacksite Zeta uses 34872, and the SentryPilot overlay uses 34874.
- Rojo 7.7.1 generated sourcemaps for all eight current DeltaSurvivors manifests outside backup folders. A Windows Electron fixture verified migration, multi-file selection via simulated native picker results, concurrent servers inside one project, a same-port conflict, switching to the alternate manifest, shutdown cleanup, and config persistence across restart. An isolated OpenCode 2.2.7 test with a scripted provider confirmed that initial, steered, and queued work received the folder's Rojo manifest paths. A read-only Studio inspection reported no live plugin endpoint in the open place. Positive endpoint reporting was covered with mocks, and actual DeltaSurvivors Studio source synchronization was outside the fixture.
- Composer settings independently control next-message predictions and draft autocomplete. A two-launch Electron fixture saved and restored **Use chat model**, with autocomplete disabled. A live free OpenCode Zen check generated both kinds of suggestions and cleaned up its scratch sessions. Paid model selection and per-turn persistence were covered by automated tests with no paid provider calls.
- **What’s new** loaded all five published releases from the fork in an Electron fixture, from v0.16.3 through v0.15.5. The fixture scrolled to the oldest release and verified that the generated v0.16.4 draft rendered its headings, bold labels, and inline code.
- Type checks, the production build, and the 14 release tests passed. Vitest passed all 1,150 enabled tests with four workers after two tests timed out under the default concurrency. The updated release-history tests passed after the spacing and Markdown changes. Biome reported 27 existing warnings. The macOS and Linux packages were outside the review run.
- Review build `0.16.4-review.2` is in `release/fork-0.16.4-review-2/win-unpacked/BloxBot.exe`. Its app archive matches the production build and its update configuration points to the fork. The first 0.16.4 review installer is still available in its original directory. Release is pending owner review.

### Settings and model picker follow-up

- `release/fork-0.16.4-review-3/win-unpacked/BloxBot.exe` packages **Workflow**, colour mode in **Personalisation**, per-preset accents, and the scrollable model picker. The model-change warning can be dismissed from the picker and restored in Workflow.
- All 113 focused tests, renderer and Electron type checks, and the production build passed. Windows Electron verified Workflow navigation and applying and restoring Dracula’s accent while preserving the preset background. The warning preference is covered by the composer test. Native mouse-wheel input with the warning visible was outside the fixture.

### Release history and prediction follow-up

- `release/fork-0.16.4-review-5/win-unpacked/BloxBot.exe` contains per-version dismissal for **What’s new**, permanent access from **Settings → About → Release history**, separate prediction setup and generation timeouts, and symmetric toggle thumb spacing.
- The 83 focused tests and the live anonymous Zen prediction test passed. Electron verified dismissal after restart, About access, and matching 2 px toggle insets. A test simulated a newer installed version. The intermittent timeout reported on existing chats did not reproduce in the live fixture.
