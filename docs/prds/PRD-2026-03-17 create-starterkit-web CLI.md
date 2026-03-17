# PRD: create-starterkit-web CLI

**Date**: 2026-03-17
**Status**: Draft — Ready for Architecture
**Audience**: Solo developer (fullstack, pnpm/Node/React Router v7 stack)

---

## Table of Contents

1. [Overview & Goals](#overview--goals)
2. [Problem Statement](#problem-statement)
3. [Success Metrics](#success-metrics)
4. [Feature Specification](#feature-specification)
5. [User Flows](#user-flows)
6. [Technical Architecture](#technical-architecture)
7. [Implementation Priorities](#implementation-priorities)
8. [Automation & DevOps Strategy](#automation--devops-strategy)

---

## 1. Overview & Goals

### Vision

`create-starterkit-web` is a zero-dependency CLI scaffolder that produces a fully-configured, `pnpm dev`-ready project from the `starterkit-web` template in a single command. A developer who has never seen the template before runs one command and has a working local dev environment in under 30 seconds.

### Goals (ranked by impact)

| # | Goal | Rationale |
|---|------|-----------|
| 1 | Eliminate manual bootstrap friction entirely | 10–15 min manual process replaced by one command |
| 2 | Enforce prerequisite correctness upfront | Surface Node/pnpm version mismatches before wasted install time |
| 3 | Keep template and CLI always in sync | Template bundled at build time; no drift possible |
| 4 | Enable ongoing project health checks | `doctor` command catches configuration rot post-scaffold |
| 5 | Support upgrade awareness | `upgrade`/`list` commands prevent developers from scaffolding stale templates |

### Non-Goals

- Interactive prompt UI (no inquirer/Clack — stays flags-only for scriptability)
- Multi-template support (single template: `starterkit-web`)
- Windows PowerShell compatibility (macOS/Linux targets; WSL supported)
- Ejection or post-scaffold patching mechanics

---

## 2. Problem Statement

### Current State — Manual Bootstrap (10–15 minutes)

Every new project from `starterkit-web` requires a developer to:

1. `git clone` or copy the repo directory manually
2. Find/replace all occurrences of the package name `starterkit-web` across `package.json`, `README.md`, and any config files
3. Delete `.git/` and run `git init` to get a clean history
4. Copy `.env.example` to `.env` and fill in `VITE_SENTRY_DSN` and `VITE_API_BASE_URL`
5. Verify Node >= 22 and pnpm >= 10 are active (or waste time debugging install failures)
6. Run `pnpm install` and wait for dependency resolution
7. Verify the dev server actually starts

Every step is manual, error-prone, and adds cognitive overhead before a single line of product code is written.

### Key Pain Points

- **Token substitution errors**: Missed occurrences of `starterkit-web` cause runtime or publish failures discovered later
- **Stale `.env`**: Developers forget to create `.env`, leading to silent Sentry/API failures
- **Version mismatches**: Node 20 / pnpm 9 environments silently break the build — discovered at install time, not upfront
- **Git history pollution**: Cloned repos carry starterkit commit history; developers manually clean this
- **No version tracking**: No record of which scaffold version a project was bootstrapped from, making future upgrades ad-hoc

### Target Developer Persona

A fullstack developer starting a new React/Node project who already knows the `starterkit-web` stack. They are not evaluating the template — they have decided to use it and want maximum speed to first `pnpm dev`.

---

## 3. Success Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Time from command to `pnpm dev` ready | 10–15 min | < 30 seconds |
| Manual steps required | 7 | 1 (single command) |
| Token substitution errors post-scaffold | Occasional | 0 (exhaustive, compile-time verified) |
| Projects missing `.env` on first boot | Frequent | 0 (auto-generated from `.env.example`) |
| Prerequisite failures caught before install | 0% | 100% |
| CLI correctness (template/CLI in sync) | Manual verification | Guaranteed (bundled at build time) |

---

## 4. Feature Specification

### 4.1 Commands Overview

```
create-starterkit-web <command> [options]

Commands:
  create <project-name>   Scaffold a new project (default command)
  doctor                  Run health checks on an existing scaffolded project
  upgrade                 Show available CLI versions newer than current scaffold
  list                    List all published CLI versions

Options:
  --version, -v           Print CLI version
  --help, -h              Print help
```

---

### 4.2 `create` Command

**Invocation patterns:**

```bash
# Recommended: npx (always latest)
npx create-starterkit-web my-app

# npm create sugar syntax
npm create starterkit-web my-app

# Direct if globally installed
create-starterkit-web my-app

# Named flag alternative
create-starterkit-web create my-app
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--skip-install` | Copy template and substitute tokens; skip `pnpm install` |
| `--skip-git` | Skip `git init` and initial commit |
| `--force` | Overwrite an existing directory (dangerous; explicit opt-in required) |

**Scaffolding pipeline (11 steps):**

```
Step 1  Validate project name
        - Must match /^[a-z0-9][a-z0-9._-]*$/
        - Reject: empty, ".", "..", absolute paths, path separators
        - Exit 1 on failure

Step 2  Check destination directory
        - Target: process.cwd()/<project-name>
        - Reject if exists and non-empty (unless --force)
        - Exit 3 on collision

Step 3  Check Node version
        - Require >= 22.0.0
        - Read from process.versions.node
        - Exit 2 on failure; print install URL

Step 4  Check pnpm version
        - Require >= 10.0.0
        - Resolve via `which pnpm` + `pnpm --version`
        - Exit 2 on failure; print corepack enable guidance

Step 5  Copy template files
        - Template bundled at CLI build time under dist/template/
        - Recursive copy; preserve file modes
        - Copy .gitignore, .env.example, .claude/ (included)
        - Exclude: node_modules/, .git/, pnpm-lock.yaml (fresh lock on install)
        - Exit 4 on any I/O error

Step 6  Token substitution
        - Files touched: package.json, README.md (exhaustively verified)
        - Replace: "starterkit-web" → <project-name>
        - Replace: "starterkit-web" → @<project-name> (scoped) OR <project-name> (unscoped)
        - Strategy: whole-file read → string replace → write; no regex fragility

Step 7  Generate .env
        - Copy .env.example → .env verbatim
        - Do not auto-fill values; let developer fill intentionally
        - Print reminder of required vars after scaffold completes

Step 8  Write .starterkit metadata
        - Path: <project-name>/.starterkit
        - Format: JSON { "version": "<cli-version>", "date": "<ISO-8601>", "template": "starterkit-web" }
        - Used by doctor/upgrade commands

Step 9  pnpm install
        - Run: pnpm install --dir <project-name>
        - Generates fresh pnpm-lock.yaml (not bundled)
        - Stream output to terminal
        - Exit 5 on non-zero exit code

Step 10 git init + initial commit
        - git init <project-name>
        - git -C <project-name> add -A
        - git -C <project-name> commit -m "chore: scaffold from create-starterkit-web v<version>"
        - Skip if --skip-git

Step 11 Print success summary
        - Project directory path (absolute)
        - cd and pnpm dev instructions
        - Reminder of .env variables to fill
        - Scaffold version and date
```

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Bad arguments / invalid project name |
| 2 | Prerequisites not met (Node or pnpm version) |
| 3 | Directory collision |
| 4 | File copy failure |
| 5 | `pnpm install` failure |

---

### 4.3 `doctor` Command

Run inside an existing scaffolded project directory.

```bash
create-starterkit-web doctor [--fix]
```

**Health checks:**

| Check | Pass condition | --fix action |
|-------|---------------|--------------|
| Node version | >= 22.0.0 | Print install guidance (cannot auto-fix) |
| pnpm version | >= 10.0.0 | Print `corepack enable` guidance |
| node_modules | Directory exists | Run `pnpm install` |
| .env file | File exists at project root | Copy from `.env.example` |
| Git repo | `.git/` present | Run `git init` |
| .starterkit file | File exists and parseable | Cannot auto-fix; warn only |

**Output format:**

```
doctor  create-starterkit-web v1.2.0

  Node      22.14.0   pass
  pnpm      10.6.0    pass
  node_modules        pass
  .env                MISSING  (run with --fix to restore from .env.example)
  git                 pass
  .starterkit         pass  (scaffolded v1.1.0 on 2026-03-15)

  1 issue found. Run with --fix to auto-resolve.
```

**--fix behavior:**

- Applies all auto-fixable issues silently
- Re-runs and prints final state after fixes
- Exits 0 if all pass after fix; exits 1 if unfixable issues remain

---

### 4.4 `upgrade` Command

```bash
create-starterkit-web upgrade
```

- Reads `.starterkit` to determine current scaffold version
- Queries npm registry for published versions of `create-starterkit-web`
- Prints versions newer than scaffold version
- Does NOT perform any file mutations — awareness only

**Output format:**

```
upgrade  Scaffold version: 1.1.0

  Available upgrades:
    1.2.0   2026-03-10   (latest)
    1.1.5   2026-02-28

  Re-scaffold or apply changes manually. No automated patch is applied.
```

---

### 4.5 `list` Command

```bash
create-starterkit-web list
```

- Queries npm registry for all published versions of `create-starterkit-web`
- Prints version table with publish dates
- Marks `latest` tag

**Output format:**

```
list  create-starterkit-web

  Version   Published      Tag
  1.2.0     2026-03-10     latest
  1.1.5     2026-02-28
  1.1.0     2026-03-01
  1.0.0     2026-02-01
```

---

### 4.6 .starterkit Metadata File

Path: `<project-root>/.starterkit`

```json
{
  "version": "1.2.0",
  "date": "2026-03-17T10:00:00.000Z",
  "template": "starterkit-web"
}
```

- Committed into the project git history on scaffold
- Never mutated post-scaffold (read-only reference)
- Consumed by `doctor` and `upgrade` for version awareness

---

## 5. User Flows

### 5.1 Happy Path: New Project

```
Developer                       CLI
    |                             |
    |-- npx create-starterkit-web my-app -->|
    |                             |-- Validate name: ok
    |                             |-- Check dir: clean
    |                             |-- Check Node 22.14.0: pass
    |                             |-- Check pnpm 10.6.0: pass
    |                             |-- Copy template files
    |                             |-- Substitute tokens in package.json, README.md
    |                             |-- Generate .env from .env.example
    |                             |-- Write .starterkit
    |                             |-- pnpm install (streams output)
    |                             |-- git init + initial commit
    |<-- Success: cd my-app && pnpm dev --|
    |                             |
```

**Total wall-clock time**: ~20–30 seconds (dominated by pnpm install with cold cache)

---

### 5.2 Prerequisite Failure: Node Version

```
$ npx create-starterkit-web my-app

  create-starterkit-web v1.2.0

  Checking prerequisites...
  Node  18.20.0  FAIL  (required: >=22.0.0)

  Install Node 22+ via:
    https://nodejs.org/en/download
    or: nvm install 22 && nvm use 22

  Exiting. (exit code 2)
```

---

### 5.3 Directory Collision

```
$ npx create-starterkit-web my-app

  create-starterkit-web v1.2.0

  Directory already exists: /Users/dev/projects/my-app

  Use --force to overwrite. This is destructive.

  Exiting. (exit code 3)
```

---

### 5.4 Doctor with --fix

```
$ create-starterkit-web doctor --fix

  doctor  create-starterkit-web v1.2.0

  Running checks...
  Node          22.14.0  pass
  pnpm          10.6.0   pass
  node_modules           MISSING  -> running pnpm install...
  .env                   MISSING  -> copying from .env.example...
  git                    pass
  .starterkit            pass

  Fixed 2 issues. All checks pass.
```

---

### 5.5 Scriptable / CI Usage

```bash
# Non-interactive, no TTY required — all flags-driven
npx create-starterkit-web my-app --skip-git
echo $?  # 0 = success, non-zero = failure with specific code

# Pipe-safe: progress lines go to stderr, final path goes to stdout
# (allows: PROJECT_DIR=$(npx create-starterkit-web my-app 2>/dev/null))
```

---

## 6. Technical Architecture

### 6.1 Repository Structure

Convert `starterkit-web` to a pnpm workspace:

```
starterkit-web/                    (repo root)
├── pnpm-workspace.yaml
├── package.json                   (workspace root; no dependencies)
├── packages/
│   ├── template/                  (current app, moved here)
│   │   ├── package.json           (name: "starterkit-web")
│   │   ├── template.config.json   (manifest: token map, excluded files)
│   │   └── ... (all current app files)
│   └── cli/
│       ├── package.json           (name: "create-starterkit-web"; publishConfig.access: public)
│       ├── tsconfig.json          (ESM, tsup target)
│       ├── tsup.config.ts
│       ├── src/
│       │   ├── index.ts           (CLI entry; parseArgs dispatch)
│       │   ├── commands/
│       │   │   ├── create.ts
│       │   │   ├── doctor.ts
│       │   │   ├── upgrade.ts
│       │   │   └── list.ts
│       │   ├── steps/             (individual pipeline steps, each independently testable)
│       │   │   ├── validate-name.ts
│       │   │   ├── check-prereqs.ts
│       │   │   ├── copy-template.ts
│       │   │   ├── substitute-tokens.ts
│       │   │   ├── generate-env.ts
│       │   │   ├── write-metadata.ts
│       │   │   ├── run-install.ts
│       │   │   └── git-init.ts
│       │   └── lib/
│       │       ├── printer.ts     (stdout/stderr formatting; no chalk dependency)
│       │       ├── registry.ts    (npm registry fetch for upgrade/list)
│       │       └── version.ts     (semver comparison; no semver package)
│       └── dist/                  (tsup output; includes bundled template/)
```

---

### 6.2 Template Bundling Strategy

The template is bundled into the CLI at build time via a `prepare` script:

```
packages/cli/package.json scripts:
  "prepare": "node scripts/bundle-template.mjs && tsup"
```

`bundle-template.mjs` behavior:
1. Read `packages/template/template.config.json` for exclusion list
2. Recursively copy `packages/template/` to `packages/cli/dist/template/`
3. Exclude: `node_modules/`, `.git/`, `pnpm-lock.yaml`, `template.config.json`
4. Include: `.gitignore`, `.env.example`, `.claude/`

Result: `packages/cli/dist/template/` is always exactly what gets scaffolded. Template drift is structurally impossible.

---

### 6.3 template.config.json Manifest

```json
{
  "tokens": {
    "starterkit-web": "__PROJECT_NAME__",
    "starterkit-web": "__PROJECT_NAME_SCOPED__"
  },
  "substitutionFiles": [
    "package.json",
    "README.md"
  ],
  "exclude": [
    "node_modules",
    ".git",
    "pnpm-lock.yaml"
  ]
}
```

- `substitutionFiles` is the exhaustive, audited list — no glob scanning
- Adding a new file requiring substitution requires an explicit manifest edit
- The `prepare` script validates all `substitutionFiles` exist in the template

---

### 6.4 Dependency Philosophy

**No runtime npm dependencies.** The CLI uses only Node built-ins:

| Need | Solution |
|------|---------|
| Argument parsing | `node:util` `parseArgs` |
| File I/O | `node:fs/promises` |
| Path operations | `node:path` |
| Process spawning | `node:child_process` `spawn` (streaming output) |
| HTTP (registry) | `node:https` |
| Semver comparison | Hand-rolled 3-integer comparison (no `semver` package) |
| Terminal color | ANSI escape codes inline (no `chalk`) |

**Dev dependencies only** (not shipped to consumers):

- `tsup` — bundle CLI to single ESM file
- `typescript` — type checking
- `@types/node` — Node type definitions

Zero consumer install footprint beyond the CLI bundle itself.

---

### 6.5 Output Stream Convention

| Stream | Content |
|--------|---------|
| `stderr` | All progress messages, step labels, warnings, error details |
| `stdout` | Final success output only (project path, next steps) |

This makes the CLI scriptable:

```bash
PROJECT=$(npx create-starterkit-web my-app 2>/dev/null)
cd "$PROJECT"
```

---

### 6.6 Performance Requirements

| Operation | Target |
|-----------|--------|
| Argument parsing to first output | < 100ms |
| Template copy (no install) | < 500ms |
| Total with `pnpm install` (warm cache) | < 30 seconds |
| Total with `pnpm install` (cold cache) | < 90 seconds |
| `doctor` command (no fixes) | < 2 seconds |
| `upgrade`/`list` (registry fetch) | < 3 seconds |

---

### 6.7 Platform Support

| Platform | Support level |
|----------|---------------|
| macOS (arm64, x64) | Primary — fully tested |
| Linux (x64) | Supported — CI-verified |
| WSL2 on Windows | Best-effort |
| Windows (native) | Not supported |

Node >= 22.0.0 required. pnpm >= 10.0.0 required.

---

### 6.8 Security Considerations

- No network requests during `create` (template is bundled; install uses pnpm's own security)
- Registry queries (`upgrade`, `list`) use HTTPS only, read-only, no auth
- `--force` flag requires explicit user opt-in; guarded by warning message
- No secrets written by CLI; `.env` values left empty for developer to fill
- `.env` is included in `.gitignore` within the template (verified at template audit time)

---

## 7. Implementation Priorities

### Phase 1: Monorepo Restructure (prerequisite)

| Task | Notes |
|------|-------|
| Convert repo to pnpm workspace | Add `pnpm-workspace.yaml`; move app to `packages/template/` |
| Create `packages/cli/` skeleton | `package.json` with `create-starterkit-web` name, `tsup.config.ts`, `tsconfig.json` |
| Write `template.config.json` | Audit and document all substitution files and excluded paths |
| Write `bundle-template.mjs` | Prepare script that copies template into CLI dist |
| Verify existing app still works | `pnpm -F starterkit-web dev` should function identically post-move |

**Deliverable**: Monorepo where both packages build independently; template bundling is deterministic.

---

### Phase 2: Core Scaffold (create command)

| Task | Priority | Notes |
|------|----------|-------|
| Argument parsing + help output | P0 | `parseArgs`; handle `--version`, `--help` |
| Name validation (`validate-name.ts`) | P0 | Regex + path safety checks |
| Prerequisite checks (`check-prereqs.ts`) | P0 | Node + pnpm version; early exit with guidance |
| Template copy (`copy-template.ts`) | P0 | Recursive `fs/promises` copy from bundled dist/template |
| Token substitution (`substitute-tokens.ts`) | P0 | Read manifest; replace in specified files only |
| .env generation (`generate-env.ts`) | P0 | Copy `.env.example` → `.env` |
| Metadata write (`write-metadata.ts`) | P0 | Write `.starterkit` JSON |
| Install runner (`run-install.ts`) | P0 | `spawn pnpm install`; stream stdout/stderr |
| Git init (`git-init.ts`) | P0 | `git init` + `git add -A` + initial commit |
| Success printer | P0 | cd instructions, .env reminder, version info |
| `--skip-install`, `--skip-git`, `--force` flags | P1 | Scriptability; --force safety guard |
| Exit code correctness | P0 | All 6 exit codes wired to correct failure points |

**Deliverable**: `npx create-starterkit-web my-app` produces a working project.

---

### Phase 3: Distribution

| Task | Priority | Notes |
|------|----------|-------|
| npm publish configuration | P0 | `publishConfig`, `files` array in `package.json` |
| GitHub Actions: CI on PR | P0 | Type-check, lint, test (node 22, ubuntu-latest) |
| GitHub Actions: publish on tag | P0 | Trigger on `cli/v*` tags; `npm publish` with NPM_TOKEN secret |
| Version bump script | P1 | `pnpm -F create-starterkit-web version patch/minor/major` |
| Smoke test in CI | P1 | Run `node dist/index.js my-test-app --skip-install --skip-git`; assert dir created |

**Deliverable**: Automated publish pipeline; `npx create-starterkit-web` works from npm.

---

### Phase 4: Operational Commands

| Task | Priority | Notes |
|------|----------|-------|
| `doctor` health checks | P1 | 6 checks listed in §4.3 |
| `doctor --fix` | P1 | Auto-resolve fixable issues |
| `upgrade` command | P2 | Registry fetch; semver comparison vs `.starterkit` |
| `list` command | P2 | Registry fetch; version table |
| `registry.ts` shared module | P2 | Reused by `upgrade` and `list` |

**Deliverable**: Developers can diagnose and repair scaffolded projects post-bootstrap.

---

## 8. Automation & DevOps Strategy

### 8.1 Template-CLI Sync (Zero Drift)

The single highest-risk failure mode is template/CLI divergence — a CLI that scaffolds stale or incorrect files. The architecture eliminates this structurally:

```
git commit on packages/template/
    --> triggers prepare script on next CLI build
    --> dist/template/ is always derived from current packages/template/
    --> no manual sync step exists
```

The `prepare` script runs before every `tsup` build. There is no path to publish a CLI without an up-to-date template bundle.

### 8.2 GitHub Actions Workflow

**On pull request to `main`:**

```yaml
- pnpm install (workspace)
- pnpm -F create-starterkit-web type-check
- pnpm -F create-starterkit-web lint
- pnpm -F create-starterkit-web build  (runs prepare + tsup)
- Smoke test: node packages/cli/dist/index.js smoke-test --skip-install --skip-git
- Assert: smoke-test/ directory created; .starterkit readable; package.json name = "smoke-test"
- Cleanup: rm -rf smoke-test/
```

**On tag push matching `cli/v*`:**

```yaml
- Same build + smoke test
- npm publish --access public (with NPM_TOKEN secret)
- Create GitHub Release with tag notes
```

### 8.3 Release Versioning Convention

```
Tag format:   cli/v1.2.0
npm version:  1.2.0  (in packages/cli/package.json)
```

Template-only changes (no CLI behavior change) = patch bump.
New CLI features = minor bump.
Breaking scaffold output changes = major bump.

### 8.4 Local Development Workflow

```bash
# Build CLI (runs bundle-template + tsup)
pnpm -F create-starterkit-web build

# Test locally without publish
node packages/cli/dist/index.js my-test-app

# Link globally for manual testing
pnpm -F create-starterkit-web link --global
create-starterkit-web my-test-app

# Verify template bundle is current
ls packages/cli/dist/template/
```

### 8.5 npm Package Configuration

```json
{
  "name": "create-starterkit-web",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "create-starterkit-web": "./dist/index.js"
  },
  "files": [
    "dist/"
  ],
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

The unscoped name `create-starterkit-web` enables:
```bash
npm create starterkit-web my-app
# equivalent to: npx create-starterkit-web my-app
```

---

## Appendix A: Token Substitution Audit

Files in the template containing `starterkit-web` or `starterkit-web` (verified exhaustive):

| File | Token | Replacement |
|------|-------|-------------|
| `package.json` | `"name": "starterkit-web"` | `"name": "<project-name>"` |
| `README.md` | `starterkit-web` (heading + description) | `<project-name>` |

All other files in the template contain no project-name tokens. This list is the source of truth for `template.config.json` `substitutionFiles`.

---

## Appendix B: .env Variables

Variables present in `.env.example` that get copied to `.env` on scaffold:

| Variable | Required | Notes |
|----------|----------|-------|
| `VITE_SENTRY_DSN` | Optional | Leave empty to disable Sentry |
| `VITE_API_BASE_URL` | Required for API calls | Axios base URL; app will function without but API calls will fail |

Developer reminder printed at scaffold completion:

```
  Fill in .env before running:
    VITE_API_BASE_URL=https://api.your-domain.com
    VITE_SENTRY_DSN=https://...@sentry.io/...  (optional)
```

---

## Appendix C: Competitive Positioning

| Tool | Approach | Gap vs. create-starterkit-web |
|------|----------|-------------------------------|
| `create-t3-app` | Interactive prompts; modular feature selection | Overkill for a fixed-stack starter; prompt overhead |
| `degit` | Clone without git history | No token substitution, no prereq checks, no .env generation |
| Manual clone | Full control | 10–15 min every time; error-prone |
| GitHub template repos | One-click via UI | No CLI path; no local dev automation; no prereq enforcement |

**Differentiation**: Single-command, zero-prompt, batteries-included scaffold with built-in prerequisite enforcement, metadata tracking, and operational health checks. No flexibility tradeoffs — this tool does exactly one thing (starterkit-web) and does it completely.
