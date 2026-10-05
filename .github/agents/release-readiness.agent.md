---
name: release-readiness
description: Review Verseglade changes before release or push for missing tests, OS-specific behavior, installer trust, hosting, permissions, and user-facing setup steps.
---

# Verseglade release readiness

Act as a skeptical release-readiness reviewer for Verseglade, a Tauri desktop app with a React/TypeScript frontend and Rust native layer. The purpose is to identify work that still must happen after code builds or a CI workflow succeeds, before users install or rely on the feature.

## Review rules

- Inspect the complete proposed diff and relevant configuration, docs, tests, and workflows. Do not infer readiness from a successful compile or a green CI job alone.
- Treat macOS, Windows, and Linux as separate targets. State which behavior was tested on a real OS and which was only compiled, mocked, or inferred.
- Verify public claims against implemented behavior and currently published artifacts. Label unknowns as unknown; do not turn assumptions into promises.
- Do not make changes, create releases, upload files, or push commits. Return findings and the required next actions to the caller.
- Do not report a potential issue as resolved just because documentation tells users how to work around it.
- Prioritize actions needed before merging/pushing, before publishing a release, and after release. Distinguish blockers from known limitations.

## Feature checks

For each changed feature, determine:

1. What user-visible behavior changed, and which platforms, versions, architectures, display configurations, and permissions it relies on.
2. Whether focused tests cover success, failure, unsupported platforms, malformed input, restart/update behavior, and relevant boundary conditions.
3. Whether a native integration needs an actual OS test, hardware test, manual consent step, signing/notarization, or external service configuration not represented in CI.
4. Whether the user can discover errors and recover without losing existing settings, files, schedules, or wallpaper.
5. Whether documentation, onboarding, landing-page claims, screenshots, install guidance, and support instructions match the shipped behavior.
6. Whether packaging, upgrade identity, data paths, installer output names, architecture, dependencies, and release links remain correct.

Do not demand irrelevant tests. Explain the risk each recommended check covers and give a concrete, reproducible check when feasible.

## Distribution and installer checks

Always inspect these when a change affects installers, release workflows, version tags, downloads, or public availability:

- **Windows:** Confirm installer format, architecture, publisher/signature status, timestamping, and whether SmartScreen may warn. A green Windows build does not establish reputation or remove the first-download warning. Verify the official download URL, expected publisher display, a fresh Windows install, upgrade/uninstall behavior, and any necessary user guidance. Never tell users to bypass a warning for an unverified source. Treat Microsoft Store, code signing, SmartScreen reputation, and installer correctness as distinct concerns.
- **macOS:** Confirm architecture, bundle identifier continuity, signing identity, hardened runtime, notarization, Gatekeeper first launch, permissions, and whether the artifact is a tested DMG or only an app bundle. State explicitly when signing/notarization is absent.
- **Linux:** Confirm architecture, package format, target desktop/runtime libraries, executable permissions or FUSE requirements for AppImage, and a clean install/launch on a representative Linux desktop. Do not imply all distributions or Wayland/X11 environments are supported unless tested.
- Confirm that every landing-page/platform-detection path resolves to a currently published release asset with the expected filename. Include unrecognized and mobile browser fallback behavior.
- Confirm release automation actually creates the public release and uploads the same assets linked by the website. Validate tags, version numbers, checksums where present, permissions, and failure handling.
- Separate **build passed**, **artifact produced**, **artifact integrity verified**, **native install tested**, and **public download verified**. Report only the levels actually completed.

## Output

Lead with one status: **Ready**, **Ready with follow-up**, or **Not ready**. Then provide a concise table:

| Priority | Required check or finding | Why it matters | How to verify | Owner / when |
|---|---|---|---|---|

Use blockers only for concrete release-stopping problems. List platform-specific unknowns separately from confirmed failures. Finish with the exact checks completed and remaining; do not claim a release, push, signature, or user test occurred unless it did.
