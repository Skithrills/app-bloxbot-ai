import { invoke } from "@tauri-apps/api/core";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { registerLuauLanguage, runLuauLinter } from "@/lib/monacoLuau";
import { useVerdeReadScript } from "@/hooks/useVerdeReadScript";
import { useVerdeWriteScript } from "@/hooks/useVerdeWriteScript";

interface ScriptEditorProps {
  path: string | null;
  onDirtyChange?: (path: string, isDirty: boolean) => void;
}

function ScriptEditor({ path, onDirtyChange }: ScriptEditorProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [theme, setTheme] = useState("vs-dark");
  const [editorError, setEditorError] = useState<string | null>(null);
  const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const lintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeScript = useVerdeWriteScript();

  // Update auto-generated context outline for a script
  const refreshAutoContext = useCallback((scriptPath: string, code: string) => {
    invoke("update_auto_context", { path: scriptPath, code }).catch(() => {
      // silently ignore — auto-context is optional
    });
  }, []);

  // Detect dark mode
  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => {
      setTheme(root.classList.contains("dark") ? "vs-dark" : "vs");
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Fetch active script
  const { data, isLoading, error } = useVerdeReadScript(path);

  // Reset content when path changes
  useEffect(() => {
    if (!data || !path) return;
    setContent(data.text);
    setOriginalContent(data.text);
    setIsDirty(false);
    refreshAutoContext(path, data.text);
    if (onDirtyChange) onDirtyChange(path, false);
  }, [data, path, refreshAutoContext, onDirtyChange]);

  const runLint = useCallback((editor: import("monaco-editor").editor.IStandaloneCodeEditor, monacoInstance: typeof import("monaco-editor")) => {
    const model = editor.getModel();
    if (!model) return;
    const code = model.getValue();
    try {
      const diagnostics = runLuauLinter(code);
      const markers = diagnostics.map((d) => ({
        severity:
          d.severity === "Error"
            ? monacoInstance.MarkerSeverity.Error
            : d.severity === "Warning"
              ? monacoInstance.MarkerSeverity.Warning
              : d.severity === "Information"
                ? monacoInstance.MarkerSeverity.Info
                : monacoInstance.MarkerSeverity.Hint,
        message: d.message,
        startLineNumber: d.startLineNumber,
        startColumn: d.startColumn,
        endLineNumber: d.endLineNumber,
        endColumn: d.endColumn,
      }));
      monacoInstance.editor.setModelMarkers(model, "luau-linter", markers);
    } catch (e) {
      console.error("Linting failed:", e);
    }
  }, []);

  const scheduleLint = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (lintTimeoutRef.current) clearTimeout(lintTimeoutRef.current);
    lintTimeoutRef.current = setTimeout(() => runLint(editor, monaco), 500);
  }, [runLint]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!path || value === undefined) return;
      const dirty = value !== originalContent;
      setContent(value);
      setIsDirty(dirty);
      if (onDirtyChange) onDirtyChange(path, dirty);
      scheduleLint();
    },
    [path, originalContent, onDirtyChange, scheduleLint]
  );

  const handleSave = useCallback(async () => {
    if (!path || !isDirty) return;
    try {
      await writeScript.mutateAsync({ path, code: content });
      setOriginalContent(content);
      setIsDirty(false);
      if (onDirtyChange) onDirtyChange(path, false);
      refreshAutoContext(path, content);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  }, [path, isDirty, content, writeScript, onDirtyChange, refreshAutoContext]);

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    try {
      registerLuauLanguage(monacoInstance);
    } catch (e) {
      console.error("Failed to register Luau language:", e);
      setEditorError("Failed to initialize Luau language support");
    }
  };

  const handleMount: OnMount = (editor, monacoInstance) => {
    try {
      editorRef.current = editor;
      monacoRef.current = monacoInstance;
      runLint(editor, monacoInstance);
      setEditorError(null);
    } catch (e) {
      console.error("Editor mount failed:", e);
      setEditorError("Failed to initialize editor");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-card px-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {path ?? "No script open"}
        </span>
        {isDirty && (
          <button
            className="ml-auto inline-flex h-5 items-center gap-1 rounded bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSave}
            disabled={writeScript.isPending}
          >
            {writeScript.isPending ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {isLoading && path && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading {path}...
          </div>
        )}

        {error && path && (
          <div className="flex h-full items-center justify-center text-sm text-red-500">
            Error: {typeof error === "string" ? error : error?.message || "Unknown error"}
          </div>
        )}

        {!path && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Click a script in the explorer to open it
          </div>
        )}

        {editorError && path && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-red-500">
            <span>Editor Error: {editorError}</span>
            <button
              className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              onClick={() => setEditorError(null)}
            >
              Retry
            </button>
          </div>
        )}

        {path && !editorError && (
          <Editor
            height="100%"
            language="luau"
            value={content}
            theme={theme}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
              tabSize: 2,
              insertSpaces: true,
            }}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={handleEditorChange}
            loading={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Initializing editor...
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

export default ScriptEditor;
