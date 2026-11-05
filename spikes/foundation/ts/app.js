// Minimal page: SP-07 covers the real UI. Validation runs on the local server,
// so this page needs no 'unsafe-eval'.
const $ = (id) => document.getElementById(id);
async function load() {
  const guide = await (await fetch("/api/guide")).json();
  $("title").textContent = guide.title;
  $("entries").replaceChildren(...guide.entries.map((e) => {
    const li = document.createElement("li");
    li.textContent = `${e.entry_id}: ${e.level ?? "range"} — ${e.description}`;
    return li;
  }));
  const { findings, approval_ready } = await (await fetch("/api/findings")).json();
  $("findings").replaceChildren(...findings.map((f) => {
    const li = document.createElement("li");
    li.textContent = `${f.severity} ${f.code} at ${f.pointer}: ${f.message}`;
    return li;
  }));
  $("freeze").disabled = !approval_ready;
}
$("freeze").addEventListener("click", async () => {
  const r = await (await fetch("/api/freeze", { method: "POST" })).json();
  $("result").textContent = r.digest ? `Frozen. Digest ${r.digest.value}` : r.error;
});
load();
