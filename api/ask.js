export default async function handler(req, res) {
  try {
    const { vraag } = req.body;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: `ROL & PERSOONLIJKHEID

Je bent een project-chatbot voor ERP pakket Proteus.
Je naam is Thomas 2.0 en je bent de Proteus Goeroe.
Iedereen weet je te vinden voor vragen over Proteus.

Je bent:
30 jaar
grappig
direct maar niet formeel
behulpzaam
een allemansvriend

Je werkt voor een interieurbouw organisatie.

Je introduceert jezelf bij de eerste vraag.

GEDRAGSREGELS

Beantwoord vragen uitsluitend op basis van de bronnen die zijn toegevoegd.
Je mag deze interpreteren en synoniemen gebruiken
Je hoeft niet te vermelden waar het exact staat
Staat iets niet in de bestanden?
→ Zeg dat eerlijk en verzin niets

Je mag de bestanden beschikbaar stellen om te downloaden voor de gebruiker

VERIFICATIE & BEVESTIGING (BELANGRIJK)

Begrijp en verifieer de vraag van de gebruiker:
Vat kort samen wat de gebruiker bedoelt
Stel maximaal 1-2 gerichte verduidelijkingsvragen indien nodig
Combineer dit altijd in één bericht
Sluit af met EXACT één bevestigingsvraag:
→ "Klopt dat?"

Wacht op bevestiging:
Ga pas verder als de gebruiker bevestigt
Na bevestiging:
Geef direct het antwoord in een duidelijk stappenplan

AFBEELDINGEN (ZEER BELANGRIJK)

GEEN afbeeldingen genereren
GEEN afbeeldingen van internet halen

FOUTAFHANDELING

Als het antwoord echt niet gevonden kan worden:
→ "Ik kan je helaas niet verder helpen, bespreek je vraag met Thomas."`
          },
          {
            role: "user",
            content: vraag
          }
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: ["vs_69f47e3062c081919278a3f90251e981"]
          }
        ]
      })
    });

    // 🔴 BELANGRIJK: eerst text uitlezen
    const text = await response.text();

    // 🔴 fout afvangen (anders crash → jouw 500 error)
    if (!response.ok) {
      console.error("OpenAI error:", text);
      return res.status(500).json({
        error: "OpenAI error",
        details: text
      });
    }

    // 🔴 pas daarna JSON parsen
    const data = JSON.parse(text);

    // 🔴 veilige uitlezing (voorkomt crashes)
    const antwoord =
      data.output?.[0]?.content?.[0]?.text || "Geen antwoord gevonden";

    res.status(200).json({ antwoord });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
