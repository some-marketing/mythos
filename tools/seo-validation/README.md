# SEO validation

Offline-reporting crawler for pre-launch SEO checks. It discovers pages from
robots and sitemap files, renders them with Playwright, validates common SEO
signals, optionally samples mobile layouts, and writes evidence under the
requested output directory.

```bash
node tools/seo-validation/run.js --site https://example.com --output ./seo-report
```

Playwright and its browser runtime are bring-your-own prerequisites. Install
the repository dependencies and browser needed by your environment before a
live crawl. Basic-auth credentials, when required, belong in an ignored local
configuration file; never commit them.

The default configuration is industry-neutral. Add project-specific URL types
with `site.page_type_patterns`, whose keys are page-type names and whose values
are regular-expression strings or arrays of strings. Associate those types with
Schema.org expectations through `checks.structured_data_expected_types`.

```json
{
  "site": {
    "page_type_patterns": {
      "product": ["^/products/"],
      "locations": ["^/locations/"]
    }
  },
  "checks": {
    "structured_data_expected_types": {
      "homepage": ["Organization"],
      "product": ["Product"]
    }
  }
}
```

The runner performs network and browser activity only when `--site` is
provided. Running it without a site prints usage and exits without creating an
output tree.
