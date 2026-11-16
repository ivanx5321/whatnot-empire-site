# Cowork → Claude Code requests

Claude (Cowork / chat) acts as the **operations manager**. Claude Code acts as the **software engineer**.
They don't share conversations, memory, or permissions. **This folder plus GitHub PRs is the handoff.**

## Flow
1. **Cowork** spots an operational problem and writes `docs/requests/YYYY-MM-DD-short-name.md` from `TEMPLATE.md`. It commits that file to a branch or saves it into the local repo folder.
2. **Levi** says "build request <name>" in Claude Code (on the Mac mini, inside this repo).
3. **Claude Code** implements on a `feature/` branch, runs tests, fills in *Engineering notes*, and opens a PR.
4. **Cowork** checks the PR / staging result against the *Acceptance criteria* and adds a *Verification* note.
5. **Levi** approves and merges. A merge to `main` deploys to production on Render.

## Rules
- No passwords, API keys, tokens, or customer/student personal data in these files.
- One request per file. Keep the business "why" in the file so either side can pick it up cold.
