# RACBINGO Tracker

A simple, offline-first companion app for running RACBINGO. Each customer plays on one
ongoing card that persists across as many weekly visits as it takes — search for a customer
(or add a new one), draw a few balls, and the app checks for a win live against their full
draw history, not just this visit — with a fireworks celebration, a payout popup, and a
printable redeemable certificate the instant they hit a prize tier. The card keeps building
week after week until they redeem or you close it out.

No backend, no accounts, no build step. All data is stored locally in your browser via
`localStorage`.

## Signing in

The app opens to a lock screen. Current staff credentials:

- **Username:** `650Goats`
- **Password:** `Goat650$`

This is a client-side gate for a single shared store computer, not real security — there's
no backend, so the credentials live in plain text in `app.js` (`AUTH_USERNAME`,
`AUTH_PASSWORD`) and anyone with browser dev tools could read or bypass them. It exists to
keep casual customers from poking at the register computer, not to withstand a determined
attacker. Once logged in, the session stays active until you click **Log Out** (top right) or
close the browser — sessions don't carry over between browsers/devices, and there's no
per-employee login yet. Revisit this properly (real accounts, a backend) before this app
handles more than one trusted machine.

## How it works

- **Find or add a customer** — type a name in the search box on the Play Round tab; matches
  show up as you type (with a "played this week" badge if relevant), click one to select it.
  Press **Enter** instead of clicking to jump straight in: an exact (or single unambiguous
  partial) name match selects that customer immediately, and no match at all pops up an
  **Add as new customer?** confirmation. Selecting a returning customer with a card already
  in progress jumps straight into it — their full ball history and card marks are right
  there, picking up exactly where they left off. Selecting a customer with no game in
  progress (brand new, or their last game was just closed out) shows a **Their Last
  Completed Game** summary for reference, then the card setup screen.
- **Active Players** — the Play Round home screen also lists everyone currently mid-card
  right below the search bar (week number, balls drawn, Blackout progress, whether they've
  drawn this week yet), sorted most-recently-played first. One click jumps straight into
  their live game — no typing needed for someone who's already playing.
- **Set up a card** — a customer needs a complete set of 24 numbers (5 per column, center is
  always free) before a game can start. Click **Generate Random Card** to have the app deal a
  valid card automatically (5 unique numbers per column, drawn from that column's official
  range, with the center free), or enter one by hand from a physical card. This is the one
  card they'll play on until they redeem or you close out their game — it isn't regenerated
  weekly. Manual entry is checked against the column's number range and against the rest of
  that customer's card — a number typed in twice anywhere (a likely copy error, since real
  cards never repeat a number) is rejected with a clear warning instead of being silently
  accepted.
- **Print the card** — once a card is complete, **Print Card (Front/Back)** opens the print
  dialog for a 4x6 index card (landscape), using the official RACBINGO card design: front has
  the branded header, customer name/issue date/card ID, and the B-I-N-G-O grid with a
  checkbox next to each number; back has the "How to Play" steps, prize tiers, quick rules,
  and store contact info. Print the front, flip the card over, then print the back (most
  printers don't duplex index card stock automatically). Also available anytime later from
  the Roster tab for reprints.
- **Validate a card** — click **View Card** on any roster entry to see their stored numbers
  in the actual grid layout (for matching against the physical card) plus a "Progression"
  log of their current in-progress game (if any) and every past closed game, what was drawn,
  and what they won — useful for double-checking data entry and for record-keeping.
- **Weekly pacing** — customers are meant to draw a handful of new balls each week (about 5
  is the usual pace); if someone already had balls drawn in the last 7 days, a note shows
  when you pull up their game. It's a heads-up, not a hard stop — there's no built-in limit
  on balls per visit, that pace is a house guideline for staff to follow.
- **Play each visit** — balls drawn accumulate onto the customer's ongoing card forever, not
  just this visit — entering a number that's ever been pulled for that card is rejected
  ("reroll — draw another ball") without losing any progress. A live, read-only card grid on
  the Play Round screen highlights every match so far, and the full draw history stays
  visible. Click any drawn ball to remove just that one (works on any past ball, not just
  today's), or click "Undo Last Draw" for the most recent. The number field is focused
  automatically the moment a customer's live game appears — start typing the next ball
  right away, no need to click into the box first.
- **Done for Now vs. Cancel** — "Done for Now / Next Customer" just steps away from this
  customer; nothing to discard, every draw is already saved. "Cancel" is only available
  before any ball's been drawn this visit (it fully discards an empty game started by
  mistake) — once a ball is drawn, correcting a mistake means removing that specific ball
  instead, since it's already part of their permanent card history.
- **Prizes**, checked live after every ball — each tier pays out **once per card**, however
  many weeks it takes:
  - **Line** (any row, column, or diagonal) = **$25 RACCASH** — the first line completed
    wins this once; finishing more lines afterward doesn't add another $25.
  - **Four Corners** = **$75 RACCASH** — independent of Line; a customer can hit Four
    Corners before ever completing a line, and both still pay out separately.
  - **Full BINGO** (blackout) = **$100 RACCASH** — a fully-covered card always contains
    complete lines and all four corners too, so reaching Blackout guarantees all three
    tiers are present.
  - Max payout per card is $200 ($25 + $75 + $100).
- **Win celebration** — the instant a customer hits a tier, fireworks play and a popup names
  the win and payout, with buttons to print a certificate and to **Continue Playing** — play
  keeps going with every ball and all progress intact, so a customer can keep drawing from a
  Line win up through Four Corners or a full Blackout, whether that happens in one visit or
  across several weeks.
- **One certificate per card, not per milestone** — redeeming covers everything a card has
  won so far, all at once. Right on the Play Round screen, the **Redeem $[amount] & Start New
  Card** button (or **Close Out & Start New Card** if nothing's won) closes out the game,
  logs it to History, resets their card, and takes you straight into setup for their next
  one. A customer can redeem at any point, not just after reaching Blackout.
- **Printable certificate** — available from the win popup, from History, or by clicking any
  pending reward pill on a customer's Roster entry (jumps straight to their live game if
  still in progress, or to the matching closed record in History). Uses the official "RAC
  BINGO REWARDS" certificate template, and always reflects the card's current running total
  (not just the tier that was just hit). Shows the real, approved RACCASH bill graphic for
  that exact amount — never a redrawn or edited version. Every possible total ($25 Line, $75
  Four Corners, $100 Line + Corners or Blackout alone, $200 full Blackout) has its own exact
  real bill, so a single bill always appears — a full Blackout additionally shows a gold
  "GRAND PRIZE" medal over the bill — plus a breakdown table of all three tiers (showing $0
  for any not won) and the running total. Printing uses your browser's normal print dialog
  (Ctrl/Cmd+P equivalent, triggered automatically).
- **Fixing mistakes** — for an in-progress card, remove any wrong ball right from the Play
  Round screen. For a closed game, every entry in History can be edited via "Edit Round":
  reassign it to a different customer (for a wrong-name pull), add or remove individual
  drawn balls, or delete it outright. Wins are automatically rechecked against the edited
  data, so prizes stay accurate.
- **Help tab** — a full, step-by-step reference for every feature in the app, written for
  quick lookup at the table. It ends with a **Tips & Scripts** section: ready-to-use lines
  for introducing the game, announcing a win, and pitching a promotion, plus an example
  tiered bonus-draw structure (e.g. 2 weeks down = 2x the draws that visit, a month down = 3x
  the draws + 1 bonus draw) and tips for running it in practice.

## Features

- **Customer search** — fast typeahead search across your whole roster, or add someone new
  on the fly, right from the Play Round tab.
- **Roster** — every customer with their card-entry status, last-played date (with a "this
  week" flag), and — for anyone with a card in progress — a quick game-progress summary
  (which week they're on, total balls drawn, whether they've drawn this week yet, and a
  progress bar toward Blackout). A clickable pill shows any pending unredeemed reward, live
  or already closed (jumps straight to their live game or the matching History record), plus
  a one-click jump into their game for them. Expand **View Card** to validate their numbers
  and see their play history. Rename or remove anyone — if they have an unredeemed reward or
  a card in progress, the confirmation dialog says so before you commit (closed round
  history stays in History either way; an in-progress card is discarded if you remove them).
- **History** — every closed (redeemed or reset) game logged with who played, the balls
  drawn, and any prizes — plus a running total of RACCASH awarded, how much is still
  unredeemed on closed records, and how much is pending across everyone's active games.
- **Backup** — export all data as JSON (full backup) or a CSV of winners (including
  redemption status, plus a row for anyone still mid-game with an unredeemed running total)
  for record-keeping, and re-import a JSON backup at any time. Import checks the file's shape
  before touching your data, and runs the same migration as a normal app load, so restoring
  an older backup doesn't reintroduce the old weekly-reset behavior.
- **Analytics** — a manager-facing dashboard, entirely computed from existing data (no extra
  tracking needed): total customers/active games/completed games, total RACCASH awarded vs.
  redeemed vs. still outstanding, a win-tier breakdown with a win-rate percentage, a
  redemptions-per-week bar chart for the last 6 weeks, average weeks-to-redeem, how many
  customers have drawn this week, and a most-engaged-customers leaderboard by lifetime balls
  drawn. `weeksPlayed` is stamped onto a game's record the moment it closes (in
  `closeOutGame`) specifically so this stat survives archiving — the live `sessionLog` itself
  isn't kept once a game is closed. The tab also lists **Customers to Re-Engage** — anyone
  who's played before but gone quiet for more than 2 weeks (`REENGAGEMENT_THRESHOLD_MS` in
  `app.js`), sorted most-overdue first, so staff know who's worth a text. This app doesn't
  send anything itself or store any contact info — it's just a name and how long it's been,
  for whatever outside channel staff already use to reach customers.

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

- A game can only start once all 24 of a customer's card numbers are entered (the center
  free space doesn't need entry).
- Numbers must fall in the standard ranges: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75.
- Each customer's card and draw history live on `customer.activeGame` and persist
  indefinitely across weekly visits — only one customer can be actively pulled up on the
  Play Round screen at a time (matching the single physical ball machine), but that's just
  about who's being served right now, not a limit on how many customers can have a game in
  progress at once. Redeeming or closing out a game archives it to `history` and clears the
  way for a new one.
- Older data (from before this persistent-card model shipped) migrates automatically the
  first time the app loads: any customer with a leftover unredeemed round becomes their new
  in-progress game, carrying over the same card and balls already drawn. This is safe to run
  more than once and won't duplicate anything.
- "Played this week" is a rolling 7 days from a customer's last drawn ball, not a calendar
  week — adjust in `app.js` (`WEEK_MS`) if you'd rather it reset on a fixed day. The same
  window groups draws into "weeks played" for the Roster's progress display.
- The certificate's bill graphics (`assets/rac-cash-25/50/75/100/200.png`) are cropped
  directly from your approved RACCASH print templates — not redrawn. Every possible round
  total ($25, $75, $100, $200) has an exact matching bill, so the certificate always shows a
  single real bill (no combining graphics together). If a bill image ever fails to load
  (renamed/missing file), the certificate shows a clear red warning in its place instead of
  a silent broken-image icon.
- The certificate is scaled to fit one US Letter page at normal print margins — its natural
  (unscaled) height runs taller than a printable page, so `@media print` applies a fixed
  0.75x scale just for printing; the on-screen layout is unaffected.
- The printable card's 4x6 landscape page size is set via a named CSS page (`@page
  card-page`), which is well supported in Chrome/Edge. If you print from a browser that
  ignores it, just set the paper size to 4x6 (or "Index Card") manually in the print dialog.
- The card's back lists the real, current prize tiers ($25/$75/$100) rather than a flat
  amount, and its store address/phone/number are hardcoded in `app.js` (`STORE_ADDRESS`,
  `STORE_PHONE`, `STORE_NUMBER`) — update those if the store location changes. `STORE_NUMBER`
  is currently set to `"650"`, inferred from the staff login username — confirm this is
  correct for your store.
- Card ID on the printed card is stable for the life of a game once one's started (keyed off
  the game's own id, e.g. `RB-A1B2C3D4`), so reprinting the same card in week 3 shows the
  same ID as the week-1 printout. Before a game has started, it falls back to a date-stamped
  ID (customer's internal ID + issue date). Either way, it's for matching a physical card
  back to its digital record, not a security feature.
- The RAC logo (`assets/rac-logo.png`) is the official artwork, sourced from Wikimedia
  Commons with a natively transparent background — no editing needed. Used on the printed
  card's front and the certificate voucher.
