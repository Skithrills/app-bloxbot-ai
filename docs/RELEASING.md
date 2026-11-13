# Releasing the BloxBot fork

BloxBot checks [Skithrills/app-bloxbot-ai Releases](https://github.com/Skithrills/app-bloxbot-ai/releases) for stable versions. A commit or tag alone does not make a build available to installed copies. The updater needs a published release with its installer and update metadata.

## Publish a release

1. Increase the version in `package.json` and add a matching section to `CHANGELOG.md`. Merge the changes into `main` on the fork.
2. Open **Actions → Release → Run workflow** on `main`. The fork may require you to enable Actions on its Actions tab first.
3. Wait for all build jobs and the publish job to succeed. The workflow builds the installers, verifies the packaged Windows feed, uploads and verifies the assets on a draft, then publishes the version as `v<version>`.
4. Send friends the [latest release link](https://github.com/Skithrills/app-bloxbot-ai/releases/latest). On Windows, they run `BloxBot-Setup-<version>.exe` once. After that, BloxBot offers newer releases in the app.

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
