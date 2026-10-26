import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PYTHON = process.env.PYTHON_BIN || 'python3';

app.use(express.json({ limit: '10mb' }));

// Gemini is optional. Without a key everything is served by the evidence engine in Python.
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    })
  : null;
const GEMINI_MODELS = [process.env.GEMINI_MODEL, 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter(
  (m, i, a): m is string => !!m && a.indexOf(m) === i
);

class PythonError extends Error {
  kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.kind = kind;
  }
}

const HTTP_BY_KIND: Record<string, number> = {
  invalid: 400,
  auth: 401,
  not_found: 404,
  rate_limit: 429,
  timeout: 504,
};

function sendError(res: express.Response, e: any) {
  const kind = e?.kind || 'internal';
  const status = HTTP_BY_KIND[kind] ?? (kind === 'github' || kind === 'network' ? 502 : 500);
  if (status >= 500) console.error('Backend error:', e);
  res.status(status).json({ error: e?.message || 'Request failed', kind });
}

// Runs backend/cli.py. The CLI always prints JSON; on failure it prints {status:"error",kind,error} and exits 2.
function runPythonCli(args: string[], timeoutMs = 120_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [path.join(__dirname, 'backend', 'cli.py'), ...args], { env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new PythonError('Repository analysis timed out. Try again (results are cached once fetched).', 'timeout'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new PythonError(`Could not start Python (${PYTHON}): ${e.message}`, 'internal'));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      let parsed: any = null;
      try {
        parsed = JSON.parse(out.trim());
      } catch {
        /* handled below */
      }
      if (parsed?.status === 'error') return reject(new PythonError(parsed.error, parsed.kind || 'internal'));
      if (code !== 0 || !parsed) {
        const tail = err.trim().split('\n').slice(-3).join(' ');
        return reject(new PythonError(tail || `Python exited with code ${code}`, 'internal'));
      }
      resolve(parsed);
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

let quotaExhaustedUntil = 0;
function handleGeminiError(err: any): void {
  const msg = String(err?.message || err || '');
  if (err?.status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
    quotaExhaustedUntil = Date.now() + 60_000;
  }
}

async function askGemini(prompt: string, ms: number): Promise<string | null> {
  if (!ai || Date.now() < quotaExhaustedUntil) return null;
  for (const model of GEMINI_MODELS) {
    try {
      const r: any = await withTimeout(ai.models.generateContent({ model, contents: prompt }), ms);
      const text = r?.text?.trim();
      if (text) return text;
    } catch (e) {
      handleGeminiError(e);
    }
  }
  return null;
}

const numbers = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];

// 1. Analyze repository
app.post('/api/analyze-repo', async (req, res) => {
  try {
    const { repoUrl, depth = 2, refresh = false } = req.body;
    const repo = String(repoUrl || '').trim();
    if (!repo) return res.status(400).json({ error: 'Enter a GitHub repository (owner/repo or URL).', kind: 'invalid' });
    const args = ['analyze', '--repo', repo, '--depth', String(depth)];
    if (refresh) args.push('--refresh');
    const data = await runPythonCli(args);
    res.json({ success: true, repo: data.repo_name, data });
  } catch (e: any) {
    sendError(res, e);
  }
});

// 2. XAI contributor summary: facts come from the Python evidence engine; Gemini may only rephrase them.
app.post('/api/xai-summary', async (req, res) => {
  try {
    const { repoName, contributorId, contributorName } = req.body;
    const who = String(contributorId || contributorName || '').trim();
    if (!repoName || !who) return res.status(400).json({ error: 'repoName and contributorId are required', kind: 'invalid' });

    const py = await runPythonCli(['xai', '--repo', String(repoName), '--contributor', who]);
    let summary: string = py.xai_summary;
    let source = 'evidence-engine';

    const prompt = `Rewrite the DRAFT as EXACTLY two plain-text lines (no markdown, no bullets, no preamble).
Line 1: what the contributor works on and how active they are. Line 2: code ownership, reviews and risk.
Use ONLY facts from FACTS. Do not add or change any number, name, file or claim. Keep each line under 220 characters.

FACTS: ${JSON.stringify(py.evidence)}

DRAFT:
${py.xai_summary}`;
    const text = await askGemini(prompt, 4000);
    if (text) {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const allowed = new Set(numbers(JSON.stringify(py.evidence) + py.xai_summary));
      const faithful = lines.length === 2 && numbers(text).every((n) => allowed.has(n));
      if (faithful) {
        summary = lines.join('\n');
        source = 'gemini-xai';
      }
    }
    res.json({ summary, source, repo: py.repo_name, evidence: py.evidence });
  } catch (e: any) {
    sendError(res, e);
  }
});

// 3. Grounded RAG query
app.post('/api/rag-query', async (req, res) => {
  try {
    const { query, contributorFocus, repoName } = req.body;
    if (!query || !repoName) return res.status(400).json({ error: 'repoName and query are required', kind: 'invalid' });

    const args = ['rag', '--repo', String(repoName), '--query', String(query)];
    if (contributorFocus) args.push('--author', String(contributorFocus));
    const r = await runPythonCli(args);

    let answer: string = r.extractive_answer;
    if (r.evidence_documents.length > 0) {
      const text = await askGemini(r.prompt_for_llm, 5000);
      // Accept the LLM answer only if it actually cites retrieved evidence.
      if (text && r.citations.some((c: string) => text.includes(c))) answer = text;
    }
    res.json({ answer, citations: r.citations, evidence: r.evidence_documents, query, retriever: r.retriever });
  } catch (e: any) {
    sendError(res, e);
  }
});

// 4. PDF data
app.post('/api/export-pdf-data', async (req, res) => {
  try {
    const { repoName } = req.body;
    if (!repoName) return res.status(400).json({ error: 'repoName is required', kind: 'invalid' });
    const reportData = await runPythonCli(['pdf-data', '--repo', String(repoName)]);
    res.json({ success: true, reportData, generatedAt: new Date().toISOString() });
  } catch (e: any) {
    sendError(res, e);
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`[Equinox Server] Running on http://0.0.0.0:${PORT}`));
}

startServer();
