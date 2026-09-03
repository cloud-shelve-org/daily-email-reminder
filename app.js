// Set this after deploying apps-script/Code.gs as a Google Apps Script web app.
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyKBlRKGxr2Irv6pVdQ5PAjEi_ecYLzQ6-zF2KZOwFyrY5th3rl70eQ6SiPry4np9gx/exec";

const form = document.getElementById("reminderForm");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const message = document.getElementById("message");
const statusBadge = document.getElementById("statusBadge");
const stateText = document.getElementById("stateText");
const startedText = document.getElementById("startedText");
const lastSentText = document.getElementById("lastSentText");
const replyText = document.getElementById("replyText");

let pollTimer;

function configured() {
  return SCRIPT_URL && !SCRIPT_URL.includes("PASTE_YOUR");
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#2859a8";
}

function setStatus(state, data = {}) {
  const normalized = (state || "STOPPED").toUpperCase();
  const label = normalized === "RUNNING" ? "Running" : normalized === "COMPLETED" ? "Completed" : "Stopped";
  statusBadge.textContent = label;
  statusBadge.className = `badge ${normalized.toLowerCase()}`;
  stateText.textContent = label;
  startedText.textContent = data.startedAt ? new Date(data.startedAt).toLocaleString() : "—";
  lastSentText.textContent = data.lastSentAt ? new Date(data.lastSentAt).toLocaleString() : "—";
  replyText.textContent = data.replyReceivedAt ? `Received ${new Date(data.replyReceivedAt).toLocaleString()}` : "Not received";
  startButton.disabled = normalized === "RUNNING";
  stopButton.disabled = normalized !== "RUNNING";
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    const callback = `der_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const query = new URLSearchParams({ ...params, callback });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Backend request timed out."));
    }, 15000);
    window[callback] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Could not reach Google Apps Script.")); };
    script.src = `${SCRIPT_URL}?${query}`;
    document.body.appendChild(script);
    function cleanup() {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
    }
  });
}

async function refreshStatus() {
  if (!configured()) return;
  try {
    const result = await jsonp({ action: "status" });
    if (result.ok) setStatus(result.state, result);
  } catch (_) {
    // Status polling is best-effort; do not interrupt the user.
  }
}

async function submitAction(payload) {
  if (!configured()) throw new Error("Configure SCRIPT_URL in app.js first.");
  // Apps Script web apps can be called cross-origin using a simple POST.
  // The response is intentionally not read; status is retrieved with JSONP.
  await fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(payload)
  });
}

function readAttachment(file) {
  if (!file) return Promise.resolve({});
  if (!file.type.startsWith("image/")) throw new Error("Please select an image file.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Image must be 2 MB or smaller.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ attachmentBase64: String(reader.result).split(",")[1], attachmentName: file.name, attachmentMime: file.type });
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const to = document.getElementById("to").value.trim();
  const subject = document.getElementById("subject").value.trim();
  const body = document.getElementById("body").value.trim();
  const sendHour = document.getElementById("sendHour").value;
  const file = document.getElementById("attachment").files[0];

  if (!to || !subject || !body) return showMessage("Please complete recipient, subject and body.", true);

  startButton.disabled = true;
  showMessage("Starting reminder…");
  try {
    const attachment = await readAttachment(file);
    await submitAction({ action: "start", to, subject, body, sendHour, ...attachment });
    showMessage("Reminder started. The first scheduled send will happen at the selected hour.");
    await new Promise(r => setTimeout(r, 1200));
    await refreshStatus();
  } catch (error) {
    showMessage(error.message, true);
    startButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  showMessage("Stopping reminder…");
  try {
    await submitAction({ action: "stop" });
    showMessage("Reminder stopped.");
    await new Promise(r => setTimeout(r, 800));
    await refreshStatus();
  } catch (error) {
    showMessage(error.message, true);
    stopButton.disabled = false;
  }
});

setStatus("STOPPED");
refreshStatus();
pollTimer = setInterval(refreshStatus, 60000);
