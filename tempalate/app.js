/* =====================================================
   PARKING INTELLIGENT - front-end

   1) Data layer  : fake API stored in localStorage
   2) Helpers     : formatting and tariff calculation
   3) Interface   : DOM rendering and events

   When the Python API is ready, only part 1 changes:
   replace the body of each api function with a fetch() call.
   ===================================================== */


/* =====================================================
   1. DATA LAYER (fake API)
   ===================================================== */

const STORAGE_KEY = "parking-db";

function defaultDb() {
  const places = [];
  for (let i = 1; i <= 8; i++) {
    // status: "free" | "reserved" | "occupied"
    places.push({ id: i, number: "A" + i, status: "free", user: null, since: null });
  }
  return {
    users: [
      { id: 1, username: "admin", password: "admin123", role: "admin" },
      { id: 2, username: "client", password: "client123", role: "client" },
    ],
    places: places,
    tariff: 2,        // TND per hour
    history: [],      // finished parking sessions
    gateLog: [],      // gate events
    nextId: 100,
  };
}

function loadDb() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore and use default */ }
  return defaultDb();
}

function saveDb(db) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function logGate(db, text) {
  db.gateLog.unshift({ time: Date.now(), text: text });
  db.gateLog = db.gateLog.slice(0, 20);
}

const api = {
  /* ----- Connexion sécurisée ----- */
  async login(username, password) {
    const db = loadDb();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (!user) throw new Error("Identifiants incorrects.");
    return { username: user.username, role: user.role };
  },

  /* ----- Places en temps réel ----- */
  async getPlaces() {
    return loadDb().places;
  },

  /* ----- Réservation ----- */
  async reserve(placeId, username) {
    const db = loadDb();
    if (db.places.some(p => p.user === username)) {
      throw new Error("Vous avez déjà une place réservée ou occupée.");
    }
    const place = db.places.find(p => p.id === placeId);
    if (!place || place.status !== "free") throw new Error("Cette place n'est plus libre.");
    place.status = "reserved";
    place.user = username;
    saveDb(db);
  },

  async cancelReservation(placeId, username) {
    const db = loadDb();
    const place = db.places.find(p => p.id === placeId);
    if (place && place.status === "reserved" && place.user === username) {
      place.status = "free";
      place.user = null;
      saveDb(db);
    }
  },

  /* ----- Capteur simulé (le vrai capteur Arduino enverra ça au serveur) -----
     Retourne l'enregistrement d'historique si c'est une sortie, sinon null. */
  async toggleSensor(placeId) {
    const db = loadDb();
    const place = db.places.find(p => p.id === placeId);
    if (!place) return null;

    let record = null;
    if (place.status === "occupied") {
      // Sortie : calcul de la durée et du tarif
      const end = Date.now();
      const duration = end - place.since;
      record = {
        id: db.nextId++,
        place: place.number,
        user: place.user,
        start: place.since,
        end: end,
        duration: duration,
        cost: computeCost(duration, db.tariff),
      };
      db.history.unshift(record);
      logGate(db, "Sortie : place " + place.number + " libérée (" + place.user + ")");
      place.status = "free";
      place.user = null;
      place.since = null;
    } else {
      // Entrée détectée (place libre ou réservée)
      if (place.status === "free") place.user = "invité";
      place.status = "occupied";
      place.since = Date.now();
      logGate(db, "Entrée détectée : place " + place.number);
    }
    saveDb(db);
    return record;
  },

  /* ----- Tarif ----- */
  async getTariff() {
    return loadDb().tariff;
  },

  async setTariff(value) {
    const db = loadDb();
    db.tariff = value;
    saveDb(db);
  },

  /* ----- Gestion des places (admin) ----- */
  async addPlace(number) {
    const db = loadDb();
    if (db.places.some(p => p.number.toLowerCase() === number.toLowerCase())) {
      throw new Error("Ce numéro de place existe déjà.");
    }
    db.places.push({ id: db.nextId++, number: number, status: "free", user: null, since: null });
    saveDb(db);
  },

  async deletePlace(id) {
    const db = loadDb();
    const place = db.places.find(p => p.id === id);
    if (place && place.status !== "free") throw new Error("Impossible : la place n'est pas libre.");
    db.places = db.places.filter(p => p.id !== id);
    saveDb(db);
  },

  /* ----- Gestion des utilisateurs (admin) ----- */
  async getUsers() {
    return loadDb().users;
  },

  async addUser(username, password, role) {
    const db = loadDb();
    if (db.users.some(u => u.username === username)) throw new Error("Ce nom existe déjà.");
    db.users.push({ id: db.nextId++, username: username, password: password, role: role });
    saveDb(db);
  },

  async deleteUser(id) {
    const db = loadDb();
    db.users = db.users.filter(u => u.id !== id);
    saveDb(db);
  },

  /* ----- Historique ----- */
  async getHistory() {
    return loadDb().history;
  },

  /* ----- Barrière ----- */
  async getGateLog() {
    return loadDb().gateLog;
  },

  // Une voiture arrive à l'entrée : le serveur répond ouvrir (true) ou refuser (false)
  async requestEntry(withReservation) {
    const db = loadDb();
    const free = db.places.filter(p => p.status === "free").length;
    const reserved = db.places.filter(p => p.status === "reserved").length;
    const allowed = withReservation ? reserved > 0 : free > 0;

    if (allowed) {
      logGate(db, "Entrée autorisée : barrière ouverte");
    } else if (withReservation) {
      logGate(db, "Entrée refusée : aucune réservation");
    } else {
      logGate(db, "Entrée refusée : parking complet");
    }
    saveDb(db);
    return allowed;
  },

  async openGateManually() {
    const db = loadDb();
    logGate(db, "Ouverture manuelle par l'administrateur");
    saveDb(db);
  },
};


/* =====================================================
   2. HELPERS
   ===================================================== */

const STATUS_LABELS = { free: "Libre", reserved: "Réservée", occupied: "Occupée" };

// Tarif = durée en heures x prix par heure
function computeCost(durationMs, tariffPerHour) {
  return (durationMs / 3600000) * tariffPerHour;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return h + ":" + m + ":" + s;
}

function formatMoney(amount) {
  return amount.toFixed(3) + " TND";
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("fr-FR");
}

// Avoid injecting HTML from user-typed text
function esc(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text).replace(/[&<>"']/g, c => map[c]);
}

function $(id) {
  return document.getElementById(id);
}


/* =====================================================
   3. INTERFACE
   ===================================================== */

let currentUser = null;
let currentView = "places";
let gateOpen = false;
let gateTimer = null;

const MENUS = {
  client: [["places", "Places"], ["session", "Ma place"]],
  admin: [
    ["places", "Places"],
    ["manage", "Gestion"],
    ["users", "Utilisateurs"],
    ["history", "Historique"],
    ["gate", "Barrière"],
  ],
};

const RENDERERS = {
  places: renderPlaces,
  session: renderSession,
  manage: renderManage,
  users: renderUsers,
  history: renderHistory,
  gate: renderGate,
};

/* ----- Login / logout ----- */

$("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  try {
    const user = await api.login($("login-user").value.trim(), $("login-pass").value);
    $("login-error").textContent = "";
    startApp(user);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout-btn").addEventListener("click", function () {
  sessionStorage.removeItem("parking-user");
  currentUser = null;
  $("app").hidden = true;
  $("login-view").hidden = false;
  $("login-form").reset();
});

function startApp(user) {
  currentUser = user;
  sessionStorage.setItem("parking-user", JSON.stringify(user));
  $("login-view").hidden = true;
  $("app").hidden = false;
  $("user-label").textContent =
    user.username + " (" + (user.role === "admin" ? "administrateur" : "client") + ")";
  buildNav();
  showView("places");
}

/* ----- Navigation ----- */

function buildNav() {
  const nav = $("nav");
  nav.innerHTML = "";
  MENUS[currentUser.role].forEach(function (item) {
    const btn = document.createElement("button");
    btn.dataset.view = item[0];
    btn.textContent = item[1];
    nav.appendChild(btn);
  });
}

$("nav").addEventListener("click", function (e) {
  const btn = e.target.closest("button[data-view]");
  if (btn) showView(btn.dataset.view);
});

function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach(function (v) {
    v.hidden = v.id !== "view-" + name;
  });
  document.querySelectorAll("#nav button").forEach(function (b) {
    b.classList.toggle("active", b.dataset.view === name);
  });
  refreshView();
}

function refreshView() {
  if (currentUser) RENDERERS[currentView]();
}

/* ----- Places en temps réel ----- */

async function renderPlaces() {
  const places = await api.getPlaces();
  const count = function (status) {
    return places.filter(p => p.status === status).length;
  };

  $("counters").innerHTML =
    '<div class="counter free"><strong>' + count("free") + "</strong>Libres</div>" +
    '<div class="counter reserved"><strong>' + count("reserved") + "</strong>Réservées</div>" +
    '<div class="counter occupied"><strong>' + count("occupied") + "</strong>Occupées</div>" +
    '<div class="counter"><strong>' + places.length + "</strong>Total</div>";

  $("places-help").textContent = currentUser.role === "admin"
    ? "Mode démo : le bouton « Simuler capteur » remplace le capteur Arduino."
    : "Cliquez sur « Réserver » pour réserver une place libre.";

  const grid = $("places-grid");
  grid.innerHTML = "";

  places.forEach(function (p) {
    const card = document.createElement("div");
    card.className = "place " + p.status;

    let label = STATUS_LABELS[p.status];
    if (p.status === "reserved" && p.user === currentUser.username) label += " (vous)";

    let button = "";
    if (currentUser.role === "admin") {
      button = '<button class="secondary" data-action="sensor" data-id="' + p.id + '">Simuler capteur</button>';
    } else if (p.status === "free") {
      button = '<button data-action="reserve" data-id="' + p.id + '">Réserver</button>';
    } else if (p.status === "reserved" && p.user === currentUser.username) {
      button = '<button class="danger" data-action="cancel" data-id="' + p.id + '">Annuler</button>';
    }

    card.innerHTML = "<h3>" + esc(p.number) + "</h3><p>" + label + "</p>" + button;
    grid.appendChild(card);
  });
}

$("places-grid").addEventListener("click", async function (e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);

  try {
    if (btn.dataset.action === "reserve") {
      await api.reserve(id, currentUser.username);
    } else if (btn.dataset.action === "cancel") {
      await api.cancelReservation(id, currentUser.username);
    } else if (btn.dataset.action === "sensor") {
      const record = await api.toggleSensor(id);
      if (record) {
        alert(
          "Sortie de " + record.user + "\nDurée : " + formatDuration(record.duration) +
          "\nÀ payer : " + formatMoney(record.cost)
        );
        openGateUI(); // la barrière de sortie s'ouvre
      }
    }
  } catch (err) {
    alert(err.message);
  }
  renderPlaces();
});

/* ----- Ma place (client) : réservation, durée, tarif ----- */

function historyTable(rows, showUser) {
  if (rows.length === 0) return '<p class="hint">Aucun stationnement enregistré.</p>';

  let html = "<table><tr><th>Place</th>" + (showUser ? "<th>Client</th>" : "") +
    "<th>Entrée</th><th>Sortie</th><th>Durée</th><th>Montant</th></tr>";

  rows.forEach(function (h) {
    html += "<tr><td>" + esc(h.place) + "</td>" +
      (showUser ? "<td>" + esc(h.user) + "</td>" : "") +
      "<td>" + formatDate(h.start) + "</td>" +
      "<td>" + formatDate(h.end) + "</td>" +
      "<td>" + formatDuration(h.duration) + "</td>" +
      "<td>" + formatMoney(h.cost) + "</td></tr>";
  });
  return html + "</table>";
}

async function renderSession() {
  const places = await api.getPlaces();
  const tariff = await api.getTariff();
  const mine = places.find(p => p.user === currentUser.username);
  const history = (await api.getHistory()).filter(h => h.user === currentUser.username);

  let html = "<h2>Ma place</h2>";

  if (!mine) {
    html += "<p>Aucune réservation ni stationnement en cours.</p>";
  } else if (mine.status === "reserved") {
    html += "<p>La place <strong>" + esc(mine.number) + "</strong> est réservée pour vous.</p>" +
      '<button class="danger" data-action="cancel" data-id="' + mine.id + '">Annuler la réservation</button>';
  } else {
    html += "<p>Vous êtes garé à la place <strong>" + esc(mine.number) +
      "</strong> depuis " + formatDate(mine.since) + ".</p>" +
      '<p>Durée : <strong id="live-duration" data-since="' + mine.since +
      '" data-tariff="' + tariff + '"></strong></p>' +
      '<p>Montant actuel : <strong id="live-cost"></strong></p>' +
      '<p class="hint">Tarif : ' + formatMoney(tariff) + " / heure</p>";
  }

  html += "<h3>Mes stationnements</h3>" + historyTable(history, false);
  $("session-box").innerHTML = html;
  tickSession();
}

// Updates the live timer every second without redrawing the whole box
function tickSession() {
  const duration = $("live-duration");
  if (!duration) return;
  const ms = Date.now() - Number(duration.dataset.since);
  duration.textContent = formatDuration(ms);
  $("live-cost").textContent = formatMoney(computeCost(ms, Number(duration.dataset.tariff)));
}
setInterval(tickSession, 1000);

$("session-box").addEventListener("click", async function (e) {
  const btn = e.target.closest("button[data-action='cancel']");
  if (!btn) return;
  await api.cancelReservation(Number(btn.dataset.id), currentUser.username);
  renderSession();
});

/* ----- Gestion des places et du tarif (admin) ----- */

async function renderManage() {
  $("tariff-input").value = await api.getTariff();

  const places = await api.getPlaces();
  let html = "<table><tr><th>Place</th><th>État</th><th></th></tr>";
  places.forEach(function (p) {
    html += "<tr><td>" + esc(p.number) + "</td><td>" + STATUS_LABELS[p.status] + "</td><td>" +
      '<button class="danger" data-id="' + p.id + '"' + (p.status !== "free" ? " disabled" : "") +
      ">Supprimer</button></td></tr>";
  });
  $("places-table").innerHTML = html + "</table>";
}

$("tariff-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  await api.setTariff(Number($("tariff-input").value));
  alert("Tarif enregistré.");
});

$("place-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  try {
    await api.addPlace($("place-input").value.trim());
    $("place-form").reset();
  } catch (err) {
    alert(err.message);
  }
  renderManage();
});

$("places-table").addEventListener("click", async function (e) {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  try {
    await api.deletePlace(Number(btn.dataset.id));
  } catch (err) {
    alert(err.message);
  }
  renderManage();
});

/* ----- Gestion des utilisateurs (admin) ----- */

async function renderUsers() {
  const users = await api.getUsers();
  let html = "<table><tr><th>Nom</th><th>Rôle</th><th></th></tr>";
  users.forEach(function (u) {
    const isMe = u.username === currentUser.username;
    html += "<tr><td>" + esc(u.username) + "</td><td>" + esc(u.role) + "</td><td>" +
      '<button class="danger" data-id="' + u.id + '"' + (isMe ? " disabled" : "") +
      ">Supprimer</button></td></tr>";
  });
  $("users-table").innerHTML = html + "</table>";
}

$("user-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  try {
    await api.addUser($("user-name").value.trim(), $("user-pass").value, $("user-role").value);
    $("user-form").reset();
  } catch (err) {
    alert(err.message);
  }
  renderUsers();
});

$("users-table").addEventListener("click", async function (e) {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;
  await api.deleteUser(Number(btn.dataset.id));
  renderUsers();
});

/* ----- Historique et statistiques (admin) ----- */

async function renderHistory() {
  const rows = await api.getHistory();
  const revenue = rows.reduce((sum, h) => sum + h.cost, 0);
  const avg = rows.length ? rows.reduce((sum, h) => sum + h.duration, 0) / rows.length : 0;

  $("stats").innerHTML =
    '<div class="counter"><strong>' + rows.length + "</strong>Stationnements</div>" +
    '<div class="counter"><strong>' + formatMoney(revenue) + "</strong>Recette totale</div>" +
    '<div class="counter"><strong>' + formatDuration(avg) + "</strong>Durée moyenne</div>";

  $("history-table").innerHTML = historyTable(rows, true);
}

/* ----- Barrière (admin) ----- */

function openGateUI() {
  gateOpen = true;
  clearTimeout(gateTimer);
  gateTimer = setTimeout(function () {
    gateOpen = false;       // fermeture automatique après 3 secondes
    refreshView();
  }, 3000);
  refreshView();
}

async function renderGate() {
  const state = $("gate-state");
  state.textContent = gateOpen ? "OUVERTE" : "FERMÉE";
  state.className = "badge " + (gateOpen ? "open" : "closed");

  const log = await api.getGateLog();
  $("gate-log").innerHTML = log.length === 0
    ? '<li class="hint">Aucun évènement.</li>'
    : log.map(e => "<li><time>" + new Date(e.time).toLocaleTimeString("fr-FR") + "</time>" + esc(e.text) + "</li>").join("");
}

$("gate-manual").addEventListener("click", async function () {
  await api.openGateManually();
  $("gate-message").textContent = "Barrière ouverte manuellement.";
  openGateUI();
});

async function simulateCar(withReservation) {
  const allowed = await api.requestEntry(withReservation);
  if (allowed) {
    $("gate-message").textContent = "Voiture détectée : entrée autorisée.";
    openGateUI();
  } else {
    $("gate-message").textContent = withReservation
      ? "Voiture détectée : refusée (aucune réservation)."
      : "Voiture détectée : refusée (parking complet). LED rouge allumée.";
    refreshView();
  }
}

$("gate-car-free").addEventListener("click", () => simulateCar(false));
$("gate-car-res").addEventListener("click", () => simulateCar(true));

/* ----- Temps réel ----- */

// Refresh the live views every 2 seconds (not the forms, so typing is never lost)
setInterval(function () {
  if (["places", "session", "history", "gate"].includes(currentView)) refreshView();
}, 2000);

// Two browser tabs stay in sync (e.g. admin tab + client tab)
window.addEventListener("storage", function () {
  if (["places", "session", "history", "gate"].includes(currentView)) refreshView();
});

/* ----- Restore session after page refresh ----- */

const savedUser = sessionStorage.getItem("parking-user");
if (savedUser) startApp(JSON.parse(savedUser));