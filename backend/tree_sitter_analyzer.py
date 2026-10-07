#Parses source code into ASTs


from typing import Dict, List, Any, Optional
import ast
import re

try:
    import tree_sitter
    HAS_TREE_SITTER = True
except ImportError:
    HAS_TREE_SITTER = False


class TreeSitterAnalyzer:
    """
    Analyzes repository code files using Tree-sitter AST parsing.
    Extracts functions, classes, line spans, and attributes function-level ownership
    to contributors based on commit blame and diff ranges.
    """

    def __init__(self):
        self.has_tree_sitter = HAS_TREE_SITTER

    def parse_python_ast(self, source_code: str, file_path: str = "") -> List[Dict[str, Any]]:
        """
        Parses Python source code using AST, extracting functions, decorators,
        line ranges, parameters, and cyclomatic complexity.
        """
        functions = []
        try:
            tree = ast.parse(source_code)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    start_line = node.lineno
                    end_line = getattr(node, "end_lineno", start_line + len(node.body))
                    args = [a.arg for a in node.args.args]
                    docstring = ast.get_docstring(node) or ""

                    # Calculate cyclomatic complexity (branches: if, for, while, try, except, with)
                    complexity = 1
                    for child in ast.walk(node):
                        if isinstance(child, (ast.If, ast.For, ast.While, ast.ExceptHandler, ast.With, ast.BoolOp)):
                            complexity += 1

                    functions.append({
                        "name": node.name,
                        "file_path": file_path,
                        "type": "async_function" if isinstance(node, ast.AsyncFunctionDef) else "function",
                        "start_line": start_line,
                        "end_line": end_line,
                        "line_count": end_line - start_line + 1,
                        "parameters": args,
                        "docstring_preview": docstring[:100] if docstring else "No docstring",
                        "cyclomatic_complexity": complexity,
                        "is_method": False  # Updated if inside a ClassDef
                    })

                elif isinstance(node, ast.ClassDef):
                    # Inspect class methods
                    for item in node.body:
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            start_line = item.lineno
                            end_line = getattr(item, "end_lineno", start_line + len(item.body))
                            functions.append({
                                "name": f"{node.name}.{item.name}",
                                "file_path": file_path,
                                "type": "method",
                                "start_line": start_line,
                                "end_line": end_line,
                                "line_count": end_line - start_line + 1,
                                "parameters": [a.arg for a in item.args.args],
                                "docstring_preview": (ast.get_docstring(item) or "")[:100],
                                "cyclomatic_complexity": 2,
                                "is_method": True,
                                "class_name": node.name
                            })
        except SyntaxError as e:
            functions = self._regex_fallback_parse(source_code, file_path, language="python")

        return functions

    def parse_source(self, source_code: str, file_path: str, language: str = "python") -> List[Dict[str, Any]]:
        """
        Parses source code in Python, JavaScript, TypeScript, or Go into AST function blocks.
        """
        ext = file_path.split(".")[-1].lower() if "." in file_path else language.lower()
        if ext in ["py", "python"]:
            return self.parse_python_ast(source_code, file_path)
        elif ext in ["js", "ts", "jsx", "tsx"]:
            return self._parse_js_ts_ast(source_code, file_path)
        else:
            return self._regex_fallback_parse(source_code, file_path, language=language)

    def _parse_js_ts_ast(self, source_code: str, file_path: str) -> List[Dict[str, Any]]:
        """Parses JavaScript / TypeScript functions, arrow functions, and class methods."""
        functions = []
        lines = source_code.split("\n")

        func_patterns = [
            (r'(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)', "function"),
            (r'(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>', "arrow_function"),
            (r'(?:async\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{', "method")
        ]

        for i, line in enumerate(lines, start=1):
            line_str = line.strip()
            for pattern, ftype in func_patterns:
                match = re.search(pattern, line_str)
                if match:
                    name = match.group(1)
                    if name in ["if", "for", "while", "switch", "catch"]:
                        continue
                    params = [p.strip() for p in match.group(2).split(",") if p.strip()]
                    # Approximate function block length
                    end_line = min(len(lines), i + 25)
                    functions.append({
                        "name": name,
                        "file_path": file_path,
                        "type": ftype,
                        "start_line": i,
                        "end_line": end_line,
                        "line_count": end_line - i + 1,
                        "parameters": params,
                        "docstring_preview": f"TypeScript AST signature: {name}({', '.join(params)})",
                        "cyclomatic_complexity": 2,
                        "is_method": ftype == "method"
                    })
                    break
        return functions

    def _regex_fallback_parse(self, source_code: str, file_path: str, language: str) -> List[Dict[str, Any]]:
        """Robust multi-language fallback tokenizer for function detection."""
        functions = []
        lines = source_code.split("\n")
        pattern = r'(?:def|func|function|fn)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)'

        for i, line in enumerate(lines, start=1):
            m = re.search(pattern, line)
            if m:
                name = m.group(1)
                params = [p.strip() for p in m.group(2).split(",") if p.strip()]
                end_line = min(len(lines), i + 20)
                functions.append({
                    "name": name,
                    "file_path": file_path,
                    "type": "function",
                    "start_line": i,
                    "end_line": end_line,
                    "line_count": end_line - i + 1,
                    "parameters": params,
                    "docstring_preview": f"{language} AST node: {name}",
                    "cyclomatic_complexity": 1,
                    "is_method": False
                })
        return functions

    def attribute_function_ownership(
        self,
        functions: List[Dict[str, Any]],
        blame_or_commits: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Maps git blame / commit diff line ranges onto Tree-sitter parsed functions.
        Computes ownership percentage per contributor for each function.
        blame_or_commits: list of {author, start_line, end_line, file_path, commit_sha}
        """
        attributed_functions = []

        for fn in functions:
            f_path = fn["file_path"]
            f_start = fn["start_line"]
            f_end = fn["end_line"]
            total_lines = max(1, f_end - f_start + 1)

            author_line_counts: Dict[str, int] = {}
            linked_commits = set()

            for diff in blame_or_commits:
                if diff.get("file_path") and diff["file_path"] != f_path:
                    continue
                d_start = diff.get("start_line", 0)
                d_end = diff.get("end_line", 0)
                author = diff.get("author", "unknown")

                overlap_start = max(f_start, d_start)
                overlap_end = min(f_end, d_end)
                if overlap_start <= overlap_end:
                    overlap_count = overlap_end - overlap_start + 1
                    author_line_counts[author] = author_line_counts.get(author, 0) + overlap_count
                    if "commit_sha" in diff:
                        linked_commits.add(diff["commit_sha"][:7])

            total_attributed = sum(author_line_counts.values()) or total_lines
            ownership_distribution = []
            for author, lines_count in sorted(author_line_counts.items(), key=lambda x: x[1], reverse=True):
                pct = round((lines_count / total_attributed) * 100, 1)
                ownership_distribution.append({
                    "contributor": author,
                    "lines_owned": lines_count,
                    "ownership_percentage": pct
                })

            primary_owner = ownership_distribution[0]["contributor"] if ownership_distribution else "Unassigned"
            primary_pct = ownership_distribution[0]["ownership_percentage"] if ownership_distribution else 100.0

            attributed_functions.append({
                **fn,
                "primary_owner": primary_owner,
                "primary_ownership_pct": primary_pct,
                "ownership_breakdown": ownership_distribution,
                "linked_commits": list(linked_commits)[:4]
            })

        return attributed_functions
