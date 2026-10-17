# CI quality gates

- `.github/workflows/ci.yml` runs `vp check` (lint + typecheck), `vpr typecheck`, and `vp run test` on pull requests and pushes to `main`.
- `.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), and Windows (`x64`) desktop artifacts from a single `v*.*.*` tag and publishes one GitHub release.
- `.github/workflows/build-macos.yml` builds and publishes the desktop artifacts for `v*` tags. macOS signing switches itself on once the `CSC_LINK` secret holds a Developer ID certificate, and passkeys are an additional opt-in through `MACOS_PROVISIONING_PROFILE`; without the core signing credentials it still publishes unsigned artifacts.
- See [Release Checklist](./release.md) for the full release/signing setup checklist.
