# Docgen Safety Rules {#docgen-safety}

These rules apply to all `/documentation:*` commands and the documentation skill/agents.

## 1. Live Site Protection

1. **NEVER save changes to the live site** — Always undo test edits (Ctrl+Z), never click Update/Publish/Save
2. **Clean up drafts** — If any test posts or pages are created during capture, move them to Trash before the session ends
3. **Undo before navigate** — Before navigating away from an edited page, verify all test changes are reverted

## 2. Credential Safety

4. **NEVER expose real credentials in screenshots** — Before capturing a screenshot of a login form, mask the password field by setting its value to `'--------'` via `browser_evaluate`
5. **NEVER store credentials in config files** — `config.json` stores the wp_username but NEVER the password
6. **Credentials in transit only** — WordPress passwords are provided interactively per session and never persisted

## 3. Plugin Detection

7. **SEO plugin detection** — If no supported SEO plugin (Yoast, RankMath, AIOSEO) is found, skip the `update_seo` guide entirely and log a warning in the status output
8. **Editor detection** — If the site uses a page builder (Elementor, Divi, WPBakery) instead of Gutenberg, record as major drift and propose adapted instructions

## 4. Notion Safety

9. **Notion updates are REPLACE** — Only replace content body via `replace_content`. Never modify page titles, parent structure, or database properties
10. **No duplicate portals** — Before duplicating the template, check if the client already has a config. If so, warn the user and ask before proceeding

## 5. Docgen Checklist

- [ ] No test edits persisted on the live site
- [ ] All test posts/pages moved to Trash
- [ ] Password fields masked in all screenshots
- [ ] No credentials stored in local files
- [ ] SEO guide skipped if no plugin found
- [ ] Notion page titles and parents unchanged
- [ ] Drift reports written for all captured guides
