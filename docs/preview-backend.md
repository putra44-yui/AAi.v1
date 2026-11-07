# AAi Worker Preview Backend

## Isolation contract

The branch Preview runs the same `src/worker.ts` code as production, but as its own Cloudflare Worker Preview.

- Preview API requests are handled by the Preview Worker itself.
- Preview does not use an `AAI_PRODUCTION_API` service binding.
- Preview does not inherit production variables or secrets.
- `GET /api/status` identifies the runtime as `environment: "preview"` and `api_backend: "local-worker"`.
- Preview rate-limit namespaces are separate from production.
- Never put production Supabase credentials in a Preview.

## Required Preview secrets

Create a separate Supabase development branch or test project first. It must have the AAi schema/migrations, but does not need production user data.

Create a local `.env.preview` file (already ignored by Git) containing the Preview-only values:

```dotenv
SUPABASE_URL=https://YOUR_PREVIEW_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_PREVIEW_SERVICE_ROLE_KEY
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
TAVILY_API_KEY=YOUR_TAVILY_KEY
EXA_API_KEY=YOUR_EXA_KEY
```

At least one of `TAVILY_API_KEY` or `EXA_API_KEY` is needed for web search. The OpenRouter model can be selected with `OPENROUTER_MAIN_MODEL`; otherwise the code default is used.

Upload these values to this Preview only. Run from the repository root with Wrangler authenticated:

```sh
npx wrangler preview secret bulk .env.preview \
  --name feat/aai-companion-rig-motion-20261104 \
  --worker-name aai-v0
```

This command creates a new deployment for that Preview. It does not change production or other Previews. Do not commit `.env.preview`.

## Verification

1. Run `npm test`.
2. Run `npx wrangler deploy --dry-run` (the repository's `npm run build` does both).
3. Deploy only with `npx wrangler preview`.
4. Check `/api/status`; it must report `environment: "preview"` and `api_backend: "local-worker"`.
5. Test login, chat, and an explicit web search. Confirm the Preview uses the development Supabase branch and real Tavily/Exa results.

The Cloudflare Workers Build command runs tests and a Wrangler dry-run. It does not build an Android APK. The Preview deploy command is separate and must never be replaced with `wrangler deploy` for this branch.
