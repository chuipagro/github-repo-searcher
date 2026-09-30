const MAX_RESULTS = 100;

const $query = document.getElementById("query");
const $results = document.getElementById("results");
const $status = document.getElementById("status");
const $refresh = document.getElementById("refresh");
const $crumbs = document.getElementById("crumbs");
const $hints = document.getElementById("hints");

let repos = [];
let fetchedAt = null;
let syncWarnings = [];

// Rows currently displayed: { item, positions }
let rows = [];
let activeIndex = 0;

// null in search mode; { repo, path, entries, savedQuery, savedIndex, loading } while browsing a repo.
let browse = null;
let browseRequest = 0;

// ---------- Matching ----------

const BOUNDARY = /[\/\-_. ]/;

// Scores one lowercase token against a lowercase haystack.
// Returns { score, positions } or null when there is no match.
function matchToken(token, hay, nameStart) {
  const idx = hay.indexOf(token);
  if (idx !== -1) {
    let score = 100 - Math.min(idx, 50);
    if (idx === 0 || BOUNDARY.test(hay[idx - 1])) score += 40;
    if (idx >= nameStart) score += 30; // prefer hits in the repo name over the org
    if (idx === nameStart) score += 30;
    const positions = [];
    for (let i = 0; i < token.length; i++) positions.push(idx + i);
    return { score, positions };
  }

  // Fallback: subsequence fuzzy match ("mysh" -> "b-psu-100-my-shell").
  const positions = [];
  let from = 0;
  for (const ch of token) {
    const i = hay.indexOf(ch, from);
    if (i === -1) return null;
    positions.push(i);
    from = i + 1;
  }
  const spread = positions[positions.length - 1] - positions[0];
  return { score: Math.max(1, 30 - spread), positions };
}

// Generic filter: getText(item) -> string, nameStart(item) -> index where the "name" part starts.
function filter(items, query, getText, nameStart, tieBreak) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items.map((item) => ({ item, score: 0, positions: new Set() }));

  const out = [];
  for (const item of items) {
    const hay = getText(item).toLowerCase();
    const start = nameStart(item);
    let score = 0;
    const positions = new Set();
    let ok = true;
    for (const t of tokens) {
      const m = matchToken(t, hay, start);
      if (!m) { ok = false; break; }
      score += m.score;
      m.positions.forEach((p) => positions.add(p));
    }
    if (ok) out.push({ item, score, positions });
  }
  out.sort((a, b) => b.score - a.score || tieBreak(a.item, b.item));
  return out;
}

// ---------- Rendering ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function highlight(text, positions, offset) {
  let html = "";
  let open = false;
  for (let i = 0; i < text.length; i++) {
    const hit = positions.has(i + offset);
    if (hit && !open) { html += "<mark>"; open = true; }
    if (!hit && open) { html += "</mark>"; open = false; }
    html += escapeHtml(text[i]);
  }
  return open ? html + "</mark>" : html;
}

function timeAgo(ms) {
  if (!ms) return "never";
  const s = (Date.now() - ms) / 1000;
  const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [u, sec] of units) if (s >= sec) return `${Math.floor(s / sec)}${u} ago`;
  return "just now";
}

function render() {
  if (browse) renderBrowse();
  else renderSearch();
}

function renderSearch() {
  $crumbs.hidden = true;
  $query.placeholder = "Search repos… (e.g. cpe-100)";
  setHints([["↑↓", "move"], ["Enter", "open"], ["→", "browse files"], ["Ctrl+Enter", "copy SSH clone"]]);

  rows = filter(
    repos, $query.value,
    (r) => r.fullName,
    (r) => r.owner.length + 1,
    (a, b) => (b.pushedAt || "").localeCompare(a.pushedAt || "")
  );
  activeIndex = Math.min(activeIndex, Math.max(0, rows.length - 1));

  $results.innerHTML = "";
  rows.slice(0, MAX_RESULTS).forEach(({ item: repo, positions }, i) => {
    const li = makeRow(i);
    const nameStart = repo.owner.length + 1;
    li.innerHTML =
      `<div class="main"><div class="name">${highlight(repo.name, positions, nameStart)}</div>` +
      `<div class="meta">${highlight(repo.owner, positions, 0)} · pushed ${timeAgo(repo.pushedAt && Date.parse(repo.pushedAt))}</div></div>` +
      `<button class="enter" title="Browse files (→)">›</button>`;
    li.querySelector(".enter").addEventListener("click", (e) => {
      e.stopPropagation();
      enterRepo(i);
    });
    li.addEventListener("click", (e) => openUrl(repo.url, e.ctrlKey || e.metaKey));
    $results.appendChild(li);
  });

  if (repos.length) {
    const extra = rows.length > MAX_RESULTS ? ` (showing ${MAX_RESULTS})` : "";
    const warn = syncWarnings.length ? ` · ⚠ ${syncWarnings.length} org(s) failed` : "";
    setStatus(`${rows.length} / ${repos.length} repos${extra} · synced ${timeAgo(fetchedAt)}${warn}`);
    if (warn) $status.title = syncWarnings.join("\n");
  }
}

function renderBrowse() {
  const { repo, path, entries, loading } = browse;
  $query.placeholder = "Filter this folder…";
  setHints([["↑↓", "move"], ["Enter/→", "open folder / file"], ["←", "up"], ["Ctrl+Enter", "open folder on GitHub"]]);
  renderCrumbs();

  rows = filter(entries, $query.value, (e) => e.name, () => 0, () => 0);
  activeIndex = Math.min(activeIndex, Math.max(0, rows.length - 1));

  $results.innerHTML = "";
  rows.slice(0, MAX_RESULTS * 5).forEach(({ item: entry, positions }, i) => {
    const li = makeRow(i);
    const icon = entry.type === "dir" ? "📁" : entry.type === "submodule" ? "🔗" : "📄";
    li.innerHTML =
      `<div class="main"><div class="name entry"><span class="icon">${icon}</span>${highlight(entry.name, positions, 0)}</div></div>` +
      (entry.type === "dir" ? `<span class="chev">›</span>` : "");
    li.addEventListener("click", (e) => activateEntry(entry, e.ctrlKey || e.metaKey));
    $results.appendChild(li);
  });

  if (loading) setStatus("Loading…");
  else if (!entries.length) setStatus("Empty folder (or empty repository).");
  else setStatus(`${rows.length} / ${entries.length} entries · ${repo.defaultBranch || ""}`);
}

function renderCrumbs() {
  const { repo, path } = browse;
  $crumbs.hidden = false;
  $crumbs.innerHTML = "";

  const back = document.createElement("button");
  back.className = "back";
  back.title = "Back (←)";
  back.textContent = "←";
  back.addEventListener("click", goUp);
  $crumbs.appendChild(back);

  const parts = path ? path.split("/") : [];
  const segs = [{ label: repo.name, path: "" }, ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join("/") }))];
  segs.forEach((seg, i) => {
    if (i) $crumbs.appendChild(Object.assign(document.createElement("span"), { className: "sep", textContent: "/" }));
    const a = document.createElement("a");
    a.textContent = seg.label;
    a.href = "#";
    if (i === segs.length - 1) a.className = "current";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      loadDir(seg.path);
    });
    $crumbs.appendChild(a);
  });

  const gh = document.createElement("button");
  gh.className = "gh";
  gh.title = "Open this folder on GitHub (Ctrl+Enter)";
  gh.textContent = "↗";
  gh.addEventListener("click", () => openUrl(folderUrl(repo, path)));
  $crumbs.appendChild(gh);
}

function makeRow(i) {
  const li = document.createElement("li");
  if (i === activeIndex) li.className = "active";
  li.addEventListener("mousemove", () => { if (i !== activeIndex) setActive(i); });
  return li;
}

function setActive(i) {
  const items = $results.children;
  if (!items.length) return;
  items[activeIndex]?.classList.remove("active");
  activeIndex = (i + items.length) % items.length;
  items[activeIndex].classList.add("active");
  items[activeIndex].scrollIntoView({ block: "nearest" });
}

function setStatus(text, isError = false, html = false) {
  $status.className = isError ? "error" : "";
  $status.title = "";
  if (html) $status.innerHTML = text;
  else $status.textContent = text;
}

function setHints(hints) {
  $hints.innerHTML = hints.map(([k, v]) => `<span><kbd>${k}</kbd> ${v}</span>`).join("");
}

function showError(err) {
  if (err.message === "NO_TOKEN") {
    setStatus('No GitHub token set. <a href="#" id="open-opts">Open settings</a> to add one.', true, true);
    document.getElementById("open-opts").onclick = () => chrome.runtime.openOptionsPage();
  } else {
    setStatus(err.message, true);
  }
}

// ---------- Browsing ----------

function enterRepo(i) {
  const repo = rows[i]?.item;
  if (!repo) return;
  browse = { repo, path: "", entries: [], savedQuery: $query.value, savedIndex: i, loading: true, dirIndex: {} };
  loadDir("");
}

async function loadDir(path, selectName = null) {
  const req = ++browseRequest;
  browse.dirIndex[browse.path] = activeIndex;
  browse.path = path;
  browse.entries = [];
  browse.loading = true;
  $query.value = "";
  activeIndex = 0;
  render();
  $query.focus();

  try {
    const entries = await listDir(browse.repo, path);
    if (req !== browseRequest || !browse) return;
    browse.entries = entries;
    browse.loading = false;
    const sel = selectName ? entries.findIndex((e) => e.name === selectName) : -1;
    activeIndex = sel >= 0 ? sel : 0;
    render();
    $results.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  } catch (err) {
    if (req !== browseRequest || !browse) return;
    browse.loading = false;
    render();
    showError(err);
  }
}

function activateEntry(entry, background = false) {
  if (entry.type === "dir") loadDir(entry.path);
  else if (entry.url) openUrl(entry.url, background);
}

function goUp() {
  if (!browse) return;
  if (!browse.path) {
    // Back to the repo list, restoring the previous search and selection.
    browseRequest++;
    $query.value = browse.savedQuery;
    activeIndex = browse.savedIndex;
    browse = null;
    render();
    $results.children[activeIndex]?.scrollIntoView({ block: "nearest" });
    return;
  }
  const parts = browse.path.split("/");
  const current = parts.pop();
  loadDir(parts.join("/"), current);
}

// ---------- Actions ----------

function openUrl(url, background = false) {
  chrome.tabs.create({ url, active: !background });
  if (!background) window.close();
}

async function copy(text, label) {
  await navigator.clipboard.writeText(text);
  setStatus(`Copied ${label}: ${text}`);
}

async function doRefresh() {
  $refresh.classList.add("spinning");
  try {
    const cache = await refreshRepos();
    repos = cache.repos;
    fetchedAt = cache.fetchedAt;
    syncWarnings = cache.warnings || [];
    if (!browse) render();
  } catch (err) {
    showError(err);
  } finally {
    $refresh.classList.remove("spinning");
  }
}

// ---------- Events ----------

$query.addEventListener("input", () => {
  activeIndex = 0;
  render();
  if (!browse) chrome.storage.session?.set({ lastQuery: $query.value }).catch(() => {});
});

$query.addEventListener("keydown", (e) => {
  const current = rows[activeIndex]?.item;
  const caretAtEnd = $query.selectionStart === $query.value.length && $query.selectionEnd === $query.value.length;

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      setActive(activeIndex + 1);
      return;
    case "ArrowUp":
      e.preventDefault();
      setActive(activeIndex - 1);
      return;
  }

  if (!browse) {
    switch (e.key) {
      case "ArrowRight":
      case "Tab":
        if (e.key === "ArrowRight" && !caretAtEnd) return;
        if (!current) return;
        e.preventDefault();
        enterRepo(activeIndex);
        break;
      case "Enter":
        e.preventDefault();
        if (!current) return;
        if (e.ctrlKey || e.metaKey) copy(`git clone ${current.sshUrl}`, "SSH clone");
        else if (e.altKey) copy(`git clone ${current.cloneUrl}`, "HTTPS clone");
        else openUrl(current.url, e.shiftKey);
        break;
      case "Escape":
        if ($query.value) {
          e.preventDefault();
          $query.value = "";
          activeIndex = 0;
          render();
        }
        break;
    }
    return;
  }

  // Browse mode
  switch (e.key) {
    case "Enter":
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) openUrl(folderUrl(browse.repo, browse.path));
      else if (current) activateEntry(current, e.shiftKey);
      break;
    case "ArrowRight":
    case "Tab":
      if (e.key === "ArrowRight" && !caretAtEnd) return;
      e.preventDefault();
      if (current?.type === "dir") loadDir(current.path);
      break;
    case "ArrowLeft":
    case "Backspace":
      if ($query.value) return; // let the input edit its text
      e.preventDefault();
      goUp();
      break;
    case "Escape":
      e.preventDefault();
      if ($query.value) {
        $query.value = "";
        activeIndex = 0;
        render();
      } else {
        browse.path = "";
        goUp();
      }
      break;
  }
});

$refresh.addEventListener("click", doRefresh);
document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- Init ----------

(async () => {
  try {
    const { lastQuery } = (await chrome.storage.session?.get("lastQuery")) || {};
    if (lastQuery) {
      $query.value = lastQuery;
      $query.select();
    }
  } catch {}

  render();
  const [settings, cache] = await Promise.all([getSettings(), getCache()]);
  if (cache) {
    repos = cache.repos;
    fetchedAt = cache.fetchedAt;
    syncWarnings = cache.warnings || [];
    render();
  }
  if (isStale(cache, settings.cacheTtlMinutes)) {
    if (!cache) setStatus("Scanning your Epitech repositories…");
    doRefresh();
  }
})();
