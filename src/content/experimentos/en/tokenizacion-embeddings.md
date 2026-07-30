---
titulo: "Tokenization and embeddings: the model's front door"
resumen: "Third module of the 'Inside LLMs' series: how text gets chopped up before the model sees any of it, why writing in Spanish costs you 45% more, and what actually happens in the first layer."
estado: pruebas
unidad: "U-09"
serie: fundamentos
lang: en
fecha: 2026-07-28
---

The previous post in this series ([What is latent space?](/lab/01-espacio-latente), Spanish only for now) took the first step for granted: that a word becomes a vector. Time to open that box, because inside it there are two distinct operations that almost always get told as if they were one.

1. **Tokenization**: splitting text into chunks and assigning each chunk an integer. It is deterministic, has nothing to learn at inference time, and does not use the neural network at all.
2. **Embedding**: turning each of those integers into a dense vector. It is a table lookup — a table that *was* learned during training.

The distinction sounds like a nitpick and it isn't. Nearly every odd LLM behaviour we tend to blame on the model's "reasoning" —not being able to count the letters in a word, Spanish costing more than English, long numbers going wrong— happens in step 1, before the network has seen anything whatsoever.

<figure class="fig-svg">
<svg viewBox="0 0 760 200" role="img" aria-label="Diagram of the path text takes: tokenizer, integer ids, embedding table, positional information and attention layers">
  <defs>
    <marker id="fl-en" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#8a97a5"/>
    </marker>
  </defs>
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="8" y="20" fill="#8a97a5" font-size="10" letter-spacing="1.2">NO NEURAL NETWORK</text>
    <text x="400" y="20" fill="#ffb454" font-size="10" letter-spacing="1.2">LEARNED PARAMETERS</text>
    <line x1="380" y1="8" x2="380" y2="192" stroke="#2c333d" stroke-width="1" stroke-dasharray="4 4"/>
    <rect x="8" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="64" y="82" fill="#e9e5da" text-anchor="middle">"the cat"</text>
    <text x="64" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">text</text>
    <rect x="150" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="206" y="82" fill="#e9e5da" text-anchor="middle">the · cat</text>
    <text x="206" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">tokenizer (BPE)</text>
    <rect x="292" y="60" width="76" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="330" y="82" fill="#e9e5da" text-anchor="middle" font-size="10">[1820, 8415]</text>
    <text x="330" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">ids</text>
    <rect x="400" y="60" width="112" height="52" rx="3" fill="#1a1f26" stroke="#ffb454"/>
    <text x="456" y="82" fill="#ffb454" text-anchor="middle">E[ids]</text>
    <text x="456" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">embedding table</text>
    <rect x="542" y="60" width="94" height="52" rx="3" fill="#1a1f26" stroke="#2c333d"/>
    <text x="589" y="82" fill="#e9e5da" text-anchor="middle">+ position</text>
    <text x="589" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">RoPE</text>
    <rect x="666" y="60" width="86" height="52" rx="3" fill="#1a1f26" stroke="#ffb454"/>
    <text x="709" y="82" fill="#ffb454" text-anchor="middle">attention</text>
    <text x="709" y="99" fill="#8a97a5" font-size="9" text-anchor="middle">× N layers</text>
    <line x1="122" y1="86" x2="146" y2="86" stroke="#8a97a5" marker-end="url(#fl-en)"/>
    <line x1="264" y1="86" x2="288" y2="86" stroke="#8a97a5" marker-end="url(#fl-en)"/>
    <line x1="370" y1="86" x2="396" y2="86" stroke="#8a97a5" marker-end="url(#fl-en)"/>
    <line x1="514" y1="86" x2="538" y2="86" stroke="#8a97a5" marker-end="url(#fl-en)"/>
    <line x1="638" y1="86" x2="662" y2="86" stroke="#8a97a5" marker-end="url(#fl-en)"/>
    <text x="8" y="150" fill="#8a97a5" font-size="10">This post covers the first four blocks: everything that happens</text>
    <text x="8" y="166" fill="#8a97a5" font-size="10">before the work the rest of the series talks about even begins.</text>
  </g>
</svg>
<figcaption>The full path. The important boundary is not the visual one: to the left of it nothing has been learned — it's just a compression algorithm.</figcaption>
</figure>

## Why we don't split on words

The intuitive option is to split on spaces: one token, one word. Nobody does it, for three reasons.

The first is vocabulary size. If every word needs its own entry in the table, Spanish alone demands hundreds of thousands of entries just for conjugated verb forms: *comer*, *como*, *comes*, *comía*, *comeríamos*, *comiéndoselo*. Each entry is a row of the embedding matrix, and that matrix also gets multiplied at the end of the model to produce output probabilities. A large vocabulary means an expensive model at both ends.

The second is that there will always be a word that isn't on the list. Proper nouns, typos, new terms, source code. A closed word-level vocabulary turns all of that into the same `<UNK>` token, and the information is gone before you start. This is, literally, the problem the foundational BPE-for-NLP paper set out to solve: it is called [*Neural Machine Translation of Rare Words with Subword Units*](https://arxiv.org/abs/1508.07909) (Sennrich, Haddow and Birch, ACL 2016), and its stated goal was **open-vocabulary translation**.

The third reason is the opposite one: splitting on characters solves both problems —tiny vocabulary, nothing left out— but makes sequences much longer. And since attention costs scale with the square of the length (we covered this in the [Attention post](/en/lab/attention-is-all-you-need)), multiplying the number of positions by five multiplies the cost of every attention layer by twenty-five.

The consensus solution sits in the middle: **subwords**. Frequent words get a single token; rare ones decompose into chunks that have been seen before. Nothing falls outside the vocabulary, and sequences don't explode.

## BPE: the algorithm, and why it is so dumb

The most widespread method is **Byte Pair Encoding**. Its origin has nothing to do with natural language: it is a compression algorithm Philip Gage published in 1994 in *The C Users Journal*, which Sennrich et al. repurposed twenty-two years later to chop up words. The whole idea fits in one sentence: *find the most frequent adjacent pair of symbols in the corpus, merge it into a new symbol, and repeat N times*.

```python
from collections import Counter

def train_bpe(corpus, n_merges):
    # Every word starts split into individual characters
    vocab = {tuple(word): freq for word, freq in Counter(corpus).items()}
    merges = []

    for _ in range(n_merges):
        pairs = Counter()
        for symbols, freq in vocab.items():
            for i in range(len(symbols) - 1):
                pairs[symbols[i], symbols[i + 1]] += freq

        if not pairs:
            break

        best = pairs.most_common(1)[0][0]      # the most frequent pair
        merges.append(best)
        vocab = {apply(symbols, best): freq for symbols, freq in vocab.items()}

    return merges                              # order matters: they are applied in sequence
```

What matters about this algorithm is what it does **not** do. It doesn't know what a root is, or a suffix, or a syllable. It doesn't know Spanish grammar, or that words exist. It just counts byte pairs. That the result often resembles real morphology —splitting `com` + `ing`— is a statistical accident: suffixes are frequent, so they get merged early. When it fails to match morphology, nothing breaks either; the model learns to work with whatever chunks it is handed.

**Merges are always applied in the order they were learned**, and that is the key to understanding the output. A token cannot exist unless every piece it is built from exists first.

It's worth noting BPE isn't the only option. [SentencePiece](https://arxiv.org/abs/1808.06226) (Kudo and Richardson, 2018) was the first to train directly on raw text, without assuming words come separated by spaces — which in Japanese or Chinese simply isn't the case. And Kudo's **unigram** algorithm attacks the same problem from the opposite end: instead of starting from characters and merging upward, it starts from a huge vocabulary and prunes the units that contribute least. In practice, almost every model you use today is BPE or some variant of it.

## Try it: BPE step by step

Below is a toy BPE trained on a tiny corpus of Spanish words (`gato` — cat, `gatos` — cats, `perro` — dog, `casa` — house…). It has exactly eleven merges, in this order:

`ga` · `to` · `gato` · `os` · `ito` · `ca` · `sa` · `casa` · `pe` · `rr` · `perr`

Pick a word and apply merges one at a time. Watch which ones end up as a single token and which get shredded:

<div class="tok-demo" id="tok-demo">
  <div class="tok-demo-palabras" id="tok-demo-palabras"></div>
  <div class="tok-demo-tokens" id="tok-demo-tokens"></div>
  <div class="tok-demo-regla" id="tok-demo-regla">Press "next merge" to start.</div>
  <div class="tok-demo-controles">
    <button type="button" id="tok-demo-siguiente">next merge →</button>
    <button type="button" id="tok-demo-todo">apply all</button>
    <button type="button" id="tok-demo-reset">reset</button>
  </div>
  <div class="tok-demo-out" id="tok-demo-out"></div>
</div>

<script>
(function () {
  const root = document.getElementById('tok-demo');
  if (!root) return;
  const MERGES = [
    ['g', 'a'], ['t', 'o'], ['ga', 'to'], ['o', 's'], ['i', 'to'],
    ['c', 'a'], ['s', 'a'], ['ca', 'sa'], ['p', 'e'], ['r', 'r'], ['pe', 'rr'],
  ];
  const WORDS = ['gato', 'gatos', 'gatito', 'gatitos', 'casa', 'casas', 'casita', 'perro', 'perros'];
  const elWords = root.querySelector('#tok-demo-palabras');
  const elTokens = root.querySelector('#tok-demo-tokens');
  const elRule = root.querySelector('#tok-demo-regla');
  const elOut = root.querySelector('#tok-demo-out');
  const btnNext = root.querySelector('#tok-demo-siguiente');
  const btnAll = root.querySelector('#tok-demo-todo');
  const btnReset = root.querySelector('#tok-demo-reset');
  let word = 'gatos';
  let step = 0;
  let tokens = [];
  let lastMerge = null;
  // Apply one merge across the whole sequence, left to right.
  function merge(seq, [a, b]) {
    const out = [];
    let changes = 0;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i] === a && seq[i + 1] === b) {
        out.push(a + b);
        i++;
        changes++;
      } else {
        out.push(seq[i]);
      }
    }
    return { out, changes };
  }
  function reset() {
    tokens = word.split('');
    step = 0;
    lastMerge = null;
    render();
  }
  function next() {
    while (step < MERGES.length) {
      const m = MERGES[step];
      step++;
      const { out, changes } = merge(tokens, m);
      if (changes > 0) {
        tokens = out;
        lastMerge = m;
        render();
        return true;
      }
    }
    lastMerge = null;
    render();
    return false;
  }
  WORDS.forEach((w) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = w;
    b.addEventListener('click', () => {
      word = w;
      [...elWords.children].forEach((c) => c.classList.toggle('is-active', c === b));
      reset();
    });
    if (w === word) b.classList.add('is-active');
    elWords.appendChild(b);
  });
  btnNext.addEventListener('click', next);
  btnAll.addEventListener('click', () => { while (next()) { /* until exhausted */ } });
  btnReset.addEventListener('click', reset);
  function render() {
    elTokens.innerHTML = '';
    tokens.forEach((t) => {
      const span = document.createElement('span');
      span.className = 'tok-chip';
      if (t.length > 1) span.classList.add('is-fusionado');
      span.textContent = t;
      elTokens.appendChild(span);
    });
    const done = step >= MERGES.length;
    elRule.textContent = lastMerge
      ? `merge applied: "${lastMerge[0]}" + "${lastMerge[1]}" → "${lastMerge[0] + lastMerge[1]}"`
      : done
        ? 'no applicable merges left: this is the final split.'
        : 'press "next merge" to start.';
    btnNext.disabled = done;
    btnAll.disabled = done;
    elOut.innerHTML = `<code>"${word}"</code> → <code>${tokens.length}</code> token${tokens.length === 1 ? '' : 's'}`;
  }
  reset();
})();
</script>

Three cases are worth comparing:

- **`gato`** ends up as **a single token**. It was in the corpus, it was frequent, and the merges `ga` + `to` → `gato` were learned.
- **`gatos`** ends up as **two**: `gato` + `s`. The `os` merge exists, but it comes after `gato`, and by the time its turn arrives the `o` is already inside another token. Order decides the outcome.
- **`casita`** ends up **shredded** into five tokens, despite being a perfectly ordinary Spanish word. It just wasn't in the tokenizer's corpus, and none of the learned merges fit.

That third case is the one that matters. A tokenizer is not neutral: it is trained on a corpus, it treats well what that corpus contained and badly everything else.

## From toy to reality: actually measuring it

Intuition so far. Let's measure. OpenAI's tokenizers are public through [`tiktoken`](https://github.com/openai/tiktoken), so you can check what happens to Spanish in thirty seconds. I wrote eight sentence pairs —my own translations, mixing technical and everyday language— and counted tokens for each version with two tokenizer generations: `cl100k_base` (GPT-4's) and `o200k_base` (used by later models).

<figure class="fig-svg">
<svg viewBox="0 0 700 210" role="img" aria-label="Bar chart: the same content costs 157 tokens in Spanish and 108 in English with cl100k_base, and 128 versus 108 with o200k_base">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="14" fill="#8a97a5" font-size="10" letter-spacing="1">SAME CONTENT · 8 SENTENCE PAIRS · TOTAL TOKENS</text>
    <text x="0" y="52" fill="#8a97a5" font-size="10">cl100k_base</text>
    <text x="0" y="66" fill="#5c6b7a" font-size="9">GPT-4</text>
    <rect x="96" y="38" width="314" height="17" rx="2" fill="#ffb454"/>
    <text x="418" y="51" fill="#ffb454">157 ES</text>
    <rect x="96" y="60" width="216" height="17" rx="2" fill="#8a97a5"/>
    <text x="320" y="73" fill="#8a97a5">108 EN</text>
    <text x="498" y="62" fill="#ffb454" font-size="13">1.45×</text>
    <text x="0" y="128" fill="#8a97a5" font-size="10">o200k_base</text>
    <text x="0" y="142" fill="#5c6b7a" font-size="9">GPT-4o and later</text>
    <rect x="96" y="114" width="256" height="17" rx="2" fill="#ffb454"/>
    <text x="360" y="127" fill="#ffb454">128 ES</text>
    <rect x="96" y="136" width="216" height="17" rx="2" fill="#8a97a5"/>
    <text x="320" y="149" fill="#8a97a5">108 EN</text>
    <text x="498" y="138" fill="#7adb8f" font-size="13">1.19×</text>
    <line x1="96" y1="170" x2="660" y2="170" stroke="#2c333d"/>
    <text x="0" y="192" fill="#8a97a5" font-size="10">The Spanish penalty halved between one tokenizer generation</text>
    <text x="0" y="205" fill="#8a97a5" font-size="10">and the next. Halved, not removed.</text>
  </g>
</svg>
<figcaption>My own measurement with <code>tiktoken</code>; the full script is at the end of this post. Eight sentence pairs is a small sample: treat it as an order of magnitude, not a benchmark.</figcaption>
</figure>

Two readings. First: with GPT-4's tokenizer, **the same content in Spanish costs 45% more than in English**. Second, more hopeful: with `o200k_base` that penalty drops to 19%. Someone decided to spend vocabulary on covering other languages better, and it shows.

This is not a quirk of my sample. The reference work is [*Language Model Tokenizers Introduce Unfairness Between Languages*](https://proceedings.neurips.cc/paper_files/paper/2023/hash/74bb24dca8334adce292883b4b651eda-Abstract-Conference.html) (Petrov, La Malfa, Torr and Bibi, NeurIPS 2023), which measured 17 tokenizers and found differences of **up to 15×** in the length of the same text depending on language. Spanish, with a Latin alphabet and decent corpus representation, is among the mildest cases. For some languages the penalty is of another order entirely.

And there is a point worth stating plainly, because it is that paper's central argument: since price per token and context window size are **the same for everyone**, this disparity translates directly into some language communities paying more, waiting longer, and fitting less context than others. For the same service.

## Try it: real splits

These are real splits, computed with `tiktoken` and pasted here as-is. Compare each Spanish word against its English equivalent, and compare the two tokenizer generations:

<div class="tok-real" id="tok-real">
  <div class="tok-real-controles">
    <button type="button" data-enc="cl100k_base" class="is-active">cl100k_base (GPT-4)</button>
    <button type="button" data-enc="o200k_base">o200k_base (GPT-4o+)</button>
  </div>
  <table class="tok-real-tabla">
    <thead><tr><th>text</th><th>split</th><th class="num">tokens</th></tr></thead>
    <tbody id="tok-real-cuerpo"></tbody>
  </table>
  <p class="tok-real-nota" id="tok-real-nota"></p>
</div>

<script>
(function () {
  const root = document.getElementById('tok-real');
  if (!root) return;
  // Literal tiktoken output. "␣" marks the leading space: in real text words
  // rarely start a sentence, and the space before them is part of the token.
  const DATA = {
    cl100k_base: [
      [' gato', [' g', 'ato']],
      [' cat', [' cat']],
      [' ferrocarril', [' fer', 'roc', 'arr', 'il']],
      [' railway', [' railway']],
      [' desafortunadamente', [' des', 'afort', 'un', 'adamente']],
      [' unfortunately', [' unfortunately']],
      ['1234567', ['123', '456', '7']],
      ['2026-07-28', ['202', '6', '-', '07', '-', '28']],
    ],
    o200k_base: [
      [' gato', [' gato']],
      [' cat', [' cat']],
      [' ferrocarril', [' fer', 'roc', 'arr', 'il']],
      [' railway', [' railway']],
      [' desafortunadamente', [' desaf', 'ortun', 'adamente']],
      [' unfortunately', [' unfortunately']],
      ['1234567', ['123', '456', '7']],
      ['2026-07-28', ['202', '6', '-', '07', '-', '28']],
    ],
  };
  const NOTES = {
    cl100k_base: 'With GPT-4’s tokenizer, "gato" costs twice what "cat" does, and "ferrocarril" four times what "railway" does.',
    o200k_base: '"gato" now fits in one token, just like "cat". "ferrocarril" is still split into four: the improvement is real but uneven.',
  };
  const body = root.querySelector('#tok-real-cuerpo');
  const note = root.querySelector('#tok-real-nota');
  const buttons = [...root.querySelectorAll('.tok-real-controles button')];
  function paint(enc) {
    body.innerHTML = '';
    DATA[enc].forEach(([text, chunks]) => {
      const tr = document.createElement('tr');
      const tdText = document.createElement('td');
      tdText.className = 'tok-real-texto';
      tdText.textContent = text.replace(/^ /, '␣');
      const tdChunks = document.createElement('td');
      chunks.forEach((c) => {
        const chip = document.createElement('span');
        chip.className = 'tok-chip is-real';
        chip.textContent = c.replace(/^ /, '␣');
        tdChunks.appendChild(chip);
      });
      const tdNum = document.createElement('td');
      tdNum.className = 'num';
      tdNum.textContent = chunks.length;
      if (chunks.length === 1) tdNum.classList.add('is-bueno');
      if (chunks.length >= 4) tdNum.classList.add('is-malo');
      tr.append(tdText, tdChunks, tdNum);
      body.appendChild(tr);
    });
    note.textContent = NOTES[enc];
  }
  buttons.forEach((b) => {
    b.addEventListener('click', () => {
      buttons.forEach((o) => o.classList.toggle('is-active', o === b));
      paint(b.dataset.enc);
    });
  });
  paint('cl100k_base');
})();
</script>

Look at `railway` and `unfortunately`: **one token each**. Their Spanish equivalents, `ferrocarril` and `desafortunadamente`, cost four and three. It isn't that they are rarer words in absolute terms; they were rarer *in the corpus the tokenizer was trained on*.

## Why it can't count the r's

With this data in front of you, an internet classic explains itself:

```
User:   how many r's are in "ferrocarril"?
Model:  Two.
```

The model isn't counting badly. It has **never seen the letters**. It saw four integers — and look where the r's land when you split it:

```
' fer' | 'roc' | 'arr' | 'il'
    ↑     ↑      ↑↑
```

The four r's are spread across three different tokens, and none of them "contains" the concept of the letter r in any accessible way. Asking an LLM to count characters is like asking you to count the pixels in a photo you are looking at: the information is there in some sense, but not in the format in which you perceive it.

The same thing explains arithmetic. Look at `1234567`, split as `123` | `456` | `7`: three-digit groups **left to right**. The addition algorithm we learned at school runs the other way, right to left, carrying as it goes — and with this split the structure of units, tens and hundreds simply doesn't exist in the input. This isn't armchair speculation: [Singh and Strouse (2024)](https://arxiv.org/abs/2402.14903) showed that forcing right-to-left grouping consistently improves arithmetic performance, and models like Llama and PaLM chose to give every digit its own token outright.

And today's date, `2026-07-28`, costs **six tokens**: `202` | `6` | `-` | `07` | `-` | `28`. If you are pushing thousands of ISO dates into an agent's context, there is a cost you probably assumed was free.

## BPE is not the only method

BPE dominates, but it is not alone. The other two families you will meet in production do the same job — splitting into subwords — on different criteria:

| Method | How it decides the vocabulary | Where you'll see it |
|---|---|---|
| **BPE** (byte-level) | Merges the most frequent adjacent pair, greedily and by rank. Starting from the 256 bytes, no word ever falls outside the vocabulary | GPT, Llama, Mistral |
| **WordPiece** | Also merges, but picks the pair that most increases the corpus likelihood rather than the raw most frequent one: it favours pairs whose joint frequency stands out against the product of their parts. Marks continuation with `##` | BERT and its family |
| **Unigram** | The other way round: it starts from a large vocabulary and **prunes** the tokens whose removal costs the least likelihood. It is probabilistic — one string admits several splits with different probabilities | T5, ALBERT, many multilingual models |

Two points almost nobody spells out:

**SentencePiece is not an algorithm, it is a library.** It implements both BPE *and* Unigram, so seeing "SentencePiece" on a model card tells you nothing about which one it uses. Its real contribution is different: treating the input as a raw Unicode stream, with no pre-splitting on whitespace, encoding the space as `▁`. That is what makes it language-agnostic, and it is essential for Japanese, Chinese or Thai, which do not separate words with spaces.

**Unigram being probabilistic enables something BPE cannot do.** Because one string admits several valid splits with different probabilities, you can sample a different one each training epoch as data augmentation — this is [Kudo's (2018)](https://arxiv.org/abs/1804.10959) *subword regularization*. With classic BPE the split is deterministic and that door is closed.

### And with Claude you can't look

Everything measured here comes from `tiktoken` because OpenAI publishes its vocabularies. **Anthropic does not publish Claude's**: there is no merge file to inspect and no way to tokenize locally. You count by calling the API's `count_tokens` endpoint — and estimating with `tiktoken` doesn't work, since it belongs to a different provider and undercounts.

The detail worth keeping: **the count is model-specific, and it changes between versions**. Claude Opus 4.7 introduced a new tokenizer, and Sonnet 5, on adopting it, produces roughly 30% more tokens than Sonnet 4.6 *for the same text*, at the same price per token. It is the cleanest demonstration of this post's thesis: splitting is not an implementation detail, it is an economic variable that can shift under your feet without a single line of your code changing.

And outside production there is a research line attacking the root of the problem: **tokenizer-free** models that work directly on bytes ([ByT5](https://arxiv.org/abs/2105.13626)) or group bytes into patches dynamically based on next-byte entropy ([Byte Latent Transformer](https://arxiv.org/abs/2412.09871)). They solve letter-counting and the language bias outright, but they make sequences far longer and attention is quadratic — which is why they have not displaced BPE yet.

## From integers to vectors: the embedding table

With the text now a list of integers, the network begins. And the first step is simpler than the name suggests: a **table lookup**.

```python
import numpy as np

VOCAB = 100_277       # how many distinct tokens the model knows (cl100k_base)
D_MODEL = 4_096       # dimensions of the latent space

# This matrix is a learned parameter: it trains like any other weight.
E = np.random.randn(VOCAB, D_MODEL) * 0.02

ids = [1045, 318, 257, 3797]          # the text, already tokenized
vectors = E[ids]                       # (4, 4096) — that's all
```

`E[ids]` is not a metaphor: the embedding layer is literally that indexing operation. It is usually described as a multiplication by a one-hot vector, and mathematically it is, but nobody implements it that way because multiplying by a matrix full of zeros to keep one row is throwing money away.

Three consequences follow:

**The table is enormous.** With `cl100k_base`'s 100,277 tokens and 4,096 dimensions, that's over 410 million parameters in the input alone. In small models the embedding matrix can be a non-trivial fraction of the total — and here is the real design tension in a tokenizer: **more vocabulary means shorter sequences but a fatter table**. Going from `cl100k_base` to `o200k_base` (from ~100k to ~200k tokens) is exactly that bet: double the table so that text —especially non-English text— occupies fewer positions.

**Many models reuse the table twice.** This is *weight tying*, proposed by [Press and Wolf (EACL 2017)](https://aclanthology.org/E17-2025/): the same matrix that turns integers into vectors is used, transposed, to turn the final hidden state into probabilities over the vocabulary. It saves parameters and, per the original paper, improves perplexity. GPT-2 does it; many current models do too.

**These vectors know nothing about context yet.** The vector for `bank` coming out of the table is identical in "the river bank" and "the central bank". It is the starting point, not the meaning. What turns that generic vector into something that distinguishes the two senses is the stack of attention layers that follows — exactly the step we discussed at the end of the previous post, when we separated static embeddings from contextual representations.

## One piece missing: position

As described so far there is a hole. The table is indexed by token, so "the dog bit the postman" and "the postman bit the dog" produce exactly the same set of vectors. And attention has no notion of order either: it looks at every position at once. Without fixing this, a transformer would be a very expensive bag of words.

The fix is to inject position explicitly. The original Attention paper added sinusoidal signals to the embedding; today the standard is **RoPE** ([Su et al., 2021](https://arxiv.org/abs/2104.09864)), which instead of adding anything **rotates** the query and key vectors according to their position. It has an elegant property: when you take the dot product between two positions, the rotations cancel such that the result depends only on the *relative distance* between them, not on where they sit in absolute terms. That is what lets a model trained on short contexts stretch to long ones with reasonable grace.

```python
h = apply_rope(E[ids])   # and from here on, attention layers
```

## How this was done five years ago

It is worth pausing here, because the word "embedding" meant something quite different not so long ago.

| | ~2015-2018 | Now |
|---|---|---|
| **What it was** | word2vec, GloVe, fastText: **static** vectors, one per word, trained separately with their own objective and downloaded as a weights file | A lookup table learned **jointly** with the rest of the model, with no objective of its own |
| **Context** | None. `bank` (river) and `bank` (money) shared a vector, with no way to separate them | Also none — but that is no longer a defect, because context comes from the attention layers |
| **Position** | Learned positional embeddings, one row per position, **added** to the token's vector | RoPE: a rotation applied inside each attention layer |
| **Unit** | The word. Anything outside the vocabulary was lost — hence the `<UNK>` token | The byte. Out-of-vocabulary does not exist |

Those static vectors were the whole model, not its first layer: you downloaded them pre-trained and fed them into whatever came next. That is where the example everyone has seen comes from, `king - man + woman ≈ queen`. It was a property demanded of the embedding **on its own**, because there was nothing behind it to build one. [ELMo (2018)](https://arxiv.org/abs/1802.05365) was the hinge: the first to give the same word different vectors depending on the sentence it appeared in.

And here is the real conceptual shift, which is easy to read backwards: **the modern embedding is deliberately dumb**. It is not that the first layer got worse; it is that the intelligence moved. Ten years ago we asked the embedding to capture meaning by itself. Today we ask it to be a good starting point and nothing more, because disambiguating is the attention stack's job. The `E` table above is dumber than a 2013 word2vec, and the model around it is incomparably better.

### Careful: two different things are called "embedding"

This is the most common confusion in the topic, and it is worth defusing:

1. **An LLM's input layer** — the `E[ids]` table in this post. One vector per *token*, internal to the model, never surfaced.
2. **Sentence embeddings for semantic search** — `text-embedding-3`, `bge-m3`. One vector per *document*, from models trained specifically so that cosine distance between two texts means something.

They share the name and the geometric intuition, but not the purpose or the training. The type-2 ones are what power RAG and semantic search — and they are, literally, what this site's radar uses to avoid publishing the same story twice when two outlets cover it, which I wrote up in detail in [the second logbook entry](/lab/bitacora-radar-02) (Spanish).

## What to take away

**The tokenizer is infrastructure, not intelligence.** It is a deterministic compression algorithm from 1994, trained on a particular corpus, that decides what reaches the model. Nothing happening there is "reasoning", and a good share of the most-cited LLM limitations live in that step.

**Tokens are the system's unit of economics.** Cost, latency and context window are all measured in tokens, and how many tokens your text burns depends on a training corpus you didn't choose and in which your language was probably under-represented. In my sample: 45% more expensive with GPT-4's tokenizer, 19% with the next one.

**The embedding is just a table lookup.** There is no magic there; there is a starting point. All the richness we discussed in the latent space post —context, disambiguation, structure— is built afterwards, layer by layer.

## What's next

The next module in the series builds a latent space from scratch with an **autoencoder**: a network that learns to compress and reconstruct without anyone telling it what each dimension should represent. It is the most visual way to watch a latent space *emerge*, and the direct conceptual ancestor of the encoder-decoder architecture in the Attention paper.

## To play with

This is the exact script that produces the numbers in the chart above. Thirty seconds and one `pip install`:

```bash
pip install tiktoken
```

```python
import tiktoken

PAIRS = [
    ("El modelo no entiende las palabras: solo ve una lista de números enteros.",
     "The model does not understand words: it only sees a list of integers."),
    ("La tokenización ocurre antes de que la red neuronal haya visto nada.",
     "Tokenization happens before the neural network has seen anything at all."),
    ("Ayer por la tarde estuve arreglando la bicicleta en el garaje de mi hermano.",
     "Yesterday afternoon I was fixing the bicycle in my brother's garage."),
    ("Cada llamada a la API se factura por tokens, tanto de entrada como de salida.",
     "Every API call is billed by tokens, both input and output."),
    ("Si el presupuesto es limitado, conviene medir antes de optimizar cualquier cosa.",
     "If the budget is limited, it is worth measuring before optimizing anything."),
    ("Los embeddings son simplemente filas de una tabla que se ha aprendido durante el entrenamiento.",
     "Embeddings are simply rows of a table that was learned during training."),
    ("El perro del vecino ladra todas las noches y no me deja dormir tranquilo.",
     "The neighbour's dog barks every night and does not let me sleep properly."),
    ("Esta arquitectura reduce la latencia, pero aumenta el coste de infraestructura.",
     "This architecture reduces latency, but increases infrastructure cost."),
]

for name in ("cl100k_base", "o200k_base"):
    enc = tiktoken.get_encoding(name)
    es = sum(len(enc.encode(a)) for a, _ in PAIRS)
    en = sum(len(enc.encode(b)) for _, b in PAIRS)
    print(f"{name:12}  ES {es:4}   EN {en:4}   ratio {es/en:.2f}x")

# And to see the split of anything at all:
enc = tiktoken.get_encoding("cl100k_base")
for text in [" ferrocarril", " railway", "1234567", "2026-07-28"]:
    ids = enc.encode(text)
    print(f"{text!r:16} → {len(ids)} tok  {[enc.decode([i]) for i in ids]}")
```

Feed it a paragraph of your own in two languages. Then feed it an identifier from your own code, a UUID, or an ISO date: seeing how many tokens a field you assumed was free actually costs is the fastest way to understand why this matters.

If you want to go one level deeper and build the whole tokenizer, the required reference is Andrej Karpathy's [`minbpe`](https://github.com/karpathy/minbpe): a minimal, readable BPE implementation, with [the entire lecture in text form](https://github.com/karpathy/minbpe/blob/master/lecture.md) and a guided exercise to reproduce GPT-4's tokenizer.

## Sources

- Sennrich, Haddow and Birch — [*Neural Machine Translation of Rare Words with Subword Units*](https://arxiv.org/abs/1508.07909) (ACL 2016). The paper that brought BPE to language processing.
- Gage — *A New Algorithm for Data Compression*, The C Users Journal, 1994. The original BPE, as a compression algorithm.
- Kudo and Richardson — [*SentencePiece*](https://arxiv.org/abs/1808.06226) (EMNLP 2018) and Kudo — [*Subword Regularization*](https://arxiv.org/abs/1804.10959) (ACL 2018). The unigram alternative and tokenization without space-based pre-segmentation.
- Radford et al. — [*Language Models are Unsupervised Multitask Learners*](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) (2019). GPT-2 and byte-level BPE: a vocabulary of 50,257 = 256 bytes + 50,000 merges + 1 special token.
- Petrov, La Malfa, Torr and Bibi — [*Language Model Tokenizers Introduce Unfairness Between Languages*](https://proceedings.neurips.cc/paper_files/paper/2023/hash/74bb24dca8334adce292883b4b651eda-Abstract-Conference.html) (NeurIPS 2023). 17 tokenizers, up to 15× difference between languages, and the cost-and-context argument.
- Singh and Strouse — [*Tokenization counts: the impact of tokenization on arithmetic in frontier LLMs*](https://arxiv.org/abs/2402.14903) (2024). Number splitting and arithmetic.
- Devlin, Chang, Lee and Toutanova — [*BERT*](https://arxiv.org/abs/1810.04805) (NAACL 2019). WordPiece and the `##` continuation marker.
- Mikolov, Chen, Corrado and Dean — [*Efficient Estimation of Word Representations in Vector Space*](https://arxiv.org/abs/1301.3781) (2013). word2vec and static embeddings.
- Pennington, Socher and Manning — [*GloVe*](https://aclanthology.org/D14-1162/) (EMNLP 2014); Bojanowski, Grave, Joulin and Mikolov — [*Enriching Word Vectors with Subword Information*](https://arxiv.org/abs/1607.04606) (TACL 2017). The other two static-vector families.
- Peters et al. — [*Deep Contextualized Word Representations*](https://arxiv.org/abs/1802.05365) (NAACL 2018). ELMo: the hinge between static and contextual.
- Xue et al. — [*ByT5*](https://arxiv.org/abs/2105.13626) (TACL 2022) and Pagnoni et al. — [*Byte Latent Transformer*](https://arxiv.org/abs/2412.09871) (2024). Tokenizer-free models.
- Anthropic — [*Token counting*](https://platform.claude.com/docs/en/build-with-claude/token-counting). The only way to count Claude tokens, since its tokenizer is not public.
- Press and Wolf — [*Using the Output Embedding to Improve Language Models*](https://aclanthology.org/E17-2025/) (EACL 2017). Weight tying.
- Su, Lu, Pan, Murtadha, Wen and Liu — [*RoFormer: Enhanced Transformer with Rotary Position Embedding*](https://arxiv.org/abs/2104.09864) (2021). RoPE.
- EleutherAI — [*Rotary Embeddings: A Relative Revolution*](https://blog.eleuther.ai/rotary-embeddings/). The most readable explanation of why RoPE works.
- Karpathy — [`minbpe`](https://github.com/karpathy/minbpe) and the lecture [*Let's build the GPT Tokenizer*](https://github.com/karpathy/minbpe/blob/master/lecture.md).
- OpenAI — [`tiktoken`](https://github.com/openai/tiktoken). The library behind every original measurement in this post.
