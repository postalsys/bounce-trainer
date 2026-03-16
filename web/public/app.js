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

// Load labels into dropdown
fetch("/api/labels")
  .then((r) => r.json())
  .then((labels) => {
    for (const label of labels) {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label.replace(/_/g, " ");
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

  resultContentEl.innerHTML = `
    <span class="badge rounded-pill ${actionStyle} fs-6 mb-3">${result.label.replace(/_/g, " ")}</span>

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
