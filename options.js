const fields = ["token", "ownerPattern", "extraOrgs", "cacheTtlMinutes"];
const $msg = document.getElementById("msg");

(async () => {
  const settings = await getSettings();
  for (const f of fields) document.getElementById(f).value = settings[f];
})();

document.getElementById("save").addEventListener("click", async () => {
  const values = {
    token: document.getElementById("token").value.trim(),
    ownerPattern: document.getElementById("ownerPattern").value.trim() || DEFAULTS.ownerPattern,
    extraOrgs: parseOrgList(document.getElementById("extraOrgs").value).join(" "),
    cacheTtlMinutes: Math.max(1, Number(document.getElementById("cacheTtlMinutes").value) || DEFAULTS.cacheTtlMinutes),
  };
  await chrome.storage.local.set(values);

  $msg.textContent = "Saved. Syncing repos…";
  try {
    const { repos, orgs, warnings } = await refreshRepos();
    const scanned = orgs.length ? ` Orgs scanned: ${orgs.join(", ")}.` : "";
    const warn = warnings.length ? ` ⚠ ${warnings.join(" | ")}` : "";
    $msg.textContent = `Saved. ${repos.length} repos synced.${scanned}${warn}`;
  } catch (err) {
    $msg.textContent = err.message === "NO_TOKEN" ? "Saved (no token set)." : `Saved, but sync failed: ${err.message}`;
  }
});

// Diagnostic: shows what the token can actually see, to debug missing org repos.
document.getElementById("diagnose").addEventListener("click", async () => {
  const $diag = document.getElementById("diag");
  $diag.hidden = false;
  $diag.textContent = "Running…";
  const lines = [];
  const log = (s) => { lines.push(s); $diag.textContent = lines.join("\n"); };

  const { token, ownerPattern, extraOrgs } = await getSettings();
  if (!token) return log("❌ No token saved.");
  const call = (path) => fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  log(`Token type: ${token.startsWith("github_pat_") ? "FINE-GRAINED ⚠ (can only see one owner's repos — use a classic ghp_ token)" : token.startsWith("ghp_") ? "classic ✅" : "unknown"}`);

  const me = await call("/user");
  if (!me.ok) return log(`❌ /user → ${me.status}. Token invalid?`);
  log(`Logged in as: ${(await me.json()).login}`);
  log(`Scopes: ${me.headers.get("X-OAuth-Scopes") || "(none reported)"}`);
  log(`Owner filter: ${ownerPattern}`);

  const orgs = await call("/user/orgs?per_page=100");
  log(`Orgs you're a member of: ${orgs.ok ? (await orgs.json()).map((o) => o.login).join(", ") || "(none)" : orgs.status}`);

  const ownersSeen = {};
  let url = "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!res.ok) { log(`❌ /user/repos → ${res.status}`); break; }
    for (const r of await res.json()) ownersSeen[r.owner.login] = (ownersSeen[r.owner.login] || 0) + 1;
    url = nextLink(res.headers.get("Link"));
  }
  log(`Repos visible via /user/repos, by owner:\n  ${Object.entries(ownersSeen).map(([o, n]) => `${o}: ${n}`).join("\n  ") || "(none)"}`);

  for (const org of parseOrgList(extraOrgs)) {
    const res = await call(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all`);
    const sso = res.headers.get("X-GitHub-SSO");
    if (sso) log(`❌ ${org}: SSO required → authorize the token for this org (${sso})`);
    else if (!res.ok) log(`❌ ${org}: ${res.status} ${res.status === 404 ? "(org name wrong?)" : ""}`);
    else log(`${org}: ${(await res.json()).length} repos on first page`);
  }
  if (!parseOrgList(extraOrgs).length) log("(No 'Organizations to scan' set.)");
  log("Done.");
});
