const ECI_HOST = "eu-manuals.ecisolutions.com";
function safeEciPage(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === ECI_HOST
      && u.pathname.startsWith("/proteus/proteus_nl/Content/")
      && /\.html?$/i.test(u.pathname) ? u.href : null;
  } catch { return null; }
}
function cleanAnswer(value) {
  return String(value || "").replace(/cite[^]*/g, "")
    .replace(/【\d+†[^】]*】/g, "").trim();
}
function attrsOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z][\w-]*)\s*=\s*(["'])(.*?)\2/g)) attrs[m[1].toLowerCase()] = m[3];
  return attrs;
}
async function getEciImages(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const r = await fetch(source.url, {signal: controller.signal, redirect:"error",headers:{Accept:"text/html"}});
    if (!r.ok || !(r.headers.get("content-type") || "").includes("text/html")) return [];
    const html = (await r.text()).slice(0, 750000);
    const images = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const a = attrsOf(match[0]);
      const src = a.src || a["data-src"];
      if (!src || src.startsWith("data:")) continue;
      let u;
      try { u = new URL(src.replace(/&amp;/g, "&"), source.url); } catch { continue; }
      if (u.protocol !== "https:" || u.hostname !== ECI_HOST || !/\.(png|jpe?g|webp|gif)$/i.test(u.pathname)) continue;
      const label = (a.alt || a.title || "").trim();
      if (/logo|icon|icoon|arrow|pijl|banner|bullet|search|zoeken|menu|print|helpdesk/i.test(label + " " + u.pathname.split("/").pop())) continue;
      const w = Number(a.width || 0), h = Number(a.height || 0);
      if ((w && w < 180) || (h && h < 110)) continue;
      if (images.some(i => i.url === u.href)) continue;
      images.push({url: u.href, alt: label || "Schermvoorbeeld uit Proteus Online Help", bron: source.url});
      if (images.length === 2) break;
    }
    return images;
  } catch { return []; }
  finally { clearTimeout(timeout); }
}


export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({error:"Methode niet toegestaan"});
  const url = safeEciPage(req.query?.url);
  if (!url) return res.status(400).json({error:"Ongeldige ECI-bronpagina"});
  // De bron is een concrete pagina uit een daadwerkelijk geciteerd AI-antwoord.
  const afbeeldingen = await getEciImages({url});
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({afbeeldingen});
}
