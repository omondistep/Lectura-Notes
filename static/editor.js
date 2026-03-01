import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { vim, Vim } from "@replit/codemirror-vim";
import { autocompletion, completionKeymap, acceptCompletion } from "@codemirror/autocomplete";
import { GraphCanvas } from "/static/graph-canvas.js";

// Debug: Check vim is loaded
if (typeof vim !== 'function') {
  console.error("VIM NOT LOADED! vim is:", vim);
} else {
  console.log("VIM loaded successfully, Vim object:", Vim);
}

// ── markdown-it ────────────────────────────────────────────────────────────────
const md = window.markdownit({ html: false, linkify: true, typographer: true, breaks: true });

// ==highlight== support: wrap in <mark>
md.core.ruler.push("highlight", state => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== "inline" || !blockToken.children) continue;
    const children = blockToken.children;
    const out = [];
    let i = 0;
    while (i < children.length) {
      const t = children[i];
      if (t.type === "text" && t.content.includes("==")) {
        let s = t.content;
        const parts = [];
        let idx;
        while ((idx = s.indexOf("==")) !== -1) {
          if (idx > 0) { const pre = Object.assign({}, t); pre.content = s.slice(0, idx); parts.push(pre); }
          const end = s.indexOf("==", idx + 2);
          if (end === -1) { const rest = Object.assign({}, t); rest.content = s.slice(idx); parts.push(rest); s = ""; break; }
          const open = new state.Token("html_inline", "", 0); open.content = "<mark>";
          const txt  = new state.Token("text", "", 0);  txt.content = s.slice(idx + 2, end);
          const close= new state.Token("html_inline", "", 0); close.content = "</mark>";
          parts.push(open, txt, close);
          s = s.slice(end + 2);
        }
        if (s) { const rest = Object.assign({}, t); rest.content = s; parts.push(rest); }
        out.push(...parts);
      } else {
        out.push(t);
      }
      i++;
    }
    blockToken.children = out;
  }
});

// :::qa flashcard block support
// Syntax:  :::qa\nQuestion\n:::\nAnswer\n:::
function renderFlashcards(previewEl) {
  // Process raw HTML for :::qa blocks (post markdown-it render)
  previewEl.querySelectorAll("p").forEach(p => {
    if (p.textContent.trim() === ":::") p.remove();
  });
}

// Pre-process :::qa blocks before markdown-it renders them
function preprocessFlashcards(content) {
  return content.replace(
    /:::qa\n([\s\S]*?)\n:::\n([\s\S]*?)\n:::/g,
    (_, question, answer) => {
      const q = question.trim().replace(/"/g, "&quot;");
      const a = answer.trim().replace(/"/g, "&quot;");
      return `<div class="flashcard" data-answer="${a}"><div class="flashcard-front">${q}</div><div class="flashcard-back">${a}</div><button class="flashcard-flip">Show answer</button></div>`;
    }
  );
}

// 31. Lazy Load Heavy Libraries - Mermaid initialized only when needed
let mermaidInitialized = false;
let mermaidLoading = false;
let mermaidIdCounter = 0;
async function initMermaid() {
  if (mermaidLoading) return;
  if (window.mermaid && !mermaidInitialized) {
    try {
      const theme = (typeof currentTheme !== 'undefined' && (currentTheme === 'dark' || currentTheme === 'cobalt' || currentTheme === 'phantom' || currentTheme === 'high-contrast')) ? 'dark' : 'default';
      mermaid.initialize({ 
        startOnLoad: false, 
        theme: theme,
        securityLevel: 'loose'
      });
    } catch(e) {
      console.warn("Mermaid init error (non-fatal):", e);
    }
    mermaidInitialized = true;
  } else if (!window.mermaid && !mermaidLoading) {
    // Lazy load mermaid only when first diagram is encountered
    mermaidLoading = true;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => {
      mermaidLoading = false;
      initMermaid();
    };
    document.head.appendChild(script);
  }
}
// Don't initialize mermaid on load - wait for first diagram

// Enable table syntax in CodeMirror markdown mode
const markdownLang = markdown();

// ── state ──────────────────────────────────────────────────────────────────────
let currentFile = "untitled.md";
let currentFolder = ""; // Current folder path (empty = root)
let isDirty = false;
let autoSaveTimer = null;
const AUTOSAVE_DELAY = 2000; // ms of idle before auto-save

// ── theme compartment (allows hot-swapping) ───────────────────────────────────
const themeCompartment = new Compartment();

// ── helpers ────────────────────────────────────────────────────────────────────
function getContent() { return view.state.doc.toString(); }

function setContent(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  isDirty = false;
  updateDirtyBadge();
}

function setStatus(msg, isError = false) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.style.color = isError ? "#e06c75" : "#98c379";
  setTimeout(() => { el.textContent = "Ready"; el.style.color = ""; }, 3000);
}

function updateWordCount() {
  const text = getContent().trim();
  const words = text ? text.split(/\s+/).length : 0;
  document.getElementById("word-count").textContent = `${words} word${words !== 1 ? "s" : ""}`;
}

function renderPreview() {
  const content = getContent();
  const processed = preprocessFlashcards(content);
  let html = md.render(processed);
  const previewEl = document.getElementById("preview");
  previewEl.innerHTML = html;
  // Wire flashcard flip buttons
  previewEl.querySelectorAll(".flashcard-flip").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".flashcard");
      card.classList.toggle("flipped");
      btn.textContent = card.classList.contains("flipped") ? "Hide answer" : "Show answer";
    });
  });
  
  // Render LaTeX math with KaTeX
  renderLatex(previewEl);
  
  // Render Mermaid diagrams
  renderMermaidDiagrams(previewEl);

  // Render economic graphs
  renderEconGraphs(previewEl);

  // Render graph canvas blocks (```graph ... ```)
  renderGraphBlocks(previewEl);

  updateWordCount();
  updateReadingTime();
  updateDocStatus();
}

// Render LaTeX math expressions
function renderLatex(container) {
  if (!window.katex) return;
  
  // Process display math first: $$...$$
  const displayMathRegex = /\$\$([\s\S]+?)\$\$/g;
  container.innerHTML = container.innerHTML.replace(displayMathRegex, (match, math) => {
    try {
      return `<div class="math-display">${katex.renderToString(math.trim(), { throwOnError: false, displayMode: true })}</div>`;
    } catch (e) {
      return match;
    }
  });
  
  // Process inline math: $...$
  const inlineMathRegex = /\$([^\$\n]+)\$/g;
  container.innerHTML = container.innerHTML.replace(inlineMathRegex, (match, math) => {
    try {
      return katex.renderToString(math, { throwOnError: false, displayMode: false });
    } catch (e) {
      return match;
    }
  });
}

// Render Mermaid diagrams
async function renderMermaidDiagrams(container) {
  if (!window.mermaid) return;
  
  // Ensure mermaid is initialized
  await initMermaid();
  
  const codeBlocks = container.querySelectorAll('pre code.language-mermaid');
  
  for (const codeBlock of codeBlocks) {
    const pre = codeBlock.parentElement;
    const code = codeBlock.textContent;
    try {
      const id = 'mermaid-' + (mermaidIdCounter++);
      const { svg } = await mermaid.render(id, code);
      const div = document.createElement('div');
      div.className = 'mermaid-diagram';
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (e) {
      console.error('Mermaid render error:', e);
    }
  }
}

// ── Economic graph renderer (:::econ blocks) ──────────────────────────────────
// DSL syntax inside ```econ ... ``` fenced blocks:
//
//   title: Supply and Demand
//   xlabel: Quantity
//   ylabel: Price
//   xmax: 10        (optional, default 10)
//   ymax: 10        (optional, default 10)
//   curve: label, [(x1,y1),(x2,y2),...], solid|dotted|dashed, color
//   point: label, (x,y)
//   vline: x, dotted|dashed, color      (vertical reference line)
//   hline: y, dotted|dashed, color      (horizontal reference line)
//   arrow: (x1,y1),(x2,y2), label
//
// Preset shortcuts (single keyword on a line):
//   supply-demand    — classic S/D cross with equilibrium
//   ppf              — concave production possibility frontier
//   cost             — ATC, AVC, MC cost curves

const ECON_PRESETS = {
  "supply-demand": `title: Supply and Demand
xlabel: Quantity
ylabel: Price
xmax: 10
ymax: 10
curve: Demand, [(0,9),(3,7),(5,5),(7,3),(10,1)], solid, #3b82f6
curve: Supply, [(0,1),(3,3),(5,5),(7,7),(10,9)], solid, #ef4444
point: Equilibrium, (5,5)
hline: 5, dotted, #6b7280
vline: 5, dotted, #6b7280`,

  "ppf": `title: Production Possibility Frontier
xlabel: Good X
ylabel: Good Y
xmax: 10
ymax: 10
curve: PPF, [(0,10),(2,9.8),(4,9.2),(6,8),(8,6),(9,3.5),(10,0)], solid, #10b981
curve: Unattainable, [(0,10),(2,10),(4,10),(6,10),(8,10),(10,10)], dotted, #ef4444
point: Efficient, (6,8)
point: Inefficient, (4,5)`,

  "cost": `title: Cost Curves
xlabel: Quantity
ylabel: Cost
xmax: 10
ymax: 14
curve: MC, [(1,10),(2,7),(3,5),(4,4),(5,4),(6,5),(7,7),(8,10),(9,13)], solid, #ef4444
curve: ATC, [(1,13),(2,10),(3,8),(4,6.5),(5,6),(6,6.2),(7,6.8),(8,7.8),(9,9)], solid, #3b82f6
curve: AVC, [(1,7),(2,5),(3,4),(4,3.5),(5,3.8),(6,4.5),(7,5.5),(8,7),(9,8.5)], solid, #10b981`,
};

const ECON_COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#06b6d4","#f97316"];

function parseEconDSL(src) {
  // Expand presets
  const trimmed = src.trim();
  if (ECON_PRESETS[trimmed]) src = ECON_PRESETS[trimmed];

  const lines = src.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const cfg = {
    title: "", xlabel: "X", ylabel: "Y", xmax: 10, ymax: 10,
    curves: [], points: [], vlines: [], hlines: [], arrows: [],
  };
  let colorIdx = 0;

  for (const line of lines) {
    const [key, ...rest] = line.split(":").map(s => s.trim());
    const val = rest.join(":").trim();

    if (key === "title")  { cfg.title  = val; continue; }
    if (key === "xlabel") { cfg.xlabel = val; continue; }
    if (key === "ylabel") { cfg.ylabel = val; continue; }
    if (key === "xmax")   { cfg.xmax   = parseFloat(val) || 10; continue; }
    if (key === "ymax")   { cfg.ymax   = parseFloat(val) || 10; continue; }

    if (key === "curve") {
      // curve: Label, [(x1,y1),...], solid|dotted|dashed, #color
      const parts = val.split(",").map(s => s.trim());
      const label = parts[0];
      const coordStr = val.slice(val.indexOf("["), val.indexOf("]") + 1);
      const style = val.includes("dotted") ? "dotted" : val.includes("dashed") ? "dashed" : "solid";
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      const color = colorMatch ? colorMatch[0] : ECON_COLORS[colorIdx++ % ECON_COLORS.length];
      const points = [...coordStr.matchAll(/\(([0-9.]+),([0-9.]+)\)/g)]
        .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
      if (points.length) cfg.curves.push({ label, points, style, color });
      continue;
    }

    if (key === "point") {
      const m = val.match(/^(.+),\s*\(([0-9.]+),([0-9.]+)\)/);
      if (m) cfg.points.push({ label: m[1].trim(), x: parseFloat(m[2]), y: parseFloat(m[3]) });
      continue;
    }

    if (key === "vline") {
      const parts = val.split(",").map(s => s.trim());
      const style = parts[1] || "dotted";
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      cfg.vlines.push({ x: parseFloat(parts[0]), style, color: colorMatch ? colorMatch[0] : "#6b7280" });
      continue;
    }

    if (key === "hline") {
      const parts = val.split(",").map(s => s.trim());
      const style = parts[1] || "dotted";
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      cfg.hlines.push({ y: parseFloat(parts[0]), style, color: colorMatch ? colorMatch[0] : "#6b7280" });
      continue;
    }
  }
  return cfg;
}

function buildEconDashPattern(style, ctx) {
  if (style === "dotted")  return [2, 4];
  if (style === "dashed")  return [8, 4];
  return [];
}

function renderEconGraphs(container) {
  if (!window.Chart) return;
  container.querySelectorAll("pre code.language-econ").forEach(codeEl => {
    const pre = codeEl.parentElement;
    const src = codeEl.textContent;
    const cfg = parseEconDSL(src);

    const wrapper = document.createElement("div");
    wrapper.className = "econ-chart-wrapper";
    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    pre.replaceWith(wrapper);

    // Build Chart.js datasets from curves
    const datasets = cfg.curves.map(curve => ({
      label: curve.label,
      data: curve.points,
      borderColor: curve.color,
      backgroundColor: "transparent",
      borderWidth: 2.5,
      borderDash: buildEconDashPattern(curve.style),
      pointRadius: 0,
      tension: 0.4,
      parsing: false,
    }));

    // Add reference vlines as vertical datasets
    cfg.vlines.forEach(vl => {
      datasets.push({
        label: `_vline_${vl.x}`,
        data: [{ x: vl.x, y: 0 }, { x: vl.x, y: cfg.ymax }],
        borderColor: vl.color,
        borderWidth: 1.5,
        borderDash: buildEconDashPattern(vl.style),
        pointRadius: 0,
        tension: 0,
        parsing: false,
      });
    });

    // Add reference hlines as horizontal datasets
    cfg.hlines.forEach(hl => {
      datasets.push({
        label: `_hline_${hl.y}`,
        data: [{ x: 0, y: hl.y }, { x: cfg.xmax, y: hl.y }],
        borderColor: hl.color,
        borderWidth: 1.5,
        borderDash: buildEconDashPattern(hl.style),
        pointRadius: 0,
        tension: 0,
        parsing: false,
      });
    });

    // Equilibrium / annotation points as a scatter dataset
    if (cfg.points.length) {
      datasets.push({
        label: cfg.points.map(p => p.label).join(", "),
        data: cfg.points.map(p => ({ x: p.x, y: p.y })),
        type: "scatter",
        borderColor: "#f59e0b",
        backgroundColor: "#f59e0b",
        pointRadius: 6,
        pointStyle: "circle",
        parsing: false,
      });
    }

    new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          title: {
            display: !!cfg.title,
            text: cfg.title,
            color: "#e6edf3",
            font: { size: 14, weight: "600" },
            padding: { bottom: 10 },
          },
          legend: {
            display: true,
            labels: {
              color: "#8b949e",
              filter: item => !item.text.startsWith("_"),
              boxWidth: 20,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label.startsWith("_")) return null;
                return `${ctx.dataset.label}: (${ctx.parsed.x}, ${ctx.parsed.y})`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: cfg.xmax,
            title: { display: true, text: cfg.xlabel, color: "#8b949e" },
            grid: { color: "#21262d" },
            ticks: { color: "#8b949e" },
          },
          y: {
            type: "linear",
            min: 0,
            max: cfg.ymax,
            title: { display: true, text: cfg.ylabel, color: "#8b949e" },
            grid: { color: "#21262d" },
            ticks: { color: "#8b949e" },
          },
        },
      },
    });
  });
}

// ── Render ```graph blocks as inline SVGs in preview ──────────────────────────
function renderGraphBlocks(container) {
  const codeEls = [...container.querySelectorAll("pre code.language-graph")];
  codeEls.forEach((codeEl, blockIndex) => {
    const pre = codeEl.parentElement;
    const src = codeEl.textContent.trim();
    let data;
    try { data = JSON.parse(src); } catch (_) { return; }

    const w = data.w || 600, h = data.h || 450;
    const wrapper = document.createElement("div");
    wrapper.className = "graph-block-wrapper";
    wrapper.title = "Double-click to edit";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", "100%");
    svg.style.maxWidth = w + "px";
    svg.style.background = "#1a1a2e";
    svg.style.borderRadius = "6px";
    svg.style.cursor = "pointer";

    // Use a temporary GraphCanvas to render into this SVG
    const gc = new GraphCanvas(svg, { width: w, height: h });
    gc.fromJSON(data);

    wrapper.appendChild(svg);
    pre.replaceWith(wrapper);

    // Double-click to edit: find the Nth ```graph block in source by index
    const myIndex = blockIndex;
    wrapper.addEventListener("dblclick", () => {
      const content = getContent();
      const re = /```graph\n([\s\S]*?)```/g;
      let match, idx = 0;
      while ((match = re.exec(content))) {
        if (idx === myIndex) {
          try {
            const blockData = JSON.parse(match[1].trim());
            openGraphCanvas(blockData, match.index, match[0].length);
          } catch (_) {
            openGraphCanvas(data);
          }
          return;
        }
        idx++;
      }
      // Fallback: open with data but no edit position (inserts new)
      openGraphCanvas(data);
    });
  });
}

// Calculate and update reading time
function updateReadingTime() {
  const text = getContent().trim();
  const words = text ? text.split(/\s+/).length : 0;
  const minutes = Math.ceil(words / 200); // Average reading speed: 200 words/min
  const readingTimeEl = document.getElementById("reading-time");
  if (readingTimeEl) {
    readingTimeEl.textContent = `~${minutes} min read`;
  }
}

// Document status tracking
let docStatus = 'draft'; // draft, saved, published, synced

function updateDocStatus() {
  const statusEl = document.getElementById("doc-status");
  if (!statusEl) return;
  
  if (isDirty) {
    statusEl.textContent = "● Draft";
    statusEl.className = "doc-status draft";
    statusEl.title = "Unsaved changes";
  } else if (currentFile === "untitled.md") {
    statusEl.textContent = "● New";
    statusEl.className = "doc-status new";
    statusEl.title = "New document";
  } else {
    statusEl.textContent = "● Saved";
    statusEl.className = "doc-status saved";
    statusEl.title = "Saved locally";
  }
}

function updateDirtyBadge() {
  const badge = document.getElementById("autosave-badge");
  badge.classList.toggle("hidden", !isDirty);
}

function markDirty() {
  isDirty = true;
  updateDirtyBadge();
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (isDirty && currentFile !== "untitled.md") {
      await saveFile(true);
    }
  }, AUTOSAVE_DELAY);
}

// ── editor insert helpers ──────────────────────────────────────────────────────
function wrapSelection(before, after = before) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${before}${selected}${after}` },
    selection: { anchor: from + before.length, head: from + before.length + selected.length }
  });
  view.focus();
}

function insertAtLineStart(prefix) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  // Collect changes for all lines in selection
  const changes = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = view.state.doc.line(ln);
    if (line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      // For numbered lists, increment the number per line
      let actualPrefix = prefix;
      if (prefix === "1. " && ln > startLine.number) {
        actualPrefix = `${ln - startLine.number + 1}. `;
      }
      changes.push({ from: line.from, insert: actualPrefix });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

function insertSnippet(text) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const insert = (line.text.trim() === "" ? "" : "\n") + text + "\n";
  view.dispatch({ changes: { from: line.to, insert } });
  view.focus();
}

function insertBlock(text) {
  const { from } = view.state.doc.lineAt(from);
  const line = view.state.doc.lineAt(from);
  const insert = line.text.trim() === "" ? text + "\n" : "\n" + text + "\n";
  view.dispatch({ changes: { from: line.to, insert } });
  view.focus();
}

function removeLineStart(pattern) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);

  const changes = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = view.state.doc.line(ln);
    const match = line.text.match(pattern);
    if (match) {
      changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

const ACTIONS = {
  bold:       () => wrapSelection("**"),
  italic:     () => wrapSelection("*"),
  code:       () => wrapSelection("`"),
  link:       () => wrapSelection("[", "](url)"),
  image:      () => { document.getElementById("image-input").click(); },
  h1:         () => insertAtLineStart("# "),
  h2:         () => insertAtLineStart("## "),
  h3:         () => insertAtLineStart("### "),
  h4:         () => insertAtLineStart("#### "),
  h5:         () => insertAtLineStart("##### "),
  h6:         () => insertAtLineStart("###### "),
  paragraph:  () => removeLineStart(/^#{1,6}\s+/),
  ul:         () => insertAtLineStart("- "),
  ol:         () => insertAtLineStart("1. "),
  task:       () => insertAtLineStart("- [ ] "),
  blockquote: () => insertAtLineStart("> "),
  codeblock:  () => insertSnippet("```\n\n```"),
  mathblock:  () => insertSnippet("$$\n\n$$"),
  highlight:  () => wrapSelection("=="),
  strikethrough: () => wrapSelection("~~"),
  underline:  () => wrapSelection("<u>", "</u>"),
  table:      () => openTableModal(),
  diagram:    () => openDiagramModal(),
  flashcard:  () => insertSnippet(":::qa\nQuestion goes here\n:::\nAnswer goes here\n:::"),
  graph:      () => openGraphCanvas(),
};

// ── Vim mode ────────────────────────────────────────────────────────────────────
const vimCompartment = new Compartment();
// Force vim to be enabled by default (ignore localStorage for now to debug)
let vimEnabled = localStorage.getItem("sc-vim") === "true"; // Off by default for now
console.log("Vim enabled:", vimEnabled, "vim():", vim());

// Mode indicator in status bar
const vimIndicator = document.getElementById("vim-mode-indicator");
function updateVimIndicator(modeName) {
  if (!vimEnabled || !modeName) { vimIndicator.classList.add("hidden"); return; }
  vimIndicator.classList.remove("hidden");
  vimIndicator.className = "vim-mode vim-" + modeName.toLowerCase().replace(/[^a-z]/g, "");
  vimIndicator.textContent = modeName.toUpperCase();
}
updateVimIndicator(vimEnabled ? "normal" : "");

// Register custom ex commands after view is created (called once)
function registerVimCommands() {
  // :w  — save
  Vim.defineEx("write", "w", () => { saveFile(); });
  // :wq / :x — save (can't close a browser tab)
  Vim.defineEx("wq", "", () => { saveFile(); });
  Vim.defineEx("xit", "x", () => { saveFile(); });
  // :q — warn if dirty
  Vim.defineEx("quit", "q", () => {
    if (isDirty) setStatus("Unsaved changes — use :w first", true);
    else setStatus("Nothing to close (browser tab)");
  });
  // :help — open help panel
  Vim.defineEx("help", "", () => {
    document.getElementById("help-panel").classList.add("open");
    document.getElementById("btn-help").classList.add("active");
  });
  // :set vim / :set novim — toggle vim mode
  Vim.defineEx("set", "", (cm, params) => {
    const arg = (params.args || []).join(" ");
    if (arg === "vim")    { enableVim();  return; }
    if (arg === "novim")  { disableVim(); return; }
    // pass other :set args to built-in handler
    Vim.handleEx(cm, `set ${arg}`);
  });
}

function enableVim() {
  vimEnabled = true;
  localStorage.setItem("sc-vim", "true");
  view.dispatch({ effects: vimCompartment.reconfigure(vim()) });
  updateVimIndicator("normal");
  setStatus("Vim mode enabled");
}

function disableVim() {
  vimEnabled = false;
  localStorage.setItem("sc-vim", "false");
  view.dispatch({ effects: vimCompartment.reconfigure([]) });
  updateVimIndicator("");
  setStatus("Vim mode disabled");
}

function toggleVim() {
  if (vimEnabled) disableVim(); else enableVim();
}

// ── Autocorrect ────────────────────────────────────────────────────────────────
const AUTOCORRECT_MAP = {
  // Common typos
  "teh":"the","hte":"the","adn":"and","nad":"and","anf":"and","dna":"and",
  "recieve":"receive","beleive":"believe","freind":"friend","wierd":"weird",
  "occured":"occurred","occurance":"occurrence","seperate":"separate",
  "definately":"definitely","goverment":"government","adress":"address",
  "accomodate":"accommodate","untill":"until","wont":"won't","dont":"don't",
  "cant":"can't","isnt":"isn't","arent":"aren't","wasnt":"wasn't",
  "hasnt":"hasn't","havent":"haven't","wouldnt":"wouldn't","couldnt":"couldn't",
  "shouldnt":"shouldn't","doesnt":"doesn't","didnt":"didn't","youre":"you're",
  "theyre":"they're","were":"we're","ive":"I've","im":"I'm","id":"I'd",
  "ill":"I'll","its":"it's","thats":"that's","whats":"what's","whos":"who's",
  "hows":"how's","wheres":"where's","theres":"there's","heres":"here's",
  "lets":"let's","youd":"you'd","hed":"he'd","shed":"she'd","wed":"we'd",
  "youll":"you'll","hell":"he'll","shell":"she'll","well":"we'll","theyll":"they'll",
  "acually":"actually","basicly":"basically","buisness":"business",
  "calender":"calendar","committment":"commitment","concious":"conscious",
  "enviroment":"environment","existance":"existence","grammer":"grammar",
  "independance":"independence","knowlege":"knowledge","maintainance":"maintenance",
  "millenium":"millennium","neccessary":"necessary","noticable":"noticeable",
  "occassion":"occasion","paralell":"parallel","persistance":"persistence",
  "priveledge":"privilege","publically":"publicly","reccomend":"recommend",
  "relevent":"relevant","restarant":"restaurant","rythm":"rhythm",
  "sieze":"seize","succesful":"successful","tommorow":"tomorrow",
  "tounge":"tongue","truely":"truly","unforseen":"unforeseen",
  "vaccum":"vacuum","visable":"visible","wether":"whether","wilfull":"willful",
};

const autocorrectPlugin = EditorView.inputHandler.of((view, from, to, text) => {
  // Only trigger on word-ending characters
  if (!/^[\s.,!?;:]$/.test(text)) return false;
  // Don't autocorrect inside code blocks or when vim is in normal mode
  if (vimEnabled) {
    const cmVim = view.cm;
    if (cmVim && cmVim.state && cmVim.state.vim && !cmVim.state.vim.insertMode) return false;
  }

  const doc = view.state.doc;
  const pos = from;
  const lineStart = doc.lineAt(pos).from;
  const textBefore = doc.sliceString(lineStart, pos);

  // Find the word just before cursor
  const wordMatch = textBefore.match(/([a-zA-Z']+)$/);
  if (!wordMatch) return false;

  const word = wordMatch[1];
  const correction = AUTOCORRECT_MAP[word.toLowerCase()];
  if (!correction) return false;

  // Preserve capitalisation if the original started with uppercase
  const corrected = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()
    ? correction[0].toUpperCase() + correction.slice(1)
    : correction;

  if (corrected === word) return false;

  const wordStart = pos - word.length;
  view.dispatch({
    changes: { from: wordStart, to: pos, insert: corrected },
    // Insert the triggering character too
    userEvent: "autocorrect",
  });
  // Now insert the space/punctuation that triggered this
  view.dispatch({
    changes: { from: wordStart + corrected.length, to: wordStart + corrected.length, insert: text },
    userEvent: "input",
  });
  return true;
});

// ── Word prediction (autocomplete) ─────────────────────────────────────────────
// Common English words for prediction
const COMMON_WORDS = [
  "about","above","after","again","against","all","also","although","always","among",
  "another","any","area","around","because","been","before","being","below","between",
  "both","business","called","came","can","case","come","could","days","did","different",
  "does","doing","done","during","each","early","either","else","even","every","example",
  "face","fact","few","find","first","following","found","from","gave","general","get",
  "give","given","goes","good","government","great","group","had","hand","have","having",
  "here","high","him","his","home","however","human","important","including","information",
  "interest","into","its","just","keep","know","large","last","later","leave","left","less",
  "life","light","like","likely","line","little","local","long","look","made","make","many",
  "may","means","might","more","most","move","much","must","national","need","never","next",
  "night","nothing","now","number","often","once","only","open","order","other","our",
  "over","own","part","people","place","point","political","possible","power","present",
  "problem","process","provide","public","real","really","right","same","school","second",
  "seem","set","several","should","show","side","since","small","social","some","something",
  "sometimes","state","still","such","system","take","than","that","their","them","then",
  "there","therefore","these","they","thing","think","this","those","though","through",
  "time","today","together","told","took","toward","turn","under","until","upon","used",
  "using","various","very","want","water","ways","well","went","were","what","when",
  "where","whether","which","while","who","will","within","without","work","world",
  "would","write","year","years","your",
].map(w => ({ label: w, type: "text" }));

function wordCompletionSource(context) {
  // Match a word of at least 2 characters
  const word = context.matchBefore(/[a-zA-Z]{2,}/);
  if (!word) return null;
  if (!context.explicit && word.text.length < 2) return null;

  const prefix = word.text.toLowerCase();

  // Build candidate list: common words + words already in the document
  const docText = context.state.doc.toString();
  const docWords = [...new Set(docText.match(/[a-zA-Z]{3,}/g) || [])]
    .filter(w => w.toLowerCase() !== prefix)
    .map(w => ({ label: w, type: "text" }));

  const allWords = [...COMMON_WORDS, ...docWords];
  const seen = new Set();
  const options = allWords.filter(({ label }) => {
    const l = label.toLowerCase();
    if (l === prefix || !l.startsWith(prefix)) return false;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  }).slice(0, 8); // max 8 suggestions

  if (!options.length) return null;
  return { from: word.from, options, validFor: /^[a-zA-Z]*$/ };
}

const wordPrediction = autocompletion({
  override: [wordCompletionSource],
  activateOnTyping: true,
  maxRenderedOptions: 8,
  defaultKeymap: true,
});

// ── CodeMirror setup ───────────────────────────────────────────────────────────
const updateListener = EditorView.updateListener.of(update => {
  if (update.docChanged) {
    renderPreview();
    markDirty();

    // Detect /graph slash command
    const pos = update.state.selection.main.head;
    const line = update.state.doc.lineAt(pos);
    if (line.text.trim() === "/graph") {
      // Remove the /graph text and open canvas
      update.view.dispatch({ changes: { from: line.from, to: line.to, insert: "" } });
      setTimeout(() => openGraphCanvas(), 50);
    }
  }
});

const customKeymap = keymap.of([
  // Typora-style shortcuts
  { key: "Ctrl-0",       run: () => { ACTIONS.paragraph();  return true; } },
  { key: "Ctrl-1",       run: () => { ACTIONS.h1();         return true; } },
  { key: "Ctrl-2",       run: () => { ACTIONS.h2();         return true; } },
  { key: "Ctrl-3",       run: () => { ACTIONS.h3();         return true; } },
  { key: "Ctrl-4",       run: () => { ACTIONS.h4();         return true; } },
  { key: "Ctrl-5",       run: () => { ACTIONS.h5();         return true; } },
  { key: "Ctrl-6",       run: () => { ACTIONS.h6();         return true; } },
  { key: "Ctrl-Shift-q", run: () => { ACTIONS.blockquote(); return true; } },
  { key: "Ctrl-Shift-c", run: () => { ACTIONS.codeblock();  return true; } },
  { key: "Ctrl-Shift-m", run: () => { ACTIONS.mathblock();  return true; } },
  { key: "Ctrl-Shift-k", run: () => { ACTIONS.codeblock();  return true; } },
  
  // Text formatting
  { key: "Ctrl-b",       run: () => { ACTIONS.bold();       return true; } },
  { key: "Ctrl-i",       run: () => { ACTIONS.italic();     return true; } },
  { key: "Ctrl-u",       run: () => { ACTIONS.underline();  return true; } },
  { key: "Ctrl-Shift-s", run: () => { ACTIONS.strikethrough(); return true; } },
  { key: "Ctrl-e",       run: () => { ACTIONS.code();       return true; } },
  { key: "Ctrl-Shift-h", run: () => { ACTIONS.highlight();  return true; } },
  
  // Links and images
  { key: "Ctrl-k",       run: () => { ACTIONS.link();       return true; } },
  { key: "Ctrl-Shift-i", run: () => { ACTIONS.image();      return true; } },
  
  // Lists
  { key: "Ctrl-Shift-8", run: () => { ACTIONS.ul();         return true; } },
  { key: "Ctrl-Shift-7", run: () => { ACTIONS.ol();         return true; } },
  { key: "Ctrl-Shift-x", run: () => { ACTIONS.task();       return true; } },
  
  // Table
  { key: "Ctrl-t",       run: () => { ACTIONS.table();      return true; } },
  
  // File operations
  { key: "Ctrl-s",       run: () => { saveFile();           return true; } },
  { key: "Ctrl-o",       run: () => { document.getElementById("file-input").click(); return true; } },
  
  // Other
  { key: "Ctrl-Alt-v",   run: () => { toggleVim();          return true; } },
]);

const view = new EditorView({
  state: EditorState.create({
    doc: "# Welcome to Lectura\n\nStart typing your notes here...\n",
    extensions: [
      // vim MUST be first so it intercepts all keystrokes before other keymaps
      vimCompartment.of(vimEnabled ? vim() : []),
      history(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      markdown(),
      themeCompartment.of(oneDark),
      wordPrediction,
      autocorrectPlugin,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab, ...completionKeymap]),
      customKeymap,
      updateListener,
      EditorView.lineWrapping,
    ],
  }),
  parent: document.getElementById("cm-editor"),
});

// Register custom ex commands and set up mode indicator listener
registerVimCommands();

// Poll vim mode via rAF by reading the vim state field directly from the CM6 view.
// This is reliable regardless of DOM panel rendering or event bubbling issues.
let lastVimMode = "normal";
function pollVimMode() {
  if (vimEnabled) {
    let mode = "normal";
    try {
      // @replit/codemirror-vim stores a vimState on the CM5-compat wrapper.
      // In CM6, the easiest read is the cm-vim-panel text OR the vim CSS class on view.dom.
      const panel = view.dom.querySelector(".cm-vim-panel");
      if (panel) {
        const txt = panel.textContent.trim();
        if (txt.includes("INSERT"))       mode = "insert";
        else if (txt.includes("VISUAL"))  mode = "visual";
        else if (txt.includes("REPLACE")) mode = "replace";
      } else {
        // No panel yet — try reading vim state via the internal getCM helper
        const cmVim = view.cm; // exposed by @replit/codemirror-vim on the EditorView
        if (cmVim && cmVim.state && cmVim.state.vim) {
          const vs = cmVim.state.vim;
          if (vs.insertMode)       mode = "insert";
          else if (vs.visualMode)  mode = "visual";
          else if (vs.replaceMode) mode = "replace";
        }
      }
    } catch (_) {}

    if (mode !== lastVimMode) {
      lastVimMode = mode;
      updateVimIndicator(mode);
    }
  }
  requestAnimationFrame(pollVimMode);
}
requestAnimationFrame(pollVimMode);

renderPreview();

// ── theme toggle ───────────────────────────────────────────────────────────────
// Empty theme that clears the default oneDark theme - relies on CSS for styling
const lightCmTheme = EditorView.theme({}, { dark: false });

// Theme definitions - which CodeMirror theme to use for each app theme
const themeConfig = {
  dark:    { cmTheme: oneDark,    label: "◗ Dark" },
  light:   { cmTheme: lightCmTheme, label: "◖ Light" },
  cobalt:  { cmTheme: oneDark,    label: "💎 Cobalt" },
  seniva:  { cmTheme: lightCmTheme, label: "🌿 Seniva" },
  newsprint: { cmTheme: lightCmTheme, label: "📰 Newsprint" },
  phantom: { cmTheme: oneDark,    label: "👻 Phantom" },
  seraph:  { cmTheme: lightCmTheme, label: "✨ Seraph" },
  forest:  { cmTheme: oneDark,    label: "🌲 Forest" },
  catppuccin: { cmTheme: oneDark, label: "🧋 Catppuccin" },
  garden:  { cmTheme: lightCmTheme, label: "🌱 Garden" },
  jade:    { cmTheme: oneDark,    label: "💚 Jade" }
};

let currentTheme = "dark";

function applyTheme(themeName) {
  const config = themeConfig[themeName];
  if (!config) return;
  
  currentTheme = themeName;
  document.documentElement.setAttribute("data-theme", themeName);
  view.dispatch({ effects: themeCompartment.reconfigure(config.cmTheme) });
  localStorage.setItem("sc-theme", themeName);
}

// Theme dropdown toggle
document.getElementById("btn-theme").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("theme-menu").classList.toggle("open");
  document.getElementById("export-menu").classList.remove("open"); // close other dropdowns
});

// Theme selection
document.querySelectorAll(".theme-option").forEach(btn => {
  btn.addEventListener("click", (e) => {
    const theme = e.target.dataset.theme;
    applyTheme(theme);
    document.getElementById("theme-menu").classList.remove("open");
  });
});

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest("#btn-theme") && !e.target.closest("#theme-menu")) {
    document.getElementById("theme-menu").classList.remove("open");
  }
  if (!e.target.closest("#btn-export-menu") && !e.target.closest("#export-menu")) {
    document.getElementById("export-menu").classList.remove("open");
  }
});

// restore saved theme
const savedTheme = localStorage.getItem("sc-theme") || "dark";
applyTheme(savedTheme);

// ── sidebar (Tree View) ─────────────────────────────────────────────────────────
let expandedFolders = new Set(); // Track which folders are expanded

// Load persisted expansion state from localStorage
function loadExpandedFolders() {
  try {
    const saved = localStorage.getItem("sc-expanded-folders");
    if (saved) {
      expandedFolders = new Set(JSON.parse(saved));
    }
  } catch (e) {
    console.error("Failed to load expanded folders:", e);
  }
}

// Save expansion state to localStorage
function saveExpandedFolders() {
  try {
    localStorage.setItem("sc-expanded-folders", JSON.stringify([...expandedFolders]));
  } catch (e) {
    console.error("Failed to save expanded folders:", e);
  }
}

// Initialize expansion state
loadExpandedFolders();

async function loadFileList() {
  // Fetch all files and folders recursively
  const res = await fetch("/files");
  const { files, folders } = await res.json();
  
  const ul = document.getElementById("file-list");
  ul.innerHTML = "";
  
  // Update breadcrumb
  updateBreadcrumb();
  
  // Build tree structure
  const tree = buildTree(folders, files);
  
  // Render tree
  renderTree(tree, ul);
}

// Build a tree structure from flat lists
function buildTree(folders, files) {
  const tree = { children: {}, files: [] };
  
  // Add folders to tree
  folders.forEach(folderPath => {
    const parts = folderPath.replace(/\/$/, '').split('/');
    let current = tree;
    parts.forEach((part, index) => {
      if (!current.children[part]) {
        current.children[part] = { children: {}, files: [], path: parts.slice(0, index + 1).join('/') };
      }
      current = current.children[part];
    });
  });
  
  // Add files to tree
  files.forEach(filePath => {
    const parts = filePath.split('/');
    const fileName = parts.pop();
    let current = tree;
    parts.forEach(part => {
      if (!current.children[part]) {
        current.children[part] = { children: {}, files: [], path: part };
      }
      current = current.children[part];
    });
    current.files.push({ name: fileName, path: filePath });
  });
  
  return tree;
}

// Render tree recursively — no inline styles, all layout via CSS
function renderTree(node, container) {
  // folders first, alphabetically
  Object.keys(node.children).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach(folderName => {
    const folderNode = node.children[folderName];
    const folderPath = folderNode.path || folderName;
    const isExpanded = expandedFolders.has(folderPath);

    // <li class="tree-folder">
    const li = document.createElement("li");
    li.className = "tree-folder";
    li.dataset.folderPath = folderPath;

    // <div class="folder-header">  ▶  📁 name  </div>
    const header = document.createElement("div");
    header.className = "folder-header";

    const arrow = document.createElement("span");
    arrow.className = "folder-arrow" + (isExpanded ? " expanded" : "");
    arrow.textContent = "▶";

    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.textContent = isExpanded ? "📂 " : "📁 ";

    const nameSpan = document.createElement("span");
    nameSpan.className = "folder-name";
    nameSpan.textContent = folderName;

    header.appendChild(arrow);
    header.appendChild(icon);
    header.appendChild(nameSpan);
    header.addEventListener("click", () => toggleFolderExpand(folderPath));
    li.appendChild(header);

    // context menu
    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      contextMenuTarget = folderPath;
      contextMenuIsFolder = true;
      showContextMenu(e.clientX, e.clientY, 'folder');
    });

    // drag-drop target on folder header
    header.addEventListener("dragover", (e) => { 
      e.preventDefault(); 
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move"; 
      header.classList.add("drag-over"); 
    });
    
    header.addEventListener("dragleave", (e) => {
      if (!header.contains(e.relatedTarget)) {
        header.classList.remove("drag-over");
      }
    });
    
    header.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      header.classList.remove("drag-over");
      const src = e.dataTransfer.getData("text/plain");
      if (src) {
        const fileName = src.split('/').pop();
        const dst = `${folderPath}/${fileName}`;
        if (src !== dst) {
          await moveFile(src, dst);
        }
      }
    });

    container.appendChild(li);

    // children — appended to the li, indented by .tree-children padding-left in CSS
    if (isExpanded) {
      const childUl = document.createElement("ul");
      childUl.className = "tree-children";
      li.appendChild(childUl);
      renderTree(folderNode, childUl);
    }
  });

  // files, alphabetically
  node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
    const li = document.createElement("li");
    li.className = "tree-file";
    li.dataset.filePath = file.path;
    li.draggable = true;

    const span = document.createElement("span");
    span.textContent = file.name;
    li.appendChild(span);

    li.addEventListener("click", () => openFile(file.path));
    li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", file.path); e.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      contextMenuTarget = file.path;
      contextMenuIsFolder = false;
      showContextMenu(e.clientX, e.clientY, 'file');
    });

    container.appendChild(li);
  });
}

// Toggle folder expand/collapse
function toggleFolderExpand(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath);
  } else {
    expandedFolders.add(folderPath);
  }
  saveExpandedFolders();
  loadFileList();
}

// Reveal a file in the sidebar by expanding all parent folders
function revealInSidebar(filePath) {
  const parts = filePath.split('/');
  parts.pop(); // Remove the filename
  
  if (parts.length === 0) return; // File is in root
  
  // Build up parent folder paths and expand them
  let accumulated = "";
  let needsRefresh = false;
  parts.forEach(part => {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    if (!expandedFolders.has(accumulated)) {
      expandedFolders.add(accumulated);
      needsRefresh = true;
    }
  });
  
  if (needsRefresh) {
    saveExpandedFolders();
    loadFileList();
  }
  
  // Highlight the file in the sidebar
  setTimeout(() => {
    const fileEl = document.querySelector(`[data-file-path="${filePath}"]`);
    if (fileEl) {
      fileEl.classList.add("highlighted");
      fileEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => fileEl.classList.remove("highlighted"), 2000);
    }
  }, 100);
}

function makeFileItem(path, displayName, onOpen, onDelete, isFolder = false) {
  const li = document.createElement("li");
  if (isFolder) {
    li.classList.add("folder-item");
    li.dataset.folderPath = path;
    li.draggable = false; // Folders are drop targets, not draggable
  } else {
    li.dataset.filePath = path;
    li.draggable = true; // Files are draggable
  }
  
  const span = document.createElement("span");
  span.textContent = isFolder ? `📁 ${displayName}` : displayName;
  // Show full path as tooltip (including folder path for files)
  span.title = `Path: ${path}`;
  li.appendChild(span);
  
  li.addEventListener("click", onOpen);
  
  // Drag and drop for files
  if (!isFolder) {
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", path);
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
    });
  }
  
  // Drop target for folders
  if (isFolder) {
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });
    
    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });
    
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove("drag-over");
      
      const sourcePath = e.dataTransfer.getData("text/plain");
      if (!sourcePath) return;
      
      // Get target folder path (remove trailing slash if present)
      let targetFolder = path.replace(/\/$/, '');
      
      // Get just the filename from source
      const fileName = sourcePath.split('/').pop();
      
      // Build new path
      const newPath = targetFolder ? `${targetFolder}/${fileName}` : fileName;
      
      // Don't move to same location
      if (sourcePath === newPath) return;
      
      // Check if file already exists in target
      const sourceFolder = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
      if (sourceFolder === targetFolder) {
        setStatus("File is already in this folder", true);
        return;
      }
      
      // Move the file
      await moveFile(sourcePath, newPath);
    });
  }
  
  if (onDelete) {
    const del = document.createElement("button");
    del.textContent = "✕";
    del.className = "del-btn";
    del.title = "Delete";
    del.addEventListener("click", e => { e.stopPropagation(); onDelete(); });
    li.appendChild(del);
  }
  
  return li;
}

// Move file to a new folder
async function moveFile(sourcePath, newPath) {
  try {
    // Get file content
    const res = await fetch(`/files/${encodeURIComponent(sourcePath)}`);
    if (!res.ok) {
      setStatus("Failed to move file", true);
      return;
    }
    const { content } = await res.json();
    
    // Save to new location
    const saveRes = await fetch(`/files/${encodeURIComponent(newPath)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    
    if (!saveRes.ok) {
      setStatus("Failed to move file", true);
      return;
    }
    
    // Delete from old location
    await fetch(`/files/${encodeURIComponent(sourcePath)}`, { method: "DELETE" });
    
    // Update current file if it was the moved file
    if (currentFile === sourcePath) {
      currentFile = newPath;
      document.getElementById("filename-input").value = newPath.split('/').pop();
    }
    
    loadFileList();
    setStatus(`Moved to ${newPath}`);
  } catch (e) {
    setStatus("Failed to move file", true);
    console.error("Move error:", e);
  }
}

function openFolder(folderPath) {
  // Navigate into folder
  currentFolder = folderPath.replace(/\/$/, '');
  loadFileList();
  setStatus(`Opened folder: ${currentFolder}`);
}

function navigateUp() {
  // Go up one level
  const parts = currentFolder.split('/');
  parts.pop();
  currentFolder = parts.join('/');
  loadFileList();
}

function navigateToFolder(folderPath) {
  currentFolder = folderPath;
  loadFileList();
}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");
  breadcrumb.innerHTML = "";
  
  // Root element
  const rootEl = document.createElement("span");
  rootEl.className = "breadcrumb-item" + (currentFolder ? "" : " active");
  rootEl.textContent = "🏠";
  rootEl.title = "Root folder";
  rootEl.addEventListener("click", () => {
    currentFolder = "";
    loadFileList();
  });
  breadcrumb.appendChild(rootEl);
  
  // Folder path elements
  if (currentFolder) {
    const parts = currentFolder.split('/');
    let accumulated = "";
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      breadcrumb.appendChild(sep);
      
      const el = document.createElement("span");
      el.className = "breadcrumb-item" + (index === parts.length - 1 ? " active" : "");
      el.textContent = part;
      el.title = accumulated;
      const folderPath = accumulated;
      el.addEventListener("click", () => navigateToFolder(folderPath));
      breadcrumb.appendChild(el);
    });
  }
}

async function deleteFolder(folderPath) {
  const folderName = folderPath.replace(/\/$/, '').split('/').pop();
  if (!confirm(`Delete folder "${folderName}" and all its contents?`)) return;
  
  const res = await fetch(`/files/${encodeURIComponent(folderPath)}`, { method: "DELETE" });
  if (res.ok) {
    loadFileList();
    setStatus(`Deleted folder ${folderName}`);
  } else {
    setStatus("Failed to delete folder", true);
  }
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

document.getElementById("btn-sidebar").addEventListener("click", toggleSidebar);
document.getElementById("btn-refresh-files").addEventListener("click", loadFileList);

// ── context menu ───────────────────────────────────────────────────────────────
const contextMenu = document.getElementById("context-menu");
let contextMenuTarget = null;  // Full path of the right-clicked item
let contextMenuIsFolder = false;  // Whether the target is a folder

// Show context menu on right-click (file or empty space)
document.getElementById("file-list").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  
  const li = e.target.closest("li");
  if (li) {
    // Right-clicked on a file/folder - check for tree-folder or tree-file class
    contextMenuIsFolder = li.classList.contains('tree-folder');
    
    if (contextMenuIsFolder) {
      contextMenuTarget = li.dataset.folderPath;
    } else {
      contextMenuTarget = li.dataset.filePath;
    }
    
    showContextMenu(e.clientX, e.clientY, contextMenuIsFolder ? 'folder' : 'file');
  } else {
    // Right-clicked on empty space
    contextMenuTarget = null;
    contextMenuIsFolder = false;
    showContextMenu(e.clientX, e.clientY, 'empty');
  }
});

function showContextMenu(x, y, context) {
  const menuEmpty = document.getElementById('menu-empty');
  const menuFile = document.getElementById('menu-file');
  const menuFolder = document.getElementById('menu-folder');
  
  // Hide all menus first
  menuEmpty.style.display = 'none';
  menuFile.style.display = 'none';
  if (menuFolder) menuFolder.style.display = 'none';
  
  if (context === 'empty') {
    menuEmpty.style.display = 'block';
  } else if (context === 'folder') {
    if (menuFolder) {
      menuFolder.style.display = 'block';
    } else {
      // Fallback to file menu if folder menu doesn't exist
      menuFile.style.display = 'block';
    }
  } else {
    menuFile.style.display = 'block';
  }
  
  contextMenu.classList.remove('hidden');
  
  // Position menu, ensuring it stays within viewport
  const rect = contextMenu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let posX = x;
  let posY = y;
  
  if (x + rect.width > viewportWidth) {
    posX = viewportWidth - rect.width - 10;
  }
  if (y + rect.height > viewportHeight) {
    posY = viewportHeight - rect.height - 10;
  }
  
  contextMenu.style.left = `${posX}px`;
  contextMenu.style.top = `${posY}px`;
}

// Hide context menu on click elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest("#context-menu")) {
    contextMenu.classList.add("hidden");
  }
});

// Handle context menu actions
contextMenu.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  contextMenu.classList.add("hidden");

  // helpers
  const target = contextMenuTarget;
  const isFolder = contextMenuIsFolder;

  async function createFolder(parentPath, suggestedName = "New Folder") {
    const name = prompt("Folder name:", suggestedName);
    if (!name) return;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const r = await fetch(`/folders/${encodeURIComponent(fullPath)}`, { method: "POST" });
    if (r.ok) { loadFileList(); setStatus(`Created folder "${name}"`); }
    else setStatus("Failed to create folder", true);
  }

  switch (action) {

    // ── new note (context: empty space or file → same folder) ─────────────
    case "new-file":
    case "new-folder-from-file": {
      if (action === "new-folder-from-file") {
        // "New Folder" when right-clicking a file → create in file's parent
        const parent = target ? target.substring(0, target.lastIndexOf('/')) : "";
        await createFolder(parent);
        break;
      }
      // new note in current folder (root or wherever we are)
      const folder = target && isFolder
        ? target
        : (target ? target.substring(0, target.lastIndexOf('/')) : "");
      const path = folder ? `${folder}/untitled.md` : "untitled.md";
      currentFile = path;
      document.getElementById("filename-input").value = "untitled.md";
      setContent("");
      setStatus("New note");
      break;
    }

    // ── new note inside a folder ──────────────────────────────────────────
    case "new-file-in-folder": {
      if (!target) break;
      const folder = target.replace(/\/$/, '');
      currentFile = `${folder}/untitled.md`;
      document.getElementById("filename-input").value = "untitled.md";
      setContent("");
      expandedFolders.add(folder);
      saveExpandedFolders();
      loadFileList();
      setStatus(`New note in "${folder.split('/').pop()}"`);
      break;
    }

    // ── new subfolder ─────────────────────────────────────────────────────
    case "new-folder":
    case "new-subfolder": {
      const parent = isFolder && target ? target.replace(/\/$/, '') : "";
      await createFolder(parent);
      break;
    }

    // ── open ──────────────────────────────────────────────────────────────
    case "open": {
      if (isFolder) openFolder(target);
      else openFile(target);
      break;
    }

    // ── rename ────────────────────────────────────────────────────────────
    case "rename": {
      if (isFolder) {
        const old = target.replace(/\/$/, '');
        const newLeaf = prompt("Rename folder:", old.split('/').pop());
        if (!newLeaf || newLeaf === old.split('/').pop()) break;
        const parent = old.substring(0, old.lastIndexOf('/'));
        const newFull = parent ? `${parent}/${newLeaf}` : newLeaf;
        const r = await fetch(`/folders/${encodeURIComponent(old)}?new_name=${encodeURIComponent(newFull)}`, { method: "PUT" });
        if (r.ok) { loadFileList(); setStatus(`Renamed to "${newLeaf}"`); }
        else setStatus("Rename failed", true);
      } else {
        const displayName = target.split('/').pop().replace(/\.md$/, '');
        const newLeaf = prompt("Rename note:", displayName);
        if (!newLeaf || newLeaf === displayName) break;
        const r = await fetch(`/files/${encodeURIComponent(target)}`);
        if (!r.ok) break;
        const { content } = await r.json();
        const parent = target.substring(0, target.lastIndexOf('/'));
        const finalName = newLeaf.endsWith(".md") ? newLeaf : newLeaf + ".md";
        const newFull = parent ? `${parent}/${finalName}` : finalName;
        await fetch(`/files/${encodeURIComponent(newFull)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        await fetch(`/files/${encodeURIComponent(target)}`, { method: "DELETE" });
        if (currentFile === target) {
          currentFile = newFull;
          document.getElementById("filename-input").value = finalName;
        }
        loadFileList();
        setStatus(`Renamed to "${finalName}"`);
      }
      break;
    }

    // ── duplicate file ────────────────────────────────────────────────────
    case "duplicate": {
      if (!target) break;
      const r = await fetch(`/files/${encodeURIComponent(target)}`);
      if (!r.ok) break;
      const { content } = await r.json();
      const parent = target.substring(0, target.lastIndexOf('/'));
      const base = target.split('/').pop().replace(/\.md$/, '');
      let copyName, newFull, counter = 0;
      do {
        counter++;
        copyName = counter === 1 ? `${base} copy.md` : `${base} copy ${counter}.md`;
        newFull = parent ? `${parent}/${copyName}` : copyName;
      } while ((await fetch(`/files/${encodeURIComponent(newFull)}`)).ok);
      await fetch(`/files/${encodeURIComponent(newFull)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      loadFileList();
      setStatus(`Duplicated as "${copyName}"`);
      break;
    }

    // ── move file to folder ───────────────────────────────────────────────
    case "move": {
      if (!target || isFolder) break;
      const dest = prompt("Move to folder (leave blank for root):", "");
      if (dest === null) break;
      const fileName = target.split('/').pop();
      const newPath = dest.trim() ? `${dest.trim()}/${fileName}` : fileName;
      if (target !== newPath) await moveFile(target, newPath);
      break;
    }

    // ── copy absolute path to clipboard ──────────────────────────────────
    case "copy-path": {
      if (!target) break;
      // Build an absolute-looking path for display; use the notes path prefix
      const absPath = `notes/${target}`;
      try {
        await navigator.clipboard.writeText(absPath);
        setStatus(`Path copied: ${absPath}`);
      } catch {
        prompt("Copy this path:", absPath);
      }
      break;
    }

    // ── reveal in file manager ────────────────────────────────────────────
    case "reveal": {
      if (!target) break;
      await fetch(`/reveal/${encodeURIComponent(target)}`, { method: "POST" });
      setStatus("Opened in file manager");
      break;
    }

    // ── delete ────────────────────────────────────────────────────────────
    case "delete": {
      if (isFolder) {
        const leaf = target.replace(/\/$/, '').split('/').pop();
        if (!confirm(`Delete folder "${leaf}" and all its contents?`)) break;
        const r = await fetch(`/files/${encodeURIComponent(target)}`, { method: "DELETE" });
        if (r.ok) { loadFileList(); setStatus(`Deleted "${leaf}"`); }
        else setStatus("Delete failed", true);
      } else {
        const leaf = target.split('/').pop();
        if (!confirm(`Delete "${leaf}"?`)) break;
        await fetch(`/files/${encodeURIComponent(target)}`, { method: "DELETE" });
        if (currentFile === target) {
          setContent(""); currentFile = "untitled.md";
          document.getElementById("filename-input").value = "untitled.md";
        }
        loadFileList();
        setStatus(`Deleted "${leaf}"`);
      }
      break;
    }
  }
});

// ── search ─────────────────────────────────────────────────────────────────────
let searchDebounce = null;
const searchInput  = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const fileList      = document.getElementById("file-list");

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    fileList.classList.remove("hidden");
    return;
  }
  searchDebounce = setTimeout(async () => {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const { results } = await res.json();
    searchResults.innerHTML = "";
    fileList.classList.add("hidden");
    searchResults.classList.remove("hidden");
    if (!results.length) {
      const li = document.createElement("li");
      li.className = "no-results";
      li.textContent = "No results";
      searchResults.appendChild(li);
      return;
    }
    results.forEach(({ name, snippet }) => {
      const li = document.createElement("li");
      li.className = "search-result";
      const title = document.createElement("div");
      title.className = "sr-title";
      title.textContent = name;
      const snip = document.createElement("div");
      snip.className = "sr-snippet";
      snip.textContent = snippet;
      li.appendChild(title);
      li.appendChild(snip);
      li.addEventListener("click", () => {
        openFile(name);
        searchInput.value = "";
        searchResults.classList.add("hidden");
        fileList.classList.remove("hidden");
      });
      searchResults.appendChild(li);
    });
  }, 250);
});

// ── open / save / delete ───────────────────────────────────────────────────────
async function openFile(name) {
  const res = await fetch(`/files/${encodeURIComponent(name)}`);
  if (!res.ok) { setStatus("Could not open file", true); return; }
  const { content } = await res.json();
  currentFile = name;
  document.getElementById("filename-input").value = name;
  setContent(content);
  setStatus(`Opened ${name}`);
  
  // Reveal the file in the sidebar (expand parent folders)
  revealInSidebar(name);
}

async function saveFile(silent = false) {
  const name = document.getElementById("filename-input").value.trim() || "untitled.md";
  let newFileName = name.endsWith(".md") ? name : name + ".md";
  
  // If we're in a folder and the filename doesn't have a path, prepend current folder
  if (currentFolder && !newFileName.includes('/')) {
    newFileName = `${currentFolder}/${newFileName}`;
  }
  
  // If filename changed, delete the old file
  if (currentFile !== newFileName && currentFile !== "untitled.md" && !currentFile.includes('/untitled.md')) {
    await fetch(`/files/${encodeURIComponent(currentFile)}`, { method: "DELETE" });
  }
  
  currentFile = newFileName;
  // Display only the filename in the input (not the full path)
  document.getElementById("filename-input").value = newFileName.split('/').pop();
  
  const res = await fetch(`/files/${encodeURIComponent(currentFile)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: getContent() }),
  });
  if (res.ok) {
    isDirty = false;
    updateDirtyBadge();
    if (!silent) setStatus(`Saved ${currentFile}`);
    loadFileList();
  } else {
    setStatus("Save failed", true);
  }
}

async function deleteFile(name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await fetch(`/files/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (currentFile === name) {
    setContent("");
    document.getElementById("filename-input").value = "untitled.md";
    currentFile = "untitled.md";
  }
  loadFileList();
  setStatus(`Deleted ${name}`);
}

document.getElementById("btn-new").addEventListener("click", () => {
  // Create new file in current folder
  currentFile = currentFolder ? `${currentFolder}/untitled.md` : "untitled.md";
  document.getElementById("filename-input").value = "untitled.md";
  setContent("");
  setStatus("New note in " + (currentFolder || "root"));
});
document.getElementById("btn-save").addEventListener("click", () => saveFile());

// ── import ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("file-input").click();
});

document.getElementById("file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  setStatus(`Importing ${file.name}…`);
  const res = await fetch("/import", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setStatus(err.detail || "Import failed", true);
    return;
  }
  const { content } = await res.json();
  setContent(content);
  const stem = file.name.replace(/\.[^.]+$/, "");
  document.getElementById("filename-input").value = stem + ".md";
  currentFile = stem + ".md";
  setStatus(`Imported ${file.name}`);
  e.target.value = "";
});

// ── image upload ───────────────────────────────────────────────────────────────
document.getElementById("image-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus(`Uploading ${file.name}…`);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/upload/image", { method: "POST", body: form });
  if (!res.ok) { setStatus("Image upload failed", true); return; }
  const { url } = await res.json();
  const alt = file.name.replace(/\.[^.]+$/, "");
  insertBlock(`![${alt}](${url})`);
  setStatus(`Image inserted: ${file.name}`);
  e.target.value = "";
});

// ── export ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-export-menu").addEventListener("click", () => {
  document.getElementById("export-menu").classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest(".dropdown")) document.getElementById("export-menu").classList.remove("open");
});

document.getElementById("btn-dl-md").addEventListener("click", async () => {
  await saveFile(true);
  const a = document.createElement("a");
  a.href = `/download/md/${encodeURIComponent(currentFile)}`;
  a.download = currentFile;
  a.click();
});

document.getElementById("btn-export-html").addEventListener("click", async () => {
  const html = document.getElementById("preview").innerHTML;
  const res = await fetch(`/export/html/${encodeURIComponent(currentFile)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html }),
  });
  if (!res.ok) { setStatus("HTML export failed", true); return; }
  downloadBlob(await res.blob(), currentFile.replace(/\.md$/, ".html"));
});

document.getElementById("btn-export-pdf").addEventListener("click", async () => {
  const html = document.getElementById("preview").innerHTML;
  const res = await fetch(`/export/pdf/${encodeURIComponent(currentFile)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if ((err.detail || "").includes("501")) { printPreview(); return; }
    setStatus(err.detail || "PDF export failed", true);
    return;
  }
  downloadBlob(await res.blob(), currentFile.replace(/\.md$/, ".pdf"));
});

document.getElementById("btn-print").addEventListener("click", printPreview);

function printPreview() {
  const html = document.getElementById("preview").innerHTML;
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;line-height:1.6}
    pre{background:#f4f4f4;padding:1rem;border-radius:4px}
    code{background:#f4f4f4;padding:.2em .4em;border-radius:3px}
    blockquote{border-left:4px solid #ccc;margin:0;padding-left:1rem;color:#555}
    img{max-width:100%}</style></head><body>${html}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── toolbar buttons ────────────────────────────────────────────────────────────
document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("click", () => { if (ACTIONS[btn.dataset.action]) ACTIONS[btn.dataset.action](); });
});

// ── Table inserter modal ────────────────────────────────────────────────────────
function buildTableGrid(rows, cols) {
  const grid = document.getElementById("table-grid");
  // All columns fixed at 36px — no content-driven resizing
  grid.style.gridTemplateColumns = `repeat(${cols}, 36px)`;
  grid.innerHTML = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "tbl-cell" + (r === 0 ? " tbl-header" : "");
      grid.appendChild(cell);
    }
  }
}

function openTableModal() {
  document.getElementById("table-overlay").classList.remove("hidden");
  buildTableGrid(
    parseInt(document.getElementById("tbl-rows").value) || 3,
    parseInt(document.getElementById("tbl-cols").value) || 3
  );
}

["tbl-rows","tbl-cols"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    buildTableGrid(
      parseInt(document.getElementById("tbl-rows").value) || 1,
      parseInt(document.getElementById("tbl-cols").value) || 1
    );
  });
});

document.getElementById("btn-cancel-table").addEventListener("click", () => {
  document.getElementById("table-overlay").classList.add("hidden");
});

document.getElementById("btn-insert-table").addEventListener("click", () => {
  const rows = Math.max(1, parseInt(document.getElementById("tbl-rows").value) || 3);
  const cols = Math.max(1, parseInt(document.getElementById("tbl-cols").value) || 3);
  
  // Prompt for table title
  const title = prompt("Table title (optional):", "");
  
  // Create fixed-width columns with proper padding (15 chars per column)
  const colWidth = 15;
  const pad = (text) => text.padEnd(colWidth, ' ');
  
  const header = "| " + Array(cols).fill("Header").map((h,i) => pad(`${h} ${i+1}`)).join(" | ") + " |";
  const sep    = "| " + Array(cols).fill("-".repeat(colWidth)).join(" | ") + " |";
  const row    = "| " + Array(cols).fill(pad("Cell")).join(" | ") + " |";
  const dataRows = Array(rows - 1).fill(row);
  
  let table = "";
  if (title && title.trim()) {
    table = `**${title.trim()}**\n\n`;
  }
  table += [header, sep, ...dataRows].join("\n");
  
  insertSnippet(table);
  document.getElementById("table-overlay").classList.add("hidden");
});

document.getElementById("table-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("table-overlay"))
    document.getElementById("table-overlay").classList.add("hidden");
});

// ── Editor right-click context menu ──────────────────────────────────────────
const editorCtxMenu = document.getElementById("editor-ctx-menu");

// Intercept right-click on the CodeMirror editor
document.getElementById("cm-editor").addEventListener("contextmenu", e => {
  e.preventDefault();
  editorCtxMenu.classList.remove("hidden");

  // Position, clamped to viewport
  let x = e.clientX, y = e.clientY;
  // Render offscreen first to measure
  editorCtxMenu.style.left = "-9999px";
  editorCtxMenu.style.top = "-9999px";
  const rect = editorCtxMenu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  editorCtxMenu.style.left = `${x}px`;
  editorCtxMenu.style.top = `${y}px`;
});

// Hide on click elsewhere
document.addEventListener("click", e => {
  if (!e.target.closest("#editor-ctx-menu")) editorCtxMenu.classList.add("hidden");
});

// Handle actions — reuse the existing ACTIONS map
editorCtxMenu.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  editorCtxMenu.classList.add("hidden");
  const action = btn.dataset.action;
  if (ACTIONS[action]) ACTIONS[action]();
});

// ── Diagram picker modal ────────────────────────────────────────────────────────
const DIAGRAM_SNIPPETS = {
  "econ-supply-demand": "```econ\nsupply-demand\n```",
  "econ-ppf":           "```econ\nppf\n```",
  "econ-cost":          "```econ\ncost\n```",
  "econ-custom": `\`\`\`econ
title: My Economic Graph
xlabel: Quantity
ylabel: Price
xmax: 10
ymax: 10
curve: Demand, [(0,9),(5,5),(10,1)], solid, #3b82f6
curve: Supply, [(0,1),(5,5),(10,9)], solid, #ef4444
point: Equilibrium, (5,5)
hline: 5, dotted, #6b7280
vline: 5, dotted, #6b7280
\`\`\``,
  flowchart: "```mermaid\nflowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Do something]\n    B -->|No| D[Do something else]\n    C --> E[End]\n    D --> E\n```",
  sequence:  "```mermaid\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello Bob!\n    B-->>A: Hi Alice!\n```",
  gantt:     "```mermaid\ngantt\n    title Project Plan\n    dateFormat YYYY-MM-DD\n    section Phase 1\n    Task A :a1, 2024-01-01, 7d\n    Task B :after a1, 5d\n    section Phase 2\n    Task C :2024-01-15, 10d\n```",
  pie:       "```mermaid\npie title Distribution\n    \"Category A\" : 40\n    \"Category B\" : 35\n    \"Category C\" : 25\n```",
  er:        "```mermaid\nerDiagram\n    STUDENT ||--o{ ENROLLMENT : enrolls\n    COURSE  ||--o{ ENROLLMENT : includes\n    STUDENT {\n        string name\n        string id\n    }\n    COURSE {\n        string title\n        int credits\n    }\n```",
  mindmap:   "```mermaid\nmindmap\n  root((Topic))\n    Subtopic 1\n      Detail A\n      Detail B\n    Subtopic 2\n      Detail C\n```",
};

function openDiagramModal() {
  document.getElementById("diagram-overlay").classList.remove("hidden");
}

document.getElementById("diagram-overlay").querySelectorAll(".diagram-type").forEach(btn => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.type;
    const diagramName = btn.textContent.trim();
    
    // Prompt for diagram title
    const title = prompt(`${diagramName} title (optional):`, "");
    
    let snippet = DIAGRAM_SNIPPETS[type] || "";
    if (title && title.trim()) {
      snippet = `**${title.trim()}**\n\n${snippet}`;
    }
    
    insertSnippet(snippet);
    document.getElementById("diagram-overlay").classList.add("hidden");
  });
});

document.getElementById("btn-cancel-diagram").addEventListener("click", () => {
  document.getElementById("diagram-overlay").classList.add("hidden");
});

document.getElementById("diagram-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("diagram-overlay"))
    document.getElementById("diagram-overlay").classList.add("hidden");
});

// ── Graph canvas integration ─────────────────────────────────────────────────

let graphCanvasInstance = null;
let graphEditInfo = null;  // {offset, length} when editing existing graph

function openGraphCanvas(existingData = null, editOffset = null, editLength = null) {
  const overlay = document.getElementById("graph-overlay");
  overlay.classList.remove("hidden");
  const svgEl = document.getElementById("graph-svg");
  svgEl.innerHTML = "";

  graphCanvasInstance = new GraphCanvas(svgEl);
  graphEditInfo = (editOffset !== null) ? { offset: editOffset, length: editLength } : null;

  if (existingData) {
    graphCanvasInstance.fromJSON(existingData);
  }

  // Set initial tool button state
  document.querySelectorAll("#graph-toolbar .gc-tool").forEach(b => {
    b.classList.toggle("active", b.dataset.tool === graphCanvasInstance.tool);
  });
}

function closeGraphCanvas() {
  document.getElementById("graph-overlay").classList.add("hidden");
  graphCanvasInstance = null;
  graphEditInfo = null;
}

// Tool selection
document.querySelectorAll("#graph-toolbar .gc-tool").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!graphCanvasInstance) return;
    graphCanvasInstance.tool = btn.dataset.tool;
    document.querySelectorAll("#graph-toolbar .gc-tool").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

// Grid / Snap toggles
document.getElementById("gc-grid").addEventListener("change", e => {
  if (graphCanvasInstance) { graphCanvasInstance.showGrid = e.target.checked; graphCanvasInstance.render(); }
});
document.getElementById("gc-snap").addEventListener("change", e => {
  if (graphCanvasInstance) graphCanvasInstance.snapToGrid = e.target.checked;
});

// Color / Width
document.getElementById("gc-color").addEventListener("input", e => {
  if (graphCanvasInstance) graphCanvasInstance.strokeColor = e.target.value;
});
document.getElementById("gc-width").addEventListener("change", e => {
  if (graphCanvasInstance) graphCanvasInstance.strokeWidth = parseFloat(e.target.value);
});

// Undo / Redo / Delete / Clear
document.getElementById("gc-undo").addEventListener("click", () => graphCanvasInstance?.undo());
document.getElementById("gc-redo").addEventListener("click", () => graphCanvasInstance?.redo());
document.getElementById("gc-delete").addEventListener("click", () => graphCanvasInstance?.deleteSelected());
document.getElementById("gc-clear").addEventListener("click", () => {
  if (graphCanvasInstance && confirm("Clear all elements?")) graphCanvasInstance.clear();
});

// Keyboard shortcuts in graph modal
document.getElementById("graph-overlay").addEventListener("keydown", e => {
  if (!graphCanvasInstance) return;
  if (e.key === "Escape") {
    // If building a curve, cancel it first; otherwise close modal
    if (graphCanvasInstance._curvePoints && graphCanvasInstance._curvePoints.length > 0) {
      graphCanvasInstance.cancelCurve();
    } else {
      closeGraphCanvas();
    }
    e.preventDefault();
  }
  if (e.key === "Delete" || e.key === "Backspace") { graphCanvasInstance.deleteSelected(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "z") { graphCanvasInstance.undo(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "y") { graphCanvasInstance.redo(); e.preventDefault(); }
});

// Cancel
document.getElementById("gc-cancel").addEventListener("click", closeGraphCanvas);
document.getElementById("graph-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("graph-overlay")) closeGraphCanvas();
});

// Save graph → insert into editor as markdown image
document.getElementById("gc-save").addEventListener("click", () => {
  if (!graphCanvasInstance) return;

  const json = graphCanvasInstance.toJSON();
  const jsonStr = JSON.stringify(json);
  const mdSnippet = "```graph\n" + jsonStr + "\n```";

  if (graphEditInfo) {
    view.dispatch({
      changes: { from: graphEditInfo.offset, to: graphEditInfo.offset + graphEditInfo.length, insert: mdSnippet },
    });
  } else {
    insertSnippet(mdSnippet);
  }

  closeGraphCanvas();
});

// ── publish ────────────────────────────────────────────────────────────────────
document.getElementById("btn-publish").addEventListener("click", () => {
  document.getElementById("publish-overlay").classList.remove("hidden");
});
document.getElementById("btn-cancel-publish").addEventListener("click", () => {
  document.getElementById("publish-overlay").classList.add("hidden");
});
document.getElementById("btn-confirm-publish").addEventListener("click", async () => {
  document.getElementById("publish-overlay").classList.add("hidden");
  setStatus("Publishing all notes…");
  const res = await fetch("/publish", { method: "POST" });
  const data = await res.json();
  if (res.ok) {
    let msg = `Published ${data.published} notes`;
    if (data.results.github) msg += ` • GitHub: ${data.results.github}`;
    if (data.results.dropbox) msg += ` • Dropbox: ${data.results.dropbox}`;
    if (data.results.gdrive) msg += ` • Drive: ${data.results.gdrive}`;
    setStatus(msg);
  } else {
    setStatus(data.detail || "Publish failed", true);
  }
});

// ── cloud file browser ─────────────────────────────────────────────────────────
async function openCloudBrowser(provider) {
  const section  = document.getElementById("cloud-section");
  const label    = document.getElementById("cloud-label");
  const list     = document.getElementById("cloud-file-list");
  label.textContent = provider === "dropbox" ? "Dropbox" : "Google Drive";
  list.innerHTML = "<li class='loading'>Loading…</li>";
  section.classList.remove("hidden");

  const url = provider === "dropbox" ? "/dropbox/files" : "/gdrive/files";
  const res = await fetch(url);
  list.innerHTML = "";
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = err.detail || "Error loading files";
    list.appendChild(li);
    return;
  }
  const { files } = await res.json();
  if (!files.length) {
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = "No .md files found";
    list.appendChild(li);
    return;
  }
  files.forEach(name => {
    const openUrl = provider === "dropbox" ? `/dropbox/open/${encodeURIComponent(name)}` : `/gdrive/open/${encodeURIComponent(name)}`;
    list.appendChild(makeFileItem(name, async () => {
      setStatus(`Opening ${name} from ${label.textContent}…`);
      const r = await fetch(openUrl);
      if (!r.ok) { setStatus("Failed to open", true); return; }
      const { content } = await r.json();
      setContent(content);
      document.getElementById("filename-input").value = name;
      currentFile = name;
      setStatus(`Opened ${name} from ${label.textContent}`);
    }, null));
  });
}

document.getElementById("btn-close-cloud").addEventListener("click", () => {
  document.getElementById("cloud-section").classList.add("hidden");
});

// ── settings modal ─────────────────────────────────────────────────────────────
async function openSettings() {
  const res = await fetch("/config");
  const cfg = await res.json();
  document.getElementById("cfg-repo-url").value = cfg?.github?.repo_url || "";
  document.getElementById("cfg-branch").value = cfg?.github?.branch || "main";

  // Check connection status
  const ghRes = await fetch("/github/status");
  const ghData = await ghRes.json();
  const ghStatus = document.getElementById("github-status");
  ghStatus.textContent = ghData.connected ? "✅ Connected" : "Not connected";
  ghStatus.style.color = ghData.connected ? "#98c379" : "";

  const dbRes = await fetch("/dropbox/status");
  const dbData = await dbRes.json();
  const dbStatus = document.getElementById("dropbox-status");
  dbStatus.textContent = dbData.connected ? "✅ Connected" : "Not connected";
  dbStatus.style.color = dbData.connected ? "#98c379" : "";

  const gdRes = await fetch("/gdrive/status");
  const gdData = await gdRes.json();
  const gdStatus = document.getElementById("gdrive-status");
  gdStatus.textContent = gdData.connected ? "✅ Connected" : "Not connected";
  gdStatus.style.color = gdData.connected ? "#98c379" : "";

  document.getElementById("modal-overlay").classList.remove("hidden");
}

document.getElementById("btn-settings").addEventListener("click", openSettings);
document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("modal-overlay").classList.add("hidden");
});

document.getElementById("btn-save-config").addEventListener("click", async () => {
  const config = {
    github: {
      repo_url: document.getElementById("cfg-repo-url").value,
      branch: document.getElementById("cfg-branch").value,
    },
  };
  const res = await fetch("/config", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
  if (res.ok) {
    setStatus("Settings saved");
    document.getElementById("modal-overlay").classList.add("hidden");
  } else {
    setStatus("Failed to save settings", true);
  }
});

// OAuth login buttons
document.getElementById("btn-github-login").addEventListener("click", () => {
  window.open("/github/auth", "_blank", "width=600,height=700");
});
document.getElementById("btn-dropbox-login").addEventListener("click", () => {
  window.open("/dropbox/auth", "_blank", "width=600,height=700");
});
document.getElementById("btn-gdrive-login").addEventListener("click", () => {
  window.open("/gdrive/auth", "_blank", "width=600,height=700");
});

// close modals on overlay click
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});
document.getElementById("publish-overlay").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

// ── show / hide preview ────────────────────────────────────────────────────────
const previewPane      = document.getElementById("preview-pane");
const btnTogglePreview = document.getElementById("btn-toggle-preview");
let previewVisible = true;

function togglePreview() {
  previewVisible = !previewVisible;
  previewPane.classList.toggle("hidden-pane", !previewVisible);
  btnTogglePreview.textContent = previewVisible ? "‹ Preview" : "› Preview";
  btnTogglePreview.classList.toggle("preview-hidden", !previewVisible);
  btnTogglePreview.title = previewVisible ? "Hide preview" : "Show preview";
}

btnTogglePreview.addEventListener("click", togglePreview);

// ── help panel ─────────────────────────────────────────────────────────────────
const helpPanel = document.getElementById("help-panel");
const btnHelp   = document.getElementById("btn-help");

function toggleHelp() {
  const open = helpPanel.classList.toggle("open");
  btnHelp.classList.toggle("active", open);
}

btnHelp.addEventListener("click", toggleHelp);
document.getElementById("btn-close-help").addEventListener("click", () => {
  helpPanel.classList.remove("open");
  btnHelp.classList.remove("active");
});

// close help on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && helpPanel.classList.contains("open")) {
    helpPanel.classList.remove("open");
    btnHelp.classList.remove("active");
  }
});

// ── warn on unsaved close ──────────────────────────────────────────────────────
window.addEventListener("beforeunload", e => {
  if (isDirty) { e.preventDefault(); e.returnValue = ""; }
});

// ── 17. Focus Mode ────────────────────────────────────────────────────────────
const btnFocus = document.getElementById("btn-focus");
let focusModeActive = false;

function toggleFocusMode() {
  focusModeActive = !focusModeActive;
  document.body.classList.toggle("focus-mode", focusModeActive);
  
  if (focusModeActive) {
    // Store current state
    localStorage.setItem("sc-focus-mode", "true");
    setStatus("Focus mode enabled - press F11 or click button to exit");
  } else {
    localStorage.removeItem("sc-focus-mode");
    setStatus("Focus mode disabled");
  }
}

btnFocus.addEventListener("click", toggleFocusMode);

// F11 keyboard shortcut for focus mode
document.addEventListener("keydown", (e) => {
  if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleFocusMode();
  }
  // Also allow Escape to exit focus mode
  if (e.key === "Escape" && focusModeActive) {
    toggleFocusMode();
  }
});

// Don't restore focus mode on startup - let user activate it manually
// if (localStorage.getItem("sc-focus-mode") === "true") {
//   toggleFocusMode();
// }

// ── 20. Undo/Redo Stack Persistence ───────────────────────────────────────────
const HISTORY_KEY = "sc-editor-history";
const MAX_HISTORY_ITEMS = 100;

// Save editor history to localStorage
function saveEditorHistory() {
  try {
    const historyState = {
      content: getContent(),
      file: currentFile,
      timestamp: Date.now()
    };
    // Only save if there's actual content
    if (historyState.content.trim()) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyState));
    }
  } catch (e) {
    console.error("Failed to save editor history:", e);
  }
}

// Restore editor history from localStorage
function restoreEditorHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      const historyState = JSON.parse(saved);
      // Only restore if it's the same file or untitled
      if (historyState.content && (historyState.file === currentFile || currentFile === "untitled.md")) {
        setContent(historyState.content);
        if (historyState.file && historyState.file !== "untitled.md") {
          currentFile = historyState.file;
          document.getElementById("filename-input").value = currentFile.split('/').pop();
        }
        setStatus("Restored previous session");
      }
    }
  } catch (e) {
    console.error("Failed to restore editor history:", e);
  }
}

// Save history periodically and on changes
let historySaveTimer = null;
const HISTORY_SAVE_DELAY = 5000; // 5 seconds

function scheduleHistorySave() {
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(saveEditorHistory, HISTORY_SAVE_DELAY);
}

// Listen for content changes to save history
const originalMarkDirty = markDirty;
markDirty = function() {
  originalMarkDirty();
  scheduleHistorySave();
};

// Save history before page unload
window.addEventListener("beforeunload", saveEditorHistory);

// Restore history on load (after editor is initialized)
setTimeout(restoreEditorHistory, 100);

// ── 33. Debounce Preview Rendering ────────────────────────────────────────────
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_DELAY = 150; // ms

const originalRenderPreview = renderPreview;
renderPreview = function() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    originalRenderPreview();
  }, PREVIEW_DEBOUNCE_DELAY);
};

// ── 18. Loading States - Show skeleton on file list load ──────────────────────
function showFileListSkeleton() {
  const ul = document.getElementById("file-list");
  ul.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton skeleton-file";
    ul.appendChild(skeleton);
  }
}

// ── Auto-save and Auto-publish ─────────────────────────────────────────────────
let autoPublishTimer = null;

// Auto-save every 1 minute
function startAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(() => {
    if (isDirty && currentFile !== "untitled.md") {
      saveFile(true); // silent save
      console.log("Auto-saved:", currentFile);
    }
  }, 60000); // 1 minute
}

// Auto-publish every 10 minutes (if online and connected to cloud)
async function autoPublish() {
  if (!navigator.onLine) return;
  
  try {
    const res = await fetch("/publish", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      console.log("Auto-published:", data.published, "notes");
    }
  } catch (e) {
    console.log("Auto-publish skipped:", e.message);
  }
}

function startAutoPublish() {
  if (autoPublishTimer) clearInterval(autoPublishTimer);
  autoPublishTimer = setInterval(() => {
    autoPublish();
  }, 600000); // 10 minutes
}

// Start auto-save and auto-publish
startAutoSave();
startAutoPublish();

// ── init ───────────────────────────────────────────────────────────────────────
loadFileList();

// ── Electron quit button ──────────────────────────────────────────────────────
// Detect if running in Electron
const isElectron = navigator.userAgent.toLowerCase().includes('electron');

if (isElectron) {
  // Show quit button
  const quitBtn = document.getElementById('btn-quit');
  if (quitBtn) {
    quitBtn.style.display = 'inline-block';
    quitBtn.addEventListener('click', () => {
      if (isDirty && !confirm('You have unsaved changes. Quit anyway?')) {
        return;
      }
      window.close();
    });
  }
  
  // Add Ctrl+Q shortcut
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'q') {
      e.preventDefault();
      if (isDirty && !confirm('You have unsaved changes. Quit anyway?')) {
        return;
      }
      window.close();
    }
  });
}
