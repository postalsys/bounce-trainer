/* Client-side JS for the submission page */

const ACTION_STYLES = {
  remove: "text-bg-danger",
  retry: "text-bg-warning",
  retry_different_ip: "text-bg-info",
  fix_configuration: "text-bg-primary",
  review: "text-bg-secondary",
  remove_content: "text-bg-danger",
};

const messageEl = document.getElementById("message");
const classifyBtn = document.getElementById("classify-btn");
const submitBtn = document.getElementById("submit-btn");
const resultEl = document.getElementById("result");
const resultContentEl = document.getElementById("result-content");
const statusEl = document.getElementById("status");
const successEl = document.getElementById("success");
const labelSelect = document.getElementById("label-select");

// Human-readable label name: "auth_failure" -> "Auth Failure"
function formatLabel(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Show model source badge
fetch("/api/model/info")
  .then((r) => r.json())
  .then((data) => {
    const el = document.getElementById("model-badge");
    if (el && data.modelSource) {
      const isRetrained = data.modelSource === "retrained";
      el.innerHTML = `<span class="badge ${isRetrained ? "text-bg-success" : "text-bg-secondary"}">${isRetrained ? "Retrained model" : "Bundled model"}</span>`;
    }
  })
  .catch(() => {});

// Label descriptions keyed by value
const labelDescriptions = {};

// Load labels into dropdown
fetch("/api/labels")
  .then((r) => r.json())
  .then((labels) => {
    for (const { value, description } of labels) {
      labelDescriptions[value] = description;
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = `${formatLabel(value)} \u2014 ${description}`;
      labelSelect.appendChild(opt);
    }
  });

// Enable submit button when label is selected
if (labelSelect && submitBtn) {
  labelSelect.addEventListener("change", () => {
    submitBtn.disabled = !labelSelect.value;
  });
}

function showError(msg) {
  statusEl.textContent = msg;
  statusEl.classList.remove("d-none");
  successEl.classList.add("d-none");
}

function showSuccess(msg) {
  successEl.textContent = msg;
  successEl.classList.remove("d-none");
  statusEl.classList.add("d-none");
}

function hideAlerts() {
  statusEl.classList.add("d-none");
  successEl.classList.add("d-none");
}

function displayResult(result) {
  const pct = (result.confidence * 100).toFixed(1);
  const sortedScores = Object.entries(result.scores).sort((a, b) => b[1] - a[1]);
  const actionStyle = ACTION_STYLES[result.action] || "text-bg-secondary";

  const labelName = formatLabel(result.label);
  const labelDesc = labelDescriptions[result.label] || "";

  resultContentEl.innerHTML = `
    <div class="mb-3">
      <span class="badge rounded-pill ${actionStyle} fs-6">${result.label}</span>
      <span class="ms-2">${labelName}</span>
      ${labelDesc ? `<span class="text-body-secondary small ms-1">&mdash; ${labelDesc}</span>` : ""}
    </div>

    <div class="d-flex justify-content-between border-bottom py-2 small">
      <span class="text-body-secondary">Action</span>
      <span class="fw-medium">${result.action.replace(/_/g, " ")}</span>
    </div>
    <div class="d-flex justify-content-between border-bottom py-2 small">
      <span class="text-body-secondary">Confidence</span>
      <span class="d-flex align-items-center gap-2">
        <div class="progress" style="width:6rem;height:0.5rem">
          <div class="progress-bar bg-success" style="width:${pct}%"></div>
        </div>
        <span class="fw-medium">${pct}%</span>
      </span>
    </div>
    ${result.usedFallback ? '<div class="d-flex justify-content-between border-bottom py-2 small"><span class="text-body-secondary">Note</span><span class="text-warning fw-medium">Used fallback rules</span></div>' : ""}
    <div class="d-flex justify-content-between border-bottom py-2 small">
      <span class="text-body-secondary">Model</span>
      <span class="fw-medium">${result.modelSource === "retrained" ? '<span class="text-success">Retrained</span>' : "Bundled"}</span>
    </div>

    <div class="row row-cols-2 g-1 mt-2">
      ${sortedScores.map(([label, score]) => `<div class="col"><div class="d-flex justify-content-between px-2 py-1 rounded small ${label === result.label ? "bg-success-subtle fw-medium" : "bg-body-secondary bg-opacity-10"}""><span>${label.replace(/_/g, " ")}</span><span class="text-body-secondary">${(score * 100).toFixed(1)}%</span></div></div>`).join("")}
    </div>
  `;
  resultEl.classList.remove("d-none");
}

// Classify button
classifyBtn.addEventListener("click", async () => {
  const message = messageEl.value.trim();
  if (!message) return;
  hideAlerts();
  classifyBtn.disabled = true;
  classifyBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Classifying...';
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    displayResult(data);
    if (data.label && labelSelect) {
      labelSelect.value = data.label;
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    showError(err.message);
  } finally {
    classifyBtn.disabled = false;
    classifyBtn.innerHTML = '<i class="bi bi-search"></i> Test Classification';
  }
});

// Submit button
if (submitBtn) {
  submitBtn.addEventListener("click", async () => {
    const message = messageEl.value.trim();
    const label = labelSelect.value;
    if (!message || !label) return;
    hideAlerts();
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Submitting...';
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showSuccess(
        `Submitted! The message was anonymized and stored as "${data.proposed_label}". ` +
          `The current model classifies it as "${data.model_label}" (${(data.model_confidence * 100).toFixed(1)}% confidence).`,
      );
      messageEl.value = "";
      labelSelect.value = "";
      resultEl.classList.add("d-none");
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-send"></i> Submit Proposal';
    }
  });
}

// Example buttons
document.querySelectorAll(".example-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    messageEl.value = btn.dataset.message;
    hideAlerts();
  });
});

// Ctrl+Enter shortcut
messageEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.ctrlKey) {
    classifyBtn.click();
  }
});

// --- Bulk CSV upload ---
const csvFileInput = document.getElementById("csv-file");
const csvPreview = document.getElementById("csv-preview");
const csvPreviewBody = document.getElementById("csv-preview-body");
const csvCount = document.getElementById("csv-count");
const csvUploadBtn = document.getElementById("csv-upload-btn");
const csvStatus = document.getElementById("csv-status");

let csvContent = null;

if (csvFileInput) {
  csvFileInput.addEventListener("change", () => {
    const file = csvFileInput.files[0];
    if (!file) {
      csvPreview.classList.add("d-none");
      csvContent = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      csvContent = reader.result;
      const records = parseCsv(csvContent);
      if (records.length < 2) {
        csvStatus.className = "alert alert-danger small";
        csvStatus.textContent = "CSV must have a header row and at least one data row.";
        csvStatus.classList.remove("d-none");
        csvPreview.classList.add("d-none");
        return;
      }

      const [h1, h2] = records[0].map((h) => h.toLowerCase().trim());
      if (h1 !== "label" || h2 !== "message") {
        csvStatus.className = "alert alert-danger small";
        csvStatus.textContent = 'CSV header must be exactly "label,message". Got: "' + records[0].join(",") + '"';
        csvStatus.classList.remove("d-none");
        csvPreview.classList.add("d-none");
        return;
      }

      csvStatus.classList.add("d-none");

      let html = "";
      let validCount = 0;
      for (let i = 1; i < records.length; i++) {
        const label = (records[i][0] || "").trim();
        const msg = (records[i][1] || "").trim();
        if (!label || !msg) continue;
        const truncMsg = msg.length > 100 ? msg.slice(0, 100) + "..." : msg;
        html += `<tr><td>${i}</td><td><span class="badge text-bg-primary">${escapeHtml(label)}</span></td><td class="font-monospace">${escapeHtml(truncMsg)}</td></tr>`;
        validCount++;
      }
      csvPreviewBody.innerHTML = html;
      csvCount.textContent = `${validCount} row${validCount !== 1 ? "s" : ""} found`;
      csvPreview.classList.remove("d-none");
    };
    reader.readAsText(file);
  });

  if (csvUploadBtn) {
    csvUploadBtn.addEventListener("click", async () => {
      if (!csvContent) return;
      csvUploadBtn.disabled = true;
      csvUploadBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading...';
      csvStatus.classList.add("d-none");
      try {
        const res = await fetch("/api/proposals/bulk-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csvContent }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        let msg = `Uploaded ${data.inserted} proposal${data.inserted !== 1 ? "s" : ""}.`;
        if (data.errors && data.errors.length > 0) {
          msg += ` ${data.errors.length} row${data.errors.length !== 1 ? "s" : ""} skipped: ${data.errors.map((e) => `row ${e.row}: ${e.error}`).join("; ")}`;
        }
        csvStatus.className = "alert alert-success small";
        csvStatus.textContent = msg;
        csvStatus.classList.remove("d-none");
        csvPreview.classList.add("d-none");
        csvFileInput.value = "";
        csvContent = null;
      } catch (err) {
        csvStatus.className = "alert alert-danger small";
        csvStatus.textContent = err.message;
        csvStatus.classList.remove("d-none");
      } finally {
        csvUploadBtn.disabled = false;
        csvUploadBtn.innerHTML = '<i class="bi bi-upload"></i> Upload All';
      }
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// RFC 4180 CSV parser - handles quoted fields with commas and escaped quotes
function parseCsv(text) {
  const records = [];
  let pos = 0;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  function parseField() {
    if (pos >= text.length) return "";
    if (text[pos] === '"') {
      pos++;
      let val = "";
      while (pos < text.length) {
        if (text[pos] === '"') {
          if (pos + 1 < text.length && text[pos + 1] === '"') {
            val += '"';
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          val += text[pos];
          pos++;
        }
      }
      return val;
    }
    let val = "";
    while (pos < text.length && text[pos] !== "," && text[pos] !== "\n") {
      val += text[pos];
      pos++;
    }
    return val;
  }

  while (pos < text.length) {
    const f1 = parseField();
    if (pos < text.length && text[pos] === ",") pos++;
    const f2 = parseField();
    if (pos < text.length && text[pos] === "\n") pos++;
    if (f1 || f2) records.push([f1, f2]);
  }
  return records;
}
