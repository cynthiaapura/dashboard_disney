const STORAGE_KEY = "dlp-green-it-kpis-v2";

const STATUS = {
  ok: { label: "Conforme", icon: "🟢", color: "#0ca30c", cls: "good" },
  warn: { label: "Vigilance", icon: "🟠", color: "#d98a00", cls: "warning" },
  alert: { label: "Alerte", icon: "🔴", color: "#d03b3b", cls: "critical" },
};

const SEED_DATA = [
  {
    id: "kpi-obsolescence",
    nom: "Taux d'obsolescence applicative",
    dimension: "Technique",
    formule: "(Nombre d'applications obsolètes / Nombre total d'applications) x 100",
    source: "Inventaire applicatif de la DSI, documentation d'architecture et outils de gestion du parc applicatif",
    frequence: "Trimestrielle",
    seuilAlerte: "25%",
    objectifCible: "< 15%",
    valeurActuelle: "28%",
    sens: "baisse",
    statut: "alert",
    commentaire:
      "Le parc applicatif comprend des solutions vieillissantes (jusqu'à 35 ans). Ce KPI suit l'avancement de la modernisation et est directement lié à la démarche Green IT.",
  },
  {
    id: "kpi-energie",
    nom: "Consommation énergétique du SI",
    dimension: "Métier",
    formule: "Consommation serveurs + équipements réseau + stockage + services cloud (kWh)",
    source: "Outils de supervision énergétique (PDU, monitoring datacenter), données AWS, factures fournisseur d'énergie",
    frequence: "Mensuelle",
    seuilAlerte: "190",
    objectifCible: "165",
    valeurActuelle: "182 MWh/mois",
    sens: "baisse",
    statut: "warn",
    commentaire:
      "Objectif : réduire de 10% la consommation énergétique annuelle du SI grâce à la modernisation applicative et à l'optimisation des ressources. Seuil de vigilance fixé à 190 MWh/mois pour matérialiser la zone entre l'objectif et l'alerte.",
  },
  {
    id: "kpi-donnees-obsoletes",
    nom: "Volume de données obsolètes",
    dimension: "Métier",
    formule: "(Volume de données non consultées/modifiées depuis + de 24 mois / Volume total stocké) x 100",
    source: "Outils de gestion du stockage (on-premise et AWS), logs d'accès, rapports d'audit du cycle de vie de la donnée",
    frequence: "Trimestrielle",
    seuilAlerte: "30%",
    objectifCible: "< 15%",
    valeurActuelle: "34%",
    sens: "baisse",
    statut: "alert",
    commentaire:
      "35 ans de données issues de plus de 12 outils sans référentiel commun : doublons et stockage inutile à réduire (audit + politique de cycle de vie de la donnée).",
  },
  {
    id: "kpi-satisfaction",
    nom: "Satisfaction des Cast Members",
    dimension: "Utilisateur",
    formule: "(Nombre de notes >= 4 / Total des réponses) x 100 — enquête interne notée de 1 à 5",
    source: "Enquête interne via l'intranet CastLife",
    frequence: "Trimestrielle",
    seuilAlerte: "65%",
    objectifCible: "> 80%",
    valeurActuelle: "68%",
    sens: "hausse",
    statut: "warn",
    commentaire:
      "Une satisfaction basse est un signal de risque de shadow IT (contournement des outils officiels), source d'erreurs et de non-conformité RGPD.",
  },
];

function loadKpis() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    saveKpis(SEED_DATA);
    return structuredClone(SEED_DATA);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return structuredClone(SEED_DATA);
  }
}

function saveKpis(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

let kpis = loadKpis();
let activeFilter = "all";
let editingId = null;

const STEPPER_HUES = ["#3f4f43", "#57695d", "#708677", "#889e90"];

const stepperEl = document.getElementById("stepper");
const donutEl = document.getElementById("donut-chart");
const donutTotalEl = document.getElementById("donut-total");
const tableBody = document.getElementById("kpi-table-body");
const modalOverlay = document.getElementById("modal-overlay");
const form = document.getElementById("kpi-form");
const modalTitle = document.getElementById("modal-title");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function extractNumber(str) {
  if (!str) return null;
  const match = String(str).replace(",", ".").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function niceMax(n) {
  if (n <= 0) return 100;
  const exponent = Math.floor(Math.log10(n));
  const magnitude = Math.pow(10, exponent);
  const residual = n / magnitude;
  let niceResidual;
  if (residual <= 1) niceResidual = 1;
  else if (residual <= 2) niceResidual = 2;
  else if (residual <= 5) niceResidual = 5;
  else niceResidual = 10;
  return niceResidual * magnitude;
}

function kpiNumbers(kpi) {
  const val = extractNumber(kpi.valeurActuelle);
  const obj = extractNumber(kpi.objectifCible);
  let seuil = extractNumber(kpi.seuilAlerte);
  if (seuil === null && obj !== null) {
    seuil = kpi.sens === "hausse" ? obj * 0.8 : obj * 1.6;
  }
  const max = niceMax(Math.max(val || 0, obj || 0, seuil || 0) * 1.2);
  return { val, obj, seuil, max };
}

/* ---------- Gauge (SVG semicircle with threshold zones) ---------- */
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  const sweep = startAngle > endAngle ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function buildGaugeSVG(kpi) {
  const CX = 105,
    CY = 88,
    R = 80,
    STROKE = 14;
  const { val, obj, max } = kpiNumbers(kpi);

  const angleFor = (v) => 180 - (Math.max(0, Math.min(v ?? 0, max)) / max) * 180;
  const s = STATUS[kpi.statut] || STATUS.ok;

  const track = `<path d="${describeArc(CX, CY, R, 180, 0)}" stroke="#e4e6e2" stroke-width="${STROKE}" fill="none" stroke-linecap="round" />`;

  let fill = "";
  if (val !== null) {
    const aVal = angleFor(val);
    if (Math.abs(180 - aVal) > 1) {
      fill = `<path d="${describeArc(CX, CY, R, 180, aVal)}" stroke="${s.color}" stroke-width="${STROKE}" fill="none" stroke-linecap="round" />`;
    }
  }

  let objTick = "";
  if (obj !== null) {
    const aObj = angleFor(obj);
    const pos = polarToCartesian(CX, CY, R, aObj);
    objTick = `<circle cx="${pos.x.toFixed(2)}" cy="${pos.y.toFixed(2)}" r="5" fill="#ffffff" stroke="#14171a" stroke-width="2" opacity="0.8" />`;
  }

  return `
    <svg class="gauge-svg" viewBox="0 0 210 104" xmlns="http://www.w3.org/2000/svg">
      ${track}
      ${fill}
      ${objTick}
    </svg>
  `;
}

/* ---------- Renderers ---------- */
function filteredKpis() {
  return activeFilter === "all" ? kpis : kpis.filter((k) => k.dimension === activeFilter);
}

function renderStepper() {
  const list = filteredKpis();
  if (list.length === 0) {
    stepperEl.innerHTML = `<div class="empty-state">Aucun KPI dans cette catégorie. Ajoutez-en un avec le bouton ci-dessous.</div>`;
    return;
  }

  stepperEl.innerHTML = list
    .map((kpi, i) => {
      const s = STATUS[kpi.statut] || STATUS.ok;
      return `
      <div class="stepper__item">
        <div class="stepper__row">
          <div class="stepper__pill" style="background:#647a6b">${escapeHtml(kpi.nom)}</div>
        </div>
        <div class="stat-card">
          ${buildGaugeSVG(kpi)}
          <div class="gauge-value">${escapeHtml(kpi.valeurActuelle)}</div>
          <div class="gauge-target"><span class="gauge-legend-dot"></span>objectif : ${escapeHtml(kpi.objectifCible)}</div>
          <span class="pill ${s.cls}">${s.icon} ${s.label}</span>
          <div class="stat-card__actions">
            <button class="btn--icon btn-edit" data-id="${kpi.id}">Modifier</button>
            <button class="btn--icon danger btn-delete" data-id="${kpi.id}">Supprimer</button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  stepperEl.querySelectorAll(".btn-edit").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.id)));
  stepperEl.querySelectorAll(".btn-delete").forEach((b) => b.addEventListener("click", () => deleteKpi(b.dataset.id)));
}

function renderDonut() {
  const list = filteredKpis();
  const counts = { ok: 0, warn: 0, alert: 0 };
  list.forEach((k) => counts[k.statut] !== undefined && counts[k.statut]++);
  const total = list.length;
  donutTotalEl.textContent = `${total} KPI`;

  if (total === 0) {
    donutEl.innerHTML = `<div class="empty-state">Aucune donnée.</div>`;
    return;
  }

  const R = 48,
    CX = 60,
    CY = 60,
    STROKE = 18;
  const circumference = 2 * Math.PI * R;
  const order = ["ok", "warn", "alert"];
  let offsetAcc = 0;
  const segments = order
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const frac = counts[k] / total;
      const len = frac * circumference;
      const seg = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${STATUS[k].color}" stroke-width="${STROKE}"
        stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offsetAcc}" transform="rotate(-90 ${CX} ${CY})" />`;
      offsetAcc += len;
      return seg;
    })
    .join("");

  const legendRows = order
    .map((k) => {
      const s = STATUS[k];
      const pct = total ? Math.round((counts[k] / total) * 100) : 0;
      return `
      <div class="donut-legend__row">
        <span class="donut-legend__label">${s.icon} ${s.label}</span>
        <span class="donut-legend__count tabular">${counts[k]}</span>
        <span class="donut-legend__pct tabular">${pct}%</span>
      </div>
    `;
    })
    .join("");

  donutEl.innerHTML = `
    <svg width="140" height="140" viewBox="0 0 120 120">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e1e0d9" stroke-width="${STROKE}" />
      ${segments}
      <text x="${CX}" y="${CY - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="#0b0b0b">${total}</text>
      <text x="${CX}" y="${CY + 14}" text-anchor="middle" font-size="9" fill="#898781">KPI suivis</text>
    </svg>
    <div class="donut-legend">${legendRows}</div>
  `;
}

function joinNames(names) {
  const wrapped = names.map((n) => `<strong>${escapeHtml(n)}</strong>`);
  if (wrapped.length <= 1) return wrapped.join("");
  return wrapped.slice(0, -1).join(", ") + " et " + wrapped[wrapped.length - 1];
}

function renderAnalysis() {
  const analysisEl = document.getElementById("analysis-text");
  const list = filteredKpis();

  if (list.length === 0) {
    analysisEl.innerHTML = `<div class="analysis-empty">Aucun KPI à analyser dans cette catégorie.</div>`;
    return;
  }

  const groups = { alert: [], warn: [], ok: [] };
  list.forEach((k) => {
    if (groups[k.statut]) groups[k.statut].push(k.nom);
  });

  const rows = [];

  if (groups.alert.length) {
    const n = groups.alert.length;
    const verbe = n > 1 ? "sont" : "est";
    const suite = n > 1 ? "Ils constituent les priorités" : "Il constitue la priorité";
    rows.push(`
      <div class="analysis-row status-critical">
        <span class="analysis-dot" style="background:${STATUS.alert.color}"></span>
        <p>${n} KPI ${verbe} en alerte : ${joinNames(groups.alert)}. ${suite} de modernisation.</p>
      </div>
    `);
  }

  if (groups.warn.length) {
    const n = groups.warn.length;
    const verbe = n > 1 ? "restent" : "reste";
    const suite = n > 1 ? "Ils nécessitent" : "Il nécessite";
    rows.push(`
      <div class="analysis-row status-warning">
        <span class="analysis-dot" style="background:${STATUS.warn.color}"></span>
        <p>${n} KPI ${verbe} en vigilance : ${joinNames(groups.warn)}. ${suite} la poursuite des actions Green IT et de l'accompagnement utilisateur.</p>
      </div>
    `);
  }

  if (groups.ok.length) {
    const n = groups.ok.length;
    const verbe = n > 1 ? "sont" : "est";
    const adj = n > 1 ? "conformes" : "conforme";
    const suite = n > 1 ? "Les objectifs sont atteints" : "L'objectif est atteint";
    rows.push(`
      <div class="analysis-row status-good">
        <span class="analysis-dot" style="background:${STATUS.ok.color}"></span>
        <p>${n} KPI ${verbe} ${adj} : ${joinNames(groups.ok)}. ${suite}, à maintenir.</p>
      </div>
    `);
  }

  analysisEl.innerHTML = rows.join("");
}

function renderTable() {
  const list = filteredKpis();
  if (list.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" class="empty-state">Aucun KPI dans cette catégorie. Ajoutez-en un avec le bouton ci-dessus.</td></tr>`;
    return;
  }
  tableBody.innerHTML = list
    .map((kpi) => {
      const s = STATUS[kpi.statut] || STATUS.ok;
      return `
      <tr>
        <td class="td-name">${escapeHtml(kpi.nom)}</td>
        <td>${escapeHtml(kpi.dimension)}</td>
        <td class="td-num">${escapeHtml(kpi.valeurActuelle)}</td>
        <td class="td-num">${escapeHtml(kpi.objectifCible)}</td>
        <td class="td-num">${escapeHtml(kpi.seuilAlerte || "—")}</td>
        <td>${escapeHtml(kpi.frequence || "—")}</td>
        <td><span class="pill ${s.cls}">${s.icon} ${s.label}</span></td>
        <td class="td-actions">
          <button class="btn--icon btn-edit" data-id="${kpi.id}">Modifier</button>
          <button class="btn--icon danger btn-delete" data-id="${kpi.id}">Supprimer</button>
        </td>
      </tr>
    `;
    })
    .join("");

  tableBody.querySelectorAll(".btn-edit").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.id)));
  tableBody.querySelectorAll(".btn-delete").forEach((b) => b.addEventListener("click", () => deleteKpi(b.dataset.id)));
}

function renderAll() {
  renderStepper();
  renderDonut();
  renderAnalysis();
  renderTable();
  saveKpis(kpis);
}

/* ---------- Filters ---------- */
document.getElementById("filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll("#filters .tab").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  activeFilter = btn.dataset.filter;
  renderStepper();
  renderDonut();
  renderAnalysis();
  renderTable();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  activeFilter = "all";
  document.querySelectorAll("#filters .tab").forEach((c) => c.classList.remove("active"));
  document.querySelector('#filters .tab[data-filter="all"]').classList.add("active");
  renderStepper();
  renderDonut();
  renderAnalysis();
  renderTable();
});

const infoPopover = document.getElementById("info-popover");
document.getElementById("btn-info").addEventListener("click", (e) => {
  e.stopPropagation();
  infoPopover.hidden = !infoPopover.hidden;
});
document.addEventListener("click", (e) => {
  if (!infoPopover.hidden && !infoPopover.contains(e.target) && e.target.id !== "btn-info") {
    infoPopover.hidden = true;
  }
});

/* ---------- Modal open/close ---------- */
function openAddModal() {
  editingId = null;
  modalTitle.textContent = "Ajouter un KPI";
  form.reset();
  document.getElementById("statut-suggestion").textContent = "";
  modalOverlay.hidden = false;
}

function openEditModal(id) {
  const kpi = kpis.find((k) => k.id === id);
  if (!kpi) return;
  editingId = id;
  modalTitle.textContent = "Modifier le KPI";
  document.getElementById("kpi-id").value = kpi.id;
  document.getElementById("nom").value = kpi.nom;
  document.getElementById("dimension").value = kpi.dimension;
  document.getElementById("frequence").value = kpi.frequence || "";
  document.getElementById("valeurActuelle").value = kpi.valeurActuelle;
  document.getElementById("objectifCible").value = kpi.objectifCible;
  document.getElementById("seuilAlerte").value = kpi.seuilAlerte || "";
  document.getElementById("sens").value = kpi.sens || "baisse";
  document.getElementById("statut").value = kpi.statut;
  document.getElementById("formule").value = kpi.formule || "";
  document.getElementById("source").value = kpi.source || "";
  document.getElementById("commentaire").value = kpi.commentaire || "";
  updateSuggestion();
  modalOverlay.hidden = false;
}

function closeModal() {
  modalOverlay.hidden = true;
  editingId = null;
}

document.getElementById("btn-add").addEventListener("click", openAddModal);
document.getElementById("btn-cancel").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalOverlay.hidden) closeModal();
});

function suggestStatus(draft) {
  const val = extractNumber(draft.valeurActuelle);
  const obj = extractNumber(draft.objectifCible);
  const seuil = extractNumber(draft.seuilAlerte);
  if (val === null || obj === null) return null;
  if (draft.sens === "hausse") {
    if (val >= obj) return "ok";
    if (seuil !== null && val < seuil) return "alert";
    return "warn";
  }
  if (val <= obj) return "ok";
  if (seuil !== null && val > seuil) return "alert";
  return "warn";
}

function updateSuggestion() {
  const draft = {
    valeurActuelle: document.getElementById("valeurActuelle").value,
    objectifCible: document.getElementById("objectifCible").value,
    seuilAlerte: document.getElementById("seuilAlerte").value,
    sens: document.getElementById("sens").value,
  };
  const suggestion = suggestStatus(draft);
  const el = document.getElementById("statut-suggestion");
  el.textContent = suggestion ? `Suggestion basée sur les valeurs saisies : ${STATUS[suggestion].icon} ${STATUS[suggestion].label}` : "";
}

["valeurActuelle", "objectifCible", "seuilAlerte", "sens"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateSuggestion);
  document.getElementById(id).addEventListener("change", updateSuggestion);
});

/* ---------- Form submit (create / update) ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    nom: document.getElementById("nom").value.trim(),
    dimension: document.getElementById("dimension").value,
    frequence: document.getElementById("frequence").value.trim(),
    valeurActuelle: document.getElementById("valeurActuelle").value.trim(),
    objectifCible: document.getElementById("objectifCible").value.trim(),
    seuilAlerte: document.getElementById("seuilAlerte").value.trim(),
    sens: document.getElementById("sens").value,
    statut: document.getElementById("statut").value,
    formule: document.getElementById("formule").value.trim(),
    source: document.getElementById("source").value.trim(),
    commentaire: document.getElementById("commentaire").value.trim(),
  };

  if (editingId) {
    const idx = kpis.findIndex((k) => k.id === editingId);
    if (idx !== -1) kpis[idx] = { ...kpis[idx], ...data };
  } else {
    kpis.push({ id: `kpi-${Date.now()}`, ...data });
  }

  renderAll();
  closeModal();
});

function deleteKpi(id) {
  const kpi = kpis.find((k) => k.id === id);
  if (!kpi) return;
  if (!confirm(`Supprimer le KPI "${kpi.nom}" ?`)) return;
  kpis = kpis.filter((k) => k.id !== id);
  renderAll();
}

/* ---------- Footer date ---------- */
document.getElementById("footer-date").textContent = `Maj : ${new Date().toLocaleDateString("fr-FR", {
  year: "numeric",
  month: "short",
  day: "numeric",
})}`;

/* ---------- Drag & drop between dashboard blocks ---------- */
const BLOCK_ORDER_KEY = "dlp-green-it-block-order";

function applySavedBlockOrder() {
  const container = document.getElementById("dash-blocks");
  const raw = localStorage.getItem(BLOCK_ORDER_KEY);
  if (!raw) return;
  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return;
  }
  const blocks = Array.from(container.querySelectorAll(".dash-block"));
  order.forEach((id) => {
    const el = blocks.find((b) => b.dataset.block === id);
    if (el) container.appendChild(el);
  });
}

function saveBlockOrder() {
  const container = document.getElementById("dash-blocks");
  const order = Array.from(container.querySelectorAll(".dash-block")).map((b) => b.dataset.block);
  localStorage.setItem(BLOCK_ORDER_KEY, JSON.stringify(order));
}

function setupBlockDragDrop() {
  const container = document.getElementById("dash-blocks");
  let draggedEl = null;

  function clearDragOverClasses() {
    container.querySelectorAll(".dash-block").forEach((b) => b.classList.remove("drag-over-top", "drag-over-bottom"));
  }

  function blockUnderPointer(clientY) {
    const blocks = Array.from(container.querySelectorAll(".dash-block")).filter((b) => b !== draggedEl);
    return blocks.find((b) => {
      const rect = b.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
  }

  function onPointerMove(e) {
    if (!draggedEl) return;
    const target = blockUnderPointer(e.clientY);
    clearDragOverClasses();
    if (target) {
      const rect = target.getBoundingClientRect();
      const isAfter = e.clientY - rect.top > rect.height / 2;
      target.classList.add(isAfter ? "drag-over-bottom" : "drag-over-top");
    }
  }

  function onPointerUp(e) {
    if (!draggedEl) return;
    const target = blockUnderPointer(e.clientY);
    if (target) {
      const rect = target.getBoundingClientRect();
      const isAfter = e.clientY - rect.top > rect.height / 2;
      if (isAfter) target.after(draggedEl);
      else target.before(draggedEl);
      saveBlockOrder();
    }
    draggedEl.classList.remove("dragging");
    clearDragOverClasses();
    draggedEl = null;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  }

  container.querySelectorAll(".dash-block__handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      draggedEl = handle.closest(".dash-block");
      draggedEl.classList.add("dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });
  });
}

applySavedBlockOrder();
setupBlockDragDrop();

renderAll();
