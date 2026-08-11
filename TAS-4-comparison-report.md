# TAS-4: Horizon vs El Radar — Comprehensive Pipeline Comparison

## 1. Pipeline Architecture Overview

Both systems share the same conceptual pipeline: **Fetch → Dedup → Score/Filter → Summarize → Deliver**. However, the stage boundaries, technology choices, and operational constraints differ dramatically.

| Stage | Horizon | El Radar |
|-------|---------|----------|
| **Runtime** | Python 3.11+, long-running process | Cloudflare Workers (JS), 30s CPU limit |
| **Fetch** | Concurrent async (asyncio + httpx), 12 source types | Sequential per-source fetch, RSS/Atom parser (regex-based, no deps) |
| **Dedup #1** | URL-based exact (free, pre-AI) | Link-based Set dedup (KV read) |
| **Dedup #2** | LLM-based topic dedup (per-profile, post-scoring) | Embedding semantic (bge-m3 + Vectorize, pre-scoring) |
| **Scoring** | AI analysis pass: profile classification + 0-10 score + tags + summary | Combined with summarization: Haiku single call returns relevance (1-5) + 2-3 sentence summary |
| **Filter** | Per-profile score thresholds + balanced digest quotas | Relevance ≥ 4 threshold |
| **Enrichment** | 2nd AI pass: web search + per-language artifact generation | None (context from "related" items only) |
| **Summarization** | Programmatic Markdown rendering (zero AI cost) | Server-side HTML rendering |
| **Synthesis** | None | Daily panorama: 2-4 sentence editorial synthesis via Haiku |
| **Delivery** | GitHub Pages, email (SMTP/IMAP), webhooks (Feishu/Slack/Discord), MCP | HTML page on KV, Atom feed, sitemap |

## 2. Deduplication Deep Dive

### 2.1 Horizon's Two-Stage Approach

**Stage 1: URL-Based Exact Dedup** (`orchestrator.py:_deduplication_url_key`, lines 53-78)
- Runs **before** AI analysis — zero AI cost
- URL normalization: lowercase host, strip default ports (80/443), strip trailing slashes, strip tracking params (utm_*, fbclid, gclid, etc.)
- Groups by normalized URL **+ requested profile** (profile-aware grouping)
- Keeps richest content (longest `content` field), merges metadata from other sources
- Records merged sources in `metadata["merged_sources"]`

**Stage 2: AI-Based Topic Dedup** (`orchestrator.py:merge_topic_duplicates`, lines 617-697)
- Runs **after** AI scoring/analysis
- LLM-based: sends all items' titles, tags, and summaries to AI in **ONE call**
- **Per-profile**: each profile's items are deduped separately (e.g., "AI/ML" items don't compare against "Finance" items)
- Configurable per-profile: `topic_dedup: false` disables it per profile
- Prompt explicitly says: "Err on the side of keeping items separate when unsure"
- Primary = highest-scored item (items pre-sorted by score descending)
- Content from dropped duplicates is merged into primary
- Falls back to returning items unchanged if AI call fails

### 2.2 El Radar's Single-Stage Approach

**Embedding Semantic Dedup** (`memoria.js`)
- Uses bge-m3 embeddings via Workers AI + Vectorize vector DB
- **Two thresholds on the same cosine similarity score** (0-1):
  - `UMBRAL_DUPLICADO = 0.93`: same news, different source → merge (add as fuenteAdicional)
  - `UMBRAL_RELACIONADO = 0.65`: related past coverage → pass as context to Haiku
- **Global scope**: all items compared against the same index (not per-profile)
- **Batched**: embeddings generated in one `env.AI.run()` call per source batch; Vectorize insert also batched
- Vectors stored **only for published items** (not rejected ones)
- 90-day retention window for context (`VENTANA_DIAS_CONTEXTO`)
- Falls through to normal pipeline (no dedup/context) if embedding fails or budget exhausted

**Additional "Seen Items" Filter** (`index.js:ejecutarDigest`, lines 374-377)
- URL-based Set dedup against today + yesterday's published items from KV
- `descartados` cache: items rejected by Haiku (relevance < 4) remembered for 72h to avoid re-paying
- This is functionally similar to Horizon's Stage 1, but simpler (no URL normalization, tracking param stripping)

### 2.3 Critical Differences

| Aspect | Horizon | El Radar |
|--------|---------|----------|
| Stage 1 mechanism | URL normalization (free) | Set lookup + descartados cache (free) |
| Stage 2 mechanism | LLM judgment call | Cosine similarity on bge-m3 |
| Threshold | None — AI decides | Fixed: 0.93 dup, 0.65 related |
| Scope | Per-profile silos | Global (all items in one index) |
| "Related" concept | No — binary keep/drop | Yes — becomes context for Haiku |
| Cost model | 1 AI call per N items (all at once) | 1 embedding call per batch + 1 Vectorize query per item |
| Fallback | Silent skip, return unchanged | Falls through to normal pipeline |
| Budget awareness | None | Hard subrequest budget with graceful degradation |

## 3. Summarization & Content Evaluation

### 3.1 Horizon: Multi-Pass AI + Programmatic Output

**Pass 1 — Analysis** (`ContentAnalyzer.analyze_batch`):
- Profile classification: routes item to the correct profile
- Scoring: 0-10 with reason
- Tagging and summary generation
- Each item = 1 AI call

**Pass 2 — Enrichment** (`ContentEnricher._enrich_item`):
- Tool calls (web search) executed **once**, results shared across languages (smart)
- For **each language**, separate AI call generates localized `ContentArtifact` blocks
- Cost: N items × M languages — the most expensive phase
- `target_language_instruction(language)` injects "Write in Simplified Chinese" or "Write in language `en`"

**Pass 3 — Summarization** (`DailySummarizer.generate_summary`):
- **Zero AI calls** — pure Markdown rendering from pre-generated artifacts
- `LABELS` dict with complete en/zh localization
- `_pangu()` inserts CJK-ASCII spacing for Chinese readability
- `normalize_language()` OpenCC traditional→simplified conversion

**Total AI calls**: N (analysis) + N×M (enrichment) + 0 (summary) + optional topic dedup (1)

### 3.2 El Radar: Single-Call Efficiency

**Per-Item Summarization** (`resumen.js:resumir`):
- **One Haiku call** does everything: relevance (1-5) + 2-3 sentence summary in Spanish
- System prompt includes anti-injection framing (content is NOT instructions)
- Content truncated to ~2000 tokens (~8000 chars)
- "Related" context injected inline: "CONTEXTO PROPIO: hace unos días publicamos..."
- Output: structured with `RELEVANCIA:` and `RESUMEN:` tags for deterministic parsing
- Falls back to title if call fails (fail-open approach)
- Two providers: `workers-ai` (llama-3.2-3b, free) and `haiku` (Claude Haiku 4.5, external API)

**Daily Panorama** (`resumen.js:generarPanorama`):
- **One Haiku call** per day (not per batch, via delayed queue message)
- 2-4 sentence editorial synthesis in Spanish, plain text (no Markdown)
- Sorted by relevance, capped at 25 items to keep prompt manageable
- Idempotent: only regenerates if item count changed

**Total AI calls**: N (per-item summary) + 1 (panorama)

### 3.3 Key Differences

| Aspect | Horizon | El Radar |
|--------|---------|----------|
| Evaluation + summary | Separate calls (analysis then enrichment) | Single call (resumir) |
| LLM calls per item | 2-3 (analysis + enrichment × languages) | 1 (resumir) |
| Languages | Config list (en, zh typically) | Hardcoded Spanish |
| Summary rendering | Programmatic Markdown (free) | Server-side HTML |
| Translation | None — LLM generates in target language | None — Spanish only |
| Panorama/synthesis | None | Yes (1 Haiku call/day) |
| Label localization | LABELS dict pattern (i18n-ready) | N/A |
| Related context | No (binary dup only) | Yes (two thresholds create context) |
| Content enrichment | Web search tooling (2nd pass) | None |
| Token efficiency | Low (multi-pass) | High (single pass) |

## 4. Language & Multilingual Handling

| Aspect | Horizon | El Radar |
|--------|---------|----------|
| Language config | `AIConfig.languages` list | Hardcoded Spanish |
| Language detection | **None** — config-driven only | N/A |
| Per-language cost | N×M AI calls (linear scaling) | N/A (single language) |
| Script normalization | OpenCC Traditional→Simplified Chinese | None |
| Label i18n | `LABELS` dict (en/zh complete) | All strings inline in Spanish |
| CJK spacing | `_pangu()` helper | N/A |
| Fallback languages | English labels for unknown languages | N/A |
| Source language | Untracked — no attribution | Untracked |

## 5. Operational & Platform Differences

### 5.1 Constraints

| Constraint | Horizon | El Radar |
|------------|---------|----------|
| Runtime | Long-running Python process | Cloudflare Workers (30s CPU, 128MB) |
| Subrequest limit | None (unbounded HTTP) | 50 per invocation (free plan) |
| AI provider independence | Multi-provider (Claude, GPT, Gemini, DeepSeek, etc.) | Haiku (primary) + Workers AI llama (backup) |
| Vector DB | None — LLM-based dedup | Vectorize (free tier: 200K vectors) |
| Storage | File system + Git (GitHub Pages) | KV (replicated, ~13mo TTL) + D1 (metrics) |
| Queue/async | Python asyncio | Cloudflare Queues (max_concurrency=1) |
| Observability | Rich console output + token tracking | D1 metrics (tokens, cost, dedup classifications, errors) |

### 5.2 Error Handling Philosophy

**Horizon**: Fail-hard by default. If an LLM call fails, the item is silently dropped (topic dedup falls back to unchanged list). All-sources-failure raises RuntimeError. Language-specific enrichment failures skip the item gracefully.

**El Radar**: Fail-open by default. If Haiku fails, publish with title instead of skipping. If embedding fails, proceed without semantic memory. If queue message retries, panorama is idempotent. Only all-sources-failure triggers an alert (webhook). Budget exhaustion is graceful: items not processed remain unseen for next pass.

### 5.3 Cost Awareness

**Horizon**: Tracks token usage per provider, per run. No budget limits — runs until complete.

**El Radar**: Tracks every subrequest against a hard ceiling of 45 (leaving 5-headroom below the 50 limit). Memory semantic budget separate (38 subrequests). Queues split work into 5-source batches to stay under limit. Descartados cache prevents re-paying for rejected items.

## 6. Gap Analysis

### What Horizon Has That El Radar Lacks

1. **URL normalization for dedup** — tracking param stripping, port normalization, trailing slash handling. El Radar only does exact link match.
2. **Per-profile dedup scoping** — Horizon doesn't compare unrelated profiles against each other.
3. **Multi-provider AI** — Horizon can swap between Claude/GPT/Gemini/DeepSeek. El Radar is Haiku-or-bust (Workers AI llama is backup only for /comparar).
4. **Profile/classification system** — Horizon classifies items into profiles (AI, finance, security) with per-profile thresholds and quotas.
5. **Enrichment/web search** — Horizon can call web search tools for background context. El Radar has no tool-execution capability.
6. **Multi-language digest** — Horizon generates separate digests per language. El Radar is Spanish-only.
7. **Email delivery** — Horizon has SMTP/IMAP subscriber management. El Radar is web-only.

### What El Radar Has That Horizon Lacks

1. **Two-threshold semantic dedup** — The "related" concept (0.65 threshold) that feeds context to summarization without merging. Horizon's LLM dedup is binary (keep/drop).
2. **Daily panorama synthesis** — Editorial overview connecting the day's stories. Horizon has no equivalent cross-item synthesis.
3. **Budget-aware graceful degradation** — Every stage checks subrequest budget and skips non-critical features (memory, then items). Horizon runs unbounded.
4. **Descartados cache** — Remembers rejected items for 72h to avoid re-paying. Horizon reprocesses everything each run.
5. **Batch embedding** — Single `env.AI.run()` call per source batch reduces subrequest count. Horizon has no embedding pipeline.
6. **Queue-based batching** — Splits workload across invocations to stay under 50-subrequest limit. Horizon runs everything in one process.
7. **Cost tracking with persistence** — D1 records every LLM call with tokens, cost, and outcome. Horizon tracks per-run but doesn't persist.
8. **Edge deployment** — Runs on Cloudflare's edge network, no server management. Horizon needs a Python runtime.

## 7. Overlaps & Convergent Design

Both systems independently arrived at:

1. **Fail-open philosophy for individual items** — better to publish imperfectly than lose a story
2. **Two-phase handling** — dedup first (cheap), then deep processing (expensive)
3. **Source attribution on merged items** — trace which sources contributed to a story
4. **Anti-injection framing** — system prompts that treat content as data, not instructions
5. **Structured LLM output** — parsed programmatically (Horizon: JSON, El Radar: regex on tagged lines)
6. **Best-effort observability** — logging/metrics that never crash the pipeline
7. **Configurable thresholds** — score/dedup settings externalized, not hardcoded in logic
8. **Content truncation** — both cap input to LLM (~2000 tokens) to control cost

## 8. Architecture Diagram Comparison

### Horizon
```
Fetch (concurrent) → URL Dedup (free) → AI Analysis (N calls)
  → Profile Filter (score threshold) → AI Topic Dedup (1 call per profile)
  → Balanced Digest (category quotas) → AI Enrichment (N × M calls)
  → Programmatic Summary (free) → Deliver (pages/email/webhooks)
```

### El Radar
```
Fetch (sequential, batched) → Link Dedup (Set lookup, free)
  → Embedding Generation (1 call per source batch, batched)
  → Vectorize Query (1 call per item) → Classify (dup/related/new)
  → Merge duplicates (free) → Haiku Summarize (1 call per item)
  → Publish to KV (free) → [Panorama Synthesis (1 call per day)]
  → Serve HTML/Atom/Sitemap (free)
```

**Key difference**: Horizon front-loads AI analysis before filtering; El Radar interleaves filtering (embeddings) before the expensive Haiku call. This means El Radar's cost scales with items *published*, not items *fetched*.<｜end▁of▁thinking｜>Now let me also read the remaining source files to complete the comparison picture:

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="read">
<｜｜DSML｜｜parameter name="path" string="true">worker-radar/src/articulo.js