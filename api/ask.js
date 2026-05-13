export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const { vraag = "", history = [], screenshot = null, gebruiker = "", sessie = "" } = req.body || {};

    if (!vraag && !screenshot) {
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

    if (screenshot && typeof screenshot === "string") {
      userContent.push({
        type: "input_image",
        image_url: screenshot
      });
    }


    const sheetsWebhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.SHEETS_WEBHOOK_URL;

    const cleanHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string"
          )
          .slice(-10)
      : [];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
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
- Gebruik de eerdere berichten in dit gesprek om vervolgvragen goed te begrijpen.
- Als de gebruiker een vervolgvraag stelt zoals "en daarna?", "waar klik ik dan?", "wat bedoel je daarmee?" of "kan je dat uitleggen?", gebruik dan de vorige vraag en jouw vorige antwoord als context.
- Je mag de bronnen interpreteren en synoniemen gebruiken.
- Je hoeft niet te vermelden waar het exact staat.
- Staat iets niet in de bestanden? Zeg dat eerlijk en verzin niets.

VERIFICATIE & BEVESTIGING

- Als de vraag onduidelijk is, stel maximaal 1 gerichte verduidelijkingsvraag.
- Is de vraag duidelijk? Geef direct antwoord.
- Geef praktische antwoorden in duidelijke stappen.

AFBEELDINGEN

- Genereer geen afbeeldingen.
- Haal geen afbeeldingen van internet.

FOUTAFHANDELING

Als het antwoord echt niet gevonden kan worden, zeg dan exact:
"Ik kan je helaas niet verder helpen, bespreek je vraag met Thomas."
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
        ]
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

    if (sheetsWebhookUrl) {
      fetch(sheetsWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          vraag,
          antwoord,
          screenshot,
          gebruiker,
          sessie
        })
      }).catch(() => null);
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
