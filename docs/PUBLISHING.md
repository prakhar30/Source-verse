# Publishing source-verse

This guide covers publishing source-verse to **npm** and **Homebrew** so users can install via:

```bash
npm install -g source-verse   # npm
brew install source-verse      # Homebrew
```

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

### 3. Verify the CLI entry point

The `bin` field in `package.json` points to `./dist/bin/source-verse.js` and the shebang is already `#!/usr/bin/env node`. After building, verify:

```bash
pnpm build
head -1 dist/bin/source-verse.js
# Should output: #!/usr/bin/env node
```

This is already correct — no action needed.

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
- `bin/` — TypeScript source for CLI entry point (included but not used at runtime; `dist/bin/` is the actual entry point)
- `LICENSE`
- `README.md`
- `package.json` (always included automatically)

It should **not** include:

- `node_modules/`
- `src/` (TypeScript source)
- `.env` or any secrets
- Test files (`*.test.ts`)
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

### tmux not found after install

source-verse requires tmux as a system dependency. Users need to install it separately:

- **macOS**: `brew install tmux`
- **Linux**: `sudo apt install tmux` (Debian/Ubuntu) or `sudo dnf install tmux` (Fedora)

---

## npm Scripts Reference

| Script | Command | Purpose |
|--------|---------|---------|
| `pnpm build` | `tsc --project tsconfig.json` | Compile TypeScript to `dist/` |
| `pnpm test` | `vitest run` | Run all tests |
| `pnpm lint` | `eslint "src/**/*.ts" "bin/**/*.ts"` | Check for lint errors |
| `pnpm dev` | `tsx bin/source-verse.ts` | Run in development mode (no build needed) |

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

---

# Publishing to Homebrew

Homebrew lets macOS (and Linux) users install source-verse without needing Node.js/npm.

## Option A: Homebrew Tap (recommended for getting started)

A tap is your own Homebrew repository. Users install with `brew install prakhar30/tap/source-verse`.

### One-Time Setup

#### 1. Create the tap repo

Create a GitHub repo named `homebrew-tap` under your account (e.g., `prakhar30/homebrew-tap`).

```bash
gh repo create prakhar30/homebrew-tap --public --description "Homebrew tap for source-verse"
```

#### 2. Create the formula

Create a file `Formula/source-verse.rb` in the tap repo:

```ruby
class SourceVerse < Formula
  desc "Run multiple Claude Code sessions in parallel from a single terminal"
  homepage "https://github.com/prakhar30/Source-verse"
  url "https://registry.npmjs.org/source-verse/-/source-verse-1.0.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "node"
  depends_on "tmux"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/source-verse --version")
  end
end
```

#### 3. Get the SHA256

After publishing to npm, get the tarball SHA:

```bash
curl -sL "https://registry.npmjs.org/source-verse/-/source-verse-1.0.0.tgz" | shasum -a 256
```

Replace `REPLACE_WITH_ACTUAL_SHA256` and the version in the `url` with the actual values.

#### 4. Push the formula

```bash
cd homebrew-tap
git add Formula/source-verse.rb
git commit -m "source-verse 1.0.0"
git push
```

#### 5. Test the install

```bash
brew tap prakhar30/tap
brew install source-verse
source-verse --version
```

### Updating for New Releases

After each npm publish:

1. Get the new tarball SHA:
   ```bash
   curl -sL "https://registry.npmjs.org/source-verse/-/source-verse-<VERSION>.tgz" | shasum -a 256
   ```

2. Update `Formula/source-verse.rb` — change `url` version and `sha256`

3. Commit and push to the tap repo

Or automate it with `brew bump-formula-pr`:

```bash
brew bump-formula-pr --url "https://registry.npmjs.org/source-verse/-/source-verse-<VERSION>.tgz" \
  --sha256 "<NEW_SHA>" \
  prakhar30/tap/source-verse
```

## Option B: Homebrew Core (for wider distribution)

To get into the main Homebrew repository (`brew install source-verse` without a tap), the package needs to meet [Homebrew's acceptance criteria](https://docs.brew.sh/Acceptable-Formulae):

- Notable number of users/stars (typically 30+ GitHub stars, 30+ forks, or significant usage)
- Stable releases
- No vendored dependencies that duplicate what Homebrew provides

When ready, submit a PR to [homebrew-core](https://github.com/Homebrew/homebrew-core) with the formula. Use `brew create` to generate a starting template:

```bash
brew create --node "https://registry.npmjs.org/source-verse/-/source-verse-<VERSION>.tgz"
```

---

## Release Checklist (npm + Homebrew)

- [ ] All tests pass (`pnpm test`)
- [ ] Build succeeds (`pnpm build`)
- [ ] `npm version <type>` and `npm publish`
- [ ] `git push origin main --tags`
- [ ] Update Homebrew tap formula with new version and SHA256
- [ ] Verify: `npm install -g source-verse` works
- [ ] Verify: `brew upgrade source-verse` works
