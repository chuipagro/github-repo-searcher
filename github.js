// Shared helpers: settings, GitHub API access and the local repo cache.

const DEFAULTS = {
  token: "",
  ownerPattern: "^Epitech", // regex matched against the repo owner (org) login
  extraOrgs: "", // orgs to scan explicitly, e.g. "EpitechPromo2027 EpitechPromo2028"
  cacheTtlMinutes: 60,
};

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function getCache() {
  const { repoCache } = await chrome.storage.local.get("repoCache");
  return repoCache || null; // { fetchedAt, repos: [...] }
}

function isStale(cache, ttlMinutes) {
  return !cache || Date.now() - cache.fetchedAt > ttlMinutes * 60 * 1000;
}

function parseOrgList(text) {
  return text.split(/[\s,]+/).filter(Boolean);
}

function nextLink(linkHeader) {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

async function ghFetch(url) {
  const { token } = await getSettings();
  if (!token) throw new Error("NO_TOKEN");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.ok) return res;

  if (res.status === 401) throw new Error("Invalid GitHub token (401).");
  if (res.status === 403 && res.headers.get("X-GitHub-SSO")) {
    throw new Error("Token not authorized for this org's SSO. Authorize it in GitHub token settings.");
  }
  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    throw new Error("GitHub API rate limit reached, try again later.");
  }
  const err = new Error(`GitHub API error ${res.status} on ${new URL(url).pathname}`);
  err.status = res.status;
  throw err;
}

async function fetchAllPages(url) {
  const items = [];
  while (url) {
    const res = await ghFetch(url);
    items.push(...(await res.json()));
    url = nextLink(res.headers.get("Link"));
  }
  return items;
}

function toRepo(r) {
  return {
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    url: r.html_url,
    sshUrl: r.ssh_url,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at,
    private: r.private,
  };
}

// Collects every repo visible with the user's token:
//  - repos the user owns / collaborates on / has via org membership
//  - all repos of the Epitech orgs the user belongs to (auto-discovered)
//  - all repos of the orgs listed in "extraOrgs"
// Keeps those whose owner matches the pattern (or is an extra org) and caches them.
async function refreshRepos() {
  const { ownerPattern, extraOrgs } = await getSettings();

  let ownerRe;
  try {
    ownerRe = new RegExp(ownerPattern, "i");
  } catch {
    throw new Error(`Invalid owner pattern: ${ownerPattern}`);
  }
  const extra = parseOrgList(extraOrgs);
  const extraLower = new Set(extra.map((o) => o.toLowerCase()));
  const keep = (owner) => ownerRe.test(owner) || extraLower.has(owner.toLowerCase());

  const byName = new Map();
  const add = (list) => {
    for (const r of list) if (keep(r.owner.login)) byName.set(r.full_name, toRepo(r));
  };

  add(await fetchAllPages(
    "https://api.github.com/user/repos?per_page=100&sort=pushed" +
    "&affiliation=owner,collaborator,organization_member"
  ));

  const memberOrgs = (await fetchAllPages("https://api.github.com/user/orgs?per_page=100"))
    .map((o) => o.login)
    .filter((login) => ownerRe.test(login));
  const orgs = [...new Set([...memberOrgs, ...extra])];

  const warnings = [];
  for (const org of orgs) {
    try {
      add(await fetchAllPages(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all`));
    } catch (err) {
      if (err.message === "NO_TOKEN") throw err;
      warnings.push(`${org}: ${err.message}`);
    }
  }

  const repos = [...byName.values()].sort((a, b) => (b.pushedAt || "").localeCompare(a.pushedAt || ""));
  const cache = { fetchedAt: Date.now(), repos, orgs, warnings };
  await chrome.storage.local.set({ repoCache: cache });
  return cache;
}

function encodePath(path) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

// Lists one directory of a repo: folders first, then files, alphabetically.
async function listDir(repo, path) {
  const url =
    `https://api.github.com/repos/${repo.fullName}/contents/${encodePath(path)}` +
    (repo.defaultBranch ? `?ref=${encodeURIComponent(repo.defaultBranch)}` : "");
  let entries;
  try {
    entries = await (await ghFetch(url)).json();
  } catch (err) {
    if (err.status === 404 && !path) return []; // empty repo
    throw err;
  }
  if (!Array.isArray(entries)) entries = [entries];
  return entries
    .map((e) => ({ name: e.name, path: e.path, type: e.type, url: e.html_url }))
    .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
}

function folderUrl(repo, path) {
  if (!path) return repo.url;
  return `${repo.url}/tree/${encodeURIComponent(repo.defaultBranch || "HEAD")}/${encodePath(path)}`;
}
