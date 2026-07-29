# docs/BROWSERSTACK_AUTOMATION_GUIDE.md
How to turn form-intake results into BrowserStack automation tests.

## Stack & structure
This repo’s automation setup is designed around:
- pytest + Selenium WebDriver + BrowserStack SDK
- tests under `sdk-tests/`
- multiple BrowserStack config yml files for quick/desktop/mobile coverage

## The “1 parallel session” constraint
Your plan supports 1 parallel session. All BrowserStack config files must enforce sequential execution:
- `parallelsPerPlatform: 1`

## Recommended dev workflow
1) Use quick config for iteration
2) Expand to desktop matrix
3) Expand to iOS and Android matrices

## Reliability patterns you must use in tests
- Always `scrollIntoView({block:'center'})` before interacting.
- Use JavaScript click (`driver.execute_script("arguments[0].click()", el)`) instead of normal click when flakiness exists.
- Multi-page forms with conditional logic:
  - After clicking Next, wait ~3 seconds.
  - Assert the next page is visible by checking a known field is present.

## Mobile notes (iOS Safari)
- Wheel scrolling is unreliable on iOS; use JS scrolling.
- Use longer timeouts and additional waits.

## Popup handling
Do not assume a single selector identifies popups.
Use multi-strategy:
1) detect form fields directly
2) try popup container selectors
3) check visibility changes
4) check iframes

## Outputs expected from browser-intake
Use `frameworks/wordpress/qa/prompts/01_INTAKE_AND_SCAFFOLD.md` to generate:
- Automation intake spec (human)
- Locator + flow JSON contract (machine)
- pytest draft test file (code)
