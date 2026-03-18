# @starterkit/web

React Router v7 web application with SSR, Tailwind CSS v4, and shadcn/ui.

## Stack

- **React Router v7** — SSR enabled, framework mode
- **Vite v7** — bundler with `vite-tsconfig-paths`
- **Tailwind CSS v4** — via `@tailwindcss/vite` plugin
- **shadcn/ui** — component library built on Base UI
- **Axios** — API client with auth interceptors
- **Sentry v10** — `@sentry/react` with browser tracing and replay

## Scripts

```bash
pnpm dev           # Dev server with HMR (port 5173)
pnpm build         # Production build to build/
pnpm start         # Serve production build
pnpm type-check    # react-router typegen + tsc --noEmit
```

## Environment variables

Create `apps/web/.env`:

```
VITE_API_BASE_URL=http://localhost:3000
VITE_SENTRY_DSN=
```

## Project structure

```
app/
├── instrument.ts         Sentry initialisation — imported first in root.tsx
├── root.tsx              HTML shell, Layout, global ErrorBoundary
├── entry.client.tsx      Client-side hydration with Sentry error callbacks
├── routes.ts             Route config (React Router framework mode)
├── app.css               Global styles, Tailwind CSS v4 entrypoint
├── lib/
│   ├── api.ts            Axios instance with auth token + 401 interceptors
│   └── utils.ts          cn() helper (clsx + tailwind-merge)
├── components/
│   └── ui/               shadcn/ui components (Button, Card, …)
└── routes/
    ├── api/
    │   └── health.ts     Health check endpoint (GET /api/health)
    └── home.tsx          Home page — fetches /api/health, renders schema demo
```

## Routing

Routes are declared in `app/routes.ts` using the `@react-router/dev/routes` API. SSR is enabled by default in `react-router.config.ts`. Use `loader` for server-side data fetching and `clientLoader` for client-only fetches.

## API client

`app/lib/api.ts` exports a pre-configured Axios instance:

- Base URL from `VITE_API_BASE_URL`
- Attaches `Authorization: Bearer <token>` from `localStorage`
- Redirects to `/login` on 401 responses

## shadcn/ui

Components live in `app/components/ui/`. Add new ones with:

```bash
pnpx shadcn@latest add <component> --defaults
```

The `~/` path alias maps to `app/`, so imports look like `~/components/ui/button`.

## Sentry

`instrument.ts` is imported before anything else in both `root.tsx` and `entry.client.tsx`. Error tracking in `hydrateRoot` uses manual `captureException` calls (instead of `reactErrorHandler`) to stay compatible with `exactOptionalPropertyTypes`.
