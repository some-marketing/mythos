---
name: corrections-do-not-propagate-themselves
description: "A correction applied once in prose leaves the refuted claim alive elsewhere — and a fixed-phrase grep only finds the staleness you already thought of; four+ times observed 2026-08-02"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 410f8729-6299-4432-9f65-162af689752e
  modified: 2026-08-02T17:17:19.986Z
---

Twice in one afternoon (2026-08-02): I corrected the ant-sim results header and closing reading but left the numbered findings body carrying four refuted claims three paragraphs below the correction; a kernel-port worker corrected a false bootstrap claim in its overview prose and left the identical claim intact in the step list forty lines down. Both artifacts self-contradicted after their "correction" commit.

**Why:** editing where the reviewer pointed is not the same as removing the claim. Skimmers read summaries, step lists, and numbered findings — exactly the sections corrections tend to miss.

**How to apply:** after applying review corrections, grep the ENTIRE artifact (and its paired files) for each corrected claim's distinctive phrases before committing — the correction isn't done until the search returns only the corrected form. Related: [[proper-noun-leak-scan-is-not-a-leak-scan]] (comparisons run to exhaustion, not first hit).

**Sharpened 2026-08-02 (operator-gates plan, rounds 4-5).** The grep is necessary and NOT sufficient. I ran exactly the grep this memory prescribes, claimed the artifacts verified, and the next review found stale claims in three surfaces I had not thought to search for. A fixed phrase list can only find staleness you already anticipated, so it confirms the corrections you remember making and is silent on the ones you forgot. Two consequences: (1) enumerate targets by SURFACE, not by phrase — walk every artifact in the set (plan JSON, paired MD, state marker, concept, status) and re-read the sections a reader would treat as current, rather than searching for strings; (2) scope the verification CLAIM to what was actually checked. Writing "every surface now states current truth" when a phrase-grep was run is a claim outrunning its evidence — the same class of error as a declared-but-unconsumed gate. Say "grepped for these phrases; not a proof that no stale claim remains."

Corollary from the same run: a repair reliably introduces fresh defects in the text it newly writes, and the densest specification prose is where they land. Two of five review rounds found defects created by the immediately preceding repair, including one that inverted a security property (a merge rule whose "authority beats chronology" headline still permitted a chronological bypass). When repair rounds start producing new criticals rather than converging, that pattern is itself the finding — escalate to multiple minds or park, don't loop. See [[123-perplexity-321-loop]].
