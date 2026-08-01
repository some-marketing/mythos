---
description: Develop ad copy for Meta campaigns — audit performance, write copy, apply to platform
mode: COORDINATOR
---

<objective>
Develop ad copy for a Meta (Facebook/Instagram) campaign by auditing existing ad performance, researching client context, writing copy variations, and applying changes to the ad platform.
</objective>

<process>
- Load the ad-copy-development skill: .claude/skills/ad-copy-development/SKILL.md.
- Resolve the client code from the argument — look up clients/<code>/ for context.
- Follow the skill's automated_workflow steps 1-6 in order.
- Respect the approval gate — do not write copy until the user approves the plan.
- Apply the naming convention: Concept|Format|Brand|Date (dd.mm.yyyy).
</process>

<success_criteria>
- Performance audit completed before copy is written
- User approved the plan before drafting
- All ads updated, named correctly, and saved in Ads Manager
- Targeting verified against current client website data
</success_criteria>

<handoff>
audit_complete: Present plan for operator approval before drafting
copy_approved: Apply changes to Ads Manager via browser automation
</handoff>
