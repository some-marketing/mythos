# The Core

`safety.yaml`, alongside this file, is immutable and enforced — the generator hard-fails
if a change would weaken it. This file is different: it is the guild's philosophy, not
enforcement machinery. It is read, not run. Where it and a mechanism disagree, the
mechanism wins — a doctrine describes what good behavior looks like, it doesn't grant
itself authority over the code that actually executes.

## Alias-authority law

A mythic name is a lens, never a mechanism. `cast-grimoire` and `run-framework` are the
same command wearing two names, and the plain one — the `resolves_to` target — is the
one with authority. If a mythic name and its target ever disagree about behavior, the
target is right and the alias is a bug. Immersion is free; correctness is not negotiable
for it.

This is why the guild ships `resolves_to` in the alias registry instead of renaming files:
a name is presentation, and presentation should never be load-bearing.

## Rank honesty: evidence, not intention

A grimoire's rank — Iron, Bronze, Silver, Gold — is a record of what has actually
happened to it, never a record of how good anyone expects it to be. A freshly scribed
grimoire is Iron even if you're certain it's brilliant; it stays Iron until it has
actually run. A grimoire that has run once is Bronze, not Silver, no matter how clean
that one run looked. Rank moves up only when the evidence for the next tier exists —
never in advance of it, never on the strength of confidence alone.

The corollary: it is never a failure for a grimoire to sit at Iron or Bronze. It is only
a failure to claim a rank the evidence doesn't support.

## A producer never validates its own trial

The mind that did the work is never the mind that judges whether the work is good. A
trial (review) always sits with a distinct mind from whoever produced the thing under
review — not as etiquette, but because a mind checking its own output tends to see what
it meant to write, not what it actually wrote. If a producer's own claim of success were
sufficient, trials would have no reason to exist. This applies at every scale: a single
familiar reviewing its own patch, and a guild reviewing its own doctrine, fail the same
way for the same reason.

## The repository/export membrane

What a session knows about you — your Mirror — and what the repository tracks, stages,
generates, or exports are two different surfaces, and the boundary between them does not
move. The Mirror can inform how a session talks to you; it can never leave a trace in
anything that gets committed, staged, built, or shipped. A repository that behaves
differently depending on whether a Mirror is present has already broken this law, even
if the difference looks harmless. The only approved place Mirror content is allowed to
surface is a clearly labeled, advisory context payload handed to a session at its start —
nowhere else, ever.

## Do no harm

Every rule above exists to keep the guild trustworthy to the people who rely on it: don't
claim rank you haven't earned, don't let a producer grade its own work, don't let personal
context leak into shared surfaces, and don't let a pretty name quietly change what a
command actually does. None of these are abstract virtues — each one is a specific way
Mythos could otherwise quietly stop deserving the trust it asks for.
