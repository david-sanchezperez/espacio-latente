---
titulo: "Harness, loop and graph engineering: three ways to build an agent"
resumen: "Three vocabularies used as if they competed, which don't: one is about who decides the next step, another about how the path is drawn, and the third about the ground you stand on. With the evidence that the ground matters more than it looks."
estado: pruebas
unidad: "U-10"
serie: agentes
lang: en
fecha: 2026-07-28
---

There's a pattern that repeats in every conversation about agents in 2026: three people use three different words —*loop*, *graph*, *harness*— convinced they are debating the same decision, and they are not. One is talking about **who decides the next step**. Another about **how the path is drawn**. The third about **the ground you stand on**.

These aren't three options on a menu. They are three layers, and confusing them leads to arguments nobody can win. This post separates them, says what breaks in each, and brings the evidence —which exists, and is more forceful than I expected— for which one actually moves the needle.

<figure class="fig-svg">
<svg viewBox="0 0 720 250" role="img" aria-label="The three layers: the harness as ground, with loop and graph above it as two ways of organising control">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <rect x="8" y="150" width="704" height="70" rx="4" fill="#1a1f26" stroke="#ffb454"/>
    <text x="24" y="176" fill="#ffb454" font-size="12">HARNESS</text>
    <text x="24" y="196" fill="#8a97a5" font-size="10">sandbox · tools · context · traces · verification · permissions</text>
    <text x="24" y="212" fill="#5c6b7a" font-size="9">what the model can see and touch — it sits underneath both options above</text>
    <rect x="8" y="34" width="344" height="96" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="24" y="56" fill="#e9e5da" font-size="12">LOOP</text>
    <text x="24" y="72" fill="#8a97a5" font-size="9">the model decides</text>
    <circle cx="230" cy="92" r="26" fill="none" stroke="#8a97a5" stroke-width="1.5"/>
    <path d="M230,66 a26,26 0 0,1 22,13" fill="none" stroke="#ffb454" stroke-width="2"/>
    <polygon points="256,80 246,82 251,72" fill="#ffb454"/>
    <text x="230" y="96" fill="#8a97a5" font-size="9" text-anchor="middle">think</text>
    <text x="230" y="108" fill="#8a97a5" font-size="9" text-anchor="middle">act</text>
    <text x="300" y="92" fill="#5c6b7a" font-size="9">done?</text>
    <rect x="368" y="34" width="344" height="96" rx="4" fill="#1a1f26" stroke="#2c333d"/>
    <text x="384" y="56" fill="#e9e5da" font-size="12">GRAPH</text>
    <text x="384" y="72" fill="#8a97a5" font-size="9">the designer decides</text>
    <circle cx="530" cy="60" r="9" fill="#2c333d" stroke="#8a97a5"/>
    <circle cx="590" cy="92" r="9" fill="#2c333d" stroke="#8a97a5"/>
    <circle cx="530" cy="112" r="9" fill="#2c333d" stroke="#8a97a5"/>
    <circle cx="650" cy="60" r="9" fill="#2c333d" stroke="#ffb454"/>
    <line x1="538" y1="66" x2="582" y2="86" stroke="#8a97a5"/>
    <line x1="582" y1="98" x2="538" y2="107" stroke="#8a97a5"/>
    <line x1="598" y1="86" x2="642" y2="65" stroke="#ffb454"/>
    <text x="466" y="96" fill="#5c6b7a" font-size="9">fixed edges</text>
  </g>
</svg>
<figcaption>Loop and graph are alternatives to each other. The harness is not: it sits beneath both, and it's the layer almost nobody names when starting out.</figcaption>
</figure>

## It all starts as a loop

Before the three words there was **ReAct** ([Yao et al., ICLR 2023](https://arxiv.org/abs/2210.03629)), and its idea is still the skeleton of nearly everything built today: interleave reasoning and action in the same flow, so thought serves to plan the next action and the action's result serves to correct the thought. At the time that earned them a 34-point absolute success-rate improvement over imitation and reinforcement learning on ALFWorld, prompted with one or two examples.

Reduced to code, an agent is this and not much more:

```python
def agent(goal, tools, max_steps=20):
    context = [{"role": "user", "content": goal}]

    for _ in range(max_steps):
        response = model(context, tools=tools)

        if not response.tool_calls:
            return response.text                # the model believes it's done

        for call in response.tool_calls:
            result = execute(call)              # ← the harness lives here
            context.append(result)

    raise StepLimit()                           # ← this is a design decision too
```

Four lines of substance. What's interesting is that **almost every architectural decision that matters sits outside the model call**: who decides when to stop, what's in `tools`, what happens to `context` when it grows too large, what `execute` returns when something fails. The three disciplines come out of that.

## Loop engineering: let the model decide

The first option is to leave that loop as it is and work on it: the model picks the next action each turn, and you invest your effort in the prompt, the tool catalogue and the stopping conditions.

This is what Anthropic simply calls an **agent**, in contrast with a *workflow*, and their definition is the cleanest I know: agents are "systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks" ([*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents), 2024).

**When it wins.** When you cannot predict how many steps will be needed or in what order. Anthropic's guide puts it bluntly: agents are for "open-ended problems where it's difficult or impossible to predict the required number of steps, and where you can't hardcode a fixed path". Debugging, exploring a repository, researching a question: tasks where step five depends on what you find at step four.

**How it fails.** In three ways, all expensive:

- **Drift.** The model wanders off the goal little by little, without any single turn looking wrong. It's the most treacherous failure because it raises no exceptions.
- **Loops.** It repeats the same failing action expecting a different outcome, burning tokens each turn.
- **Compounding errors.** This is Anthropic's explicit warning: "their autonomous nature means higher costs, and the potential for compounding errors". A 95% per-step success rate is 60% after ten steps.

None of the three is fixed by a better prompt. They are fixed by structure — which is where the second discipline comes in.

## Graph engineering: let the designer decide

The second option is to take control away from the model and put it in an explicit topology: nodes that do things, edges saying what can follow what, conditions that pick a branch. This is what LangGraph does, and what Anthropic calls a **workflow**: "systems where LLMs and tools are orchestrated through predefined code paths".

Their guide catalogues five patterns covering most real cases: **prompt chaining**, **routing**, **parallelization**, **orchestrator-workers** and **evaluator-optimizer** — the last of which is exactly the critique-and-rewrite loop discussed in [loop prompting](/lab/loop-prompting) (Spanish).

**When it wins.** When you can draw the whole flow before writing it. If the requirement is "if step B fails, go back to A, but at most three times", in a free loop that's a plea in the prompt and in a graph it's an edge. Explicit topology gives you for free what a loop makes you bleed for: bounded retries, human approval gates, resumption after a crash, and a diagram someone can review without reading the prompt.

**How it fails.** Also in three ways:

- **It gets boxed in.** If a condition arises with no matching edge, the agent doesn't improvise: it has nowhere to go. The rigidity that buys you guarantees is the same rigidity that strips it of options when something unforeseen happens.
- **Edge explosion.** Every new edge case is another node and a few more edges. At some point the graph is harder to reason about than the loop it replaced.
- **False determinism.** The graph is deterministic; the nodes are not. Having the diagram drawn is more reassuring than it should be when every box is still an LLM call.

The most useful rule of thumb I've read is also the simplest: **if you can't draw the whole flow up front, the graph isn't your tool**. And its converse: if you can draw it, you probably didn't need an agent.

## Harness engineering: the ground

And here is the layer almost nobody names at the start, because it doesn't look like an architectural decision — it looks like plumbing.

The **harness** is the deterministic infrastructure surrounding the model: the sandbox where actions run, the tools and how they're described, context management, traces, verifiers, permissions. The model proposes; the harness validates, authorises, executes, records. In the code above, it is everything inside `execute()` and everything that decides what goes into `context`.

The [*Agent Harness Engineering: A Survey*](https://picrew.github.io/LLM-Harness/) (Li et al., 2026 — a joint effort from CMU, Yale, Stanford, Tulane, Amazon and others, mapping more than 170 open-source projects) organises it into seven layers under the acronym **ETCLOVG**:

| Layer | What it covers |
|---|---|
| **E**xecution | Sandbox, isolation, reset semantics |
| **T**ooling | Protocols (MCP, A2A), tool description and discovery |
| **C**ontext | Active window, session memory, persistent memory |
| **L**ifecycle | State, orchestration, inner loop, multi-agent patterns |
| **O**bservability | Traces, monitoring, cost attribution |
| **V**erification | Evaluation, verifiers, failure detection |
| **G**overnance | Identity, permissions, audit, human approval |

What stands out is where `loop` and `graph` land in that table: **inside a single layer**, Lifecycle. The entire loop-versus-graph debate is a debate about one seventh of the problem.

### The evidence

This is where I expected to find opinion and found numbers. Holding the **model frozen** and changing only the harness:

<figure class="fig-svg">
<svg viewBox="0 0 700 170" role="img" aria-label="Chart: with the model frozen, harness changes raise the Terminal-Bench 2.0 result from 52.8 percent to 66.5 percent">
  <g font-family="IBM Plex Mono, monospace" font-size="11">
    <text x="0" y="14" fill="#8a97a5" font-size="10" letter-spacing="1">TERMINAL-BENCH 2.0 · SAME MODEL (GPT-5.2-CODEX) · ONLY THE HARNESS CHANGES</text>
    <text x="0" y="56" fill="#8a97a5" font-size="10">baseline harness</text>
    <rect x="140" y="42" width="264" height="20" rx="2" fill="#5c6b7a"/>
    <text x="414" y="57" fill="#8a97a5">52.8%</text>
    <text x="0" y="98" fill="#8a97a5" font-size="10">redesigned harness</text>
    <rect x="140" y="84" width="333" height="20" rx="2" fill="#ffb454"/>
    <text x="483" y="99" fill="#ffb454">66.5%</text>
    <line x1="404" y1="38" x2="404" y2="112" stroke="#2c333d" stroke-dasharray="3 3"/>
    <text x="556" y="78" fill="#7adb8f" font-size="14">+13.7 pts</text>
    <text x="0" y="140" fill="#8a97a5" font-size="10">Restructuring the system prompt, injecting context via middleware</text>
    <text x="0" y="154" fill="#8a97a5" font-size="10">and adding self-verification hooks. Zero changes to the model.</text>
  </g>
</svg>
<figcaption>Data from Trivedy (2026) on LangChain's DeepAgents, collected in the harness engineering survey.</figcaption>
</figure>

And it isn't an isolated case: the same survey collects work that modified the edit-tool format and its surrounding harness **across 15 different models**, reporting coding-benchmark gains of up to **10×** on one of them.

Now the honest part, which the survey writes itself and is worth not skipping: *"the strongest controlled evidence currently comes from coding-agent benchmarks, and these results do not establish that the harness matters more than the model in every setting"*. The defensible conclusion isn't "the harness matters more than the model". It's that **an agent's performance cannot be cleanly attributed to the model without specifying the controller around it** — which, among other things, makes any model comparison that doesn't state its harness rather suspect.

## Try it: same task, three architectures

Pick a scenario and watch what each architecture does step by step. The first three are everyday; the fourth is the one that separates the first two from the third:

<div class="arq-demo" id="arq-demo">
  <div class="arq-demo-escenarios" id="arq-demo-escenarios"></div>
  <div class="arq-demo-cols">
    <div class="arq-col" data-arq="loop">
      <div class="arq-col-titulo">LOOP</div>
      <ol class="arq-pasos" id="arq-pasos-loop"></ol>
      <div class="arq-veredicto" id="arq-veredicto-loop"></div>
    </div>
    <div class="arq-col" data-arq="grafo">
      <div class="arq-col-titulo">GRAPH</div>
      <ol class="arq-pasos" id="arq-pasos-grafo"></ol>
      <div class="arq-veredicto" id="arq-veredicto-grafo"></div>
    </div>
    <div class="arq-col" data-arq="harness">
      <div class="arq-col-titulo">HARNESS</div>
      <ol class="arq-pasos" id="arq-pasos-harness"></ol>
      <div class="arq-veredicto" id="arq-veredicto-harness"></div>
    </div>
  </div>
  <div class="arq-demo-nota" id="arq-demo-nota"></div>
</div>

<script>
(function () {
  const root = document.getElementById('arq-demo');
  if (!root) return;
  const SCENARIOS = [
    {
      name: 'Everything works',
      note: 'On the happy path all three are equivalent. That is why agent demos always work.',
      loop: { pasos: ['read the error', 'find the file', 'apply the patch', 'run the tests', 'done'], v: 'ok', t: 'Solved in 5 turns.' },
      grafo: { pasos: ['node: diagnose', 'node: edit', 'node: verify', 'edge: success → end'], v: 'ok', t: 'Solved along the intended path.' },
      harness: { pasos: ['tools scoped to the repo', 'edits via validated diff', 'tests in a sandbox', 'full trace stored'], v: 'ok', t: 'Solved, and reproducible tomorrow.' },
    },
    {
      name: 'A tool fails',
      note: 'The graph wins clearly: a bounded retry is an edge, not a plea in the prompt.',
      loop: { pasos: ['run tests → 503', 'retry → 503', 'retry → 503', 'retry → 503…'], v: 'mal', t: 'Stuck retrying: nobody told it how many times.' },
      grafo: { pasos: ['node: verify → error', 'conditional edge: retry 1/3', 'retry 2/3', 'edge: exhausted → escalate'], v: 'ok', t: 'Retries three times, then escalates. By design.' },
      harness: { pasos: ['tool declares its retry policy', 'backoff applied by the runtime', 'error compacted into context', 'token budget watched'], v: 'ok', t: 'The failure never reaches the model as a surprise.' },
    },
    {
      name: 'Something unforeseen',
      note: 'Here it inverts: the loop improvises, the graph is boxed in because no edge covers this.',
      loop: { pasos: ['read the error', 'it does not match the diagnosis', 'explore the environment', 'find the missing variable', 'report it'], v: 'ok', t: 'It improvises. That is what it is good at.' },
      grafo: { pasos: ['node: diagnose', 'no edge matches', 'falls through to default node'], v: 'mal', t: 'Boxed in: no path exists for what was not foreseen.' },
      harness: { pasos: ['error carries environment context', 'verifier flags the anomaly', 'trace ready for the human'], v: 'medio', t: 'Does not solve it alone, but serves the diagnosis up.' },
    },
    {
      name: 'Hostile content',
      note: 'Neither the loop nor the graph has anything to say here. This is a harness decision — ETCLOVG layers G and E — and it is why that layer is not optional.',
      loop: { pasos: ['read the file', 'the instruction enters the context', 'considers the action'], v: 'mal', t: 'The loop architecture offers no defence at all.' },
      grafo: { pasos: ['node: read file', 'the instruction enters the context', 'the next node inherits it'], v: 'mal', t: 'Edges order the flow; they do not filter content.' },
      harness: { pasos: ['no credentials in the sandbox', 'network egress denied by default', 'the action requires human approval', 'attempt recorded in the trace'], v: 'ok', t: 'Blocked by permissions, not by the model’s good judgement.' },
    },
  ];
  const tabs = root.querySelector('#arq-demo-escenarios');
  const note = root.querySelector('#arq-demo-nota');
  const ARCHS = ['loop', 'grafo', 'harness'];
  function paint(sc) {
    ARCHS.forEach((arch) => {
      const ol = root.querySelector('#arq-pasos-' + arch);
      const vd = root.querySelector('#arq-veredicto-' + arch);
      ol.innerHTML = '';
      sc[arch].pasos.forEach((p, i) => {
        const li = document.createElement('li');
        li.textContent = p;
        li.style.animationDelay = (i * 90) + 'ms';
        ol.appendChild(li);
      });
      vd.textContent = sc[arch].t;
      vd.className = 'arq-veredicto is-' + sc[arch].v;
    });
    note.textContent = sc.note;
  }
  SCENARIOS.forEach((sc, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sc.name;
    b.addEventListener('click', () => {
      [...tabs.children].forEach((c) => c.classList.toggle('is-active', c === b));
      paint(sc);
    });
    if (i === 0) b.classList.add('is-active');
    tabs.appendChild(b);
  });
  paint(SCENARIOS[0]);
})();
</script>

The fourth scenario is the whole post in miniature. Faced with hostile content, "loop or graph?" has no useful answer: neither topology defends against anything. What defends is having no credentials in the sandbox and requiring approval for consequential actions. That's harness, and it appears on no flow diagram.

## So where does control live?

That's the question that actually separates the three disciplines:

| | Who picks the next step | Where a failure gets fixed | What breaks first |
|---|---|---|---|
| **Loop** | The model, every turn | In the prompt and the tools | Coherence after N steps |
| **Graph** | The designer, up front | By adding nodes and edges | Whatever wasn't foreseen |
| **Harness** | Neither: it bounds both | In the infrastructure | Nothing visible… until everything |

The most practical synthesis I know is the eighth of Dex Horthy's [*12-Factor Agents*](https://github.com/humanlayer/12-factor-agents), **"own your control flow"**: the model may choose the next action, but your application owns the loop, the stopping conditions, the retries, the approval gates and the budget ceilings. That sentence dissolves the false dilemma. It isn't "loop or graph": it's that the loop should be yours and not an emergent property of the prompt.

## The fourth temptation: multiplying agents

When one agent isn't enough, the reflex is to add several. Here the consensus breaks, and it's worth knowing both positions before deciding.

Cognition published the sharpest one, [*Don't Build Multi-Agents*](https://cognition.com/blog/dont-build-multi-agents): with several agents in parallel, decisions get dispersed and context isn't shared thoroughly enough, so the system turns brittle. Their recommendation is a single thread of execution, with a separate LLM dedicated to compressing context. LangChain, from the other side, [qualifies the *when*](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems) more than the *whether*.

Where both agree, and where the field seems to have landed, is this: **one main agent owns the continuous context and spawns ephemeral, read-only subagents that return a compressed summary**. No peer-to-peer channel, no shared mutable state. Swarms of agents writing at once remain brittle for the same old reason: context fragments and decisions contradict each other.

Notice that this debate is, again, about the Lifecycle layer. And that the consensus solution —compress context, isolate, return summaries— is pure harness.

## Three tolls you can't dodge

The survey closes with three tensions that aren't resolved by choosing well, only managed. They strike me as the most useful part of the whole work:

**Cost, quality and speed.** More faithful sandboxes, richer memory, deeper evaluation and finer observability improve quality and worsen the other two. No configuration wins on all three: you have to decide which checks are synchronous, which run offline, and which failures justify an expensive recovery.

**Capability versus control.** Every increase in authority widens the control problem. A larger tool catalogue covers more tasks while increasing selection error and prompt-injection surface. Persistent memory helps long-running tasks and creates provenance, staleness and privacy risks. A permissive sandbox makes autonomous execution useful and enlarges the blast radius.

**Coupling.** The layers interact in ways that make local optimisation fragile. Tool descriptions consume context budget and shape model behaviour; the execution environment changes evaluation results; evaluation design feeds back into orchestration by rewarding some recovery loops and penalising others. The operational conclusion is uncomfortable but clear: **a harness change must be tested as a system change**, not a local one. A tool, a verifier or a memory policy can look good in isolation and degrade the whole rollout once combined with the rest.

## What I would do

Ordered by return per unit of effort:

1. **Start with the simplest loop that works.** Anthropic's own guide recommends finding the simplest possible solution and adding complexity only when needed — "which might mean not building agentic systems at all".
2. **Invest in the harness before the topology.** That's where the quantitative evidence is: same model, +13.7 points. Well-described tools, errors that return to the context with useful information, traces from day one, and a budget ceiling.
3. **Move to a graph only when you can draw it.** If the flow has branches you can enumerate, guarantees to meet, or human approvals to insert, explicit topology pays for itself. If you can't draw it, don't force it.
4. **Multiply agents last, and one at a time.** One orchestrator owning the context, ephemeral subagents returning summaries. No swarms writing in parallel.
5. **Measure the system, not the model.** If you change the harness and the score rises, you've learned something. If you change the model without fixing the harness, you've learned nothing.

And the whole thing in one sentence: **loop and graph engineering decide who draws the path; harness engineering decides whether the ground holds.** Almost everyone, myself included, starts by arguing about the first.

## Sources

- Yao, Zhao, Yu, Du, Shafran, Narasimhan and Cao — [*ReAct: Synergizing Reasoning and Acting in Language Models*](https://arxiv.org/abs/2210.03629) (ICLR 2023). The loop all the others descend from.
- Anthropic — [*Building Effective Agents*](https://www.anthropic.com/engineering/building-effective-agents) (2024). The workflow/agent distinction and the five orchestration patterns.
- Anthropic — [*Effective context engineering for AI agents*](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). Compaction, *context rot* and context as a finite resource.
- Li, Xiao, Zhang, Liu et al. — [*Agent Harness Engineering: A Survey*](https://picrew.github.io/LLM-Harness/) (2026). The ETCLOVG taxonomy, the mapping of 170+ projects, and the three closing tensions. The main source for this post.
- Zhang, Wang, Ge, Xu, Hamm and Reddy — [*Stop Comparing LLM Agents Without Disclosing the Harness*](https://arxiv.org/abs/2605.23950) (2026). The uncomfortable corollary: comparing models without stating the harness doesn't mean much.
- Trivedy (2026), collected in the survey above: LangChain's DeepAgents, from 52.8% to 66.5% on Terminal-Bench 2.0 with the model frozen.
- Zhang et al. — [*The Interplay of Harness Design and Post-Training in LLM Agents*](https://arxiv.org/abs/2606.25447) (2026). What happens when you train an agent on a poor harness: it breaks when the tools change.
- Cognition — [*Don't Build Multi-Agents*](https://cognition.com/blog/dont-build-multi-agents) (2025). The strong position against parallelism between agents.
- LangChain — [*How and when to build multi-agent systems*](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems). The counterpoint.
- Horthy — [*12-Factor Agents*](https://github.com/humanlayer/12-factor-agents). In particular "own your control flow" and "compact errors into the context window".
- Anthropic — [Model Context Protocol](https://modelcontextprotocol.io/). The protocol behind ETCLOVG's T layer; taken apart in [how an agent talks to an MCP server](/lab/agente-mcp) (Spanish).
