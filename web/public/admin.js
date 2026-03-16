/* Client-side JS for the admin panel */

let currentStatus = "pending";
let currentPage = 1;
const limit = 50;

const tbody = document.getElementById("proposals-body");
const paginationEl = document.getElementById("pagination");
const statsBar = document.getElementById("stats-bar");
const selectAllCheckbox = document.getElementById("select-all");
const bulkApproveBtn = document.getElementById("bulk-approve-btn");
const bulkRejectBtn = document.getElementById("bulk-reject-btn");
const exportBtn = document.getElementById("export-btn");
const retrainBtn = document.getElementById("retrain-btn");
const retrainStatusEl = document.getElementById("retrain-status");

// Bootstrap modal helpers
const adminModalEl = document.getElementById("admin-modal");
const adminModal = new bootstrap.Modal(adminModalEl);

function showModal(title, body, { type = "info", confirmText, onConfirm } = {}) {
  document.getElementById("admin-modal-title").textContent = title;
  document.getElementById("admin-modal-body").innerHTML = body;

  const footer = document.getElementById("admin-modal-footer");
  if (onConfirm) {
    footer.innerHTML =
      `<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>` +
      `<button type="button" class="btn btn-${type} btn-sm" id="admin-modal-confirm">${confirmText || "Confirm"}</button>`;
    document.getElementById("admin-modal-confirm").addEventListener("click", () => {
      adminModal.hide();
      onConfirm();
    });
  } else {
    footer.innerHTML = `<button type="button" class="btn btn-${type} btn-sm" data-bs-dismiss="modal">OK</button>`;
  }

  adminModal.show();
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll(".row-checkbox:checked")).map(
    (cb) => Number(cb.value),
  );
}

function updateBulkButtons() {
  const count = getSelectedIds().length;
  bulkApproveBtn.disabled = count === 0;
  bulkRejectBtn.disabled = count === 0;
}

async function loadStats() {
  const res = await fetch("/admin/api/stats");
  const data = await res.json();
  const c = data.statusCounts;
  const pendingTraining = data.pendingTraining || 0;
  statsBar.innerHTML = `
    <span><strong>${c.pending || 0}</strong> <span class="text-body-secondary">pending</span></span>
    <span><strong>${c.approved || 0}</strong> <span class="text-body-secondary">approved</span></span>
    <span><strong>${c.rejected || 0}</strong> <span class="text-body-secondary">rejected</span></span>
    ${pendingTraining > 0 ? `<span class="text-warning-emphasis"><i class="bi bi-exclamation-triangle"></i> <strong>${pendingTraining}</strong> approved but not yet exported</span>` : ""}
  `;
}

async function loadProposals() {
  const res = await fetch(
    `/admin/api/proposals?status=${currentStatus}&page=${currentPage}&limit=${limit}`,
  );
  const data = await res.json();

  if (data.proposals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-body-secondary py-4">No ${currentStatus} proposals</td></tr>`;
    paginationEl.innerHTML = "";
    return;
  }

  tbody.innerHTML = data.proposals
    .map(
      (p) => `
    <tr>
      <td><input class="form-check-input row-checkbox" type="checkbox" value="${p.id}" /></td>
      <td class="font-monospace small text-break" style="max-width:24rem" title="${escapeHtml(p.message_text)}">${escapeHtml(truncate(p.message_text, 120))}</td>
      <td><span class="badge text-bg-primary">${escapeHtml(p.proposed_label)}</span></td>
      <td class="small">${escapeHtml(p.model_label || "-")}</td>
      <td class="small">${p.model_confidence ? (p.model_confidence * 100).toFixed(0) + "%" : "-"}</td>
      <td class="small">${escapeHtml(p.github_username)}</td>
      <td>
        ${currentStatus === "pending" ? `
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-success" onclick="patchProposal(${p.id}, 'approved')" title="Approve"><i class="bi bi-check-lg"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="patchProposal(${p.id}, 'rejected')" title="Reject"><i class="bi bi-x-lg"></i></button>
          </div>
        ` : `<span class="badge ${p.status === "approved" ? "text-bg-success" : "text-bg-danger"}">${escapeHtml(p.status)}</span>`}
      </td>
    </tr>
  `,
    )
    .join("");

  const totalPages = Math.ceil(data.total / limit);
  if (totalPages > 1) {
    paginationEl.innerHTML = Array.from({ length: totalPages }, (_, i) => {
      const page = i + 1;
      return `<li class="page-item${page === currentPage ? " active" : ""}"><button class="page-link" onclick="goToPage(${page})">${page}</button></li>`;
    }).join("");
  } else {
    paginationEl.innerHTML = "";
  }

  selectAllCheckbox.checked = false;
  updateBulkButtons();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// Tab switching
document.querySelectorAll(".nav-link[data-status]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-link[data-status]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentStatus = tab.dataset.status;
    currentPage = 1;
    loadProposals();
  });
});

// Select all
selectAllCheckbox.addEventListener("change", () => {
  document.querySelectorAll(".row-checkbox").forEach((cb) => {
    cb.checked = selectAllCheckbox.checked;
  });
  updateBulkButtons();
});

tbody.addEventListener("change", (e) => {
  if (e.target.classList.contains("row-checkbox")) {
    updateBulkButtons();
  }
});

// Single approve/reject
window.patchProposal = async function (id, status) {
  await fetch(`/admin/api/proposals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  loadProposals();
  loadStats();
};

window.goToPage = function (page) {
  currentPage = page;
  loadProposals();
};

// Bulk actions
async function bulkAction(status) {
  const ids = getSelectedIds();
  if (ids.length === 0) return;
  await fetch("/admin/api/proposals/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, status }),
  });
  loadProposals();
  loadStats();
}

bulkApproveBtn.addEventListener("click", () => bulkAction("approved"));
bulkRejectBtn.addEventListener("click", () => bulkAction("rejected"));

// Export
exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  exportBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Exporting...';
  try {
    const res = await fetch("/admin/api/export", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showModal("Export Complete", `Exported <strong>${data.count}</strong> approved proposals to <code>community_labeled.jsonl</code>.`, { type: "success" });
  } catch (err) {
    showModal("Export Failed", escapeHtml(err.message), { type: "danger" });
  } finally {
    exportBtn.disabled = false;
    exportBtn.innerHTML = '<i class="bi bi-download"></i> Export to JSONL';
  }
});

// Retrain
retrainBtn.addEventListener("click", () => {
  showModal(
    "Retrain Model",
    "Start model retraining? This may take several minutes.",
    {
      type: "primary",
      confirmText: "Start Retrain",
      onConfirm: async () => {
        retrainBtn.disabled = true;
        try {
          const res = await fetch("/admin/api/retrain", { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          retrainStatusEl.textContent = "Retrain started...";
          retrainStatusEl.classList.remove("d-none");
          pollRetrainStatus();
        } catch (err) {
          showModal("Retrain Failed", escapeHtml(err.message), { type: "danger" });
          retrainBtn.disabled = false;
        }
      },
    },
  );
});

async function pollRetrainStatus() {
  const res = await fetch("/admin/api/retrain/status");
  const data = await res.json();
  const logTail = (data.lastLog || "").slice(-500);
  retrainStatusEl.innerHTML = data.running
    ? `<div class="fw-medium mb-1"><span class="spinner-border spinner-border-sm"></span> Retrain in progress...</div><pre class="mb-0 small">${escapeHtml(logTail)}</pre>`
    : `<div class="fw-medium mb-1"><i class="bi bi-check-circle"></i> Retrain complete</div><pre class="mb-0 small">${escapeHtml(logTail)}</pre>`;
  if (data.running) {
    setTimeout(pollRetrainStatus, 3000);
  } else {
    retrainBtn.disabled = false;
  }
}

// Initial load
loadStats();
loadProposals();
