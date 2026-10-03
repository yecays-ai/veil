# Companion Phone

Minimal, character-neutral Next.js App Router and TypeScript starter. Mobile-first phone viewport with a home screen and an empty Messages route.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

## Validation

```sh
npm run build
npm run typecheck
npm run lint
npm start
```

The home page links to `/messages`, which links back to `/`.

Character and user defaults live separately in `config/character.ts` and `config/user.ts`. The only placeholder names are `Character` and `User`; generic routes and UI remain independent of identity configuration.

No AI requests, credentials, authentication, database, or external services are required.

## Vercel

Import this repository, select the Next.js framework preset, and use the repository root. Keep the default install and build commands. Use Node.js 24.x. No environment variables are needed.
