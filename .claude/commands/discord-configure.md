---
description: Check the Mythos Discord channel setup and review access policy
mode: REVIEW_ONLY
---

<objective>
Report the complete status of the Mythos Discord bridge: bot token presence, upstream server, MCP registration, and access policy state. Never reveals secret values. Never mutates access state.
</objective>

<process>
- Check bot token presence through an ignored `MYTHOS_DISCORD_TOKEN_REF` binding or the documented generic macOS Keychain service. Report present/absent only — never print the token value.
- Check upstream Discord MCP server at ~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/server.ts. Report present/absent.
- Check MCP registration in .mcp.json for a 'discord' entry pointing at tools/mcp/discord/run-with-token.sh. Confirm it is registered last so a broken build cannot block earlier servers at boot.
- Check access state at ~/.claude/channels/discord/access.json. Missing file = defaults: dmPolicy pairing, empty allowlist. Report: dm policy and meaning, allowed users (count and list), pending pairings (count with codes), configured guild channels (count).
- If bun is not on PATH, report it as absent — it is required to run the Discord channel server.
- End with a concrete next step based on state: token absent → provisioning instructions; token present + server present + policy pairing → Ready; token present + someone allowed → Ready with N user(s) allowed.
</process>

<success_criteria>
- All five checks (token, server, MCP registration, access state, bun) are reported
- No secret values appear in output
- Next step is concrete and actionable
- Report uses Observation: and HYPOTHESIS: labels, never Root Cause: or Diagnosis:
</success_criteria>
