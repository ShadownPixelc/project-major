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

app.use(express.json({ limit: '10mb' }));

// Initialize Google Gemini AI SDK on the server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Helper function to execute Python backend CLI
function runPythonCli(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [path.join(__dirname, 'backend', 'cli.py'), ...args]);
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          resolve(parsed);
        } catch (e) {
          resolve({ raw: stdoutData.trim() });
        }
      } else {
        console.error('Python CLI error:', stderrData);
        reject(new Error(stderrData || `Python exited with code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(err);
    });
  });
}

// 1. Analyze repository endpoint
app.post('/api/analyze-repo', async (req, res) => {
  try {
    const { repoUrl, depth = 2 } = req.body;
    const cleanRepo = (repoUrl || 'equinox-core').trim();

    // Run Python NetworkX + Tree-sitter + RAG engine
    const pythonResult = await runPythonCli(['analyze', '--repo', cleanRepo, '--depth', String(depth)]);
    res.json({
      success: true,
      repo: cleanRepo,
      data: pythonResult,
    });
  } catch (error: any) {
    console.error('Error analyzing repo:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze repository' });
  }
});

function withTimeout<T>(promise: Promise<T>, ms: number = 3500): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

// Track temporary quota backoff to gracefully prioritize Python RAG engine when quota is exceeded
let quotaExhaustedUntil = 0;

function handleGeminiError(err: any): void {
  const msg = String(err?.message || err || '');
  if (err?.status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
    // 60-second cooldown before retrying Gemini, automatically using Python RAG engine
    quotaExhaustedUntil = Date.now() + 60000;
  }
}

// 2. XAI Contributor Summary endpoint
app.post('/api/xai-summary', async (req, res) => {
  try {
    const {
      contributorId,
      contributorName,
      domain,
      role,
      keyContribution,
      ownedFunctions = [],
      repoName = 'equinox-core',
      repoDescription = '',
      authoredFiles = [],
      recentCommits = [],
      commitsCount,
      prsReviewed,
    } = req.body;

    const cleanRepo = repoName.trim() || 'equinox-core';
    const cName = contributorName || contributorId || 'Contributor';
    const cRole = role || domain || 'Core Maintainer';
    const cContribution = keyContribution || domain || 'Core architecture and module development';

    // Try Gemini model if key is present and quota is not temporarily exhausted
    if (process.env.GEMINI_API_KEY && Date.now() > quotaExhaustedUntil) {
      try {
        const prompt = `You are the Equinox XAI (Explainable AI) engine for software repositories.
Generate EXACTLY a 2-line summary describing what this contributor did in this repository:
Contributor: ${cName}
Role: ${cRole}
Key Contribution: ${cContribution}
Repository: ${cleanRepo} (${repoDescription || 'Software repository'})
Specific work in this repository:
- Files modified: ${authoredFiles.length > 0 ? authoredFiles.slice(0, 5).join(', ') : 'Core modules'}
- Recent commits: ${recentCommits.length > 0 ? recentCommits.slice(0, 4).map((c: any) => typeof c === 'string' ? c : c.message).join('; ') : 'Feature implementations'}
- AST Functions owned: ${ownedFunctions.length > 0 ? ownedFunctions.slice(0, 4).join(', ') : 'Primary functions'}
- Commits count: ${commitsCount || 10}, PRs reviewed: ${prsReviewed || 5}

STRICT REQUIREMENTS:
1. Line 1: Must explicitly state what "${cName}" specifically built or maintained in "${cleanRepo}" as "${cRole}", referencing their key contribution "${cContribution}".
2. Line 2: Must explain their architectural impact, AST function ownership, and why their code is critical to "${cleanRepo}".
3. Output EXACTLY 2 lines. Do not use generic filler. Ground every claim directly in their work for this repository.`;

        // Prefer gemini-3.1-flash-lite for immediate high-throughput responses
        let response: any;
        try {
          response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: prompt,
            }),
            3500
          );
        } catch (_err) {
          response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: prompt,
            }),
            3500
          );
        }

        const text = response?.text?.trim();
        if (text) {
          return res.json({ summary: text, source: 'gemini-xai', repo: cleanRepo });
        }
      } catch (geminiErr: any) {
        handleGeminiError(geminiErr);
        // Seamlessly fallback to python without logging loud errors
      }
    }

    // Python RAG fallback with exact repo context
    const xaiResult = await runPythonCli([
      'xai',
      '--repo',
      cleanRepo,
      '--contributor',
      contributorId || contributorName || 'c01',
    ]);

    res.json({
      summary: xaiResult.xai_summary,
      source: 'python-rag-engine',
      repo: cleanRepo,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to generate XAI summary' });
  }
});

// 3. Grounded RAG Query endpoint
app.post('/api/rag-query', async (req, res) => {
  try {
    const { query, contributorFocus, repoName = 'equinox-core' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const cleanRepo = repoName.trim() || 'equinox-core';

    // Run Python RAG retriever to obtain grounded citations and evidence documents
    const cliArgs = ['rag', '--repo', cleanRepo, '--query', query];
    if (contributorFocus) {
      cliArgs.push('--author', contributorFocus);
    }
    const retrievalResult = await runPythonCli(cliArgs);

    let answerText = '';
    const citations = retrievalResult.citations || [];
    const evidenceDocs = retrievalResult.evidence_documents || [];

    // Synthesize citation-grounded response using Gemini if available and quota permits
    if (process.env.GEMINI_API_KEY && Date.now() > quotaExhaustedUntil) {
      try {
        const systemPrompt = `You are the Equinox Grounded RAG Onboarding Assistant for ${cleanRepo}.
Answer the developer's question using ONLY the provided retrieved evidence.
Requirements:
1. Every claim MUST be substantiated by a citation in brackets: e.g. [Commit #...], [AST: func() in file:line], [PR #...], or [File: ...].
2. Provide a section with 2-3 concrete suggested actions/outcomes for the onboarding developer (e.g. "What code do I need to add", "Who should review PRs in this module", "Dependencies to import").
3. Do not hallucinate external libraries or unreferenced files.`;

        const prompt = retrievalResult.prompt_for_llm || `${systemPrompt}\n\nQuery: ${query}`;

        let response: any;
        try {
          response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: prompt,
            }),
            4000
          );
        } catch (_err) {
          response = await withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: prompt,
            }),
            4000
          );
        }

        answerText = response?.text || '';
      } catch (geminiError: any) {
        handleGeminiError(geminiError);
        answerText = `Based on retrieved repository evidence for ${cleanRepo}:
${evidenceDocs.map((d: any) => `${d.citation} ${d.text}`).join('\n\n')}

Suggested next step: Consult ${contributorFocus || 'the module owner'} regarding implementation details.`;
      }
    } else {
      answerText = `[Evidence-Grounded Insights for ${cleanRepo}]:\n${evidenceDocs.map((d: any) => `${d.citation} ${d.text}`).join('\n\n')}\n\nSuggested next step: Consult ${contributorFocus || 'the module owner'} regarding implementation details.`;
    }

    res.json({
      answer: answerText,
      citations,
      evidence: evidenceDocs,
      query,
    });
  } catch (error: any) {
    console.error('Error in RAG query:', error);
    res.status(500).json({ error: error.message || 'RAG query failed' });
  }
});

// 4. PDF Data Aggregation endpoint
app.post('/api/export-pdf-data', async (req, res) => {
  try {
    const pythonData = await runPythonCli(['pdf-data']);
    res.json({
      success: true,
      reportData: pythonData,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to aggregate PDF export data' });
  }
});

// Mount Vite middleware in development or serve static in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Equinox Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
