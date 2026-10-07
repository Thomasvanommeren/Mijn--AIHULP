export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const { vraag = "", history = [], screenshot = null, imageBase64 = null, gebruiker = "", sessie = "" } = req.body || {};

    const providedImage = imageBase64 || screenshot;

    if (!vraag && !providedImage) {
      return res.status(400).json({
        error: "Geen vraag of screenshot ontvangen"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY ontbreekt in Vercel"
      });
    }


    const userContent = [];

    if (vraag) {
      userContent.push({
        type: "input_text",
        text: vraag
      });
    }

    if (providedImage && typeof providedImage === "string") {
      userContent.push({
        type: "input_image",
        image_url: providedImage
      });
    }


    const cleanHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string"
          )
          .slice(-6)
      : [];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning: { effort: "none" },
        input: [
          {
            role: "system",
            content: `
ROL & PERSOONLIJKHEID

Je bent een project-chatbot voor ERP pakket Proteus.
Je naam is Thomas 2.0 en je bent de Proteus Goeroe.
Iedereen weet je te vinden voor vragen over Proteus.

Je bent:
- grappig
- direct maar niet formeel
- behulpzaam
- een allemansvriend

Je werkt voor een interieurbouw organisatie.

GEDRAGSREGELS

- Beantwoord vragen uitsluitend op basis van de gekoppelde bronnen.
- Zoek via file_search in zowel onze interne Proteus-documenten als de geïmporteerde officiële ECI Proteus Online Help.
- Interne documenten zijn leidend voor onze bedrijfsspecifieke werkwijze.
- De geïmporteerde officiële ECI Proteus Online Help is leidend voor algemene Proteus-functionaliteit.
- Gebruik geen algemene websearch voor Proteus-antwoorden.
- Als intern en ECI van elkaar afwijken, volg de interne werkwijze en benoem alleen indien relevant dat dit bedrijfsspecifiek is.
- Gebruik de eerdere berichten in dit gesprek om vervolgvragen goed te begrijpen.
- Als de gebruiker een vervolgvraag stelt zoals "en daarna?", "waar klik ik dan?", "wat bedoel je daarmee?" of "kan je dat uitleggen?", gebruik dan de vorige vraag en jouw vorige antwoord als context.
- Je mag de bronnen interpreteren en synoniemen gebruiken.
- Je hoeft niet te vermelden waar het exact staat.
- Noem geen bestandsnamen of documenttitels.
- Als je aantoonbaar interne documenten hebt gebruikt, mag je onderaan kort vermelden: "Bron: interne Proteus-handleiding".
- Als je aantoonbaar de officiële ECI Online Help hebt gebruikt, mag je onderaan kort vermelden: "Bron: ECI Proteus Online Help".
- Staat iets niet in de interne bestanden én niet in de officiële ECI-handleiding? Zeg dat eerlijk en verzin niets.

VERIFICATIE & BEVESTIGING

- Als de vraag onduidelijk is, stel maximaal 1 gerichte verduidelijkingsvraag.
- Is de vraag duidelijk? Geef direct antwoord.
- Geef praktische antwoorden in duidelijke stappen.
- Geef GEEN korte samenvatting of herhaling van hetzelfde antwoord.
- Antwoord standaard kort en bondig.
- Geef alleen een uitgebreider antwoord als de gebruiker daar expliciet om vraagt, bijvoorbeeld met: "leg uit", "meer details", "uitgebreid", "stap voor stap".

AFBEELDINGEN

- Genereer geen afbeeldingen.
- Haal geen afbeeldingen van internet.

FOUTAFHANDELING

Als het antwoord niet met voldoende zekerheid gevonden kan worden in de interne documenten of de officiële ECI Proteus Online Help, zeg dan exact:
"Ik kan het antwoord niet met voldoende zekerheid vinden. Bespreek je vraag met Thomas."
`
          },
          ...cleanHistory,
          {
            role: "user",
            content: userContent
          }
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: [
              "vs_69f47e3062c081919278a3f90251e981"
            ]
          }
        ],
        tool_choice: "auto"
      })
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "OpenAI error",
        details: text
      });
    }

    const data = JSON.parse(text);

    let antwoord = "Geen antwoord gevonden";

    if (data.output_text) {
      antwoord = data.output_text;
    }

    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "output_text" && content.text) {
              antwoord = content.text;
            }
          }
        }
      }
    }

    if (process.env.GOOGLE_SHEET_WEBHOOK) {
      try {
        const sheetResponse = await fetch(process.env.GOOGLE_SHEET_WEBHOOK, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            datum: new Date().toISOString(),
            vraag: vraag,
            antwoord: antwoord,
            gebruiker: "webchat",
            sessie: "proteus-ai"
          })
        });

        if (!sheetResponse.ok) {
          const sheetErrorText = await sheetResponse.text();
          console.error("Google Sheets logging failed:", sheetResponse.status, sheetErrorText);
        }
      } catch (sheetError) {
        console.error("Google Sheets logging error:", sheetError);
      }
    }

    return res.status(200).json({
      antwoord
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
