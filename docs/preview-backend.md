# AAi Preview: current UI + existing account backend

## Purpose

Use the branch Preview to test the latest AAi Pendamping interface while preserving the user's existing Teguh login, sessions, history, and account data. No paid Supabase development branch is created.

## Routing

- The Preview Worker serves static assets from this feature branch.
- `GET /api/status` is handled locally and reports `environment: "preview"` and `api_backend: "production-service-binding"`.
- `/api/companion/reaction` stays local to the Preview because it is a lightweight visual reaction endpoint.
- Other `/api/*` requests (login, sessions, messages, chat, memory, and web-tool execution) are forwarded by the `AAI_PRODUCTION_API` service binding to the existing `aai-v0` production Worker.
- The service binding does not deploy or modify the target Worker. It calls the already deployed production Worker.
- Chat streaming responses are passed through without buffering so the Preview UI can use the normal SSE stream.
- Preview-specific rate-limit namespaces remain separate for the local companion reaction endpoint.

## Important data behavior

This Preview intentionally uses the existing production account backend and Supabase database. Testing while signed in as Teguh can create normal chat/session history in that account, exactly as the user approved. Do not test destructive operations, change account settings, delete sessions, or alter production data during UI checks.

## Verification

1. Run `npm test`.
2. Run `npx wrangler deploy --dry-run` via the repository build command. This validates the bundle; it does not deploy production.
3. Deploy the branch using `npx wrangler preview` only. Do not use `npx wrangler deploy` from this branch.
4. Open the branch Preview and verify `/api/status` reports `environment: "preview"` and `api_backend: "production-service-binding"`.
5. Sign in with the existing Teguh account, check sessions, send a normal chat, then explicitly enable web permission and test a web-search prompt.
6. Confirm the Preview UI changes are visible while production frontend and Worker deployment remain unchanged.

## Safety

- No new Supabase project or paid database branch is required.
- No production secrets are copied into the Preview.
- The Preview's only production connection is the explicit `AAI_PRODUCTION_API` service binding.
- No APK build is part of this workflow.
- Do not merge the branch or deploy the production Worker as part of Preview testing.
