# Creative asset renaming

`rename-delivered-assets.py` normalizes design-vendor-delivered creative
filenames (statics/videos delivered with generic slot/concept names) into a
stable, distinct, reversible convention, driven entirely by a JSON config —
nothing about a specific delivery, client, or vendor is hardcoded in the
tool itself.

```bash
# Dry run (default) -- prints the rename map + flagged files, changes nothing
python3 tools/creative/rename-delivered-assets.py --config <your-config.json>

# Apply
python3 tools/creative/rename-delivered-assets.py --config <your-config.json> --apply
```

Copy `configs/example-delivery.config.example.json`, fill in your own
`deliveryRoot` and per-slot grounding data (year/make/model/promo, taken
from your own brief/offer documents), and point `--config` at it.

**Grounding rule (hard):** year/make/model/promo are never read from image
pixels — only from your config plus the slot/design/variant/ratio tokens
already present in the delivered filename. A file whose slot isn't in your
config, or whose name doesn't parse against one of the two known naming
formats, is flagged and left untouched rather than guessed.

## What's excluded

The two real delivery configs this tool shipped with in the source repo
(real dealership names, real vehicle models/promos, a real operator's Drive
mount path) were excluded — they're one delivery's actual data, not a
reusable pattern. `configs/example-delivery.config.example.json` replaces
them with a fully worked fictional example showing the same shape.
