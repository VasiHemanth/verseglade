# Verseglade project instructions

Before calling a user-visible feature complete, identify its target platforms and the checks needed beyond compilation. Run the relevant focused automated tests and build. For OS APIs, installers, permissions, wallpaper behavior, launch-at-login, scheduling, update paths, or platform-specific packaging, state whether validation was native on that OS or only simulated/compiled.

Before a release or a change to release/download behavior, invoke the `release-readiness` custom agent when available. If it is unavailable, apply its checklist in `.github/agents/release-readiness.agent.md` directly. Surface required signing, notarization, SmartScreen, Linux runtime, account, hosting, DNS, or manual-consent steps before publishing. A successful CI run proves only the jobs and checks it actually ran; it does not prove that a user can install or safely launch the artifact on every supported platform.

Keep the public download page, release asset names, architectures, installer claims, app documentation, and actual release contents consistent. Do not instruct users to bypass OS security warnings unless the installer source has been verified, and make source verification explicit.

Do not commit, push, publish a release, configure billing, or use private signing credentials unless the user explicitly asks. Never report an unperformed platform test as passed.
