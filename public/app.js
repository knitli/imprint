// SPDX-License-Identifier: AGPL-3.0-only
// Progressive enhancement only: every page works without this script.
(() => {
  // After a refused save, move focus to the error summary so screen reader
  // and keyboard users hear what went wrong first.
  const summary = document.getElementById("error-summary");
  if (summary) {
    summary.focus();
    return;
  }
  // Links from the checks list go to a field on another page. Focus it.
  if (location.hash.startsWith("#f-")) {
    const target = document.getElementById(location.hash.slice(1));
    if (target && typeof target.focus === "function") target.focus();
  }
})();

// Show only the fields that apply to the chosen option, for example the date
// field when "On a date" is selected. Without this script every field shows,
// and the server ignores fields that do not apply.
(() => {
  const groups = [...document.querySelectorAll("[data-show-when]")];
  if (!groups.length) return;
  const update = () => {
    for (const g of groups) {
      const [name, value] = g.getAttribute("data-show-when").split("=");
      const checked = document.querySelector(`input[name="${name}"]:checked`);
      g.hidden = !checked || checked.value !== value;
    }
  };
  document.addEventListener("change", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === "radio") update();
  });
  update();
})();
