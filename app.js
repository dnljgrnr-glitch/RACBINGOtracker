(() => {
  "use strict";

  const STORAGE_KEY = "racbingo_data_v3";
  const COLUMNS = ["B", "I", "N", "G", "O"];
  const COLUMN_RANGES = { B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75] };
  const FREE = "FREE";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  // How long since a customer's last drawn ball before the Analytics tab
  // flags them as worth a re-engagement text — deliberately looser than
  // "played this week" (1 week idle is just normal pacing, not a lost
  // customer). Adjust here if 3 weeks turns out to be the wrong cutoff.
  const REENGAGEMENT_THRESHOLD_MS = 3 * WEEK_MS;

  const PRIZES = { LINE: 25, CORNERS: 75, BLACKOUT: 100 };
  const TIER_KEYS = ["LINE", "CORNERS", "BLACKOUT"];

  // ---------- Authentication (local-only lock screen) ----------
  // This is a client-side gate for one shared store computer, not real
  // security — there's no backend, so these credentials live in this file
  // and anyone with browser dev tools could read or bypass them. It's meant
  // to keep casual customers from poking at the register computer, not to
  // withstand a determined attacker. Revisit this properly once there's a
  // real backend with accounts.
  const AUTH_USERNAME = "650Goats";
  const AUTH_PASSWORD = "Goat650$";
  const AUTH_SESSION_KEY = "racbingo_authed";

  function isLoggedIn() {
    return sessionStorage.getItem(AUTH_SESSION_KEY) === "true";
  }

  function showApp() {
    document.getElementById("loginScreen").hidden = true;
    document.getElementById("appRoot").hidden = false;
  }

  function showLoginScreen() {
    document.getElementById("appRoot").hidden = true;
    document.getElementById("loginScreen").hidden = false;
    document.getElementById("loginUsername").focus();
  }

  function tierFor(pattern) {
    if (pattern === "Four Corners") return { prize: PRIZES.CORNERS, label: "Four Corners" };
    if (pattern === "Blackout") return { prize: PRIZES.BLACKOUT, label: "Full BINGO" };
    return { prize: PRIZES.LINE, label: pattern };
  }

  function tierKeyFor(pattern) {
    if (pattern === "Four Corners") return "CORNERS";
    if (pattern === "Blackout") return "BLACKOUT";
    return "LINE"; // any row, column, or diagonal
  }

  // Each prize tier (Line / Corners / Blackout) can only be won once per
  // round — completing a second line after the first doesn't add another
  // $25. Existing win records are reused as-is (preserving their original
  // timestamp) whenever their tier is still satisfied by any current
  // pattern, even if the originally-recorded specific pattern changed.
  // Redemption is tracked per round, not per win (see round.redeemed).
  function computeTierWins(patterns, existingWins) {
    const wins = [];
    TIER_KEYS.forEach(key => {
      const qualifyingPattern = patterns.find(p => tierKeyFor(p) === key);
      if (!qualifyingPattern) return;
      const existing = existingWins.find(w => tierKeyFor(w.pattern) === key);
      if (existing) {
        wins.push(existing);
      } else {
        const tier = tierFor(qualifyingPattern);
        wins.push({ pattern: qualifyingPattern, prize: tier.prize, label: tier.label, timestamp: Date.now() });
      }
    });
    return wins;
  }

  function roundTotal(wins) {
    return wins.reduce((sum, w) => sum + w.prize, 0);
  }

  // Certificate content is one document per round reflecting whatever the
  // customer has accumulated so far (they can redeem at any point). Reaching
  // Blackout always implies Line + Corners were also won (a fully-covered
  // card necessarily contains complete lines and all four corners), so the
  // $200 "grand" case ($25 + $75 + $100) is the only way all three ever
  // appear together.
  // Real RACCASH bill graphics only exist for $25/$50/$75/$100/$200 (cropped
  // from the approved templates — see assets/rac-cash-*.png). Every possible
  // round total ($25 Line, $75 Corners, $100 Line+Corners, $200 grand) has
  // an exact matching bill, so a single real bill is always shown — the
  // multi-bill fallback below only exists as a safety net in case the prize
  // amounts ever change again and stop lining up with real denominations.
  const BILL_DENOMINATIONS = [25, 50, 75, 100, 200];

  function billsFor(wins, total) {
    if (BILL_DENOMINATIONS.includes(total)) return [total];
    return wins.map(w => w.prize).filter(p => BILL_DENOMINATIONS.includes(p));
  }

  function certificateInfo(wins) {
    const total = roundTotal(wins);
    const hasBlackout = wins.some(w => tierKeyFor(w.pattern) === "BLACKOUT");
    const hasCorners = wins.some(w => tierKeyFor(w.pattern) === "CORNERS");
    const lineWin = wins.find(w => tierKeyFor(w.pattern) === "LINE");
    let headline = "RACBINGO Win!";
    if (hasBlackout) headline = "GRAND CERTIFICATE — FULL BINGO!";
    else if (hasCorners) headline = "Four Corners Win!";
    else if (lineWin) headline = `${lineWin.label} Win!`;
    return { total, isGrand: hasBlackout, headline, breakdown: wins.slice(), bills: billsFor(wins, total) };
  }

  // ---------- Persistence ----------

  function defaultData() {
    return { customers: [], history: [], activeCustomerId: null };
  }

  // Cards used to be reset every week (fresh draws each round). The real
  // rule: each customer plays on ONE ongoing card that accumulates balls
  // across as many weekly visits as it takes, until they redeem or staff
  // closes it out — only then does it become a closed History record. This
  // promotes any customer's leftover unredeemed round (from before this
  // change shipped) into their new ongoing activeGame, and folds a stale
  // pre-upgrade currentRound the same way, so nobody's in-progress card or
  // pending win gets lost when this update lands. Idempotent — safe to run
  // on every load.
  function migrateToPersistentGames(parsed) {
    let changed = false;
    if (parsed.activeCustomerId === undefined) { parsed.activeCustomerId = null; changed = true; }
    parsed.customers.forEach(c => {
      if (c.activeGame === undefined) { c.activeGame = null; changed = true; }
    });

    const pendingByCustomer = new Map();
    parsed.history.forEach(round => {
      if (round.wins.length > 0 && !round.redeemed) {
        const existing = pendingByCustomer.get(round.customerId);
        if (!existing || round.startedAt > existing.startedAt) pendingByCustomer.set(round.customerId, round);
      }
    });
    pendingByCustomer.forEach((round, customerId) => {
      const customer = parsed.customers.find(c => c.id === customerId);
      if (!customer || customer.activeGame) return;
      customer.activeGame = {
        id: round.id,
        draws: round.draws.slice(),
        wins: round.wins.slice(),
        startedAt: round.startedAt,
        sessionLog: [{ startedAt: round.startedAt, balls: round.draws.slice() }]
      };
      if (round.card && JSON.stringify(round.card) !== JSON.stringify(customer.card)) {
        console.warn(`Migration: ${customer.name}'s live card didn't match their pending win's card — restoring the card tied to the recorded wins.`);
        customer.card = JSON.parse(JSON.stringify(round.card));
      }
      parsed.history = parsed.history.filter(r => r !== round);
      changed = true;
    });

    if (parsed.currentRound && parsed.currentRound.customerId) {
      const customer = parsed.customers.find(c => c.id === parsed.currentRound.customerId);
      if (customer) {
        if (!customer.activeGame) {
          customer.activeGame = {
            id: uid(),
            draws: parsed.currentRound.draws.slice(),
            wins: parsed.currentRound.wins.slice(),
            startedAt: parsed.currentRound.startedAt,
            sessionLog: [{ startedAt: parsed.currentRound.startedAt, balls: parsed.currentRound.draws.slice() }]
          };
        } else {
          // Rare dual case: an unredeemed history round AND a stale
          // in-progress round for the same customer. Append rather than
          // merge/dedupe — a duplicate ball number here is harmless (the
          // Set-based hit-matrix logic tolerates it), just don't lose data.
          const newBalls = parsed.currentRound.draws.slice();
          customer.activeGame.draws = customer.activeGame.draws.concat(newBalls);
          customer.activeGame.sessionLog.push({ startedAt: parsed.currentRound.startedAt, balls: newBalls });
        }
        const matrix = hitMatrix(customer, new Set(customer.activeGame.draws));
        const patterns = achievedPatterns(matrix);
        // Deliberately not routed through the win-popup queue — nothing
        // should fire fireworks retroactively for a pre-upgrade round.
        customer.activeGame.wins = computeTierWins(patterns, customer.activeGame.wins);
      }
      changed = true;
    }
    if (parsed.currentRound !== undefined) { delete parsed.currentRound; changed = true; }
    return changed;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed.customers || !parsed.history) return defaultData();
      if (parsed.currentRound === undefined) parsed.currentRound = null;
      // Migrate older data where redemption was tracked per win instead of
      // per round (a round is redeemed only if every one of its wins was).
      parsed.history.forEach(round => {
        if (round.redeemed === undefined) {
          round.redeemed = round.wins.length > 0 && round.wins.every(w => w.redeemed);
          round.redeemedAt = round.wins.reduce((latest, w) => {
            return w.redeemedAt && (!latest || w.redeemedAt > latest) ? w.redeemedAt : latest;
          }, null);
        }
      });
      // Normalizes any Four Corners win to the current PRIZES.CORNERS value —
      // covers the brief period this was mis-set to $50 instead of $75, and
      // self-corrects in either direction if the amount is ever changed again.
      const fixCornersPrize = wins => {
        (wins || []).forEach(w => {
          if (w.pattern === "Four Corners" && w.prize !== PRIZES.CORNERS) w.prize = PRIZES.CORNERS;
        });
      };
      parsed.history.forEach(round => fixCornersPrize(round.wins));
      if (parsed.currentRound) fixCornersPrize(parsed.currentRound.wins);
      const changed = migrateToPersistentGames(parsed);
      if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    } catch (e) {
      console.error("Failed to load RACBINGO data, starting fresh.", e);
      return defaultData();
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadData();
  const expandedCustomerIds = new Set();
  const editingRoundIds = new Set();

  // ---------- Helpers ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emptyCard() {
    const card = {};
    COLUMNS.forEach(col => { card[col] = [null, null, null, null, null]; });
    card.N[2] = FREE;
    return card;
  }

  function randomUniqueNumbers(min, max, count) {
    const pool = [];
    for (let n = min; n <= max; n++) pool.push(n);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count).sort((a, b) => a - b);
  }

  // Standard 75-ball bingo numbering: 5 unique numbers per column drawn from
  // that column's range (B 1-15, I 16-30, N 31-45, G 46-60, O 61-75), with the
  // N column's center cell left FREE (only 4 numbers needed there).
  function generateRandomCard() {
    const card = {};
    COLUMNS.forEach(col => {
      const [min, max] = COLUMN_RANGES[col];
      if (col === "N") {
        const nums = randomUniqueNumbers(min, max, 4);
        card.N = [nums[0], nums[1], FREE, nums[2], nums[3]];
      } else {
        card[col] = randomUniqueNumbers(min, max, 5);
      }
    });
    return card;
  }

  function findCustomer(id) {
    return state.customers.find(c => c.id === id);
  }

  function hitMatrix(customer, drawn) {
    const matrix = [];
    for (let row = 0; row < 5; row++) {
      const rowArr = [];
      for (let c = 0; c < 5; c++) {
        const val = customer.card[COLUMNS[c]][row];
        rowArr.push(val === FREE || (val !== null && drawn.has(val)));
      }
      matrix.push(rowArr);
    }
    return matrix;
  }

  function achievedPatterns(matrix) {
    const patterns = [];
    for (let r = 0; r < 5; r++) {
      if (matrix[r].every(Boolean)) patterns.push(`Row ${r + 1}`);
    }
    for (let c = 0; c < 5; c++) {
      if (matrix.every(row => row[c])) patterns.push(`Column ${COLUMNS[c]}`);
    }
    if ([0, 1, 2, 3, 4].every(i => matrix[i][i])) patterns.push("Diagonal ↘");
    if ([0, 1, 2, 3, 4].every(i => matrix[i][4 - i])) patterns.push("Diagonal ↙");
    if (matrix[0][0] && matrix[0][4] && matrix[4][0] && matrix[4][4]) patterns.push("Four Corners");
    if (matrix.every(row => row.every(Boolean))) patterns.push("Blackout");
    return patterns;
  }

  function cardComplete(customer) {
    return COLUMNS.every(col => customer.card[col].every(v => v !== null));
  }

  function cardFilledCount(customer) {
    let n = 0;
    COLUMNS.forEach(col => customer.card[col].forEach(v => { if (v !== null && v !== FREE) n++; }));
    return n;
  }

  // Real bingo cards never repeat a number anywhere on the card — catches a
  // likely data-entry mistake instead of silently accepting it.
  function cardHasDuplicate(customer, num, excludeCol, excludeRow) {
    return COLUMNS.some(col => customer.card[col].some((v, r) => {
      if (col === excludeCol && r === excludeRow) return false;
      return v === num;
    }));
  }

  function playedThisWeek(customer) {
    return !!customer.lastPlayedAt && (Date.now() - customer.lastPlayedAt) < WEEK_MS;
  }

  // How many of the 24 real (non-FREE) cells are currently hit, for a
  // Roster progress-toward-Blackout indicator.
  function hitCountFor(customer, drawn) {
    return hitMatrix(customer, drawn).flat().filter(Boolean).length - 1;
  }

  // Legacy leftover: rounds this customer won something on but hasn't
  // redeemed yet, still sitting in History. Ordinarily empty going forward —
  // active pending wins now live on customer.activeGame — but a customer
  // could end up with more than one of these via the persistent-game
  // migration's rare dual-pending edge case, so this stays live rather than
  // being deleted.
  function pendingRewardsFor(customerId) {
    return state.history.filter(r => r.customerId === customerId && r.wins.length > 0 && !r.redeemed);
  }

  function roundsFor(customerId) {
    return state.history.filter(r => r.customerId === customerId);
  }

  // The draws to validate a customer's card against: their ongoing game if
  // they have one, otherwise their most recently completed game.
  function relevantDrawsFor(customer) {
    if (customer.activeGame) return new Set(customer.activeGame.draws);
    const rounds = roundsFor(customer.id);
    return rounds.length ? new Set(rounds[0].draws) : new Set();
  }

  // ---------- Customer CRUD ----------

  function addCustomer(name) {
    const customer = { id: uid(), name: name.trim(), card: emptyCard(), lastPlayedAt: null, activeGame: null };
    state.customers.push(customer);
    saveData();
    return customer;
  }

  function removeCustomer(id) {
    state.customers = state.customers.filter(c => c.id !== id);
    if (state.activeCustomerId === id) state.activeCustomerId = null;
    saveData();
  }

  function renameCustomer(id, name) {
    const c = findCustomer(id);
    if (c) { c.name = name.trim(); saveData(); }
  }

  function setCardCell(customerId, col, row, value) {
    const c = findCustomer(customerId);
    if (!c) return;
    c.card[col][row] = value;
    saveData();
  }

  // ---------- Game actions ----------
  // A customer plays on one ongoing card that accumulates balls across as
  // many weekly visits as it takes (see customer.activeGame), until they
  // redeem or staff closes it out. state.activeCustomerId just tracks who's
  // currently pulled up in the Play Round tab — matching the one physical
  // ball machine — it doesn't own any game data itself.

  function startNewGame(customerId) {
    const customer = findCustomer(customerId);
    if (!customer) return;
    customer.activeGame = { id: uid(), draws: [], wins: [], startedAt: Date.now(), sessionLog: [] };
    state.activeCustomerId = customerId;
    saveData();
  }

  // Only valid before any ball's been drawn this visit — once a ball is
  // drawn it's saved permanently to the customer's ongoing game, so a full
  // discard isn't safe anymore. A mistake caught after that gets corrected
  // by removing the specific wrong balls (see removeDrawAtFor).
  function cancelEmptyGame(customerId) {
    const customer = findCustomer(customerId);
    if (!customer || !customer.activeGame || customer.activeGame.draws.length > 0) return;
    customer.activeGame = null;
    state.activeCustomerId = null;
    saveData();
  }

  // Just steps away from this customer for now — nothing to discard or
  // archive, every draw is already saved immediately.
  function finishVisit() {
    state.activeCustomerId = null;
    saveData();
  }

  // Groups draws into weekly sessions for the Roster's "weeks played" /
  // "already drawn this week" display — reuses the same rolling WEEK_MS
  // window as playedThisWeek. Opens a new session when the last one is
  // stale or absent, otherwise appends to it.
  function currentSessionFor(game) {
    const last = game.sessionLog[game.sessionLog.length - 1];
    if (last && (Date.now() - last.startedAt) < WEEK_MS) return last;
    const session = { startedAt: Date.now(), balls: [] };
    game.sessionLog.push(session);
    return session;
  }

  function drawBallForCustomer(customerId, num) {
    const errEl = document.getElementById("drawError");
    errEl.hidden = true;
    errEl.classList.remove("is-info");

    const customer = findCustomer(customerId);
    if (!customer || !customer.activeGame) return false;
    if (!Number.isInteger(num) || num < 1 || num > 75) {
      errEl.textContent = "Enter a number between 1 and 75.";
      errEl.hidden = false;
      return false;
    }
    if (customer.activeGame.draws.includes(num)) {
      errEl.textContent = `🔁 ${num} was already pulled for this card — reroll, draw again.`;
      errEl.classList.add("is-info");
      errEl.hidden = false;
      return false;
    }

    customer.activeGame.draws.push(num);
    currentSessionFor(customer.activeGame).balls.push(num);
    customer.lastPlayedAt = Date.now();
    checkForNewWinsFor(customer);
    saveData();
    return true;
  }

  // Removes one specific drawn ball (not just the most recent), for
  // correcting a misread/mistyped number without losing the rest of the
  // game. Also drops it from whichever weekly session logged it, and
  // rechecks win patterns against the remaining draws.
  function removeDrawAtFor(customerId, index) {
    const customer = findCustomer(customerId);
    if (!customer || !customer.activeGame) return;
    const game = customer.activeGame;
    if (index < 0 || index >= game.draws.length) return;
    const [removed] = game.draws.splice(index, 1);
    for (let i = game.sessionLog.length - 1; i >= 0; i--) {
      const idx = game.sessionLog[i].balls.lastIndexOf(removed);
      if (idx !== -1) {
        game.sessionLog[i].balls.splice(idx, 1);
        if (game.sessionLog[i].balls.length === 0) game.sessionLog.splice(i, 1);
        break;
      }
    }
    const matrix = hitMatrix(customer, new Set(game.draws));
    const patterns = achievedPatterns(matrix);
    game.wins = computeTierWins(patterns, game.wins);
    saveData();
  }

  function undoLastDrawFor(customerId) {
    const customer = findCustomer(customerId);
    if (!customer || !customer.activeGame || customer.activeGame.draws.length === 0) return;
    removeDrawAtFor(customerId, customer.activeGame.draws.length - 1);
  }

  const pendingWinPopups = [];

  function checkForNewWinsFor(customer) {
    if (!customer.activeGame || !cardComplete(customer)) return;
    const matrix = hitMatrix(customer, new Set(customer.activeGame.draws));
    const patterns = achievedPatterns(matrix);
    const newWins = computeTierWins(patterns, customer.activeGame.wins);
    newWins.forEach(w => {
      if (!customer.activeGame.wins.includes(w)) {
        pendingWinPopups.push({ customerId: customer.id, customerName: customer.name, ...w });
      }
    });
    customer.activeGame.wins = newWins;
  }

  // Ends the customer's current game — whether they're actually redeeming a
  // win or just resetting with nothing won (the button wording adapts, the
  // action is the same either way). Archives whatever accumulated to
  // History as a closed, redeemed record, and clears the way for a new
  // card. Reuses the game's own id as the archived round's id, so a
  // certificate printed mid-game and reprinted afterward shows the same
  // Certificate ID.
  function closeOutGame(customerId) {
    const customer = findCustomer(customerId);
    if (!customer || !customer.activeGame) return;
    const game = customer.activeGame;
    state.history.unshift({
      id: game.id,
      customerId: customer.id,
      customerName: customer.name,
      startedAt: game.startedAt,
      endedAt: Date.now(),
      draws: game.draws.slice(),
      card: JSON.parse(JSON.stringify(customer.card)),
      wins: game.wins.slice(),
      // Kept for the Analytics tab's "average weeks to redeem" stat — the
      // live sessionLog itself doesn't survive archiving, just its count.
      weeksPlayed: game.sessionLog.length,
      redeemed: true,
      redeemedAt: Date.now()
    });
    customer.activeGame = null;
    customer.card = emptyCard();
    state.activeCustomerId = customerId;
    saveData();
    switchTab("game");
    render();
  }

  // Legacy path: redeems one of the rare leftover pending rounds that can
  // exist in History after the persistent-game migration's dual-pending
  // edge case (see migrateToPersistentGames). Ordinary redemption goes
  // through closeOutGame instead.
  function confirmRedemption(roundId) {
    const round = state.history.find(r => r.id === roundId);
    if (!round) return;
    round.redeemed = true;
    round.redeemedAt = Date.now();
    saveData();
    state.activeCustomerId = round.customerId;
    switchTab("game");
    render();
  }

  // ---------- Editing past rounds (mistake corrections) ----------

  // Rebuilds a round's wins from scratch against its card + current draws,
  // one prize per tier (see computeTierWins). Editing a round's balls does
  // not change its redeemed status, even if the total changes as a result —
  // that's left to staff discretion.
  function recomputeRoundWins(round) {
    if (!round.card) { round.wins = []; return; }
    const drawn = new Set(round.draws);
    const matrix = hitMatrix({ card: round.card }, drawn);
    const patterns = achievedPatterns(matrix);
    round.wins = computeTierWins(patterns, round.wins);
  }

  function reassignRoundCustomer(roundId, newCustomerId) {
    const round = state.history.find(r => r.id === roundId);
    const newCustomer = findCustomer(newCustomerId);
    if (!round || !newCustomer) return;
    round.customerId = newCustomer.id;
    round.customerName = newCustomer.name;
    round.card = JSON.parse(JSON.stringify(newCustomer.card));
    recomputeRoundWins(round);
    saveData();
    render();
  }

  function addDrawToRound(roundId, num) {
    const round = state.history.find(r => r.id === roundId);
    const errEl = document.getElementById(`roundDrawError-${roundId}`);
    if (!round) return;
    if (errEl) errEl.hidden = true;
    if (!Number.isInteger(num) || num < 1 || num > 75) {
      if (errEl) { errEl.textContent = "Enter a number between 1 and 75."; errEl.hidden = false; }
      return;
    }
    if (round.draws.includes(num)) {
      if (errEl) { errEl.textContent = `${num} is already in this round.`; errEl.hidden = false; }
      return;
    }
    round.draws.push(num);
    recomputeRoundWins(round);
    saveData();
    render();
  }

  function removeDrawFromRound(roundId, index) {
    const round = state.history.find(r => r.id === roundId);
    if (!round) return;
    round.draws.splice(index, 1);
    recomputeRoundWins(round);
    saveData();
    render();
  }

  function deleteRound(roundId) {
    state.history = state.history.filter(r => r.id !== roundId);
    editingRoundIds.delete(roundId);
    saveData();
    render();
  }

  // ---------- Tabs ----------

  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${name}`));
  }

  // Jumps to History and scrolls/highlights one specific round — used by the
  // roster's clickable pending-reward list so staff land directly on the
  // right certificate/redeem controls instead of hunting through History.
  function goToRoundInHistory(roundId) {
    switchTab("history");
    render();
    const el = document.getElementById(`history-round-${roundId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("history-item-highlight");
    setTimeout(() => el.classList.remove("history-item-highlight"), 2500);
  }

  // ---------- Rendering ----------

  function render() {
    renderPlayRoundTab();
    renderRoster();
    renderHistory();
    renderAnalyticsTab();
    processWinPopupQueue();
  }

  function renderPlayRoundTab() {
    const picker = document.getElementById("customerPicker");
    const activePlayersPanel = document.getElementById("activePlayersPanel");
    const panel = document.getElementById("customerPanel");
    const active = document.getElementById("activeRound");
    const customer = state.activeCustomerId ? findCustomer(state.activeCustomerId) : null;

    // Only the live-game view (below) ever needs the cage loop running —
    // stop it here by default so it doesn't keep spinning in the
    // background on every other screen, and let renderLiveGame restart it
    // if the customer is actually mid-game in digital mode.
    stopCageAnimation();

    if (!customer) {
      state.activeCustomerId = null;
      picker.hidden = false;
      activePlayersPanel.hidden = false;
      renderActivePlayersList();
      panel.hidden = true;
      active.hidden = true;
      return;
    }

    activePlayersPanel.hidden = true;

    if (customer.activeGame) {
      picker.hidden = true;
      panel.hidden = true;
      active.hidden = false;
      renderLiveGame(customer);
      return;
    }

    picker.hidden = true;
    panel.hidden = false;
    active.hidden = true;
    renderCustomerPanel();
  }

  // Quick-access list of everyone currently mid-card, front and center on
  // the Play Round home screen — staff shouldn't have to type a name just
  // to get back to someone who's already playing.
  function renderActivePlayersList() {
    const list = document.getElementById("activePlayersList");
    const empty = document.getElementById("noActivePlayers");
    const players = state.customers.filter(c => c.activeGame);
    players.sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));

    list.innerHTML = "";
    empty.hidden = players.length !== 0;

    players.forEach(customer => {
      const game = customer.activeGame;
      const hits = hitCountFor(customer, new Set(game.draws));
      const done = playedThisWeek(customer);
      const winTotal = roundTotal(game.wins);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "active-player-row";
      const nameEl = document.createElement("span");
      nameEl.className = "active-player-name";
      nameEl.textContent = customer.name;
      if (disambiguatorFor(customer)) {
        nameEl.textContent += ` #${customer.id.slice(-4).toUpperCase()}`;
      }
      const metaEl = document.createElement("span");
      metaEl.className = "active-player-meta";
      metaEl.textContent = `Week ${game.sessionLog.length} · ${hits}/24 toward Blackout · ${done ? "drawn this week ✓" : "needs this week's balls"}`;
      if (winTotal > 0) {
        const pendingSpan = document.createElement("span");
        pendingSpan.className = "has-pending";
        pendingSpan.textContent = ` · $${winTotal} pending`;
        metaEl.appendChild(pendingSpan);
      }
      row.appendChild(nameEl);
      row.appendChild(metaEl);
      row.addEventListener("click", () => {
        state.activeCustomerId = customer.id;
        saveData();
        render();
      });
      list.appendChild(row);
    });
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  // A customer's most recent CLOSED (redeemed/reset) game, shown only on the
  // card-setup screen (i.e. while they have no ongoing activeGame) so staff
  // aren't blind to their history when starting a new one — otherwise it's
  // only visible via Roster > View Card > Progression, which staff coming
  // back to start someone's next game would never think to check first.
  function renderLastCompletedGameSummary(customer) {
    const wrap = document.getElementById("lastRoundSummary");
    const rounds = roundsFor(customer.id);
    if (rounds.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const last = rounds[0];

    document.getElementById("lastRoundDate").textContent = formatDate(last.startedAt);
    document.getElementById("lastRoundWinText").textContent = last.wins.length
      ? `Won ${last.wins.map(w => w.label).join(", ")} — $${roundTotal(last.wins)}${last.redeemed ? " (redeemed)" : " (not yet redeemed)"}`
      : "No win that game.";

    const ballsWrap = document.getElementById("lastRoundBalls");
    ballsWrap.innerHTML = "";
    if (last.draws.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ball-chip empty-slot";
      empty.textContent = "–";
      ballsWrap.appendChild(empty);
    } else {
      last.draws.forEach(num => {
        const chip = document.createElement("div");
        chip.className = "ball-chip";
        chip.textContent = num;
        ballsWrap.appendChild(chip);
      });
    }

    const grid = document.getElementById("lastRoundGrid");
    if (last.card) {
      renderReadOnlyGrid(grid, { card: last.card }, new Set(last.draws));
    } else {
      grid.innerHTML = "";
    }
  }

  function renderCustomerPanel() {
    const customer = findCustomer(state.activeCustomerId);
    document.getElementById("selectedCustomerName").textContent = customer.name;

    const alertEl = document.getElementById("weeklyAlert");
    if (playedThisWeek(customer)) {
      alertEl.textContent = `⚠️ ${customer.name} already played this week — last played ${formatDate(customer.lastPlayedAt)}.`;
      alertEl.hidden = false;
    } else {
      alertEl.hidden = true;
    }

    renderLastCompletedGameSummary(customer);
    renderCardEntryGrid(customer);
    const filled = cardFilledCount(customer);
    const statusEl = document.getElementById("cardEntryStatus");
    const complete = filled === 24;
    statusEl.textContent = complete ? "Card ready ✓" : `${filled}/24 numbers entered`;
    statusEl.classList.toggle("complete", complete);
    document.getElementById("startRoundBtn").disabled = !complete;
    document.getElementById("printCardBtn").disabled = !complete;
  }

  function renderCardEntryGrid(customer) {
    const grid = document.getElementById("cardEntryGrid");
    grid.innerHTML = "";
    COLUMNS.forEach(col => {
      const h = document.createElement("div");
      h.className = "cell-header";
      h.textContent = col;
      grid.appendChild(h);
    });
    for (let row = 0; row < 5; row++) {
      COLUMNS.forEach(col => {
        const value = customer.card[col][row];
        if (value === FREE) {
          const cell = document.createElement("div");
          cell.className = "cell-free";
          cell.textContent = "FREE";
          grid.appendChild(cell);
          return;
        }
        const input = document.createElement("input");
        input.type = "number";
        input.min = COLUMN_RANGES[col][0];
        input.max = COLUMN_RANGES[col][1];
        input.value = value === null ? "" : value;
        input.placeholder = `${COLUMN_RANGES[col][0]}-${COLUMN_RANGES[col][1]}`;
        input.addEventListener("change", () => {
          const [min, max] = COLUMN_RANGES[col];
          const n = parseInt(input.value, 10);
          if (input.value === "") {
            setCardCell(customer.id, col, row, null);
            render();
            return;
          }
          if (!Number.isInteger(n) || n < min || n > max) {
            showAlert(`${col} column must be ${min}-${max}.`);
            input.value = value === null ? "" : value;
            return;
          }
          if (cardHasDuplicate(customer, n, col, row)) {
            showAlert(`${n} is already entered elsewhere on this card — each number can only appear once.`);
            input.value = value === null ? "" : value;
            return;
          }
          setCardCell(customer.id, col, row, n);
          render();
        });
        grid.appendChild(input);
      });
    }
  }

  function renderLiveGame(customer) {
    const game = customer.activeGame;
    if (!game) return;

    document.getElementById("activeCustomerName").textContent = customer.name;
    const count = game.draws.length;
    document.getElementById("drawProgress").textContent =
      count === 1 ? "1 ball drawn total" : `${count} balls drawn total`;

    const weeksPlayed = game.sessionLog.length;
    const thisWeekDone = playedThisWeek(customer);
    document.getElementById("weekStatus").textContent =
      `Week ${weeksPlayed}${thisWeekDone ? " · already drawn this week" : " · ready to draw this week's balls"}`;

    const chipsWrap = document.getElementById("drawnBalls");
    chipsWrap.innerHTML = "";
    if (count === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "ball-chip empty-slot";
      placeholder.textContent = "–";
      chipsWrap.appendChild(placeholder);
    } else {
      game.draws.forEach((num, i) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ball-chip removable";
        chip.title = "Click to remove this ball";
        chip.innerHTML = `${num}<span class="ball-chip-x">&times;</span>`;
        chip.addEventListener("click", () => {
          removeDrawAtFor(customer.id, i);
          render();
        });
        chipsWrap.appendChild(chip);
      });
    }

    // 75 is the natural ceiling (every number already called) — the
    // duplicate-draw check makes this practically self-limiting anyway.
    const gameFull = count >= 75;
    const drawInput = document.getElementById("drawInput");
    drawInput.disabled = gameFull;
    document.querySelector("#drawForm button[type=submit]").disabled = gameFull;
    const modalOpen = !document.getElementById("winModalOverlay").hidden ||
      !document.getElementById("confirmModalOverlay").hidden;

    document.getElementById("drawForm").hidden = drawMode !== "manual";
    document.getElementById("digitalCagePanel").hidden = drawMode !== "digital";

    if (drawMode === "manual") {
      // Staff should be able to type the next ball immediately without
      // clicking into the box first — refocus it on every render of this
      // screen, unless a modal is up front (win celebration or a confirm).
      if (!gameFull && !modalOpen) drawInput.focus();
    } else {
      const drawnSet = new Set(game.draws);
      if (cageCustomerId !== customer.id) {
        // New customer (or first switch into digital mode this visit) —
        // full randomized init.
        const remaining = [];
        for (let n = 1; n <= 75; n++) if (!drawnSet.has(n)) remaining.push(n);
        initCageBalls(remaining);
        cageCustomerId = customer.id;
        document.getElementById("ballRevealSlot").innerHTML = '<span class="ball-reveal-placeholder">?</span>';
      } else {
        // Same customer, something else changed (a ball drawn some other
        // way, a chip removed) — just drop whichever balls are no longer
        // undrawn, don't reset everyone else's bounce mid-flight.
        cageBalls = cageBalls.filter(b => !drawnSet.has(b.num));
        // A ball removed via the chip list needs to come back into play.
        const cagedNums = new Set(cageBalls.map(b => b.num));
        for (let n = 1; n <= 75; n++) {
          if (!drawnSet.has(n) && !cagedNums.has(n)) {
            const canvas = document.getElementById("ballCageCanvas");
            const cx = canvas.width / 2, cy = canvas.height / 2;
            const speed = randomCageSpeed();
            const dir = Math.random() * Math.PI * 2;
            cageBalls.push({ num: n, x: cx, y: cy, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, radius: 11, color: BALL_COLORS[columnForNumber(n)] });
          }
        }
      }
      document.getElementById("cageRemainingCount").textContent = cageBalls.length;
      document.getElementById("digitalDrawBtn").disabled = gameFull || cageBalls.length === 0 || cageDrawInFlight;
      if (!cageAnimId && !modalOpen) stepCage();
    }

    const winsWrap = document.getElementById("roundWinsWrap");
    const winsList = document.getElementById("roundWinsList");
    winsList.innerHTML = "";
    winsWrap.hidden = game.wins.length === 0;
    game.wins.forEach(w => {
      const row = document.createElement("div");
      row.className = "round-win-row";
      row.textContent = `🏆 ${w.label} — $${w.prize} RACCASH`;
      winsList.appendChild(row);
    });

    // Cancel only discards a truly empty visit — once a ball's drawn it's
    // permanent, so per-ball removal (above) is the only way back.
    document.getElementById("cancelRoundBtn").disabled = count > 0;

    const closeOutBtn = document.getElementById("closeOutGameBtn");
    closeOutBtn.textContent = game.wins.length > 0
      ? `Redeem $${roundTotal(game.wins)} & Start New Card`
      : "Close Out & Start New Card";

    renderReadOnlyGrid(document.getElementById("activeRoundGrid"), customer, new Set(game.draws));
  }

  // ---------- Customer search ----------

  // With hundreds of customers, two people can share a name — this gives
  // staff something to tell them apart by (when it never was played this
  // week, otherwise the existing badge already does the job) instead of
  // guessing which "John Smith" they meant.
  function disambiguatorFor(customer) {
    const dupes = state.customers.filter(c => c.name.toLowerCase() === customer.name.toLowerCase());
    if (dupes.length < 2) return null;
    return customer.lastPlayedAt
      ? `Last played ${formatDate(customer.lastPlayedAt)}`
      : `Never played · #${customer.id.slice(-4).toUpperCase()}`;
  }

  function matchingCustomers(query) {
    const q = query.trim().toLowerCase();
    let list = state.customers.slice();
    if (q) list = list.filter(c => c.name.toLowerCase().includes(q));
    list.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.name.localeCompare(b.name);
    });
    return list.slice(0, 8);
  }

  // The search-result rows are plain divs (for the "played this week" badge
  // layout), so make them keyboard-operable like a real button: reachable by
  // Tab, activatable with Enter or Space.
  function makeRowActivatable(row, handler) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", handler);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  }

  function renderSearchResults() {
    const input = document.getElementById("customerSearchInput");
    const results = document.getElementById("customerSearchResults");
    const query = input.value;
    const matches = matchingCustomers(query);
    results.innerHTML = "";

    matches.forEach(c => {
      const row = document.createElement("div");
      row.className = "search-result-row";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = c.name;
      row.appendChild(nameSpan);
      const dis = disambiguatorFor(c);
      if (dis) {
        const disSpan = document.createElement("span");
        disSpan.className = "search-disambiguator";
        disSpan.textContent = dis;
        row.appendChild(disSpan);
      }
      if (playedThisWeek(c)) {
        const badge = document.createElement("span");
        badge.className = "search-badge";
        badge.textContent = "Played this week";
        row.appendChild(badge);
      }
      makeRowActivatable(row, () => {
        state.activeCustomerId = c.id;
        saveData();
        input.value = "";
        results.hidden = true;
        render();
      });
      results.appendChild(row);
    });

    const trimmed = query.trim();
    const exactMatch = trimmed && state.customers.some(c => c.name.toLowerCase() === trimmed.toLowerCase());
    if (trimmed && !exactMatch) {
      const addRow = document.createElement("div");
      addRow.className = "search-result-row add-new";
      addRow.textContent = `+ Add "${trimmed}" as new customer`;
      makeRowActivatable(addRow, () => {
        const customer = addCustomer(trimmed);
        state.activeCustomerId = customer.id;
        saveData();
        input.value = "";
        results.hidden = true;
        render();
      });
      results.appendChild(addRow);
    }

    results.hidden = matches.length === 0 && (!trimmed || exactMatch);
  }

  // ---------- Roster ----------

  function renderRoster() {
    const list = document.getElementById("rosterList");
    const empty = document.getElementById("noCustomersRoster");
    list.innerHTML = "";
    empty.hidden = state.customers.length !== 0;
    const template = document.getElementById("customerCardTemplate");

    state.customers.forEach(customer => {
      const node = template.content.cloneNode(true);
      const nameInput = node.querySelector(".customer-name-input");
      nameInput.value = customer.name;
      nameInput.addEventListener("change", () => {
        renameCustomer(customer.id, nameInput.value || customer.name);
        render();
      });

      node.querySelector(".btn-remove").addEventListener("click", () => {
        const pendingTotal = roundTotal(pendingRewardsFor(customer.id).flatMap(r => r.wins));
        const activeTotal = customer.activeGame ? roundTotal(customer.activeGame.wins) : 0;
        const totalAtStake = pendingTotal + activeTotal;
        let warning = "";
        if (totalAtStake > 0) {
          warning = ` They still have $${totalAtStake} in unredeemed RACCASH pending — their round history stays in History, but they'll disappear from Roster.`;
        } else if (customer.activeGame) {
          warning = ` They have an in-progress card with ${customer.activeGame.draws.length} ball${customer.activeGame.draws.length === 1 ? "" : "s"} drawn — removing them discards that progress.`;
        }
        showConfirm(`Remove ${customer.name} from the roster? This cannot be undone.${warning}`, () => {
          removeCustomer(customer.id);
          render();
        });
      });

      const status = node.querySelector(".card-status");
      const filled = cardFilledCount(customer);
      status.textContent = filled === 24 ? "Card ready ✓" : `${filled}/24 numbers entered`;
      status.classList.toggle("complete", filled === 24);

      const lastPlayed = node.querySelector(".last-played");
      if (customer.lastPlayedAt) {
        const recent = playedThisWeek(customer);
        lastPlayed.textContent = `Last played: ${formatDate(customer.lastPlayedAt)}${recent ? " (this week)" : ""}`;
        lastPlayed.classList.toggle("recent", recent);
      } else {
        lastPlayed.textContent = "Never played";
      }

      const gameProgress = node.querySelector(".game-progress");
      if (customer.activeGame) {
        const g = customer.activeGame;
        const drawn = new Set(g.draws);
        const hits = hitCountFor(customer, drawn);
        gameProgress.hidden = false;
        gameProgress.querySelector(".weeks-played").textContent = `Week ${g.sessionLog.length}`;
        gameProgress.querySelector(".balls-total").textContent =
          `${g.draws.length} ball${g.draws.length === 1 ? "" : "s"} drawn`;
        const weekStatus = gameProgress.querySelector(".week-drawn-status");
        const done = playedThisWeek(customer);
        weekStatus.textContent = done ? "Drawn this week ✓" : "Needs this week's balls";
        weekStatus.classList.toggle("needs-draw", !done);
        gameProgress.querySelector(".blackout-bar-fill").style.width = `${Math.round((hits / 24) * 100)}%`;
        gameProgress.querySelector(".blackout-bar-label").textContent = `${hits}/24 toward Blackout`;
      } else {
        gameProgress.hidden = true;
      }

      const pending = pendingRewardsFor(customer.id);
      const rewardList = node.querySelector(".reward-list");
      pending.forEach(round => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "reward-item";
        const total = roundTotal(round.wins);
        btn.textContent = `🎁 $${total} — ${round.wins.map(w => w.label).join(", ")} — ${formatDate(round.startedAt)}`;
        btn.addEventListener("click", () => goToRoundInHistory(round.id));
        rewardList.appendChild(btn);
      });
      if (customer.activeGame && customer.activeGame.wins.length > 0) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "reward-item reward-item-live";
        const total = roundTotal(customer.activeGame.wins);
        btn.textContent = `🎁 $${total} pending — ${customer.activeGame.wins.map(w => w.label).join(", ")} — still playing`;
        btn.addEventListener("click", () => {
          state.activeCustomerId = customer.id;
          saveData();
          switchTab("game");
          render();
        });
        rewardList.appendChild(btn);
      }

      node.querySelector(".play-btn").addEventListener("click", () => {
        state.activeCustomerId = customer.id;
        saveData();
        switchTab("game");
        render();
      });

      const printCardBtn = node.querySelector(".print-card-btn");
      printCardBtn.disabled = filled !== 24;
      printCardBtn.addEventListener("click", () => printCard(customer));

      const viewBtn = node.querySelector(".view-card-btn");
      const validation = node.querySelector(".card-validation");
      const expanded = expandedCustomerIds.has(customer.id);
      viewBtn.textContent = expanded ? "Hide Card ▲" : "View Card ▾";
      validation.hidden = !expanded;
      if (expanded) renderCardValidation(validation, customer);
      viewBtn.addEventListener("click", () => {
        if (expandedCustomerIds.has(customer.id)) expandedCustomerIds.delete(customer.id);
        else expandedCustomerIds.add(customer.id);
        render();
      });

      list.appendChild(node);
    });
  }

  // Shared read-only grid renderer used both for roster card validation and
  // the live progress view during an active round.
  function renderReadOnlyGrid(grid, customer, drawn) {
    if (!grid) return;
    const matrix = hitMatrix(customer, drawn);
    grid.innerHTML = "";
    COLUMNS.forEach(col => {
      const h = document.createElement("div");
      h.className = "cell-header";
      h.textContent = col;
      grid.appendChild(h);
    });
    for (let row = 0; row < 5; row++) {
      COLUMNS.forEach((col, colIdx) => {
        const value = customer.card[col][row];
        const cell = document.createElement("div");
        const isHit = matrix[row][colIdx];
        cell.className = "cell" + (value === FREE ? " free" : isHit ? " hit" : "");
        cell.textContent = value === FREE ? "FREE" : (value === null ? "–" : value);
        grid.appendChild(cell);
      });
    }
  }

  function renderCardValidation(container, customer) {
    const grid = container.querySelector(".validation-grid");
    const progression = container.querySelector(".validation-progression");
    const drawn = relevantDrawsFor(customer);
    renderReadOnlyGrid(grid, customer, drawn);

    const rounds = roundsFor(customer.id);
    progression.innerHTML = "";
    if (customer.activeGame) {
      const g = customer.activeGame;
      const live = document.createElement("div");
      live.className = "progression-row live";
      live.textContent = `In progress — Week ${g.sessionLog.length}, ${g.draws.length} ball${g.draws.length === 1 ? "" : "s"} drawn total: ${g.draws.join(", ") || "none yet"}`;
      progression.appendChild(live);
    }
    if (rounds.length === 0 && !customer.activeGame) {
      const none = document.createElement("div");
      none.className = "progression-row empty";
      none.textContent = "No games played yet.";
      progression.appendChild(none);
    } else {
      rounds.forEach(round => {
        const row = document.createElement("div");
        row.className = "progression-row";
        const winText = round.wins.length
          ? `${round.wins.map(w => w.label).join(", ")} — $${roundTotal(round.wins)}${round.redeemed ? " (redeemed)" : ""}`
          : "no win";
        row.textContent = `${formatDate(round.startedAt)} — drew ${round.draws.join(", ") || "none"} — ${winText}`;
        progression.appendChild(row);
      });
    }
  }

  // ---------- History ----------

  function renderHistory() {
    const list = document.getElementById("historyList");
    const empty = document.getElementById("noHistory");
    const summary = document.getElementById("historySummary");
    list.innerHTML = "";
    empty.hidden = state.history.length !== 0;

    let totalAwarded = 0;
    let totalPending = 0;
    state.history.forEach(round => {
      const total = roundTotal(round.wins);
      totalAwarded += total;
      if (!round.redeemed) totalPending += total;
    });
    // Most pending money now lives on customers' in-progress games, not
    // History (which only holds closed/redeemed records) — surface it here
    // too so this total doesn't quietly under-report.
    const totalInProgress = state.customers.reduce((sum, c) => {
      return sum + (c.activeGame ? roundTotal(c.activeGame.wins) : 0);
    }, 0);
    summary.textContent = state.history.length
      ? `Total RACCASH awarded: $${totalAwarded} across ${state.history.length} round${state.history.length === 1 ? "" : "s"}` +
        (totalPending ? ` · $${totalPending} still unredeemed` : "") +
        (totalInProgress ? ` · $${totalInProgress} pending in active games` : "")
      : (totalInProgress ? `$${totalInProgress} pending in active games` : "");

    state.history.forEach(round => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.id = `history-round-${round.id}`;

      const headerRow = document.createElement("div");
      headerRow.className = "history-item-header";
      const h4 = document.createElement("h4");
      h4.textContent = `${round.customerName} — ${new Date(round.startedAt).toLocaleString()}`;
      headerRow.appendChild(h4);

      const editToggle = document.createElement("button");
      editToggle.type = "button";
      editToggle.className = "btn btn-ghost btn-sm";
      const isEditing = editingRoundIds.has(round.id);
      editToggle.textContent = isEditing ? "Done Editing" : "Edit Round";
      editToggle.addEventListener("click", () => {
        if (editingRoundIds.has(round.id)) editingRoundIds.delete(round.id);
        else editingRoundIds.add(round.id);
        render();
      });
      headerRow.appendChild(editToggle);
      item.appendChild(headerRow);

      const meta = document.createElement("div");
      meta.className = "meta-line";
      meta.textContent = `Balls drawn: ${round.draws.join(", ") || "none"}`;
      item.appendChild(meta);

      if (isEditing) {
        item.appendChild(buildRoundEditPanel(round));
      }

      if (round.wins.length === 0) {
        const none = document.createElement("div");
        none.className = "no-winners";
        none.textContent = "No win this round.";
        item.appendChild(none);
      } else {
        const row = document.createElement("div");
        row.className = "win-row";

        const label = document.createElement("span");
        label.className = "win-row-label";
        const labels = round.wins.map(w => w.label).join(", ");
        label.textContent = `🏆 ${labels} — $${roundTotal(round.wins)} total`;
        row.appendChild(label);

        const actions = document.createElement("span");
        actions.className = "win-row-actions";

        const printBtn = document.createElement("button");
        printBtn.type = "button";
        printBtn.className = "btn btn-ghost btn-sm";
        printBtn.textContent = "Print Certificate 🖨";
        printBtn.addEventListener("click", () => printCertificate(round.customerName, round.wins, round.id));
        actions.appendChild(printBtn);

        if (round.redeemed) {
          const tag = document.createElement("span");
          tag.className = "redeemed-tag";
          tag.textContent = `Redeemed ${formatDate(round.redeemedAt)}`;
          actions.appendChild(tag);
        } else {
          const redeemBtn = document.createElement("button");
          redeemBtn.type = "button";
          redeemBtn.className = "btn btn-primary btn-sm";
          redeemBtn.textContent = "Confirm Redemption & New Card";
          redeemBtn.addEventListener("click", () => confirmRedemption(round.id));
          actions.appendChild(redeemBtn);
        }

        row.appendChild(actions);
        item.appendChild(row);
      }

      list.appendChild(item);
    });
  }

  function buildRoundEditPanel(round) {
    const panel = document.createElement("div");
    panel.className = "round-edit-panel";

    const reassignRow = document.createElement("div");
    reassignRow.className = "round-edit-row";
    const reassignLabel = document.createElement("label");
    reassignLabel.textContent = "Reassign to customer:";
    const select = document.createElement("select");
    state.customers.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === round.customerId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => reassignRoundCustomer(round.id, select.value));
    reassignRow.appendChild(reassignLabel);
    reassignRow.appendChild(select);
    panel.appendChild(reassignRow);

    const ballsLabel = document.createElement("label");
    ballsLabel.textContent = "Balls drawn (click × to remove):";
    panel.appendChild(ballsLabel);

    const ballsWrap = document.createElement("div");
    ballsWrap.className = "drawn-balls";
    round.draws.forEach((num, idx) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ball-chip removable";
      chip.title = "Click to remove this ball";
      chip.innerHTML = `${num}<span class="ball-chip-x">&times;</span>`;
      chip.addEventListener("click", () => removeDrawFromRound(round.id, idx));
      ballsWrap.appendChild(chip);
    });
    panel.appendChild(ballsWrap);

    const addForm = document.createElement("form");
    addForm.className = "call-row round-add-ball-form";
    const addInput = document.createElement("input");
    addInput.type = "number";
    addInput.min = 1;
    addInput.max = 75;
    addInput.placeholder = "1-75";
    const addBtn = document.createElement("button");
    addBtn.type = "submit";
    addBtn.className = "btn btn-ghost btn-sm";
    addBtn.textContent = "Add Ball";
    addForm.appendChild(addInput);
    addForm.appendChild(addBtn);
    addForm.addEventListener("submit", e => {
      e.preventDefault();
      addDrawToRound(round.id, parseInt(addInput.value, 10));
    });
    panel.appendChild(addForm);

    const addError = document.createElement("p");
    addError.className = "field-error";
    addError.id = `roundDrawError-${round.id}`;
    addError.hidden = true;
    panel.appendChild(addError);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger-outline btn-sm round-delete-btn";
    deleteBtn.textContent = "Delete This Round";
    deleteBtn.addEventListener("click", () => {
      showConfirm(`Permanently delete this round for ${round.customerName}? This cannot be undone.`, () => {
        deleteRound(round.id);
      });
    });
    panel.appendChild(deleteBtn);

    return panel;
  }

  // ---------- Confirm / alert modal ----------
  // Replaces window.confirm()/alert(): native dialogs can silently fail
  // (browser dialog-suppression after repeated use, extensions, embedded
  // contexts) and leave a click doing nothing with zero visible feedback —
  // an in-page modal can't be suppressed that way.

  function showConfirm(message, onConfirm) {
    const overlay = document.getElementById("confirmModalOverlay");
    const cancelBtn = document.getElementById("confirmModalCancelBtn");
    const okBtn = document.getElementById("confirmModalOkBtn");
    document.getElementById("confirmModalTitle").textContent = "Please Confirm";
    document.getElementById("confirmModalMessage").textContent = message;
    cancelBtn.hidden = false;
    okBtn.textContent = "Confirm";

    const cleanup = () => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    };
    const onOk = () => { cleanup(); onConfirm(); };
    const onCancel = () => cleanup();
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.hidden = false;
  }

  function showAlert(message) {
    const overlay = document.getElementById("confirmModalOverlay");
    const cancelBtn = document.getElementById("confirmModalCancelBtn");
    const okBtn = document.getElementById("confirmModalOkBtn");
    document.getElementById("confirmModalTitle").textContent = "Notice";
    document.getElementById("confirmModalMessage").textContent = message;
    cancelBtn.hidden = true;
    okBtn.textContent = "OK";

    const cleanup = () => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
    };
    const onOk = () => cleanup();
    okBtn.addEventListener("click", onOk);
    overlay.hidden = false;
  }

  // ---------- Analytics ----------
  // Everything here is derived, read-only reporting over customers/history —
  // no new state, just answers the questions a manager actually has: is the
  // promotion working, how much is on the hook, who's engaged.

  function computeAnalytics() {
    const totalCustomers = state.customers.length;
    const activeGameCustomers = state.customers.filter(c => c.activeGame);
    const totalActiveGames = activeGameCustomers.length;
    const closedGames = state.history;
    const totalCompletedGames = closedGames.length;

    let totalRedeemed = 0;
    let totalUnredeemedClosed = 0;
    const tierCounts = { 0: 0, 25: 0, 75: 0, 100: 0, 200: 0 };
    let otherTierCount = 0;
    closedGames.forEach(round => {
      const total = roundTotal(round.wins);
      if (round.redeemed) totalRedeemed += total; else totalUnredeemedClosed += total;
      if (tierCounts[total] !== undefined) tierCounts[total]++;
      else otherTierCount++;
    });

    let totalPendingActive = 0;
    activeGameCustomers.forEach(c => { totalPendingActive += roundTotal(c.activeGame.wins); });
    const totalPending = totalPendingActive + totalUnredeemedClosed;
    const totalAwarded = totalRedeemed + totalPending;

    const winRate = totalCompletedGames > 0
      ? Math.round(((totalCompletedGames - tierCounts[0]) / totalCompletedGames) * 100)
      : null;

    const tracked = closedGames.filter(r => typeof r.weeksPlayed === "number");
    const avgWeeksToRedeem = tracked.length
      ? Math.round((tracked.reduce((sum, r) => sum + r.weeksPlayed, 0) / tracked.length) * 10) / 10
      : null;

    // How many actual winning redemptions land per week, on average, since
    // the first one — the direct answer to "are we hitting our 1-2/week
    // target." Deliberately excludes $0 close-outs (no win, just reset).
    const winningGames = closedGames.filter(r => r.redeemed && r.redeemedAt && r.wins.length > 0);
    let avgWinsPerWeek = null;
    if (winningGames.length > 0) {
      const earliestWin = Math.min(...winningGames.map(r => r.redeemedAt));
      const weeksElapsed = Math.max(1, (Date.now() - earliestWin) / WEEK_MS);
      avgWinsPerWeek = Math.round((winningGames.length / weeksElapsed) * 10) / 10;
    }

    const playedThisWeekCount = state.customers.filter(c => playedThisWeek(c)).length;

    // Lifetime engagement per customer: every ball they've ever drawn,
    // across all their closed games plus whatever's in progress now.
    const engagement = state.customers.map(c => {
      const closed = roundsFor(c.id);
      const closedBalls = closed.reduce((sum, r) => sum + r.draws.length, 0);
      const closedWon = closed.reduce((sum, r) => sum + roundTotal(r.wins), 0);
      const activeBalls = c.activeGame ? c.activeGame.draws.length : 0;
      const activeWon = c.activeGame ? roundTotal(c.activeGame.wins) : 0;
      return { name: c.name, totalBalls: closedBalls + activeBalls, totalWon: closedWon + activeWon };
    }).filter(e => e.totalBalls > 0)
      .sort((a, b) => b.totalBalls - a.totalBalls)
      .slice(0, 10);

    return {
      totalCustomers, totalActiveGames, totalCompletedGames,
      totalAwarded, totalRedeemed, totalPending,
      tierCounts, otherTierCount, winRate, avgWeeksToRedeem, avgWinsPerWeek,
      playedThisWeekCount, engagement
    };
  }

  // Redemption counts (and $ totals) bucketed by calendar period, spanning
  // from the earliest redemption on record to now — not a fixed window, so
  // it scales from a few weeks of data up to a full year without code
  // changes. Empty history returns no buckets rather than a zeroed chart.
  function computeRedemptionTrend(mode) {
    const redemptions = state.history.filter(r => r.redeemed && r.redeemedAt);
    if (redemptions.length === 0) return [];

    const bucketSums = (start, end) => {
      const inBucket = redemptions.filter(r => r.redeemedAt >= start && r.redeemedAt < end);
      return { count: inBucket.length, total: inBucket.reduce((sum, r) => sum + roundTotal(r.wins), 0) };
    };

    const earliest = Math.min(...redemptions.map(r => r.redeemedAt));
    const now = Date.now();
    const buckets = [];

    if (mode === "year") {
      const startYear = new Date(earliest).getFullYear();
      const endYear = new Date(now).getFullYear();
      for (let y = startYear; y <= endYear; y++) {
        const start = new Date(y, 0, 1).getTime();
        const end = new Date(y + 1, 0, 1).getTime();
        buckets.push({ label: String(y), ...bucketSums(start, end) });
      }
    } else if (mode === "month") {
      const startDate = new Date(earliest);
      let y = startDate.getFullYear();
      let m = startDate.getMonth();
      const endDate = new Date(now);
      const endY = endDate.getFullYear();
      const endM = endDate.getMonth();
      while (y < endY || (y === endY && m <= endM)) {
        const start = new Date(y, m, 1).getTime();
        const end = new Date(y, m + 1, 1).getTime();
        buckets.push({ label: new Date(y, m, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" }), ...bucketSums(start, end) });
        m++;
        if (m > 11) { m = 0; y++; }
      }
    } else {
      const start0 = new Date(earliest);
      start0.setHours(0, 0, 0, 0);
      let cursor = start0.getTime();
      while (cursor <= now) {
        const end = cursor + WEEK_MS;
        buckets.push({ label: new Date(cursor).toLocaleDateString(undefined, { month: "short", day: "numeric" }), ...bucketSums(cursor, end) });
        cursor = end;
      }
    }

    return buckets;
  }

  // Customers who HAVE played before but have gone quiet longer than the
  // re-engagement threshold — deliberately excludes anyone who's never
  // played at all (they were never "engaged" to begin with, that's a
  // different problem than winning someone back). Actual texting happens
  // outside this app; this just answers "who, and how long."
  function computeReengagementList() {
    return state.customers
      .filter(c => c.lastPlayedAt && (Date.now() - c.lastPlayedAt) >= REENGAGEMENT_THRESHOLD_MS)
      .sort((a, b) => a.lastPlayedAt - b.lastPlayedAt)
      .map(c => ({
        name: c.name,
        lastPlayedAt: c.lastPlayedAt,
        weeksSince: Math.floor((Date.now() - c.lastPlayedAt) / WEEK_MS)
      }));
  }

  function statTile(value, label) {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const v = document.createElement("div");
    v.className = "stat-tile-value";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "stat-tile-label";
    l.textContent = label;
    tile.appendChild(v);
    tile.appendChild(l);
    return tile;
  }

  let analyticsTrendMode = "week";

  function renderAnalyticsTab() {
    const a = computeAnalytics();

    const statTiles = document.getElementById("statTiles");
    statTiles.innerHTML = "";
    statTiles.appendChild(statTile(a.totalCustomers, "Total Customers"));
    statTiles.appendChild(statTile(a.totalActiveGames, "Active Games"));
    statTiles.appendChild(statTile(a.totalCompletedGames, "Completed Games"));
    statTiles.appendChild(statTile(`$${a.totalAwarded}`, "Total Awarded"));
    statTiles.appendChild(statTile(`$${a.totalRedeemed}`, "Redeemed"));
    statTiles.appendChild(statTile(`$${a.totalPending}`, "Outstanding"));

    const tierLabels = [["0", "No Win"], ["25", "Line — $25"], ["75", "Corners — $75"], ["100", "Full — $100"], ["200", "Blackout — $200"]];
    const maxCount = Math.max(1, ...tierLabels.map(([key]) => a.tierCounts[key]));
    const tierList = document.getElementById("tierBreakdownList");
    tierList.innerHTML = "";
    tierLabels.forEach(([key, label]) => {
      const count = a.tierCounts[key];
      const row = document.createElement("div");
      row.className = "tier-breakdown-row";
      row.innerHTML = `
        <span class="tier-breakdown-label">${label}</span>
        <span class="tier-breakdown-bar-wrap"><span class="tier-breakdown-bar-fill" style="width:${Math.round((count / maxCount) * 100)}%"></span></span>
        <span class="tier-breakdown-count">${count}</span>`;
      tierList.appendChild(row);
    });
    document.getElementById("winRateText").textContent = a.winRate === null
      ? "No completed games yet."
      : `${a.winRate}% of completed games ended with a win.`;

    const trend = computeRedemptionTrend(analyticsTrendMode);
    const chart = document.getElementById("weekTrendChart");
    const chartWrap = document.querySelector(".week-trend-chart-wrap");
    const noTrendData = document.getElementById("noTrendData");
    chart.innerHTML = "";
    noTrendData.hidden = trend.length !== 0;
    chartWrap.hidden = trend.length === 0;
    const maxTrendCount = Math.max(1, ...trend.map(w => w.count));
    trend.forEach(w => {
      const col = document.createElement("div");
      col.className = "week-trend-bar-col";
      col.innerHTML = `
        <div class="week-trend-count">${w.count}</div>
        <div class="week-trend-bar" style="height:${Math.round((w.count / maxTrendCount) * 100)}%"></div>
        <div class="week-trend-label">${w.label}</div>
        <div class="week-trend-dollar">$${w.total}</div>`;
      chart.appendChild(col);
    });

    const engagementTiles = document.getElementById("engagementTiles");
    engagementTiles.innerHTML = "";
    engagementTiles.appendChild(statTile(a.avgWinsPerWeek === null ? "—" : a.avgWinsPerWeek, "Avg Wins / Week"));
    engagementTiles.appendChild(statTile(a.avgWeeksToRedeem === null ? "—" : a.avgWeeksToRedeem, "Avg Weeks to Redeem"));
    engagementTiles.appendChild(statTile(`${a.playedThisWeekCount}/${a.totalCustomers}`, "Drawn This Week"));

    const topList = document.getElementById("topPlayersList");
    const noTop = document.getElementById("noTopPlayers");
    topList.innerHTML = "";
    noTop.hidden = a.engagement.length !== 0;
    a.engagement.forEach(e => {
      const row = document.createElement("div");
      row.className = "top-player-row";
      row.innerHTML = `
        <span class="top-player-name">${escapeHtml(e.name)}</span>
        <span class="top-player-stats">${e.totalBalls} balls drawn · $${e.totalWon} won</span>`;
      topList.appendChild(row);
    });

    const reengage = computeReengagementList();
    const reengageList = document.getElementById("reengageList");
    const noReengage = document.getElementById("noReengage");
    reengageList.innerHTML = "";
    noReengage.hidden = reengage.length !== 0;
    reengage.forEach(r => {
      const row = document.createElement("div");
      row.className = "top-player-row";
      row.innerHTML = `
        <span class="top-player-name">${escapeHtml(r.name)}</span>
        <span class="top-player-stats">${r.weeksSince} week${r.weeksSince === 1 ? "" : "s"} since last played (${formatDate(r.lastPlayedAt)})</span>`;
      reengageList.appendChild(row);
    });
  }

  // ---------- Win celebration ----------

  let popupActive = false;
  let activeModalWin = null;

  function processWinPopupQueue() {
    if (popupActive || pendingWinPopups.length === 0) return;
    const win = pendingWinPopups.shift();
    showWinModal(win);
  }

  function showWinModal(win) {
    popupActive = true;
    activeModalWin = win;
    const overlay = document.getElementById("winModalOverlay");
    document.getElementById("winModalTitle").textContent = "BINGO!";
    document.getElementById("winModalSubtitle").textContent = `${win.customerName} hit ${win.label}!`;
    document.getElementById("winModalAmount").textContent = `$${win.prize} RACCASH`;
    overlay.hidden = false;
    launchFireworks();
  }

  function dismissWinModal() {
    document.getElementById("winModalOverlay").hidden = true;
    stopFireworks();
    popupActive = false;
    activeModalWin = null;
    processWinPopupQueue();
  }

  // ---------- Fireworks ----------

  let fireworksAnimId = null;
  let fireworksTimeouts = [];

  function launchFireworks() {
    const canvas = document.getElementById("fireworksCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#ffb703", "#ffd60a", "#2ea043", "#4cc9f0", "#f72585", "#ffffff"];
    const particles = [];

    function spawnBurst(x, y) {
      const count = 44;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 2 + Math.random() * 3.2;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 2 + Math.random() * 2
        });
      }
    }

    for (let b = 0; b < 5; b++) {
      const t = setTimeout(() => {
        spawnBurst(canvas.width * (0.2 + Math.random() * 0.6), canvas.height * (0.2 + Math.random() * 0.35));
      }, b * 350);
      fireworksTimeouts.push(t);
    }

    const start = Date.now();
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.alpha -= 0.012;
        ctx.globalAlpha = Math.max(p.alpha, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].alpha <= 0) particles.splice(i, 1);
      }
      if (Date.now() - start < 4000 || particles.length > 0) {
        fireworksAnimId = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    frame();
  }

  function stopFireworks() {
    if (fireworksAnimId) cancelAnimationFrame(fireworksAnimId);
    fireworksAnimId = null;
    fireworksTimeouts.forEach(clearTimeout);
    fireworksTimeouts = [];
    const canvas = document.getElementById("fireworksCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ---------- Digital ball cage ----------
  // The physical cage is still how customers actually play — this is a
  // backup/showcase alternative that draws the same way (uniformly random
  // from whatever's left undrawn for this card) and feeds the exact same
  // drawBallForCustomer path, just with an animated cage instead of typing
  // a number that came out of the real machine.

  const BALL_COLORS = { B: "#2ea043", I: "#c8102e", N: "#2b6cb0", G: "#d4a017", O: "#7c3aed" };
  // Slow enough that staff can visually track one specific ball as it
  // bounces, not just a blur of motion.
  const CAGE_BALL_SPEED_MIN = 0.3;
  const CAGE_BALL_SPEED_RANGE = 0.5;

  function randomCageSpeed() {
    return CAGE_BALL_SPEED_MIN + Math.random() * CAGE_BALL_SPEED_RANGE;
  }

  function columnForNumber(num) {
    return COLUMNS.find(col => num >= COLUMN_RANGES[col][0] && num <= COLUMN_RANGES[col][1]);
  }

  let drawMode = "manual"; // "manual" | "digital" — persists across customers within the session
  let cageBalls = [];
  let cageCustomerId = null;
  let cageAnimId = null;
  let cageDrawInFlight = false;

  function initCageBalls(remainingNumbers) {
    const canvas = document.getElementById("ballCageCanvas");
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, cageRadius = Math.min(w, h) / 2 - 16;
    cageBalls = remainingNumbers.map(num => {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (cageRadius - 12);
      const speed = randomCageSpeed();
      const dir = Math.random() * Math.PI * 2;
      return {
        num,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: Math.cos(dir) * speed,
        vy: Math.sin(dir) * speed,
        radius: 11,
        color: BALL_COLORS[columnForNumber(num)]
      };
    });
  }

  function stepCage() {
    const canvas = document.getElementById("ballCageCanvas");
    if (!canvas) { cageAnimId = null; return; }
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2, cageRadius = Math.min(w, h) / 2 - 16;

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(cx, cy, cageRadius + 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.stroke();

    cageBalls.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      const dx = b.x - cx, dy = b.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist + b.radius > cageRadius) {
        const nx = dx / dist, ny = dy / dist;
        const dot = b.vx * nx + b.vy * ny;
        b.vx -= 2 * dot * nx;
        b.vy -= 2 * dot * ny;
        const overshoot = dist + b.radius - cageRadius;
        b.x -= nx * overshoot;
        b.y -= ny * overshoot;
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.num, b.x, b.y);
    });

    cageAnimId = requestAnimationFrame(stepCage);
  }

  function stopCageAnimation() {
    if (cageAnimId) cancelAnimationFrame(cageAnimId);
    cageAnimId = null;
  }

  function showRevealedBall(ball) {
    const slot = document.getElementById("ballRevealSlot");
    slot.innerHTML = `<div class="revealed-ball" style="background:${ball.color}">${ball.num}</div>`;
  }

  function drawFromDigitalCage() {
    if (cageDrawInFlight || cageBalls.length === 0 || !state.activeCustomerId) return;
    cageDrawInFlight = true;
    document.getElementById("digitalDrawBtn").disabled = true;
    const idx = Math.floor(Math.random() * cageBalls.length);
    const [picked] = cageBalls.splice(idx, 1);
    showRevealedBall(picked);
    const customerId = state.activeCustomerId;
    setTimeout(() => {
      cageDrawInFlight = false;
      if (state.activeCustomerId === customerId) {
        drawBallForCustomer(customerId, picked.num);
        render();
      }
    }, 900);
  }

  // ---------- Printable certificate ----------

  const STORE_NUMBER = "650"; // inferred from the "650Goats" login / RAC650 naming — update if wrong
  const STORE_ADDRESS = "437 Hepburn St., Williamsport, PA 17701";
  const STORE_PHONE = "(570) 322-4900";

  // Renders the exact approved RACCASH bill graphic(s) for this certificate
  // — never a redrawn or edited version. Every possible round total has an
  // exact matching bill (see BILL_DENOMINATIONS), so this is normally just
  // one image; the array only ever holds more than one if prize amounts
  // change again and stop lining up with real denominations.
  function billsHTML(bills) {
    return bills.map(b =>
      `<img src="assets/rac-cash-${b}.png" alt="RAC CASH $${b}" class="cert-bill-img">`
    ).join("");
  }

  // Always three fixed rows (matching the official certificate template),
  // showing $0 for any tier not won this round, plus a total row.
  function certBreakdownHTML(wins, total) {
    const amountFor = key => {
      const win = wins.find(w => tierKeyFor(w.pattern) === key);
      return win ? win.prize : 0;
    };
    const rows = [
      ["ROW 1", amountFor("LINE")],
      ["FOUR CORNERS", amountFor("CORNERS")],
      ["FULL BINGO", amountFor("BLACKOUT")]
    ].map(([label, amt]) => `<div class="cert-breakdown-row"><span>${label}</span><span>$${amt}</span></div>`).join("");
    return `${rows}<div class="cert-breakdown-row cert-breakdown-total"><span>TOTAL RAC CASH</span><span>$${total}</span></div>`;
  }

  function thankYouMessage(customerName) {
    return `Dear ${escapeHtml(customerName)},<br><br>
      From all of us at Rent-A-Center, thank you for playing RAC Bingo. Our drawings are only
      possible because customers like you continue to visit, participate, and support our
      store. We hope you enjoy your reward, and we look forward to seeing you at your next
      drawing.<br><br>
      With appreciation,<br>
      Your Rent-A-Center Team`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // A short, stable code printed on the certificate for matching a physical
  // printout back to its record — not a security feature, just a reference
  // number. Deterministic from certKey (a round id, or a customer+timestamp
  // fallback for a still-live round), so reprinting the same win always
  // shows the same ID.
  function certificateIdFor(certKey) {
    const str = String(certKey);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return "RB-" + hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
  }

  // A round has exactly one certificate, reflecting everything the customer
  // has won so far this round — not one certificate per tier. Reaching
  // Blackout means all three tiers are present, so this naturally becomes
  // the $200 grand certificate at that point.
  function printCertificate(customerName, wins, certKey) {
    if (!wins || wins.length === 0) return;
    const info = certificateInfo(wins);
    const latestTimestamp = Math.max(...wins.map(w => w.timestamp));
    document.getElementById("certName").textContent = customerName;
    document.getElementById("certTitleLine").textContent = info.headline;
    document.getElementById("certAwardedDate").textContent = new Date(latestTimestamp).toLocaleDateString();
    document.getElementById("certBills").innerHTML = billsHTML(info.bills);
    // A missing/renamed bill asset would otherwise print as a silent broken-
    // image icon — replace it with a visible warning so staff catch it
    // before handing over an incomplete certificate.
    document.querySelectorAll("#certBills .cert-bill-img").forEach(img => {
      img.addEventListener("error", () => {
        const amount = img.alt.match(/\$\d+/);
        img.outerHTML = `<div class="cert-bill-missing">⚠ RAC CASH ${amount ? amount[0] : ""} bill graphic could not be loaded — do not redeem until this is fixed.</div>`;
      }, { once: true });
    });
    document.getElementById("certMedal").hidden = !info.isGrand;
    document.getElementById("certBreakdown").innerHTML = certBreakdownHTML(wins, info.total);
    document.getElementById("certTotalAmount").textContent = `$${info.total}`;
    document.getElementById("certThankYou").innerHTML = thankYouMessage(customerName);
    document.getElementById("certId").textContent = certificateIdFor(certKey || `${customerName}-${latestTimestamp}`);
    document.getElementById("certStoreNumber").textContent = STORE_NUMBER;
    document.getElementById("certStoreAddress").textContent = STORE_ADDRESS;
    document.getElementById("certStorePhone").textContent = STORE_PHONE;
    document.body.classList.add("printing-cert");
    window.print();
  }

  // ---------- Printable bingo card (front/back, 4x6 index card) ----------

  // Once a game exists, the Card ID is keyed off it so it's stable for the
  // whole life of the card — a week-3 reprint shows the same ID as week 1.
  // Before a game has started (first print of a brand-new card), falls back
  // to a date-stamped ID.
  function cardIdFor(customer) {
    if (customer.activeGame) {
      return `RB-${customer.activeGame.id.slice(-8).toUpperCase()}`;
    }
    const code = customer.id.slice(-6).toUpperCase();
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `RB-${code}-${mm}${dd}${yy}`;
  }

  function cardGridHTMLBranded(customer) {
    let html = "";
    COLUMNS.forEach(col => {
      const red = col === "I" || col === "G";
      html += `<div class="cf-col-header${red ? " red" : ""}">${col}</div>`;
    });
    for (let row = 0; row < 5; row++) {
      COLUMNS.forEach(col => {
        const value = customer.card[col][row];
        if (value === FREE) {
          html += `<div class="cf-cell cf-free">★<br>FREE</div>`;
        } else {
          html += `<div class="cf-cell"><span>${value === null ? "" : value}</span><i class="cf-check"></i></div>`;
        }
      });
    }
    return html;
  }

  function cardFrontHTML(customer) {
    const dateStr = new Date().toLocaleDateString();
    return `
      <div class="card-print-page card-front">
        <div class="cf-header">
          <div class="cf-logo"><img src="assets/rac-logo.png" alt="RAC" class="cf-logo-img"></div>
          <div class="cf-title">
            <div class="cf-title-main">RAC <span>BINGO</span></div>
            <div class="cf-title-sub">★ FREE WEEKLY CUSTOMER APPRECIATION PROGRAM ★</div>
          </div>
          <div class="cf-badge">
            <div class="cf-badge-star">★</div>
            <div class="cf-badge-text">LIMIT 1<br>PLAY<br>PER WEEK</div>
          </div>
        </div>
        <div class="cf-info-row">
          <div class="cf-info"><span class="cf-info-icon">👤</span><div><div class="cf-info-label">CUSTOMER NAME</div><div class="cf-info-value">${escapeHtml(customer.name)}</div></div></div>
          <div class="cf-info"><span class="cf-info-icon">📅</span><div><div class="cf-info-label">ISSUE DATE</div><div class="cf-info-value">${dateStr}</div></div></div>
          <div class="cf-info"><span class="cf-info-icon">🪪</span><div><div class="cf-info-label">CARD ID</div><div class="cf-info-value">${cardIdFor(customer)}</div></div></div>
        </div>
        <div class="cf-grid">${cardGridHTMLBranded(customer)}</div>
        <div class="cf-footer">
          <span>📅 PLAY WEEKLY</span>
          <span>💵 EARN RAC CASH</span>
          <span>★ STAY CURRENT</span>
          <span class="cf-footer-note">OFFICIAL STORE GAME CARD<br>PROPERTY OF RENT-A-CENTER</span>
        </div>
      </div>`;
  }

  function cardBackHTML() {
    return `
      <div class="card-print-page card-back-v2">
        <div class="cb-header">
          <div class="cb-header-left">RAC <span>BINGO</span></div>
          <div class="cb-header-right">HOW TO PLAY <span class="cb-stars">★ ★ ★ ★</span></div>
        </div>

        <div class="cb-steps">
          <div class="cb-step">
            <div class="cb-step-num">1</div>
            <div class="cb-step-icon">🏪</div>
            <div class="cb-step-text"><strong>VISIT WEEKLY</strong><span>Visit once each calendar week.</span></div>
          </div>
          <div class="cb-step">
            <div class="cb-step-num">2</div>
            <div class="cb-step-balls">
              <i style="background:#2ea043">B</i><i style="background:#c8102e">I</i><i style="background:#2b6cb0">N</i><i style="background:#d4a017">G</i><i style="background:#7c3aed">O</i>
            </div>
            <div class="cb-step-text"><strong>DRAW YOUR BALLS</strong><span>An associate pulls numbers for your card.</span></div>
          </div>
          <div class="cb-step">
            <div class="cb-step-num">3</div>
            <div class="cb-step-icon">🗂️</div>
            <div class="cb-step-text"><strong>BUILD YOUR CARD</strong><span>Matching numbers remain marked.</span></div>
          </div>
        </div>

        <div class="cb-section-title">WAYS TO WIN</div>
        <div class="cb-wins">
          <div class="cb-win-box">
            <div class="cb-mini-grid corners">${"<i></i>".repeat(16)}</div>
            <div class="cb-win-label">FOUR CORNERS</div>
            <div class="cb-win-amount">🏆 $${PRIZES.CORNERS}</div>
          </div>
          <div class="cb-win-box">
            <div class="cb-mini-grid line">${"<i></i>".repeat(5)}</div>
            <div class="cb-win-label">SINGLE LINE</div>
            <div class="cb-win-amount">🏆 $${PRIZES.LINE}</div>
          </div>
          <div class="cb-win-box">
            <div class="cb-mini-grid full">${"<i></i>".repeat(16)}</div>
            <div class="cb-win-label">FULL BINGO</div>
            <div class="cb-win-amount">🏆 $${PRIZES.BLACKOUT}</div>
          </div>
        </div>

        <div class="cb-rules-row">
          <div class="cb-section-title small">QUICK RULES</div>
          <ul class="cb-rules">
            <li>✅ Participation is FREE</li>
            <li>✅ Stay current to participate</li>
            <li>✅ One play each week</li>
            <li>✅ Card remains in store</li>
            <li>✅ Manager verifies prizes</li>
          </ul>
        </div>

        <div class="cb-footer">
          <div class="cb-thankyou">Thank You<span>FOR PLAYING! SEE YOU NEXT WEEK.</span></div>
          <div class="cb-contact">📍 ${STORE_ADDRESS}<br>📞 ${STORE_PHONE}</div>
          <div class="cb-legal">Participation subject to official program rules.</div>
        </div>
      </div>`;
  }

  function printCard(customer) {
    document.getElementById("cardPrintArea").innerHTML = cardFrontHTML(customer) + cardBackHTML();
    document.body.classList.add("printing-card");
    window.print();
  }

  window.addEventListener("afterprint", () => {
    document.body.classList.remove("printing-cert");
    document.body.classList.remove("printing-card");
  });

  // ---------- Export / Import ----------

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    downloadBlob(blob, `racbingo-backup-${Date.now()}.json`);
  }

  function exportCsv() {
    const rows = [["Game Started", "Customer", "Balls Drawn", "Milestones Won", "Total Prize", "Status", "Redeemed Date"]];
    state.history.forEach(round => {
      const started = new Date(round.startedAt).toLocaleString();
      const balls = round.draws.join(" ");
      const milestones = round.wins.map(w => w.label).join(" + ");
      rows.push([
        started, round.customerName, balls, milestones, roundTotal(round.wins),
        round.wins.length === 0 ? "" : (round.redeemed ? "Redeemed" : "Unredeemed"),
        round.redeemed ? new Date(round.redeemedAt).toLocaleString() : ""
      ]);
    });
    // Customers still mid-game (not yet redeemed/closed out) don't have a
    // History record yet — surface their running total here too, so a
    // spreadsheet review of all customers doesn't miss pending winners.
    state.customers.forEach(customer => {
      if (!customer.activeGame || customer.activeGame.wins.length === 0) return;
      const g = customer.activeGame;
      rows.push([
        new Date(g.startedAt).toLocaleString(), customer.name, g.draws.join(" "),
        g.wins.map(w => w.label).join(" + "), roundTotal(g.wins),
        `In Progress (Week ${g.sessionLog.length})`, ""
      ]);
    });
    const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    downloadBlob(blob, `racbingo-winners-${Date.now()}.csv`);
  }

  function csvEscape(val) {
    const s = String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Checks just enough shape to keep a malformed/foreign JSON file from
  // silently corrupting state and breaking rendering later — not a full
  // schema validator, just enough to fail loudly at import time instead of
  // crashing the app on the next render.
  function validateBackupShape(parsed) {
    if (!Array.isArray(parsed.customers) || !Array.isArray(parsed.history)) {
      throw new Error("File does not look like a RACBINGO backup.");
    }
    parsed.customers.forEach(c => {
      if (typeof c.id !== "string" || typeof c.name !== "string" || !c.card) {
        throw new Error("Backup contains an invalid customer record.");
      }
    });
    parsed.history.forEach(r => {
      if (typeof r.id !== "string" || typeof r.customerId !== "string" ||
          !Array.isArray(r.wins) || !Array.isArray(r.draws)) {
        throw new Error("Backup contains an invalid round record.");
      }
    });
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        validateBackupShape(parsed);
        showConfirm("Importing will replace all current data. Continue?", () => {
          // Restoring a backup taken before the persistent-game update needs
          // the same migration loadData() runs on every startup, so it
          // doesn't reintroduce the old weekly-reset bug.
          migrateToPersistentGames(parsed);
          state = parsed;
          state.activeCustomerId = null;
          saveData();
          render();
        });
      } catch (e) {
        showAlert("Could not import file: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Event wiring ----------

  document.getElementById("tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    switchTab(btn.dataset.tab);
    render();
  });

  const searchInput = document.getElementById("customerSearchInput");
  searchInput.addEventListener("input", renderSearchResults);
  searchInput.addEventListener("focus", renderSearchResults);
  document.addEventListener("click", e => {
    const results = document.getElementById("customerSearchResults");
    if (!results.contains(e.target) && e.target !== searchInput) results.hidden = true;
  });

  // Enter jumps straight in without needing to click a suggestion: an exact
  // (or single unambiguous partial) name match selects that customer;
  // anything else offers to add the typed name as a new customer.
  function selectCustomerAndClearSearch(customer) {
    state.activeCustomerId = customer.id;
    saveData();
    searchInput.value = "";
    document.getElementById("customerSearchResults").hidden = true;
    render();
  }
  searchInput.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    const exactMatches = state.customers.filter(c => c.name.toLowerCase() === query.toLowerCase());
    if (exactMatches.length === 1) { selectCustomerAndClearSearch(exactMatches[0]); return; }
    if (exactMatches.length > 1) {
      // More than one customer shares this exact name — don't guess which
      // one they meant. Leave the type-ahead dropdown open (it shows a
      // disambiguator for each) so they can click the right one.
      renderSearchResults();
      return;
    }
    const partial = matchingCustomers(query);
    if (partial.length === 1) { selectCustomerAndClearSearch(partial[0]); return; }
    showConfirm(`No customer found named "${query}". Add them as a new customer?`, () => {
      selectCustomerAndClearSearch(addCustomer(query));
    });
  });

  document.getElementById("changeCustomerBtn").addEventListener("click", () => {
    state.activeCustomerId = null;
    saveData();
    render();
  });

  document.getElementById("startRoundBtn").addEventListener("click", () => {
    if (!state.activeCustomerId) return;
    const customer = findCustomer(state.activeCustomerId);
    if (!customer || !cardComplete(customer)) return;
    startNewGame(state.activeCustomerId);
    render();
  });

  document.getElementById("generateCardBtn").addEventListener("click", () => {
    if (!state.activeCustomerId) return;
    const customer = findCustomer(state.activeCustomerId);
    if (!customer) return;
    const doGenerate = () => {
      customer.card = generateRandomCard();
      saveData();
      render();
    };
    if (cardFilledCount(customer) > 0) {
      showConfirm("This will overwrite the current card numbers. Continue?", doGenerate);
    } else {
      doGenerate();
    }
  });

  document.getElementById("printCardBtn").addEventListener("click", () => {
    if (!state.activeCustomerId) return;
    const customer = findCustomer(state.activeCustomerId);
    if (!customer || !cardComplete(customer)) return;
    printCard(customer);
  });

  document.getElementById("drawForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("drawInput");
    const num = parseInt(input.value, 10);
    if (state.activeCustomerId && drawBallForCustomer(state.activeCustomerId, num)) input.value = "";
    render();
    input.focus();
  });

  document.getElementById("undoDrawBtn").addEventListener("click", () => {
    if (state.activeCustomerId) undoLastDrawFor(state.activeCustomerId);
    render();
  });

  document.getElementById("drawModeToggle").addEventListener("click", e => {
    const btn = e.target.closest(".draw-mode-btn");
    if (!btn) return;
    drawMode = btn.dataset.mode;
    document.querySelectorAll("#drawModeToggle .draw-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    render();
  });

  document.getElementById("digitalDrawBtn").addEventListener("click", drawFromDigitalCage);

  // Just stepping away for now — nothing to discard, every draw already
  // saved immediately, so no confirmation needed.
  document.getElementById("finishVisitBtn").addEventListener("click", () => {
    finishVisit();
    render();
  });

  // Only enabled while nothing's been drawn yet this visit (see
  // renderLiveGame) — nothing at stake, so no confirmation needed either.
  document.getElementById("cancelRoundBtn").addEventListener("click", () => {
    if (state.activeCustomerId) cancelEmptyGame(state.activeCustomerId);
    render();
  });

  document.getElementById("closeOutGameBtn").addEventListener("click", () => {
    const customer = findCustomer(state.activeCustomerId);
    if (!customer || !customer.activeGame) return;
    const total = roundTotal(customer.activeGame.wins);
    const message = total > 0
      ? `Redeem $${total} RACCASH for ${customer.name} and start them on a brand new card? This closes out their current game.`
      : `Close out ${customer.name}'s current card with no win and start them on a brand new one? This cannot be undone.`;
    showConfirm(message, () => closeOutGame(customer.id));
  });

  document.getElementById("trendFilterRow").addEventListener("click", e => {
    const btn = e.target.closest(".chart-filter-btn");
    if (!btn) return;
    analyticsTrendMode = btn.dataset.mode;
    document.querySelectorAll("#trendFilterRow .chart-filter-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderAnalyticsTab();
  });

  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("importInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = "";
  });

  document.getElementById("winModalAckBtn").addEventListener("click", dismissWinModal);
  document.getElementById("winModalPrintBtn").addEventListener("click", () => {
    if (!activeModalWin) return;
    // Print reflects everything won in the game so far, not just this one
    // milestone — fall back to the single win if the game somehow isn't
    // live anymore (e.g. it was already closed out).
    const customer = activeModalWin.customerId ? findCustomer(activeModalWin.customerId) : null;
    const isLive = customer && customer.activeGame;
    const wins = isLive ? customer.activeGame.wins : [activeModalWin];
    const certKey = isLive ? customer.activeGame.id : null;
    printCertificate(activeModalWin.customerName, wins, certKey);
  });

  document.getElementById("loginForm").addEventListener("submit", e => {
    e.preventDefault();
    const user = document.getElementById("loginUsername").value.trim();
    const pass = document.getElementById("loginPassword").value;
    const errEl = document.getElementById("loginError");
    const passwordInput = document.getElementById("loginPassword");
    if (user === AUTH_USERNAME && pass === AUTH_PASSWORD) {
      sessionStorage.setItem(AUTH_SESSION_KEY, "true");
      errEl.hidden = true;
      e.target.reset();
      showApp();
    } else {
      errEl.textContent = "Incorrect username or password.";
      errEl.hidden = false;
      passwordInput.value = "";
      passwordInput.focus();
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    showLoginScreen();
  });

  if (isLoggedIn()) {
    showApp();
  } else {
    showLoginScreen();
  }

  render();
})();
