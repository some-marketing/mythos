# Picostrap 5 + LiveCanvas — the mechanical recipe

Verified on the reference run (2026-09-09). `<site>` is the demo domain. Everything below runs from
an authenticated admin browser session; nothing needs credentials in text.

## 1. Picostrap Customizer = `SCSSvar_*` settings

Every Bootstrap SCSS variable is a WordPress theme_mod / Customizer setting named
`SCSSvar_<variable>` (~150 on a stock install). The Customizer compiles SCSS in the browser on
change and writes `wp-content/themes/<child>/css-output/bundle.css?ver=N` on save.

Enumerate: on `/wp-admin/customize.php`
```js
const ids=[]; wp.customize.each(s=>{ if(/^SCSSvar_/.test(s.id)) ids.push(s.id) }); ids
```

Apply (example token set — replace values from the visual spec):
```js
const vals = {
  'SCSSvar_body-bg':'#ffffff', 'SCSSvar_body-color':'#1c2530',
  'SCSSvar_link-color':'#1f48ff', 'SCSSvar_link-hover-color':'#38b6ff',
  'SCSSvar_primary':'#38b6ff', 'SCSSvar_secondary':'#1c2530', 'SCSSvar_info':'#1f48ff',
  'SCSSvar_warning':'#d97706', 'SCSSvar_danger':'#c0392b', 'SCSSvar_light':'#eef3f8', 'SCSSvar_dark':'#1c2530',
  'SCSSvar_font-family-base':'"Figtree", system-ui, sans-serif',
  'SCSSvar_font-size-base':'1.0625rem', 'SCSSvar_line-height-base':'1.65',
  'SCSSvar_headings-font-family':'"Rammetto One", "Cooper Black", serif',
  'SCSSvar_headings-font-weight':'400', 'SCSSvar_headings-line-height':'1.15', 'SCSSvar_headings-color':'#1c2530',
  'SCSSvar_enable-rounded':'true', 'SCSSvar_enable-shadows':'false',
  'SCSSvar_border-radius':'1rem', 'SCSSvar_border-radius-sm':'.75rem', 'SCSSvar_border-radius-lg':'1.5rem',
  'SCSSvar_border-radius-xl':'2rem', 'SCSSvar_border-radius-2xl':'3rem',
  'SCSSvar_btn-border-radius':'50rem', 'SCSSvar_btn-border-radius-sm':'50rem', 'SCSSvar_btn-border-radius-lg':'50rem',
  'SCSSvar_btn-padding-y':'.75rem', 'SCSSvar_btn-padding-x':'1.5rem', 'SCSSvar_btn-font-weight':'600',
};
for (const [k,v] of Object.entries(vals)) if (wp.customize.has(k)) wp.customize(k).set(v);
wp.customize.previewer.save();   // NOT the Publish button for API-set values
```

Read back: `wp.customize.state('saved').get()` → `true`, dirty count → 0.

Verify on the public URL:
```
curl -s "https://<site>/wp-content/themes/<child>/css-output/bundle.css?ver=N" | grep -oE '(#38b6ff|Rammetto One|border-radius:50rem)' | sort | uniq -c
curl -s "https://<site>/?nocache=1" | grep -n "font-family:'Rammetto One'"   # @font-face auto-generated from Fontsource
```

Notes: Picostrap self-generates `@font-face` from Fontsource (jsDelivr) for Google-Font family
names; `picostrap_fonts_header_code` is not needed. The font picker hides static fonts behind
"Kind: Variable only". Sidebar **Download JSON / Upload JSON** exports the whole `SCSSvar_*` set
(demo → production copy). Site icon: `wp.customize('site_icon').set(<media id>)` +
`previewer.save()`.

## 2. LiveCanvas page injection

Editor URL: `https://<site>/?lc_action_launch_editing=1&from_url=%2F` (page) or
`https://<site>/?lc_partial=header&lc_action_launch_editing=1` (header/footer partials, created
by LiveCanvas → Templating Settings → "Use LiveCanvas to design the header/footer").

Globals: `doc` (working DOM), `getPageHTML(selector)`, `setPageHTML(selector, html)` (selector
**first**), `updatePreview()`, `lc_editor_current_post_id`, `lc_editor_fragment_type`.
Page content root is **`main#lc-main`** (`main#theme-main` is the theme wrapper).

```js
setPageHTML('main#lc-main', html);   // full page, or edit doc.querySelector(...) in place
updatePreview();
// wait ≥ 6 s, click the top-bar "Save" link, wait ≥ 8 s
```
Then curl the public URL with a cache-buster and grep a marker only the new content has. A Save
clicked ~4 s after `updatePreview()` has been observed to report success and not persist.

Markup conventions: one `<section>` per band; `.lc-block` on every editable unit;
`editable="inline"` / `editable="rich"`; Bootstrap 5 utilities; `[lc_home_url]` in the brand link;
`ratio ratio-4x3` + `object-fit-cover` + inline `object-position` to crop photos in CSS without
touching the originals.

Mobile check: the top-bar device toggles (XS = "Emulated Moto G Power", ~412 px) render the real
theme CSS in `#previewiframe`; scroll it with
`document.querySelector('#previewiframe').contentWindow.scrollTo(0,0)`. `resize_window` on the
Chrome tab does not change the viewport.

## 2b. Verifying against a password-gated demo

The public-URL curl checks above assume the demo answers anonymously. Once the hosting-level
password gate is on, run them with `curl --netrc-file <path outside the repo> …`, where the netrc
file (mode 600, e.g. `~/.config/mythos/demo-gates/<CODE>.netrc`) holds
`machine <demo-host> login <user> password <pass>` and is written by the operator or by
`op read` redirected straight into that file — never echoed. Do not pass credentials as command
arguments in any form: `curl -u "$USER:$PASS"` is expanded by the invoking shell before any
resolver runs, so the values land in the argument list and in tool logs. Never paste credentials
into a command, a log, a capture or any file under the project, and never drop the gate to make a
check easier.

## 3. Media

`wp-admin/media-new.php?browser-uploader` exposes a plain `<input type=file>`; upload, click
Upload, then `GET /wp-json/wp/v2/media?per_page=N&orderby=date&order=desc&_fields=id,source_url`.
WordPress adds `-scaled` above 2560 px and `-rotated` for EXIF-portrait JPEGs.

Favicon: crop the mark from the horizontal lockup (Pillow: alpha bbox → fit into 512×512 with 8%
padding, transparent), upload, set as site icon (above). WordPress serves 32/192/apple-touch sizes.

## 4. Tool candidates (not yet built)

- `tools/wordpress/picostrap-apply.js` — JSON token file → Customizer API → `previewer.save()` → curl verify.
- `tools/wordpress/livecanvas-set-page.js` — `(site, postId|partial, htmlFile)` → inject → Save → curl verify.
Both via Playwright with a logged-in storage state. Until they exist, Stages 3–4 run on a frontier
mind through Claude-in-Chrome, one tab per task.
