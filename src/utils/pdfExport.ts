import jsPDF from 'jspdf';
import { RepoAnalysisData, ContributorNode } from '../types';

// jsPDF's built-in Helvetica only renders Latin-1, so strip anything else
// (emoji, CJK, curly quotes in commit messages) instead of printing garbage.
const clean = (s: string | null | undefined): string =>
  (s ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();

const trim = (s: string, max: number) => (s.length > max ? s.slice(0, max - 3) + '...' : s);

export function exportRepoPdfReport(repoData: RepoAnalysisData, xaiSummaries?: Record<string, string>) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
  };

  const drawHeader = () => {
    doc.setFillColor(15, 15, 24);
    doc.rect(0, 0, pageWidth, 45, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(0, 229, 255);
    doc.text('EQUINOX // REPOSITORY INTELLIGENCE REPORT', margin, 28);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin - 120, 28);
    y = 65;
  };

  const sectionTitle = (title: string) => {
    checkPageBreak(60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 214, 0);
    doc.text(title, margin, y);
    y += 18;
  };

  // First page banner
  drawHeader();

  // Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text(clean(repoData.repo_name).toUpperCase(), margin, y);
  y += 24;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(148, 163, 184);
  doc.text('Grounded Contributor Graph & Tree-sitter AST Function Attribution Analysis', margin, y);
  y += 16;

  // Data provenance line (what the numbers are based on)
  const ds = repoData.data_source;
  if (ds) {
    doc.setFontSize(9);
    doc.text(
      clean(
        `Live GitHub data fetched ${ds.fetched_at?.slice(0, 10) ?? ''} | ownership: ${
          ds.blame_used ? 'git blame' : 'file commit history (no blame)'
        } | parser: ${ds.parser}`
      ),
      margin,
      y
    );
    y += 14;
  }
  y += 5;

  // Divider
  doc.setDrawColor(40, 40, 60);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  // Section 1: Executive Overview & NetworkX Stats
  sectionTitle('1. NETWORKX TOPOLOGICAL GRAPH METRICS');

  const stats = repoData.network_stats;
  doc.setFillColor(24, 24, 37);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 55, 4, 4, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);

  const colWidth = (pageWidth - 2 * margin) / 4;
  doc.text('CONTRIBUTORS', margin + 15, y + 22);
  doc.text('COLLABORATIONS', margin + colWidth + 15, y + 22);
  doc.text('GRAPH DENSITY', margin + colWidth * 2 + 15, y + 22);
  doc.text('BUS FACTOR', margin + colWidth * 3 + 15, y + 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 229, 255);
  doc.text(String(stats.total_contributors), margin + 15, y + 42);
  doc.text(String(stats.total_collaborations), margin + colWidth + 15, y + 42);
  doc.text(String(stats.graph_density), margin + colWidth * 2 + 15, y + 42);
  doc.text(String((stats as any).bus_factor ?? 'n/a'), margin + colWidth * 3 + 15, y + 42);

  y += 75;

  // Section 2: Contributor Centrality & Bus Factor
  sectionTitle('2. CONTRIBUTOR CENTRALITY & BUS FACTOR RISK');

  const contributors = (repoData.nodes.filter(
    (n) => (n as ContributorNode).type === 'contributor' || !(n as any).type
  ) as ContributorNode[]).slice(0, 8);

  // Table header
  doc.setFillColor(30, 30, 48);
  doc.rect(margin, y, pageWidth - 2 * margin, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('CONTRIBUTOR', margin + 10, y + 14);
  doc.text('MAIN AREAS', margin + 130, y + 14);
  doc.text('COMMITS', margin + 310, y + 14);
  doc.text('BETWEENNESS', margin + 370, y + 14);
  doc.text('BUS FACTOR', margin + 450, y + 14);
  y += 20;

  if (contributors.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('No GitHub-linked contributors were found in the sampled history.', margin + 10, y + 14);
    y += 20;
  }

  contributors.forEach((c, idx) => {
    checkPageBreak(25);
    doc.setFillColor(idx % 2 === 0 ? 18 : 22, idx % 2 === 0 ? 18 : 22, idx % 2 === 0 ? 28 : 34);
    doc.rect(margin, y, pageWidth - 2 * margin, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(trim(clean(`${c.badge || String(idx + 1).padStart(2, '0')} ${c.name}`), 22), margin + 10, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(c.domain ? trim(clean(c.domain), 32) : 'n/a', margin + 130, y + 14);
    doc.text(String(c.commits_count ?? 0), margin + 310, y + 14);
    doc.text(String(c.betweenness_centrality ?? 'n/a'), margin + 370, y + 14);

    const risk = c.bus_factor_risk || 'LOW';
    if (risk === 'HIGH') doc.setTextColor(255, 23, 68);
    else if (risk === 'MEDIUM') doc.setTextColor(255, 214, 0);
    else doc.setTextColor(0, 230, 118);
    doc.text(`${risk} RISK`, margin + 450, y + 14);

    y += 20;
  });

  y += 25;
  checkPageBreak(120);

  // Section 3: Tree-sitter AST Function Ownership Breakdown
  sectionTitle('3. TREE-SITTER AST FUNCTION ATTRIBUTION');

  // Table header
  doc.setFillColor(30, 30, 48);
  doc.rect(margin, y, pageWidth - 2 * margin, 20, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('FUNCTION NAME', margin + 10, y + 14);
  doc.text('SOURCE FILE', margin + 180, y + 14);
  doc.text('PRIMARY OWNER', margin + 350, y + 14);
  doc.text('OWNERSHIP', margin + 450, y + 14);
  y += 20;

  const astList = (repoData.ast_functions || []).slice(0, 8);
  if (astList.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text('No parsable source functions were found in the most active files.', margin + 10, y + 14);
    y += 20;
  }

  astList.forEach((fn, idx) => {
    checkPageBreak(25);
    doc.setFillColor(idx % 2 === 0 ? 18 : 22, idx % 2 === 0 ? 18 : 22, idx % 2 === 0 ? 28 : 34);
    doc.rect(margin, y, pageWidth - 2 * margin, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 229, 255);
    doc.text(trim(clean(`${fn.name}()`), 28), margin + 10, y + 14);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(trim(clean(fn.file_path.split('/').pop() || fn.file_path), 26), margin + 180, y + 14);
    doc.text(trim(clean(fn.primary_owner) || 'n/a', 16), margin + 350, y + 14);

    // "~" marks values inferred from file commit history rather than git blame
    const approx = fn.ownership_basis && fn.ownership_basis !== 'blame' ? '~' : '';
    doc.setTextColor(255, 214, 0);
    doc.text(
      fn.primary_owner && fn.primary_ownership_pct != null
        ? `${approx}${Math.round(fn.primary_ownership_pct)}%`
        : 'n/a',
      margin + 450,
      y + 14
    );
    y += 20;
  });

  y += 25;
  checkPageBreak(120);

  // Section 4: Grounded Citations & Onboarding Guidance (real commits and PRs)
  sectionTitle('4. GROUNDED CITATION EVIDENCE');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);

  const sampleEvidence = [
    ...(repoData.commits || [])
      .slice(0, 4)
      .map((c) => trim(clean(`[Commit #${c.sha.slice(0, 7)}] ${c.message} (${c.author ?? 'unlinked author'})`), 100)),
    ...(repoData.prs || [])
      .slice(0, 3)
      .map((p) => trim(clean(`[PR #${p.id}] (${p.state}) ${p.title}`), 100)),
  ];

  if (sampleEvidence.length === 0) {
    doc.text('No commits or pull requests were retrieved for this repository.', margin + 10, y + 10);
    y += 26;
  }

  sampleEvidence.forEach((ev) => {
    checkPageBreak(22);
    doc.setFillColor(20, 20, 32);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 22, 3, 3, 'F');
    doc.setTextColor(0, 229, 255);
    doc.text(ev, margin + 10, y + 15);
    y += 26;
  });

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Equinox Automated Report // Page ${p} of ${totalPages} // Grounded with Tree-sitter AST & NetworkX`,
      margin,
      pageHeight - 20
    );
  }

  // Trigger browser download
  const cleanName = repoData.repo_name.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`equinox_${cleanName}_report.pdf`);
}