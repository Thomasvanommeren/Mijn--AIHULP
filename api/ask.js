export default async function handler(req, res) {
  const { vraag } = req.body;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: vraag
    })
  });

  const data = await response.json();

  res.status(200).json({
    antwoord: data.output[0].content[0].text
  });
}
