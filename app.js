(() => {
  "use strict";

  const STORAGE_KEY = "racbingo_data_v2";
  const COLUMNS = ["B", "I", "N", "G", "O"];
  const COLUMN_RANGES = { B: [1, 15], I: [16, 30], N: [31, 45], G: [46, 60], O: [61, 75] };
  const FREE = "FREE";
  const BALLS_PER_ROUND = 5;

  const PRIZES = { LINE: 25, CORNERS: 75, BLACKOUT: 100 };

  function tierFor(pattern) {
    if (pattern === "Four Corners") return { prize: PRIZES.CORNERS, label: "Four Corners" };
    if (pattern === "Blackout") return { prize: PRIZES.BLACKOUT, label: "Full BINGO" };
    return { prize: PRIZES.LINE, label: pattern };
  }

  // ---------- Persistence ----------

  function defaultData() {
    return {
      customers: [],
      currentRound: null, // { customerId, draws: [], wins: [], startedAt }
      history: []
    };
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

  // ---------- Customer CRUD ----------

  function addCustomer(name) {
    const customer = { id: uid(), name: name.trim(), card: emptyCard() };
    state.customers.push(customer);
    saveData();
    return customer;
  }

  function removeCustomer(id) {
    state.customers = state.customers.filter(c => c.id !== id);
    if (state.currentRound && state.currentRound.customerId === id) {
      state.currentRound = null;
    }
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
        const win = { pattern, prize: tier.prize, label: tier.label, timestamp: Date.now() };
        state.currentRound.wins.push(win);
        pendingWinPopups.push({ customerName: customer.name, ...win });
      }
    });
  }

  function endRound() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    state.history.unshift({
      customerId: state.currentRound.customerId,
      customerName: customer ? customer.name : "(removed customer)",
      startedAt: state.currentRound.startedAt,
      endedAt: Date.now(),
      draws: state.currentRound.draws.slice(),
      wins: state.currentRound.wins.slice()
    });
    state.currentRound = null;
    saveData();
  }

  // ---------- Rendering ----------

  function render() {
    renderRoundPicker();
    renderActiveRound();
    renderRoster();
    renderHistory();
    processWinPopupQueue();
  }

  function renderRoundPicker() {
    const picker = document.getElementById("roundPicker");
    const active = document.getElementById("activeRound");
    if (state.currentRound) {
      picker.hidden = true;
      active.hidden = false;
      return;
    }
    picker.hidden = false;
    active.hidden = true;

    const select = document.getElementById("roundCustomerSelect");
    const eligible = state.customers.filter(cardComplete);
    select.innerHTML = "";
    eligible.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      select.appendChild(opt);
    });

    const noneMsg = document.getElementById("noCustomersForRound");
    const hasEligible = eligible.length > 0;
    noneMsg.hidden = hasEligible;
    select.hidden = !hasEligible;
    document.getElementById("startRoundBtn").hidden = !hasEligible;
  }

  function renderActiveRound() {
    if (!state.currentRound) return;
    const customer = findCustomer(state.currentRound.customerId);
    if (!customer) { state.currentRound = null; saveData(); render(); return; }

    document.getElementById("activeCustomerName").textContent = customer.name;
    document.getElementById("drawProgress").textContent =
      `${state.currentRound.draws.length} of ${BALLS_PER_ROUND} balls drawn`;

    const drawn = drawnSet();
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

    const grid = document.getElementById("activeRoundGrid");
    buildMiniGrid(grid, customer, { editable: false, drawn });
  }

  function buildMiniGrid(container, customer, { editable, drawn }) {
    container.innerHTML = "";
    const matrix = editable ? null : hitMatrix(customer, drawn || new Set());

    COLUMNS.forEach(col => {
      const h = document.createElement("div");
      h.className = "cell-header";
      h.textContent = col;
      container.appendChild(h);
    });

    for (let row = 0; row < 5; row++) {
      COLUMNS.forEach((col, colIdx) => {
        const value = customer.card[col][row];
        if (editable) {
          if (value === FREE) {
            const cell = document.createElement("div");
            cell.className = "cell free";
            cell.textContent = "FREE";
            container.appendChild(cell);
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
          container.appendChild(input);
        } else {
          const cell = document.createElement("div");
          const isHit = matrix[row][colIdx];
          cell.className = "cell" + (value === FREE ? " free" : isHit ? " hit" : "");
          cell.textContent = value === FREE ? "FREE" : (value === null ? "–" : value);
          container.appendChild(cell);
        }
      });
    }
  }

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

      const removeBtn = node.querySelector(".btn-remove");
      removeBtn.addEventListener("click", () => {
        if (confirm(`Remove ${customer.name} from the roster? This cannot be undone.`)) {
          removeCustomer(customer.id);
          render();
        }
      });

      const status = node.querySelector(".card-status");
      const filled = cardFilledCount(customer);
      if (filled === 24) {
        status.textContent = "Card complete ✓";
        status.classList.add("complete");
      } else {
        status.textContent = `${filled}/24 numbers filled`;
      }

      const miniGrid = node.querySelector(".mini-grid");
      buildMiniGrid(miniGrid, customer, { editable: true });

      list.appendChild(node);
    });
  }

  function renderHistory() {
    const list = document.getElementById("historyList");
    const empty = document.getElementById("noHistory");
    const summary = document.getElementById("historySummary");
    list.innerHTML = "";
    empty.hidden = state.history.length !== 0;

    let totalPaid = 0;
    state.history.forEach(round => round.wins.forEach(w => { totalPaid += w.prize; }));
    summary.textContent = state.history.length
      ? `Total RACCASH awarded: $${totalPaid} across ${state.history.length} round${state.history.length === 1 ? "" : "s"}`
      : "";

    state.history.forEach(round => {
      const item = document.createElement("div");
      item.className = "history-item";
      const date = new Date(round.startedAt);
      const h4 = document.createElement("h4");
      h4.textContent = `${round.customerName} — ${date.toLocaleString()}`;
      item.appendChild(h4);

      const meta = document.createElement("div");
      meta.textContent = `Balls drawn: ${round.draws.join(", ") || "none"}`;
      item.appendChild(meta);

      const winnersDiv = document.createElement("div");
      if (round.wins.length) {
        winnersDiv.className = "winners";
        winnersDiv.textContent = round.wins
          .map(w => `${w.label} — $${w.prize}`)
          .join(" · ");
      } else {
        winnersDiv.className = "no-winners";
        winnersDiv.textContent = "No win this round.";
      }
      item.appendChild(winnersDiv);

      list.appendChild(item);
    });
  }

  // ---------- Win celebration ----------

  let popupActive = false;

  function processWinPopupQueue() {
    if (popupActive || pendingWinPopups.length === 0) return;
    const win = pendingWinPopups.shift();
    showWinModal(win);
  }

  function showWinModal(win) {
    popupActive = true;
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

  // ---------- Export / Import ----------

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    downloadBlob(blob, `racbingo-backup-${Date.now()}.json`);
  }

  function exportCsv() {
    const rows = [["Round Started", "Customer", "Balls Drawn", "Pattern", "Prize"]];
    state.history.forEach(round => {
      const started = new Date(round.startedAt).toLocaleString();
      const balls = round.draws.join(" ");
      if (round.wins.length === 0) {
        rows.push([started, round.customerName, balls, "", ""]);
      } else {
        round.wins.forEach(w => {
          rows.push([started, round.customerName, balls, w.label, w.prize]);
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
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });

  document.getElementById("startRoundBtn").addEventListener("click", () => {
    const select = document.getElementById("roundCustomerSelect");
    const hint = document.getElementById("roundPickerHint");
    hint.hidden = true;
    if (!select.value) return;
    startRound(select.value);
    render();
  });

  document.getElementById("drawForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("drawInput");
    const num = parseInt(input.value, 10);
    if (drawBall(num)) {
      input.value = "";
    }
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

  document.getElementById("addCustomerForm").addEventListener("submit", e => {
    e.preventDefault();
    const input = document.getElementById("newCustomerName");
    if (!input.value.trim()) return;
    addCustomer(input.value);
    input.value = "";
    render();
    input.focus();
  });

  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("importInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = "";
  });

  document.getElementById("winModalAckBtn").addEventListener("click", dismissWinModal);

  render();
})();
