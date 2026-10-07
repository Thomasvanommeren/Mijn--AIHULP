const BASE_ROOT = "https://eu-manuals.ecisolutions.com/proteus/proteus_nl/";
const START_URL = new URL(
  "Content/_Algemeen/Proteus%20welkompagina%20Website%20NL.htm",
  BASE_ROOT
).href;

const VECTOR_STORE_ID =
  process.env.PROTEUS_VECTOR_STORE_ID ||
  "vs_69f47e3062c081919278a3f90251e981";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_PAGES = Number(process.env.ECI_MAX_PAGES || 2500);
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.ECI_CONCURRENCY || 8)));
const FILE_CHUNK_PAGES = Math.max(50, Number(process.env.ECI_FILE_CHUNK_PAGES || 350));

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY ontbreekt.");
  process.exit(1);
}

const indexCandidates = [
  START_URL,
  new URL("Data/HelpSystem.xml", BASE_ROOT).href,
  new URL("Data/Toc.xml", BASE_ROOT).href,
  new URL("Data/Toc.js", BASE_ROOT).href,
  new URL("Data/Navigation.xml", BASE_ROOT).href,
  new URL("Data/Search.xml", BASE_ROOT).href,
  new URL("Data/Search.js", BASE_ROOT).href,
  new URL("Data/Concepts.xml", BASE_ROOT).href,
  new URL("Data/Glossary.xml", BASE_ROOT).href
];

function normalizeUrl(raw, base = BASE_ROOT) {
  try {
    if (!raw) return null;
    const cleaned = raw
      .replace(/&amp;/g, "&")
      .replace(/^['"]|['"]$/g, "")
      .trim();

    if (
      !cleaned ||
      cleaned.startsWith("#") ||
      cleaned.startsWith("mailto:") ||
      cleaned.startsWith("javascript:") ||
      cleaned.startsWith("tel:")
    ) {
      return null;
    }

    const url = new URL(cleaned, base);
    url.hash = "";
    url.search = "";

    if (url.origin !== new URL(BASE_ROOT).origin) return null;
    if (!url.pathname.startsWith(new URL(BASE_ROOT).pathname)) return null;
    if (!/\.html?$/i.test(url.pathname)) return null;

    return url.href;
  } catch {
    return null;
  }
}

function discoverTopicUrls(source, baseUrl) {
  const found = new Set();

  const patterns = [
    /(?:href|src)\s*=\s*["']([^"'#]+?\.html?)(?:[?#][^"']*)?["']/gi,
    /["']([^"']+?\.html?)(?:[?#][^"']*)?["']/gi,
    /(?:Url|Link|Path|Topic)\s*[:=]\s*["']([^"']+?\.html?)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const normalized = normalizeUrl(match[1], baseUrl);
      if (normalized) found.add(normalized);
    }
  }

  return [...found];
}

function decodeEntities(text) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  return text
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlToText(html) {
  let text = html;

  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--([\s\S]*?)-->/g, " ");

  text = text.replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|ul|ol)>/gi, "\n");
  text = text.replace(/<(br|hr)\s*\/?\s*>/gi, "\n");
  text = text.replace(/<li\b[^>]*>/gi, "- ");
  text = text.replace(/<[^>]+>/g, " ");

  text = decodeEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function getTitle(html, url) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const raw = h1Match?.[1] || titleMatch?.[1] || new URL(url).pathname.split("/").pop();

  return htmlToText(raw).slice(0, 300);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Proteus-Kennisimport/1.0 (+GitHub Actions)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    !contentType.includes("text/") &&
    !contentType.includes("xml") &&
    !contentType.includes("javascript")
  ) {
    return null;
  }

  return await response.text();
}

async function crawlEci() {
  const queue = [];
  const queued = new Set();
  const visited = new Set();
  const pages = [];

  const enqueue = (url) => {
    const normalized = normalizeUrl(url);
    if (!normalized || queued.has(normalized) || visited.has(normalized)) return;
    queued.add(normalized);
    queue.push(normalized);
  };

  enqueue(START_URL);

  for (const candidate of indexCandidates) {
    try {
      const source = await fetchText(candidate);
      if (!source) continue;

      for (const topicUrl of discoverTopicUrls(source, candidate)) {
        enqueue(topicUrl);
      }
    } catch (error) {
      console.warn("Index niet leesbaar:", candidate, error.message);
    }
  }

  while (queue.length && visited.size < MAX_PAGES) {
    const batch = queue.splice(0, CONCURRENCY);

    await Promise.all(
      batch.map(async (url) => {
        queued.delete(url);
        if (visited.has(url) || visited.size >= MAX_PAGES) return;
        visited.add(url);

        try {
          const html = await fetchText(url);
          if (!html) return;

          for (const discovered of discoverTopicUrls(html, url)) {
            enqueue(discovered);
          }

          const text = htmlToText(html);
          if (text.length < 120) return;

          pages.push({
            url,
            title: getTitle(html, url),
            text
          });

          if (pages.length % 50 === 0) {
            console.log(`ECI pagina's verwerkt: ${pages.length}`);
          }
        } catch (error) {
          console.warn("Pagina overgeslagen:", url, error.message);
        }
      })
    );
  }

  pages.sort((a, b) => a.url.localeCompare(b.url));
  return pages;
}

async function openAiJson(path, options = {}) {
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function removeOldEciFiles() {
  let after = null;
  const oldFileIds = [];

  do {
    const params = new URLSearchParams({ limit: "100" });
    if (after) params.set("after", after);

    const page = await openAiJson(
      `/vector_stores/${VECTOR_STORE_ID}/files?${params.toString()}`
    );

    for (const item of page.data || []) {
      try {
        const file = await openAiJson(`/files/${item.id}`);
        if (file.filename?.startsWith("eci-proteus-online-help-")) {
          oldFileIds.push(item.id);
        }
      } catch (error) {
        console.warn("Bestandsnaam niet op te vragen:", item.id, error.message);
      }
    }

    after = page.has_more && page.data?.length
      ? page.data[page.data.length - 1].id
      : null;
  } while (after);

  for (const fileId of oldFileIds) {
    await openAiJson(`/vector_stores/${VECTOR_STORE_ID}/files/${fileId}`, {
      method: "DELETE"
    });

    try {
      await openAiJson(`/files/${fileId}`, { method: "DELETE" });
    } catch {
      // Los verwijderen van het OpenAI-bestand is niet kritisch.
    }
  }

  if (oldFileIds.length) {
    console.log(`Oude ECI-import verwijderd: ${oldFileIds.length} bestand(en).`);
  }
}

function buildKnowledgeFile(pages, part, totalParts) {
  const header = [
    "BRON: ECI Proteus Online Help",
    "Website: https://eu-manuals.ecisolutions.com/proteus/proteus_nl/",
    `Importdeel: ${part}/${totalParts}`,
    `Importdatum: ${new Date().toISOString()}`,
    "",
    "Gebruik de URL per onderwerp alleen als broncontext. De inhoud hieronder is afkomstig van de officiële ECI Proteus Online Help.",
    "",
    "============================================================",
    ""
  ].join("\n");

  const body = pages
    .map(
      (page) => [
        `TITEL: ${page.title}`,
        `BRON_URL: ${page.url}`,
        "",
        page.text,
        "",
        "------------------------------------------------------------",
        ""
      ].join("\n")
    )
    .join("\n");

  return header + body;
}

async function uploadKnowledgeFile(content, filename) {
  const form = new FormData();
  form.append("purpose", "assistants");
  form.append("file", new Blob([content], { type: "text/plain;charset=utf-8" }), filename);

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: form
  });

  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) {
    throw new Error(`Upload mislukt ${uploadResponse.status}: ${uploadText}`);
  }

  const uploaded = JSON.parse(uploadText);

  const attached = await openAiJson(`/vector_stores/${VECTOR_STORE_ID}/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_id: uploaded.id })
  });

  return { uploaded, attached };
}

async function waitForVectorFile(fileId) {
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const item = await openAiJson(
      `/vector_stores/${VECTOR_STORE_ID}/files/${fileId}`
    );

    if (item.status === "completed") return;
    if (item.status === "failed" || item.status === "cancelled") {
      throw new Error(`Vector store verwerking mislukt voor ${fileId}: ${JSON.stringify(item)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  throw new Error(`Timeout tijdens verwerken van ${fileId}`);
}

async function main() {
  console.log("ECI Proteus Online Help import gestart.");
  console.log("Vector store:", VECTOR_STORE_ID);

  const pages = await crawlEci();

  if (pages.length < 10) {
    throw new Error(
      `Te weinig ECI-pagina's gevonden (${pages.length}). Import afgebroken om een onvolledige kennisbron te voorkomen.`
    );
  }

  console.log(`Totaal bruikbare ECI-pagina's: ${pages.length}`);

  await removeOldEciFiles();

  const groups = [];
  for (let i = 0; i < pages.length; i += FILE_CHUNK_PAGES) {
    groups.push(pages.slice(i, i + FILE_CHUNK_PAGES));
  }

  const uploadedFileIds = [];

  for (let i = 0; i < groups.length; i++) {
    const filename = `eci-proteus-online-help-${String(i + 1).padStart(2, "0")}-van-${String(groups.length).padStart(2, "0")}.txt`;
    const content = buildKnowledgeFile(groups[i], i + 1, groups.length);

    console.log(`Upload ${i + 1}/${groups.length}: ${filename}`);
    const { uploaded } = await uploadKnowledgeFile(content, filename);
    uploadedFileIds.push(uploaded.id);
  }

  for (const fileId of uploadedFileIds) {
    await waitForVectorFile(fileId);
  }

  console.log("ECI-import gereed.");
  console.log(`Pagina's: ${pages.length}`);
  console.log(`Vector store bestanden toegevoegd: ${uploadedFileIds.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
