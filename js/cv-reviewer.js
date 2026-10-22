(() => {
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TEXT_CHARACTERS = 200000;
  const MAX_PDF_PAGES = 20;
  const libraryLoads = new Map();
  const ACTION_VERBS = [
    "built", "created", "designed", "developed", "organised", "organized", "coordinated",
    "managed", "led", "launched", "improved", "increased", "reduced", "analysed",
    "analyzed", "supported", "assisted", "delivered", "trained", "researched", "resolved",
    "implemented", "maintained", "prepared", "presented", "collaborated", "achieved", "produced"
  ];
  const STOP_WORDS = new Set(`
    about above after again against all also among an and any are around as at back be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves role job company team opportunity position work apply application experience required requirement requirements skills skill knowledge duties responsibilities candidate candidates ideal successful must preferred qualification qualifications
  `.toLowerCase().split(/\s+/));

  document.addEventListener("DOMContentLoaded", initDocumentReviewer);

  function initDocumentReviewer() {
    const form = document.getElementById("document-review-form");
    if (!form) return;

    const input = document.getElementById("document-file");
    const zone = document.getElementById("document-dropzone");
    const results = document.getElementById("review-results");
    const error = document.getElementById("review-error");
    const status = document.getElementById("review-status");
    const selectedFile = document.getElementById("selected-file");
    const prompt = document.getElementById("upload-prompt");
    const submit = document.getElementById("review-submit");

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      showSelectedFile(file);
      clearMessages();
      results.hidden = true;
      results.replaceChildren();
    });

    ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove("drag-over");
    }));
    zone.addEventListener("drop", (event) => {
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      showSelectedFile(file);
      clearMessages();
      results.hidden = true;
      results.replaceChildren();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessages();
      results.hidden = true;
      results.replaceChildren();
      const file = input.files && input.files[0];
      if (!file) {
        showError("Choose a CV or cover-letter file before starting the check.");
        input.focus();
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        showError("This file is larger than 10 MB. Choose a smaller version and try again.");
        return;
      }

      submit.disabled = true;
      submit.textContent = "Reading on this device…";
      status.textContent = "Extracting document text in your browser. Your file is not being uploaded.";
      try {
        const extracted = await extractDocumentText(file);
        const documentType = document.getElementById("document-type").value;
        const jobDescription = document.getElementById("job-description").value.trim();
        const review = reviewDocument(extracted.text, documentType, jobDescription, extracted.pages);
        renderResults(review, file.name, documentType, extracted.pages);
        results.hidden = false;
        status.textContent = "Quick review complete. Use the suggestions as a checklist and make changes in your own document.";
        results.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (cause) {
        showError(cause && cause.message ? cause.message : "We could not read this file. Try a text-based PDF, DOCX, or TXT file.");
        status.textContent = "No review was produced. Your document was not uploaded.";
      } finally {
        submit.disabled = false;
        submit.textContent = "Review my document";
      }
    });

    function showSelectedFile(file) {
      if (!file) {
        selectedFile.hidden = true;
        selectedFile.textContent = "";
        prompt.textContent = "Choose a file or drop it here";
        return;
      }
      selectedFile.textContent = `${file.name} · ${formatBytes(file.size)}`;
      selectedFile.hidden = false;
      prompt.textContent = "Document selected";
    }

    function clearMessages() {
      error.hidden = true;
      error.textContent = "";
      status.textContent = "";
    }

    function showError(message) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  async function extractDocumentText(file) {
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "docx", "txt"].includes(extension)) {
      throw new Error("This file type is not supported. Please choose a PDF, DOCX, or TXT file.");
    }

    let text = "";
    let pages = null;
    if (extension === "txt") {
      text = await file.text();
    } else if (extension === "docx") {
      await loadLocalLibrary("js/vendor/mammoth.browser.min.js", "mammoth", "DOCX");
      const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      text = result.value || "";
    } else {
      await loadLocalLibrary("js/vendor/pdf.min.js", "pdfjsLib", "PDF");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
      let pdf;
      try {
        pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        pages = pdf.numPages;
        if (pages > MAX_PDF_PAGES) throw new Error(`This PDF has ${pages} pages. For a quicker local check, choose a PDF with ${MAX_PDF_PAGES} pages or fewer.`);
        const pageText = [];
        for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          pageText.push(content.items.map((item) => item.str || "").join(" "));
        }
        text = pageText.join("\n");
      } catch (cause) {
        if (cause && cause.message && cause.message.startsWith("This PDF has ")) throw cause;
        if (cause && cause.name === "PasswordException") throw new Error("This PDF is password-protected. Save an unlocked copy and try again.");
        throw new Error("We could not read this PDF. It may be damaged, encrypted, or a scanned image without selectable text.");
      } finally {
        if (pdf) await pdf.destroy();
      }
    }

    text = String(text).replace(/\u0000/g, " ").slice(0, MAX_TEXT_CHARACTERS).trim();
    if (text.length < 40) {
      throw new Error("There is not enough selectable text to review. If this is a scanned PDF, use an OCR/text version or upload a DOCX or TXT file.");
    }
    return { text, pages };
  }

  function loadLocalLibrary(src, globalName, label) {
    if (window[globalName]) return Promise.resolve();
    if (!libraryLoads.has(src)) {
      libraryLoads.set(src, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => window[globalName]
          ? resolve()
          : reject(new Error(`The ${label} reader did not initialize. Refresh the page and try again.`));
        script.onerror = () => reject(new Error(`The ${label} reader could not load from the local site files. Refresh the page and try again.`));
        document.head.appendChild(script);
      }));
    }
    return libraryLoads.get(src);
  }

  function reviewDocument(source, type, jobDescription, pages) {
    const text = source.replace(/\r/g, "\n").replace(/[\t ]+/g, " ");
    const lower = text.toLowerCase();
    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const wordCount = words.length;
    const checks = [];
    const add = (good, title, detail) => checks.push({ good, title, detail });
    const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
    const hasPhone = /(?:\+?27|0)\s?(?:\(?\d{2,3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(text);
    const hasPlaceholders = /\[(?:your|insert|add|role|company|organisation|organization|name|date|skill|example|contact)[^\]]*\]|\b(?:your full name|insert here|lorem ipsum)\b/i.test(text);
    const actionTerms = ACTION_VERBS.filter((verb) => new RegExp(`\\b${verb}\\b`, "i").test(text));
    const hasNumbers = /\b\d+(?:[.,]\d+)?\s?(?:%|percent|rand|zar|people|learners|customers|clients|projects|hours|weeks|months|years|employees|members|items|sales|budget|students)\b|\b\d+\s?(?:%|R\s?\d)/i.test(text);
    const headings = {
      profile: /\b(profile|professional summary|summary|objective)\b/i.test(text),
      experience: /\b(experience|employment|work history|projects|volunteer|internship)\b/i.test(text),
      education: /\b(education|qualifications?|training|certifications?|matric|degree|diploma)\b/i.test(text),
      skills: /\b(skills|technical skills|core competencies)\b/i.test(text)
    };
    const jobTerms = getJobTerms(jobDescription);
    const missingTerms = jobTerms.filter((term) => !new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(lower)).slice(0, 5);

    if (type === "cv") {
      add(hasEmail && hasPhone, "Contact details", hasEmail && hasPhone
        ? "An email address and phone number appear in the document. Check that both are current and professional."
        : `Add the missing ${[!hasEmail && "email address", !hasPhone && "phone number"].filter(Boolean).join(" and ")}. Keep sensitive numbers such as your ID and bank account off your CV.`);
      add(headings.experience, "Experience or projects", headings.experience
        ? "A section for work, projects or volunteering is present. Put the most relevant examples first."
        : "Add an Experience, Projects, Volunteering or Responsibilities section. Relevant school work, community activities, personal projects and real responsibilities can show skills even without a formal job.");
      add(headings.education, "Education and qualifications", headings.education
        ? "Education or qualifications are included. Check that dates and qualification names are accurate."
        : "Add your education, training or qualifications, including the institution and completion date (or expected date).");
      add(headings.skills, "Relevant skills", headings.skills
        ? "A skills section is present. Prioritise skills that you can support with examples."
        : "Add a concise Skills section and connect important skills to a project or experience elsewhere in the CV.");
      add(actionTerms.length >= 2, "Action-led writing", actionTerms.length >= 2
        ? `Action words detected (${actionTerms.slice(0, 5).join(", ")}). Make sure each bullet explains your own contribution.`
        : "Start experience and project bullets with specific verbs such as built, organised, assisted, designed or analysed.");
      add(hasNumbers, "Evidence of impact", hasNumbers
        ? "At least one number or measurable result appears. Make sure it is accurate and explain what the number represents."
        : "Add a truthful measure where possible: people supported, tasks completed, time saved, project size or a result achieved.");
      add(wordCount >= 140 && wordCount <= 850, "Length and focus", wordCount < 140
        ? `The extracted document has about ${wordCount} words. Add relevant evidence if important experience is missing. Early-career CVs are often 1–2 pages, but relevance matters more than a strict limit.`
        : wordCount > 850
          ? `The extracted document has about ${wordCount} words. Consider removing repeated or unrelated detail; early-career CVs are often 1–2 pages.`
          : `The extracted document has about ${wordCount} words. Review it for relevance and keep the layout easy to scan.`);
      if (pages !== null) add(pages <= 2, "PDF page count", pages <= 2
        ? `The PDF has ${pages} ${pages === 1 ? "page" : "pages"}. Reopen the exported file to check spacing and readability.`
        : `The PDF has ${pages} pages. For an early-career application, consider shortening it to the most relevant 1–2 pages.`);
      add(!hasPlaceholders, "Template cleanup", !hasPlaceholders
        ? "No common template placeholders were detected. Give the file one final proofread before sending."
        : "Replace template prompts such as [Your Name] or [Role] with your own details, then remove any instructions left in the document.");
    } else {
      const hasGreeting = /\b(dear\s+(?:[\w'-]+|hiring team|recruitment team)|hello\s+[\w'-]+)\b/i.test(text);
      const hasRoleIntent = /\b(applying for|application for|apply for|interested in the position|interested in the role|opportunity)\b/i.test(text);
      const hasOrganisationReason = /\b(why|because|mission|organisation|organization|company|team|programme|program)\b/i.test(text);
      const hasClosing = /\b(kind regards|best regards|regards|sincerely|yours faithfully|thank you for your consideration)\b/i.test(text);
      add(hasEmail || hasPhone, "Contact details", hasEmail || hasPhone
        ? "At least one contact method appears. Include a reliable email address and check the phone number if you provide one."
        : "Add your name and a reliable email address (and phone number if appropriate) so the reader can contact you.");
      add(hasGreeting, "Greeting", hasGreeting
        ? "A greeting is included. Use the contact person’s name if it is publicly available; otherwise, a general hiring-team greeting is appropriate."
        : "Add a professional greeting such as “Dear Hiring Team” or the contact person’s name when it is known.");
      add(hasRoleIntent, "Role and purpose", hasRoleIntent
        ? "The letter indicates that you are applying. Make the exact role and organisation easy to identify near the start."
        : "State the specific role and organisation in the opening so the reader immediately knows what you are applying for.");
      add(hasOrganisationReason, "Why this opportunity", hasOrganisationReason
        ? "There are signs of a reason or organisation context. Make it specific to this role rather than a generic compliment."
        : "Add one genuine reason this organisation or opportunity interests you. Refer to a relevant programme, service or goal.");
      add(actionTerms.length > 0 && hasNumbers, "Evidence and impact", actionTerms.length > 0 && hasNumbers
        ? "Action language and a measurable detail are present. Explain your part and keep the example relevant to the role."
        : "Include one short example of something you did, using a clear action and an honest result or outcome where possible.");
      add(hasClosing, "Professional close", hasClosing
        ? "A professional closing appears. Check it is followed by your name."
        : "Close by thanking the reader and expressing interest in a conversation, then sign off with your name.");
      add(wordCount >= 120 && wordCount <= 420, "Length and focus", wordCount < 120
        ? `The letter has about ${wordCount} words. Add a specific example and why you fit, while keeping it concise.`
        : wordCount > 420
          ? `The letter has about ${wordCount} words. Consider trimming repetition; a focused cover letter is often around 3–5 short paragraphs.`
          : `The letter has about ${wordCount} words. Check that every paragraph supports your fit for this opportunity.`);
      add(!hasPlaceholders, "Template cleanup", !hasPlaceholders
        ? "No common template placeholders were detected. Check names, role title and organisation spelling once more."
        : "Replace template prompts such as [Role] or [Your Name] with accurate details before sending.");
    }

    const good = checks.filter((item) => item.good);
    const improvements = checks.filter((item) => !item.good);
    if (jobDescription) {
      if (!jobTerms.length) {
        improvements.push({ good: false, title: "Opportunity keywords", detail: "The description was too short or general for a useful keyword comparison. Paste the main responsibilities and requirements if you want this check." });
      } else if (missingTerms.length) {
        improvements.push({ good: false, title: "Terms to compare with the opportunity", detail: `These terms from the description were not found: ${missingTerms.join(", ")}. Add them only if they honestly describe your experience.` });
      } else {
        good.push({ good: true, title: "Opportunity keywords", detail: "The main terms identified from the description also appear in the document. Check that each is supported by a clear example." });
      }
    }

    return { good, improvements, wordCount, truncated: source.length >= MAX_TEXT_CHARACTERS };
  }

  function renderResults(review, fileName, type, pages) {
    const results = document.getElementById("review-results");
    const goodItems = review.good.map((item) => `<li class="review-item"><span class="review-item-mark" aria-hidden="true">✓</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></li>`).join("");
    const improvementItems = review.improvements.map((item) => `<li class="review-item"><span class="review-item-mark" aria-hidden="true">→</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></li>`).join("");
    const kind = type === "cv" ? "CV" : "Cover letter";
    results.innerHTML = `
      <div class="review-results-heading">
        <div><p class="section-kicker">Quick scan · ${kind}</p><h3 id="review-results-title">Your review notes</h3><p class="review-file-name">${escapeHtml(fileName)} · about ${review.wordCount} words${pages ? ` · ${pages} PDF ${pages === 1 ? "page" : "pages"}` : ""}</p></div>
        <span class="review-count">${review.good.length} positive · ${review.improvements.length} to review</span>
      </div>
      <p class="review-disclaimer">These are text-based prompts, not a score or a hiring prediction. Read each suggestion and decide what fits your real experience.</p>
      ${review.good.length ? `<div class="review-group review-positive"><h4>Good signals</h4><ul>${goodItems}</ul></div>` : ""}
      ${review.improvements.length ? `<div class="review-group review-improve"><h4>Ideas to strengthen</h4><ul>${improvementItems}</ul></div>` : `<div class="review-all-clear"><strong>Good starting point.</strong> No checklist gaps were detected by this quick scan. A careful human proofread is still worthwhile.</div>`}
      ${review.truncated ? '<p class="review-disclaimer">Only the first 200,000 characters were checked. Review the rest of your document manually.</p>' : ""}
      <button type="button" class="btn-secondary review-clear" id="clear-document-review">Clear document and review</button>
    `;
    results.querySelector("#clear-document-review").addEventListener("click", () => {
      document.getElementById("document-review-form").reset();
      document.getElementById("selected-file").hidden = true;
      document.getElementById("selected-file").textContent = "";
      document.getElementById("upload-prompt").textContent = "Choose a file or drop it here";
      results.hidden = true;
      results.replaceChildren();
      document.getElementById("review-status").textContent = "The document and review notes have been cleared from this page.";
      document.getElementById("document-file").focus();
    });
  }

  function getJobTerms(description) {
    const counts = new Map();
    const tokens = description.toLowerCase().match(/[a-z][a-z+#.-]{2,}/g) || [];
    tokens.forEach((raw) => {
      const word = raw.replace(/^[+.#-]+|[+.#-]+$/g, "");
      if (word.length < 4 || STOP_WORDS.has(word) || /^\d+$/.test(word)) return;
      counts.set(word, (counts.get(word) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([word]) => word);
  }

  function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
})();
