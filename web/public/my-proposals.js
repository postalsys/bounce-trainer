/* Client-side JS for the my-proposals page */

let currentFilter = "all";
let currentPage = 1;
const limit = 50;

const tbody = document.getElementById("proposals-body");
const paginationEl = document.getElementById("pagination");
const statsEl = document.getElementById("stats");

async function loadProposals() {
  const params = new URLSearchParams({ page: currentPage, limit });
  const res = await fetch("/api/proposals?" + params);
  const data = await res.json();

  let rows = data.proposals;
  if (currentFilter !== "all") {
    rows = rows.filter((p) => p.status === currentFilter);
  }

  const all = data.proposals;
  const pending = all.filter((p) => p.status === "pending").length;
  const approved = all.filter((p) => p.status === "approved").length;
  const rejected = all.filter((p) => p.status === "rejected").length;
  const exported = all.filter((p) => p.exported_at).length;
  statsEl.innerHTML =
    '<span><strong>' + data.total + '</strong> <span class="text-body-secondary">total</span></span>' +
    '<span><strong>' + pending + '</strong> <span class="text-body-secondary">pending</span></span>' +
    '<span><strong>' + approved + '</strong> <span class="text-body-secondary">approved</span></span>' +
    '<span><strong>' + rejected + '</strong> <span class="text-body-secondary">rejected</span></span>' +
    '<span><strong>' + exported + '</strong> <span class="text-body-secondary">in training data</span></span>';

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-body-secondary py-4">No proposals found</td></tr>';
    paginationEl.innerHTML = "";
    return;
  }

  tbody.innerHTML = rows.map((p) => {
    const statusBadge = p.status === "approved"
      ? '<span class="badge text-bg-success"><i class="bi bi-check-circle"></i> Approved</span>'
      : p.status === "rejected"
        ? '<span class="badge text-bg-danger"><i class="bi bi-x-circle"></i> Rejected</span>'
        : '<span class="badge text-bg-warning"><i class="bi bi-hourglass-split"></i> Pending</span>';

    const exportedBadge = p.exported_at
      ? '<span class="badge text-bg-success"><i class="bi bi-check-lg"></i> Yes</span>'
      : p.status === "approved"
        ? '<span class="text-body-secondary small">Not yet</span>'
        : '<span class="text-body-secondary small">-</span>';

    const date = new Date(p.created_at + "Z").toLocaleDateString();

    return '<tr>' +
      '<td class="font-monospace small text-break" style="max-width:24rem" title="' + escapeAttr(p.message_text) + '">' + escapeHtml(truncate(p.message_text, 100)) + '</td>' +
      '<td><span class="badge text-bg-primary">' + escapeHtml(p.proposed_label) + '</span></td>' +
      '<td class="small">' + escapeHtml(p.model_label || "-") + ' <span class="text-body-secondary">' + (p.model_confidence ? (p.model_confidence * 100).toFixed(0) + "%" : "") + '</span></td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + exportedBadge + '</td>' +
      '<td class="small text-body-secondary text-nowrap">' + escapeHtml(date) + '</td>' +
      '</tr>';
  }).join("");

  const totalPages = Math.ceil(data.total / limit);
  if (totalPages > 1) {
    paginationEl.innerHTML = Array.from({ length: totalPages }, (_, i) => {
      const page = i + 1;
      return '<li class="page-item' + (page === currentPage ? " active" : "") + '"><button class="page-link" onclick="goToPage(' + page + ')">' + page + '</button></li>';
    }).join("");
  } else {
    paginationEl.innerHTML = "";
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

document.querySelectorAll(".nav-link[data-filter]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-link[data-filter]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.filter;
    loadProposals();
  });
});

window.goToPage = function (page) {
  currentPage = page;
  loadProposals();
};

loadProposals();
