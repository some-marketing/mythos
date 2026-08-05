---
name: a-null-that-varies-two-things-proves-neither
description: a control that randomizes two properties at once cannot isolate either; surviving it is not confirmation
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 410f8729-6299-4432-9f65-162af689752e
  modified: 2026-08-02T19:17:35.639Z
---

When a treatment differs from its control on more than one dimension, surviving the
control proves nothing about which dimension mattered. In the ant-sim carriage runs
(2026-08-02) the "informative" relay differed from the random-tip null in *both* what
tile it named and whether it named the same tile repeatedly. The effect survived the
null, which looked like proof of information transfer. It wasn't: the tips were
informative at chance level (1.4% vs 1.1%), and a fixed arbitrary tile — consistent but
provably uninformative — reproduced and beat the effect.

**Why:** I made the same attribution error twice in one day, at two different depths,
each time in favour of the mechanism I had designed the experiment to find. A distinct
mind caught the first; only a deliberately constructed control caught the second.
Enthusiasm for a hypothesis shows up as under-specified controls, not as bad reasoning.

**How to apply:** before believing a contrast, list every property that differs between
arm and control and confirm exactly one varies. If two vary, build the arm that holds
one fixed — it is usually cheap (the fixed-tile run was 12 episodes) and it is the only
thing that converts a suggestive result into an attributable one. Related: an invariant
that isn't mechanically enforced is a hypothesis wearing a guarantee's clothing — I
asserted "no filtering" in a relay whose selection rule was a filter, and
[[never-checkout-a-file-you-didnt-verify-clean]] is the same species of error, trusting
my own description of a thing over the thing.
