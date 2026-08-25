# Sound Coffee — Your Complete Workflow Guide

This covers everything: viewing the site on your computer, and publishing
changes to the real live website. Keep this doc handy — it's also saved
inside the project folder itself (as WORKFLOW.md) so you'll always have it.

---

## The big picture

There are three things working together:

1. **Your computer** — where you preview the site before it's public
2. **GitHub** — stores the project's code (think: the master copy)
3. **Cloudflare** — takes what's on GitHub and actually serves it to the
   world at your real URL

The flow is always: Claude gives you updated files → you preview them on
your computer (optional but recommended) → you push them to GitHub →
Cloudflare automatically publishes them. You never manually upload anything
to Cloudflare — it watches GitHub and rebuilds itself every time.

---

## Part 1 — One-time setup (you've likely already done this)

- [ ] Node.js installed (nodejs.org)
- [ ] A GitHub account, with the `soundcoffee` repo created
- [ ] A GitHub Personal Access Token saved somewhere safe (Settings →
      Developer settings → Personal access tokens on github.com) — this
      acts as your password when pushing code
- [ ] A Cloudflare account, with the project connected to your GitHub repo

If any of those aren't done yet, tell Claude and it'll walk you through
that specific piece again.

---

## Part 2 — Whenever Claude gives you an updated project

This is the routine you'll repeat most often.

### Step A: Get the new files

1. Download the `sound-coffee.zip` Claude shares.
2. Find your **old** `sound-coffee` folder (probably in Downloads) and
   delete it completely, so there's no old/new mixup.
3. Unzip the new `sound-coffee.zip`.

### Step B: Preview it on your computer (optional, but good practice)

1. Open Terminal.
2. Type `cd ` (with a space), then drag the `sound-coffee` folder into the
   window, and press Enter.
3. Type `npm install` and press Enter. Wait for it to finish.
4. Type `npx next dev --webpack` and press Enter.
5. Open **http://localhost:3000** in your browser to look around.
6. When you're done looking, go back to Terminal and press **Ctrl+C** to
   stop it.

### Step C: Publish it to the real website

Still in that same Terminal window, inside the `sound-coffee` folder:

1. Type: `git remote add origin https://github.com/otisbitmeyer/soundcoffee.git`
   and press Enter. *(If it says "remote origin already exists," that's
   fine — just skip this step and move to the next.)*
2. Type: `git push -u origin main --force` and press Enter.
3. When asked for a **Username**: type `otisbitmeyer`
4. When asked for a **Password**: paste your Personal Access Token (it
   won't show any characters as you paste — that's normal) and press Enter.
5. Wait a few seconds. Cloudflare will notice the update automatically and
   rebuild your live site — usually done within a minute or two.

That's it. No separate "upload to Cloudflare" step, ever.

---

## Quick reference: commands you'll use often

| What you want to do | Command |
|---|---|
| Go into the project folder | `cd ` then drag the folder in |
| Confirm you're in the right folder | `pwd` |
| See what files are there | `ls` |
| Install/update dependencies | `npm install` |
| Preview the site locally | `npx next dev --webpack` |
| Stop the local preview | Ctrl+C |
| Publish to the live site | `git push -u origin main --force` |

---

## If something goes wrong

- **"command not found" or weird errors right after unzipping** → you
  probably forgot `npm install` before trying to run the site. Run it,
  then try again.
- **Permission denied on a folder** → you forgot to type `cd` before the
  folder path. Type `cd ` (with a space) first, then drag the folder in.
- **Terminal seems frozen / stuck spinning** → double-check you're
  actually inside the `sound-coffee` folder with `pwd`. Most "stuck"
  moments have actually been this.
- **Git asks for username/password and rejects it** → your token may have
  expired or lacked permission. Generate a fresh one at
  github.com/settings/tokens/new with the "repo" box checked.
- **Anything else** → copy the exact error text and send it to Claude.
  Exact error messages (not "it didn't work") are what let Claude find
  the fix fast.
