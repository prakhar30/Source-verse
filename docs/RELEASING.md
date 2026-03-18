# Releasing a new version

Quick reference for shipping updates to npm and Homebrew.

---

## 1. Prepare

```bash
git checkout main && git pull
pnpm install
pnpm build && pnpm lint && pnpm test
```

All must pass before releasing.

## 2. Bump version

```bash
npm version patch   # bug fixes:      1.0.0 → 1.0.1
npm version minor   # new features:   1.0.0 → 1.1.0
npm version major   # breaking changes: 1.0.0 → 2.0.0
```

This updates `package.json`, creates a git commit, and tags it.

## 3. Publish to npm

```bash
npm publish
```

The `prepublishOnly` script runs build+lint+test automatically. You'll be prompted for your 2FA code.

Verify:

```bash
npm view source-verse version
```

## 4. Push to GitHub

```bash
git push origin main --tags
```

## 5. Update Homebrew formula

Get the SHA256 of the new tarball:

```bash
VERSION=$(node -p "require('./package.json').version")
curl -sL "https://registry.npmjs.org/source-verse/-/source-verse-${VERSION}.tgz" | shasum -a 256
```

Edit the formula:

```bash
cd /opt/homebrew/Library/Taps/prakhar30/homebrew-tap
```

Update `Formula/source-verse.rb` — change the version in the `url` and the `sha256`:

```ruby
url "https://registry.npmjs.org/source-verse/-/source-verse-<NEW_VERSION>.tgz"
sha256 "<NEW_SHA256>"
```

Commit and push:

```bash
git add Formula/source-verse.rb
git commit -m "source-verse <NEW_VERSION>"
git push
```

## 6. Verify both

```bash
# npm
npm install -g source-verse
source-verse --version

# Homebrew
brew upgrade source-verse
source-verse --version
```

---

## All-in-one script

Copy-paste version for quick releases:

```bash
# Set the bump type: patch, minor, or major
BUMP=patch

# Bump, publish, push
npm version $BUMP
npm publish
git push origin main --tags

# Update Homebrew
VERSION=$(node -p "require('./package.json').version")
SHA=$(curl -sL "https://registry.npmjs.org/source-verse/-/source-verse-${VERSION}.tgz" | shasum -a 256 | awk '{print $1}')
cd /opt/homebrew/Library/Taps/prakhar30/homebrew-tap
sed -i '' "s|source-verse-.*\.tgz|source-verse-${VERSION}.tgz|" Formula/source-verse.rb
sed -i '' "s|sha256 \".*\"|sha256 \"${SHA}\"|" Formula/source-verse.rb
git add Formula/source-verse.rb
git commit -m "source-verse ${VERSION}"
git push
cd -
```
