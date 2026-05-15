"use client";
import { useState, useEffect, useRef } from "react";

interface Question {
  question: string;
  tip: string;
  answer: string;
  feedback: string;
  score: number | null;
  loadingFeedback: boolean;
  followUp: string;
  loadingFollowUp: boolean;
}

function parseQuestions(raw: string): Question[] {
  const blocks = raw.split(/\n(?=\d+\.)/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.trim().split("\n");
    const questionLine = lines[0].replace(/^\d+\.\s*/, "").trim();
    const tipLine = lines.find((l) => l.toLowerCase().startsWith("tip:")) || "";
    const tip = tipLine.replace(/^tip:\s*/i, "").trim();
    return { question: questionLine, tip, answer: "", feedback: "", score: null, loadingFeedback: false, followUp: "", loadingFollowUp: false };
  });
}

export default function Home() {
  const [jobDescription, setJobDescription] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"input" | "questions">("input");
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [showReport, setShowReport] = useState(false);
  const [reportSummary, setReportSummary] = useState("");
  const [loadingReport, setLoadingReport] = useState(false);
  const [timers, setTimers] = useState<{[key: number]: number}>({});
  const [timerActive, setTimerActive] = useState<{[key: number]: boolean}>({});
  const timerRefs = useRef<{[key: number]: NodeJS.Timeout}>({});

  useEffect(() => {
    setMounted(true);
    const handleMouse = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("jobit_session");
    if (saved) {
      const { questions: q, jobDescription: jd, step: s } = JSON.parse(saved);
      if (q && jd && s) { setQuestions(q); setJobDescription(jd); setStep(s); }
    }
  }, []);

  useEffect(() => {
    if (questions.length > 0) {
      localStorage.setItem("jobit_session", JSON.stringify({ questions, jobDescription, step }));
    }
  }, [questions, jobDescription, step]);

  function startTimer(index: number) {
    setTimers(prev => ({ ...prev, [index]: 120 }));
    setTimerActive(prev => ({ ...prev, [index]: true }));
    timerRefs.current[index] = setInterval(() => {
      setTimers(prev => {
        if (prev[index] <= 1) {
          clearInterval(timerRefs.current[index]);
          setTimerActive(p => ({ ...p, [index]: false }));
          return { ...prev, [index]: 0 };
        }
        return { ...prev, [index]: prev[index] - 1 };
      });
    }, 1000);
  }

  function stopTimer(index: number) {
    clearInterval(timerRefs.current[index]);
    setTimerActive(prev => ({ ...prev, [index]: false }));
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function speakQuestion(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function copyQuestion(text: string, tip: string) {
    navigator.clipboard.writeText(`Question: ${text}\n\nTip: ${tip}`);
    alert("Copied to clipboard!");
  }

  async function handleGenerate() {
    if (!jobDescription.trim()) return;
    if (jobDescription.trim().split(" ").length < 10) {
      alert("Please paste a real job description — it looks too short!");
      return;
    }
    setLoading(true);
    setShowReport(false);
    setReportSummary("");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "generate", jobDescription, difficulty }),
    });
    const data = await res.json();
    if (data.result.trim() === "INVALID_JOB_DESCRIPTION") {
      setLoading(false);
      alert("That doesn't look like a real job description. Please paste a valid one!");
      return;
    }
    const parsed = parseQuestions(data.result);
    setQuestions(parsed);
    setLoading(false);
    setStep("questions");
    localStorage.removeItem("jobit_session");
  }

  async function handleFeedback(index: number) {
    const q = questions[index];
    if (!q.answer.trim()) return;
    setQuestions((prev) => prev.map((item, i) => (i === index ? { ...item, loadingFeedback: true, feedback: "" } : item)));
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "feedback", question: q.question, answer: q.answer }),
    });
    const data = await res.json();
    setQuestions((prev) => prev.map((item, i) => i === index ? { ...item, feedback: data.feedback, score: data.score, loadingFeedback: false } : item));
  }

  async function handleFollowUp(index: number) {
    const q = questions[index];
    if (!q.answer.trim()) return;
    setQuestions((prev) => prev.map((item, i) => (i === index ? { ...item, loadingFollowUp: true, followUp: "" } : item)));
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "followup", question: q.question, answer: q.answer }),
    });
    const data = await res.json();
    setQuestions((prev) => prev.map((item, i) => i === index ? { ...item, followUp: data.result, loadingFollowUp: false } : item));
  }

  async function handleReport() {
    const answered = questions.filter(q => q.score !== null);
    if (answered.length === 0) { alert("Answer at least one question and get feedback first!"); return; }
    setLoadingReport(true);
    setShowReport(true);
    const summary = answered.map((q) => `Q: ${q.question}\nAnswer: ${q.answer}\nScore: ${q.score}/10`).join("\n\n");
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "report", summary }),
    });
    const data = await res.json();
    setReportSummary(data.result);
    setLoadingReport(false);
  }

  function exportPDF() {
    const content = questions.map((q, i) =>
      `Question ${i + 1}: ${q.question}\n\nYour Answer: ${q.answer || "Not answered"}\n\nFeedback: ${q.feedback || "No feedback"}\nScore: ${q.score !== null ? `${q.score}/10` : "N/A"}\n\n---\n\n`
    ).join("");
    const blob = new Blob([`JOBIT - Interview Practice Session\n\n${content}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobit-session.txt";
    a.click();
  }

  const answeredCount = questions.filter(q => q.score !== null).length;
  const avgScore = answeredCount > 0
    ? Math.round(questions.filter(q => q.score !== null).reduce((sum, q) => sum + (q.score || 0), 0) / answeredCount)
    : null;

  return (
    <main className="min-h-screen bg-[#06060f] text-white overflow-x-hidden">
      <style>{`
        @keyframes float1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-20px) scale(1.05)} 66%{transform:translate(-20px,10px) scale(0.95)} }
        @keyframes float2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-25px,20px) scale(1.03)} 66%{transform:translate(15px,-15px) scale(0.97)} }
        @keyframes float3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(20px,20px)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        @keyframes slide-up { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes spin-reverse { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }
        @keyframes bounce-in { 0%{transform:scale(0.3);opacity:0} 50%{transform:scale(1.05)} 70%{transform:scale(0.95)} 100%{transform:scale(1);opacity:1} }
        @keyframes gradient-shift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
        @keyframes timer-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .float1 { animation: float1 8s ease-in-out infinite; }
        .float2 { animation: float2 10s ease-in-out infinite; }
        .float3 { animation: float3 6s ease-in-out infinite; }
        .slide-up { animation: slide-up 0.6s cubic-bezier(0.16,1,0.3,1) forwards; }
        .slide-up-delay-1 { animation: slide-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.1s forwards; opacity:0; }
        .slide-up-delay-2 { animation: slide-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.2s forwards; opacity:0; }
        .slide-up-delay-3 { animation: slide-up 0.6s cubic-bezier(0.16,1,0.3,1) 0.3s forwards; opacity:0; }
        .spin-slow { animation: spin-slow 20s linear infinite; }
        .spin-reverse { animation: spin-reverse 15s linear infinite; }
        .bounce-in { animation: bounce-in 0.6s cubic-bezier(0.16,1,0.3,1) forwards; }
        .timer-pulse { animation: timer-pulse 1s ease-in-out infinite; }
        .shimmer-text { background: linear-gradient(90deg, #a78bfa, #818cf8, #c4b5fd, #a78bfa); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 3s linear infinite; }
        .animated-gradient { background: linear-gradient(270deg, #7c3aed, #4f46e5, #7c3aed, #6d28d9); background-size: 400% 400%; animation: gradient-shift 4s ease infinite; }
        .card-hover { transition: all 0.4s cubic-bezier(0.16,1,0.3,1); }
        .card-hover:hover { transform: translateY(-6px) scale(1.01); box-shadow: 0 30px 80px rgba(139,92,246,0.2); border-color: rgba(139,92,246,0.4) !important; }
        .glow-btn { box-shadow: 0 0 30px rgba(139,92,246,0.4); transition: all 0.3s ease; }
        .glow-btn:hover { box-shadow: 0 0 60px rgba(139,92,246,0.7); transform: translateY(-2px) scale(1.02); }
        .orb { border-radius: 50%; filter: blur(80px); opacity: 0.4; }
        .cursor-glow { position: fixed; pointer-events: none; width: 400px; height: 400px; border-radius: 50%; background: radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%); transform: translate(-50%, -50%); transition: left 0.1s ease, top 0.1s ease; z-index: 0; }
        .feedback-appear { animation: bounce-in 0.5s cubic-bezier(0.16,1,0.3,1) forwards; }
      `}</style>

      {mounted && <div className="cursor-glow" style={{ left: mousePos.x, top: mousePos.y }} />}

      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{zIndex: 0}}>
        <div className="float1 orb absolute w-[700px] h-[700px] top-[-300px] left-[-200px]" style={{background: "radial-gradient(circle, rgba(124,58,237,0.5), rgba(79,70,229,0.2))"}}/>
        <div className="float2 orb absolute w-[600px] h-[600px] bottom-[-200px] right-[-200px]" style={{background: "radial-gradient(circle, rgba(99,102,241,0.5), rgba(139,92,246,0.2))"}}/>
        <div className="float3 orb absolute w-[400px] h-[400px] top-[40%] left-[40%]" style={{background: "radial-gradient(circle, rgba(167,139,250,0.2), transparent)"}}/>
        <div className="spin-slow absolute top-[10%] right-[10%] w-[300px] h-[300px] rounded-full" style={{border: "1px solid rgba(139,92,246,0.1)"}}/>
        <div className="spin-reverse absolute top-[10%] right-[10%] w-[400px] h-[400px] rounded-full" style={{border: "1px solid rgba(99,102,241,0.08)", margin: "-50px"}}/>
        <div style={{position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(139,92,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.03) 1px, transparent 1px)", backgroundSize: "60px 60px"}}/>
      </div>

      <header className="relative z-10 px-8 py-5 flex items-center justify-between" style={{borderBottom: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)", background: "rgba(6,6,15,0.8)"}}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl animated-gradient flex items-center justify-center text-sm font-bold shadow-lg">J</div>
            <div className="absolute inset-0 rounded-xl animated-gradient opacity-50 blur-md"/>
          </div>
          <span className="font-bold text-xl tracking-tight">Job<span className="shimmer-text">It</span></span>
        </div>
        <div className="flex items-center gap-4">
          {step === "questions" && avgScore !== null && (
            <div className="px-3 py-1.5 rounded-full text-xs font-black" style={{
              background: avgScore >= 8 ? "rgba(52,211,153,0.15)" : avgScore >= 5 ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.15)",
              border: avgScore >= 8 ? "1px solid rgba(52,211,153,0.3)" : avgScore >= 5 ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(248,113,113,0.3)",
              color: avgScore >= 8 ? "#34d399" : avgScore >= 5 ? "#fbbf24" : "#f87171",
            }}>Avg: {avgScore}/10</div>
          )}
          {step === "questions" && (
            <>
              <button onClick={exportPDF} className="text-xs text-white/40 hover:text-white transition px-3 py-1.5 rounded-lg" style={{border: "1px solid rgba(255,255,255,0.08)"}}>📄 Export</button>
              <button onClick={() => { setStep("input"); setQuestions([]); setShowReport(false); localStorage.removeItem("jobit_session"); }} className="text-sm text-white/40 hover:text-white transition">← Start over</button>
            </>
          )}
          {step === "input" && (
            <div className="flex items-center gap-2 text-xs text-white/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400" style={{boxShadow: "0 0 8px #34d399"}}/>
              AI Ready
            </div>
          )}
        </div>
      </header>

      {step === "input" && (
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[90vh] px-6">
          <div className="max-w-2xl w-full">
            <div className="slide-up flex items-center gap-2 mb-6 w-fit">
              <div className="px-4 py-1.5 rounded-full text-xs font-semibold tracking-widest uppercase" style={{background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa"}}>✦ AI Interview Coach</div>
            </div>
            <h1 className="slide-up-delay-1 text-6xl font-black tracking-tight mb-4 leading-[1.1]">
              Land your<br />dream <span className="shimmer-text">job.</span>
            </h1>
            <p className="slide-up-delay-2 text-white/40 mb-8 text-lg leading-relaxed">
              Paste any job description. Get tailored interview questions,<br />expert tips, and instant AI feedback on your answers.
            </p>
            <div className="slide-up-delay-2 flex gap-3 mb-6">
              <span className="text-xs text-white/30 self-center">Difficulty:</span>
              {(["easy", "medium", "hard"] as const).map((d) => (
                <button key={d} onClick={() => setDifficulty(d)} className="px-4 py-1.5 rounded-full text-xs font-semibold capitalize transition-all duration-200" style={{
                  background: difficulty === d ? (d === "easy" ? "rgba(52,211,153,0.2)" : d === "medium" ? "rgba(251,191,36,0.2)" : "rgba(248,113,113,0.2)") : "rgba(255,255,255,0.05)",
                  border: difficulty === d ? (d === "easy" ? "1px solid rgba(52,211,153,0.4)" : d === "medium" ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(248,113,113,0.4)") : "1px solid rgba(255,255,255,0.08)",
                  color: difficulty === d ? (d === "easy" ? "#34d399" : d === "medium" ? "#fbbf24" : "#f87171") : "rgba(255,255,255,0.4)",
                }}>
                  {d === "easy" ? "🟢" : d === "medium" ? "🟡" : "🔴"} {d}
                </button>
              ))}
            </div>
            <div className="slide-up-delay-3">
              <textarea
                className="w-full h-44 rounded-2xl p-5 text-white text-sm leading-relaxed resize-none outline-none transition-all duration-300"
                style={{background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(10px)"}}
                placeholder="Paste the job description here..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                onFocus={(e) => e.target.style.borderColor = "rgba(139,92,246,0.5)"}
                onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.08)"}
              />
            </div>
            <button onClick={handleGenerate} disabled={loading || !jobDescription.trim()} className="glow-btn animated-gradient mt-4 w-full py-4 rounded-2xl font-bold text-white text-sm tracking-wide disabled:opacity-30 disabled:cursor-not-allowed">
              {loading ? (
                <span className="flex items-center justify-center gap-3">
                  <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Crafting your questions...
                </span>
              ) : "Generate Interview Questions →"}
            </button>
            <div className="mt-8 flex items-center gap-6 text-xs text-white/25">
              <span>✦ 10 tailored questions</span><span>✦ Expert tips</span><span>✦ AI feedback + scores</span>
            </div>
          </div>
        </div>
      )}

      {step === "questions" && (
        <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
          <div className="slide-up mb-10">
            <h2 className="text-3xl font-black tracking-tight">Your Questions <span className="shimmer-text">✦</span></h2>
            <p className="text-white/30 text-sm mt-2">Answer each question and get instant AI coaching feedback with a score.</p>
          </div>
          <div className="flex flex-col gap-5">
            {questions.map((q, i) => (
              <div key={i} className="card-hover rounded-2xl p-6" style={{background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(10px)", animation: `slide-up 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 0.05}s forwards`, opacity: 0}}>
                <div className="flex gap-4 items-start mb-5">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black min-w-[36px]" style={{background: "rgba(139,92,246,0.2)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)"}}>
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white leading-snug text-[15px]">{q.question}</p>
                    {q.tip && (
                      <div className="mt-3 px-3 py-2 rounded-xl text-xs leading-relaxed" style={{background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)"}}>
                        <span className="font-bold" style={{color: "#a78bfa"}}>💡 Tip: </span>
                        <span className="text-white/50">{q.tip}</span>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={() => speakQuestion(q.question)} className="px-3 py-1 rounded-lg text-xs transition-all duration-200 hover:bg-white/10" style={{background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)"}}>🔊 Listen</button>
                      <button onClick={() => copyQuestion(q.question, q.tip)} className="px-3 py-1 rounded-lg text-xs transition-all duration-200 hover:bg-white/10" style={{background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)"}}>📋 Copy</button>
                      {!timerActive[i] ? (
                        <button onClick={() => startTimer(i)} className="px-3 py-1 rounded-lg text-xs transition-all duration-200 hover:bg-white/10" style={{background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)"}}>⏱️ {timers[i] !== undefined ? formatTime(timers[i]) : "2:00"}</button>
                      ) : (
                        <button onClick={() => stopTimer(i)} className="px-3 py-1 rounded-lg text-xs timer-pulse" style={{background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171"}}>⏱️ {formatTime(timers[i])} — Stop</button>
                      )}
                    </div>
                  </div>
                </div>
                <textarea
                  className="w-full h-28 rounded-xl p-4 text-sm text-white resize-none outline-none transition-all duration-300"
                  style={{background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)"}}
                  placeholder="Type your answer here..."
                  value={q.answer}
                  onChange={(e) => setQuestions((prev) => prev.map((item, idx) => (idx === i ? { ...item, answer: e.target.value } : item)))}
                  onFocus={(e) => e.target.style.borderColor = "rgba(139,92,246,0.4)"}
                  onBlur={(e) => e.target.style.borderColor = "rgba(255,255,255,0.07)"}
                />
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => handleFeedback(i)} disabled={q.loadingFeedback || !q.answer.trim()} className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed" style={{background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa"}}>
                    {q.loadingFeedback ? <span className="flex items-center gap-2"><svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Analyzing...</span> : q.feedback ? "✓ New Feedback" : "✦ Get AI Feedback"}
                  </button>
                  <button onClick={() => handleFollowUp(i)} disabled={q.loadingFollowUp || !q.answer.trim()} className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed" style={{background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8"}}>
                    {q.loadingFollowUp ? "Thinking..." : "🔁 Follow-up Q"}
                  </button>
                </div>
                {q.feedback && (
                  <div className="feedback-appear mt-4 p-4 rounded-xl text-sm leading-relaxed" style={{background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)"}}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🎯</span>
                        <span className="font-bold text-xs tracking-wide uppercase" style={{color: "#818cf8"}}>AI Feedback</span>
                      </div>
                      {q.score !== null && (
                        <div className="px-3 py-1 rounded-full text-xs font-black" style={{
                          background: q.score >= 8 ? "rgba(52,211,153,0.15)" : q.score >= 5 ? "rgba(251,191,36,0.15)" : "rgba(248,113,113,0.15)",
                          border: q.score >= 8 ? "1px solid rgba(52,211,153,0.3)" : q.score >= 5 ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(248,113,113,0.3)",
                          color: q.score >= 8 ? "#34d399" : q.score >= 5 ? "#fbbf24" : "#f87171",
                        }}>{q.score}/10</div>
                      )}
                    </div>
                    <p className="text-white/70">{q.feedback}</p>
                  </div>
                )}
                {q.followUp && (
                  <div className="feedback-appear mt-3 p-4 rounded-xl text-sm leading-relaxed" style={{background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)"}}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">🔁</span>
                      <span className="font-bold text-xs tracking-wide uppercase" style={{color: "#a78bfa"}}>Follow-up Question</span>
                    </div>
                    <p className="text-white/70">{q.followUp}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <button onClick={handleReport} disabled={loadingReport} className="glow-btn animated-gradient px-8 py-4 rounded-2xl font-bold text-white text-sm tracking-wide disabled:opacity-50">
              {loadingReport ? "Generating Report..." : "📊 Get Full Report Card"}
            </button>
          </div>
          {showReport && reportSummary && (
            <div className="feedback-appear mt-6 p-6 rounded-2xl" style={{background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)"}}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">📊</span>
                <div>
                  <h3 className="font-black text-lg">Report Card</h3>
                  {avgScore !== null && <p className="text-sm" style={{color: avgScore >= 8 ? "#34d399" : avgScore >= 5 ? "#fbbf24" : "#f87171"}}>Overall Average: {avgScore}/10</p>}
                </div>
              </div>
              <p className="text-white/70 text-sm leading-relaxed whitespace-pre-wrap">{reportSummary}</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}