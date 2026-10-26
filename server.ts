import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import type { Response } from 'express';
import type { ViteDevServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PYTHON = process.env.PYTHON_BIN || 'python';

app.disable('x-powered-by');

// Log requests and completed responses.
app.use((req, res, next) => {
  const started = Date.now();

  console.log(`[HTTP] ${req.method} ${req.url}`);

  res.on('finish', () => {
    console.log(
      `[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started}ms)`
    );
  });

  next();
});

// Keep this route before body parsing and Vite middleware.
app.get('/health-check', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    server: 'express',
    timestamp: new Date().toISOString(),
  });
});

app.use(express.json({ limit: '10mb' }));

// Gemini is optional. The Python evidence engine remains the fallback.
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    })
  : null;

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
].filter((model, index, models): model is string =>
  Boolean(model) && models.indexOf(model) === index
);

class PythonError extends Error {
  kind: string;

  constructor(message: string, kind: string) {
    super(message);
    this.name = 'PythonError';
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

function sendError(res: Response, error: unknown) {
  if (res.headersSent) return;

  const e = error as {
    kind?: string;
    message?: string;
  };

  const kind = e?.kind || 'internal';
  const status =
    HTTP_BY_KIND[kind] ??
    (kind === 'github' || kind === 'network' ? 502 : 500);

  if (status >= 500) {
    console.error('[API] Backend error:', error);
  }

  res.status(status).json({
    error: e?.message || 'Request failed',
    kind,
  });
}

// Execute the Python evidence engine.
function runPythonCli(
  args: string[],
  timeoutMs = 120_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, 'backend', 'cli.py');

    const proc = spawn(PYTHON, [cliPath, ...args], {
      env: process.env,
      windowsHide: true,
    });

    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      proc.kill();

      if (!settled) {
        settled = true;
        reject(
          new PythonError(
            'Repository analysis timed out. Please try again.',
            'timeout'
          )
        );
      }
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      out += data.toString();
    });

    proc.stderr.on('data', (data) => {
      err += data.toString();
    });

    proc.on('error', (error) => {
      clearTimeout(timer);

      if (settled) return;
      settled = true;

      reject(
        new PythonError(
          `Could not start Python (${PYTHON}): ${error.message}. Check PYTHON_BIN and your virtual environment.`,
          'internal'
        )
      );
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (settled) return;
      settled = true;

      let parsed: any;

      try {
        parsed = JSON.parse(out.trim());
      } catch {
        parsed = null;
      }

      if (parsed?.status === 'error') {
        reject(
          new PythonError(
            parsed.error || 'Python analysis failed',
            parsed.kind || 'internal'
          )
        );
        return;
      }

      if (code !== 0 || !parsed) {
        const tail = err.trim().split('\n').slice(-3).join(' ');
        reject(
          new PythonError(
            tail || `Python exited with code ${code}`,
            'internal'
          )
        );
        return;
      }

      resolve(parsed);
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timed out'));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

let quotaExhaustedUntil = 0;

function handleGeminiError(error: unknown): void {
  const e = error as { message?: string; status?: number };
  const message = String(e?.message || error || '');

  if (
    e?.status === 429 ||
    message.includes('429') ||
    message.includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED')
  ) {
    quotaExhaustedUntil = Date.now() + 60_000;
  }

  console.warn('[Gemini] Request failed:', message);
}

async function askGemini(
  prompt: string,
  ms: number
): Promise<string | null> {
  if (!ai || Date.now() < quotaExhaustedUntil) {
    return null;
  }

  for (const model of GEMINI_MODELS) {
    try {
      const response: any = await withTimeout(
        ai.models.generateContent({
          model,
          contents: prompt,
        }),
        ms
      );

      const text = response?.text?.trim();

      if (text) return text;
    } catch (error) {
      handleGeminiError(error);
    }
  }

  return null;
}

const numbers = (value: string) =>
  value.match(/\d+(?:\.\d+)?/g) ?? [];

// 1. Analyze repository.
app.post('/api/analyze-repo', async (req, res) => {
  try {
    const { repoUrl, depth = 2, refresh = false } = req.body;
    const repo = String(repoUrl || '').trim();

    if (!repo) {
      res.status(400).json({
        error: 'Enter a GitHub repository (owner/repo or URL).',
        kind: 'invalid',
      });
      return;
    }

    const args = [
      'analyze',
      '--repo',
      repo,
      '--depth',
      String(depth),
    ];

    if (refresh) args.push('--refresh');

    const data = await runPythonCli(args);

    res.json({
      success: true,
      repo: data.repo_name,
      data,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 2. Explainable AI contributor summary.
app.post('/api/xai-summary', async (req, res) => {
  try {
    const { repoName, contributorId, contributorName } = req.body;
    const who = String(contributorId || contributorName || '').trim();

    if (!repoName || !who) {
      res.status(400).json({
        error: 'repoName and contributorId are required',
        kind: 'invalid',
      });
      return;
    }

    const py = await runPythonCli([
      'xai',
      '--repo',
      String(repoName),
      '--contributor',
      who,
    ]);

    let summary: string = py.xai_summary;
    let source = 'evidence-engine';

    const prompt = `Rewrite the DRAFT as EXACTLY two plain-text lines (no markdown, no bullets, no preamble).
Line 1: what the contributor works on and how active they are.
Line 2: code ownership, reviews and risk.
Use ONLY facts from FACTS. Do not add or change any number, name, file or claim. Keep each line under 220 characters.

FACTS: ${JSON.stringify(py.evidence)}

DRAFT:
${py.xai_summary}`;

    const text = await askGemini(prompt, 4000);

    if (text) {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const allowed = new Set(
        numbers(JSON.stringify(py.evidence) + py.xai_summary)
      );

      const faithful =
        lines.length === 2 &&
        numbers(text).every((number) => allowed.has(number));

      if (faithful) {
        summary = lines.join('\n');
        source = 'gemini-xai';
      }
    }

    res.json({
      summary,
      source,
      repo: py.repo_name,
      evidence: py.evidence,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 3. Grounded RAG query.
app.post('/api/rag-query', async (req, res) => {
  try {
    const { query, contributorFocus, repoName } = req.body;

    if (!query || !repoName) {
      res.status(400).json({
        error: 'repoName and query are required',
        kind: 'invalid',
      });
      return;
    }

    const args = [
      'rag',
      '--repo',
      String(repoName),
      '--query',
      String(query),
    ];

    if (contributorFocus) {
      args.push('--author', String(contributorFocus));
    }

    const result = await runPythonCli(args);
    let answer: string = result.extractive_answer;

    if (result.evidence_documents.length > 0) {
      const text = await askGemini(result.prompt_for_llm, 5000);

      if (
        text &&
        result.citations.some((citation: string) =>
          text.includes(citation)
        )
      ) {
        answer = text;
      }
    }

    res.json({
      answer,
      citations: result.citations,
      evidence: result.evidence_documents,
      query,
      retriever: result.retriever,
    });
  } catch (error) {
    sendError(res, error);
  }
});

// 4. PDF report data.
app.post('/api/export-pdf-data', async (req, res) => {
  try {
    const { repoName } = req.body;

    if (!repoName) {
      res.status(400).json({
        error: 'repoName is required',
        kind: 'invalid',
      });
      return;
    }

    const reportData = await runPythonCli([
      'pdf-data',
      '--repo',
      String(repoName),
    ]);

    res.json({
      success: true,
      reportData,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    sendError(res, error);
  }
});

// API fallback: return JSON instead of an HTML page for unknown API routes.
app.use('/api', (_req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    kind: 'not_found',
  });
});

// Initialize frontend middleware after the HTTP listener is running.
let viteServer: ViteDevServer | undefined;

async function initializeFrontend(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');

    app.use(express.static(distPath));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }

      res.sendFile(path.join(distPath, 'index.html'), (error) => {
        if (error) next(error);
      });
    });

    console.log(`[Frontend] Serving production files from ${distPath}`);
    return;
  }

  try {
    const { createServer: createViteServer } = await import('vite');

    viteServer = await createViteServer({
      configFile: path.join(__dirname, 'vite.config.ts'),
      server: {
        middlewareMode: true,
        hmr: {
          // Use Vite's default WebSocket behavior unless disabled explicitly.
          ...(process.env.DISABLE_HMR === 'true'
            ? { server: null }
            : {}),
        },
      },
      appType: 'spa',
    });

    app.use(viteServer.middlewares);

    console.log('[Frontend] Vite middleware initialized');
  } catch (error) {
    console.error('[Frontend] Failed to initialize Vite:', error);
    console.error(
      '[Frontend] Health check and API routes remain available.'
    );
  }
}

// Start Express first so the health check can respond independently.
const server = app.listen(PORT, HOST, () => {
  console.log(`[Equinox Server] Listening on http://${HOST}:${PORT}`);
  console.log(
    `[Equinox Server] Health check: http://${HOST}:${PORT}/health-check`
  );

  void initializeFrontend();
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[Equinox Server] Port ${PORT} is already in use. Stop the old server or choose another PORT.`
    );
  } else {
    console.error('[Equinox Server] Listener error:', error);
  }

  process.exitCode = 1;
});

server.requestTimeout = 120_000;
server.headersTimeout = 125_000;

process.on('unhandledRejection', (reason) => {
  console.error('[Node] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Node] Uncaught exception:', error);
});

async function shutdown() {
  console.log('[Equinox Server] Shutting down...');

  if (viteServer) {
    await viteServer.close();
  }

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
