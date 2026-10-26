"""Equinox - Tree-sitter function extraction and ownership attribution.

Functions/methods are extracted with real Tree-sitter grammars (via
tree-sitter-language-pack). Python falls back to the stdlib `ast` module if no
grammar is available; other languages are skipped rather than guessed with regexes.
"""

import ast
import os
from typing import Any, Dict, List, Optional

LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "tsx", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
    ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".cs": "c_sharp", ".php": "php",
}
LANG_LABEL = {
    "python": "Python", "javascript": "JavaScript", "typescript": "TypeScript", "tsx": "TypeScript",
    "go": "Go", "rust": "Rust", "java": "Java", "ruby": "Ruby", "c": "C", "cpp": "C++",
    "c_sharp": "C#", "php": "PHP",
}
_JS_FUNCS = {"function_declaration", "generator_function_declaration", "method_definition",
             "arrow_function", "function_expression", "function"}
FUNCTION_TYPES = {
    "python": {"function_definition"}, "javascript": _JS_FUNCS, "typescript": _JS_FUNCS, "tsx": _JS_FUNCS,
    "go": {"function_declaration", "method_declaration"}, "rust": {"function_item"},
    "java": {"method_declaration", "constructor_declaration"}, "ruby": {"method", "singleton_method"},
    "c": {"function_definition"}, "cpp": {"function_definition"},
    "c_sharp": {"method_declaration", "constructor_declaration"},
    "php": {"function_definition", "method_declaration"},
}
CLASS_TYPES = {"class_definition", "class_declaration", "class", "impl_item", "trait_item",
               "interface_declaration", "class_specifier", "struct_specifier", "module"}
_DECISION = {
    "if_statement", "elif_clause", "elsif", "for_statement", "for_in_statement", "for_of_statement",
    "while_statement", "do_statement", "foreach_statement", "catch_clause", "except_clause",
    "conditional_expression", "ternary_expression", "if_expression", "for_expression", "while_expression",
    "loop_expression", "match_arm", "switch_case", "case_clause", "expression_case", "type_case", "when",
    "rescue", "unless", "if", "while", "for", "boolean_operator", "if_modifier", "unless_modifier",
}
_BINARY = {"binary_expression", "logical_expression"}
_LOGICAL_OPS = {b"&&", b"||", b"??", b"and", b"or"}
_IDENT = {"identifier", "field_identifier", "qualified_identifier", "operator_name", "destructor_name"}


def language_for_path(path: str) -> Optional[str]:
    return LANG_BY_EXT.get(os.path.splitext(path)[1].lower())


def language_label(path: str) -> str:
    lang = language_for_path(path)
    if lang:
        return LANG_LABEL[lang]
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    return {"md": "Markdown", "rst": "reStructuredText", "yml": "YAML", "yaml": "YAML", "json": "JSON",
            "toml": "TOML", "html": "HTML", "css": "CSS", "sh": "Shell", "txt": "Text"}.get(ext, ext.upper() or "File")


def _load_parser(lang: str):
    try:
        from tree_sitter_language_pack import get_parser
    except ImportError:
        try:
            from tree_sitter_languages import get_parser  # type: ignore
        except ImportError:
            return None
    try:
        return get_parser(lang)
    except Exception:
        return None


class TreeSitterAnalyzer:
    def __init__(self) -> None:
        self._parsers: Dict[str, Any] = {}
        self.used: set = set()

    def _parser(self, lang: str):
        if lang not in self._parsers:
            self._parsers[lang] = _load_parser(lang)
        return self._parsers[lang]

    def engine_for(self, path: str) -> Optional[str]:
        lang = language_for_path(path)
        if not lang:
            return None
        if self._parser(lang) is not None:
            return "tree-sitter"
        return "python-ast" if lang == "python" else None

    # ----------------------------------------------------------------- parsing
    def analyze_source(self, source: str, file_path: str) -> List[Dict[str, Any]]:
        lang = language_for_path(file_path)
        if not lang:
            return []
        parser = self._parser(lang)
        if parser is not None:
            self.used.add("tree-sitter")
            fns = self._ts_functions(parser, lang, source)
        elif lang == "python":
            self.used.add("python-ast")
            fns = self._py_functions(source)
        else:
            return []
        for f in fns:
            f["file_path"] = file_path
            f["language"] = LANG_LABEL[lang]
        return sorted(fns, key=lambda f: f["start_line"])

    @staticmethod
    def _text(src: bytes, node) -> str:
        return src[node.start_byte:node.end_byte].decode("utf-8", "ignore")

    def _name(self, node, src: bytes) -> Optional[str]:
        n = node.child_by_field_name("name")
        if n is not None:
            return self._text(src, n)
        d = node.child_by_field_name("declarator")  # C / C++
        while d is not None:
            if d.type in _IDENT:
                return self._text(src, d)
            d = d.child_by_field_name("declarator")
        p = node.parent
        if node.type in ("arrow_function", "function_expression", "function") and p is not None:
            holder = None
            if p.type == "variable_declarator":
                holder = p.child_by_field_name("name")
            elif p.type == "assignment_expression":
                holder = p.child_by_field_name("left")
            elif p.type in ("pair", "public_field_definition", "field_definition"):
                holder = p.child_by_field_name("key") or p.child_by_field_name("name")
            if holder is not None:
                return self._text(src, holder)
        return None

    def _class_name(self, node, src: bytes) -> Optional[str]:
        n = node.child_by_field_name("name") or node.child_by_field_name("type")
        return self._text(src, n) if n is not None else None

    def _params(self, node, src: bytes) -> List[str]:
        p = node.child_by_field_name("parameters") or node.child_by_field_name("parameter")
        if p is None:
            return []
        if p.type == "identifier":
            return [self._text(src, p)]
        out = []
        for ch in p.named_children:
            if ch.type == "comment":
                continue
            nm = ch.child_by_field_name("name") or ch.child_by_field_name("pattern")
            if nm is None and ch.type.startswith("typed_") and ch.named_child_count:
                nm = ch.named_children[0]
            t = self._text(src, nm if nm is not None else ch).strip()
            if t and t not in ("self", "cls"):
                out.append(t if len(t) <= 40 else t[:37] + "...")
        return out[:12]

    def _complexity(self, fn_node, src: bytes) -> int:
        count, stack = 1, [fn_node]
        while stack:
            n = stack.pop()
            if n.is_named and n.type in _DECISION:  # skip anonymous keyword tokens ('if', 'for', ...)
                count += 1
            elif n.is_named and n.type in _BINARY:
                op = n.child_by_field_name("operator")
                if op is not None and src[op.start_byte:op.end_byte] in _LOGICAL_OPS:
                    count += 1
            stack.extend(n.children)
        return count

    def _ts_functions(self, parser, lang: str, source: str) -> List[Dict[str, Any]]:
        src = source.encode("utf-8", "ignore")
        root = parser.parse(src).root_node
        ftypes = FUNCTION_TYPES[lang]
        out: List[Dict[str, Any]] = []
        stack = [(root, ())]
        while stack:
            node, classes = stack.pop()
            if node.type in ftypes:
                name = self._name(node, src)
                if name:
                    first = self._text(src, node).split("\n", 1)[0].strip()
                    out.append({
                        "name": ".".join(list(classes) + [name]),
                        "start_line": node.start_point[0] + 1,
                        "end_line": node.end_point[0] + 1,
                        "parameters": self._params(node, src),
                        "cyclomatic_complexity": self._complexity(node, src),
                        "signature": first[:140],
                        "is_method": bool(classes),
                    })
                    continue  # nested closures are not separate graph nodes
            ncls = classes
            if node.type in CLASS_TYPES:
                cn = self._class_name(node, src)
                if cn:
                    ncls = classes + (cn,)
            for ch in reversed(node.children):
                stack.append((ch, ncls))
        return out

    # ------------------------------------------------------------ python fallback
    def _py_functions(self, source: str) -> List[Dict[str, Any]]:
        try:
            tree = ast.parse(source)
        except (SyntaxError, ValueError):
            return []
        lines = source.split("\n")
        out: List[Dict[str, Any]] = []

        def cx(fn) -> int:
            c = 1
            for n in ast.walk(fn):
                if isinstance(n, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler, ast.IfExp,
                                  ast.comprehension)):
                    c += 1
                elif isinstance(n, ast.BoolOp):
                    c += len(n.values) - 1
                elif n.__class__.__name__ == "match_case":
                    c += 1
            return c

        def visit(body, classes):
            for n in body:
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    params = [a.arg for a in n.args.posonlyargs + n.args.args + n.args.kwonlyargs
                              if a.arg not in ("self", "cls")]
                    if n.args.vararg:
                        params.append("*" + n.args.vararg.arg)
                    if n.args.kwarg:
                        params.append("**" + n.args.kwarg.arg)
                    out.append({
                        "name": ".".join(list(classes) + [n.name]), "start_line": n.lineno,
                        "end_line": getattr(n, "end_lineno", n.lineno), "parameters": params[:12],
                        "cyclomatic_complexity": cx(n),
                        "signature": lines[n.lineno - 1].strip()[:140] if n.lineno - 1 < len(lines) else "",
                        "is_method": bool(classes),
                    })
                elif isinstance(n, ast.ClassDef):
                    visit(n.body, classes + (n.name,))
                elif isinstance(n, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                    for attr in ("body", "orelse", "finalbody"):
                        visit(getattr(n, attr, []) or [], classes)
                    for h in getattr(n, "handlers", []) or []:
                        visit(h.body, classes)

        visit(tree.body, ())
        return out


# ------------------------------------------------------------------- ownership
def attribute_from_blame(functions: List[Dict[str, Any]], ranges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Exact line ownership: overlap `git blame` ranges (at HEAD) with each function's line span."""
    ranges = sorted(ranges, key=lambda r: r["start"])
    out = []
    for fn in functions:
        s, e = fn["start_line"], fn["end_line"]
        total = max(1, e - s + 1)
        counts: Dict[Optional[str], int] = {}
        for r in ranges:
            if r["end"] < s:
                continue
            if r["start"] > e:
                break
            ov = min(e, r["end"]) - max(s, r["start"]) + 1
            if ov > 0:
                counts[r.get("author")] = counts.get(r.get("author"), 0) + ov
        linked = sorted(((k, v) for k, v in counts.items() if k), key=lambda kv: -kv[1])
        breakdown = [{"contributor": k, "lines": v, "pct": round(100.0 * v / total, 1)} for k, v in linked]
        top = breakdown[0] if breakdown else None
        out.append({**fn,
                    "primary_owner": top["contributor"] if top else None,
                    "primary_ownership_pct": top["pct"] if top else None,
                    "ownership_breakdown": breakdown[:4],
                    "ownership_basis": "blame" if top else "none"})
    return out


def attribute_from_file_history(functions: List[Dict[str, Any]], commits_by_author: Dict[str, int]) -> List[Dict[str, Any]]:
    """Fallback when blame is unavailable: functions inherit the file's commit-share distribution.
    Clearly labelled `file-commits` so the UI / XAI never present it as line-level truth."""
    total = sum(commits_by_author.values())
    ranked = sorted(commits_by_author.items(), key=lambda kv: -kv[1])
    breakdown = [{"contributor": k, "lines": None, "pct": round(100.0 * v / total, 1)} for k, v in ranked] if total else []
    top = breakdown[0] if breakdown else None
    return [{**fn,
             "primary_owner": top["contributor"] if top else None,
             "primary_ownership_pct": top["pct"] if top else None,
             "ownership_breakdown": breakdown[:4],
             "ownership_basis": "file-commits" if top else "none"} for fn in functions]
