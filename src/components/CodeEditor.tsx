// CodeMirror wrapper for the file explorer's editor. Lazy-imported by FilesView (and only
// there) so the editor bundle - CodeMirror core + the language registry - stays out of the
// main chunk; each language's parser is itself dynamic-imported by language-data on first
// use, so opening a .ts file costs the TypeScript grammar only.
import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

// Restyle oneDark's chrome to Claudex's tokens (its syntax colors are kept - they read
// well on our panels). The surface backgrounds are cleared in index.css instead of here:
// both themes target the same `&`, so which one wins depends on extension order, and app
// CSS beats them both. See the .cm-editor rules there.
const chrome = EditorView.theme({
  "&": { fontSize: "13px", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { fontFamily: "var(--font-mono)", paddingBottom: "40vh" },
  ".cm-gutters": { borderRight: "1px solid var(--color-border)", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-panel2) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-fg)" },
  "&.cm-focused": { outline: "none" },
});

export default function CodeEditor({ filename, value, readOnly, onChange }: {
  filename: string;
  value: string;
  readOnly?: boolean;
  onChange: (v: string) => void;
}) {
  const [lang, setLang] = useState<LanguageSupport | null>(null);

  useEffect(() => {
    let on = true;
    const d = LanguageDescription.matchFilename(languages, filename);
    if (!d) { setLang(null); return; }
    d.load().then((l) => { if (on) setLang(l); }, () => { if (on) setLang(null); });
    return () => { on = false; };
  }, [filename]);

  const extensions = useMemo(
    () => (lang ? [chrome, EditorView.lineWrapping, lang] : [chrome, EditorView.lineWrapping]),
    [lang],
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={oneDark}
      extensions={extensions}
      height="100%"
      style={{ height: "100%" }}
      basicSetup={{
        foldGutter: false,
        autocompletion: false,          // this is a quick-fix editor, not an IDE
        highlightActiveLine: true,
        highlightSelectionMatches: false,
      }}
    />
  );
}
