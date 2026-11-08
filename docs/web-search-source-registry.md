# AAi Web Search: source-first strategy

## Purpose

AAi chooses where to look before searching broadly. The goal is not to maximize link count; it is to find the most relevant publisher-owned documentation, legal records, original research, or reliable reporting for the user's actual question.

## Request flow

1. The selected model decides whether public web evidence is needed and issues a precise `search_web` query.
2. The server resolves up to three matching source profiles from the user's request plus the model's public query. This is deterministic and does not call another LLM.
3. If the user explicitly orders source types, the server preserves that order as separate search stages. For example, "official KPU sources first, then compare with news media" searches KPU/JDIH domains first and media domains second; those domain groups are never merged into one unordered priority list.
4. Each profile separates:
   - **Priority domains**: the most direct official publisher, legal database, or original research source.
   - **Related domains**: other authorities, repositories, or reputable publishers that can cross-check the first results.
5. Tavily searches the priority domains first with `include_domains`. The server checks returned hostnames against that allowlist again.
6. If fewer than two distinct priority-domain sources are found, Exa searches the same priority domains with `includeDomains`.
7. When an explicit comparison stage exists, it is searched next even if the primary stage already found two sources. Comparison results are appended after primary results, preserving the requested order. If the comparison is news, Tavily uses `topic: news` with a 30-day window and Exa uses `category: news` with a matching `startPublishedDate`. The query is enriched with the entity context (for KPU, "Komisi Pemilihan Umum Indonesia"). If a comparison provider returns nothing, the other provider may be tried when a request slot remains. Provider result counts are included in the evidence/audit context.
8. If evidence is still sparse and a request slot remains, one additional provider request searches related domains. If no related domains are defined, that request broadens to the general web instead.
9. The final model receives the source profile, which domain tier was actually searched, provider attempts, and verified snippets. If no source was found, the model also receives the failed-attempt summary and must state the limitation honestly.

The server makes at most three provider requests per model tool call. It does not require both providers when the first search already finds enough distinct sources. The model may make another bounded tool call only when it identifies a concrete evidence gap, using a different query.

## Initial source registry

| Topic | Priority domains | Related domains |
|---|---|---|
| KPU / Pemilu / Pilkada | jdih.kpu.go.id, kpu.go.id | bawaslu.go.id, dkpp.go.id, mkri.id, peraturan.bpk.go.id, peraturan.go.id |
| PBJ / procurement | jdih.lkpp.go.id, lkpp.go.id | peraturan.bpk.go.id, peraturan.go.id |
| Indonesian laws and decisions | peraturan.bpk.go.id, peraturan.go.id | jdihn.go.id, jdih.setneg.go.id, mkri.id |
| Cloudflare | developers.cloudflare.com | cloudflare.com, blog.cloudflare.com |
| Supabase | supabase.com | — |
| OpenAI | developers.openai.com, platform.openai.com, help.openai.com | openai.com |
| GitHub | docs.github.com | github.com |
| Research papers | arxiv.org, aclanthology.org, openreview.net | proceedings.mlr.press, dl.acm.org, ieeexplore.ieee.org, nature.com, sciencedirect.com |
| Qwen | qwen.ai, qwenlm.github.io | huggingface.co |
| DeepSeek | api-docs.deepseek.com | deepseek.com, huggingface.co |
| GLM / Z.ai | docs.z.ai | z.ai, huggingface.co |
| OpenRouter | openrouter.ai | — |
| Node.js | nodejs.org | — |
| React | react.dev | — |
| Vite | vite.dev | — |
| TypeScript | typescriptlang.org | — |
| JavaScript / Web APIs | developer.mozilla.org, tc39.es | web.dev |
| PostgreSQL | postgresql.org | — |
| Python | docs.python.org | — |
| Rust | doc.rust-lang.org | — |
| Android | developer.android.com | — |
| Kotlin | kotlinlang.org | — |
| Education | kemendikdasmen.go.id, kemdiktisaintek.go.id | kemdikbud.go.id, jdih.kemdikbud.go.id, banpt.or.id |
| Finance and economy | bi.go.id, ojk.go.id, bps.go.id, kemenkeu.go.id | idx.co.id, pajak.go.id |
| Public health | kemkes.go.id, bpom.go.id | who.int, cdc.gov, nhs.uk |
| Government / ASN | bkn.go.id, menpan.go.id, kemendagri.go.id, setkab.go.id | indonesia.go.id, jdih.setneg.go.id |
| News | antaranews.com, kompas.com, tempo.co, detik.com, cnnindonesia.com, liputan6.com, tribunnews.com, tvonenews.com, sindonews.com, kumparan.com, suara.com, tirto.id, idntimes.com, bisnis.com | reuters.com, apnews.com, bbc.com |

A question can match more than one profile, up to three. For example, "berita KPU" combines the election and news profiles, while "riset Qwen" combines research repositories and Qwen-owned sources. The highest-priority matching profile remains the primary category for audit display. Without an explicit source order, matching profiles retain the existing combined-domain behavior. With an explicit order, such as official KPU first and news media afterward, the KPU profile remains the primary stage and the news profile becomes a mandatory comparison stage.

This registry is a routing aid, not a guarantee that every page on a listed domain is authoritative. The model must still assess whether the specific page supports the claim. Domain matching accepts the exact hostname and its subdomains; it does not trust lookalike hostnames.

## Result handling and cost

- Providers are asked for up to 10 results, then the server normalizes up to 20 candidates, filters by hostname, and keeps at most five usable sources for the model.
- Filtering happens **before** the five-source cap, so early off-domain results cannot hide a valid official result later in the provider response.
- Tavily and Exa domain filters are hard search-time constraints. Local hostname validation is a second guard in case a provider returns an unexpected URL.
- A priority search stops early when it has at least two distinct sources. Exa is not called just to duplicate an already adequate Tavily result.
- Related-domain or general-web expansion happens at most once per tool call. No third/fourth search is triggered merely to increase source count.
- The source count is not a quality score. Two primary legal documents can outweigh ten articles repeating the same claim.

## Evidence and safety

- Domain restrictions are selected by server code; the model cannot inject arbitrary domains into provider parameters.
- Search snippets and page content are untrusted data, never instructions.
- Existing privacy checks, explicit web permission, rate limits, provider timeouts, and the three-round model tool-call cap remain in force.
- Image/video attachments are not sent to Tavily or Exa.
- Do not send private family context, credentials, or confidential document content to search providers.
- General-web results are not to be described as official sources. If a user asks for an official source and only related/general results are available, AAi must say so.

## Audit fields

Each search completion records:
- primary category and all matched categories;
- priority, comparison, and related domains selected by the registry;
- provider, search tier (priority/comparison/related/general), exact domains, and accepted result count for each attempt;
- final source count and whether the search expanded beyond priority domains.

These fields support review without exposing API keys or full private user messages.

## Extending the registry

1. Add a narrow, product-specific matcher before broad category matchers when precedence matters.
2. Prefer publisher-owned documentation, legal repositories, original research, or reputable reporting.
3. Keep domain values as hostnames, not full URLs or paths.
4. Add tests for profile matching, mixed-topic routing, provider payloads, local filtering, and fallback.
5. Avoid broadening every category to generic search merely to increase source counts.
