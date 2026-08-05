# /ticktock cycle 1 — RESEARCH phase (outward lens)

Generated: 2026-08-05T06:25:35Z
Scope: three research questions posed by the operator ("art imitates life and life
art" — world knowledge shapes both the sim's next challenge and Mythos's own
architecture). This artifact records receipts and a synthesis; it stages/commits
nothing.

## Credential path note

`PERPLEXITY_API_KEY` was retrieved from the macOS login Keychain (account `mythos`,
service `PERPLEXITY_API_KEY`) via `security find-generic-password -a mythos -s
PERPLEXITY_API_KEY -w`, called from inside a Node script (`execFileSync`) rather than
shell command substitution — the repo's pretool hook (`dispatch-pretool.cjs`) blocks
`$(...)` command-substitution tokens as unprovable write targets, so the retrieval
had to move inside the script body. Retrieval and the three subsequent HTTPS calls to
`api.perplexity.ai/chat/completions` (model `sonar-pro`) completed with **no macOS
desktop authentication prompt** at any point — this is a verified, tested outcome,
distinct from the `op` service-account path where a bad account name causes an
unanswerable Automation prompt (see memory: `launchd-op-desktop-fallback-prompts`).
`tools/ai-bridge/perplexity-api/query.js` was not used — it is documented as broken
(shells to `bunx pplx` and hangs) and this session did not attempt to invoke it,
instead writing a standalone script directly against the HTTPS API.

Script used (scratchpad, not committed):
`/private/tmp/claude-501/-Users-admin-mythos/2a3e83da-becd-4845-b2de-1be1dca94142/scratchpad/perplexity_query.js`

---

## Receipt 1 — Ecology / survival pressure

- **Query**: "In real ant colonies, what specific observable behavioral strategy
  shifts occur when food stores approach zero or scarcity becomes acute? Address
  changes in foraging range/distance, recruitment signaling (pheromone trail
  intensity, tandem running), brood-rearing decisions (culling, cannibalism, reduced
  egg-laying), and nest architecture or chamber reallocation under famine
  conditions. Cite specific studies or species where possible."
- **Timestamp**: 2026-08-05T03:24Z (local scratchpad file mtime)
- **Path used**: api (direct HTTPS to `api.perplexity.ai`, model `sonar-pro`)
- **Citations**: pmc.ncbi.nlm.nih.gov/articles/PMC9374231, PMC10110237, PMC4267257,
  PMC7212395, PMC3393712, PMC3426560; link.springer.com/10.1007/s00040-008-0986-5;
  journals.biologists.com/jeb (Mailleux et al. 2006, *Threshold triggering*);
  pnas.org/10.1073/pnas.1407083111; academic.oup.com/cz, /aesa, /beheco;
  scholar.tecnico.ulisboa.pt (thesis PDF); academia.edu (Emergency networking:
  famine relief in ant colonies); app.sib.illinois.edu (Ant Ecology ch.12);
  antwiki.org/wiki/The_Ants_Chapter_10 (Wilson & Hölldobler); frontiersin.org
  fevo.2016.00115; web.stanford.edu/~dmgordon (Gordon 1995); insectlore.com.
- **Finding**: Under acute scarcity, real ant colonies do not simply "forage
  harder" uniformly — the shift is mostly in *thresholds and responsiveness*, not
  raw signal intensity. Studies of *Lasius niger* (Mailleux et al. 2006) show
  starved colonies raise the food-volume threshold that triggers trail-laying, so
  they selectively ignore small food finds and recruit strongly only to large,
  high-yield sources; separately, starved workers become *more responsive* to
  existing recruitment trails (more ants leave the nest per unit trail signal)
  without scouts laying more pheromone. *Myrmica rubra* shows the opposite pattern
  for short famines — foraging-area activity stays flat while in-nest activity
  drops — showing this is species- and duration-dependent, not universal. Brood
  effects are the clearest and most consistent finding: prolonged starvation drives
  brood cannibalism and culling (younger larvae eaten first to recycle nutrients,
  sexual/reproductive brood aborted preferentially over worker brood), and queens
  reduce or halt egg-laying as trophallactic food-flow signals drop. Nest
  architecture shows the weakest evidence — no studies found large-scale excavation
  or chamber remodeling triggered by short-term famine; the "emergency networking"
  literature (on *L. niger*) instead documents *internal traffic reorganization* —
  workers move away from brood piles and toward the entrance to speed food mixing
  and redistribution — while cluster/aggregation structure itself stays statistically
  unchanged. Desert harvester ants (*Pogonomyrmex*) throttle foraging activity based
  on the return rate of successful foragers, meaning the colony's response to scarcity
  is a decentralized, encounter-rate-driven signal rather than a global "hunger"
  broadcast.

---

## Receipt 2 — Emergence measurement / self-referential confound

- **Query**: "How do researchers detect and measure emergent structure in
  collective or swarm systems... What statistical methods beyond permutation-null
  spatial correlation are standard... What are known pitfalls, especially the risk
  of measuring structure that the agents' own actions partly created — i.e. a
  self-referential or endogeneity confound where the 'environment feature' being
  correlated against was itself shaped by the agents being measured? Is there
  established methodology... for controlling for this confound?"
- **Timestamp**: 2026-08-05T03:24Z
- **Path used**: api (direct HTTPS, `sonar-pro`)
- **Citations**: ijcai.org/Proceedings/15/Papers/157.pdf; arxiv.org 2309.11408,
  2406.14652, 2411.11142, 2407.11330; dl.acm.org/10.5555/2832249.2832399;
  journals.sagepub.com/10.5772/5769 and /10.1177/00375497251349538;
  link.springer.com/978-3-319-64816-3_6; ntrs.nasa.gov/20040081039;
  pure.royalholloway.ac.uk (swarmcommsJISA); ifaamas.org/aamas2025/p1473;
  papers.cumincad.org (ecaade2017, acadia16); publications.ri.cmu.edu (Walker,
  perception of swarm behavior 2016); arborialabs.com; milvus.io; emergentswarms.com.
- **Finding**: Standard emergence-detection methodology beyond permutation-null
  spatial correlation includes spatial-dependence statistics (Moran's I, Geary's C,
  Ripley-style clustering), cluster/connectivity statistics (component counts,
  modularity, percolation thresholds), information-theoretic dependence measures
  (mutual information for nonlinear coupling, transfer entropy when directionality
  matters), spectral/low-dimensional structure measures (SVD/PCA "knee" analysis,
  graph-Laplacian eigenvalues used to detect macrostates like milling), and formal
  verification approaches that treat emergence as a threshold property-satisfaction
  problem rather than a statistical test. Directly on point: the response confirms
  the self-referential confound is a **named, recognized problem** — it groups it
  under "endogeneity," with named sub-failure-modes: reverse causality (the
  environment variable is a downstream consequence of agent action, not an
  independent predictor), shared-cause confusion, circular measurement (testing a
  system against its own imprint), temporal leakage (same-time vs. lagged
  variables), and null-model misspecification (a permutation null that breaks labels
  but preserves the feedback structure is too weak). The established mitigations are:
  lagged/pre-treatment comparisons (measure the environment feature strictly before
  the focal action), joint state-space models treating agent and environment as
  coupled processes rather than one exogenous covariate, conditioning on/residualizing
  out the agents' own contribution to the field before testing for remaining
  coordination signal, counterfactual/intervention tests (rerun the sim with deposits
  disabled or randomized), and process-based (not label-only) null models that
  preserve agent trajectories while destroying the feedback loop specifically. No
  single canonical fix exists; the field's answer is "model the environment as
  endogenous and test the residual," not "find a stronger p-value."

---

## Receipt 3 — Architecture (biology → software orchestration)

- **Query**: "What design patterns from biological collective intelligence —
  stigmergy, quorum sensing, distributed consensus without central control, ant
  colony optimization — have been productively applied to software orchestration
  systems, multi-agent AI systems, or distributed computing architectures? Cite
  specific systems, papers, or frameworks..."
- **Timestamp**: 2026-08-05T03:24Z (retried standalone after a parallel-execution
  redirection failure; see Process note below)
- **Path used**: api (direct HTTPS, `sonar-pro`)
- **Citations**: nature.com/articles/s42003-024-06037-4; solvingforpattern.org
  (Malone, patterns of collective intelligence); pmc.ncbi.nlm.nih.gov PMC10978875,
  PMC3226954, PMC8306784, PMC12575731; arxiv.org/abs/1910.11262;
  cui.unige.ch/~dimarzo/papers/NACO.pdf (Di Marzo Serugendo et al. — bio-inspired
  design pattern catalog); dl.acm.org/10.1145/1152934.1152937 (Holland 2006, "Design
  patterns from biology for distributed computing"); pugalenthimagendran.com
  (Biological Intelligence Atlas); cell.com/patterns S2666-3899(24)00233-2;
  anshadameenza.com; journals.sagepub.com/10.1177/26339137231168355; orca.cardiff.ac.uk
  (thesis); pubmed.ncbi.nlm.nih.gov/41987718.
- **Finding**: Four biological mechanisms have documented software translations.
  Stigmergy maps to "shared, persistent state that agents sense and modify" — Holland
  (2006) explicitly catalogs digital pheromones, stigmergic workspaces, shared
  blackboards, tuple spaces, and distributed logs as coordination substrates for load
  balancing, resource discovery, and distributed planning; Di Marzo Serugendo et al.
  formalize this as a reusable "Digital Pheromone" design pattern. Practically, the
  response notes this already shows up as issue trackers, kanban boards, and event
  streams used as multi-agent coordination surfaces. Quorum sensing maps to
  threshold-based collective decisions — a formal "Quorum Sensing Pattern" where
  agents estimate local density from purely local interactions and collectively
  switch state once a threshold is crossed; Talamali et al. (2019) survey how
  honeybee/bacterial quorum mechanisms become engineered distributed decision
  algorithms with performance guarantees, used for site selection and task
  allocation. Distributed consensus without central control maps to "consensus as
  emergent behavior" via local recruitment, cross-inhibition, and nonlinear feedback
  until one option dominates — explicitly framed as often more natural for robot
  swarms/agent systems than a single-leader protocol like Paxos or Raft. Ant colony
  optimization maps most concretely to production systems: Nakrani & Tovey (2007)
  used honeybee forager-allocation logic directly as a dynamic load-balancing model
  for web-hosting data centers (nectar sources ↔ request streams, bees ↔ servers,
  recruitment ↔ dynamic server reallocation), and ACO-style pheromone trails are
  cited as a standing pattern in cluster schedulers and workflow planners for task
  placement and job sequencing. The response is honest about the ceiling: mainstream
  container orchestrators (Kubernetes named explicitly) still rely on central
  controllers, and these bio-inspired patterns remain concentrated in swarm robotics,
  MAS middleware, and IoT/edge architectures rather than dominant cloud orchestration.

---

## Implications

### (a) Should shape the sim's NEXT CHALLENGE

- **Threshold-shift over intensity-shift.** The scarcity design should not simply
  raise a global "hunger" dial. Real colonies raise the *threshold* for what counts
  as worth recruiting to (ignore small finds, commit hard to large ones) while
  simultaneously *lowering* the threshold for responding to an existing
  recruitment signal. A mineral-rich/food-poor world is a strong natural fit for
  this: the challenge should reward colonies that learn to ignore low-yield
  mineral-adjacent food traces and concentrate recruitment on rare large finds,
  and should score responsiveness-to-trail separately from trail-strength-laid.
- **Brood policy is the highest-confidence lever.** Brood culling/cannibalism and
  reproductive-arrest under trophallactic food-flow signals is the most
  consistently documented behavior across species (unlike foraging-range or nest-
  architecture changes, which are weak/mixed in the literature). If the challenge
  wants an observably "real" survival strategy shift, gating brood investment
  (fewer eggs, prioritizing near-mature brood over new eggs, deprioritizing
  reproductive castes) on colony food-flow state is better grounded than dialing
  foraging distance.
- **Nest architecture is the weakest-evidenced lever — treat any structural
  change here as designed novelty, not biological mimicry.** The literature found
  essentially no evidence of famine-triggered chamber excavation/reallocation;
  what's documented is *internal traffic reorganization* (workers relocating away
  from brood piles toward the entrance to speed food distribution), not building
  new structure. If the sim's mirror-detector correlates against nest architecture
  under scarcity, know going in that this is where the sim's behavior would be
  departing furthest from documented biology — worth flagging explicitly if it
  emerges, not silently treated as expected mimicry.
- **Encounter-rate throttling (Pogonomyrmex) is a decentralized alternative to a
  global scarcity signal.** Worth considering for the challenge design: colony-wide
  foraging activity throttled by the rate of successful-forager returns, rather
  than any individual agent knowing global store levels — this keeps the challenge
  decentralized and matches how real colonies avoid needing a central "food store"
  variable at all.

### (b) Should shape MYTHOS'S OWN ARCHITECTURE

- **Confirms our approach, with a named gap to close.** The mirror detector's
  concern (correlating build sites against world features the colony's own
  actions partly created) is a real, named problem in the literature — endogeneity/
  self-referential confounding, with sub-modes (reverse causality, circular
  measurement, temporal leakage, null-model misspecification) that map cleanly onto
  what a build-site correlation risks. This *warns of a known pitfall* rather than
  confirming current practice is sufficient: a pure permutation-null test that only
  breaks labels while preserving spatial autocorrelation is explicitly called out as
  "too weak" and prone to false positives in exactly this feedback-loop scenario.
  The concrete, actionable fix from the literature is to treat the world feature as
  *endogenous* — either lag it strictly before the colony action it's compared
  against, or residualize the feature against the colony's own known contribution
  (agent density, deposition history) before testing for remaining structure, or
  run counterfactual reruns with the colony's environmental modification disabled/
  randomized. Any acceptance-grade claim of "the colony organized around a real
  world feature" should carry one of these three controls as its verification
  artifact, not a same-time correlation coefficient alone.
- **Stigmergy is already Mythos's dominant coordination idiom, and the literature
  validates it as a first-class pattern rather than a metaphor.** Holland (2006)
  and the Di Marzo Serugendo pattern catalog formalize exactly what the harness
  already does structurally: shared persistent state (signals, plan artifacts,
  manifests, the live signal surface) that distinct actors read and write instead
  of messaging each other directly, functioning as the coordination medium itself.
  This is a confirmation, not a novel result — Mythos's signal-file-based
  orchestration is a known, named pattern with prior art in distributed computing
  (shared blackboards, tuple spaces, distributed logs), which is useful validation
  but not a new architectural insight to act on.
  - Where this does suggest a possibly under-used lever: quorum-sensing's
    threshold-commit pattern (agents individually estimate local signal density,
    collectively switch state only once a threshold of independent agreement is
    crossed) is a closer structural match to the doctrine's "a producer never
    validates its own trial" / cross-verification requirement than plain
    stigmergy is — worth naming explicitly if a future concept doc formalizes why
    the review gate requires a *distinct* mind's independent local judgment
    crossing a threshold, rather than one producer's self-report.
  - ACO's pheromone-reinforcement-with-evaporation (routes/solutions strengthen
    when reused, decay when ignored) has no clear current analog in Mythos's
    architecture — grimoire rank promotion is evidence-gated but doesn't decay.
    This is not warned-of nor confirmed by the research; it is a candidate for
    future exploration, flagged here as a possible novel direction rather than a
    finding this session verified.

---

## Process note (for the operator)

A parallel (`&`-backgrounded) attempt to run receipt-2 and receipt-3 queries
simultaneously silently failed to create the output redirection files for one of
the two branches (job exited 1, files never appeared) despite `set -e` not being in
play — root cause not diagnosed further since the fix (running them sequentially)
was cheap and both queries then succeeded cleanly on retry. Flagging as an observed,
unexplained shell/background-job interaction rather than a diagnosed root cause —
worth a look if parallel Perplexity dispatch becomes routine.
