# 03 — Theme Tokens (Picostrap Customizer)

## Objective
Apply the visual spec to the Picostrap 5 theme on the demo site through the WordPress Customizer
API, deterministically, and prove it on the public URL.

## Mode
PATCH_ALLOWED

## Inputs
- `plans/<slug>__visual-spec.md`
- Demo site with Picostrap 5 child theme active and an authenticated admin browser session

## Steps
1. Open `/wp-admin/customize.php`. Confirm the settings exist:
   every Bootstrap variable is a Customizer setting named `SCSSvar_<variable>`.
2. Set the tokens through the API, not the panels (see `docs/picostrap-livecanvas-recipe.md`):
   colours (`body-bg`, `body-color`, `link-color`, `link-hover-color`, `primary`, `secondary`,
   `info`, `warning`, `danger`, `light`, `dark`), typography (`font-family-base`,
   `font-size-base`, `line-height-base`, `headings-font-family`, `headings-font-weight`,
   `headings-line-height`, `headings-color`), shape (`enable-rounded`, `enable-shadows`,
   `border-radius*`), buttons (`btn-border-radius*`, `btn-padding-*`, `btn-font-weight`).
3. Save with `wp.customize.previewer.save()` and read back `state('saved')` and the dirty count.
   Do not trust the Publish button for API-set values.
4. Verify on the public URL: curl `css-output/bundle.css` and grep every hex value and font
   family; curl the homepage and confirm `@font-face` rules for both families (Picostrap
   self-generates them from Fontsource for Google-Font names; no loader tag needed).
5. Turn on "Discourage search engines" in Reading settings. Hand the hosting-level password gate to
   the operator and record it as open until confirmed.
6. Write `outputs/picostrap-customizer-setting-map.md`: every setting id, the value applied, and
   the verification evidence. Record a GIF of the pass.

## Outputs
- `outputs/picostrap-customizer-setting-map.md`
- `outputs/recordings/picostrap-customizer-setup.gif`

## Success Criteria
- Dirty count 0 and `saved: true` after the save call.
- Every token from the visual spec found in the compiled bundle on the public URL.
- Both font families served as real `@font-face` rules on the public page.

## Guardrails
- Panel-by-panel clicking is the fallback, not the method.
- A token that cannot be found in `bundle.css` is not applied, whatever the UI says.
