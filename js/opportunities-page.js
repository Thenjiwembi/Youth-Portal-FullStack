document.addEventListener("DOMContentLoaded", async () => {
  try { const response = await fetch('/api/opportunities', { credentials: 'same-origin' }); if (response.ok) { const result = await response.json(); window.opportunitiesData = result.opportunities; } } catch { /* Keep the preserved local dataset available if the API is temporarily unavailable. */ }
  const keywordInput = document.getElementById("filter-keyword");
  const categorySelect = document.getElementById("filter-category");
  const locationSelect = document.getElementById("filter-location");
  const experienceSelect = document.getElementById("filter-experience");
  const listingStatusSelect = document.getElementById("filter-listing-status");
  const closingDateInput = document.getElementById("filter-closing-date");
  const resetButton = document.getElementById("reset-filters");
  const savedOnlyButton = document.getElementById("saved-only-btn");
  const grid = document.getElementById("opportunities-grid");
  const countEl = document.getElementById("results-count");

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("search")) keywordInput.value = urlParams.get("search");
  if (urlParams.get("category")) categorySelect.value = urlParams.get("category");
  if (urlParams.get("location")) locationSelect.value = urlParams.get("location");
  if (urlParams.get("closingBefore")) closingDateInput.value = urlParams.get("closingBefore");
  let showSavedOnly = urlParams.get("saved") === "1";

  function updateSavedFilterButton() {
    savedOnlyButton.setAttribute("aria-pressed", String(showSavedOnly));
    savedOnlyButton.innerHTML = `${showSavedOnly ? "★ Showing saved" : "☆ Show saved"} <span class="saved-count" data-saved-count>${getSavedOpportunityIds().length}</span>`;
  }

  function filterAndRender() {
    const kw = keywordInput.value.toLowerCase().trim();
    const cat = categorySelect.value;
    const loc = locationSelect.value;
    const exp = experienceSelect.value;
    const listingStatus = listingStatusSelect.value;
    const closingBefore = closingDateInput.value;
    const savedIds = getSavedOpportunityIds();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const filtered = opportunitiesData.filter(item => {
      const closingDate = new Date(`${item.closingDate}T00:00:00`);
      const searchable = [item.title, item.organisation, item.category, item.location, item.experienceLevel, item.shortDescription, item.fullDescription, item.sourceName, ...(item.requirements || [])];
      const matchesKw = !kw || searchable.some(value => String(value || "").toLowerCase().includes(kw));
      const matchesCat = !cat || item.category === cat;
      const matchesLoc = !loc || item.location.toLowerCase().includes(loc.toLowerCase());
      const matchesExp = !exp || item.experienceLevel === exp;
      const isActive = !Number.isNaN(closingDate.getTime()) && closingDate >= today && isOpportunityCurrentlyVisible(item);
      const trustState = getOpportunityVerificationState(item);
      const matchesTrust = listingStatus === "all" || (listingStatus === "verified" && trustState === "verified") || (listingStatus === "sample" && trustState === "sample");
      const matchesClosingDate = !closingBefore || item.closingDate <= closingBefore;
      const matchesSaved = !showSavedOnly || savedIds.includes(String(item.id));
      return isActive && matchesTrust && matchesKw && matchesCat && matchesLoc && matchesExp && matchesClosingDate && matchesSaved;
    }).sort((a, b) => {
      const verifiedFirst = Number(getOpportunityVerificationState(b) === "verified") - Number(getOpportunityVerificationState(a) === "verified");
      return verifiedFirst || a.closingDate.localeCompare(b.closingDate);
    });

    const verifiedCount = filtered.filter((item) => getOpportunityVerificationState(item) === "verified").length;
    countEl.textContent = `Showing ${filtered.length} ${filtered.length === 1 ? 'opportunity' : 'opportunities'} · ${verifiedCount} source-checked`;

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty-state"><h3 style="color: var(--space-kadet); margin-bottom: 0.5rem;">No matching opportunities found</h3><p style="color: var(--text-muted);">Try clearing a filter or search an official source below. Source checks older than seven days are hidden automatically.</p></div>`;
      return;
    }

    grid.innerHTML = filtered.map(opp => {
      const countdown = getOpportunityCountdown(opp.closingDate);
      const saved = isOpportunitySaved(opp.id);
      const tracked = isOpportunityTracked(opp.id);
      const sourceState = getOpportunityVerificationState(opp);
      const sourceInfo = sourceState === "verified" ? `<p class="card-updated">Checked ${formatPortalDate(opp.verifiedAt)} · <a href="${escapePortalHTML(opp.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a></p>` : '<p class="card-updated">Fictional sample — not a live vacancy.</p>';
      return `<article class="card">${getOpportunityBadgeHTML(opp)}<div><span class="card-tag">${opp.category}</span><h3 class="card-title">${opp.title}</h3><p class="card-org">${opp.organisation}</p><p class="card-meta">📍 ${opp.location}<br>🎓 ${opp.experienceLevel}<br>⏳ Closes: <strong>${formatPortalDate(opp.closingDate)}</strong></p><span class="deadline-countdown ${countdown.soon ? "closing-soon" : ""}">${countdown.text}</span><p class="card-desc">${opp.shortDescription}</p>${sourceInfo}</div><div class="card-actions"><a href="opportunity-details.html?id=${encodeURIComponent(opp.id)}" class="btn-primary card-action">View Details</a><button type="button" class="save-opportunity-btn ${saved ? "is-saved" : ""}" data-save-id="${opp.id}" aria-pressed="${saved}" aria-label="${saved ? "Remove saved opportunity" : "Save opportunity"}"><span aria-hidden="true">★</span><span class="save-label">${saved ? "Saved" : "Save"}</span></button><button type="button" class="track-opportunity-btn ${tracked ? "is-tracked" : ""}" data-track-id="${opp.id}" aria-pressed="${tracked}" aria-label="${tracked ? "Remove from application tracker" : "Track this opportunity"}"><span aria-hidden="true">${tracked ? "✓" : "+"}</span><span class="track-label">${tracked ? "In tracker" : "Track"}</span></button><button type="button" class="share-opportunity-btn" data-share-id="${opp.id}" aria-label="Share ${opp.title}"><span aria-hidden="true">↗</span><span class="visually-hidden">Share</span></button></div></article>`;
    }).join("");
  }

  [keywordInput, categorySelect, locationSelect, experienceSelect, listingStatusSelect, closingDateInput].forEach(el => { el.addEventListener("input", filterAndRender); el.addEventListener("change", filterAndRender); });
  resetButton.addEventListener("click", () => { keywordInput.value = ""; categorySelect.value = ""; locationSelect.value = ""; experienceSelect.value = ""; listingStatusSelect.value = "all"; closingDateInput.value = ""; showSavedOnly = false; updateSavedFilterButton(); filterAndRender(); });
  savedOnlyButton.addEventListener("click", () => { showSavedOnly = !showSavedOnly; updateSavedFilterButton(); filterAndRender(); });
  document.addEventListener("portal:saved-change", () => { updateSavedFilterButton(); filterAndRender(); });
  updateSavedFilterButton(); filterAndRender();
});
