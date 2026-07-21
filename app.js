(() => {
  "use strict";

  const STORAGE_KEY = "racbingo_data_v3";
  const COLUMNS = ["B", "I", "N", "G", "O"];
  const COLUMN_RANGES = { B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75] };
  const FREE = "FREE";
  const BALLS_PER_ROUND = 5;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const PRIZES = { LINE: 25, CORNERS: 75, BLACKOUT: 100 };

  function tierFor(pattern) {
    if (pattern === "Four Corners") return { prize: PRIZES.CORNERS, label: "Four Corners" };
    if (pattern === "Blackout") return { prize: PRIZES.BLACKOUT, label: "Full BINGO" };
    return { prize: PRIZES.LINE, label: pattern };
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

  function pendingRewardsFor(customerId) {
    const wins = [];
    state.history.forEach(round => {
      if (round.customerId !== customerId) return;
      round.wins.forEach(w => { if (!w.redeemed) wins.push(w); });
    });
    return wins;
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
    customer.lastPlayedAt = Date.now();
    state.currentRound = { customerId, draws: [], wins: [], startedAt: Date.now() };
    saveData();
  }

  function drawBall(num) {
    const errEl = document.getElementById("drawError");
    errEl.hidden = true;
    errEl.classList.remove("is-info");

    if (!state.currentRound) return false;
    if (state.currentRound.draws.length >= BALLS_PER_ROUND) {
      errEl.textContent = `All ${BALLS_PER_ROUND} balls drawn for this round. Click "End Round" to continue.`;
      errEl.hidden = false;
      return false;
    }
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

  function undoLastDraw() {
    if (!state.currentRound || state.currentRound.draws.length === 0) return;
    state.currentRound.draws.pop();
    const customer = findCustomer(state.currentRound.customerId);
    if (customer) {
      const matrix = hitMatrix(customer, drawnSet());
      const stillValid = achievedPatterns(matrix);
      state.currentRound.wins = state.currentRound.wins.filter(w => stillValid.includes(w.pattern));
    }
    saveData();
  }

  const pendingWinPopups = [];

  function checkForNewWins() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    if (!customer || !cardComplete(customer)) return;
    const matrix = hitMatrix(customer, drawnSet());
    const patterns = achievedPatterns(matrix);
    patterns.forEach(pattern => {
      const already = state.currentRound.wins.some(w => w.pattern === pattern);
      if (!already) {
        const tier = tierFor(pattern);
        const win = { pattern, prize: tier.prize, label: tier.label, timestamp: Date.now(), redeemed: false, redeemedAt: null };
        state.currentRound.wins.push(win);
        pendingWinPopups.push({ customerName: customer.name, ...win });
      }
    });
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
      wins: state.currentRound.wins.slice()
    });
    state.currentRound = null;
    selectedCustomerId = null;
    saveData();
  }

  function confirmRedemption(roundId, winIndex) {
    const round = state.history.find(r => r.id === roundId);
    if (!round) return;
    const win = round.wins[winIndex];
    if (!win) return;
    win.redeemed = true;
    win.redeemedAt = Date.now();
    saveData();
    selectedCustomerId = round.customerId;
    switchTab("game");
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
    document.getElementById("drawProgress").textContent =
      `${state.currentRound.draws.length} of ${BALLS_PER_ROUND} balls drawn`;

    const chipsWrap = document.getElementById("drawnBalls");
    chipsWrap.innerHTML = "";
    for (let i = 0; i < BALLS_PER_ROUND; i++) {
      const chip = document.createElement("div");
      const num = state.currentRound.draws[i];
      if (num !== undefined) {
        chip.className = "ball-chip";
        chip.textContent = num;
      } else {
        chip.className = "ball-chip empty-slot";
        chip.textContent = "–";
      }
      chipsWrap.appendChild(chip);
    }

    const drawInput = document.getElementById("drawInput");
    const roundFull = state.currentRound.draws.length >= BALLS_PER_ROUND;
    drawInput.disabled = roundFull;
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

      list.appendChild(node);
    });
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
    state.history.forEach(round => round.wins.forEach(w => {
      totalAwarded += w.prize;
      if (!w.redeemed) totalPending += w.prize;
    }));
    summary.textContent = state.history.length
      ? `Total RACCASH awarded: $${totalAwarded} across ${state.history.length} round${state.history.length === 1 ? "" : "s"}` +
        (totalPending ? ` · $${totalPending} still unredeemed` : "")
      : "";

    state.history.forEach(round => {
      const item = document.createElement("div");
      item.className = "history-item";

      const h4 = document.createElement("h4");
      h4.textContent = `${round.customerName} — ${new Date(round.startedAt).toLocaleString()}`;
      item.appendChild(h4);

      const meta = document.createElement("div");
      meta.className = "meta-line";
      meta.textContent = `Balls drawn: ${round.draws.join(", ") || "none"}`;
      item.appendChild(meta);

      if (round.wins.length === 0) {
        const none = document.createElement("div");
        none.className = "no-winners";
        none.textContent = "No win this round.";
        item.appendChild(none);
      } else {
        round.wins.forEach((win, idx) => {
          const row = document.createElement("div");
          row.className = "win-row";

          const label = document.createElement("span");
          label.className = "win-row-label";
          label.textContent = `🏆 ${win.label} — $${win.prize}`;
          row.appendChild(label);

          const actions = document.createElement("span");
          actions.className = "win-row-actions";

          const printBtn = document.createElement("button");
          printBtn.type = "button";
          printBtn.className = "btn btn-ghost btn-sm";
          printBtn.textContent = "Print Certificate 🖨";
          printBtn.addEventListener("click", () => printCertificate(round.customerName, win));
          actions.appendChild(printBtn);

          if (win.redeemed) {
            const tag = document.createElement("span");
            tag.className = "redeemed-tag";
            tag.textContent = `Redeemed ${formatDate(win.redeemedAt)}`;
            actions.appendChild(tag);
          } else {
            const redeemBtn = document.createElement("button");
            redeemBtn.type = "button";
            redeemBtn.className = "btn btn-primary btn-sm";
            redeemBtn.textContent = "Confirm Redemption & New Card";
            redeemBtn.addEventListener("click", () => confirmRedemption(round.id, idx));
            actions.appendChild(redeemBtn);
          }

          row.appendChild(actions);
          item.appendChild(row);
        });
      }

      list.appendChild(item);
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

  // ---------- Printable certificate ----------

  function voucherHTML(amount) {
    return `
      <div class="voucher">
        <div class="voucher-corner voucher-corner-tl">$${amount}</div>
        <div class="voucher-corner voucher-corner-tr">$${amount}</div>
        <div class="voucher-brand">RAC</div>
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

  function printCertificate(customerName, win) {
    document.getElementById("certName").textContent = customerName;
    document.getElementById("certSubline").textContent =
      `${win.label} win — ${new Date(win.timestamp).toLocaleDateString()}`;
    document.getElementById("certVoucher").innerHTML = voucherHTML(win.prize);
    document.getElementById("certThankYou").innerHTML = thankYouMessage(customerName);
    document.body.classList.add("printing-cert");
    window.print();
  }

  // ---------- Printable bingo card (front/back, 4x6 index card) ----------

  function cardGridHTML(customer) {
    let html = "";
    COLUMNS.forEach(col => { html += `<div class="col-header">${col}</div>`; });
    for (let row = 0; row < 5; row++) {
      COLUMNS.forEach(col => {
        const value = customer.card[col][row];
        if (value === FREE) {
          html += `<div class="free-cell">FREE</div>`;
        } else {
          html += `<div class="num-cell">${value === null ? "" : value}</div>`;
        }
      });
    }
    return html;
  }

  function cardFrontHTML(customer) {
    const dateStr = new Date().toLocaleDateString();
    return `
      <div class="card-print-page card-front">
        <div class="card-brand-row">
          <div class="card-brand">RAC <span>BINGO</span></div>
          <div class="card-holder"><strong>${escapeHtml(customer.name)}</strong>${dateStr}</div>
        </div>
        <div class="card-grid">${cardGridHTML(customer)}</div>
      </div>`;
  }

  function cardBackHTML() {
    return `
      <div class="card-print-page card-back">
        <div class="card-brand-row">
          <div class="card-brand">RAC <span>BINGO</span></div>
        </div>
        <h3>How To Win</h3>
        <ul class="card-rules">
          <li><strong>Any Line</strong> (row, column, or diagonal) — $25 RAC Cash</li>
          <li><strong>Four Corners</strong> — $75 RAC Cash</li>
          <li><strong>Full Card (Blackout)</strong> — $100 RAC Cash</li>
        </ul>
        <p class="card-thanks">
          Thanks for playing RACBINGO! We love having you with us — bring this card back each
          week for your next chance to win great RAC Cash rewards.
        </p>
        <p class="card-footer-note">— Your Rent-A-Center Team</p>
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
    const rows = [["Round Started", "Customer", "Balls Drawn", "Pattern", "Prize", "Redeemed", "Redeemed Date"]];
    state.history.forEach(round => {
      const started = new Date(round.startedAt).toLocaleString();
      const balls = round.draws.join(" ");
      if (round.wins.length === 0) {
        rows.push([started, round.customerName, balls, "", "", "", ""]);
      } else {
        round.wins.forEach(w => {
          rows.push([
            started, round.customerName, balls, w.label, w.prize,
            w.redeemed ? "Yes" : "No",
            w.redeemed ? new Date(w.redeemedAt).toLocaleString() : ""
          ]);
        });
      }
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
    if (confirm("End this round and move to the next customer?")) {
      endRound();
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
    if (activeModalWin) printCertificate(activeModalWin.customerName, activeModalWin);
  });

  render();
})();
