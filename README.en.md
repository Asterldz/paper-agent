# Paper Agent

[简体中文](README.md) · **English**

A local-first AI paper reader: translate while reading, follow references, and turn findings into source-linked knowledge notes.

Built with **TypeScript, React, LangGraph, LangChain, PDF.js, and Electron**. Run in an independent desktop window or your browser, using a model provider you configure.

> Under active development. Local packaging and startup have been checked on macOS arm64; Windows and Linux installers have not been verified on actual machines. No model, API key, or free model quota is included.

## Features

- **Reading and translation:** PDF viewing, selection translation, explanations, summaries, terminology, independent zoom, and an adjustable split layout.
- **Conversational assistant:** a draggable animated cat opens a resizable conversation window for the current paper or multiple imported papers.
- **Reference tracing:** find local references, then use external search/read tools when needed. Distinguish full text, abstracts, and metadata, with source locations.
- **Literature management:** local library, user-defined folders, reading history, and restoration. Organization is inside the app, not unrestricted filesystem moves.
- **Knowledge notes:** draft paper, concept, or comparison pages; review before saving, search, check sources, retain revisions, and export Markdown.
- **Controlled preference adaptation:** a reading skill handles core tasks; an evolution skill proposes bounded changes with review, version checks, and rollback.
- **Caching and conversion:** translation/explanation caches and term memory; extract PDF text to TXT or Markdown.

## How the agent works

Selection translation uses a separate streaming fast path. Complex questions enter the assistant's tool-calling workflow.

```text
User question
   ↓
LangGraph planning ←────────────────┐
   ↓                               │
Choose tool → Validate → Execute ───┘ Retrieve more if needed
   ↓
Evidence-based answer → Source-location checks → Answer and execution trace
```

LangGraph manages control flow and stopping conditions, LangChain adapts model tool calls, and Zod validates arguments. Tools cover the current paper, library, references, external papers, and knowledge notes. Planning rounds, tool calls, and runtime are bounded.

**Current RAG uses keyword/term-frequency retrieval, not a vector database.** Citation checks validate evidence identity and location, not the truth of every claim. Verify important conclusions against the original.

The two skills modify restricted reading policies, not model weights or project source code. Explicit style preferences can be adopted automatically when enabled; other changes go through candidate review.

## Quick start

Install **Node.js 22.13 or newer and npm**. Download and extract this repository, or clone it, then enter the directory containing `package.json`. Initial dependency installation requires internet access.

### Electron desktop window

```bash
npm ci
npm run desktop:dev
```

This starts the source project in an independent application window without an external browser. Development startup still requires Node.js and the source tree.

Package the app with its local server:

```bash
npm run desktop:pack  # Unpacked app for local testing
npm run desktop:dist  # Distribution package for the current platform
```

Outputs go to `release/`. Packaged apps include their runtime, so end users do not need a separate Node.js installation. Online models and external retrieval still require network access. Public macOS developer signing/notarization and other platform compatibility remain to be verified.

### Run locally in a browser

Skip Electron's binary download when only using the browser version.

macOS / Linux:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run local:build
npm run local:start
```

Windows PowerShell:

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
npm ci
npm run local:build
npm run local:start
```

The launcher opens the [local reader](http://127.0.0.1:43187). Keep the terminal running; press `Ctrl+C` to stop. Closing the browser does not stop the server. Do not run the desktop app and a local browser server using the same port simultaneously.

The repository also includes `启动本地阅读器.command` for macOS and `启动本地阅读器.cmd` for Windows. These source launchers require Node.js and are not installers. The Windows launcher has not been tested on an actual Windows machine.

After updating the source, reinstall dependencies, run `npm run local:build`, stop the old server, and restart. Launchers do not download project updates automatically. If you previously skipped Electron's download, unset that environment variable and run `node node_modules/electron/install.js` before switching to desktop mode.

### Configure a model and start reading

1. In Settings, enter your API endpoint, model name, and API key.
2. Test the connection and select a model. The agent requires an OpenAI-compatible model supporting **Tool Calling**; a successful connection test alone does not establish tool compatibility.
3. Import a PDF with a text layer. Select text to translate or click the cat to open the assistant.
4. Try: “What are this paper's methods and limitations? Include sources.” Or: “Check the original description of this method in the cited reference.”
5. Ask for knowledge-page drafts, then check sources and approve them in the knowledge panel.

Thinking parameters, output limits, and cross-origin policies vary by provider. Incompatible configurations may fail; the app does not grant access to paid APIs.

## Data, privacy, and costs

- Papers, notes, history, and caches primarily use local IndexedDB. Settings and model credentials are stored in the browser/Electron profile. **API keys are not encrypted in an OS keychain.** Avoid saving long-lived keys on shared devices.
- Local-first is not fully offline: relevant excerpts and questions go to your model provider. External search sends necessary keywords or paper identifiers.
- Your provider account pays for model usage. Caching can avoid some repeated requests, but no fixed cost or latency reduction is guaranteed.
- Browsers, Electron profiles, and site origins have separate storage. Automatic cross-device sync and full database migration are not implemented.
- Clearing site data may delete your library and history. Keep original PDFs and export important notes. Never commit keys, private papers, or database exports.

## Current limitations

- PDF parsing requires a text layer; there is no general OCR workflow. Complex columns, equations, headers, and cross-page selection may need manual checking. TXT/Markdown exports do not guarantee layout preservation.
- External search uses Crossref and Europe PMC. Full-text reading supports applicable Europe PMC open articles and arXiv PDFs identified by ID. It does not bypass paywalls or crawl arbitrary websites.
- Vector retrieval, unattended continuous evolution, autonomous background scheduling, and model training are not implemented.
- Automated tests mainly validate mechanisms with simulated models, not real-paper answer accuracy, every provider's compatibility, or performance benchmarks.
- The build still includes its original Sites/Cloudflare integration. It is not fully decoupled; do not simply delete its configuration or reuse the original hosting identity to publish.

## Development and tests

```bash
npm run dev          # Browser development server; see the printed URL
npm run typecheck
npm run lint
npm run test:agent
npm run test:desktop
npm run test:pet
npm run desktop:build
```

| Directory | Purpose |
| --- | --- |
| `components/`, `hooks/` | Reader, assistant, knowledge UI, and interactions |
| `services/agent/` | LangGraph flows, tools, retrieval, skill policies |
| `services/llm/` | Model calls, streaming, error handling |
| `services/pdf/`, `services/storage/` | PDF parsing and local persistence |
| `agent-skills/` | Reading and feedback-evolution instructions |
| `desktop/`, `scripts/` | Electron shell, packaging, local launchers |
| `tests/` | Agent, desktop runtime, animation tests |

Further reading: [agent architecture](docs/agent-project.md), [skill evolution](docs/agent-evolution-design.md), [knowledge wiki](docs/llm-wiki.md), [desktop app](docs/desktop-app.md), [animation](docs/pet-sprite-animation.md), and [open-source readiness](docs/open-source-readiness.md). Some documents are in Chinese or contain historical notes; consult the current code and documented limitations.

## Contributing and license

Reproducible reports and improvements are welcome. Include your platform, launch method, reproduction steps, and sanitized logs. For PDF selection issues, use a publicly shareable example where possible. Run relevant tests; do not include `node_modules/`, `dist/`, or `release/`.

See [SECURITY.md](SECURITY.md) for security reporting. Never put credentials or private papers in public reports.

Project code, documentation, and project-owned cat character and animation assets use the [Paper Agent Non-Commercial License](LICENSE). Use, modification, and redistribution are permitted solely for non-commercial purposes, including personal learning, education, and non-commercial research. Retain copyright and license notices, identify modifications, and preserve the non-commercial restrictions. **Commercial use requires prior written permission from the relevant copyright holders**, including paid products, advertising-supported services, and for-profit business operations. Third-party dependencies retain their own licenses.

This is a source-available project, not MIT-licensed or open source under the OSI definition. The author supplied the cat assets and confirmed ownership. See LICENSE for the full scope and terms.
