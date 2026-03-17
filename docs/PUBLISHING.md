# Publishing source-verse to npm

This guide covers everything needed to publish source-verse so anyone can install it with `npm install -g source-verse`.

---

## Prerequisites

1. **npm account** — Create one at [npmjs.com/signup](https://www.npmjs.com/signup) if you don't have one.
2. **Node.js >= 18** and **pnpm** installed locally.
3. **Two-factor authentication (2FA)** — Strongly recommended for your npm account. Enable it at [npmjs.com settings](https://www.npmjs.com/settings/~/tfa).

---

## One-Time Setup

### 1. Log in to npm

```bash
npm login
```

Follow the prompts to authenticate. This stores a token in `~/.npmrc`.

Verify you're logged in:

```bash
npm whoami
```

### 2. Check package name availability

```bash
npm view source-verse
```

- If you get a 404, the name is available.
- If it's taken, you have two options:
  - **Scoped package**: Change the `name` in `package.json` to `@prakhar30/source-verse` (users install with `npm install -g @prakhar30/source-verse`).
  - **Different name**: Pick an alternative unscoped name.

### 3. Fix the CLI entry point for npm consumers

The current `bin/source-verse.ts` uses `#!/usr/bin/env tsx`, which requires `tsx` at runtime. npm consumers won't have `tsx` installed (it's a devDependency). The `bin` field in `package.json` already points to `./bin/source-verse.js` (the compiled JS output), so the build step handles this — but you need to make sure the compiled file has the correct shebang.

After running `pnpm build`, verify:

```bash
head -1 dist/bin/source-verse.js
```

It should output:

```
#!/usr/bin/env node
```

If it shows `#!/usr/bin/env tsx` instead, you need to either:
- Change the shebang in `bin/source-verse.ts` to `#!/usr/bin/env node` (since tsc preserves shebangs), or
- Add a `prepublishOnly` script that patches the shebang after build.

> **Note**: TypeScript compiles `bin/source-verse.ts` → `dist/bin/source-verse.js`. The `"bin"` field in `package.json` points to `./bin/source-verse.js`. Make sure this path resolves correctly after build — you may need to update it to `./dist/bin/source-verse.js` or copy the built file to `./bin/source-verse.js`.

---

## Publishing Workflow

### Step 1: Make sure everything is clean

```bash
git status              # Should be on main, no uncommitted changes
pnpm install            # Ensure dependencies are up to date
```

### Step 2: Run the full quality check

```bash
pnpm lint               # Lint passes
pnpm test               # All tests pass
pnpm build              # TypeScript compiles without errors
```

All three must pass before publishing. Do not publish with failing tests or lint errors.

### Step 3: Verify the package contents

```bash
npm pack --dry-run
```

This shows exactly which files will be included in the published package. Check that it includes:

- `dist/` — Compiled JavaScript and type declarations
- `bin/` — CLI entry point
- `LICENSE`
- `README.md`
- `package.json` (always included automatically)

It should **not** include:

- `node_modules/`
- `src/` (TypeScript source)
- `.env` or any secrets
- Test files
- `pnpm-lock.yaml`

If unexpected files appear, update the `files` field in `package.json`.

### Step 4: Test the package locally

Before publishing, verify the package works as a global install:

```bash
# Create a tarball
npm pack

# Install it globally from the tarball
npm install -g source-verse-0.1.0.tgz

# Test the CLI
source-verse --version
source-verse --help

# Clean up
npm uninstall -g source-verse
rm source-verse-0.1.0.tgz
```

### Step 5: Bump the version

Choose the appropriate version bump:

```bash
npm version patch       # 0.1.0 → 0.1.1  (bug fixes)
npm version minor       # 0.1.0 → 0.2.0  (new features, backwards compatible)
npm version major       # 0.1.0 → 1.0.0  (breaking changes)
```

This updates `package.json`, creates a git commit, and tags the release. For the first public release, you may want:

```bash
npm version 1.0.0
```

### Step 6: Publish

```bash
npm publish
```

If using a scoped package name (`@prakhar30/source-verse`), publish as public:

```bash
npm publish --access public
```

### Step 7: Verify the publication

```bash
# Check it's on npm
npm view source-verse

# Test installing from npm
npm install -g source-verse
source-verse --version
```

### Step 8: Push the version tag

```bash
git push origin main --tags
```

---

## Subsequent Releases

For every release after the first:

1. Merge all changes to `main`
2. `git checkout main && git pull`
3. `pnpm lint && pnpm test && pnpm build`
4. `npm version <patch|minor|major>`
5. `npm publish`
6. `git push origin main --tags`

---

## Troubleshooting

### "You do not have permission to publish"

You're not logged in, or the package is owned by someone else. Run `npm login` and verify with `npm whoami`.

### "Package name too similar to existing package"

npm blocks names that are confusingly similar to existing packages. Use a scoped name: `@prakhar30/source-verse`.

### "Cannot find module" after global install

The `bin` path in `package.json` doesn't resolve to a valid file. Check that `pnpm build` produces the expected output and that `"bin"` points to the correct path.

### `node-pty` fails to install for users

`node-pty` is a native module that requires a C++ compiler. Users may need:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `build-essential` package (`sudo apt install build-essential`)
- **Windows**: [windows-build-tools](https://github.com/nicedoc/windows-build-tools) or Visual Studio Build Tools

Consider documenting this in the README if users report installation issues.

---

## npm Scripts Reference

| Script | Command | Purpose |
|--------|---------|---------|
| `pnpm build` | `tsc --project tsconfig.json` | Compile TypeScript to `dist/` |
| `pnpm test` | `vitest run` | Run all tests |
| `pnpm lint` | `eslint "src/**/*.ts" "bin/**/*.ts"` | Check for lint errors |
| `pnpm dev` | `tsx src/index.ts` | Run in development mode (no build needed) |

---

## Checklist

Use this checklist before every release:

- [ ] All tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Build succeeds (`pnpm build`)
- [ ] `npm pack --dry-run` shows only expected files
- [ ] Local install works (`npm install -g <tarball>`)
- [ ] `source-verse --version` shows correct version
- [ ] `source-verse --help` output is accurate
- [ ] Version bumped (`npm version <type>`)
- [ ] Published (`npm publish`)
- [ ] Git tag pushed (`git push origin main --tags`)
