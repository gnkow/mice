#!/usr/bin/env node
/**
 * One-shot migration: .specs + .scratch → GitHub Issues + Project (Kanban).
 * Idempotent via .tmp-gh-migration.json manifest.
 *
 * Usage: node scripts/migrate-scratch-to-github.mjs
 * Requires: gh auth with repo + project + read:project scopes
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "gnkow/mice";
const OWNER = "gnkow";
const PROJECT_TITLE = "Mice";
const MANIFEST_PATH = join(ROOT, ".tmp-gh-migration.json");

const FEATURE_TO_SPEC = {
  authentication: "01-authentication",
  authorization: "02-authorization",
  "gxp-compliance": "04-gxp-compliance",
  jobs: "09-jobs",
  repositories: "05-repositories",
  training: "training",
};

const TRIAGE_LABELS = [
  { name: "needs-triage", color: "FBCA04", description: "Maintainer needs to evaluate" },
  { name: "needs-info", color: "D93F0B", description: "Waiting on reporter" },
  { name: "ready-for-agent", color: "0E8A16", description: "Fully specified, ready for AFK agent" },
  { name: "ready-for-human", color: "1D76DB", description: "Requires human implementation" },
  { name: "wontfix", color: "FFFFFF", description: "Will not be actioned" },
  { name: "deferred", color: "C5DEF5", description: "Deferred for later" },
];

const TYPE_LABELS = [
  { name: "feature", color: "5319E7", description: "Feature / spec parent issue" },
  { name: "implementation", color: "BFDADC", description: "Implementation / child ticket" },
];

const AREA_SLUGS = [
  "cross-cutting",
  "authentication",
  "authorization",
  "audit",
  "gxp-compliance",
  "repositories",
  "data-transfer",
  "cli",
  "workspaces",
  "jobs",
  "sessions",
  "lineage",
  "metadata-search",
  "favorites",
  "notifications",
  "administration",
  "operations",
  "training",
];

function sleep(ms) {
  const sec = Math.max(0.05, ms / 1000);
  try {
    execFileSync("sleep", [String(sec)]);
  } catch {
    /* ignore */
  }
}

function sh(args, { input, json } = {}) {
  const out = execFileSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (json) return JSON.parse(out || "null");
  return out;
}

function ghJson(args) {
  return sh(args, { json: true });
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      project: null,
      parents: {},
      children: {},
      projectItems: {},
      labelsDone: false,
      linked: false,
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function saveManifest(m) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
}

function ensureLabel({ name, color, description }) {
  try {
    sh(["label", "create", name, "--repo", REPO, "--color", color, "--description", description]);
    console.log(`  label created: ${name}`);
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    if (/already exists/i.test(msg)) {
      try {
        sh([
          "label",
          "edit",
          name,
          "--repo",
          REPO,
          "--color",
          color,
          "--description",
          description,
        ]);
      } catch {
        /* ignore */
      }
      console.log(`  label exists: ${name}`);
    } else {
      throw e;
    }
  }
}

function extractStatus(text) {
  const m = text.match(/^(?:\*\*)?Status(?:\*\*)?:\s*(.+)$/im);
  if (!m) return "needs-triage";
  let raw = m[1].replace(/\*+/g, "").trim().toLowerCase();
  // Truncate parenthetical notes after done
  const token = raw.split(/\s+/)[0];
  if (token.startsWith("done")) return "done";
  if (token.startsWith("wontfix")) return "wontfix";
  if (token.startsWith("deferred")) return "deferred";
  if (token.startsWith("ready-for-agent")) return "ready-for-agent";
  if (token.startsWith("ready-for-human")) return "ready-for-human";
  if (token.startsWith("needs-info")) return "needs-info";
  if (token.startsWith("needs-triage")) return "needs-triage";
  return token || "needs-triage";
}

function isClosedStatus(status) {
  return status === "done" || status === "wontfix" || status === "deferred";
}

function titleFromIssueMarkdown(text, fallback) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) {
      // Strip leading "NN: " if present for cleaner titles, keep it
      return m[1].trim().slice(0, 250);
    }
  }
  return fallback.slice(0, 250);
}

function specExcerpt(text) {
  const impl = text.search(/^## Implementation Decisions\b/m);
  let excerpt = impl >= 0 ? text.slice(0, impl).trimEnd() : text.slice(0, 8000);
  // Drop leading Status line duplication later; keep content
  if (excerpt.length > 55000) excerpt = excerpt.slice(0, 55000) + "\n\n…(truncated)\n";
  return excerpt;
}

function slugFromSpecFilename(name) {
  // 01-authentication.md → authentication; 00-cross-cutting.md → cross-cutting
  return basename(name, ".md").replace(/^\d+-/, "");
}

function createIssue({ title, body, labels }) {
  const args = ["issue", "create", "--repo", REPO, "--title", title, "--body", body];
  for (const l of labels) {
    args.push("--label", l);
  }
  const url = sh(args).trim();
  const number = Number(url.split("/").pop());
  if (!Number.isFinite(number)) throw new Error(`Could not parse issue number from ${url}`);
  sleep(200);
  return { number, url };
}

function closeIssue(number, reason = "completed") {
  sh(["issue", "close", String(number), "--repo", REPO, "--reason", reason]);
  sleep(150);
}

function issueNodeId(number) {
  const data = ghJson([
    "api",
    "graphql",
    "-f",
    `query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id}}}`,
    "-f",
    `owner=${OWNER}`,
    "-f",
    `name=mice`,
    "-F",
    `number=${number}`,
  ]);
  return data.data.repository.issue.id;
}

function addSubIssue(parentId, childId) {
  try {
    const data = ghJson([
      "api",
      "graphql",
      "-f",
      `query=mutation($parent:ID!,$child:ID!){addSubIssue(input:{issueId:$parent,subIssueId:$child}){issue{number}subIssue{number}}}`,
      "-f",
      `parent=${parentId}`,
      "-f",
      `child=${childId}`,
    ]);
    if (data.errors?.length) {
      const msg = data.errors.map((e) => e.message).join("; ");
      // Treat already-linked as success
      if (/already|duplicate|only have one parent/i.test(msg)) return;
      throw new Error(`addSubIssue failed: ${msg}`);
    }
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    if (/already|duplicate|only have one parent/i.test(msg)) return;
    throw e;
  }
  sleep(200);
}

function ensureProject(manifest) {
  if (manifest.project?.number) {
    console.log(`  project exists: #${manifest.project.number}`);
    return manifest.project;
  }
  // Check for existing project with same title
  const list = ghJson(["project", "list", "--owner", OWNER, "--limit", "50", "--format", "json"]);
  const found = (list.projects || list || []).find?.(
    (p) => p.title === PROJECT_TITLE,
  ) || (Array.isArray(list) ? list.find((p) => p.title === PROJECT_TITLE) : null);

  let project;
  if (found) {
    project = {
      number: found.number,
      id: found.id,
      url: found.url,
      title: found.title,
    };
    console.log(`  reusing project #${project.number}`);
  } else {
    const created = ghJson([
      "project",
      "create",
      "--owner",
      OWNER,
      "--title",
      PROJECT_TITLE,
      "--format",
      "json",
    ]);
    project = {
      number: created.number,
      id: created.id,
      url: created.url,
      title: created.title || PROJECT_TITLE,
    };
    console.log(`  created project #${project.number} ${project.url}`);
  }

  // Resolve node id if missing
  if (!project.id) {
    const view = ghJson([
      "project",
      "view",
      String(project.number),
      "--owner",
      OWNER,
      "--format",
      "json",
    ]);
    project.id = view.id;
    project.url = view.url || project.url;
  }

  manifest.project = project;
  saveManifest(manifest);
  return project;
}

function linkProject(manifest) {
  if (manifest.linked) return;
  try {
    sh([
      "project",
      "link",
      String(manifest.project.number),
      "--owner",
      OWNER,
      "--repo",
      REPO,
    ]);
    console.log("  linked project to repo");
  } catch (e) {
    const msg = String(e.stderr || e.message || e);
    if (/already/i.test(msg)) console.log("  project already linked");
    else console.warn("  project link warning:", msg);
  }
  manifest.linked = true;
  saveManifest(manifest);
}

function getStatusField(projectNumber) {
  const fields = ghJson([
    "project",
    "field-list",
    String(projectNumber),
    "--owner",
    OWNER,
    "--format",
    "json",
  ]);
  const list = fields.fields || fields;
  const status = list.find((f) => f.name === "Status");
  if (!status) throw new Error("Project Status field not found");
  const options = {};
  for (const o of status.options || []) {
    options[o.name.toLowerCase()] = o.id;
  }
  return { id: status.id, options };
}

function projectStatusOptionId(statusField, triageStatus, closed) {
  const opts = statusField.options;
  // Prefer Done for closed
  if (closed || triageStatus === "done" || triageStatus === "wontfix" || triageStatus === "deferred") {
    return opts.done || opts.complete || Object.values(opts)[opts.length - 1];
  }
  // Open work → Todo
  return opts.todo || opts["ready"] || opts["in progress"] || Object.values(opts)[0];
}

function withRetries(fn, { attempts = 6, label = "op" } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return fn();
    } catch (e) {
      last = e;
      const msg = String(e.stderr || e.message || e);
      const retryable = /Something went wrong|rate limit|timeout|502|503|504/i.test(msg);
      console.warn(`  ${label} attempt ${i}/${attempts} failed: ${msg.trim().slice(0, 200)}`);
      if (!retryable || i === attempts) break;
      sleep(1000 * i * i);
    }
  }
  throw last;
}

function addToProject(manifest, issueNumber, triageStatus, closed) {
  const key = String(issueNumber);
  if (manifest.projectItems[key]?.itemId) return manifest.projectItems[key];

  const added = withRetries(
    () =>
      ghJson([
        "project",
        "item-add",
        String(manifest.project.number),
        "--owner",
        OWNER,
        "--url",
        `https://github.com/${REPO}/issues/${issueNumber}`,
        "--format",
        "json",
      ]),
    { label: `item-add #${issueNumber}` },
  );
  const itemId = added.id;
  sleep(300);

  if (!manifest._statusField) {
    manifest._statusField = getStatusField(manifest.project.number);
  }
  const optionId = projectStatusOptionId(manifest._statusField, triageStatus, closed);
  if (optionId) {
    try {
      withRetries(
        () =>
          sh([
            "project",
            "item-edit",
            "--project-id",
            manifest.project.id,
            "--id",
            itemId,
            "--field-id",
            manifest._statusField.id,
            "--single-select-option-id",
            optionId,
          ]),
        { attempts: 4, label: `item-edit #${issueNumber}` },
      );
    } catch (e) {
      console.warn(`  status set failed for #${issueNumber}:`, String(e.stderr || e.message || e));
    }
  }

  const entry = { itemId, status: triageStatus, closed };
  manifest.projectItems[key] = entry;
  saveManifest(manifest);
  sleep(200);
  return entry;
}

function buildParents() {
  const specsDir = join(ROOT, ".specs");
  const parents = [];
  for (const file of readdirSync(specsDir).filter((f) => f.endsWith(".md")).sort()) {
    const slug = slugFromSpecFilename(file);
    const stem = basename(file, ".md"); // 01-authentication
    const text = readFileSync(join(specsDir, file), "utf8");
    const status = extractStatus(text);
    const excerpt = specExcerpt(text);
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const title = titleMatch
      ? `Spec: ${titleMatch[1].replace(/^\d+\s*[—–-]\s*/, "").trim()}`
      : `Spec: ${slug}`;
    const body = [
      `**Type:** feature / spec`,
      `**Area:** ${slug}`,
      `**Source:** [\`.specs/${file}\`](https://github.com/${REPO}/blob/main/.specs/${file})`,
      ``,
      excerpt,
      ``,
      `---`,
      `Full specification: [\`.specs/${file}\`](https://github.com/${REPO}/blob/main/.specs/${file})`,
    ].join("\n");
    parents.push({
      key: stem,
      slug,
      area: slug,
      status,
      title: title.slice(0, 250),
      body,
      closed: isClosedStatus(status),
    });
  }
  // Synthetic Training parent
  parents.push({
    key: "training",
    slug: "training",
    area: "training",
    status: "ready-for-agent",
    title: "Spec: Training",
    body: [
      `**Type:** feature / spec`,
      `**Area:** training`,
      ``,
      `# Training`,
      ``,
      `Synthetic parent for training implementation tickets.`,
      `A full \`.specs/17-training.md\` does not exist yet; see child ticket(s).`,
    ].join("\n"),
    closed: false,
  });
  return parents;
}

function buildChildren() {
  const scratch = join(ROOT, ".scratch");
  const children = [];
  for (const feature of readdirSync(scratch).sort()) {
    const issuesDir = join(scratch, feature, "issues");
    if (!existsSync(issuesDir)) continue;
    const parentKey = FEATURE_TO_SPEC[feature];
    if (!parentKey) throw new Error(`No parent mapping for feature ${feature}`);
    for (const file of readdirSync(issuesDir).filter((f) => f.endsWith(".md")).sort()) {
      const path = join(issuesDir, file);
      const rel = relative(ROOT, path);
      const text = readFileSync(path, "utf8");
      const status = extractStatus(text);
      const title = titleFromIssueMarkdown(text, `${feature}/${file}`);
      const body = [
        text.trimEnd(),
        ``,
        `---`,
        `Source: \`${rel}\` (migrated from local tracker)`,
      ].join("\n");
      children.push({
        key: `${feature}/${file}`,
        feature,
        parentKey,
        area: feature,
        status,
        title,
        body,
        closed: isClosedStatus(status),
        closeReason: status === "wontfix" ? "not planned" : "completed",
      });
    }
  }
  return children;
}

function main() {
  console.log("== auth check ==");
  try {
    sh(["project", "list", "--owner", OWNER, "--limit", "1"]);
  } catch (e) {
    console.error(
      "Missing project scopes. Run:\n  gh auth refresh -h github.com -s project,read:project\n",
    );
    console.error(String(e.stderr || e.message || e));
    process.exit(1);
  }

  const manifest = loadManifest();

  console.log("== labels ==");
  if (!manifest.labelsDone) {
    for (const l of [...TRIAGE_LABELS, ...TYPE_LABELS]) ensureLabel(l);
    for (const area of AREA_SLUGS) {
      ensureLabel({
        name: `area:${area}`,
        color: "0052CC",
        description: `Area: ${area}`,
      });
    }
    manifest.labelsDone = true;
    saveManifest(manifest);
  } else {
    console.log("  labels already done");
  }

  console.log("== project ==");
  ensureProject(manifest);
  linkProject(manifest);

  console.log("== parent issues ==");
  const parents = buildParents();
  for (const p of parents) {
    if (manifest.parents[p.key]?.number) {
      console.log(`  skip parent ${p.key} → #${manifest.parents[p.key].number}`);
      continue;
    }
    const labels = ["feature", `area:${p.area}`];
    if (!p.closed && ["ready-for-agent", "ready-for-human", "needs-triage", "needs-info"].includes(p.status)) {
      labels.push(p.status);
    }
    if (p.status === "wontfix" || p.status === "deferred") labels.push(p.status);
    console.log(`  create parent: ${p.title}`);
    const issue = createIssue({ title: p.title, body: p.body, labels });
    if (p.closed) closeIssue(issue.number, p.status === "wontfix" ? "not planned" : "completed");
    manifest.parents[p.key] = { ...issue, status: p.status, closed: p.closed, slug: p.slug };
    saveManifest(manifest);
  }

  // Cache parent node ids
  for (const [key, p] of Object.entries(manifest.parents)) {
    if (!p.nodeId) {
      p.nodeId = issueNodeId(p.number);
      saveManifest(manifest);
      sleep(100);
    }
  }

  console.log("== child issues ==");
  const children = buildChildren();
  console.log(`  ${children.length} children to process`);
  for (const c of children) {
    if (manifest.children[c.key]?.number) {
      console.log(`  skip child ${c.key} → #${manifest.children[c.key].number}`);
      continue;
    }
    const labels = ["implementation", `area:${c.area}`];
    if (["ready-for-agent", "ready-for-human", "needs-triage", "needs-info", "wontfix", "deferred"].includes(c.status)) {
      labels.push(c.status);
    }
    console.log(`  create child: ${c.title}`);
    const issue = createIssue({ title: c.title, body: c.body, labels });
    if (c.closed) closeIssue(issue.number, c.closeReason);
    const parent = manifest.parents[c.parentKey];
    if (!parent) throw new Error(`Missing parent ${c.parentKey} for ${c.key}`);
    const childNodeId = issueNodeId(issue.number);
    let subLinked = false;
    try {
      addSubIssue(parent.nodeId, childNodeId);
      subLinked = true;
    } catch (e) {
      console.warn(`  sub-issue link failed for ${c.key}:`, e.message);
    }
    manifest.children[c.key] = {
      ...issue,
      nodeId: childNodeId,
      parentKey: c.parentKey,
      parentNumber: parent.number,
      status: c.status,
      closed: c.closed,
      subLinked,
    };
    saveManifest(manifest);
  }

  // Ensure any skipped children still have sub-issue links
  console.log("== ensure sub-issues ==");
  for (const [key, c] of Object.entries(manifest.children)) {
    if (c.subLinked) continue;
    const parent = manifest.parents[c.parentKey];
    if (!parent?.nodeId || !c.nodeId) continue;
    try {
      addSubIssue(parent.nodeId, c.nodeId);
      c.subLinked = true;
      saveManifest(manifest);
    } catch (e) {
      console.warn(`  sub-issue ensure failed for ${key}:`, e.message);
    }
  }

  console.log("== project items ==");
  for (const p of Object.values(manifest.parents)) {
    addToProject(manifest, p.number, p.status, p.closed);
  }
  for (const c of Object.values(manifest.children)) {
    addToProject(manifest, c.number, c.status, c.closed);
  }

  // Drop ephemeral field cache before final save
  delete manifest._statusField;
  saveManifest(manifest);

  console.log("== summary ==");
  console.log(`  parents: ${Object.keys(manifest.parents).length}`);
  console.log(`  children: ${Object.keys(manifest.children).length}`);
  console.log(`  project items: ${Object.keys(manifest.projectItems).length}`);
  console.log(`  project: ${manifest.project.url}`);
  console.log(`  manifest: ${MANIFEST_PATH}`);
}

main();
