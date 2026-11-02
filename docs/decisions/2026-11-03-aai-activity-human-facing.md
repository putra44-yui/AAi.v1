# ADR — 2026-11-03: Human-readable activity instead of JSON in AAi chat

- **Decision:** Replace the expanded `JSON aktivitas` UI with a live, plain-language status tied to actual progress SSE events. Keep structured traces in Supabase for engineering audits, dataset curation, and latency analysis.
- **Status:** Accepted for AAi v0 UX experiment; subject to live mobile validation.
- **Motivation:** Teguh observed the raw JSON is not useful to Lia, a nontechnical AAi user. She needs to know what AAi is doing, not see `duration_ms`, step types and copied JSON. They explicitly asked for a ChatGPT-like process experience and token-by-token answer delivery.
- **Previous behavior:** A nested `JSON aktivitas` disclosure displayed a multi-hundred-line code panel in small mobile viewports, including a copy button. The factual event timeline and answer streaming already existed.
- **New behavior:**
  1. One short, high-contrast live status displays the latest *actual* server milestone: preparing context, contacting the provider, checking web sources if permitted, waiting for first word.
  2. When the first text chunk genuinely arrives, change the status to `Jawaban sedang ditulis, sedikit demi sedikit...`. The actual answer continues to stream in the regular answer bubble; do not simulate typing or fabricate model reasoning.
  3. Preserve chronological steps in the expandable activity trail, including sources. Collapse when done; show total answer-ready time using the same persisted server timing.
  4. Do **not** render raw JSON or a technical token counter in chat. The Supabase `activity_trace` stores step names, real timings, public source links and duration for future inspection. The pure formatter for sanitized public reports remains testable but is not part of the end-user UI.
  5. The live indicator honors `prefers-reduced-motion`, and screen readers get `role=status` with `aria-live=polite`.
- **Interpretation of “token”:** Real streamed answer chunks, not the model's hidden chain-of-thought/reasoning tokens. The app does not know the exact tokenizer's billable token count; avoid claiming an exact count based on character or word estimates.
- **Boundary:** No secrets, prompts, private memories, raw chain of thought, or tool payloads in public activity messages. Provider progress labels remain honest about actual stage, and updates do not imply faster inference.
- **Regression checks:** frontend tests verify live status, absence of raw JSON UI, secure report sanitization, code syntax, server SSE flow; browser smoke test should verify first-token transition, mobile contrast, restored older traces, and no console errors.
- **Dataset annotation:** `aai_ux_activity_human_readable_v1`. Reason: audience mismatch (engineer-facing JSON exposed to family users). Expected change: improved readability with unchanged audit trace and model latency.
- **Rollback:** Restore the previous UI renderer commit if accessible activity regresses. Stored backend traces are unaffected; no DB migration.
