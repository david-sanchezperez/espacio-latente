# TAS-5: Integration Feasibility Assessment

## Executive Summary

Of the nine techniques analyzed from Horizon, **three are directly adoptable** with minimal effort (URL normalization, LABELS i18n pattern, target-language instruction pattern), **three could be adapted** with moderate effort (multi-provider AI, programmatic label rendering, descartados TTL tuning inspired by Horizon's tracking-param stripping), and **three are not recommended** under current Cloudflare Workers constraints (LLM topic dedup, per-language enrichment, web-search tooling). El Radar's current embedding-based dedup and single-call summarization are already the right design for edge deployment — Horizon's techniques add depth but at a subrequest cost that exceeds the free-tier budget.

---

## 1. Cloudflare Workers Constraints (Current Baseline)

### 1.1 Hard Limits

| Constraint | Limit | El Radar Usage (per batch) | Headroom |
|------------|-------|---------------------------|----------|
| Subrequests/invocation | **50** (free plan) | ~15-25 typical, 40+ peak | ~10-25 spare |
| CPU time | 30s (max) | I/O-bound, <5s typical | Plenty |
| Memory | 128MB | <20MB typical | Plenty |
| Workers AI neurons/day | 10,000 | Low (Haiku primary) | Plenty |
| Vectorize stored dims/mo | 5M (≈4,880 vectors) | ~2,700 at 90-day window | ~2,180 spare |
| D1 reads/day | 5M | ~100s | Plenty |
| Queue max_concurrency | 1 | 1 (by design) | At limit |
| Queue max_retries | 3 | 3 | At limit |

### 1.2 Subrequest Accounting (Per Batch of 5 Sources)

```
Feed fetching:               ~5  (1 per source, fetch to external RSS/Atom)
Embedding generation:        ~1  (batched: 1 env.AI.run() for all candidates)
Vectorize queries:           ~3-8 (1 per candidate item, ~5-10 items)
Haiku calls:                 ~2-5 (1 per published item, ~3-5 items)
Vectorize insert:            ~1  (batched: 1 insert for all published vectors)
KV reads (descartados):      ~2  (hoy + ayer)
KV writes (publish+descarte): ~2-3
D1 writes (metrics):         ~5-10 (best-effort, doesn't consume subrequest budget)
───
Typical total:               ~15-25 / 50
Peak total (many items):     ~35-45 / 50  ← tight but fits
```

### 1.3 Queue Architecture

El Radar's queue-based batching is **critical infrastructure**, not an optimization. Without it, a single invocation processing all 28 sources would consume ~59 subrequests and exceed the limit (confirmed in production). Each batch message gets its own 50-subrequest budget. Any new feature that adds subrequests must fit within the per-batch budget (~25 typical, ~45 peak) or require its own queue.

### 1.4 Free Tier Cost Structure

| Resource | Cost | Impact of Adding Features |
|----------|------|--------------------------|
| Haiku API (external) | $1/1M input, $5/1M output | Per-item cost, ~$0.002/item |
| Workers AI (llama-3.2-3b) | $0.051/1M in, $0.34/1M out | ~$0.00005/item |
| Workers AI (bge-m3) | ~1,075 neurons/1M tokens | Free at current volume |
| KV reads/writes | 1K/day free | Negligible |
| D1 reads/writes | 5M/100K per day | Negligible |
| Vectorize stored | 5M dims/mo free | OK for 90-day window |

---

## 2. Technique-by-Technique Feasibility Assessment

### 2.1 URL Normalization for Dedup ✅ DIRECTLY ADOPTABLE

**What it is**: Normalize URLs before comparing — lowercase host, strip default ports (80/443), strip trailing slashes, strip tracking params (`utm_*`, `fbclid`, `gclid`, `ref`, `source`, `mc_cid`, `mc_eid`).

**Horizon implementation** (`orchestrator.py:_deduplication_url_key`, 25 lines):
```python
def _deduplication_url_key(url: str) -> str:
    parsed = urlparse(url)
    netloc = parsed.hostname.lower()
    if parsed.port and parsed.port not in (80, 443):
        netloc += f":{parsed.port}"
    path = parsed.path.rstrip("/") or "/"
    query = parsed.query
    # Strip tracking params
    tracking_params = {"utm_source", "utm_medium", ...}
    ...
    return urlunparse((parsed.scheme, netloc, path, parsed.params, clean_query, parsed.fragment))
```

**El Radar current state** (`index.js:375`):
```js
const vistos = new Set([...existentesHoy, ...existentesAyer].map((it) => it.link));
// Exact match only — "https://example.com/article?utm_source=twitter"
// !== "https://example.com/article"
```

**Adoption plan**:
1. Add a `normalizarLink(link)` function in a new `util.js` (or inline in `index.js`):
   ```js
   function normalizarLink(link) {
     const url = new URL(link);
     // Strip tracking params
     const TRACKING = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
       'fbclid', 'gclid', 'gbraid', 'wbraid', 'ref', 'source', 'mc_cid', 'mc_eid']);
     for (const p of [...url.searchParams.keys()]) {
       if (TRACKING.has(p)) url.searchParams.delete(p);
     }
     // Normalize host, port, trailing slash
     url.hostname = url.hostname.toLowerCase();
     if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
       url.port = '';
     }
     url.pathname = url.pathname.replace(/\/+$/, '') || '/';
     return url.toString();
   }
   ```
2. Normalize links on insertion into the `vistos` Set **and** on storage in KV.
3. Normalize links when comparing in `buscarObjetivoFusion()`.

**Cost**: **Zero subrequests** — pure JS string manipulation, <1ms CPU.

**Benefit**: Catches cross-source duplicates that differ only in tracking params (e.g., a Hacker News submission linking to `example.com/article?utm_source=twitter` and an RSS feed item linking to `example.com/article`). Common in practice—tech blogs shared on social media frequently carry UTM parameters.

**Risk**: Very low. `URL` constructor is available in Workers runtime. Edge case: some sites use query params for canonical routing (e.g., `?p=123`), but stripping only tracking params (explicit allowlist) avoids this.

**Verdict**: **Directly adoptable. Recommended as a quick win.** Should be paired with storing normalized links in KV to avoid re-normalization on every comparison.

---

### 2.2 LABELS i18n Pattern ✅ DIRECTLY ADOPTABLE

**What it is**: Horizon's `DailySummarizer` uses a `LABELS` dictionary keyed by language code for all UI strings (headers, section names, empty state messages). Summary rendering is pure programmatic Markdown — zero AI cost.

**Horizon implementation** (`summarizer.py`):
```python
LABELS = {
    "en": {"header": "Daily Digest", "by_profile": "By Profile", ...},
    "zh": {"header": "今日摘要", "by_profile": "按分类", ...},
}
```

**El Radar current state**: All strings inline in Spanish in `paginas.js`:
```js
<h1>El Radar — {fecha}</h1>
```

**Adoption plan**:
1. Extract all UI strings from `paginas.js` into a `LABELS` object in `config.js`:
   ```js
   export const LABELS = {
     es: {
       titulo: 'El Radar',
       sinItems: 'Todavía no hay piezas para hoy...',
       archivo: 'Archivo',
       contextoAnterior: 'Anteriormente publicamos',
       coste: 'Coste estimado del digest de hoy',
       // ... all UI strings
     },
   };
   ```
2. Accept `?lang=en` query parameter in `fetch()` handler.
3. Render with `LABELS[lang] || LABELS.es`.

**Cost**: **Zero subrequests**, zero AI cost. Pure JS object lookup + template literal interpolation.

**Benefit**: Enables English (and potentially other language) UI without changing the summarization pipeline. The summaries themselves remain in Spanish for now — this only localizes the UI chrome.

**Risk**: Very low. Purely presentational change. Doesn't affect the data pipeline.

**Verdict**: **Directly adoptable. Recommended.** Even if multi-language summaries aren't implemented yet, having i18n-ready UI is forward-looking and costs nothing.

---

### 2.3 target_language_instruction() Pattern ✅ DIRECTLY ADOPTABLE

**What it is**: Horizon injects a language instruction into the system prompt:
```python
def target_language_instruction(language: str) -> str:
    if language == "zh":
        return "Write in Simplified Chinese."
    return f"Write in language `{language}`."
```

**El Radar current state**: Hardcoded Spanish in `SISTEMA_RESUMEN`:
```
'Escribe en español, pero mantén en inglés los términos técnicos...'
```

**Adoption plan**:
1. Parameterize the language instruction in `SISTEMA_RESUMEN`:
   ```js
   const SISTEMA_RESUMEN = (lang = 'es') => `...
   Escribe en ${lang === 'es' ? 'español' : 'English'}...
   `;
   ```
2. Pass `lang` through from the fetch URL query parameter.
3. Store language preference per-digest (or default to Spanish).

**Cost**: **Zero additional subrequests** — the same Haiku call just gets a different prompt. Token cost is identical (the language instruction is ~10 tokens).

**Benefit**: Enables English summaries without doubling the subrequest count. The same single Haiku call can produce output in English instead of Spanish.

**Risk**: Medium. Quality of AI-generated summaries may differ by language (Haiku might be better at English than Spanish or vice versa). The anti-injection framing and technical-term-preservation rules need language-specific tuning.

**Verdict**: **Directly adoptable with caution.** Test English output quality against Spanish before making it the default. Consider using Workers AI (llama-3.2-3b, free) for English to avoid paying Haiku cost for a secondary language.

---

### 2.4 Per-Profile Dedup Scoping ⚠️ NOT APPLICABLE (currently)

**What it is**: Horizon deduplicates items only within the same profile (e.g., "AI/ML" items don't compare against "Finance" items).

**Why not applicable**: El Radar is single-topic (AI/ML/LLMs only). All items are in the same implicit profile. Adding profiles would require:
1. A classification step (AI call per item or per batch)
2. Per-profile thresholds and quotas
3. Separate Vectorize indexes or metadata-filtered queries

This is a **product expansion decision**, not a technical integration. If El Radar ever expands to cover multiple domains (e.g., AI + biotech + space), this pattern becomes relevant. For now: **defer.**

---

### 2.5 LLM-Based Topic Dedup ❌ NOT RECOMMENDED

**What it is**: Horizon sends all items' titles, tags, and summaries to AI in ONE call to identify topic duplicates. Runs per-profile, post-scoring. Configurable per-profile.

**Cost**: +1 subrequest per profile group. With the current ~15-25 typical subrequest count, this would fit the budget technically. But...

**Why not recommended**:
1. **El Radar's embedding approach is already superior for the use case.** The two-threshold model (0.93 = duplicate merge, 0.65 = related context) is more nuanced than Horizon's binary keep/drop. The "related" concept creates context that enriches summaries — Horizon has no equivalent.
2. **LLM dedup is less predictable.** Embeddings produce consistent cosine scores that can be calibrated with data. LLM judgments vary with model version, temperature, and prompt wording.
3. **LLM dedup adds latency.** A batch of 20 items needs a full LLM call (potentially 2-5 seconds), while Vectorize queries are <100ms each.
4. **The bge-m3 model is free** (Workers AI neurons). Anthropic Haiku costs money. Swapping a free embedding for a paid LLM call is moving in the wrong direction.
5. **El Radar already records dedup decisions in D1** (`clasificacion`, `similitud_top`), enabling threshold calibration. Horizon's LLM dedup has no such calibration mechanism.

**Verdict**: **Not recommended.** El Radar's embedding-based semantic dedup with two thresholds is the right design for edge deployment. Horizon's LLM dedup solves the same problem at higher cost and lower consistency.

---

### 2.6 Multi-Provider AI △ ADAPTABLE (with constraints)

**What it is**: Horizon supports Anthropic, OpenAI, Google Gemini, DeepSeek, Doubao, MiniMax, Ollama — swappable via config.

**El Radar current state**: Haiku (primary) + Workers AI llama-3.2-3b (backup, only for `/comparar`).

**Adoption opportunities**:

| Provider | Cost | Benefit | When to Use |
|----------|------|---------|-------------|
| **Haiku** (current) | $1/$5 per 1M tokens | Best quality, Spanish-capable | Primary, always |
| **Workers AI llama-3.2-3b** | Free (Workers AI) | No external subrequest, free | Backup when Anthropic is down |
| **OpenAI GPT-4o-mini** | $0.15/$0.60 per 1M tokens | Cheaper than Haiku, good multilingual | Cost optimization for low-priority batches |
| **Workers AI llama-3.1-8b** | Free (Workers AI) | More capable than 3.2-3b | Free alternative for English summaries |

**Adoption plan**:
1. Refactor `llamarHaiku()` and `llamarWorkersAI()` into a provider-agnostic `llamarModelo(env, contenido, { proveedor, sistema, maxTokens, contador })`.
2. Add provider priority list in `config.js`: `['haiku', 'workers-ai']` — try first, fall back on failure.
3. Add observability: track which provider was used per item in D1 (`modelo` field already exists).

**Cost**: Zero additional subrequests (same 1 call per item, just to a different endpoint). Code complexity is the only cost.

**Benefit**: Resilience against Anthropic outages. Cost optimization (could route English summaries to Workers AI for free). Provider-agnostic architecture enables future experimentation.

**Risk**: Low-medium. Different providers have different output formats and quality. The structured output format (`RELEVANCIA: ... RESUMEN: ...`) must be tested with each provider. Workers AI llama-3.2-3b quality for Spanish summarization is unverified in production (only tested via `/comparar`).

**Verdict**: **Recommended with phased rollout.** Start with provider abstraction + Haiku fallback to Workers AI. Add OpenAI/Gemini only if metrics show it would reduce cost meaningfully.

---

### 2.7 Per-Language Enrichment ❌ NOT RECOMMENDED

**What it is**: Horizon makes N×M AI calls (N items × M languages) in an enrichment phase, generating localized `ContentArtifact` blocks per language. This is Horizon's most expensive phase.

**Cost impact on El Radar**:

If El Radar added a second language (English) with the same pattern:
- Current: ~5 Haiku calls per batch (1 per published item, Spanish)
- After: ~10 Haiku calls per batch (1 per item × 2 languages)
- Peak scenario (all 5 sources yield items): 10 Haiku calls + existing overhead = **40-50 subrequests** → **exceeds budget**

**Why not recommended**:
1. **Doubles the most expensive resource** (Haiku API calls, which are both subrequests AND paid).
2. **The 50-subrequest budget is already tight at peak.** Adding 5 more subrequests per batch would cause more `cortadoPorPresupuesto` events.
3. **Horizon's programmatic summary (free) offsets its expensive enrichment.** El Radar has no equivalent free rendering step.
4. **Alternative approach exists**: Change the language instruction in the prompt (see §2.3) instead of making separate calls. This is Horizon's `target_language_instruction()` pattern — same cost, different output language.

**Verdict**: **Not recommended.** Use `target_language_instruction()` pattern (§2.3) instead — change the prompt language, not the number of calls. If truly bilingual output is needed, consider separate digest editions (Spanish digest at 07:00 UTC, English digest at 19:00 UTC) rather than doubling per-item calls.

---

### 2.8 Web-Search Enrichment ❌ NOT RECOMMENDED

**What it is**: Horizon's `ContentEnricher` makes tool-execution calls (web search) to gather background context, then generates per-language enriched content blocks.

**Cost impact**: Each web search = 1 subrequest (fetch to search API). Each enrichment AI call = 1 subrequest. With 10 published items: +10 search subrequests + +10 enrichment AI calls = **+20 subrequests per batch** → **immediately exceeds budget**.

**Why not recommended**:
1. **El Radar already has a form of enrichment**: "related" context from semantic memory (the 0.65 threshold). This costs zero additional subrequests beyond what's already spent on Vectorize queries.
2. **Web search adds external dependency risk.** Search APIs can be slow, blocked, or change pricing.
3. **Context quality is unpredictable.** Web search results may include SEO spam, outdated info, or the very article being summarized.
4. **Budget would require a separate queue.** Enrichment would need its own queue message type, adding architectural complexity for marginal benefit.

**Verdict**: **Not recommended for now.** Revisit if: (a) Vectorize-based "related" context proves insufficient AND (b) El Radar moves to a paid Workers plan (higher subrequest limit) AND (c) a concrete example of a news story that needs web-search background can be demonstrated.

---

### 2.9 Programmatic Markdown Rendering △ ADAPTABLE (partial)

**What it is**: Horizon's `DailySummarizer` renders summaries as Markdown from pre-generated artifacts — zero AI calls. The LABELS dict provides complete i18n.

**El Radar current state**: `paginas.js:renderDigest()` renders server-side HTML directly.

**What's adoptable**:
- **LABELS pattern for i18n** (see §2.2) — directly adoptable
- **The idea of programmatic rendering from artifacts** — El Radar already does this (the HTML is built from JSON items, not LLM output)

**What's different**:
- Horizon renders Markdown; El Radar renders HTML. Both are programmatic, so Horizon doesn't offer a substantially different approach here.
- Horizon enriches items with per-language artifacts; El Radar has single-language summaries.

**Verdict**: **LABELS pattern directly adoptable** (§2.2). The overall rendering approach is already comparable — both systems do programmatic rendering from structured data. No architectural change needed.

---

## 3. Integration Priority Matrix

| # | Technique | Subrequest Cost | AI Cost | Code Effort | Risk | Priority |
|---|-----------|----------------|---------|-------------|------|----------|
| 1 | URL Normalization | 0 | $0 | ~30 LOC | Low | **P0 — Quick Win** |
| 2 | LABELS i18n | 0 | $0 | ~100 LOC | Low | **P1 — Forward-looking** |
| 3 | target_language_instruction | 0 | $0 (same call) | ~10 LOC | Medium | **P1 — Test quality first** |
| 4 | Multi-Provider AI | 0 (same call) | Lower | ~50 LOC | Medium | **P2 — Resilience** |
| 5 | Per-Profile Dedup | N/A (product decision) | — | — | — | Defer |
| 6 | LLM Topic Dedup | +1 | +$0.002 | ~100 LOC | High | ❌ Not recommended |
| 7 | Per-Language Enrichment | +N | +$0.01/day | ~200 LOC | High | ❌ Not recommended |
| 8 | Web-Search Enrichment | +2N | +$0.02/day | ~300 LOC | Critical | ❌ Not recommended |
| 9 | Markdown Rendering | 0 | $0 | ~50 LOC | Low | Already comparable |

---

## 4. Recommended Implementation Roadmap

### Phase 1: Quick Wins (This Sprint)
1. **URL normalization** — `normalizarLink()` function, apply to `vistos` Set, `buscarObjetivoFusion()`, and KV storage.
2. **LABELS extraction** — Move all UI strings from `paginas.js` to a `LABELS` object in `config.js`.

### Phase 2: Bilingual Support (Next Sprint)
3. **target_language_instruction** — Parameterize language in `SISTEMA_RESUMEN`, add `?lang=en` query parameter, test English output quality with a few items first.

### Phase 3: Resilience (Later)
4. **Multi-provider AI** — Abstract provider, add Haiku → Workers AI fallback, track in D1.

### Phase 4: Revisit if Constraints Change
- **Per-language enrichment**: Only if moving to paid Workers plan (higher subrequest limit) AND bilingual demand is proven.
- **Web-search enrichment**: Only if Vectorize-based context proves insufficient.
- **Per-profile dedup**: Only if El Radar expands to multiple domains.

---

## 5. Cost/Benefit Summary

### Direct Adoptions (3 techniques)
- **Total subrequest cost**: 0
- **Total AI cost**: $0
- **Total code**: ~140 LOC
- **Benefit**: Catches more duplicates (URL normalization), enables future i18n (LABELS), enables English summaries without doubling calls (language instruction).

### Adaptations (3 techniques)
- **Total subrequest cost**: 0 (multi-provider) to N (language enrichment)
- **Total AI cost**: $0 to ~$0.01/day
- **Total code**: ~200-300 LOC
- **Benefit**: Provider resilience, cost optimization, bilingual editions.

### Not Recommended (3 techniques)
- **Saved subrequest cost**: 20-30 per batch (preventing budget exhaustion)
- **Saved AI cost**: ~$0.03/day
- **Rationale**: El Radar's current embedding-based dedup and single-call summarization are the right design for edge deployment.

---

## 6. The Big Picture

Horizon and El Radar converged on the same pipeline architecture (Fetch → Dedup → Score → Summarize → Deliver) but optimized for different environments. Horizon optimized for **depth** (multi-language, multi-provider, enrichment, profiles) on a long-running Python process with no subrequest budget. El Radar optimized for **constraint** (50 subrequests, 30s CPU, edge deployment) with embedding-based dedup, single-call summarization, and queue-based batching.

The best integrations from Horizon are the ones that don't cost subrequests: URL normalization, i18n patterns, and provider abstraction. The expensive techniques (LLM dedup, per-language enrichment, web search) are interesting ideas that don't fit within Cloudflare Workers free-tier constraints — but the architectural patterns behind them are worth understanding, as they may become relevant if El Radar ever moves to a paid plan or a non-Workers runtime.
