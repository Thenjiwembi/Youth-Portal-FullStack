document.addEventListener("DOMContentLoaded", setupExperienceBuilder);

function setupExperienceBuilder() {
  const form = document.getElementById("experience-builder-form");
  if (!form) return;
  const output = document.getElementById("experience-bullet-output");
  const status = document.getElementById("experience-builder-status");
  const copyButton = document.getElementById("copy-experience-bullet");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const kind = document.getElementById("experience-kind").value.trim();
    const action = document.getElementById("experience-action").value.trim().replace(/[.\s]+$/, "");
    const context = document.getElementById("experience-context").value.trim().replace(/[.\s]+$/, "");
    const skill = document.getElementById("experience-skill").value.trim().replace(/[.\s]+$/, "");
    const outcome = document.getElementById("experience-result").value.trim().replace(/[.\s]+$/, "");
    if (!action || !context || !skill) {
      status.textContent = "Add what you did, the context and a skill you genuinely used.";
      return;
    }

    output.value = `• ${action} (${kind.toLowerCase()}) — ${context}. Skills: ${skill}.${outcome ? ` Evidence/result: ${outcome}.` : ""}`;
    copyButton.disabled = false;
    status.textContent = "Draft built from your words. Check every detail and edit it for the role before using it.";
    output.focus();
  });

  document.getElementById("clear-experience-bullet").addEventListener("click", () => {
    form.reset();
    output.value = "";
    copyButton.disabled = true;
    status.textContent = "Your draft was cleared. Nothing was saved.";
  });

  copyButton.addEventListener("click", async () => {
    if (!output.value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(output.value);
      } else {
        output.focus();
        output.select();
        if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      }
      status.textContent = "Copied. Review the bullet and tailor it before adding it to your CV.";
    } catch {
      output.focus();
      output.select();
      status.textContent = "Copy is unavailable here. The text is selected so you can copy it manually.";
    }
  });
}
