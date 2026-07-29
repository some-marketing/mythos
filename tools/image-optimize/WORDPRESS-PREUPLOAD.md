# WordPress local pre-upload optimization path

> Slice S4 of the Mythos image-optimization standard. Mechanical flow for getting
> images onto a WordPress dealer site **without** a server-side optimization
> plugin. Posture is **RECOMMENDED** until slice S5 promotes it to required.

## The rule: optimize LOCALLY, deploy ONLY derivatives

No unoptimized bytes ever cross the network. Originals never reach the VPS — only
the `.webp`/`.avif` derivatives the optimizer produced and the preflight checked.

### Explicitly NOT used: server-side optimization plugins

Do **not** install Smush, Imagify, ShortPixel, EWWW, or any server-side
image-optimization plugin. Two reasons:

1. **It burns the constrained VPS.** These plugins re-encode on the box. On a
   75GB Plesk VPS with limited CPU/RAM, background optimization jobs compete with
   live site traffic and can rewrite uploads mid-edit (this is also why
   `wordpress-build-discipline.md` deactivates them during design mode).
2. **It breaks reproducibility.** Server-side re-encoding is non-deterministic
   relative to our build — the bytes on the VPS no longer match a checked
   derivative manifest, so the deploy preflight can no longer verify-by-record.
   The standard's whole guarantee (a checked derivative for every deployable
   raster) is lost.

A WP optimization plugin may exist as defense-in-depth for *human* media-library
uploads only. It is **never** acceptance evidence and never the control.

## The mechanical flow

### 1. Optimize locally with the repo CLI

Run the tiered optimizer over the source assets (Delesign PNGs, theme images,
content media). Tier each asset: `hero` for above-the-fold banners, `content`
for in-page imagery, `thumb` for small/listing images.

```sh
# Hero banners
node tools/image-optimize/cli.cjs optimize-tiered \
  --src <local-assets-dir>/heroes --tier hero \
  --out <deploy-local-dir>/wp-content/uploads/optimized

# In-page content imagery
node tools/image-optimize/cli.cjs optimize-tiered \
  --src <local-assets-dir>/content --tier content \
  --out <deploy-local-dir>/wp-content/uploads/optimized
```

This produces `.webp` derivatives (deterministic `name-<width>.webp` names),
strips metadata, never upscales, hard-fails any derivative over its tier byte cap
unless allowlisted-with-reason, and records each in the derivative manifest.

### 2. Preflight-check before building the upload set

Run the shared deploy preflight over the deploy-local dir BEFORE building any
upload manifest. Pass the framework manifest so its per-framework caps override
applies (see ADJ#4 wiring below). WARN mode reports; it does not yet block.

```sh
node tools/image-optimize/preflight.cjs \
  --dir <deploy-local-dir>/wp-content/uploads/optimized \
  --framework-manifest frameworks/wordpress/livecanvas-rebuild/manifest.json \
  --mode warn
```

A thin convenience wrapper that runs both steps is provided at
`tools/image-optimize/wp-preupload.sh`.

### 3. Deploy ONLY derivatives (WP-CLI / rsync / SFTP)

Register the optimized derivatives into the media library or sync them to the
uploads dir. Pick the mechanism that fits the host:

```sh
# WP-CLI media import (registers in the media library)
wp media import <deploy-local-dir>/wp-content/uploads/optimized/*.webp

# or rsync only the derivatives (no originals)
rsync -av --include='*.webp' --include='*.avif' --exclude='*' \
  <deploy-local-dir>/wp-content/uploads/optimized/ \
  <user>@<host>:<remote-uploads-dir>/optimized/

# or SFTP put of the derivatives only
```

> SSH-key prerequisite (per the plan's gates): bulk SFTP of many assets should
> run over an SSH key, not a password, to avoid fail2ban lockout.

## How the per-framework caps override reaches the preflight (ADJ#4)

The framework manifest's `image_optimization.caps` block declares per-tier byte
ceilings that override `tools/image-optimize/config.json` `policy.tiers` defaults.
`preflight.cjs --framework-manifest <path>` reads that block
(`capsFromFrameworkManifest`) and feeds the caps into the existing
`resolveTiers()` override layer (precedence: explicit `--config`/opts caller
override > framework-manifest caps > config defaults). No new resolution path —
it reuses the S1 tier-resolution layering. The block also carries
`caps_provenance` + `effective_from` pointing at the validation artifact that
justifies the values (currently the convene synthesis; S5 will repoint these at
measured evidence and promote `status` recommended -> required).
