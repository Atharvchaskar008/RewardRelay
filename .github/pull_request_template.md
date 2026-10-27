## What

<!-- One or two sentences: what changes and why. -->

## How it was tested

- [ ] `npm run lint`
- [ ] `npm test` (contracts + web unit tests)
- [ ] `npm run test:integration -w @rewardrelay/web` (Firebase emulators + local chain), if API, SDK or contract behaviour changed
- [ ] `npm run build`

## Checklist

- [ ] Conventional Commit messages (`feat:`, `fix:`, `docs:` …)
- [ ] No secrets, `.env` files or private notes in the diff
- [ ] Docs updated (`docs/`, package READMEs) if behaviour or setup changed
- [ ] Contract changes: `docs/protocol.md` updated, coverage and invariant tests still pass
