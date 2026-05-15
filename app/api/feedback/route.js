import Groq from "groq-sdk";

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function POST(request) {
  try {
    const { question, answer } = await request.json();

    const message = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `You are an expert interview coach. A candidate answered the following interview question. 

Give them:
1. A score out of 10 (be honest and strict)
2. Specific constructive feedback in 3-4 sentences

Respond in this exact format and nothing else:
SCORE: [number]/10
FEEDBACK: [your feedback here]

Question: ${question}
Candidate's Answer: ${answer}`,
        },
      ],
    });

    const raw = message.choices[0].message.content;
    const scoreLine = raw.match(/SCORE:\s*(\d+)\/10/);
    const feedbackLine = raw.match(/FEEDBACK:\s*(.+)/s);

    const score = scoreLine ? parseInt(scoreLine[1]) : null;
    const feedback = feedbackLine ? feedbackLine[1].trim() : raw;

    return Response.json({ score, feedback });
  } catch (error) {
    console.error("API Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}