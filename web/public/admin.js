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
  const counts = data.statusCounts;
  statsBar.innerHTML = `
    <span class="stat-item"><strong>${counts.pending || 0}</strong> pending</span>
    <span class="stat-item"><strong>${counts.approved || 0}</strong> approved</span>
    <span class="stat-item"><strong>${counts.rejected || 0}</strong> rejected</span>
  `;
}

async function loadProposals() {
  const res = await fetch(
    `/admin/api/proposals?status=${currentStatus}&page=${currentPage}&limit=${limit}`,
  );
  const data = await res.json();

  if (data.proposals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:2rem">No ${currentStatus} proposals</td></tr>`;
    paginationEl.innerHTML = "";
    return;
  }

  tbody.innerHTML = data.proposals
    .map(
      (p) => `
    <tr>
      <td><input type="checkbox" class="row-checkbox" value="${p.id}" /></td>
      <td class="msg-cell" title="${escapeHtml(p.message_text)}">${escapeHtml(truncate(p.message_text, 120))}</td>
      <td><span class="label-badge badge-blue" style="font-size:0.75rem;padding:0.125rem 0.5rem">${p.proposed_label}</span></td>
      <td>${p.model_label || "-"}</td>
      <td>${p.model_confidence ? (p.model_confidence * 100).toFixed(0) + "%" : "-"}</td>
      <td>${p.github_username}</td>
      <td class="action-btns">
        ${currentStatus === "pending" ? `
          <button class="btn btn-small btn-primary" onclick="patchProposal(${p.id}, 'approved')">Approve</button>
          <button class="btn btn-small btn-danger" onclick="patchProposal(${p.id}, 'rejected')">Reject</button>
        ` : `<span style="color:#6b7280;font-size:0.75rem">${p.status}</span>`}
      </td>
    </tr>
  `,
    )
    .join("");

  // Pagination
  const totalPages = Math.ceil(data.total / limit);
  if (totalPages > 1) {
    let html = "";
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="page-btn${i === currentPage ? " active" : ""}" onclick="goToPage(${i})">${i}</button>`;
    }
    paginationEl.innerHTML = html;
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
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
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

// Delegate checkbox changes
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
  exportBtn.textContent = "Exporting...";
  try {
    const res = await fetch("/admin/api/export", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`Exported ${data.count} approved proposals to community_labeled.jsonl`);
  } catch (err) {
    alert("Export failed: " + err.message);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "Export to JSONL";
  }
});

// Retrain
retrainBtn.addEventListener("click", async () => {
  if (!confirm("Start model retraining? This may take several minutes.")) return;
  retrainBtn.disabled = true;
  try {
    const res = await fetch("/admin/api/retrain", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    retrainStatusEl.textContent = "Retrain started...";
    retrainStatusEl.style.display = "block";
    pollRetrainStatus();
  } catch (err) {
    alert("Retrain failed: " + err.message);
    retrainBtn.disabled = false;
  }
});

async function pollRetrainStatus() {
  const res = await fetch("/admin/api/retrain/status");
  const data = await res.json();
  retrainStatusEl.textContent = data.running
    ? "Retrain in progress...\n" + (data.lastLog || "").slice(-500)
    : "Retrain complete.\n" + (data.lastLog || "").slice(-500);
  retrainStatusEl.style.whiteSpace = "pre-wrap";
  if (data.running) {
    setTimeout(pollRetrainStatus, 3000);
  } else {
    retrainBtn.disabled = false;
  }
}

// Initial load
loadStats();
loadProposals();
