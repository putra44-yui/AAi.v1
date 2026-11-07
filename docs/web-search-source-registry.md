# AAi Web Search: source-first strategy

## Purpose

AAi should choose where to look before searching broadly. A relevant primary source is more useful than a large pile of pages that repeat one another.

## Request flow

1. The selected model decides whether public web evidence is needed and issues a precise `search_web` query.
2. The server resolves a topic-specific source plan from the user's request plus the model's public query. This resolver is deterministic and does not call another LLM.
3. Tavily searches the selected domains first with `include_domains`. Returned URLs are checked again against the allowlist locally.
4. If fewer than two distinct on-domain sources are found, Exa searches the same domain allowlist with `includeDomains`.
5. If the primary-source pool is still sparse, AAi widens the search once to the general web. The activity trace records that broadening happened.
6. The model sees the selected source category, the search scope, the provider attempts, and the verified source snippets before composing its answer.

The system does not require both providers on every query. If the first provider returns enough relevant primary sources, it stops early to control latency and cost. The model may still request another distinct query in a later tool round when it identifies a concrete evidence gap.

## Initial source registry

| Topic | Initial priority domains |
|---|---|
| KPU / Pemilu / Pilkada | jdih.kpu.go.id, kpu.go.id, bawaslu.go.id, dkpp.go.id, mkri.id, peraturan.bpk.go.id, peraturan.go.id |
| Indonesian laws and decisions | peraturan.bpk.go.id, peraturan.go.id, jdihn.go.id, jdih.setneg.go.id, mkri.id |
| Cloudflare | developers.cloudflare.com, cloudflare.com, blog.cloudflare.com |
| Supabase | supabase.com |
| OpenAI | developers.openai.com, platform.openai.com, help.openai.com, openai.com |
| GitHub | docs.github.com, github.com |
| AI model/provider docs | qwen.ai, qwenlm.github.io, openrouter.ai, api-docs.deepseek.com, deepseek.com, docs.z.ai, z.ai, huggingface.co |
| Research papers | arxiv.org, aclanthology.org, openreview.net, proceedings.mlr.press, dl.acm.org, ieeexplore.ieee.org, nature.com, sciencedirect.com |
| General software docs | nodejs.org, react.dev, vite.dev, typescriptlang.org, developer.mozilla.org, postgresql.org, docs.python.org, doc.rust-lang.org, developer.android.com |
| Education | kemendikdasmen.go.id, kemdikbud.go.id, kemendikti.go.id, jdih.kemdikbud.go.id, banpt.or.id |
| Finance and economy | bi.go.id, ojk.go.id, bps.go.id, kemenkeu.go.id, idx.co.id |
| Public health | kemkes.go.id, bpom.go.id, who.int, cdc.gov, nhs.uk |
| News | antaranews.com, reuters.com, apnews.com, bbc.com |

The registry is an initial curated routing aid, not a complete catalogue and not a guarantee that every page on a listed domain is authoritative. Add a domain only after checking that it is relevant and controlled by the intended publisher. Topic matching order matters: specialist domains such as KPU take precedence over general legal/news categories.

## Evidence and safety

- Domain restrictions are selected by server code; the model cannot inject arbitrary domains into provider parameters.
- Domain-restricted results are locally filtered by hostname. A provider returning an off-domain result does not make it into the targeted evidence set.
- Broad-web fallback is clearly marked as broadened; it must not be presented as an official-source result.
- Search snippets and page content are untrusted data, never instructions.
- Existing privacy checks, web permission, rate limits, provider timeouts, and the three-round model tool-call cap remain in force.
- Do not send private family context, credentials, or confidential document content to search providers.

## Audit fields

Each search completion records the selected source category, priority domains, provider attempts (provider, targeted/general scope, accepted result count), final source count, and whether broadening occurred. These fields support later review without exposing API keys or full private user messages.

## Extending the registry

1. Add a narrow topic matcher before broader matchers when precedence matters.
2. Prefer publisher-owned documentation, legal repositories, or original research.
3. Keep domain values as hostnames, not full URLs or paths.
4. Add unit tests for topic selection, provider payloads, local domain filtering, and fallback.
5. Do not widen every category to generic search merely to increase source counts.
