---
titulo: "Attention Is All You Need: the seed of modern generative AI"
resumen: "The 2017 paper that changed the paradigm: from reading word by word to having every word consult every other word at once."
estado: pruebas
unidad: "U-02"
serie: fundamentos
lang: en
fecha: 2026-07-16
---

## The problem: reading in single file

Before 2017, almost all language processing relied on RNNs and their more
robust variant, LSTMs. They work sequentially: they read the sentence word
by word, updating a single "state" at each step that gets carried all the
way to the end.

```
"the"  →  "cat"  →  "sleeps"  →  ...  →  final state
```

If you know distributed systems, this should sound familiar: it's a
single-threaded pipeline. Each step can only start once the previous one
finishes, and all the information in the sentence has to survive
compressed inside that single, constantly rewritten state. The longer the
sentence, the more whatever was at the beginning gets diluted — the
linguistic equivalent of the *vanishing gradient*: the signal fades out as
it passes through more steps.

Two direct consequences:

- **It can't be parallelized.** Step 10 depends on step 9, which depends
  on step 8... There's no way to split the computation across several
  GPUs at once for the same sentence, so training is slow.
- **Long-range dependencies get lost.** If the subject of a sentence is
  30 words away from the verb that needs it, that relationship has to
  survive 30 steps of state-rewriting, compressed the whole way. In
  practice, it degrades.

The paper by Vaswani et al. (Google Brain, 2017) starts from an
uncomfortable question: **what if we get rid of sequentiality entirely?**

## The twist: everyone talks to everyone at once

The paper's answer is the *Transformer* architecture, and its central
piece is the **attention** mechanism (hence the title: *attention is all
you need*).

Instead of a pipeline where each token waits its turn, every token queries
**directly and in parallel** every other token in the sentence to decide
how much it should care about each one. It's the same leap that separates
a system where nodes communicate in a chain from one where any node can
query any other node directly, all at once:

```
RNN (sequential):        the → cat → sleeps

Transformer (attention):    the
                            ╱ │ ╲
                        cat ─┼─ sleeps
                            ╲ │ ╱
                    (every token queries every other token in parallel)
```

Nothing gets lost along the way because nothing has to *travel* along the
way: any token can look directly at any other, whether it's one word away
or a hundred.

## Why it's needed: the ambiguity attention resolves

Before getting into the mechanics, it's worth seeing *what* concrete
problem attention solves. Take this word:

> "We saw the **bank** from the riverside."
> "The **bank** approved my loan."

Same word, completely different meaning. A human resolves it without
thinking: they look at the rest of the sentence — "riverside" in one case,
"loan" in the other — and use that to decide what "bank" means *in that
context*.

That's literally what attention does: each word builds its meaning by
consulting, with different weights, the other words in the sentence.
"Bank" doesn't have a fixed meaning stored in a lookup table; its
representation gets recomputed every time based on its context.

## The math, with real weight but still digestible

This is where most explanations stop at the metaphor. Let's go one step
further, with a small example you can follow by hand.

Each token isn't compared directly against the others: first it's
projected into three separate vectors, called **Query**, **Key**, and
**Value** (Q, K, V). The most intuitive way to see it is as a search:

- **Query**: what this token is "asking" — what kind of information it
  needs.
- **Key**: the "label" each token offers itself up to be found by.
- **Value**: the actual content that token contributes if it's chosen.

It's literally a search mechanism: your Query gets compared against every
available Key, and you walk away with a blend of the Values, weighted by
how well each Key matched your Query.

In a real Transformer, Q, K, and V come from multiplying each word's
embedding by three weight matrices (W_Q, W_K, W_V) learned during
training. To keep the calculation doable by hand, this example simplifies
things and uses the embedding directly as Q, K, and V all at once — the
mechanics that matter (dot product, scaling, softmax, weighted sum) are
exactly the same.

Take the sentence "the cat sleeps", with toy 2-dimensional embeddings:

```python
x_the    = [1, 0]
x_cat    = [0, 1]
x_sleeps = [1, 1]
```

To compute the new representation of "cat" after attention:

**1. Dot product of its Query against every Key** (how similar they are):

```
score(cat, the)    = [0,1]·[1,0] = 0
score(cat, cat)    = [0,1]·[0,1] = 1
score(cat, sleeps) = [0,1]·[1,1] = 1
```

**2. Scaling** by √d_k (d_k = dimension of the vectors; here, in the toy
example, 2, so √2 ≈ 1.41 — in the real Transformer, with 8 heads splitting
512 dimensions, d_k = 64). Without this scaling, in large vectors the dot
products grow large, the softmax saturates — nearly all the weight lands
on a single word — and its gradients shrink to almost nothing: the same
*vanishing gradient* we already saw with RNNs, now ambushing us from
inside the very mechanism that was supposed to fix it:

```
0 / 1.41 = 0.00
1 / 1.41 = 0.71
1 / 1.41 = 0.71
```

**3. Softmax** — turns those scores into weights that sum to 1 (how much
"attention" "cat" pays to each word):

```
weights ≈ [0.20, 0.40, 0.40]   # the, cat, sleeps
```

**4. Weighted sum of the Values** using those weights:

```
output_cat = 0.20·[1,0] + 0.40·[0,1] + 0.40·[1,1]
           = [0.60, 0.80]
```

The result, `[0.60, 0.80]`, is the new representation of "cat" — it's no
longer just "cat" in the abstract, it's "cat" *after looking at its
context*: 40% comes from itself, 40% from "sleeps" (the verb it's the
subject of), and only 20% from the article "the", which contributes
little information. The model doesn't know grammar — but the resulting
weight pattern ends up looking a lot like what a linguist would underline
by hand.

## Try it yourself: attention live

The example above was computed by hand for "cat". Here you can recompute
it for all three words and watch the weights change — same toy
embeddings, same calculation, live:

<div class="attn-demo" id="attn-demo">
  <div class="attn-demo-pick">
    <span class="attn-demo-label">Query:</span>
    <button type="button" class="attn-tok" data-tok="0">the</button>
    <button type="button" class="attn-tok" data-tok="1">cat</button>
    <button type="button" class="attn-tok" data-tok="2">sleeps</button>
  </div>
  <div class="attn-demo-rows" id="attn-demo-rows"></div>
  <div class="attn-demo-out">
    <span class="attn-demo-label">output =</span>
    <code id="attn-demo-out-vec">—</code>
  </div>
</div>

<script>
(function () {
  const emb = { 0: [1, 0], 1: [0, 1], 2: [1, 1] };
  const names = { 0: 'the', 1: 'cat', 2: 'sleeps' };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const root = document.getElementById('attn-demo');
  if (!root) return;
  const rows = root.querySelector('#attn-demo-rows');
  const outVec = root.querySelector('#attn-demo-out-vec');
  const buttons = [...root.querySelectorAll('.attn-tok')];

  function render(qIdx) {
    buttons.forEach((b) => b.classList.toggle('is-active', Number(b.dataset.tok) === qIdx));
    const q = emb[qIdx];
    const scaled = [0, 1, 2].map((k) => dot(q, emb[k]) / Math.SQRT2);
    const expv = scaled.map((s) => Math.exp(s));
    const sum = expv.reduce((a, b) => a + b, 0);
    const weights = expv.map((e) => e / sum);
    const out = [0, 1].map((d) => weights.reduce((acc, w, k) => acc + w * emb[k][d], 0));

    rows.innerHTML = [0, 1, 2].map((k) => `
      <div class="attn-demo-row">
        <span class="attn-demo-name">${names[k]}</span>
        <div class="attn-demo-bar"><div class="attn-demo-bar-fill" style="width:${(weights[k] * 100).toFixed(0)}%"></div></div>
        <span class="attn-demo-pct">${(weights[k] * 100).toFixed(0)}%</span>
      </div>
    `).join('');
    outVec.textContent = `[${out[0].toFixed(2)}, ${out[1].toFixed(2)}]`;
  }

  buttons.forEach((b) => b.addEventListener('click', () => render(Number(b.dataset.tok))));
  render(1);
})();
</script>

## Multi-head attention: several observers at once

A single attention pass captures one type of relationship. But language
has several layers of relationship happening simultaneously: syntactic
("sleeps" agrees with "cat"), referential (what "it" refers to), thematic
(what the sentence is about)...

The paper's solution is to run **several attention heads in parallel**
(the original Transformer uses eight), each with its own independently
learned W_Q/W_K/W_V matrices. It's, again, the same distributed logic:
instead of a single observer trying to capture everything at once, several
specialized observers look at the same sentence from different angles, in
parallel, and their results get combined at the end.

## Encoder and decoder: two halves with different jobs

So far we've talked about "attention" in the abstract, but the original
paper isn't solving an abstract problem: it's solving machine translation
("the cat sleeps" → "el gato duerme"). For that, the Transformer is
organized into two halves with different jobs, each stacked 6 times:

- **The encoder** reads the full input sentence (in English) and produces
  an enriched representation of each word, with the context of the whole
  sentence already baked in. It's the attention block we've seen so far:
  every token consults every other token, without restriction, because
  the whole sentence is already available at once.
- **The decoder** generates the output sentence (in Spanish) word by word,
  and at each step makes two separate queries: first to what it has
  already generated itself, and then to the encoder, to decide which part
  of the original sentence to focus on in order to produce the next word.

Each block — encoder or decoder — isn't just attention: it's attention
followed by a **feed-forward network** (two linear layers with a ReLU in
between — 512 → 2048 → 512 in the original Transformer — applied to each
position separately, with the same weights for all of them), and each of
the two pieces is wrapped in a **residual connection + normalization**
("Add & Norm"): the layer's output gets added to its own input before
being normalized. It's the same trick that prevents the *vanishing
gradient* in very deep networks — here with 6 stacked layers on each
side — each layer only has to learn a *correction* on top of what it
already had, not rebuild the whole signal from scratch.

![Transformer encoder-decoder architecture, with masked attention and cross-attention](/images/transformer-arquitectura.svg)

Two details that tend to cause confusion:

- **The decoder's attention is "masked".** When generating word number 5,
  the decoder can't consult words 6, 7, 8... because at generation time
  they don't exist yet — it's autoregressive, just like the RNN we were
  replacing. It's the same principle as a commit log: you can read
  everything that's already committed, never what hasn't been written
  yet. That's why it's called *masked* self-attention: the score of a
  token against any future token is forced to `-∞` before the softmax, so
  its weight ends up being exactly 0.
- **Cross-attention is where the actual translation happens.** There, the
  Query comes from the decoder ("what do I need to generate the next word
  in Spanish?"), but the Key and Value come from the encoder ("this is
  what the English sentence says"). It's the same Q/K/V mechanics as
  before, except the three no longer come from the same sentence.

## Watching it move

The diagrams above are static. This one isn't: hit "Step" and follow the
data climbing block by block through the encoder, and then how the
decoder generates the translation word by word, reusing the same K, V the
encoder computed just once.

<div class="flow-demo" id="flow-demo">
  <div class="flow-demo-caption" id="flow-caption">Hit "Step" to begin.</div>
  <div class="flow-demo-grid">
    <div class="flow-col">
      <div class="flow-col-title">ENCODER</div>
      <div class="flow-box" data-id="enc-an2">Add &amp; Norm</div>
      <div class="flow-box" data-id="enc-ff">Feed Forward</div>
      <div class="flow-box" data-id="enc-an1">Add &amp; Norm</div>
      <div class="flow-box" data-id="enc-mha">Multi-Head Attention</div>
      <div class="flow-box" data-id="enc-emb">Input Embedding<br><span class="flow-sub">"the cat sleeps"</span></div>
    </div>
    <div class="flow-mid">
      <div class="flow-kv" data-id="kv-arrow">K, V →</div>
    </div>
    <div class="flow-col">
      <div class="flow-col-title">DECODER</div>
      <div class="flow-box" data-id="dec-softmax">Linear + Softmax</div>
      <div class="flow-box" data-id="dec-an-c">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-ff">Feed Forward</div>
      <div class="flow-box" data-id="dec-an-b">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-cross">Cross-Attention</div>
      <div class="flow-box" data-id="dec-an-a">Add &amp; Norm</div>
      <div class="flow-box" data-id="dec-masked">Masked Attention</div>
      <div class="flow-box" data-id="dec-emb">Output Embedding<br><span class="flow-sub" id="flow-dec-input">&lt;start&gt;</span></div>
    </div>
  </div>
  <div class="flow-demo-output">Generated: <span id="flow-output">—</span></div>
  <div class="flow-demo-controls">
    <button type="button" id="flow-step">Step ▶</button>
    <button type="button" id="flow-play">▶ Play</button>
    <button type="button" id="flow-reset">Reset</button>
  </div>
</div>

<script>
(function () {
  const root = document.getElementById('flow-demo');
  if (!root) return;
  const caption = root.querySelector('#flow-caption');
  const output = root.querySelector('#flow-output');
  const decInput = root.querySelector('#flow-dec-input');
  const boxes = [...root.querySelectorAll('.flow-box')];
  const kvArrow = root.querySelector('.flow-kv');
  const btnStep = root.querySelector('#flow-step');
  const btnPlay = root.querySelector('#flow-play');
  const btnReset = root.querySelector('#flow-reset');

  const tokens = ['el', 'gato', 'duerme'];

  function decoderCycle(tokenIdx) {
    const soFar = tokens.slice(0, tokenIdx);
    const inputLabel = soFar.length ? soFar.join(' ') : '<start>';
    const frames = [
      { hl: ['dec-emb'], kv: false, cap: `The decoder receives what's been generated so far: "${inputLabel}".`, dec: inputLabel },
      { hl: ['dec-masked'], kv: false, cap: 'Masked self-attention: it can only look at the words it has already generated itself, never future ones.', dec: inputLabel },
      { hl: ['dec-an-a'], kv: false, cap: 'Add & Norm over the masked attention output.', dec: inputLabel },
      { hl: ['dec-cross'], kv: true, cap: 'Cross-attention: the Query comes from here, the Key and Value are the ones the encoder computed — reused without recomputing.', dec: inputLabel },
      { hl: ['dec-an-b'], kv: false, cap: 'Add & Norm over the cross-attention output.', dec: inputLabel },
      { hl: ['dec-ff'], kv: false, cap: 'Feed-forward: each position is processed separately.', dec: inputLabel },
      { hl: ['dec-an-c'], kv: false, cap: 'Final Add & Norm for this decoder block.', dec: inputLabel },
      { hl: ['dec-softmax'], kv: false, cap: `Linear + Softmax picks the next word → "${tokens[tokenIdx]}".`, dec: inputLabel, reveal: tokenIdx + 1 },
    ];
    return frames;
  }

  const frames = [
    { hl: ['enc-emb'], kv: false, cap: 'The encoder receives "the cat sleeps" — positional encoding gets added to each embedding.', dec: '<start>' },
    { hl: ['enc-mha'], kv: false, cap: 'Self-attention: every token consults every other one (the same calculation from the "cat" example above).', dec: '<start>' },
    { hl: ['enc-an1'], kv: false, cap: 'Add & Norm: the original input (residual) is added back in and normalized.', dec: '<start>' },
    { hl: ['enc-ff'], kv: false, cap: 'Feed-forward: each position is processed separately with the same network.', dec: '<start>' },
    { hl: ['enc-an2'], kv: false, cap: "Final Add & Norm for the encoder. This output won't change again.", dec: '<start>' },
    { hl: [], kv: true, cap: 'The encoder hands K and V to the decoder — computed once and reused for every word the decoder generates.', dec: '<start>' },
    ...decoderCycle(0),
    ...decoderCycle(1),
    ...decoderCycle(2),
    { hl: ['dec-softmax'], kv: false, cap: 'Full sentence: "el gato duerme". Hit Reset to watch it again.', dec: tokens.join(' '), reveal: 3 },
  ];

  let i = -1;
  let playing = false;
  let timer = null;

  function render() {
    boxes.forEach((b) => b.classList.toggle('is-active', i >= 0 && frames[i].hl.includes(b.dataset.id)));
    kvArrow.classList.toggle('is-active', i >= 0 && frames[i].kv);
    caption.textContent = i >= 0 ? frames[i].cap : 'Hit "Step" to begin.';
    decInput.textContent = i >= 0 ? frames[i].dec : '<start>';
    const revealCount = i >= 0 ? (frames[i].reveal || 0) : 0;
    output.textContent = revealCount > 0 ? tokens.slice(0, revealCount).join(' ') : '—';
  }

  function step() {
    if (i >= frames.length - 1) {
      stop();
      return;
    }
    i += 1;
    render();
  }

  function stop() {
    playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    btnPlay.textContent = '▶ Play';
  }

  btnStep.addEventListener('click', () => {
    stop();
    step();
  });

  btnPlay.addEventListener('click', () => {
    if (playing) {
      stop();
      return;
    }
    playing = true;
    btnPlay.textContent = '❚❚ Pause';
    timer = setInterval(step, 900);
  });

  btnReset.addEventListener('click', () => {
    stop();
    i = -1;
    render();
  });

  render();
})();
</script>

This clears up something the article glossed over earlier: **not every
current model uses both halves.** BERT is encoder-only (bidirectional,
built to *understand* text, not generate it). GPT and Claude are
decoder-only — with their masked attention — used on their own, with no
cross-attention because there's no separate "source sentence": the model
only ever consults itself, predicting the next token from everything it
has already written. The original paper, with both full halves, was still
built for translation; the leap to "a single decoder that generates
anything" came later, with GPT.

## Positional encoding: recovering order without sequence

Here's a problem the design itself creates: if every token consults every
other token at once, how does the model know that "dog bites man" is
different from "man bites dog"? Attention, as described so far, is blind
to order.

It's exactly the same problem **vector clocks** solve in distributed
systems: when there's no global clock and no guaranteed arrival order, you
need to explicitly inject a marker that encodes each event's relative
position. The Transformer does the same thing with *positional encoding*:
a vector encoding its position in the sentence (using sine/cosine
functions of different frequencies) gets added to each embedding before
any attention calculation begins. It's not that the model "remembers" the
order while processing — the way an RNN would — it's that the order gets
baked into the data itself, once, at the very start.

The paper also tried the more obvious alternative — treating position as
just another embedding, learned during training — and got nearly
identical results. They stuck with sine/cosine as a bet on the future: in
theory, it lets the model extrapolate to sentences longer than any it saw
during training.

## Why this unblocked everything

| | RNN / LSTM | Transformer |
|---|---|---|
| Processing | Sequential, step by step | Parallel, all tokens at once |
| Long-range dependencies | Degrade with distance | Direct connection, regardless of distance |
| Training | Slow, hard to parallelize | Fast on GPU/TPU, highly parallelizable |
| Scalability | Limited | Models with billions of parameters |

Parallelization isn't a minor engineering detail: it's what made it
possible to train on orders of magnitude more data and more parameters in
a reasonable amount of time. Without it, there would be no GPT, no BERT,
no Claude as we know them.

The paper's own numbers confirm it: its large model reached 28.4 BLEU on
English-German translation and 41.8 on English-French — beating the
previous state of the art — trained in 3.5 days on 8 GPUs. For a task
that used to be measured in weeks of training, that speed jump was as
newsworthy as the improvement in translation quality.

In 2017 this looked like just another academic paper, with good results
on machine translation. In 2026 that same architecture is in your phone,
in your browser, in the tools you use every day. It's not that there was
no AI before — there was, and it looked quite different: specialized
models for each task. What changes with this paper is that, for the first
time, a single general architecture — the Transformer, built entirely on
attention — becomes the reusable foundation for almost everything we now
call generative AI.

## Reference

Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez,
A. N., Kaiser, Ł., & Polosukhin, I. (2017). *Attention Is All You Need*.
[arXiv:1706.03762](https://arxiv.org/abs/1706.03762).

## Field notes

*(This is where I document my own doubts and findings while writing this:
which parts of the distributed-systems analogy hold up best under
scrutiny, what questions you all asked me after reading it, what I'd save
for a second piece on the full Transformer architecture...)*
