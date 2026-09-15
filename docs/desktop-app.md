# Desktop app architecture

## Goal

The desktop edition runs the same Paper Agent product locally rather than opening the public Sites URL. Keeping one React/LangGraph codebase prevents behavior drift between web and desktop.

## Runtime flow

1. Electron obtains a single-instance lock.
2. In a packaged build, Electron starts the bundled Vinext standalone server at `127.0.0.1:43187`. The fixed origin preserves IndexedDB/localStorage across launches. If the port is occupied, close the conflicting service before launching; changing ports would change the storage origin.
3. The main window waits for that server and loads it.
4. IndexedDB/localStorage use Electron's persistent application profile, so the literature library and settings remain after restart.
5. Closing the application stops the private local server.

Development uses the same shell against a temporary Vinext development port. Production never depends on the public Paper Agent URL.

## Security boundary

- `nodeIntegration: false`
- `contextIsolation: true`
- Chromium sandbox enabled
- Internal navigation restricted to the generated loopback origin
- Only HTTPS and `mailto:` external URLs are delegated to the operating system
- No API key is compiled into the application
- A single-instance lock prevents duplicate local servers and windows

## Packaging

`desktop:build` asks Vinext for standalone output. `electron-builder` includes that minimal runtime as `app-server` and produces macOS, Windows or Linux packages. Installers are written to ignored `release/`.

Code signing and notarization are deliberately not automated: future GitHub releases should load signing credentials from repository secrets, never source files.

## Redundancy audit (2026-09-11)

- TypeScript with `noUnusedLocals` and `noUnusedParameters`: clean before desktop integration. This detects unused bindings, not every unreachable module or duplicated algorithm.
- Full ESLint run: clean.
- Obsolete website and machine-specific browser launchers were removed after the packaged Electron app was installed and verified. The portable source launch scripts remain supported.
- Web and desktop deliberately share all product components, stores, services and agent graphs. Desktop-specific code is limited to process lifecycle, navigation isolation and build orchestration.

## Verification and remaining release work

- Standalone build succeeded; local HTTP homepage returned 200 and `/api/papers` returned its expected validation error without input.
- Desktop runtime unit checks and TypeScript/ESLint passed.
- Follow-up desktop tests cover rejecting HTTP redirects/errors, owned-child readiness, port collision, and startup timeout (6 tests total). The window now waits for its own Vinext process to announce listening, so an unrelated service on the fixed port cannot satisfy startup readiness. Development startup reuses shared helpers and cleans up its server if Electron fails to launch.
- Electron 44.3.0 download recovered; the official archive checksum was verified. The macOS arm64 app was built, launched in an independent window, and installed locally. Quitting stopped its server. The installation uses an ad-hoc local signature, not Developer ID signing or notarization. DMG, Windows and Linux have not been verified.
- The prior online dependency audit reported 5 production dependency findings, including Next.js. A later offline audit is not evidence that these were fixed. Resolve and rerun the online audit before a public binary release.
- Browser data is scoped to the website origin. Existing hosted-site documents/settings are not automatically migrated into Electron; retain the browser profile and original PDFs.
- Project-owned code, documentation and cat artwork use the non-commercial license in `LICENSE`. Third-party components retain their own licenses.
