# AAi v0 — UX pass 2026-11-02 (latency transparency, mobile text, public activity JSON)

Status at authoring: regression-tested; production UX smoke test pending.

## User intent and safety boundary

AAi v0 is an experimental interface, but users' conversations and credentials are real. Improve usability on narrow phones without deleting sessions, exposing keys or private reasoning, changing model selection, or silently changing web-search permission. Preserve evidence and reasons as commits for AAi's change dataset.

## Observed issues in the browser extension

1. Synthetic table/code request: factual activity milestones appeared at ~1.5s, but no public answer until ~13.3s; subsequent tokens streamed. This is **first-visible-token delay**, not proof that the Worker buffered the stream.
2. Narrow viewport: justified natural-language paragraphs left excessive inter-word whitespace; no document-wide horizontal overflow.
3. Source rail: horizontal scroll worked, but Cloudflare documentation screenshots rendered as giant cropped letters or blank previews; code-like snippets were poor summaries.
4. A session title followed the instruction prefix `UJI UX, jangan cari web`, not the subject of its table.
5. Opening a saved session restored its activity, but there was no structured JSON inspection control. Assistant action buttons had icon-only accessible names and fleeting copy confirmation.

## Decisions and reasoning

- **Truthful latency**: preserve actual streaming. Add timed Worker SSE milestones around final provider connection. Emit `at_ms` relative to request start; persist `firstTokenMs` and send final `timings`. Show distinct waiting and answering status in the activity title. Updating the wait clock is not a claim of hidden reasoning or useful intermediate work.
- **Bounded public JSON**: `aai.public_activity.v1` exposes duration, first token time, and observed milestones with public source URL/title. No raw prompt, memories, credentials, provider response, source snippets, or model chain of thought. Works for live and persisted sessions; old traces remain readable.
- **Mobile reading**: override desktop `text-align: justify` up to 720px to remove word-spacing rivers. Preserve desktop preference and horizontal table/code scrollers; increase small controls/microcopy for touch.
- **Source cards**: documentation becomes a text-first preview with calm icon and readable title, not a huge hero screenshot. Visual articles may retain thumbnails. Drop code-heavy snippets that confuse readers.
- **Session naming**: strip experiment prefixes and no-web instructions; prioritize subject phrases after `tentang/mengenai/soal`. Update title-generator guidance and retain existing protection for manual renames.
- **Accessible actions**: add explicit names for copy/regenerate/speech and display success/failure only after clipboard resolves.

## What this does not promise

It **does not make model inference faster**. Initial TTFT needs measurement and possibly a model/router experiment. Do not label this `inference_speedup`. Documentation thumbnail filtering can occasionally hide a useful diagram; revisit once image-quality signals are available. Never confuse a public process report with internal model reasoning.

## Verification checklist

- Local `npm test`: **75/75 pass** (4 new UX tests, plus real SSE persistence assertions).
- TypeScript typecheck: pass.
- JavaScript syntax check: pass.
- Wrangler 4.156.0 `deploy --dry-run`: pass; no deployment from local machine.
- After CI deployment, inspect mobile text + source cards, expand/copy JSON for live and saved activity, verify non-null first token time, normal streaming, no tool-permission regression, and no secrets in report.

## Dataset label

`ux_measurement_and_presentation`; keep the sequence **observed result → cause hypothesis → change → automated test → live evidence → residual limits**. When something fails after deployment, retain that failure in the PR discussion instead of quietly rewriting history.
