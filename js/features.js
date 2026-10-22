const YP_STORAGE = {
  saved: "youthportal-saved-opportunities",
  recent: "youthportal-recently-viewed",
  theme: "youthportal-theme",
  applications: "youthportal-application-tracker",
  weeklyPlan: "youthportal-weekly-action-plan"
};

const APPLICATION_STAGES = [
  { value: "preparing", label: "Preparing" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer / decision" },
  { value: "closed", label: "Closed / not proceeding" }
];

const WEEKLY_ACTIONS = [
  { id: "source-check", label: "Check one opportunity on its official source before you act.", href: "opportunities.html" },
  { id: "cv-evidence", label: "Add one honest project, school or community example to your CV.", href: "resources.html#experience-helper" },
  { id: "application-step", label: "Move one application forward—or track a first opportunity.", href: "index.html#application-tracker" },
  { id: "practice-answer", label: "Practise one interview answer using the STAR method.", href: "resources.html#more-help-title" }
];

function readPortalStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writePortalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    announcePortalMessage("This browser could not save the change. Check local storage or browser privacy settings.");
    return false;
  }
}

function escapePortalHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function getSavedOpportunityIds() {
  const value = readPortalStorage(YP_STORAGE.saved, []);
  return Array.isArray(value) ? value.map(String) : [];
}

function isOpportunitySaved(id) {
  return getSavedOpportunityIds().includes(String(id));
}

function getOpportunityCountdown(closingDate) {
  const end = new Date(`${closingDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return { days: null, text: "Closing date unavailable", soon: false, expired: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { days, text: "Closed", soon: false, expired: true };
  if (days === 0) return { days, text: "Closes today", soon: true, expired: false };
  return { days, text: `Closes in ${days} day${days === 1 ? "" : "s"}`, soon: days <= 7, expired: false };
}

function getOpportunityVerificationState(opportunity, now = new Date()) {
  if (!opportunity || opportunity.verificationStatus !== "verified" || !opportunity.verifiedAt || !opportunity.sourceUrl) return "sample";
  let source;
  let application;
  try {
    source = new URL(opportunity.sourceUrl);
    application = new URL(opportunity.applicationLink);
  } catch { return "stale"; }
  if (source.protocol !== "https:" || application.protocol !== "https:") return "stale";

  const checked = new Date(`${opportunity.verifiedAt}T00:00:00`);
  if (Number.isNaN(checked.getTime())) return "stale";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  checked.setHours(0, 0, 0, 0);
  const ageInDays = Math.floor((today.getTime() - checked.getTime()) / 86400000);
  return ageInDays >= 0 && ageInDays <= 7 ? "verified" : "stale";
}

function formatPortalDate(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return escapePortalHTML(dateText || "Unknown");
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function getOpportunityBadgeHTML(opportunity) {
  const state = getOpportunityVerificationState(opportunity);
  if (state === "verified") {
    return `<span class="listing-verification-badge is-verified" title="Official source checked ${escapePortalHTML(formatPortalDate(opportunity.verifiedAt))}">✓ Official source checked ${escapePortalHTML(formatPortalDate(opportunity.verifiedAt))}</span>`;
  }
  if (state === "stale") {
    return `<span class="listing-verification-badge is-stale" title="This source check is older than seven days; confirm details directly">Recheck source</span>`;
  }
  return '<span class="listing-verification-badge is-sample" title="Fictional example, not a vacancy">Sample · not a real vacancy</span>';
}

function isOpportunityCurrentlyVisible(opportunity, now = new Date()) {
  const closingDate = new Date(`${opportunity.closingDate}T00:00:00`);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(closingDate.getTime()) && closingDate >= today &&
    (opportunity.verificationStatus !== "verified" || getOpportunityVerificationState(opportunity, now) === "verified");
}

function getRecentOpportunityIds() {
  const value = readPortalStorage(YP_STORAGE.recent, []);
  return Array.isArray(value) ? value.map(String) : [];
}

function recordOpportunityView(id) {
  const normalized = String(id);
  const ids = [normalized, ...getRecentOpportunityIds().filter((item) => item !== normalized)].slice(0, 6);
  try { localStorage.setItem(YP_STORAGE.recent, JSON.stringify(ids)); } catch { /* Storage may be unavailable in private contexts. */ }
}

function refreshSavedOpportunityUI() {
  document.querySelectorAll(".save-opportunity-btn[data-save-id]").forEach((button) => {
    const saved = isOpportunitySaved(button.dataset.saveId);
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", saved ? "Remove saved opportunity" : "Save opportunity");
    button.classList.toggle("is-saved", saved);
    const label = button.querySelector(".save-label");
    if (label) label.textContent = saved ? "Saved" : "Save";
    else button.textContent = saved ? "★ Saved" : "☆ Save";
  });
  const count = getSavedOpportunityIds().length;
  document.querySelectorAll("[data-saved-count]").forEach((element) => { element.textContent = String(count); });
}

function getTrackedApplications() {
  const value = readPortalStorage(YP_STORAGE.applications, []);
  if (!Array.isArray(value)) return [];
  const allowed = new Set(APPLICATION_STAGES.map((stage) => stage.value));
  return value.filter((entry) => entry && typeof entry.id === "string" && allowed.has(entry.stage));
}

function getTrackedApplication(id) {
  return getTrackedApplications().find((entry) => entry.id === String(id)) || null;
}

function setTrackedApplication(id, stage, rerender = true) {
  const normalized = String(id);
  const entries = getTrackedApplications().filter((entry) => entry.id !== normalized);
  if (stage) {
    if (!APPLICATION_STAGES.some((item) => item.value === stage)) return false;
    entries.unshift({ id: normalized, stage, updatedAt: new Date().toISOString() });
  }
  const success = writePortalStorage(YP_STORAGE.applications, entries);
  if (success) {
    refreshTrackerUI();
    if (rerender) renderApplicationTracker();
  }
  return success;
}

function isOpportunityTracked(id) {
  return Boolean(getTrackedApplication(id));
}

function renderApplicationTracker() {
  const section = document.getElementById("application-tracker");
  const list = document.getElementById("application-tracker-list");
  if (!section || !list) return;
  const entries = getTrackedApplications();
  const records = typeof opportunitiesData === "undefined" ? [] : opportunitiesData;
  section.hidden = entries.length === 0;
  const count = document.getElementById("application-tracker-count");
  if (count) count.textContent = String(entries.length);

  list.innerHTML = entries.map((entry) => {
    const opportunity = records.find((item) => String(item.id) === entry.id);
    if (!opportunity) {
      return `<article class="tracker-item"><div><strong>Listing no longer available</strong><p>This saved tracker record can be removed.</p></div><button class="btn-tertiary tracker-remove" type="button" data-remove-track="${escapePortalHTML(entry.id)}">Remove</button></article>`;
    }
    const options = APPLICATION_STAGES.map((stage) => `<option value="${stage.value}" ${stage.value === entry.stage ? "selected" : ""}>${stage.label}</option>`).join("");
    return `<article class="tracker-item">
      <div class="tracker-item-copy"><a href="opportunity-details.html?id=${encodeURIComponent(opportunity.id)}"><strong>${escapePortalHTML(opportunity.title)}</strong></a><p>${escapePortalHTML(opportunity.organisation)} · Closes ${escapePortalHTML(formatPortalDate(opportunity.closingDate))}</p>${getOpportunityBadgeHTML(opportunity)}</div>
      <label class="tracker-stage-label">Progress<select class="filter-control tracker-stage" data-tracker-stage="${escapePortalHTML(entry.id)}" aria-label="Application progress for ${escapePortalHTML(opportunity.title)}">${options}</select></label>
      <button class="btn-tertiary tracker-remove" type="button" data-remove-track="${escapePortalHTML(entry.id)}">Remove</button>
    </article>`;
  }).join("");
}

function refreshTrackerUI() {
  document.querySelectorAll(".track-opportunity-btn[data-track-id]").forEach((button) => {
    const tracked = isOpportunityTracked(button.dataset.trackId);
    button.setAttribute("aria-pressed", String(tracked));
    button.setAttribute("aria-label", tracked ? "Remove from application tracker" : "Track this opportunity");
    button.classList.toggle("is-tracked", tracked);
    const label = button.querySelector(".track-label");
    if (label) label.textContent = tracked ? "In tracker" : "Track";
    else button.textContent = tracked ? "✓ Tracked" : "+ Track";
    const icon = button.querySelector('[aria-hidden="true"]');
    if (icon) icon.textContent = tracked ? "✓" : "+";
  });
  document.querySelectorAll("[data-detail-tracker-stage]").forEach((select) => {
    const entry = getTrackedApplication(select.dataset.detailTrackerStage);
    select.value = entry ? entry.stage : "";
  });
}

function getWeekStartKey(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function getWeeklyPlanState() {
  const weekOf = getWeekStartKey();
  const stored = readPortalStorage(YP_STORAGE.weeklyPlan, null);
  if (stored && stored.weekOf === weekOf && Array.isArray(stored.completed)) return stored;
  const fresh = { weekOf, completed: [] };
  writePortalStorage(YP_STORAGE.weeklyPlan, fresh);
  return fresh;
}

function renderWeeklyPlan() {
  const list = document.getElementById("weekly-plan-list");
  if (!list) return;
  const state = getWeeklyPlanState();
  list.innerHTML = WEEKLY_ACTIONS.map((task) => `<li class="weekly-task-row"><label class="weekly-task"><input type="checkbox" data-weekly-task="${task.id}" ${state.completed.includes(task.id) ? "checked" : ""}><span>${task.label}</span></label><a class="weekly-task-link" href="${task.href}" aria-label="Open related resource for: ${task.label}">Open</a></li>`).join("");
  updateWeeklyPlanProgress(state);
}

function updateWeeklyPlanProgress(state = getWeeklyPlanState()) {
  const complete = state.completed.filter((id) => WEEKLY_ACTIONS.some((task) => task.id === id)).length;
  const progress = document.getElementById("weekly-plan-progress");
  if (progress) progress.textContent = `${complete} of ${WEEKLY_ACTIONS.length} actions done this week`;
  const meter = document.getElementById("weekly-plan-meter");
  if (meter) meter.value = complete;
}

function setPortalTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  try { localStorage.setItem(YP_STORAGE.theme, selected); } catch { /* Theme still works for this page view. */ }
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.setAttribute("aria-pressed", String(selected === "dark"));
    button.innerHTML = selected === "dark" ? '<span aria-hidden="true">☀</span><span class="theme-label">Light</span>' : '<span aria-hidden="true">◐</span><span class="theme-label">Dark</span>';
  });
}

async function shareOpportunity(id) {
  const opportunity = typeof opportunitiesData !== "undefined" ? opportunitiesData.find((item) => String(item.id) === String(id)) : null;
  const detailsUrl = new URL(`opportunity-details.html?id=${encodeURIComponent(id)}`, window.location.href).href;
  const shareData = { title: opportunity ? opportunity.title : "Youth Portal opportunity", text: "View this opportunity on Youth Portal", url: detailsUrl };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(detailsUrl);
      announcePortalMessage("Link copied to clipboard.");
    } else {
      window.prompt("Copy this opportunity link:", detailsUrl);
    }
  } catch (error) {
    if (error && error.name !== "AbortError") announcePortalMessage("Could not share this link. You can copy the page address instead.");
  }
}

function announcePortalMessage(message) {
  let status = document.getElementById("portal-live-message");
  if (!status) {
    status = document.createElement("p");
    status.id = "portal-live-message";
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    document.body.appendChild(status);
  }
  status.textContent = message;
}

function setupPortalFeatures() {
  let theme = "light";
  try { theme = localStorage.getItem(YP_STORAGE.theme) || "light"; } catch { /* Use light theme. */ }
  setPortalTheme(theme);

  document.querySelectorAll(".nav-actions").forEach((actions) => {
    if (actions.querySelector(".theme-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.addEventListener("click", () => setPortalTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
    actions.appendChild(button);
  });
  setPortalTheme(theme);
  refreshSavedOpportunityUI();
  renderApplicationTracker();
  refreshTrackerUI();
  renderWeeklyPlan();

  document.addEventListener("click", (event) => {
    const saveButton = event.target.closest(".save-opportunity-btn[data-save-id]");
    if (saveButton) {
      const id = String(saveButton.dataset.saveId);
      const ids = getSavedOpportunityIds();
      const next = ids.includes(id) ? ids.filter((value) => value !== id) : [id, ...ids];
      try { localStorage.setItem(YP_STORAGE.saved, JSON.stringify(next)); } catch { /* No persistence in blocked storage contexts. */ }
      refreshSavedOpportunityUI();
      document.dispatchEvent(new CustomEvent("portal:saved-change", { detail: { ids: next } }));
      return;
    }

    const trackButton = event.target.closest(".track-opportunity-btn[data-track-id]");
    if (trackButton) {
      const id = String(trackButton.dataset.trackId);
      setTrackedApplication(id, isOpportunityTracked(id) ? "" : "preparing");
      return;
    }

    const removeButton = event.target.closest("[data-remove-track]");
    if (removeButton) {
      setTrackedApplication(removeButton.dataset.removeTrack, "");
      return;
    }

    const shareButton = event.target.closest(".share-opportunity-btn[data-share-id]");
    if (shareButton) shareOpportunity(shareButton.dataset.shareId);

    if (event.target.id === "weekly-plan-reset") {
      writePortalStorage(YP_STORAGE.weeklyPlan, { weekOf: getWeekStartKey(), completed: [] });
      renderWeeklyPlan();
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-tracker-stage]")) setTrackedApplication(event.target.dataset.trackerStage, event.target.value, false);
    if (event.target.matches("[data-detail-tracker-stage]")) setTrackedApplication(event.target.dataset.detailTrackerStage, event.target.value, false);
    if (event.target.matches("[data-weekly-task]")) {
      const state = getWeeklyPlanState();
      const id = event.target.dataset.weeklyTask;
      const completed = new Set(state.completed);
      if (event.target.checked) completed.add(id); else completed.delete(id);
      const next = { weekOf: state.weekOf, completed: [...completed] };
      writePortalStorage(YP_STORAGE.weeklyPlan, next);
      updateWeeklyPlanProgress(next);
    }
  });

  const alertForm = document.getElementById("email-alert-form");
  if (alertForm) {
    alertForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = document.getElementById("email-alert-status");
      if (status) status.textContent = "Mock-up complete. No email address was stored and no notifications were sent.";
      alertForm.reset();
    });
  }
}

document.addEventListener("DOMContentLoaded", setupPortalFeatures);
