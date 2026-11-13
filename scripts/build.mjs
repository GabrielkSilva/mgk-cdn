import { readdir, stat, mkdir, writeFile, cp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");
const outDir = path.join(root, "_site");
const normalizeBase = (value) => {
  const url = new URL(value.replace(/\/$/, ""));
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
};
const BASE_URL = normalizeBase(process.env.SITE_URL || "https://gabrielksilva.github.io/mgk-cdn");
const ASSET_PREFIX = "assets";

const toPosix = (p) => p.split(path.sep).join("/");
const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

async function walk(dir, base = "") {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, rel)));
    else if (entry.isFile()) out.push({ rel: toPosix(rel), abs });
  }
  return out;
}

function parseName(basename) {
  let name = basename.replace(/\s*\(\d+\)$/, "");
  let size = null;
  const sizeMatch = name.match(/\s(\d{2,4})$/);
  if (sizeMatch) {
    size = Number(sizeMatch[1]);
    name = name.slice(0, sizeMatch.index);
  }
  let variant = "base";
  for (const [suffix, value] of [
    [" Flat Black", "flat-black"],
    [" Flat White", "flat-white"],
    [" Outline", "outline"],
  ]) {
    if (name.endsWith(suffix)) {
      variant = value;
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return { name, variant, size };
}

const files = (await walk(assetsDir)).sort((a, b) => a.rel.localeCompare(b.rel));
const items = [];
const tree = new Map();

for (const file of files) {
  const info = await stat(file.abs);
  const pathInSite = `${ASSET_PREFIX}/${file.rel}`;
  const segments = file.rel.split("/");
  const top = segments.length > 1 ? segments[0] : null;
  const category = segments.length > 2 ? segments[1] : null;
  const stem = path.posix.basename(file.rel, path.posix.extname(file.rel));
  const parsed = parseName(stem);

  items.push({
    path: pathInSite,
    url: `${BASE_URL}/${encodePath(pathInSite)}`,
    bytes: info.size,
    type: path.posix.extname(file.rel).slice(1).toLowerCase(),
    group: top,
    category,
    file: path.posix.basename(file.rel),
    name: parsed.name,
    variant: parsed.variant,
    size: parsed.size,
  });

  if (top) {
    if (!tree.has(top)) tree.set(top, { files: 0, bytes: 0, categories: new Map(), types: new Map() });
    const node = tree.get(top);
    node.files += 1;
    node.bytes += info.size;
    node.types.set(path.extname(file.rel).slice(1).toLowerCase(), (node.types.get(path.extname(file.rel).slice(1).toLowerCase()) || 0) + 1);
    if (category) {
      if (!node.categories.has(category)) node.categories.set(category, { files: 0, bytes: 0 });
      const cat = node.categories.get(category);
      cat.files += 1;
      cat.bytes += info.size;
    }
  }
}

const round = (n) => Math.round((n / 1048576) * 100) / 100;
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const groups = [...tree.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, node]) => ({
    name,
    files: node.files,
    mb: round(node.bytes),
    types: Object.fromEntries(node.types),
    index: `index/${slug(name)}.json`,
    categories: [...node.categories.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, s]) => ({
        name: cat,
        files: s.files,
        mb: round(s.bytes),
        index: `index/${slug(name)}/${slug(cat)}.json`,
      })),
  }));

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(assetsDir, path.join(outDir, ASSET_PREFIX), { recursive: true });
await cp(path.join(root, "site"), outDir, { recursive: true });
await writeFile(path.join(outDir, ".nojekyll"), "");

const extraAgents = await readFile(path.join(root, "site", "AGENTS.extra.md"), "utf8").catch(() => "");

const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);

await writeFile(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      base_url: BASE_URL,
      asset_root: `${BASE_URL}/${ASSET_PREFIX}/`,
      generated_at: new Date().toISOString(),
      total_files: items.length,
      total_mb: round(totalBytes),
      groups: groups.map(({ name, files, mb, types }) => ({ name, files, mb, types })),
      items,
    },
    null,
    0,
  ),
);

await writeFile(
  path.join(outDir, "index.json"),
  JSON.stringify(
    {
      base_url: BASE_URL,
      asset_root: `${BASE_URL}/${ASSET_PREFIX}/`,
      generated_at: new Date().toISOString(),
      total_files: items.length,
      total_mb: round(totalBytes),
      entry_points: {
        manifest: `${BASE_URL}/manifest.json`,
        agents: `${BASE_URL}/AGENTS.md`,
        llms_txt: `${BASE_URL}/llms.txt`,
        category_index_pattern: `${BASE_URL}/index/<group>/<category>.json`,
      },
      groups,
    },
    null,
    2,
  ),
);

for (const group of groups) {
  const groupItems = items.filter((item) => item.group === group.name);
  const groupSlug = slug(group.name);
  await mkdir(path.join(outDir, "index", groupSlug), { recursive: true });
  await writeFile(
    path.join(outDir, "index", `${groupSlug}.json`),
    JSON.stringify({ base_url: BASE_URL, group: group.name, files: groupItems.length, items: groupItems }, null, 0),
  );
  for (const category of group.categories) {
    const categoryItems = groupItems.filter((item) => item.category === category.name);
    await writeFile(
      path.join(outDir, "index", groupSlug, `${slug(category.name)}.json`),
      JSON.stringify(
        {
          base_url: BASE_URL,
          group: group.name,
          category: category.name,
          files: categoryItems.length,
          items: categoryItems,
        },
        null,
        0,
      ),
    );
  }
}

await writeFile(path.join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");

const groupLines = groups
  .map((g) => `- ${g.name}: ${g.files} files (${g.mb} MB) -> index/${slug(g.name)}.json`)
  .join("\n");

await writeFile(
  path.join(outDir, "llms.txt"),
  `# mgk-cdn assets

> Static asset library served from GitHub Pages. ${items.length} files, ${round(totalBytes)} MB total, ${groups.length} top-level groups.

## How to use
- Site root: ${BASE_URL}/ (serves \`index.json\`)
- Full file index: ${BASE_URL}/manifest.json
- Compact group index: ${BASE_URL}/index.json
- Per-group index: ${BASE_URL}/index/<group>.json
- Agent instructions: ${BASE_URL}/AGENTS.md
- Every file is addressable directly: ${BASE_URL}/assets/<group>/<category>/<file>

## Groups
${groupLines}

## Notes
- Paths may contain spaces and accents. Always percent-encode each segment.
- No authentication, no rate limit beyond GitHub Pages soft limits (100 GB/month).
- Content is static; nothing is rendered as HTML except this documentation.
`,
);

await writeFile(
  path.join(outDir, "AGENTS.md"),
  `# AGENTS.md - mgk-cdn

Instructions for LLM agents and automated tools consuming this asset library.

## What this is

A static CDN of game art assets (2D icons today; 3D models, audio, fonts and other
formats may be added later). Served by GitHub Pages. No API, no auth, no server logic.
Every file under \`/assets/\` is a real, directly fetchable resource.

- Base URL: ${BASE_URL}
- Asset root: ${BASE_URL}/assets/
- Total files: ${items.length}
- Total size: ${round(totalBytes)} MB
- Groups: ${groups.length}

## Entry points (fetch these first)

| URL | Typical size | Purpose |
|---|---|---|
| \`${BASE_URL}/\` | ~2 KB | Same payload as \`index.json\`; convenient when an agent only knows the base URL. |
| \`${BASE_URL}/index.json\` | ~2 KB | Group overview: names, file counts, sizes, types, categories, and the path of each index file. Start here. |
| \`${BASE_URL}/index/<group>/<category>.json\` | 5-40 KB | Every file in one category, absolute URLs. This is the sweet spot. |
| \`${BASE_URL}/index/<group>.json\` | 300 KB+ | Every file in one group. |
| \`${BASE_URL}/manifest.json\` | ~2.5 MB | Complete flat index with per-file bytes, type, name, variant, size. |
| \`${BASE_URL}/llms.txt\` | ~1 KB | Summary in llmstxt.org format. |

Never fetch \`manifest.json\` to answer "what exists" - read \`index.json\` (2 KB), pick a
category, then read that one category file.

## Directory layout

\`\`\`
/assets/<group>/<category>/<file>
\`\`\`

A file may also sit directly under a group (\`/assets/<group>/<file>\`) when a group has
no subcategories. Category slugs in \`index/\` are lowercased with non-alphanumerics
collapsed to \`-\` (e.g. \`Town & City\` -> \`town-city\`, \`_THANK YOU\` -> \`thank-you\`).

${groups
  .map(
    (g) =>
      `### ${g.name} - ${g.files} files, ${g.mb} MB, types: ${Object.keys(g.types).join(", ")}\n\n` +
      g.categories
        .map((c) => `- ${c.name} (${c.files} files, ${c.mb} MB) -> index/${slug(g.name)}/${slug(c.name)}.json`)
        .join("\n"),
  )
  .join("\n\n")}

## Naming conventions (2D icon groups)

Filenames follow \`<subject> [variant] [pixels].<ext>\`, where:

- \`variant\` is one of \`base\` (absent), \`Flat Black\`, \`Flat White\`, \`Outline\`.
- \`pixels\` is the rendered edge length: \`64\` or \`256\`. Omitted means the original size.
- Signed artwork (\`256\`) is the high-resolution master; everything is PNG with alpha.

Examples:

\`\`\`
assets/icons/Weapons/Sword/Sword 256.png
assets/icons/Weapons/Sword/Sword Outline 64.png
assets/icons/Clothing/Armor Boots/Armor Boots Flat White 256.png
\`\`\`

To find a subject across variants, filter \`manifest.json\` by \`name\` (the subject, with
variant and size stripped) inside a given \`group\` + \`category\`.

## Fetching rules

1. Always percent-encode each path segment. Spaces become \`%20\`, \`é\` becomes \`%C3%A9\`.
   Apostrophes are legal unencoded. The \`url\` field in the manifest is pre-encoded.
2. Use \`curl -L\` or fetch directly; responses are \`200\` with \`access-control-allow-origin: *\`.
3. GitHub Pages serves files with correct \`Content-Type\` for images. \`.glb\`, \`.gltf\`,
   \`.fbx\`, \`.ogg\` and similar may be served as \`application/octet-stream\` - set the
   type yourself when consuming them.
4. Cache headers are short. Re-fetch the manifest if you need certainty that new files
   exist; branch content is not versioned.

## Avoiding token waste

- Never list the whole tree through the HTML interface. Use \`index.json\`.
- One subject has ~8 variants (4 variants x 2 sizes) for icon groups. If you only need
  a UI icon, prefer the \`256\` size and \`base\` variant unless told otherwise.
- Load individual images only when you need to look at them, not to "browse".

## Maintenance

This documentation is generated by \`scripts/build.mjs\` on every push to \`main\`.
Adding, renaming or removing files under \`assets/\` automatically updates
\`manifest.json\`, \`index.json\`, \`index/*.json\`, \`llms.txt\` and this file. Never edit
generated output by hand.

## Licensing

The 2D icon set is third-party commercial artwork (RhosGFX). Do not redistribute or
repackage these files as a standalone asset pack. See \`_THANK YOU\` inside the icon
group for the original license notice.
${extraAgents.trim() ? `\n${extraAgents.trim()}\n` : ""}`,
);

console.log(`built ${items.length} files, ${round(totalBytes)} MB, ${groups.length} groups`);
