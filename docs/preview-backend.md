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

## Current Preview status

- The Cloudflare Preview auto-build trigger is temporarily disabled to prevent repeated notifications while the isolated backend is being configured.
- The Preview build's deploy command is temporarily a no-op. This permits tests and `wrangler deploy --dry-run` without deploying the Preview.
- Latest verification: 125 tests passed; Wrangler dry-run completed successfully.
- No APK was built and no Preview or production deployment was performed by that verification.

## Activation checklist

1. Create/choose a separate Supabase development branch or test project and apply the AAi schema/migrations. Production user data must not be copied.
2. Upload Preview-only secrets using the command above.
3. Restore the Cloudflare Preview deploy command to `npx wrangler preview`.
4. Run a manual Preview build, then check `/api/status`; it must report `environment: "preview"` and `api_backend: "local-worker"`.
5. Test login, chat, and an explicit web search. Confirm the Preview uses the development Supabase database and real Tavily/Exa results.
6. Re-enable auto-build only after the Preview is verified.

The Cloudflare Workers Build command runs tests and a Wrangler dry-run. It does not build an Android APK. Never use `wrangler deploy` from this feature branch; production deployment is a separate, explicit operation.
