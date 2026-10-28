# @rewardrelay/web

The SAKAR web app: a Next.js (App Router) PWA whose API routes are the backend.

```
src/
├── app/              pages (explore, deal room, wallet, …) and API routes (app/api/*)
├── components/       plain UI building blocks
├── client/
│   ├── sdk/          typed API client, transaction helpers, flows, React hooks
│   ├── wallet.ts     PIN-protected embedded wallet
│   └── config.ts     public (NEXT_PUBLIC_*) configuration
├── server/           server-only modules: env, chain, signer, crypto, route wrapper,
│                     repositories, identity, listings, deals, vault, disputes, cron
└── common/           code used on both sides (listing terms hash)
test/
├── unit/             Vitest, no network
├── emulator/         Firestore rules and stores (Firebase emulators)
└── integration/      API, SDK and end-to-end flows (emulators + a local Hardhat node)
```

## Scripts

| Command                              | Does                                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| `npm run dev`                        | Next.js dev server on :3000                                         |
| `npm run build` / `npm start`        | Production build / server                                           |
| `npm test`                           | Unit tests                                                          |
| `npm run test:integration`           | Integration suite (needs Java 21 and `npm run compile` at the root) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript                                                 |

## Configuration

Copy `.env.example` to `.env`. The server validates its environment on first use and reports every
invalid variable by name. With `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` set, no
Firebase service account is needed.

Firebase rules and indexes (`firestore.rules`, `firestore.indexes.json`, `firebase.json`) live here
because they belong to this app's backend.

See [docs/api.md](../../docs/api.md) for every route and the SDK, and
[docs/deployment.md](../../docs/deployment.md) for Firebase and Vercel setup.
