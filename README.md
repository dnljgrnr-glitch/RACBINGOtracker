# RACBINGO Tracker

A simple, offline-first companion app for running live RACBINGO rounds. Customers play one
at a time against the same physical ball machine: pull a customer's card up, draw balls as
they come out of the machine, and the app watches their card for a win in real time — with a
fireworks celebration and a payout popup the instant they hit one.

No backend, no accounts, no build step. All data is stored locally in your browser via
`localStorage`.

## How a round works

- Each customer plays their own individual round. The ball pool always resets to a full 75
  before the next customer's turn — enter numbers into the app exactly as they come out of
  the machine.
- A round is up to **5 balls**. If a ball you enter repeats a number already pulled this
  round, the app rejects it and tells you to reroll (draw again) — it doesn't count against
  the 5.
- Prizes, checked live after every ball:
  - **Line** (any row, column, or diagonal) = **$25 RACCASH**
  - **Four Corners** = **$75 RACCASH**
  - **Full BINGO** (blackout) = **$100 RACCASH**
- The moment a customer hits a prize tier, a fireworks animation plays and a popup names the
  win and payout — click "Notify Customer ✓" once you've told them, and it clears (queuing
  the next one if they hit more than one tier in the same round).
- Click **End Round / Next Customer** when a customer's turn is done. That archives their
  draws and any wins to History and clears the board for whoever's up next. Their card stays
  saved in the Roster for their next visit.

## Features

- **Roster** — add customers by name, then enter their card numbers into a 5x5 B-I-N-G-O
  grid matching their physical card. Edit or remove anyone at any time. Each card shows how
  many of its 24 numbers are filled in, since a round can only start once it's complete.
- **Play Round** — pick a customer, draw balls one at a time (with reroll protection and
  undo), and watch their card mark live hits until the round ends.
- **History** — every completed round is logged with who played, which balls were drawn, and
  any prizes won, plus a running total of RACCASH awarded.
- **Backup** — export all data as JSON (full backup) or a CSV of winners for record-keeping,
  and re-import a JSON backup at any time.

## Running it locally

No installation needed. Just open `index.html` in any modern browser (double-click it, or
right-click → Open With → your browser). Everything works offline after that.

## Deploying for free with GitHub Pages

1. Create a new repository on GitHub (e.g. `racbingo-tracker`). Leave it empty — no README,
   no `.gitignore`.
2. In this project folder, connect it to that repository and push:
   ```
   git remote add origin https://github.com/<your-username>/racbingo-tracker.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub, go to the repository's **Settings → Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`, branch `main`,
   folder `/ (root)`. Save.
5. GitHub will give you a live URL (usually `https://<your-username>.github.io/racbingo-tracker/`)
   within a minute or two. That's your app — bookmark it on the laptop/tablet you run events
   from.

Because all data lives in that browser's local storage, use the **same browser** on the
**same device** each event, and use the Export Backup button regularly so you always have a
copy outside the browser.

## Data notes

- A customer's card is only playable once every one of its 24 numbered cells is filled in
  (the center free space doesn't need entry).
- Numbers must fall in the standard ranges: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75.
- Only one round can be active at a time, matching the single physical ball machine.
