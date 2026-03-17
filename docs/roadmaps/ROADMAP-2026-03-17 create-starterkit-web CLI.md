# Development Roadmap: create-starterkit-web CLI

Generated: 2026-03-17

---

## Executive Summary

`create-starterkit-web` is a zero-dependency CLI scaffolder that produces a fully-configured, `pnpm dev`-ready project from the `starterkit-web` template in a single `npx` command. To enable this, the existing `starterkit-web` app (currently at the repo root) must first be migrated into a pnpm workspace monorepo, with the app living at `packages/template/` and the new CLI at `packages/cli/`.

**Key success metrics:**

| Metric | Baseline | Target |
|--------|----------|--------|
| Time from command to `pnpm dev` ready | 10–15 min | < 30 seconds |
| Manual steps required | 7 | 1 |
| Token substitution errors post-scaffold | Occasional | 0 |
| Projects missing `.env` on first boot | Frequent | 0 |
| Prerequisite failures caught before install | 0% | 100% |
| Template/CLI drift | Manual verification | Structurally impossible |

**Expected phase timeline:**

| Phase | Scope | Dependencies |
|-------|-------|--------------|
| Phase 1 | Monorepo restructure | None — must run first |
| Phase 2 | Core `create` command | Phase 1 complete |
| Phase 3 | Operational commands (`doctor`, `upgrade`, `list`) | Phase 2 complete |
| Phase 4 | Distribution & CI/CD | Phase 2 complete; Phase 3 optional |

---

## Architectural Decisions

All decisions below are **finalized**. They are documented here for traceability and to surface the implications each decision has on subsequent phases.

---

### Decision 1: Workspace Manager

**Status**: Selected

**Options Considered:**
- **pnpm workspaces**: Native to the existing toolchain (`packageManager: pnpm@10.13.1` is already declared). Workspace protocol links packages with zero config overhead. (Pros: already in use, fast, deterministic | Cons: pnpm-specific)
- **npm workspaces**: Built into npm 7+. (Pros: no extra toolchain | Cons: slower installs, no `--filter` ergonomics, inconsistent with declared `packageManager`)
- **Turborepo**: Adds build orchestration and caching on top of pnpm. (Pros: parallel builds, remote caching | Cons: heavyweight for a two-package repo)

**Selected Option**: pnpm workspaces

**Reasoning**: The project already declares `packageManager: pnpm@10.13.1`. pnpm workspaces require only a `pnpm-workspace.yaml` file — no additional tooling. The `--filter` flag gives precise per-package build commands that map directly to CI steps.

**Impact**: All workspace commands use `pnpm --filter <package-name> <script>`. Root `package.json` becomes a workspace root with no runtime deps.

**Assumptions**: pnpm >= 10.0.0 is available in all developer and CI environments.

---

### Decision 2: CLI Build Tool

**Status**: Selected

**Options Considered:**
- **tsup**: Single-file ESM bundle with automatic shebang injection, `__dirname` shim for ESM, and zero-config TypeScript support. (Pros: handles ESM shebang automatically, lightweight, fast | Cons: additional dev dependency)
- **tsc + esbuild**: Manual pipeline — tsc for type checking, esbuild for bundling. (Pros: explicit control | Cons: requires manual shebang injection and `import.meta.url` handling)
- **Rollup**: Full-featured bundler with plugin ecosystem. (Pros: mature | Cons: verbose config; overkill for a single-file CLI)

**Selected Option**: tsup

**Reasoning**: tsup resolves the two critical ESM CLI challenges automatically: the `#!/usr/bin/env node` shebang must be the first byte of the output file, and `__dirname` does not exist in ESM modules (tsup injects a compatible shim). A single `tsup.config.ts` with `entry: ['src/index.ts'], format: ['esm'], banner: { js: '#!/usr/bin/env node' }` produces a working CLI bundle with no additional steps.

**Impact**: The `prepare` script in `packages/cli/package.json` runs `node bundle-template.mjs && tsup`. The `dist/` directory is the publish artifact.

**Assumptions**: tsup is added as a dev dependency only to `packages/cli/` — it does not affect consumers of the published package.

---

### Decision 3: Module Format

**Status**: Selected

**Options Considered:**
- **ESM (`"type": "module"`)**: Native Node 22 module format. Compatible with `import.meta.url` for resolving the bundled template path. (Pros: consistent with monorepo, future-proof, no transpilation quirks | Cons: `require()` interop requires care)
- **CJS (`"type": "commonjs"`)**: Traditional Node format. (Pros: broader compatibility with older tooling | Cons: `__dirname`-based path resolution is incompatible with ESM-native template path logic; inconsistent with rest of monorepo)

**Selected Option**: ESM (`"type": "module"`)

**Reasoning**: The bundled template path resolution depends on `new URL('../template', import.meta.url).pathname`. This pattern is only available in ESM. Node 22 (the minimum required version) has full ESM stability. The rest of the monorepo is already ESM.

**Impact**: All CLI source files use `import`/`export`. The `node:test` runner used for tests requires `--experimental-strip-types` or `tsx` — `tsx` is used as a dev dependency for test execution.

**Assumptions**: No consumers of the published package attempt to `require()` the CLI programmatically. The CLI is always invoked via the binary entrypoint.

---

### Decision 4: Template Bundling Strategy

**Status**: Selected

**Options Considered:**
- **`bundle-template.mjs` prepare script**: Copies `packages/template/` into `packages/cli/dist/template/` at build time. Template drift is structurally impossible because there is no publish path that bypasses the prepare step. (Pros: zero network deps at scaffold time, deterministic, auditable file list | Cons: dist/template/ increases package size)
- **npm package reference**: The CLI fetches the template by installing `starterkit-web` from npm at scaffold time. (Pros: smaller CLI package | Cons: requires network at scaffold time, introduces version sync problem, adds complexity to offline or firewalled environments)
- **git clone at scaffold time**: The CLI clones the repo on demand. (Pros: always latest | Cons: requires git and network, slow, exposes users to partial clone failures)

**Selected Option**: `bundle-template.mjs` prepare script

**Reasoning**: The PRD's highest-risk failure mode is template/CLI divergence. Bundling at build time makes this structurally impossible — there is no publish path that does not run `bundle-template.mjs` first. Scaffold-time operation requires zero network access beyond `pnpm install`.

**Impact**: `packages/cli/dist/template/` is in `.gitignore` (generated artifact). `bundle-template.mjs` is a build-time script only. The `files` array in `packages/cli/package.json` includes `dist/` to ensure the bundled template ships with the package.

**Assumptions**: `packages/template/` is the canonical source of truth. `bundle-template.mjs` must be re-run any time the template changes before the CLI is published.

---

### Decision 5: Argument Parsing

**Status**: Selected

**Options Considered:**
- **`node:util` `parseArgs`**: Built into Node 18.3+ (well within the Node 22 requirement). No install, no runtime dependency. (Pros: zero deps, stable, sufficient for the CLI's flag surface | Cons: no sub-command routing built-in — must be implemented manually)
- **`yargs`**: Full-featured arg parser with sub-command support, help generation, and type coercion. (Pros: rich features | Cons: adds a runtime dependency, conflicts with the zero-dep design goal)
- **`commander`**: Popular CLI framework. (Pros: clean API, TypeScript support | Cons: runtime dependency)

**Selected Option**: `node:util` `parseArgs`

**Reasoning**: The PRD explicitly prohibits runtime npm dependencies. The CLI's argument surface is small: one positional argument, three flags (`--skip-install`, `--skip-git`, `--force`), and sub-command dispatch to four commands. `parseArgs` handles all of this with straightforward null-guarded array reads.

**Impact**: `src/index.ts` implements manual sub-command routing. The `argv._[0]` positional must be null-guarded due to `noUncheckedIndexedAccess` in tsconfig.

**Assumptions**: The CLI's argument surface does not grow to the point where `parseArgs` becomes a maintenance burden. If it does, `yargs` can be introduced as a breaking change in a major version.

---

### Decision 6: Test Runner

**Status**: Selected

**Options Considered:**
- **`node:test` + `tsx`**: Built-in Node test runner (available since Node 18, stable in Node 22). `tsx` used as a dev-only dependency to execute TypeScript test files without a compilation step. (Pros: no runtime dep impact, fastest feedback loop, no config | Cons: `tsx` is a dev dependency)
- **Vitest**: Modern test runner with watch mode and snapshot testing. (Pros: excellent DX, fast, TypeScript native | Cons: dev dependency; heavier than `node:test` for unit tests)
- **Jest**: Battle-tested runner. (Pros: mature ecosystem | Cons: CJS-first, requires ESM config, heavier)

**Selected Option**: `node:test` + `tsx`

**Reasoning**: Keeps the dev dependency surface minimal and consistent with the zero-runtime-dep philosophy. `node:test` is stable in Node 22 and sufficient for unit + integration tests. `tsx` is the only dev dependency required for test execution, and it does not affect the published package.

**Impact**: Test scripts use `tsx --test src/**/*.test.ts`. `tsx` is added to `packages/cli/devDependencies`. No test configuration file is required.

**Assumptions**: Test assertions remain straightforward. Complex test scenarios (snapshot testing, parallel workers) are handled with `node:assert` + test structure, not framework features.

---

### Decision 7: Token Substitution Strategy

**Status**: Selected

**Options Considered:**
- **Explicit `substitutionFiles` list in `template.config.json`**: An audited, committed list of exactly which files receive substitution. Adding a new file requires an explicit manifest edit and code review. (Pros: minimal blast radius, auditable, compile-time verifiable | Cons: requires manual audit when template evolves)
- **Glob scanning**: Scan all template files for occurrences of the token. (Pros: automatic, no manifest to maintain | Cons: may produce unexpected substitutions in binary files, comments, or lock files; blast radius is unbounded)
- **AST-based substitution**: Parse `package.json` as JSON, replace the `name` field programmatically. (Pros: precise | Cons: requires separate handling per file type; README.md cannot be AST-parsed)

**Selected Option**: Explicit `substitutionFiles` list

**Reasoning**: The token audit (Appendix A of the PRD) has already verified the exhaustive list: only `package.json` and `README.md` contain the `starterkit-web` token. An explicit list with a prepare-time validation step makes future changes auditable through code review. Glob scanning would be harder to reason about as the template grows.

**Impact**: `template.config.json` is the source of truth. `bundle-template.mjs` validates that all files in `substitutionFiles` exist in the template before copying. `substitute-tokens.ts` reads the manifest at runtime.

**Assumptions**: The exhaustive token audit (Appendix A of the PRD) is correct and complete. If a new template file requires substitution, the `template.config.json` manifest must be updated explicitly.

---

## Dependencies & Constraints

### Phase Dependencies

```
Phase 1 (Monorepo Restructure)
    |
    |--> Phase 2 (Core `create` Command)
              |
              |--> Phase 3 (Operational Commands)
              |
              |--> Phase 4 (Distribution & CI/CD)
```

- **Phase 1 is a hard prerequisite for all other phases.** The CLI package cannot be built until `packages/template/` exists and `bundle-template.mjs` can copy from it.
- **Phase 2 must complete before Phase 3**, because `doctor` and `upgrade` depend on the `.starterkit` file written by the `create` command's `write-metadata.ts` step.
- **Phase 3 and Phase 4 are parallelizable** after Phase 2 completes. Phase 4 CI/CD can be set up while Phase 3 commands are implemented.
- **Phase 4 depends on Phase 2 being production-ready** (smoke test passes). Phase 3 completion is not a strict prerequisite for publishing, but operational commands should ideally ship in v1.0.

### Critical Path Items

- **Template path resolution** (`new URL('../template', import.meta.url).pathname`) must be verified to work correctly after tsup bundling before any other phase 2 work. This is the highest technical risk.
- **`lint-staged` glob update** (Phase 1, step 8) must happen before the first commit post-migration, or the pre-commit hook will fail to lint `packages/**` files.
- **npm name availability** (`create-starterkit-web`) must be verified before Phase 4 begins. If taken, a scoped name decision affects the `bin` field, install instructions in success output, and all CI publish steps.

### Potential Conflicts

| Conflict | Description | Mitigation |
|----------|-------------|------------|
| pnpm hoisting | After moving the app to `packages/template/`, pnpm may hoist dependencies differently, breaking imports | Run `pnpm dev` immediately after migration (Phase 1 step 13); add `.npmrc` with `shamefully-hoist=false` if needed |
| `tsconfig.json` `~/` path alias | The `paths: { "~/*": ["./app/*"] }` alias in the root `tsconfig.json` must move into `packages/template/tsconfig.json` with a relative path | Step 6 in Phase 1 explicitly covers this; verify with `pnpm type-check` after move |
| `lint-staged` scope | The root `package.json` `lint-staged` config currently matches all files; after migration it must scope to `packages/**` | Updated in Phase 1 step 8 before first post-migration commit |
| `noUncheckedIndexedAccess` + argv | `argv._[0]` will be typed as `string \| undefined` due to strict tsconfig; unchecked access causes a type error | Always null-guard array reads in `src/index.ts`; covered in Decision 5 |

### Parallel Work Opportunities

- Within Phase 2, **Layer 1 utilities** (`version.ts`, `printer.ts`, `registry.ts`) and **Layer 2 pipeline steps** have no inter-dependencies and can be developed in parallel.
- Phase 4 CI workflow authoring can begin in parallel with Phase 3 implementation once the Phase 2 build pipeline is stable.

---

## Pre-Execution Checklist

Complete these verifications before starting any implementation:

- [ ] Verify `create-starterkit-web` name is available on npm: `npm view create-starterkit-web` (if the package exists, decide on a scoped name before Phase 4)
- [ ] Confirm `.starterkit` schema: `version`, `date`, `template`, `nodeVersion`, `pnpmVersion` — all six fields must be in sync with what `write-metadata.ts` writes and what `doctor`/`upgrade` reads
- [ ] Add `tsx` to `packages/cli/devDependencies` in Phase 1 skeleton step (step 10) so tests can run from Phase 2 onward
- [ ] Confirm `NPM_TOKEN` GitHub secret exists before Phase 4 publish workflow is enabled
- [ ] Verify `.env.example` exists in the current `app/` root before migration (it must be present for `generate-env.ts` to copy from `dist/template/.env.example`)

---

## Development Phases

---

### Phase 1: Monorepo Restructure

**Objective**: Convert the repo to a pnpm workspace monorepo with the existing app at `packages/template/` and a CLI skeleton at `packages/cli/`, without breaking the existing app's dev server or build pipeline.

**Scope**: File system reorganization, workspace configuration, build wiring, tooling updates. No CLI logic is implemented in this phase.

**Current state note**: `packages/template/` directory already exists at the repo root but is empty. The app files are at the repo root under `app/`, alongside `react-router.config.ts`, `vite.config.ts`, `tsconfig.json`, etc.

#### File Execution Order

Execute steps in this exact order to avoid intermediate broken states:

**Step 1 — Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

Place at repo root.

---

**Step 2 — `git mv` app files into `packages/template/`**

Preserves git history for all moved files. Move the following:

```bash
git mv app packages/template/app
git mv public packages/template/public
git mv react-router.config.ts packages/template/react-router.config.ts
git mv vite.config.ts packages/template/vite.config.ts
git mv components.json packages/template/components.json
git mv env.d.ts packages/template/env.d.ts
git mv eslint.config.mjs packages/template/eslint.config.mjs
# Also move: .env.example, .husky/ (see step 8), any other root config files
# Do NOT move: package.json, tsconfig.json, pnpm-lock.yaml, .gitignore
# (these are updated in place or replaced)
```

---

**Step 3 — Update `packages/template/package.json`**

Create `packages/template/package.json` from the current root `package.json`:

- Change `"name"` to `"starterkit-web"` (remove the `@starterkit/web` scoped name — this is the token that gets substituted at scaffold time)
- Keep all `dependencies` and `devDependencies` unchanged
- Remove `lint-staged` config (moves to root)
- Remove `engines` field (enforced by CLI, not template)
- Remove `packageManager` field (lives at workspace root)

---

**Step 4 — Create `packages/template/template.config.json`**

This is the substitution manifest consumed by both `bundle-template.mjs` and `substitute-tokens.ts`:

```json
{
  "substitutionFiles": [
    "package.json",
    "README.md"
  ],
  "exclude": [
    "node_modules",
    ".git",
    "pnpm-lock.yaml",
    "template.config.json"
  ]
}
```

The `substitutionFiles` list is the exhaustive, audited set from PRD Appendix A. Token replacement replaces the literal string `"starterkit-web"` with the project name in these files only.

---

**Step 5 — Update root `package.json`**

The root `package.json` becomes the workspace root. It should:

- Set `"name": "starterkit-web-monorepo"` (or keep `"private": true` with no publish)
- Remove all `dependencies` and `devDependencies` (they live in each package)
- Add workspace proxy scripts for convenience:
  ```json
  {
    "scripts": {
      "dev": "pnpm --filter starterkit-web dev",
      "build": "pnpm --filter starterkit-web build",
      "type-check": "pnpm --filter starterkit-web type-check",
      "build:cli": "pnpm --filter create-starterkit-web build"
    }
  }
  ```
- Keep `"packageManager": "pnpm@10.13.1+sha512..."` at root
- Keep `"engines"` at root
- Add `lint-staged` config scoped to `packages/**`:
  ```json
  {
    "lint-staged": {
      "packages/**/*.{ts,tsx,js,jsx,mjs,cjs}": ["eslint --fix", "prettier --write"],
      "packages/**/*.{json,css,md,yaml,yml}": ["prettier --write"]
    }
  }
  ```

---

**Step 6 — Move tsconfig into `packages/template/`; update `~/` alias**

Create `packages/template/tsconfig.json` from the current root `tsconfig.json`:

- Update the `paths` alias from `"~/*": ["./app/*"]` to `"~/*": ["./app/*"]` (relative to `packages/template/` — path remains the same relative to the file's location)
- Update `rootDirs` from `[".", "./.react-router/types"]` to `[".", "./.react-router/types"]` (also unchanged — relative)
- Update `include` to `["**/*", "**/.server/**/*", "**/.client/**/*", ".react-router/types/**/*"]` (unchanged)

The key change is that this tsconfig no longer lives at the repo root. Tooling that looks for `tsconfig.json` at the root will now find the root references tsconfig (step 7).

---

**Step 7 — Create root `tsconfig.json` with project references**

```json
{
  "files": [],
  "references": [
    { "path": "packages/template" },
    { "path": "packages/cli" }
  ]
}
```

This is a composite tsconfig references file. It enables `tsc --build` from the root for all packages.

---

**Step 8 — Update `.husky/pre-commit` and root `lint-staged` globs**

The `lint-staged` config was updated in step 5. Verify `.husky/pre-commit` still invokes `lint-staged` correctly (the hook itself should not change — it calls `pnpm exec lint-staged` which reads from the root `package.json`).

**Critical**: This step must be completed before the first post-migration commit, or the pre-commit hook will fail to stage-check `packages/**` files.

---

**Step 9 — Update `.gitignore`**

Add the following to the root `.gitignore`:

```
packages/cli/dist/
```

The CLI's `dist/` directory is a generated artifact. `packages/template/node_modules/` is already covered by the existing `node_modules/` entry.

---

**Step 10 — Create `packages/cli/` skeleton**

Create the following files with minimal content:

**`packages/cli/package.json`**:
```json
{
  "name": "create-starterkit-web",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "create-starterkit-web": "./dist/index.js"
  },
  "files": ["dist/"],
  "scripts": {
    "build": "node scripts/bundle-template.mjs && tsup",
    "type-check": "tsc --noEmit",
    "test": "tsx --test src/**/*.test.ts test/**/*.test.ts"
  },
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.8.0"
  }
}
```

**`packages/cli/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "outDir": "dist"
  },
  "include": ["src/**/*", "scripts/**/*"]
}
```

**`packages/cli/tsup.config.ts`**:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  clean: false, // dist/template/ must not be deleted by tsup
  sourcemap: true,
});
```

Note: `clean: false` is critical. tsup's default `clean: true` deletes the entire `dist/` directory before building, which would delete the `dist/template/` folder populated by `bundle-template.mjs`. The prepare script runs `bundle-template.mjs` first, then `tsup` — but `clean: true` in tsup would wipe the template. Set `clean: false` and rely on `bundle-template.mjs` to manage `dist/template/` freshness.

**`packages/cli/src/index.ts`** (stub entry point):
```ts
// CLI entry point — implementation in Phase 2
console.log('create-starterkit-web');
```

---

**Step 11 — Create `packages/cli/scripts/bundle-template.mjs`**

This script copies `packages/template/` into `packages/cli/dist/template/`. Key behaviors:

- Read `packages/template/template.config.json` for the `exclude` list
- Recursively copy all files not matching the `exclude` list
- Explicitly include dotfiles: `.gitignore`, `.env.example`, `.claude/`
  - Node's `fs.cp` with `recursive: true` includes dotfiles by default, but validate this
- Validate that all files listed in `substitutionFiles` exist in the source template before copying (fail the build if any are missing)
- Output a summary of files copied to stdout for build-time auditability

The script path (`scripts/bundle-template.mjs`) and the tsup config `clean: false` must be kept in sync — if `bundle-template.mjs` is ever moved, update the `build` script in `package.json`.

---

**Step 12 — Wire `"prepare"` script**

The `packages/cli/package.json` `build` script from step 10 already runs `node scripts/bundle-template.mjs && tsup`. Verify:

- `bundle-template.mjs` runs before `tsup`
- `tsup` does not clean `dist/template/` (covered by `clean: false`)
- The prepare script also validates `substitutionFiles` exist

---

**Step 13 — `pnpm install` and smoke test**

```bash
pnpm install
pnpm --filter starterkit-web dev  # must boot on port 5173
pnpm --filter create-starterkit-web build  # must complete without error
ls packages/cli/dist/template/  # must show .gitignore, .env.example
ls packages/cli/dist/template/node_modules  # must not exist
```

**Deliverables:**

- `pnpm-workspace.yaml` at repo root
- App running at `packages/template/` — identical behavior to pre-migration
- `packages/cli/` skeleton with build pipeline wired
- `packages/cli/dist/template/` populated from `bundle-template.mjs`
- Root `tsconfig.json` with project references
- `lint-staged` scoped to `packages/**`
- `.gitignore` excluding `packages/cli/dist/`

**Testing Strategy:**

- **Test Types**: Manual smoke tests only in this phase (no unit test infrastructure yet)
- **Test Coverage**: App boot, CLI build, template bundle content
- **Acceptance Criteria**:
  - `pnpm --filter starterkit-web dev` runs on port 5173 with no errors
  - `pnpm --filter create-starterkit-web build` exits 0
  - `dist/template/` contains `.gitignore` and `.env.example`
  - `dist/template/node_modules/` does not exist
  - `dist/template/pnpm-lock.yaml` does not exist
  - `pnpm type-check` exits 0 from repo root
  - Pre-commit hook runs without error on a test staged file in `packages/`

**Testing Todos:**

- [ ] Manually verify `dist/template/` file list against expected inclusions/exclusions
- [ ] Run `pnpm type-check` — verify no path alias breakage from tsconfig move
- [ ] Stage a file in `packages/template/` and verify `lint-staged` picks it up
- [ ] Verify `.env.example` is present in the template (required for Phase 2 `generate-env.ts`)

**Blockers/Dependencies:**

- None. This phase has no prerequisites.

---

### Phase 2: Core `create` Command

**Objective**: Implement the full 11-step scaffold pipeline so that `node packages/cli/dist/index.js my-app` produces a working project with substituted tokens, `.env`, `.starterkit`, installed dependencies, and an initial git commit.

**Scope**: All pipeline step modules, the `create` command orchestrator, the CLI entry point with argument dispatch, and unit + integration tests.

#### Layer 1 — Pure Utilities (no inter-dependencies; can be developed in parallel)

---

**`src/lib/version.ts`**

Semver comparison without the `semver` package.

- `parseVersion(version: string): [number, number, number]` — parses `"22.14.0"` into `[22, 14, 0]`; throws on malformed input
- `satisfiesMinimum(actual: string, minimum: string): boolean` — compares two version strings component by component; returns true if `actual >= minimum`

Handles common version string formats: `"v22.14.0"` (strip leading `v`), `"10.6.0"`, pnpm version output with trailing newline.

---

**`src/lib/printer.ts`**

Terminal output utilities. All progress output goes to `stderr`; only the final success message goes to `stdout`.

- `step(label: string, status: 'ok' | 'fail' | 'skip', detail?: string): void` — formats a step line to stderr
- `success(projectDir: string, envVars: string[]): void` — prints final success block to stdout with `cd` instructions and `.env` reminder
- `error(message: string): void` — prints error to stderr
- ANSI helpers inline (no `chalk`): green `\x1b[32m`, red `\x1b[31m`, reset `\x1b[0m`, dim `\x1b[2m`
- Must be TTY-safe: detect `process.stderr.isTTY` before emitting ANSI codes; fall back to plain text in non-TTY environments (CI pipes)

---

**`src/lib/registry.ts`**

npm registry fetch for `upgrade` and `list` commands.

- `fetchVersions(packageName: string): Promise<RegistryVersion[]>` — fetches `https://registry.npmjs.org/<packageName>` via `node:https`; returns version list with `version`, `date`, `isLatest` fields
- Timeout: 5 seconds; reject with descriptive error on timeout, 5xx, or DNS failure
- Parse JSON response; validate shape before returning (no `as` cast)

Type definition:
```ts
type RegistryVersion = {
  version: string;
  date: string;
  isLatest: boolean;
};
```

---

#### Layer 2 — Pipeline Steps

Each step is an independently testable module that takes explicit inputs and returns a result or throws a typed error. Steps do not import each other.

---

**`src/steps/validate-name.ts`**

```ts
function validateName(name: string): void // throws ScaffoldError with exit code 1
```

- Pattern: `/^[a-z0-9][a-z0-9._-]*$/`
- Reject: empty string, `"."`, `".."`, any string containing `/` or `\`, strings starting with `.` or `-`
- Reject: path traversal patterns (`../`, `./` as prefix)
- Max length: 214 characters (npm package name limit)

---

**`src/steps/check-prereqs.ts`**

```ts
function checkNodeVersion(): void // throws ScaffoldError with exit code 2
function checkPnpmVersion(): void // throws ScaffoldError with exit code 2
```

- Node: read from `process.versions.node`; compare against `"22.0.0"` via `version.ts`
- pnpm: `spawnSync('pnpm', ['--version'], { encoding: 'utf8' })`; if `ENOENT`, print corepack guidance; compare output against `"10.0.0"`
- On failure, print actionable install guidance before throwing

---

**`src/steps/copy-template.ts`**

```ts
async function copyTemplate(destDir: string, force: boolean): Promise<void>
// throws ScaffoldError with exit code 3 (dir collision) or exit code 4 (I/O error)
```

- Template source: `new URL('../../dist/template', import.meta.url).pathname`
  - Note: relative to `src/steps/copy-template.ts` at build time; tsup bundles to `dist/index.js`, so the path becomes `new URL('../template', import.meta.url).pathname` in the bundle. **Verify this path in the smoke test — it is the highest-risk item.**
- Check destination: if `destDir` exists and is non-empty, throw with exit code 3 (unless `--force`)
- Copy with `fs.promises.cp(src, destDir, { recursive: true })` — includes dotfiles
- Throw with exit code 4 on any I/O error

---

**`src/steps/substitute-tokens.ts`**

```ts
async function substituteTokens(projectDir: string, projectName: string): Promise<void>
// throws ScaffoldError with exit code 4
```

- Read `substitutionFiles` from the `template.config.json` that was placed at the project root during copy (or read it from the bundled template before copy; prefer reading from the destination after copy)
- For each file in `substitutionFiles`: read full content, replace all occurrences of `"starterkit-web"` with `projectName`, write back
- Whole-file string replace: `content.replaceAll('starterkit-web', projectName)`
- No regex — literal string replacement only

---

**`src/steps/generate-env.ts`**

```ts
async function generateEnv(projectDir: string): Promise<void>
// throws ScaffoldError with exit code 4
```

- Copy `<projectDir>/.env.example` to `<projectDir>/.env`
- Do not modify content
- If `.env.example` does not exist, warn to stderr and skip (do not fail — `.env.example` may not exist in all template configurations)

---

**`src/steps/write-metadata.ts`**

```ts
async function writeMetadata(projectDir: string, cliVersion: string): Promise<void>
// throws ScaffoldError with exit code 4
```

Writes `<projectDir>/.starterkit`:

```json
{
  "version": "<cli-version>",
  "date": "<ISO-8601>",
  "template": "starterkit-web",
  "nodeVersion": "<process.versions.node>",
  "pnpmVersion": "<pnpm-version-from-spawnSync>"
}
```

All six fields must match the schema agreed in the pre-execution checklist. The `pnpmVersion` requires running `pnpm --version` (same as `check-prereqs.ts` — consider caching the result via a shared context object passed through the pipeline).

---

**`src/steps/run-install.ts`**

```ts
async function runInstall(projectDir: string): Promise<void>
// throws ScaffoldError with exit code 5
```

- `spawn('pnpm', ['install'], { cwd: projectDir, stdio: ['ignore', 'inherit', 'inherit'] })`
- Stream stdout/stderr directly to the terminal (not buffered)
- Throw with exit code 5 if spawn exits with non-zero code

---

**`src/steps/git-init.ts`**

```ts
async function gitInit(projectDir: string, cliVersion: string): Promise<void>
// throws ScaffoldError with exit code 4 (non-fatal if git not available — warn and skip)
```

- `spawnSync('git', ['init', projectDir])`
- `spawnSync('git', ['-C', projectDir, 'add', '-A'])`
- `spawnSync('git', ['-C', projectDir, 'commit', '-m', `chore: scaffold from create-starterkit-web v${cliVersion}`])`
- If `git` is not found (`ENOENT`), warn to stderr and skip (do not fail the scaffold)

---

#### Layer 3 — Command Orchestrator and Entry Point

---

**`src/commands/create.ts`**

Orchestrates the 11-step pipeline in sequence. Takes a typed options object:

```ts
type CreateOptions = {
  projectName: string;
  skipInstall: boolean;
  skipGit: boolean;
  force: boolean;
};
```

Pipeline execution:

1. `validateName(projectName)` — exit 1 on error
2. Check destination directory — exit 3 on collision (unless `--force`)
3. `checkNodeVersion()` — exit 2 on error
4. `checkPnpmVersion()` — exit 2 on error
5. `copyTemplate(destDir, force)` — exit 4 on error
6. `substituteTokens(destDir, projectName)` — exit 4 on error
7. `generateEnv(destDir)` — warn on missing `.env.example`; never exit
8. `writeMetadata(destDir, CLI_VERSION)` — exit 4 on error
9. `runInstall(destDir)` — skip if `--skip-install`; exit 5 on error
10. `gitInit(destDir, CLI_VERSION)` — skip if `--skip-git`; warn if git unavailable
11. `success(absProjectDir, ['.env vars reminder'])` — print to stdout

All thrown `ScaffoldError` instances carry an `exitCode` field. The orchestrator catches errors and calls `process.exit(error.exitCode)`.

---

**`src/index.ts`**

Entry point with `parseArgs` dispatch:

```ts
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'skip-install': { type: 'boolean', default: false },
    'skip-git': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    version: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: true,
});
```

Sub-command routing:

- `positionals[0]` is `undefined` or a project name → `create` command
- `positionals[0] === 'create'` → `positionals[1]` is the project name
- `positionals[0] === 'doctor'` → `doctor` command (stubbed in Phase 2; implemented in Phase 3)
- `positionals[0] === 'upgrade'` → `upgrade` command (stubbed)
- `positionals[0] === 'list'` → `list` command (stubbed)

Always null-guard: `const command = positionals[0] ?? undefined`. Do not access `positionals[0]` without a null check — `noUncheckedIndexedAccess` will produce a type error.

---

#### Tests

**Unit tests** (run via `tsx --test`):

**`src/steps/validate-name.test.ts`** — ~10 cases:
- [ ] Empty string → throws exit 1
- [ ] `"."` → throws exit 1
- [ ] `".."` → throws exit 1
- [ ] `"../foo"` → throws exit 1 (path traversal)
- [ ] `"./foo"` → throws exit 1
- [ ] `"/absolute/path"` → throws exit 1
- [ ] `"foo bar"` (space) → throws exit 1
- [ ] `"UPPERCASE"` → throws exit 1
- [ ] `"my-app"` → passes
- [ ] `"my.app.v2"` → passes
- [ ] String of 215 characters → throws exit 1

**`src/lib/version.test.ts`** — 8 edge cases:
- [ ] `satisfiesMinimum("22.14.0", "22.0.0")` → true
- [ ] `satisfiesMinimum("21.14.0", "22.0.0")` → false
- [ ] `satisfiesMinimum("22.0.0", "22.0.0")` → true (equal)
- [ ] `satisfiesMinimum("10.13.0", "10.0.0")` → true
- [ ] `parseVersion("v22.14.0")` → `[22, 14, 0]` (strips `v`)
- [ ] `parseVersion("22.14.0\n")` → `[22, 14, 0]` (strips newline)
- [ ] `parseVersion("not-a-version")` → throws
- [ ] `satisfiesMinimum("9.5.0", "10.0.0")` → false

**`src/steps/substitute-tokens.test.ts`**:
- [ ] Create fixture `package.json` with `"name": "starterkit-web"` in a temp dir; verify replacement
- [ ] Verify `README.md` content is replaced
- [ ] Verify a file NOT in `substitutionFiles` (e.g., `vite.config.ts`) is unchanged after substitution runs
- [ ] Verify replacement is global (all occurrences), not just first

**`src/steps/check-prereqs.test.ts`**:
- [ ] Mock `process.versions.node = "21.0.0"` → throws exit 2
- [ ] Mock `process.versions.node = "22.0.0"` → passes
- [ ] Mock `spawnSync` returning pnpm `"9.0.0"` → throws exit 2
- [ ] Mock `spawnSync` returning `ENOENT` → throws exit 2 with corepack message

**Integration test** — `test/integration/create.test.ts`**:
- [ ] Run full pipeline into `os.tmpdir()/<random>/my-test-app` with `--skip-git` and `--skip-install`
- [ ] Assert `my-test-app/package.json` contains `"name": "my-test-app"` (not `"starterkit-web"`)
- [ ] Assert `my-test-app/.starterkit` is valid JSON with all 6 required fields
- [ ] Assert `my-test-app/.env` exists
- [ ] Assert `my-test-app/node_modules/` does not exist (since `--skip-install`)
- [ ] Cleanup temp directory after test

**Deliverables:**

- All 8 pipeline step modules implemented
- `src/commands/create.ts` orchestrator
- `src/index.ts` with `parseArgs` dispatch
- Unit tests for `validate-name`, `version`, `substitute-tokens`, `check-prereqs`
- Integration test for full create pipeline (with `--skip-install --skip-git`)

**Testing Strategy:**

- **Test Types**: Unit (steps/lib), integration (full pipeline into tmpdir)
- **Test Coverage**: All 11 pipeline steps exercised; error paths for each exit code
- **Test Scope**: Each step tested in isolation; integration test validates end-to-end token substitution and file structure
- **Acceptance Criteria**: All unit tests pass; integration test produces a directory with correct `package.json` name and valid `.starterkit` JSON

**Testing Todos:**

- [ ] Set up `tsx --test` script in `packages/cli/package.json` (step 10 of Phase 1 covers this)
- [ ] Write fixture files for `substitute-tokens` test in `test/fixtures/`
- [ ] Verify integration test cleans up temp directory even on failure (use `finally` block)
- [ ] Test TTY vs non-TTY output from `printer.ts` (set `process.stderr.isTTY = false` in test)

**End-to-end Verification (manual, before Phase 3):**

```bash
pnpm --filter create-starterkit-web build
node packages/cli/dist/index.js my-test-app --skip-git
cd my-test-app
cat package.json          # "name" must be "my-test-app"
cat .starterkit           # must be valid JSON with 6 fields
cat .env                  # must exist (copied from .env.example)
pnpm install && pnpm dev  # must boot on port 5173
cd .. && rm -rf my-test-app
```

**Blockers/Dependencies:**

- Phase 1 must be complete: `packages/cli/dist/template/` must be populated before `copy-template.ts` can be tested
- Template path resolution (`new URL('../template', import.meta.url).pathname`) must be verified correct in the tsup bundle before integration tests can pass

---

### Phase 3: Operational Commands

**Objective**: Implement `doctor`, `upgrade`, and `list` commands. Replace the stubs in `src/index.ts` with real implementations.

**Scope**: Three command modules and their supporting logic. `registry.ts` from Phase 2 Layer 1 is already implemented and reused here.

---

**`src/commands/doctor.ts`**

Runs 6 health checks on the current working directory (assumed to be a scaffolded project):

| Check | Pass condition | `--fix` action |
|-------|---------------|----------------|
| Node version | >= 22.0.0 via `process.versions.node` | Print guidance only (cannot auto-fix) |
| pnpm version | >= 10.0.0 via `spawnSync` | Print `corepack enable` guidance |
| `node_modules/` | Directory exists at CWD | Run `pnpm install` at CWD |
| `.env` file | File exists at CWD | Copy from `.env.example` |
| Git repo | `.git/` directory exists at CWD | Run `git init` at CWD |
| `.starterkit` file | File exists and parses as valid JSON | Warn only (cannot auto-fix) |

Output format matches PRD §4.3 exactly. Each check line: label, value/status, pass/MISSING indicator.

`--fix` behavior:
1. Run all checks, collect failing ones
2. For each auto-fixable failure: apply fix silently (stream output for pnpm install)
3. Re-run all checks
4. Print final state
5. Exit 0 if all pass; exit 1 if unfixable issues remain

---

**`src/commands/upgrade.ts`**

```ts
async function upgradeCommand(): Promise<void>
```

1. Read `.starterkit` from CWD; parse `version` field
2. Call `registry.ts` `fetchVersions('create-starterkit-web')`
3. Filter versions newer than scaffold version using `version.ts` `satisfiesMinimum`
4. Print output matching PRD §4.4 format
5. If no newer versions: print "You are on the latest scaffold version."

---

**`src/commands/list.ts`**

```ts
async function listCommand(): Promise<void>
```

1. Call `registry.ts` `fetchVersions('create-starterkit-web')`
2. Print all versions in table format matching PRD §4.5
3. Mark `latest` tag

---

**Update `src/index.ts`**

Replace the stubs with real imports for `doctor`, `upgrade`, and `list`. No changes to the argument parsing logic.

---

**Tests:**

**`src/commands/doctor.test.ts`**:
- [ ] Each of the 6 checks passes when conditions are met (set up appropriate tmpdir fixtures)
- [ ] Each of the 6 checks fails correctly when conditions are not met
- [ ] `--fix` runs `pnpm install` when `node_modules/` is missing (mock `spawnSync`)
- [ ] `--fix` copies `.env.example` to `.env` when `.env` is missing
- [ ] Exit code is 0 when all pass; 1 when unfixable issues remain after `--fix`

**`src/commands/upgrade.test.ts`** and **`src/commands/list.test.ts`**:
- [ ] Mock `fetchVersions` to return a known version list; verify output format
- [ ] Mock `fetchVersions` to return 503 (network error); verify graceful error message and non-zero exit
- [ ] Mock `fetchVersions` to return malformed JSON; verify graceful parse error handling
- [ ] Mock DNS failure (`ENOTFOUND`); verify timeout and graceful error

**Deliverables:**

- `src/commands/doctor.ts` with 6 checks and `--fix` behavior
- `src/commands/upgrade.ts` reading `.starterkit` and querying registry
- `src/commands/list.ts` querying registry and displaying version table
- Updated `src/index.ts` with real command dispatch
- Tests for all three commands

**Testing Strategy:**

- **Test Types**: Unit with mocked filesystem and mocked `spawnSync`; mocked registry responses for network commands
- **Test Coverage**: Each doctor check individually; all registry error scenarios
- **Test Scope**: Command output format validation; exit code correctness; `--fix` side effects
- **Acceptance Criteria**: All doctor checks individually testable; registry error scenarios produce user-friendly messages; no unhandled promise rejections

**Testing Todos:**

- [ ] Create tmpdir helper for doctor tests that sets up a minimal scaffolded project structure
- [ ] Test registry timeout scenario (mock `node:https` to hang)
- [ ] Test `upgrade` when `.starterkit` is missing from CWD (not a scaffolded project — error message)
- [ ] Verify `list` output is pipe-safe (no ANSI codes when stdout is not a TTY)

**Blockers/Dependencies:**

- Phase 2 complete: `registry.ts` and `version.ts` must exist
- The `.starterkit` schema must be finalized (confirmed in pre-execution checklist) before `upgrade` and `doctor` can read it reliably

---

### Phase 4: Distribution & CI/CD

**Objective**: Automate the build, test, and publish pipeline so that a `git tag cli/v*` push triggers a verified npm publish and GitHub Release.

**Scope**: `packages/cli/package.json` publish configuration, two GitHub Actions workflows, and a smoke test assertion script.

---

**Step 1 — Finalize `packages/cli/package.json` publish fields**

Verify the following fields are present and correct (most were set in Phase 1 step 10):

```json
{
  "name": "create-starterkit-web",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "create-starterkit-web": "./dist/index.js"
  },
  "files": ["dist/"],
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

Run `pnpm pack --dry-run` from `packages/cli/` to verify the file list. `dist/template/` must appear in the output. `src/` must not appear (source files are not published).

---

**Step 2 — `.github/workflows/ci.yml`**

Triggers on pull requests to `main`. Steps:

```yaml
name: CI

on:
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter create-starterkit-web type-check

      - run: pnpm exec eslint packages/cli/src/

      - run: pnpm --filter create-starterkit-web build

      - run: pnpm --filter create-starterkit-web test

      # Smoke test
      - run: node packages/cli/dist/index.js smoke-test --skip-install --skip-git
      - run: |
          test -f smoke-test/.starterkit || exit 1
          node -e "JSON.parse(require('fs').readFileSync('smoke-test/.starterkit','utf8'))" || exit 1
          node -e "const p=JSON.parse(require('fs').readFileSync('smoke-test/package.json','utf8')); if(p.name!=='smoke-test') process.exit(1)" || exit 1
      - run: rm -rf smoke-test
```

---

**Step 3 — `.github/workflows/publish.yml`**

Triggers on tag pushes matching `cli/v*`:

```yaml
name: Publish CLI

on:
  push:
    tags:
      - 'cli/v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # for GitHub Release creation
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm --filter create-starterkit-web build

      - run: pnpm --filter create-starterkit-web test

      # Smoke test (same as CI)
      - run: node packages/cli/dist/index.js smoke-test --skip-install --skip-git
      - run: |
          test -f smoke-test/.starterkit || exit 1
          node -e "JSON.parse(require('fs').readFileSync('smoke-test/.starterkit','utf8'))"
          node -e "const p=JSON.parse(require('fs').readFileSync('smoke-test/package.json','utf8')); if(p.name!=='smoke-test') process.exit(1)"
      - run: rm -rf smoke-test

      # Publish
      - run: pnpm publish --filter create-starterkit-web --no-git-checks --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # GitHub Release
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          generate_release_notes: true
```

---

**Release process (manual trigger steps):**

```bash
# 1. Update version in packages/cli/package.json
# 2. Commit: git commit -m "chore(cli): bump version to 1.0.0"
# 3. Tag:    git tag cli/v1.0.0
# 4. Push:   git push && git push --tags
# CI publish workflow triggers automatically
```

Versioning semantics:
- Template-only changes (no CLI behavior change): patch bump
- New CLI features (`doctor`, `upgrade`, `list`): minor bump
- Breaking scaffold output changes: major bump

---

**Deliverables:**

- `packages/cli/package.json` fully configured for npm publish
- `.github/workflows/ci.yml` — lint, type-check, build, test, smoke test on PR
- `.github/workflows/publish.yml` — same + npm publish + GitHub Release on `cli/v*` tag
- Verified with `pnpm pack --dry-run` that `dist/template/` ships in the package

**Testing Strategy:**

- **Test Types**: CI pipeline acts as integration test; smoke test verifies the built binary end-to-end
- **Test Coverage**: Every publish is preceded by a build, unit tests, and smoke test; no path to publish without passing smoke test
- **Test Scope**: Smoke test checks: directory created, `.starterkit` is valid JSON, `package.json` name is substituted correctly
- **Acceptance Criteria**: `npx create-starterkit-web@1.0.0 my-app` works from npm after publish; smoke test exits 0 in CI

**Testing Todos:**

- [ ] Verify `NPM_TOKEN` secret is set in repository settings before enabling publish workflow
- [ ] Run `npm view create-starterkit-web` to confirm name availability before first publish
- [ ] Manually run `pnpm pack --dry-run` from `packages/cli/` and verify `dist/template/` appears in file list
- [ ] Test the publish workflow on a pre-release tag (`cli/v1.0.0-beta.1`) before the first production publish
- [ ] Verify GitHub Release is created after tag push (check `permissions: contents: write` is set)

**Blockers/Dependencies:**

- Phase 2 must be complete and smoke test must pass locally
- `NPM_TOKEN` GitHub secret must exist before enabling the publish workflow
- npm name availability check (pre-execution checklist) must be confirmed before Phase 4 begins

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Template path resolution fails after tsup bundle | HIGH | Use `new URL('../template', import.meta.url).pathname` from the bundled `dist/index.js` location. Verify with a manual smoke test at the very start of Phase 2 before writing any other step. If the path is wrong, the entire pipeline fails silently. |
| pnpm hoisting changes after workspace migration break template app imports | MEDIUM | Run `pnpm --filter starterkit-web dev` immediately after Phase 1 step 13. If imports break, add `.npmrc` at the workspace root with `shamefully-hoist=false` or `hoist-pattern[]=*`. |
| `bundle-template.mjs` wrong exclusion list causes `node_modules/` or `.git/` to ship in the package | MEDIUM | Assert `dist/template/` file list at end of Phase 1. Run `pnpm pack --dry-run` in Phase 4 and verify the output. Add a CI step that fails if `dist/template/node_modules` exists. |
| npm name `create-starterkit-web` is already taken | MEDIUM | Check with `npm view create-starterkit-web` before Phase 4. If taken, decide on a scoped name (e.g., `@starterkit/create-web`) before any publish configuration is written — the name appears in `bin`, `package.json`, the success output, and all documentation. |
| `noUncheckedIndexedAccess` causes type errors on `argv._[0]` and similar array reads | LOW | Always null-guard positional array access: `const name = positionals[0] ?? undefined`. The tsconfig in `packages/cli/` inherits the same strict flags as the template app — this is a compile-time error, caught by `type-check` in CI. |
| `tsup clean: true` (default) deletes `dist/template/` populated by `bundle-template.mjs` | LOW | The `tsup.config.ts` explicitly sets `clean: false`. This must not be changed. Document this in a comment in `tsup.config.ts`. If tsup is upgraded to a version where `clean` semantics change, re-verify. |
| `lint-staged` runs against stale globs immediately after Phase 1 migration | LOW | Update `lint-staged` config in root `package.json` step 5 before the first commit post-migration. The pre-commit hook will fail on the first staged file in `packages/` if this is missed. |
| `.env.example` is not present in `packages/template/` after migration | LOW | Verify `.env.example` exists at the template root before migrating. It must be present for `generate-env.ts` to copy from `dist/template/.env.example`. Verify its presence in the Phase 1 acceptance criteria check. |

---

## File Manifest Summary

### Files Created in Phase 1

| Path | Description |
|------|-------------|
| `pnpm-workspace.yaml` | Workspace definition |
| `packages/template/package.json` | Template app package (name: `starterkit-web`) |
| `packages/template/template.config.json` | Substitution manifest |
| `packages/template/tsconfig.json` | Template app TypeScript config (moved from root) |
| `packages/template/react-router.config.ts` | Moved from root |
| `packages/template/vite.config.ts` | Moved from root |
| `packages/template/components.json` | Moved from root |
| `packages/template/env.d.ts` | Moved from root |
| `packages/template/eslint.config.mjs` | Moved from root |
| `packages/template/app/` | Moved from root |
| `packages/template/public/` | Moved from root |
| `packages/cli/package.json` | CLI package (name: `create-starterkit-web`) |
| `packages/cli/tsconfig.json` | CLI TypeScript config |
| `packages/cli/tsup.config.ts` | tsup bundle config (`clean: false`) |
| `packages/cli/src/index.ts` | CLI entry point stub |
| `packages/cli/scripts/bundle-template.mjs` | Template copy script |
| `tsconfig.json` (root, replaced) | Project references only |

### Files Created in Phase 2

| Path | Description |
|------|-------------|
| `packages/cli/src/lib/version.ts` | Semver comparison utilities |
| `packages/cli/src/lib/printer.ts` | Terminal output helpers |
| `packages/cli/src/lib/registry.ts` | npm registry fetch |
| `packages/cli/src/steps/validate-name.ts` | Project name validation |
| `packages/cli/src/steps/check-prereqs.ts` | Node + pnpm version checks |
| `packages/cli/src/steps/copy-template.ts` | Template recursive copy |
| `packages/cli/src/steps/substitute-tokens.ts` | Token replacement in manifest files |
| `packages/cli/src/steps/generate-env.ts` | `.env.example` → `.env` copy |
| `packages/cli/src/steps/write-metadata.ts` | `.starterkit` JSON writer |
| `packages/cli/src/steps/run-install.ts` | `pnpm install` spawner |
| `packages/cli/src/steps/git-init.ts` | `git init` + initial commit |
| `packages/cli/src/commands/create.ts` | Pipeline orchestrator |
| `packages/cli/src/index.ts` (replaced) | Full `parseArgs` dispatch |
| `packages/cli/src/steps/validate-name.test.ts` | Unit tests |
| `packages/cli/src/lib/version.test.ts` | Unit tests |
| `packages/cli/src/steps/substitute-tokens.test.ts` | Unit tests |
| `packages/cli/src/steps/check-prereqs.test.ts` | Unit tests |
| `packages/cli/test/integration/create.test.ts` | Integration test |
| `packages/cli/test/fixtures/` | Fixture files for substitution tests |

### Files Created in Phase 3

| Path | Description |
|------|-------------|
| `packages/cli/src/commands/doctor.ts` | Health checks + `--fix` |
| `packages/cli/src/commands/upgrade.ts` | Registry version comparison |
| `packages/cli/src/commands/list.ts` | Registry version listing |
| `packages/cli/src/commands/doctor.test.ts` | Doctor command tests |
| `packages/cli/src/commands/upgrade.test.ts` | Upgrade command tests |
| `packages/cli/src/commands/list.test.ts` | List command tests |

### Files Created in Phase 4

| Path | Description |
|------|-------------|
| `.github/workflows/ci.yml` | PR build + test + smoke test |
| `.github/workflows/publish.yml` | Tag-triggered npm publish + GitHub Release |
