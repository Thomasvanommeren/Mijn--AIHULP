export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const { vraag } = req.body || {};

    if (!vraag) {
      return res.status(400).json({
        error: "Geen vraag ontvangen"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY ontbreekt in Vercel"
      });
    }

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
Je bent Thomas 2.0, de Proteus Goeroe.

Beantwoord vragen uitsluitend op basis van de gekoppelde bronnen.
Als je het antwoord niet kunt vinden, zeg dan:
"Ik kan je helaas niet verder helpen, bespreek je vraag met Thomas."

Geef korte, duidelijke en praktische antwoorden.
`
          },
          {
            role: "user",
            content: vraag
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
