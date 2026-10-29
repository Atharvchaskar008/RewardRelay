## What

<!-- One or two sentences: what changes and why. -->

## How it was tested

- [ ] `npm run lint`
- [ ] `npm test` (contracts + web unit tests)
- [ ] `npm run test:integration -w @rewardrelay/web` (Firebase emulators + local chain), if API, SDK or contract behaviour changed
- [ ] `npm run build`

## Checklist

- [ ] Short, plain commit messages (two to four words, no `feat:`-style prefixes)
- [ ] No secrets, `.env` files or private notes in the diff
- [ ] Docs updated (`docs/`, package READMEs) if behaviour or setup changed
- [ ] `docs/CHANGELOG.md` updated under **Unreleased** for user-visible changes
- [ ] Contract changes: `docs/protocol.md` updated, coverage and invariant tests still pass
