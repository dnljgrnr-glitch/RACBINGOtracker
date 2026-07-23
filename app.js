(() => {
  "use strict";

  const STORAGE_KEY = "racbingo_data_v3";
  const COLUMNS = ["B", "I", "N", "G", "O"];
  const COLUMN_RANGES = { B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75] };
  const FREE = "FREE";
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const PRIZES = { LINE: 25, CORNERS: 50, BLACKOUT: 100 };
  const TIER_KEYS = ["LINE", "CORNERS", "BLACKOUT"];

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
  // $175 "grand" case ($25 + $50 + $100) is the only way all three ever
  // appear together.
  function certificateInfo(wins) {
    const total = roundTotal(wins);
    const hasBlackout = wins.some(w => tierKeyFor(w.pattern) === "BLACKOUT");
    const hasCorners = wins.some(w => tierKeyFor(w.pattern) === "CORNERS");
    const lineWin = wins.find(w => tierKeyFor(w.pattern) === "LINE");
    let headline = "RACBINGO Win!";
    if (hasBlackout) headline = "GRAND CERTIFICATE — FULL BINGO!";
    else if (hasCorners) headline = "Four Corners Win!";
    else if (lineWin) headline = `${lineWin.label} Win!`;
    return { total, isGrand: hasBlackout, headline, breakdown: wins.slice() };
  }

  // ---------- Persistence ----------

  function defaultData() {
    return { customers: [], currentRound: null, history: [] };
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
      // Migrate older data recorded when Four Corners incorrectly paid $75
      // instead of $50 — corrects both past rounds and an in-progress one.
      const fixCornersPrize = wins => {
        (wins || []).forEach(w => {
          if (w.pattern === "Four Corners" && w.prize !== PRIZES.CORNERS) w.prize = PRIZES.CORNERS;
        });
      };
      parsed.history.forEach(round => fixCornersPrize(round.wins));
      if (parsed.currentRound) fixCornersPrize(parsed.currentRound.wins);
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
  let selectedCustomerId = null;
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

  function drawnSet() {
    return new Set(state.currentRound ? state.currentRound.draws : []);
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

  function playedThisWeek(customer) {
    return !!customer.lastPlayedAt && (Date.now() - customer.lastPlayedAt) < WEEK_MS;
  }

  // Rounds this customer won something on but hasn't redeemed yet.
  function pendingRewardsFor(customerId) {
    return state.history.filter(r => r.customerId === customerId && r.wins.length > 0 && !r.redeemed);
  }

  function roundsFor(customerId) {
    return state.history.filter(r => r.customerId === customerId);
  }

  // The draws to validate a customer's card against: their live round if one
  // is in progress, otherwise their most recently completed round.
  function relevantDrawsFor(customer) {
    if (state.currentRound && state.currentRound.customerId === customer.id) {
      return new Set(state.currentRound.draws);
    }
    const rounds = roundsFor(customer.id);
    return rounds.length ? new Set(rounds[0].draws) : new Set();
  }

  // ---------- Customer CRUD ----------

  function addCustomer(name) {
    const customer = { id: uid(), name: name.trim(), card: emptyCard(), lastPlayedAt: null };
    state.customers.push(customer);
    saveData();
    return customer;
  }

  function removeCustomer(id) {
    state.customers = state.customers.filter(c => c.id !== id);
    if (state.currentRound && state.currentRound.customerId === id) state.currentRound = null;
    if (selectedCustomerId === id) selectedCustomerId = null;
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

  // ---------- Round actions ----------

  function startRound(customerId) {
    const customer = findCustomer(customerId);
    if (!customer) return;
    const previousLastPlayedAt = customer.lastPlayedAt;
    customer.lastPlayedAt = Date.now();
    state.currentRound = { customerId, draws: [], wins: [], startedAt: Date.now(), previousLastPlayedAt };
    saveData();
  }

  // Discards the in-progress round without saving anything to History — for
  // when the wrong customer was pulled up by mistake and nothing valid
  // should be recorded. Restores their prior "last played" timestamp too.
  function cancelRound() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    if (customer) customer.lastPlayedAt = state.currentRound.previousLastPlayedAt || null;
    state.currentRound = null;
    saveData();
  }

  function drawBall(num) {
    const errEl = document.getElementById("drawError");
    errEl.hidden = true;
    errEl.classList.remove("is-info");

    if (!state.currentRound) return false;
    if (!Number.isInteger(num) || num < 1 || num > 75) {
      errEl.textContent = "Enter a number between 1 and 75.";
      errEl.hidden = false;
      return false;
    }
    if (state.currentRound.draws.includes(num)) {
      errEl.textContent = `🔁 ${num} was already pulled this round — reroll, draw again.`;
      errEl.classList.add("is-info");
      errEl.hidden = false;
      return false;
    }

    state.currentRound.draws.push(num);
    checkForNewWins();
    saveData();
    return true;
  }

  // Removes one specific drawn ball from the active round (not just the most
  // recent), for correcting a misread/mistyped number without losing the
  // rest of the round. Rechecks win patterns against the remaining draws.
  function removeDrawAt(index) {
    if (!state.currentRound) return;
    if (index < 0 || index >= state.currentRound.draws.length) return;
    state.currentRound.draws.splice(index, 1);
    const customer = findCustomer(state.currentRound.customerId);
    if (customer) {
      const matrix = hitMatrix(customer, drawnSet());
      const patterns = achievedPatterns(matrix);
      state.currentRound.wins = computeTierWins(patterns, state.currentRound.wins);
    }
    saveData();
  }

  function undoLastDraw() {
    if (!state.currentRound || state.currentRound.draws.length === 0) return;
    removeDrawAt(state.currentRound.draws.length - 1);
  }

  const pendingWinPopups = [];

  function checkForNewWins() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    if (!customer || !cardComplete(customer)) return;
    const matrix = hitMatrix(customer, drawnSet());
    const patterns = achievedPatterns(matrix);
    const newWins = computeTierWins(patterns, state.currentRound.wins);
    newWins.forEach(w => {
      if (!state.currentRound.wins.includes(w)) {
        pendingWinPopups.push({ customerName: customer.name, ...w });
      }
    });
    state.currentRound.wins = newWins;
  }

  function endRound() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    state.history.unshift({
      id: uid(),
      customerId: state.currentRound.customerId,
      customerName: customer ? customer.name : "(removed customer)",
      startedAt: state.currentRound.startedAt,
      endedAt: Date.now(),
      draws: state.currentRound.draws.slice(),
      card: customer ? JSON.parse(JSON.stringify(customer.card)) : null,
      wins: state.currentRound.wins.slice(),
      redeemed: false,
      redeemedAt: null
    });
    state.currentRound = null;
    selectedCustomerId = null;
    saveData();
  }

  // Redemption covers everything the round has won, all at once — a
  // customer can redeem at any point, and the certificate always reflects
  // their current running total (see certificateInfo).
  function confirmRedemption(roundId) {
    const round = state.history.find(r => r.id === roundId);
    if (!round) return;
    round.redeemed = true;
    round.redeemedAt = Date.now();
    saveData();
    selectedCustomerId = round.customerId;
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

  // ---------- Rendering ----------

  function render() {
    renderPlayRoundTab();
    renderRoster();
    renderHistory();
    processWinPopupQueue();
  }

  function renderPlayRoundTab() {
    const picker = document.getElementById("customerPicker");
    const panel = document.getElementById("customerPanel");
    const active = document.getElementById("activeRound");

    if (state.currentRound) {
      picker.hidden = true;
      panel.hidden = true;
      active.hidden = false;
      renderActiveRound();
      return;
    }
    active.hidden = true;

    if (selectedCustomerId && findCustomer(selectedCustomerId)) {
      picker.hidden = true;
      panel.hidden = false;
      renderCustomerPanel();
      return;
    }
    selectedCustomerId = null;
    picker.hidden = false;
    panel.hidden = true;
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function renderCustomerPanel() {
    const customer = findCustomer(selectedCustomerId);
    document.getElementById("selectedCustomerName").textContent = customer.name;

    const alertEl = document.getElementById("weeklyAlert");
    if (playedThisWeek(customer)) {
      alertEl.textContent = `⚠️ ${customer.name} already played this week — last played ${formatDate(customer.lastPlayedAt)}.`;
      alertEl.hidden = false;
    } else {
      alertEl.hidden = true;
    }

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
            alert(`${col} column must be ${min}-${max}.`);
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

  function renderActiveRound() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    if (!customer) { state.currentRound = null; saveData(); render(); return; }

    document.getElementById("activeCustomerName").textContent = customer.name;
    const count = state.currentRound.draws.length;
    document.getElementById("drawProgress").textContent =
      count === 1 ? "1 ball drawn" : `${count} balls drawn`;

    const chipsWrap = document.getElementById("drawnBalls");
    chipsWrap.innerHTML = "";
    if (count === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "ball-chip empty-slot";
      placeholder.textContent = "–";
      chipsWrap.appendChild(placeholder);
    } else {
      state.currentRound.draws.forEach((num, i) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ball-chip removable";
        chip.title = "Click to remove this ball";
        chip.innerHTML = `${num}<span class="ball-chip-x">&times;</span>`;
        chip.addEventListener("click", () => {
          removeDrawAt(i);
          render();
        });
        chipsWrap.appendChild(chip);
      });
    }

    // 75 is the natural ceiling (every number already called) — the
    // duplicate-draw check makes this practically self-limiting anyway.
    const roundFull = count >= 75;
    document.getElementById("drawInput").disabled = roundFull;
    document.querySelector("#drawForm button[type=submit]").disabled = roundFull;

    const winsWrap = document.getElementById("roundWinsWrap");
    const winsList = document.getElementById("roundWinsList");
    winsList.innerHTML = "";
    winsWrap.hidden = state.currentRound.wins.length === 0;
    state.currentRound.wins.forEach(w => {
      const row = document.createElement("div");
      row.className = "round-win-row";
      row.textContent = `🏆 ${w.label} — $${w.prize} RACCASH`;
      winsList.appendChild(row);
    });

    renderReadOnlyGrid(document.getElementById("activeRoundGrid"), customer, drawnSet());
  }

  // ---------- Customer search ----------

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
      if (playedThisWeek(c)) {
        const badge = document.createElement("span");
        badge.className = "search-badge";
        badge.textContent = "Played this week";
        row.appendChild(badge);
      }
      row.addEventListener("click", () => {
        selectedCustomerId = c.id;
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
      addRow.addEventListener("click", () => {
        const customer = addCustomer(trimmed);
        selectedCustomerId = customer.id;
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
        if (confirm(`Remove ${customer.name} from the roster? This cannot be undone.`)) {
          removeCustomer(customer.id);
          render();
        }
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

      const pending = pendingRewardsFor(customer.id);
      const badge = node.querySelector(".reward-badge");
      if (pending.length) {
        badge.hidden = false;
        badge.textContent = `🎁 ${pending.length} pending reward${pending.length === 1 ? "" : "s"}`;
      }

      node.querySelector(".play-btn").addEventListener("click", () => {
        selectedCustomerId = customer.id;
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
    if (state.currentRound && state.currentRound.customerId === customer.id) {
      const live = document.createElement("div");
      live.className = "progression-row live";
      live.textContent = `In progress — ${state.currentRound.draws.length} ball${state.currentRound.draws.length === 1 ? "" : "s"} drawn: ${state.currentRound.draws.join(", ") || "none yet"}`;
      progression.appendChild(live);
    }
    if (rounds.length === 0 && !state.currentRound) {
      const none = document.createElement("div");
      none.className = "progression-row empty";
      none.textContent = "No rounds played yet.";
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
    summary.textContent = state.history.length
      ? `Total RACCASH awarded: $${totalAwarded} across ${state.history.length} round${state.history.length === 1 ? "" : "s"}` +
        (totalPending ? ` · $${totalPending} still unredeemed` : "")
      : "";

    state.history.forEach(round => {
      const item = document.createElement("div");
      item.className = "history-item";

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
        printBtn.addEventListener("click", () => printCertificate(round.customerName, round.wins));
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
      if (confirm(`Permanently delete this round for ${round.customerName}? This cannot be undone.`)) {
        deleteRound(round.id);
      }
    });
    panel.appendChild(deleteBtn);

    return panel;
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

  // ---------- Printable certificate ----------

  function voucherHTML(amount, isGrand) {
    return `
      <div class="voucher${isGrand ? " voucher-grand" : ""}">
        ${isGrand ? '<div class="voucher-grand-badge">★ GRAND PRIZE ★</div>' : ""}
        <div class="voucher-corner voucher-corner-tl">$${amount}</div>
        <div class="voucher-corner voucher-corner-tr">$${amount}</div>
        <div class="voucher-brand"><img src="assets/rac-logo.png" alt="RAC" class="voucher-brand-img"></div>
        <div class="voucher-title">RAC CASH</div>
        <div class="voucher-amount">$${amount}</div>
        <div class="voucher-icons">
          <div class="voucher-icon-block">
            <div class="voucher-icon">🛒</div>
            <div class="voucher-icon-label">GOOD TO<br>BRING IN-STORE ONLY</div>
          </div>
          <div class="voucher-icon-block">
            <div class="voucher-icon">🤝</div>
            <div class="voucher-icon-label">REDEEM ON ANY<br>NEW AGREEMENT</div>
          </div>
        </div>
        <div class="voucher-footer">
          <span>$${amount}</span>
          <span>PROMOTIONAL STORE VOUCHER &bull; NOT LEGAL TENDER &bull; IN-STORE USE ONLY</span>
          <span>$${amount}</span>
        </div>
        <div class="voucher-corner voucher-corner-bl">$${amount}</div>
        <div class="voucher-corner voucher-corner-br">$${amount}</div>
      </div>`;
  }

  // Only shown when a certificate covers more than one tier, to make the
  // total transparent (e.g. a $175 grand certificate = $25 + $50 + $100).
  function certBreakdownHTML(breakdown, total) {
    if (breakdown.length <= 1) return "";
    const rows = breakdown.map(w =>
      `<div class="cert-breakdown-row"><span>${escapeHtml(w.label)}</span><span>$${w.prize}</span></div>`
    ).join("");
    return `
      <div class="cert-breakdown">
        ${rows}
        <div class="cert-breakdown-row cert-breakdown-total"><span>TOTAL</span><span>$${total}</span></div>
      </div>`;
  }

  function thankYouMessage(customerName) {
    return `Dear ${escapeHtml(customerName)},<br><br>
      From all of us on the team here at Rent-A-Center — thank you! Nights like our RACBINGO
      drawings are only as good as the customers who show up and play, and we're grateful
      you're one of them. Your continued loyalty and support are what make our store feel like
      a community, not just a business.<br><br>
      We hope you enjoy your reward, and we can't wait to see you at the next drawing.<br><br>
      With appreciation,<br>
      Your Rent-A-Center Team`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // A round has exactly one certificate, reflecting everything the customer
  // has won so far this round — not one certificate per tier. Reaching
  // Blackout means all three tiers are present, so this naturally becomes
  // the $175 grand certificate at that point.
  function printCertificate(customerName, wins) {
    if (!wins || wins.length === 0) return;
    const info = certificateInfo(wins);
    const latestTimestamp = Math.max(...wins.map(w => w.timestamp));
    document.getElementById("certName").textContent = customerName;
    document.getElementById("certSubline").textContent =
      `${info.headline} — ${new Date(latestTimestamp).toLocaleDateString()}`;
    document.getElementById("certVoucher").innerHTML = voucherHTML(info.total, info.isGrand);
    document.getElementById("certBreakdown").innerHTML = certBreakdownHTML(info.breakdown, info.total);
    document.getElementById("certThankYou").innerHTML = thankYouMessage(customerName);
    document.body.classList.add("printing-cert");
    window.print();
  }

  // ---------- Printable bingo card (front/back, 4x6 index card) ----------

  const STORE_ADDRESS = "437 Hepburn St., Williamsport, PA 17701";
  const STORE_PHONE = "(570) 322-4900";

  function cardIdFor(customer) {
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
    const rows = [["Round Started", "Customer", "Balls Drawn", "Milestones Won", "Total Prize", "Redeemed", "Redeemed Date"]];
    state.history.forEach(round => {
      const started = new Date(round.startedAt).toLocaleString();
      const balls = round.draws.join(" ");
      const milestones = round.wins.map(w => w.label).join(" + ");
      rows.push([
        started, round.customerName, balls, milestones, roundTotal(round.wins),
        round.wins.length === 0 ? "" : (round.redeemed ? "Yes" : "No"),
        round.redeemed ? new Date(round.redeemedAt).toLocaleString() : ""
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

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.customers || !parsed.history) {
          throw new Error("File does not look like a RACBINGO backup.");
        }
        if (!confirm("Importing will replace all current data. Continue?")) return;
        state = parsed;
        if (state.currentRound === undefined) state.currentRound = null;
        selectedCustomerId = null;
        saveData();
        render();
      } catch (e) {
        alert("Could not import file: " + e.message);
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

  document.getElementById("changeCustomerBtn").addEventListener("click", () => {
    selectedCustomerId = null;
    render();
  });

  document.getElementById("startRoundBtn").addEventListener("click", () => {
    if (!selectedCustomerId) return;
    const customer = findCustomer(selectedCustomerId);
    if (!customer || !cardComplete(customer)) return;
    startRound(selectedCustomerId);
    render();
  });

  document.getElementById("generateCardBtn").addEventListener("click", () => {
    if (!selectedCustomerId) return;
    const customer = findCustomer(selectedCustomerId);
    if (!customer) return;
    if (cardFilledCount(customer) > 0 && !confirm("This will overwrite the current card numbers. Continue?")) return;
    customer.card = generateRandomCard();
    saveData();
    render();
  });

  document.getElementById("printCardBtn").addEventListener("click", () => {
    if (!selectedCustomerId) return;
    const customer = findCustomer(selectedCustomerId);
    if (!customer || !cardComplete(customer)) return;
    printCard(customer);
  });

  document.getElementById("drawForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("drawInput");
    const num = parseInt(input.value, 10);
    if (drawBall(num)) input.value = "";
    render();
    input.focus();
  });

  document.getElementById("undoDrawBtn").addEventListener("click", () => {
    undoLastDraw();
    render();
  });

  document.getElementById("endRoundBtn").addEventListener("click", () => {
    if (confirm("Submit this round and move to the next customer?")) {
      endRound();
      render();
    }
  });

  document.getElementById("cancelRoundBtn").addEventListener("click", () => {
    if (confirm("Cancel this round without saving anything?")) {
      cancelRound();
      render();
    }
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
    // Print reflects everything won in the round so far, not just this one
    // milestone — fall back to the single win if the round somehow isn't
    // live anymore (e.g. it was already submitted).
    const wins = (state.currentRound && state.currentRound.customerId)
      ? state.currentRound.wins
      : [activeModalWin];
    printCertificate(activeModalWin.customerName, wins);
  });

  render();
})();
