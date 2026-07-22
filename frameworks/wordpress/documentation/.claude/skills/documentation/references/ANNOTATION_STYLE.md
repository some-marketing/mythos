# Screenshot Annotation Style Guide

Standard annotation style for all docgen screenshots. Annotations are injected via
`page.evaluate()` as positioned fixed divs with class `docgen-annotation` before taking
the screenshot. Cleaned up after capture.

## Color Palette

| Role | Color | Hex | When to use |
|------|-------|-----|-------------|
| Primary | Red | `#e74c3c` | The main action target (what to click) |
| Secondary | Blue | `#3498db` | Supporting element or second action |
| Tertiary | Green | `#2ecc71` | Orientation element ("find this first") |
| Info | Orange | `#f39c12` | Informational callout (non-interactive) |

## Annotation Elements

### Outline
- 3px solid border in the assigned color
- 4px border-radius
- 4-6px padding around target element
- Applied via `outline` or a positioned wrapper div

### Label
- White text on colored background (matching the outline color)
- Font: 13-14px bold sans-serif
- Padding: 3-4px vertical, 10-12px horizontal
- Border-radius: 4px
- Drop shadow: `0 2px 6px rgba(0,0,0,0.3)`
- Positioned near the target element (not overlapping it)

### Numbering
When multiple callouts appear on one screenshot, prefix each label with a number:
- "1 Post Title"
- "2 Add Blocks"
- "3 Settings Gear"

Numbers use the same style as the label text.

### Positioning
Labels go where they won't obscure the target — below, above, or to the side.
The label should have clear visual association with its target (proximity, not arrows).

## When to Annotate

**DO annotate:**
- Action targets the step text references ("Click X" -> annotate X)
- Hidden or toggled elements that are easy to miss
- Elements that could be confused with similar-looking siblings
- Multiple related targets in one screenshot (use numbering)

**DON'T annotate:**
- Obvious single buttons that the step text names and nothing else competes with
- Entire page layout shots (overview screenshots)
- Elements the user doesn't interact with in that step

## When NOT to Annotate

Some steps are "verify" or "overview" actions where the screenshot shows the full UI
state without a specific click target. These can remain unannotated.

## Technical Implementation

### Injection Pattern

```javascript
// Inject via page.evaluate() before screenshot
await page.evaluate(() => {
  // Outline
  const target = document.querySelector('.target-selector');
  if (target) {
    const rect = target.getBoundingClientRect();
    const outline = document.createElement('div');
    outline.className = 'docgen-annotation';
    Object.assign(outline.style, {
      position: 'fixed',
      left: (rect.left - 6) + 'px',
      top: (rect.top - 6) + 'px',
      width: (rect.width + 12) + 'px',
      height: (rect.height + 12) + 'px',
      border: '3px solid #e74c3c',
      borderRadius: '4px',
      zIndex: '999999',
      pointerEvents: 'none'
    });
    document.body.appendChild(outline);

    // Label
    const label = document.createElement('div');
    label.className = 'docgen-annotation';
    label.textContent = 'Click Here';
    Object.assign(label.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: (rect.bottom + 8) + 'px',
      background: '#e74c3c',
      color: 'white',
      padding: '3px 10px',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      zIndex: '999999',
      pointerEvents: 'none'
    });
    document.body.appendChild(label);
  }
});
```

### Cleanup Pattern

```javascript
// Remove all annotations after screenshot
await page.evaluate(() => {
  document.querySelectorAll('.docgen-annotation').forEach(el => el.remove());
});
```

### Multi-Annotation Example

For steps with multiple targets, inject each with incrementing z-index and numbered labels:

```javascript
const annotations = [
  { selector: '.post-title', label: '1 Post Title', color: '#e74c3c' },
  { selector: '.block-inserter', label: '2 Add Blocks', color: '#3498db' },
  { selector: '.settings-gear', label: '3 Settings', color: '#2ecc71' }
];
```

## File Size Guidelines

- Screenshots should be viewport-sized (typically 1280x720 or 1280x800)
- Target file size: under 300KB for most screenshots
- Maximum: 500KB
- Use PNG format for all screenshots
- Never take `fullPage: true` screenshots — viewport only
