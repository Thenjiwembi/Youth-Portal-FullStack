document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contact-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    document.getElementById("success-message").style.display = "block";
    form.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});
