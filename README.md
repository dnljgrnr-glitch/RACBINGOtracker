# RACBINGO Tracker

A simple, offline-first companion app for running weekly RACBINGO rounds. Search for a
customer (or add a new one), record their card, draw balls as they come out of the machine,
and the app checks for a win live — with a fireworks celebration, a payout popup, and a
printable redeemable certificate the instant they hit a prize tier.

No backend, no accounts, no build step. All data is stored locally in your browser via
`localStorage`.

## How it works

- **Find or add a customer** — type a name in the search box on the Play Round tab. Existing
  customers show up as you type (with a "played this week" badge if relevant); if there's no
  match, an "Add as new customer" option appears.
- **Enter their card** — every customer needs a fresh set of 24 numbers entered each week
  (5 per column, center is always free) before a round can start. Click **Generate Random
  Card** to have the app deal a valid card automatically (5 unique numbers per column, drawn
  from that column's official range, with the center free), or enter one by hand from a
  physical card. Previous numbers are pre-filled as a starting point if you're re-entering
  the same customer.
- **Print the card** — once a card is complete, **Print Card (Front/Back)** opens the print
  dialog for a 4x6 index card (landscape), using the official RACBINGO card design: front has
  the branded header, customer name/issue date/card ID, and the B-I-N-G-O grid with a
  checkbox next to each number; back has the "How to Play" steps, prize tiers, quick rules,
  and store contact info. Print the front, flip the card over, then print the back (most
  printers don't duplex index card stock automatically). Also available anytime later from
  the Roster tab for reprints.
- **Validate a card** — click **View Card** on any roster entry to see their stored numbers
  in the actual grid layout (for matching against the physical card) plus a "Progression"
  log of every round they've played, what was drawn, and what they won — useful for
  double-checking data entry and for record-keeping.
- **Weekly alert** — since each customer is meant to play once a week, selecting someone who
  already played in the last 7 days shows a clear warning banner. It doesn't block you from
  starting a round anyway — it's a heads-up, not a hard stop.
- **Play the round** — the ball pool always resets to a full 75 before the next customer's
  turn. There's no cap on balls per round — keep drawing for as long as the customer wants
  to play, all the way to a full-card blackout if they get there. Entering a number that
  repeats one already pulled is rejected ("reroll — draw another ball") without losing any
  progress. A live, read-only card grid on the Play Round screen highlights matches as you
  go, and the full draw history stays visible the whole time. Click any drawn ball to remove
  just that one, or click "Undo Last Draw" for the most recent.
- **Cancel vs. Submit a round** — "Submit Round / Next Customer" saves the round to History.
  "Cancel Round" discards it entirely without saving anything — for a wrong customer pulled
  up by mistake, or any other reason to scrap it — and restores their previous "last played"
  status untouched.
- **Prizes**, checked live after every ball:
  - **Line** (any row, column, or diagonal) = **$25 RACCASH**
  - **Four Corners** = **$75 RACCASH**
  - **Full BINGO** (blackout) = **$100 RACCASH**
- **Win celebration** — the instant a customer hits a tier, fireworks play and a popup names
  the win and payout, with buttons to print a certificate and to **Continue Playing** — the
  round keeps going with every ball and all progress intact, so a customer can keep drawing
  from a Line win up through Four Corners or a full Blackout in one continuous round.
- **Redeeming a reward** — redemption is tracked separately from winning, since a customer
  might not cash in right away. In the History tab, every unredeemed win has a "Confirm
  Redemption & New Card" button — it checks the reward off with today's date logged, and
  immediately takes you to the Play Round screen with that customer selected and ready for
  their next card.
- **Printable certificate** — available from the win popup or anytime later from History.
  Recreates the RAC Cash voucher look (logo, ornate corners, cart/handshake icons, fine
  print) for the exact dollar amount won, centered on the page with a personalized
  congratulatory message, a thank-you note from the team, and a staff redemption line at the
  bottom. Printing uses your browser's normal print dialog (Ctrl/Cmd+P equivalent, triggered
  automatically).
- **Fixing mistakes** — every round in History can be edited at any time via "Edit Round":
  reassign it to a different customer (for a wrong-name pull), add or remove individual
  drawn balls (for an invalid entry), or delete the round outright. Wins are automatically
  rechecked against the edited data, so prizes stay accurate — a pattern that still holds
  keeps its original redeemed status; one that no longer holds is dropped.
- **Help tab** — a full, step-by-step reference for every feature in the app, written for
  quick lookup at the table. It ends with a **Tips & Scripts** section: ready-to-use lines
  for introducing the game, announcing a win, and pitching a promotion, plus an example
  tiered bonus-draw structure (e.g. 2 weeks down = 2x the draws in their round, a month down
  = 3x the draws + 1 bonus draw) and tips for running it in practice.

## Features

- **Customer search** — fast typeahead search across your whole roster, or add someone new
  on the fly, right from the Play Round tab.
- **Roster** — every customer with their card-entry status, last-played date (with a "this
  week" flag), any pending unredeemed rewards, and a one-click jump into a new round for
  them. Expand **View Card** to validate their numbers and see their play history. Rename or
  remove anyone.
- **History** — every completed round logged with who played, the balls drawn, and any
  prizes — plus a running total of RACCASH awarded and how much is still unredeemed.
- **Backup** — export all data as JSON (full backup) or a CSV of winners (including
  redemption status) for record-keeping, and re-import a JSON backup at any time.

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
**same device** each week, and use the Export Backup button regularly so you always have a
copy outside the browser.

## Data notes

- A round can only start once all 24 of a customer's card numbers are entered (the center
  free space doesn't need entry).
- Numbers must fall in the standard ranges: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75.
- Only one round can be active at a time, matching the single physical ball machine.
- "Played this week" is a rolling 7 days from their last round's start time, not a calendar
  week — adjust in `app.js` (`WEEK_MS`) if you'd rather it reset on a fixed day.
- The $25 / $75 / $100 voucher graphics on the printable certificate are a coded recreation
  of the RAC Cash template's look (not the literal scanned artwork), since those exact
  denominations aren't among the pre-printed vouchers you provided.
- The printable card's 4x6 landscape page size is set via a named CSS page (`@page
  card-page`), which is well supported in Chrome/Edge. If you print from a browser that
  ignores it, just set the paper size to 4x6 (or "Index Card") manually in the print dialog.
- The card's back lists the real, current prize tiers ($25/$75/$100) rather than a flat
  amount, and its store address/phone are hardcoded in `app.js` (`STORE_ADDRESS`,
  `STORE_PHONE`) — update those if the store location changes.
- Card ID on the printed card is generated from the customer's internal ID plus the issue
  date (e.g. `RB-F8QZ5V-072126`) — it's for matching a physical card back to its digital
  record, not a security feature.
