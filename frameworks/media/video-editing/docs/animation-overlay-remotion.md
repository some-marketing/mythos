# Animation Overlay Component — Remotion Engine

> **Source provenance.** The Remotion authoring rules summarized here were
> distilled clean-room from `remotion-dev/skills` (commit
> `8dad6ec5c5c7cedee4d2aa620bb68386f8fe8eb9`, content license **UNSPECIFIED** —
> no LICENSE file, no `license` field in `package.json`). No source text was
> copied. Clean-room receipt:
> `reports/clean-room/receipts/remotion-animation-overlay.json`
> (`CleanRoom/1.0`). The Remotion library itself is separately licensed and free
> for the operator as an individual.

## What this component is

One of the interchangeable engines that can fill the framework's **animation
slot** (`<edit_dir>/animations/slot_<id>/`, see prompt 04 Phase 4 and Rule 10).
Remotion authors motion graphics, animated titles, and overlay clips as React
components and renders them to video, which the framework then composites onto
the cut with the standard PTS-shift (Rule 4).

Use it when an overlay needs programmatic, frame-exact React-authored motion
(animated lower-thirds, kinetic typography, data-driven graphics). For simpler
needs the slot can instead use HyperFrames, Manim, or a plain PIL/ffmpeg
overlay — pick the lightest engine that covers the request.

## Lazy, project-local only

Remotion is **never** installed at the framework root or globally. It is
provisioned on demand inside the animation slot of the specific project that
needs it, the same discipline already documented in `docs/prerequisites.md` for
all animation engines. A fresh scaffold inside the slot looks like:

```bash
# inside <edit_dir>/animations/slot_<id>/
npx create-video@latest --yes --blank --no-tailwind <slot-name>
```

Everything below (composition, assets, render) stays confined to that slot
directory. Nothing Remotion-related is committed to the framework tree.

## Core authoring rules (distilled)

These are the load-bearing rules to honor when authoring a Remotion overlay.
They are re-expressed in our own words; consult the upstream skill for the full
API surface.

### 1. Drive motion off the current frame

Read the playhead with `useCurrentFrame()` and map frame numbers to property
values with `interpolate()` over an explicit frame range. This keeps every
rendered frame deterministic. Reach for `interpolate()` by default; only use
`spring()` when the operator explicitly wants physics-based motion. Tune the
feel with `Easing.bezier(x1, y1, x2, y2)` — the four control points match CSS
`cubic-bezier`, so timing specs from a designer or the web transfer directly.

Clamp the output at the range edges with `extrapolateLeft: "clamp"` and
`extrapolateRight: "clamp"` unless you deliberately want the value to run past
[0, 1].

```tsx
import { useCurrentFrame, interpolate, Easing, useVideoConfig } from "remotion";

const FadeIn = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <div style={{ opacity }}>…</div>;
};
```

### 2. CSS transitions/animations and Tailwind animation classes are FORBIDDEN

The render pipeline captures discrete frames, so time-based CSS does not advance
between them — it silently produces a still or broken result. Two hard
prohibitions:

- No CSS `transition` or `@keyframes`/`animation` properties for animated values.
- No Tailwind motion utilities (`animate-*`, `transition-*` classes).

Every animated value must come from a frame-driven `interpolate()` instead.
(Tailwind for static styling is fine; only its motion utilities are banned.)

### 3. Prefer individual transform properties over a composed string

Animate `scale`, `translate`, and `rotate` as separate style properties with the
`interpolate()` call inline in the `style` prop, rather than building one
`transform: "..."` string. Inline individual properties stay editable as
keyframes in Remotion Studio; a composed string does not.

```tsx
// Preferred — individually animatable, Studio-editable
style={{
  scale: interpolate(frame, [0, 100], [0, 1]),
  translate: interpolate(frame, [0, 100], ["0px 0px", "100px 100px"]),
  rotate: interpolate(frame, [0, 100], ["20deg", "90deg"]),
}}

// Avoid — composed string, not keyframe-editable
const scale = interpolate(frame, [0, 100], [0, 1]);
style={{ transform: `scale(${scale})` }}
```

Only fall back to a `transform` string for effects the individual properties
cannot express (e.g. `skew`, `perspective`, order-sensitive multi-transform
chains).

### 4. Reference assets through `staticFile()` from `public/`

Put images, video, audio, and fonts in the project's `public/` folder, and load
them with `staticFile("name.ext")` rather than raw relative paths — that is what
resolves correctly under both Studio preview and headless render. Remote URLs
are also accepted directly for the media components.

```tsx
import { Img, staticFile } from "remotion";

const Logo = () => (
  <Img src={staticFile("logo.png")} style={{ width: 100, height: 100 }} />
);
```

## Rendering the overlay for compositing

Author and preview in Remotion Studio (`npx remotion studio`), then render the
slot to a clip the framework can composite. After rendering, the overlay is
PTS-shifted to its window start at composite time (framework Rule 4) and laid in
before subtitles, which are always applied last (Rule 1). Multiple overlays are
authored/rendered in parallel slots (Rule 10).
