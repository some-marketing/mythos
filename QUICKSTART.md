# Quickstart — for people who've never used a command line

New to all of this? Start here. This guide assumes you have **never opened a terminal**, never installed developer tools, and have only ever used AI like ChatGPT in a web browser. That's exactly the right starting point. You won't break anything, and you can copy-paste every step.

The single most important thing to understand: **you don't operate this project by typing commands. You talk to an AI assistant in plain English, and it does the work.** This guide gets you to the point where you can do that.

---

## 1. What is this, really?

Mythos is a **guild** — a library of **grimoires** (reusable, step-by-step workflows for real work, dressed in fantasy terms because the metaphor happens to fit: proven procedures a guild keeps on its shelves). Each grimoire captures *the careful way to do a job* so it gets done the same, guardrailed way every time — whether it's the first run or the hundredth.

You don't run a grimoire by hand. An **AI coding assistant** (more on that below) reads the grimoire and casts it for you — that's `/cast-grimoire`, the plain command for "run this framework" — asking you for whatever it needs along the way.

Every grimoire carries an honest **rank** so you know how battle-tested it is: **Iron** (new, unproven), **Bronze** (has run at least once), **Silver** (proven across many real jobs). Start with a Silver-rank grimoire.

---

## 2. What you need first

**A computer** — Mac or Windows both work.

**An AI coding assistant** — this is the key piece. It's *not* a website like ChatGPT. It's an AI that runs on your own computer and can actually open folders, read files, and run tasks for you — like ChatGPT with hands. You'll talk to it, and it drives this project.

We recommend **Claude Code** as your first choice:
- Get it at **[docs.claude.com/claude-code](https://docs.claude.com/en/docs/claude-code)** — there's a desktop app (easiest) and a terminal version.

Other assistants that also work, if you already have one: **Cursor**, **Codex**, or **OpenCode**. Any of them is fine; the rest of this guide uses Claude Code as the example.

---

## 3. Installing the two basics

You need two small things installed once. Take them one at a time.

### The terminal (you already have it)

The **terminal** is a plain text window where you can type instructions to your computer. You don't need to become fluent in it — you'll barely touch it. You just need to know how to open it:

- **Mac:** Press `Cmd + Space`, type **Terminal**, press Enter. A window opens.
- **Windows:** Press the Start button, type **PowerShell**, press Enter. A window opens.

That's it. When a step says "in your terminal," it means this window. You type or paste a line, then press Enter.

### Node.js (the engine)

**Node.js** is free software that lets this project's tools run. Install it once:

1. Go to **[nodejs.org](https://nodejs.org)**.
2. Download the version labelled **LTS** (it means "Long-Term Support" — the stable one). Don't pick the other one.
3. Open the downloaded file and click through the installer (all the defaults are fine).

To confirm it worked, open your terminal and paste this, then press Enter:

```
node --version
```

If you see something like `v20.11.0` (any number 18 or higher), you're set. If you see "command not found," restart your computer and try again — installers sometimes need that.

You genuinely cannot break your computer by typing these. The worst that happens is an error message, which you can paste to your AI assistant and ask "what does this mean?"

---

## 4. Getting the guild onto your computer

There are two ways. The first needs no terminal knowledge at all.

### Easiest: let your AI assistant do it

Open your AI coding assistant, and type this to it in plain English:

> Please clone the repository at `github.com/some-marketing/mythos`, then run `npm run setup` and tell me if it worked.

It will download the project, install what it needs, and run the setup check — narrating what it's doing. If anything's missing (like Node.js above), it'll tell you in plain terms.

### Manual: two lines in the terminal

If you'd rather do it yourself, open your terminal and paste these two lines, pressing Enter after each:

```
git clone https://github.com/some-marketing/mythos.git
cd mythos
npm run setup
```

(`git clone` copies the guild down; `cd` steps into its folder; `npm run setup` runs a friendly first-run check.)

`npm run setup` never touches your own work. The only things it writes are: a `.env` file copied from `.env.example` (only if `.env` doesn't already exist — your existing one is never overwritten), and a repo-local git setting (`core.hooksPath`) that wires up the pre-push guard. It also checks your Node.js version, lists the grimoires it found, confirms one loads, and prints a short "here's your first quest" walkthrough. If it ends without red errors, you're ready.

---

## 5. Your first quest — just by asking

Here's the part that matters. You **describe the goal**; the assistant **casts the grimoire and drives it**.

Open the `mythos` folder in your AI assistant (in Claude Code: point it at that folder). Then talk to it like you'd brief a capable colleague. For example:

> Cast the design-research grimoire to start research for a new patron called Acme Bakery.

or

> I want to audit the SEO of example.com. Which grimoire fits, and can you cast it?

What happens next: the assistant reads the grimoire's instructions, follows its built-in guardrails (the quality rules baked into every grimoire), and **asks you for whatever it needs** — the patron's details, the website address, and so on. You answer in plain English. It does the structured work and hands you the result.

You never have to memorize a single command. If you're curious what's happening under the hood, you can ask "what command did you just cast?" and it'll show you — every mythic name has a plain generic command behind it, listed in [`docs/LEXICON.md`](docs/LEXICON.md).

---

## 6. Optional power-ups (skip this at first)

`npm run setup` will scaffold a `.env` file for you — a private place for optional keys — if the repo ships an example to copy from. **Everything works without touching it** for basic use. Later, if you want deeper automated web research, some grimoires can use a Perplexity API key added there (`npm run research:perplexity` is the command that uses it). If that sentence means nothing to you yet, ignore it — you don't need it to start.

**How the guild thinks (worth knowing early):** this project is built on using *more than one mind*, each with a distinct job — one familiar to do the work, a **different** familiar to run the trial (because a mind reviewing its own work misses its own mistakes), and web research with real sources. You don't need to set any of that up to start, but once you're comfortable, the single highest-value habit is to have a *second, different* mind review what the first one produced before you trust it.

---

## 7. If you get stuck

- **The friendliest help is already there:** your AI assistant can read this entire guild. Just ask it, in plain English — *"how do I cast a grimoire?"*, *"what does this error mean?"*, *"which grimoire should I use for X?"* — and it will answer from the actual files.
- **[docs/LEXICON.md](docs/LEXICON.md)** — the full command reference, world nouns, and rank ladder.
- **[docs/GUILD-CHARTER.md](docs/GUILD-CHARTER.md)** — how work gets handed between minds without anyone losing the thread.
- **[README.md](README.md)** — the overview and the rank ladder.

Welcome to the guild. Start with a proven grimoire, describe what you want in plain words, and let the assistant do the casting.
