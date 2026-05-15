import Groq from "groq-sdk";
const client = new Groq({ apiKey: process.env.GROQ_API_KEY, });

export async function POST(request) {
  try {
    const body = await request.json();
    const { type } = body;

    let prompt = "";
    let max_tokens = 1024;

    if (type === "generate") {
      const { jobDescription, difficulty } = body;
      prompt = `You are an expert interview coach. First check if the text below is a real job description. If it is not, respond with exactly: "INVALID_JOB_DESCRIPTION". Otherwise, generate 10 ${difficulty || "medium"} difficulty tailored interview questions with tips.

Job Description:
${jobDescription}

Format as a numbered list. For each question write the question then on the next line write "Tip:" followed by the tip.`;

    } else if (type === "feedback") {
      const { question, answer } = body;
      max_tokens = 512;
      prompt = `You are an expert interview coach. Give feedback on this answer.

Respond in this exact format:
SCORE: [number]/10
FEEDBACK: [3-4 sentences of constructive feedback]

Question: ${question}
Answer: ${answer}`;

    } else if (type === "followup") {
      const { question, answer } = body;
      max_tokens = 256;
      prompt = `You are an interviewer. Based on this question and answer, ask one sharp follow-up question to dig deeper.

Question: ${question}
Answer: ${answer}

Follow-up question:`;

    } else if (type === "report") {
      const { summary } = body;
      max_tokens = 512;
      prompt = `You are an expert interview coach. Based on these interview answers and scores, give a detailed report card. Include: overall performance summary, top strengths, areas to improve, and one actionable tip.

${summary}`;
    }

    const message = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.choices[0].message.content;

    if (type === "feedback") {
      const scoreLine = raw.match(/SCORE:\s*(\d+)\/10/);
      const feedbackLine = raw.match(/FEEDBACK:\s*(.+)/s);
      return Response.json({
        score: scoreLine ? parseInt(scoreLine[1]) : null,
        feedback: feedbackLine ? feedbackLine[1].trim() : raw,
      });
    }

    return Response.json({ result: raw });
  } catch (error) {
    console.error("API Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}