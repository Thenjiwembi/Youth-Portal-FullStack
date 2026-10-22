document.addEventListener("DOMContentLoaded", () => {
  renderFeaturedOpportunities();
  renderUpcomingDeadlines();
  renderSavedOpportunities();
  renderRecentlyViewed();
  setupSearchForm();
  setupOpportunityMatcher();
  setupCareerResources();
  document.addEventListener("portal:saved-change", renderSavedOpportunities);
});

function getActiveOpportunities() {
  return opportunitiesData.filter((opp) => isOpportunityCurrentlyVisible(opp))
    .sort((a, b) => {
      const verifiedFirst = Number(getOpportunityVerificationState(b) === "verified") - Number(getOpportunityVerificationState(a) === "verified");
      return verifiedFirst || a.closingDate.localeCompare(b.closingDate);
    });
}

function renderFeaturedOpportunities() {
  const container = document.getElementById("featured-grid");
  if (!container) return;

  const featuredList = getActiveOpportunities().slice(0, 3);
  container.innerHTML = featuredList.length
    ? featuredList.map(createCardHTML).join("")
    : '<p class="empty-state">There are no current listings to show. Check again later or explore official opportunity sources.</p>';
}

function renderUpcomingDeadlines() {
  const container = document.getElementById("deadlines-grid");
  if (!container) return;

  const upcoming = [...getActiveOpportunities()]
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate))
    .slice(0, 3);
  container.innerHTML = upcoming.length
    ? upcoming.map(createCardHTML).join("")
    : '<p class="empty-state">No current closing dates to show.</p>';
}

function renderSavedOpportunities() {
  const section = document.getElementById("saved-section");
  const container = document.getElementById("saved-grid");
  if (!section || !container || typeof getSavedOpportunityIds !== "function") return;
  const ids = getSavedOpportunityIds();
  const saved = ids.map((id) => opportunitiesData.find((item) => String(item.id) === String(id))).filter(Boolean);
  section.hidden = saved.length === 0;
  container.innerHTML = saved.map(createCardHTML).join("");
}

function renderRecentlyViewed() {
  const section = document.getElementById("recent-section");
  const container = document.getElementById("recent-grid");
  if (!section || !container || typeof getRecentOpportunityIds !== "function") return;
  const ids = getRecentOpportunityIds();
  const recentlyViewed = ids.map((id) => opportunitiesData.find((item) => String(item.id) === String(id))).filter(Boolean);
  section.hidden = recentlyViewed.length === 0;
  container.innerHTML = recentlyViewed.map(createCardHTML).join("");
}

function createCardHTML(opp) {
  const countdown = getOpportunityCountdown(opp.closingDate);
  const saved = isOpportunitySaved(opp.id);
  const tracked = isOpportunityTracked(opp.id);
  const verificationState = getOpportunityVerificationState(opp);
  const sourceInfo = verificationState === "verified"
    ? `<p class="card-updated">Checked ${formatPortalDate(opp.verifiedAt)} · <a href="${escapePortalHTML(opp.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official source ↗</a></p>`
    : verificationState === "stale"
      ? '<p class="card-updated">Source check is older than 7 days; recheck before relying on it.</p>'
      : '<p class="card-updated">Fictional sample — not a live vacancy.</p>';
  return `
    <article class="card">
      ${getOpportunityBadgeHTML(opp)}
      <div>
        <span class="card-tag">${opp.category}</span>
        <h3 class="card-title">${opp.title}</h3>
        <p class="card-org">${opp.organisation}</p>
        <p class="card-meta">📍 ${opp.location}<br>🎓 ${opp.experienceLevel}<br>⏳ Closes: <strong>${formatPortalDate(opp.closingDate)}</strong></p>
        <span class="deadline-countdown ${countdown.soon ? "closing-soon" : ""}">${countdown.text}</span>
        <p class="card-desc">${opp.shortDescription}</p>
        ${sourceInfo}
      </div>
      <div class="card-actions">
        <a href="opportunity-details.html?id=${encodeURIComponent(opp.id)}" class="btn-primary card-action">View Details</a>
        <button type="button" class="save-opportunity-btn ${saved ? "is-saved" : ""}" data-save-id="${opp.id}" aria-pressed="${saved}" aria-label="${saved ? "Remove saved opportunity" : "Save opportunity"}"><span aria-hidden="true">★</span><span class="save-label">${saved ? "Saved" : "Save"}</span></button>
        <button type="button" class="track-opportunity-btn ${tracked ? "is-tracked" : ""}" data-track-id="${opp.id}" aria-pressed="${tracked}" aria-label="${tracked ? "Remove from application tracker" : "Track this opportunity"}"><span aria-hidden="true">${tracked ? "✓" : "+"}</span><span class="track-label">${tracked ? "In tracker" : "Track"}</span></button>
        <button type="button" class="share-opportunity-btn" data-share-id="${opp.id}" aria-label="Share ${opp.title}"><span aria-hidden="true">↗</span><span class="visually-hidden">Share</span></button>
      </div>
    </article>
  `;
}

function setupOpportunityMatcher() {
  const form = document.getElementById("opportunity-match-form");
  if (!form) return;
  const resultContainer = document.getElementById("match-results");
  const status = document.getElementById("matcher-feedback");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const category = document.getElementById("match-category").value;
    const location = document.getElementById("match-location").value.trim().toLowerCase();
    const level = document.getElementById("match-level").value;
    const keywords = document.getElementById("match-interests").value.toLowerCase().split(/[\s,;]+/).filter((word) => word.length > 2);
    if (!category && !location && !level && !keywords.length) {
      status.textContent = "Choose at least one preference to get useful matches.";
      resultContainer.hidden = true;
      return;
    }

    const matches = getActiveOpportunities().map((opportunity) => {
      const reasons = [];
      let score = 0;
      if (category) {
        if (opportunity.category !== category) return null;
        score += 6;
        reasons.push("category");
      }
      if (location) {
        const listingLocation = opportunity.location.toLowerCase();
        const nationwide = listingLocation.includes("south afric") || listingLocation.includes("nationwide");
        if (!listingLocation.includes(location) && !nationwide) return null;
        score += listingLocation.includes(location) ? 5 : 2;
        reasons.push("location");
      }
      if (level) {
        if (opportunity.experienceLevel !== level) return null;
        score += 5;
        reasons.push("experience level");
      }
      if (keywords.length) {
        const searchable = [opportunity.title, opportunity.organisation, opportunity.category, opportunity.location, opportunity.shortDescription, opportunity.fullDescription, ...(opportunity.requirements || [])].join(" ").toLowerCase();
        const found = [...new Set(keywords)].filter((word) => searchable.includes(word));
        if (!found.length) return null;
        score += found.length * 2;
        reasons.push(`${found.length} interest${found.length === 1 ? "" : "s"}`);
      }
      if (getOpportunityVerificationState(opportunity) === "verified") score += 1;
      return { opportunity, score, reasons };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.opportunity.closingDate.localeCompare(b.opportunity.closingDate)).slice(0, 3);

    resultContainer.hidden = false;
    if (!matches.length) {
      status.textContent = "No current listings matched those preferences. Try another location, category or interest.";
      resultContainer.innerHTML = "";
      return;
    }
    status.textContent = `${matches.length} possible match${matches.length === 1 ? "" : "es"}. Check each listing’s source and requirements before applying.`;
    resultContainer.innerHTML = matches.map(({ opportunity, reasons }) => createCardHTML(opportunity).replace('<div class="card-actions">', `<p class="match-reason"><strong>Why it may fit:</strong> Matches your ${reasons.join(", ")}.</p><div class="card-actions">`)).join("");
  });

  const useProfileButton = document.getElementById("use-profile-match");
  if (useProfileButton) {
    useProfileButton.addEventListener("click", () => {
      let profile = null;
      try { profile = JSON.parse(localStorage.getItem("userProfile") || "null"); } catch { profile = null; }
      if (!profile || typeof profile !== "object") {
        status.textContent = "No local profile found. Add your location and interests above, or create a profile first.";
        return;
      }
      document.getElementById("match-location").value = profile.location || "";
      document.getElementById("match-interests").value = [profile.skills, profile.interests, profile.qualification].filter(Boolean).join(", ");
      status.textContent = "Filled from the profile stored in this browser. Nothing was sent to a server.";
    });
  }
}

function setupSearchForm() {
  const searchForm = document.getElementById("home-search-form");
  if (!searchForm) return;

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const keyword = document.getElementById("search-keyword").value.trim();
    const category = document.getElementById("search-category").value;
    const location = document.getElementById("search-location").value.trim();
    const params = new URLSearchParams();
    if (keyword) params.set("search", keyword);
    if (category) params.set("category", category);
    if (location) params.set("location", location);
    const query = params.toString();
    window.location.href = `opportunities.html${query ? `?${query}` : ""}`;
  });
}

function setupCareerResources() {
  const resourceButtons = [
    { id: "download-cv-btn", handler: downloadCVTemplate },
    { id: "view-cover-letter-btn", handler: () => openResourceModal("Cover Letter Sample", coverLetterTemplate()) },
    { id: "read-guideline-btn", handler: () => openResourceModal("Interview Preparation Guidelines", guidelineTemplate()) }
  ];

  resourceButtons.forEach(({ id, handler }) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handler();
    });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".close-btn") || event.target.id === "resource-modal") {
      closeResourceModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeResourceModal();
  });
}

function downloadCVTemplate() {
  const fileContent = `YOUR FULL NAME
City, South Africa | phone | email | LinkedIn | Portfolio

PROFESSIONAL SUMMARY
Write a short summary tailored to the opportunity.

EDUCATION
Qualification | Institution | Year

SKILLS
List relevant skills with examples.

EXPERIENCE & PROJECTS
Role or project | Dates
Describe your contribution and results.`;
  const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "Youth_Portal_CV_Template.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function coverLetterTemplate() {
  return `
    <div class="sample-letter">
      <p><strong>[Your Full Name]</strong><br>[City] | [Email] | [Phone]</p>
      <hr>
      <p><strong>Dear Hiring Team,</strong></p>
      <p>I am applying for [opportunity title]. My experience in [relevant skill or project] has prepared me to contribute to [organisation/team].</p>
      <p>I am particularly interested in this opportunity because [specific reason]. I would welcome the opportunity to discuss how my skills and motivation fit your requirements.</p>
      <p>Thank you for considering my application.</p>
      <p>Sincerely,<br><strong>[Your Name]</strong></p>
    </div>
  `;
}

function guidelineTemplate() {
  return `
    <div class="guidelines-content">
      <h4>Before your interview</h4>
      <ul>
        <li><strong>Research the organisation:</strong> Use its official website and verify the role.</li>
        <li><strong>Review the listing:</strong> Match your skills and examples to its requirements.</li>
        <li><strong>Use STAR:</strong> Explain the Situation, Task, Action, and Result in your examples.</li>
        <li><strong>Prepare questions:</strong> Ask about responsibilities, support, and next steps.</li>
        <li><strong>Stay safe:</strong> Never pay recruitment, interview, or placement fees.</li>
      </ul>
    </div>
  `;
}

function openResourceModal(title, htmlContent) {
  let modal = document.getElementById("resource-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "resource-modal";
    modal.className = "modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "resource-modal-title");
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="resource-modal-title">${title}</h3>
        <button type="button" class="close-btn" aria-label="Close dialog">&times;</button>
      </div>
      <div class="modal-body">${htmlContent}</div>
    </div>
  `;
  modal.style.display = "flex";
  modal.querySelector(".close-btn").focus();
}

function closeResourceModal() {
  const modal = document.getElementById("resource-modal");
  if (!modal) return;
  modal.style.display = "none";
  modal.innerHTML = "";
}
