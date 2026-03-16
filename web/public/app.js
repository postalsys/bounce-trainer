/* Client-side JS for the submission page */

const ACTION_STYLES = {
  remove: "badge-red",
  retry: "badge-yellow",
  retry_different_ip: "badge-orange",
  fix_configuration: "badge-purple",
  review: "badge-blue",
  remove_content: "badge-pink",
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
  statusEl.style.display = "block";
  successEl.style.display = "none";
}

function showSuccess(msg) {
  successEl.textContent = msg;
  successEl.style.display = "block";
  statusEl.style.display = "none";
}

function hideAlerts() {
  statusEl.style.display = "none";
  successEl.style.display = "none";
}

function displayResult(result) {
  const pct = (result.confidence * 100).toFixed(1);
  const sortedScores = Object.entries(result.scores).sort((a, b) => b[1] - a[1]);
  const actionStyle = ACTION_STYLES[result.action] || "badge-gray";

  resultContentEl.innerHTML = `
    <div class="label-badge ${actionStyle}">${result.label.replace(/_/g, " ")}</div>
    <div class="info-row">
      <span class="info-label">Action</span>
      <span class="info-value">${result.action.replace(/_/g, " ")}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Confidence</span>
      <span class="info-value">
        <span class="confidence-bar"><span class="confidence-fill" style="width:${pct}%"></span></span>
        ${pct}%
      </span>
    </div>
    ${result.usedFallback ? '<div class="info-row"><span class="info-label">Note</span><span class="info-value" style="color:#d97706">Used fallback rules</span></div>' : ""}
    <div class="scores-grid">
      ${sortedScores.map(([label, score]) => `<div class="score-item${label === result.label ? " highlight" : ""}"><span>${label.replace(/_/g, " ")}</span><span>${(score * 100).toFixed(1)}%</span></div>`).join("")}
    </div>
  `;
  resultEl.style.display = "block";
}

// Classify button
classifyBtn.addEventListener("click", async () => {
  const message = messageEl.value.trim();
  if (!message) return;
  hideAlerts();
  classifyBtn.disabled = true;
  classifyBtn.textContent = "Classifying...";
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    displayResult(data);
    // Auto-select the model's label
    if (data.label && labelSelect) {
      labelSelect.value = data.label;
      if (submitBtn) submitBtn.disabled = false;
    }
  } catch (err) {
    showError(err.message);
  } finally {
    classifyBtn.disabled = false;
    classifyBtn.textContent = "Test Classification";
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
    submitBtn.textContent = "Submitting...";
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
      resultEl.style.display = "none";
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Proposal";
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
