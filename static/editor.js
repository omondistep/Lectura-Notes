// ═══════════════════════════════════════════════════════════════════════════════
// Lectura Editor — Typora-inspired Markdown editor
// ═══════════════════════════════════════════════════════════════════════════════

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, historyKeymap, history, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { vim, Vim } from "@replit/codemirror-vim";
import { GraphCanvas } from "./graph-canvas.js";

// ── markdown-it ────────────────────────────────────────────────────────────────
const md = window.markdownit({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight(str, lang) {
    return `<pre><code class="language-${lang || ''}">${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

// Checkbox support
md.core.ruler.after("inline", "checkbox", (state) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== "inline" || !blockToken.children) continue;
    const out = [];
    let i = 0;
    while (i < blockToken.children.length) {
      const t = blockToken.children[i];
      if (t.type === "text" && /^\[([ xX])\]/.test(t.content)) {
        const checked = t.content[1].toLowerCase() === "x";
        const tok = new state.Token("html_inline", "", 0);
        tok.content = `<input type="checkbox" disabled ${checked ? "checked" : ""}>`;
        out.push(tok);
        const rest = t.content.slice(3);
        if (rest) {
          const s = new state.Token("text", "", 0);
          s.content = rest;
          out.push(s);
        }
      } else if (t.type === "text" && t.content.includes("[")) {
        const parts = [];
        let s = t.content;
        const re = /\[([ xX])\]/g;
        let last = 0, m;
        while ((m = re.exec(s)) !== null) {
          if (m.index > last) {
            const before = new state.Token("text", "", 0);
            before.content = s.slice(last, m.index);
            parts.push(before);
          }
          const checked = m[1].toLowerCase() === "x";
          const tok = new state.Token("html_inline", "", 0);
          tok.content = `<input type="checkbox" disabled ${checked ? "checked" : ""}>`;
          parts.push(tok);
          last = m.index + m[0].length;
        }
        if (last < s.length) {
          const rest = Object.assign({}, t);
          rest.content = s.slice(last);
          parts.push(rest);
        }
        out.push(...parts);
      } else {
        out.push(t);
      }
      i++;
    }
    blockToken.children = out;
  }
});

// :::qa flashcard support
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

// ── Lazy load Mermaid ──────────────────────────────────────────────────────────
let mermaidInitialized = false;
let mermaidLoading = false;
let mermaidIdCounter = 0;

async function initMermaid() {
  if (mermaidLoading) return;
  if (window.mermaid && !mermaidInitialized) {
    try {
      const theme = (typeof currentTheme !== "undefined" && ["dark","cobalt","phantom","forest","jade","lavender","sunset"].includes(currentTheme)) ? "dark" : "default";
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: "loose" });
    } catch (e) { console.warn("Mermaid init:", e); }
    mermaidInitialized = true;
  } else if (!window.mermaid && !mermaidLoading) {
    mermaidLoading = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    script.onload = () => { mermaidLoading = false; initMermaid(); };
    document.head.appendChild(script);
  }
}

const markdownLang = markdown();

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════
let currentFile = "untitled.md";
let currentFolder = "";
let isDirty = false;
let autoSaveTimer = null;
const AUTOSAVE_DELAY = 2000;
let sidebarMode = "tree";

// ── theme compartment ──────────────────────────────────────────────────────────
const themeCompartment = new Compartment();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function getContent() { return view.state.doc.toString(); }

function setContent(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  isDirty = false;
  updateDirtyBadge();
}

function setStatus(msg, isError = false) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  el.style.color = isError ? "var(--red)" : "var(--accent-2)";
  setTimeout(() => { el.textContent = "Ready"; el.style.color = ""; }, 3000);
}

function updateWordCount() {
  const text = getContent().trim();
  const words = text ? text.split(/\s+/).length : 0;
  document.getElementById("word-count").textContent = `${words} word${words !== 1 ? "s" : ""}`;
}

function updateReadingTime() {
  const text = getContent().trim();
  const words = text ? text.split(/\s+/).length : 0;
  const minutes = Math.ceil(words / 200);
  const el = document.getElementById("reading-time");
  if (el) el.textContent = `~${minutes} min read`;
}

function updateDocStatus() {
  const el = document.getElementById("doc-status");
  if (!el) return;
  if (isDirty) {
    el.textContent = "● Draft";
    el.className = "doc-status draft";
    el.title = "Unsaved changes";
  } else if (currentFile === "untitled.md") {
    el.textContent = "● New";
    el.className = "doc-status new";
    el.title = "New document";
  } else {
    el.textContent = "● Saved";
    el.className = "doc-status saved";
    el.title = "Saved locally";
  }
}

function updateDirtyBadge() {
  const badge = document.getElementById("autosave-badge");
  if (badge) badge.classList.toggle("hidden", !isDirty);
}

function markDirty() {
  isDirty = true;
  updateDirtyBadge();
  scheduleHistorySave();
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    if (isDirty) {
      await saveFile(true);
    }
  }, AUTOSAVE_DELAY);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════════════
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_DELAY = 150;

function renderPreview() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(doRenderPreview, PREVIEW_DEBOUNCE_DELAY);
}

function doRenderPreview() {
  const content = getContent();
  const processed = preprocessFlashcards(content);
  const html = md.render(processed);
  const previewEl = document.getElementById("preview");
  previewEl.innerHTML = html;

  // Wire flashcard buttons
  previewEl.querySelectorAll(".flashcard-flip").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".flashcard");
      card.classList.toggle("flipped");
      btn.textContent = card.classList.contains("flipped") ? "Hide answer" : "Show answer";
    });
  });

  renderLatex(previewEl);
  renderMermaidDiagrams(previewEl);
  renderEconGraphs(previewEl);
  renderGraphBlocks(previewEl);
  updateWordCount();
  updateReadingTime();
  updateDocStatus();

  // Update outline if in outline mode
  if (sidebarMode === "outline") {
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(updateOutline, 300);
  }
}

function renderLatex(container) {
  if (!window.katex) return;
  container.innerHTML = container.innerHTML.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
    try { return `<div class="math-display">${katex.renderToString(math.trim(), { throwOnError: false, displayMode: true })}</div>`; }
    catch (e) { return match; }
  });
  container.innerHTML = container.innerHTML.replace(/\$([^\$\n]+)\$/g, (match, math) => {
    try { return katex.renderToString(math, { throwOnError: false, displayMode: false }); }
    catch (e) { return match; }
  });
}

async function renderMermaidDiagrams(container) {
  if (!window.mermaid) return;
  await initMermaid();
  const codeBlocks = container.querySelectorAll("pre code.language-mermaid");
  for (const codeBlock of codeBlocks) {
    const pre = codeBlock.parentElement;
    try {
      const id = "mermaid-" + (mermaidIdCounter++);
      const { svg } = await mermaid.render(id, codeBlock.textContent);
      const div = document.createElement("div");
      div.className = "mermaid-diagram";
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (e) { console.error("Mermaid:", e); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ECONOMIC GRAPHS
// ═══════════════════════════════════════════════════════════════════════════════
const ECON_PRESETS = {
  "supply-demand": `title: Supply and Demand\nxlabel: Quantity\nylabel: Price\nxmax: 10\nymax: 10\ncurve: Demand, [(0,9),(3,7),(5,5),(7,3),(10,1)], solid, #3b82f6\ncurve: Supply, [(0,1),(3,3),(5,5),(7,7),(10,9)], solid, #ef4444\npoint: Equilibrium, (5,5)\nhline: 5, dotted, #6b7280\nvline: 5, dotted, #6b7280`,
  "ppf": `title: Production Possibility Frontier\nxlabel: Good X\nylabel: Good Y\nxmax: 10\nymax: 10\ncurve: PPF, [(0,10),(2,9.8),(4,9.2),(6,8),(8,6),(9,3.5),(10,0)], solid, #10b981\ncurve: Unattainable, [(0,10),(2,10),(4,10),(6,10),(8,10),(10,10)], dotted, #ef4444\npoint: Efficient, (6,8)\npoint: Inefficient, (4,5)`,
  "cost": `title: Cost Curves\nxlabel: Quantity\nylabel: Cost\nxmax: 10\nymax: 14\ncurve: MC, [(1,10),(2,7),(3,5),(4,4),(5,4),(6,5),(7,7),(8,10),(9,13)], solid, #ef4444\ncurve: ATC, [(1,13),(2,10),(3,8),(4,6.5),(5,6),(6,6.2),(7,6.8),(8,7.8),(9,9)], solid, #3b82f6\ncurve: AVC, [(1,7),(2,5),(3,4),(4,3.5),(5,3.8),(6,4.5),(7,5.5),(8,7),(9,8.5)], solid, #10b981`,
};
const ECON_COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#06b6d4","#f97316"];

function parseEconDSL(src) {
  const trimmed = src.trim();
  if (ECON_PRESETS[trimmed]) src = ECON_PRESETS[trimmed];
  const lines = src.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const cfg = { title: "", xlabel: "X", ylabel: "Y", xmax: 10, ymax: 10, curves: [], points: [], vlines: [], hlines: [], arrows: [] };
  let colorIdx = 0;
  for (const line of lines) {
    const [key, ...rest] = line.split(":").map(s => s.trim());
    const val = rest.join(":").trim();
    if (key === "title") { cfg.title = val; continue; }
    if (key === "xlabel") { cfg.xlabel = val; continue; }
    if (key === "ylabel") { cfg.ylabel = val; continue; }
    if (key === "xmax") { cfg.xmax = parseFloat(val) || 10; continue; }
    if (key === "ymax") { cfg.ymax = parseFloat(val) || 10; continue; }
    if (key === "curve") {
      const label = val.split(",")[0].trim();
      const coordStr = val.slice(val.indexOf("["), val.indexOf("]") + 1);
      const style = val.includes("dotted") ? "dotted" : val.includes("dashed") ? "dashed" : "solid";
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      const color = colorMatch ? colorMatch[0] : ECON_COLORS[colorIdx++ % ECON_COLORS.length];
      const points = [...coordStr.matchAll(/\(([0-9.]+),([0-9.]+)\)/g)].map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
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
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      cfg.vlines.push({ x: parseFloat(parts[0]), style: parts[1] || "dotted", color: colorMatch ? colorMatch[0] : "#6b7280" });
      continue;
    }
    if (key === "hline") {
      const parts = val.split(",").map(s => s.trim());
      const colorMatch = val.match(/#[0-9a-fA-F]{3,6}/);
      cfg.hlines.push({ y: parseFloat(parts[0]), style: parts[1] || "dotted", color: colorMatch ? colorMatch[0] : "#6b7280" });
      continue;
    }
  }
  return cfg;
}

function buildEconDashPattern(style) {
  if (style === "dotted") return [2, 4];
  if (style === "dashed") return [8, 4];
  return [];
}

function renderEconGraphs(container) {
  if (!window.Chart) return;
  container.querySelectorAll("pre code.language-econ").forEach(codeEl => {
    const pre = codeEl.parentElement;
    const cfg = parseEconDSL(codeEl.textContent);
    const wrapper = document.createElement("div");
    wrapper.className = "econ-chart-wrapper";
    const canvas = document.createElement("canvas");
    wrapper.appendChild(canvas);
    pre.replaceWith(wrapper);

    const datasets = cfg.curves.map(curve => ({
      label: curve.label, data: curve.points, borderColor: curve.color,
      backgroundColor: "transparent", borderWidth: 2.5,
      borderDash: buildEconDashPattern(curve.style), pointRadius: 0, tension: 0.4, parsing: false,
    }));
    cfg.vlines.forEach(vl => datasets.push({
      label: `_vline_${vl.x}`, data: [{ x: vl.x, y: 0 }, { x: vl.x, y: cfg.ymax }],
      borderColor: vl.color, borderWidth: 1.5, borderDash: buildEconDashPattern(vl.style), pointRadius: 0, tension: 0, parsing: false,
    }));
    cfg.hlines.forEach(hl => datasets.push({
      label: `_hline_${hl.y}`, data: [{ x: 0, y: hl.y }, { x: cfg.xmax, y: hl.y }],
      borderColor: hl.color, borderWidth: 1.5, borderDash: buildEconDashPattern(hl.style), pointRadius: 0, tension: 0, parsing: false,
    }));
    if (cfg.points.length) datasets.push({
      label: cfg.points.map(p => p.label).join(", "), data: cfg.points.map(p => ({ x: p.x, y: p.y })),
      type: "scatter", borderColor: "#f59e0b", backgroundColor: "#f59e0b", pointRadius: 6, parsing: false,
    });

    new Chart(canvas, {
      type: "line", data: { datasets },
      options: {
        responsive: true, animation: false,
        plugins: {
          title: { display: !!cfg.title, text: cfg.title, color: "#e6edf3", font: { size: 14, weight: "600" } },
          legend: { labels: { color: "#8b949e", filter: item => !item.text.startsWith("_"), boxWidth: 20 } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label.startsWith("_") ? null : `${ctx.dataset.label}: (${ctx.parsed.x}, ${ctx.parsed.y})` } },
        },
        scales: {
          x: { type: "linear", min: 0, max: cfg.xmax, title: { display: true, text: cfg.xlabel, color: "#8b949e" }, grid: { color: "#21262d" }, ticks: { color: "#8b949e" } },
          y: { type: "linear", min: 0, max: cfg.ymax, title: { display: true, text: cfg.ylabel, color: "#8b949e" }, grid: { color: "#21262d" }, ticks: { color: "#8b949e" } },
        },
      },
    });
  });
}

// ── Graph blocks in preview ──────────────────────────────────────────────────
function renderGraphBlocks(container) {
  [...container.querySelectorAll("pre code.language-graph")].forEach((codeEl, blockIndex) => {
    const pre = codeEl.parentElement;
    let data;
    try { data = JSON.parse(codeEl.textContent.trim()); } catch (_) { return; }
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
    const gc = new GraphCanvas(svg, { width: w, height: h });
    gc.fromJSON(data);
    wrapper.appendChild(svg);
    pre.replaceWith(wrapper);

    wrapper.addEventListener("dblclick", () => {
      const content = getContent();
      const re = /```graph\n([\s\S]*?)```/g;
      let match, idx = 0;
      while ((match = re.exec(content))) {
        if (idx === blockIndex) {
          try { openGraphCanvas(JSON.parse(match[1].trim()), match.index, match[0].length); }
          catch (_) { openGraphCanvas(data); }
          return;
        }
        idx++;
      }
      openGraphCanvas(data);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDITOR INSERT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
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
  const changes = [];
  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = view.state.doc.line(ln);
    if (line.text.startsWith(prefix)) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
    } else {
      let actualPrefix = prefix;
      if (prefix === "1. " && ln > startLine.number) actualPrefix = `${ln - startLine.number + 1}. `;
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
  const cursor = view.state.selection.main.head;
  const line = view.state.doc.lineAt(cursor);
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
    if (match) changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
  }
  if (changes.length) view.dispatch({ changes });
  view.focus();
}

function saveAs() {
  const name = prompt("Save as:", currentFile);
  if (!name) return;
  currentFile = name.endsWith(".md") ? name : name + ".md";
  document.getElementById("filename-input").value = currentFile.split("/").pop();
  saveFile();
}

function clearFormat() {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  let text = view.state.sliceDoc(from, to);
  text = text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/~~(.+?)~~/g, "$1").replace(/==(.+?)==/g, "$1");
  text = text.replace(/`(.+?)`/g, "$1").replace(/<u>(.+?)<\/u>/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  view.dispatch({ changes: { from, to, insert: text } });
  view.focus();
}

function increaseHeading() {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const match = line.text.match(/^(#{1,6})\s/);
  if (match) {
    if (match[1].length < 6) view.dispatch({ changes: { from: line.from, to: line.from + match[1].length, insert: match[1] + "#" } });
  } else {
    view.dispatch({ changes: { from: line.from, insert: "# " } });
  }
  view.focus();
}

function decreaseHeading() {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const match = line.text.match(/^(#{1,6})\s/);
  if (match) {
    if (match[1].length === 1) view.dispatch({ changes: { from: line.from, to: line.from + 2, insert: "" } });
    else view.dispatch({ changes: { from: line.from, to: line.from + match[1].length, insert: match[1].slice(1) } });
  }
  view.focus();
}

function selectLine() {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({ selection: { anchor: line.from, head: line.to } });
  view.focus();
}

function selectWord() {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  const text = line.text;
  let start = offset, end = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  view.dispatch({ selection: { anchor: line.from + start, head: line.from + end } });
  view.focus();
}

function deleteWord() {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  const text = line.text;
  let start = offset, end = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  if (start !== end) view.dispatch({ changes: { from: line.from + start, to: line.from + end, insert: "" } });
  view.focus();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIONS MAP
// ═══════════════════════════════════════════════════════════════════════════════
const ACTIONS = {
  bold: () => wrapSelection("**"),
  italic: () => wrapSelection("*"),
  code: () => wrapSelection("`"),
  link: () => wrapSelection("[", "](url)"),
  image: () => document.getElementById("image-input").click(),
  h1: () => insertAtLineStart("# "),
  h2: () => insertAtLineStart("## "),
  h3: () => insertAtLineStart("### "),
  h4: () => insertAtLineStart("#### "),
  h5: () => insertAtLineStart("##### "),
  h6: () => insertAtLineStart("###### "),
  paragraph: () => removeLineStart(/^#{1,6}\s+/),
  ul: () => insertAtLineStart("- "),
  ol: () => insertAtLineStart("1. "),
  task: () => insertAtLineStart("- [ ] "),
  blockquote: () => insertAtLineStart("> "),
  codeblock: () => insertSnippet("```\n\n```"),
  mathblock: () => insertSnippet("$$\n\n$$"),
  highlight: () => wrapSelection("=="),
  strikethrough: () => wrapSelection("~~"),
  underline: () => wrapSelection("<u>", "</u>"),
  table: () => openTableModal(),
  diagram: () => openDiagramModal(),
  flashcard: () => insertSnippet(":::qa\nQuestion goes here\n:::\nAnswer goes here\n:::"),
  graph: () => openGraphCanvas(),
};

// ═══════════════════════════════════════════════════════════════════════════════
// VIM MODE
// ═══════════════════════════════════════════════════════════════════════════════
const vimCompartment = new Compartment();
let vimEnabled = localStorage.getItem("sc-vim") === "true";

const vimIndicator = document.getElementById("vim-mode-indicator");
function updateVimIndicator(modeName) {
  if (!vimEnabled || !modeName) { vimIndicator.classList.add("hidden"); return; }
  vimIndicator.classList.remove("hidden");
  vimIndicator.className = "vim-mode vim-" + modeName.toLowerCase().replace(/[^a-z]/g, "");
  vimIndicator.textContent = modeName.toUpperCase();
}
updateVimIndicator(vimEnabled ? "normal" : "");

function registerVimCommands() {
  Vim.defineEx("write", "w", () => saveFile());
  Vim.defineEx("wq", "", () => saveFile());
  Vim.defineEx("xit", "x", () => saveFile());
  Vim.defineEx("quit", "q", () => {
    if (isDirty) setStatus("Unsaved changes — use :w first", true);
    else setStatus("Nothing to close");
  });
  Vim.defineEx("help", "", () => {
    document.getElementById("help-panel").classList.add("open");
  });
  Vim.defineEx("set", "", (cm, params) => {
    const arg = (params.args || []).join(" ");
    if (arg === "vim") { enableVim(); return; }
    if (arg === "novim") { disableVim(); return; }
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

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOCORRECT
// ═══════════════════════════════════════════════════════════════════════════════
const AUTOCORRECT_MAP = {
  "teh":"the","hte":"the","adn":"and","nad":"and","recieve":"receive",
  "beleive":"believe","freind":"friend","wierd":"weird","occured":"occurred",
  "seperate":"separate","definately":"definitely","goverment":"government",
  "accomodate":"accommodate","untill":"until","doesnt":"doesn't",
  "didnt":"didn't","youre":"you're","theyre":"they're","ive":"I've",
  "im":"I'm","ill":"I'll","wont":"won't","dont":"don't","cant":"can't",
  "isnt":"isn't","wasnt":"wasn't","wouldnt":"wouldn't","couldnt":"couldn't",
  "shouldnt":"shouldn't","havent":"haven't","hasnt":"hasn't",
};

const autocorrectPlugin = EditorView.inputHandler.of((view, from, to, text) => {
  if (!/^[\s.,!?;:]$/.test(text)) return false;
  const doc = view.state.doc;
  const lineStart = doc.lineAt(from).from;
  const textBefore = doc.sliceString(lineStart, from);
  const wordMatch = textBefore.match(/([a-zA-Z']+)$/);
  if (!wordMatch) return false;
  const word = wordMatch[1];
  const correction = AUTOCORRECT_MAP[word.toLowerCase()];
  if (!correction) return false;
  const corrected = word[0] === word[0].toUpperCase() ? correction[0].toUpperCase() + correction.slice(1) : correction;
  if (corrected === word) return false;
  const wordStart = from - word.length;
  view.dispatch({ changes: { from: wordStart, to: from, insert: corrected }, userEvent: "autocorrect" });
  view.dispatch({ changes: { from: wordStart + corrected.length, to: wordStart + corrected.length, insert: text }, userEvent: "input" });
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORD PREDICTION
// ═══════════════════════════════════════════════════════════════════════════════
const COMMON_WORDS = [
  "about","above","after","again","against","also","although","always","another","any",
  "because","been","before","being","between","both","business","called","could","different",
  "does","doing","during","each","even","every","example","find","first","following",
  "found","from","general","give","given","good","government","great","group","have",
  "here","high","however","human","important","including","information","interest","into",
  "just","keep","know","large","last","later","leave","less","life","like","likely",
  "little","long","look","made","make","many","might","more","most","much","must",
  "national","need","never","next","nothing","number","often","once","only","order",
  "other","over","part","people","place","point","possible","present","problem","provide",
  "public","really","right","same","school","should","show","since","small","social",
  "something","sometimes","state","still","such","system","take","than","that","their",
  "then","there","therefore","these","they","thing","think","this","those","though",
  "through","time","today","together","under","until","using","very","want","well",
  "were","what","when","where","whether","which","while","will","within","without",
  "work","world","would","write","year","your",
].map(w => ({ label: w, type: "text" }));

function wordCompletionSource(context) {
  const word = context.matchBefore(/[a-zA-Z]{2,}/);
  if (!word) return null;
  if (!context.explicit && word.text.length < 2) return null;
  const prefix = word.text.toLowerCase();
  const docWords = [...new Set(context.state.doc.toString().match(/[a-zA-Z]{3,}/g) || [])]
    .filter(w => w.toLowerCase() !== prefix).map(w => ({ label: w, type: "text" }));
  const allWords = [...COMMON_WORDS, ...docWords];
  const seen = new Set();
  const options = allWords.filter(({ label }) => {
    const l = label.toLowerCase();
    if (l === prefix || !l.startsWith(prefix) || seen.has(l)) return false;
    seen.add(l);
    return true;
  }).slice(0, 8);
  if (!options.length) return null;
  return { from: word.from, options, validFor: /^[a-zA-Z]*$/ };
}

const wordPrediction = autocompletion({
  override: [wordCompletionSource],
  activateOnTyping: true,
  maxRenderedOptions: 8,
  defaultKeymap: true,
});

// ═══════════════════════════════════════════════════════════════════════════════
// CODEMIRROR SETUP
// ═══════════════════════════════════════════════════════════════════════════════
const updateListener = EditorView.updateListener.of(update => {
  if (update.docChanged) {
    renderPreview();
    markDirty();
    // Detect /graph command
    const pos = update.state.selection.main.head;
    const line = update.state.doc.lineAt(pos);
    if (line.text.trim() === "/graph") {
      update.view.dispatch({ changes: { from: line.from, to: line.to, insert: "" } });
      setTimeout(() => openGraphCanvas(), 50);
    }
  }
});

const customKeymap = keymap.of([
  { key: "Ctrl-0", run: () => { ACTIONS.paragraph(); return true; } },
  { key: "Ctrl-1", run: () => { ACTIONS.h1(); return true; } },
  { key: "Ctrl-2", run: () => { ACTIONS.h2(); return true; } },
  { key: "Ctrl-3", run: () => { ACTIONS.h3(); return true; } },
  { key: "Ctrl-4", run: () => { ACTIONS.h4(); return true; } },
  { key: "Ctrl-5", run: () => { ACTIONS.h5(); return true; } },
  { key: "Ctrl-6", run: () => { ACTIONS.h6(); return true; } },
  { key: "Ctrl-Shift-q", run: () => { ACTIONS.blockquote(); return true; } },
  { key: "Ctrl-Shift-c", run: () => { ACTIONS.codeblock(); return true; } },
  { key: "Ctrl-Shift-m", run: () => { ACTIONS.mathblock(); return true; } },
  { key: "Ctrl-Shift-k", run: () => { ACTIONS.codeblock(); return true; } },
  { key: "Ctrl-b", run: () => { ACTIONS.bold(); return true; } },
  { key: "Ctrl-i", run: () => { ACTIONS.italic(); return true; } },
  { key: "Ctrl-u", run: () => { ACTIONS.underline(); return true; } },
  { key: "Ctrl-e", run: () => { ACTIONS.code(); return true; } },
  { key: "Ctrl-Shift-h", run: () => { ACTIONS.highlight(); return true; } },
  { key: "Ctrl-k", run: () => { ACTIONS.link(); return true; } },
  { key: "Ctrl-Shift-i", run: () => { ACTIONS.image(); return true; } },
  { key: "Ctrl-Shift-8", run: () => { ACTIONS.ul(); return true; } },
  { key: "Ctrl-Shift-7", run: () => { ACTIONS.ol(); return true; } },
  { key: "Ctrl-Shift-x", run: () => { ACTIONS.task(); return true; } },
  { key: "Ctrl-t", run: () => { ACTIONS.table(); return true; } },
  { key: "Ctrl-s", run: () => { saveFile(); return true; } },
  { key: "Ctrl-o", run: () => { document.getElementById("file-input").click(); return true; } },
  { key: "Ctrl-Alt-v", run: () => { toggleVim(); return true; } },
  { key: "Ctrl-n", run: () => { document.getElementById("btn-new").click(); return true; } },
  { key: "Ctrl-p", run: () => { document.getElementById("search-input").focus(); return true; } },
  { key: "Ctrl-Shift-s", run: () => { saveAs(); return true; } },
  { key: "Ctrl-w", run: () => { setContent(""); currentFile = "untitled.md"; document.getElementById("filename-input").value = "untitled.md"; return true; } },
  { key: "Alt-Shift-5", run: () => { wrapSelection("~~"); return true; } },
  { key: "Ctrl-\\", run: () => { clearFormat(); return true; } },
  { key: "Ctrl-Shift-l", run: () => { toggleSidebar(); return true; } },
  { key: "Ctrl-/", run: () => { togglePreview(); return true; } },
  { key: "F8", run: () => { toggleFocusMode(); return true; } },
  { key: "F9", run: () => { toggleTypewriter(); return true; } },
  { key: "Ctrl-=", run: () => { increaseHeading(); return true; } },
  { key: "Ctrl--", run: () => { decreaseHeading(); return true; } },
  { key: "Ctrl-Shift-[", run: () => { ACTIONS.ol(); return true; } },
  { key: "Ctrl-Shift-]", run: () => { ACTIONS.ul(); return true; } },
  { key: "Ctrl-l", run: () => { selectLine(); return true; } },
  { key: "Ctrl-d", run: () => { selectWord(); return true; } },
  { key: "Ctrl-Shift-d", run: () => { deleteWord(); return true; } },
  { key: "Ctrl-,", run: () => { openSettings(); return true; } },
]);

const view = new EditorView({
  state: EditorState.create({
    doc: "# Welcome to Lectura\n\nStart typing your notes here...\n",
    extensions: [
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

registerVimCommands();

// Vim mode polling
let lastVimMode = "normal";
function pollVimMode() {
  if (vimEnabled) {
    let mode = "normal";
    try {
      const panel = view.dom.querySelector(".cm-vim-panel");
      if (panel) {
        const txt = panel.textContent.trim();
        if (txt.includes("INSERT")) mode = "insert";
        else if (txt.includes("VISUAL")) mode = "visual";
        else if (txt.includes("REPLACE")) mode = "replace";
      } else {
        const cmVim = view.cm;
        if (cmVim?.state?.vim) {
          const vs = cmVim.state.vim;
          if (vs.insertMode) mode = "insert";
          else if (vs.visualMode) mode = "visual";
          else if (vs.replaceMode) mode = "replace";
        }
      }
    } catch (_) {}
    if (mode !== lastVimMode) { lastVimMode = mode; updateVimIndicator(mode); }
  }
  requestAnimationFrame(pollVimMode);
}
requestAnimationFrame(pollVimMode);

doRenderPreview();

// ═══════════════════════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════════════════════
const lightCmTheme = EditorView.theme({}, { dark: false });

const themeConfig = {
  dark: { cmTheme: oneDark, label: "Dark" },
  light: { cmTheme: lightCmTheme, label: "Light" },
  cobalt: { cmTheme: oneDark, label: "Cobalt" },
  seniva: { cmTheme: lightCmTheme, label: "Seniva" },
  newsprint: { cmTheme: lightCmTheme, label: "Newsprint" },
  phantom: { cmTheme: oneDark, label: "Phantom" },
  seraph: { cmTheme: lightCmTheme, label: "Seraph" },
  forest: { cmTheme: oneDark, label: "Forest" },
  jade: { cmTheme: oneDark, label: "Jade" },
  lavender: { cmTheme: oneDark, label: "Lavender" },
  sunset: { cmTheme: oneDark, label: "Sunset" },
};

let currentTheme = "dark";

function applyTheme(themeName) {
  const config = themeConfig[themeName];
  if (!config) return;
  currentTheme = themeName;
  document.documentElement.setAttribute("data-theme", themeName);
  view.dispatch({ effects: themeCompartment.reconfigure(config.cmTheme) });
  localStorage.setItem("sc-theme", themeName);
  // Update checkmark
  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.classList.toggle("active-theme", btn.dataset.theme === themeName);
  });
}

// Theme selection from menu
document.querySelectorAll(".theme-option").forEach(btn => {
  btn.addEventListener("click", () => {
    applyTheme(btn.dataset.theme);
    closeAllMenus();
  });
});

const savedTheme = localStorage.getItem("sc-theme") || "dark";
applyTheme(savedTheme);

// ═══════════════════════════════════════════════════════════════════════════════
// MENU BAR DROPDOWN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
let activeMenu = null;

document.querySelectorAll(".menu-dropdown").forEach(dropdown => {
  const trigger = dropdown.querySelector(".menu-trigger");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = dropdown.classList.contains("open");
    closeAllMenus();
    if (!wasOpen) {
      dropdown.classList.add("open");
      activeMenu = dropdown;
    }
  });
  trigger.addEventListener("mouseenter", () => {
    if (activeMenu && activeMenu !== dropdown) {
      closeAllMenus();
      dropdown.classList.add("open");
      activeMenu = dropdown;
    }
  });
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-dropdown")) closeAllMenus();
});

function closeAllMenus() {
  document.querySelectorAll(".menu-dropdown.open").forEach(d => d.classList.remove("open"));
  activeMenu = null;
}

// Wire menu panel action buttons
document.querySelectorAll(".menu-panel button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    closeAllMenus();
    if (ACTIONS[btn.dataset.action]) ACTIONS[btn.dataset.action]();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════
let expandedFolders = new Set();

function loadExpandedFolders() {
  try {
    const saved = localStorage.getItem("sc-expanded-folders");
    if (saved) expandedFolders = new Set(JSON.parse(saved));
  } catch (e) {}
}

function saveExpandedFolders() {
  try { localStorage.setItem("sc-expanded-folders", JSON.stringify([...expandedFolders])); }
  catch (e) {}
}

loadExpandedFolders();

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

document.getElementById("btn-sidebar").addEventListener("click", toggleSidebar);
document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => { closeAllMenus(); toggleSidebar(); });
document.getElementById("btn-refresh-files").addEventListener("click", loadFileList);

// ── Sidebar mode switching ───────────────────────────────────────────────────
document.querySelectorAll(".sidebar-tab[data-mode]").forEach(tab => {
  tab.addEventListener("click", () => {
    const mode = tab.dataset.mode;
    if (mode === sidebarMode) return;
    switchSidebarMode(mode);
  });
});

function switchSidebarMode(mode) {
  sidebarMode = mode;
  document.querySelectorAll(".sidebar-tab[data-mode]").forEach(t => {
    t.classList.toggle("active", t.dataset.mode === mode);
  });
  document.querySelectorAll(".sidebar-content").forEach(panel => {
    panel.style.display = panel.dataset.for === mode ? "" : "none";
  });
  if (mode === "list") populateFileList();
  if (mode === "outline") updateOutline();
}

// ── File list (flat mode) ────────────────────────────────────────────────────
async function populateFileList() {
  const res = await fetch("/files");
  const { files } = await res.json();
  const ul = document.getElementById("file-list-flat");
  ul.innerHTML = "";
  if (!files.length) {
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = "No files";
    ul.appendChild(li);
    return;
  }
  files.sort(naturalSort);
  files.forEach(filePath => {
    const li = document.createElement("li");
    const fileName = filePath.split("/").pop();
    const folder = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
    const nameEl = document.createElement("div");
    nameEl.className = "flat-file-name";
    nameEl.textContent = fileName.replace(/\.md$/, "");
    li.appendChild(nameEl);
    if (folder) {
      const pathEl = document.createElement("div");
      pathEl.className = "flat-file-path";
      pathEl.textContent = folder;
      li.appendChild(pathEl);
    }
    li.addEventListener("click", () => openFile(filePath));
    ul.appendChild(li);
  });
}

// ─��� Outline mode ─────────────────────────────────────────────────────────────
let outlineTimer = null;

function updateOutline() {
  const ol = document.getElementById("outline-list");
  const empty = document.getElementById("outline-empty");
  ol.innerHTML = "";
  const content = getContent();
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim(), offset: match.index });
  }
  if (!headings.length) {
    ol.style.display = "none";
    empty.style.display = "";
    return;
  }
  ol.style.display = "";
  empty.style.display = "none";
  headings.forEach(h => {
    const li = document.createElement("li");
    li.className = `outline-h${h.level}`;
    li.textContent = h.text;
    li.title = h.text;
    li.addEventListener("click", () => {
      const line = view.state.doc.lineAt(h.offset);
      view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
      view.focus();
      ol.querySelectorAll("li").forEach(el => el.classList.remove("outline-active"));
      li.classList.add("outline-active");
    });
    ol.appendChild(li);
  });
}

// ── File tree loading ────────────────────────────────────────────────────────
async function loadFileList() {
  const res = await fetch("/files");
  const { files, folders } = await res.json();
  const ul = document.getElementById("file-list");
  ul.innerHTML = "";
  const tree = buildTree(folders, files);
  renderTree(tree, ul);
}

function buildTree(folders, files) {
  const tree = { children: {}, files: [] };
  folders.forEach(folderPath => {
    const parts = folderPath.replace(/\/$/, "").split("/");
    let current = tree;
    parts.forEach((part, index) => {
      if (!current.children[part]) {
        current.children[part] = { children: {}, files: [], path: parts.slice(0, index + 1).join("/") };
      }
      current = current.children[part];
    });
  });
  files.forEach(file => {
    const filePath = typeof file === 'string' ? file : file.path;
    const preview = typeof file === 'object' ? file.preview : '';
    const parts = filePath.split("/");
    const fileName = parts.pop();
    let current = tree;
    parts.forEach(part => {
      if (!current.children[part]) current.children[part] = { children: {}, files: [], path: part };
      current = current.children[part];
    });
    current.files.push({ name: fileName, path: filePath, preview: preview });
  });
  return tree;
}

function naturalSort(a, b) {
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, n, s) => ax.push([n || 0, s || '']));
  b.replace(/(\d+)|(\D+)/g, (_, n, s) => bx.push([n || 0, s || '']));
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }
  return ax.length - bx.length;
}

function renderTree(node, container) {
  Object.keys(node.children).sort(naturalSort).forEach(folderName => {
    const folderNode = node.children[folderName];
    const folderPath = folderNode.path || folderName;
    const isExpanded = expandedFolders.has(folderPath);

    const li = document.createElement("li");
    li.className = "tree-folder";
    li.dataset.folderPath = folderPath;

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

    header.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      contextMenuTarget = folderPath;
      contextMenuIsFolder = true;
      showContextMenu(e.clientX, e.clientY, "folder");
    });

    header.addEventListener("dragover", (e) => {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      header.classList.add("drag-over");
    });
    header.addEventListener("dragleave", (e) => {
      if (!header.contains(e.relatedTarget)) header.classList.remove("drag-over");
    });
    header.addEventListener("drop", async (e) => {
      e.preventDefault(); e.stopPropagation();
      header.classList.remove("drag-over");
      const src = e.dataTransfer.getData("text/plain");
      if (src) {
        const fileName = src.split("/").pop();
        const dst = `${folderPath}/${fileName}`;
        if (src !== dst) await moveFile(src, dst);
      }
    });

    container.appendChild(li);

    if (isExpanded) {
      const childUl = document.createElement("ul");
      childUl.className = "tree-children";
      li.appendChild(childUl);
      renderTree(folderNode, childUl);
    }
  });

  node.files.sort((a, b) => naturalSort(a.name, b.name)).forEach(file => {
    const li = document.createElement("li");
    li.className = "tree-file";
    if (file.path === currentFile) li.classList.add("active-file");
    li.dataset.filePath = file.path;
    li.draggable = true;

    const fileContent = document.createElement("div");
    fileContent.className = "file-content";
    
    const span = document.createElement("span");
    span.className = "file-name";
    span.textContent = file.name;
    fileContent.appendChild(span);
    
    if (file.preview) {
      const preview = document.createElement("div");
      preview.className = "file-preview";
      preview.textContent = file.preview;
      fileContent.appendChild(preview);
    }
    
    li.appendChild(fileContent);

    li.addEventListener("click", () => openFile(file.path));
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", file.path);
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      contextMenuTarget = file.path;
      contextMenuIsFolder = false;
      showContextMenu(e.clientX, e.clientY, "file");
    });

    container.appendChild(li);
  });
}

function toggleFolderExpand(folderPath) {
  if (expandedFolders.has(folderPath)) expandedFolders.delete(folderPath);
  else expandedFolders.add(folderPath);
  saveExpandedFolders();
  loadFileList();
}

function revealInSidebar(filePath) {
  const parts = filePath.split("/");
  parts.pop();
  if (!parts.length) return;
  let accumulated = "";
  let needsRefresh = false;
  parts.forEach(part => {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    if (!expandedFolders.has(accumulated)) {
      expandedFolders.add(accumulated);
      needsRefresh = true;
    }
  });
  if (needsRefresh) { saveExpandedFolders(); loadFileList(); }
  setTimeout(() => {
    const fileEl = document.querySelector(`[data-file-path="${filePath}"]`);
    if (fileEl) {
      fileEl.classList.add("highlighted");
      fileEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => fileEl.classList.remove("highlighted"), 2000);
    }
  }, 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════
async function openFile(name) {
  const res = await fetch(`/files/${encodeURIComponent(name)}`);
  if (!res.ok) { setStatus("Could not open file", true); return; }
  const { content } = await res.json();
  currentFile = name;
  document.getElementById("filename-input").value = name;
  setContent(content);
  const displayPath = workspaceName ? `${workspaceName}/${name}` : name;
  setStatus(`Opened ${displayPath}`);
  revealInSidebar(name);
  // Mark active in tree
  document.querySelectorAll("li.tree-file").forEach(el => {
    el.classList.toggle("active-file", el.dataset.filePath === currentFile);
  });
}

async function saveFile(silent = false) {
  const name = document.getElementById("filename-input").value.trim() || "untitled.md";
  let newFileName = name.endsWith(".md") ? name : name + ".md";
  if (!newFileName.includes("/") && currentFile.includes("/")) {
    const folder = currentFile.substring(0, currentFile.lastIndexOf("/"));
    newFileName = `${folder}/${newFileName}`;
  } else if (currentFolder && !newFileName.includes("/")) {
    newFileName = `${currentFolder}/${newFileName}`;
  }
  if (currentFile !== newFileName && currentFile !== "untitled.md" && !currentFile.includes("/untitled.md")) {
    await fetch(`/files/${encodeURIComponent(currentFile)}`, { method: "DELETE" });
  }
  currentFile = newFileName;
  document.getElementById("filename-input").value = newFileName.split("/").pop();
  const res = await fetch(`/files/${encodeURIComponent(currentFile)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: getContent() }),
  });
  if (res.ok) {
    isDirty = false;
    updateDirtyBadge();
    if (!silent) {
      const displayPath = workspaceName ? `${workspaceName}/${currentFile}` : currentFile;
      setStatus(`Saved ${displayPath}`);
    }
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

async function moveFile(sourcePath, newPath) {
  try {
    const res = await fetch(`/files/${encodeURIComponent(sourcePath)}`);
    if (!res.ok) { setStatus("Failed to move file", true); return; }
    const { content } = await res.json();
    const saveRes = await fetch(`/files/${encodeURIComponent(newPath)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!saveRes.ok) { setStatus("Failed to move file", true); return; }
    await fetch(`/files/${encodeURIComponent(sourcePath)}`, { method: "DELETE" });
    if (currentFile === sourcePath) {
      currentFile = newPath;
      document.getElementById("filename-input").value = newPath.split("/").pop();
    }
    loadFileList();
    setStatus(`Moved to ${newPath}`);
  } catch (e) { setStatus("Failed to move file", true); }
}

// ── New file button ──────────────────────────────────────────────────────────
document.getElementById("btn-new").addEventListener("click", async () => {
  closeAllMenus();
  
  // Use native file dialog in Electron (like Typora)
  if (window.electronAPI?.createNewFileDialog) {
    const folder = currentFolder || workspacePath || "";
    const defaultPath = folder ? `${folder}/untitled.md` : "untitled.md";
    const filePath = await window.electronAPI.createNewFileDialog(defaultPath);
    
    if (filePath) {
      // Create empty file on disk
      const r = await fetch(`/files/${encodeURIComponent(filePath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" })
      });
      
      if (r.ok) {
        currentFile = filePath;
        const fileName = filePath.split("/").pop();
        document.getElementById("filename-input").value = fileName;
        setContent("");
        await loadFileList();
        setStatus(`Created ${fileName}`);
      } else {
        setStatus("Failed to create file", true);
      }
    }
    return;
  }
  
  // Fallback for web mode
  const folder = currentFolder || "";
  let counter = 1;
  let fileName = "untitled.md";
  let fullPath = folder ? `${folder}/${fileName}` : fileName;
  
  const res = await fetch("/files");
  const { files } = await res.json();
  while (files.includes(fullPath)) {
    fileName = `untitled-${counter}.md`;
    fullPath = folder ? `${folder}/${fileName}` : fileName;
    counter++;
  }
  
  const r = await fetch(`/files/${encodeURIComponent(fullPath)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "" })
  });
  
  if (r.ok) {
    currentFile = fullPath;
    document.getElementById("filename-input").value = fileName;
    setContent("");
    await loadFileList();
    setStatus(`Created ${fileName}`);
    setTimeout(() => {
      const input = document.getElementById("filename-input");
      input.select();
    }, 100);
  } else {
    setStatus("Failed to create file", true);
  }
});

document.getElementById("btn-save")?.addEventListener("click", () => { closeAllMenus(); saveFile(); });

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════���═══════════════════════════════════════════════════════
const contextMenu = document.getElementById("context-menu");
let contextMenuTarget = null;
let contextMenuIsFolder = false;

function handleSidebarContextMenu(e) {
  e.preventDefault();
  const li = e.target.closest("li");
  if (li) {
    contextMenuIsFolder = li.classList.contains("tree-folder");
    contextMenuTarget = contextMenuIsFolder ? li.dataset.folderPath : li.dataset.filePath;
    showContextMenu(e.clientX, e.clientY, contextMenuIsFolder ? "folder" : "file");
  } else {
    contextMenuTarget = null;
    contextMenuIsFolder = false;
    showContextMenu(e.clientX, e.clientY, "empty");
  }
}
document.getElementById("file-list").addEventListener("contextmenu", handleSidebarContextMenu);
document.querySelector('.sidebar-content[data-for="tree"]').addEventListener("contextmenu", (e) => {
  if (e.target.closest("#file-list")) return; // already handled by file-list listener
  handleSidebarContextMenu(e);
});

function showContextMenu(x, y, context) {
  const menuEmpty = document.getElementById("menu-empty");
  const menuFile = document.getElementById("menu-file");
  const menuFolder = document.getElementById("menu-folder");
  menuEmpty.style.display = "none";
  menuFile.style.display = "none";
  if (menuFolder) menuFolder.style.display = "none";
  if (context === "empty") menuEmpty.style.display = "block";
  else if (context === "folder" && menuFolder) menuFolder.style.display = "block";
  else menuFile.style.display = "block";
  contextMenu.classList.remove("hidden");
  const rect = contextMenu.getBoundingClientRect();
  let posX = x, posY = y;
  if (x + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 10;
  if (y + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 10;
  contextMenu.style.left = `${posX}px`;
  contextMenu.style.top = `${posY}px`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#context-menu")) contextMenu.classList.add("hidden");
});

contextMenu.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  contextMenu.classList.add("hidden");
  const target = contextMenuTarget;
  const isFolder = contextMenuIsFolder;

  async function createFolder(parentPath, suggestedName = "New Folder") {
    // Use native folder dialog in Electron
    if (window.electronAPI?.createNewFolderDialog) {
      // Build the default path: if parentPath is relative, prepend workspace
      let defaultPath = parentPath || "";
      if (defaultPath && workspacePath && !defaultPath.startsWith("/")) {
        defaultPath = workspacePath + "/" + defaultPath;
      } else if (!defaultPath) {
        defaultPath = workspacePath || "";
      }
      const folderPath = await window.electronAPI.createNewFolderDialog(defaultPath);

      if (folderPath) {
        // Convert absolute path to relative path within workspace
        let relativePath = folderPath;
        if (workspacePath && folderPath.startsWith(workspacePath)) {
          relativePath = folderPath.substring(workspacePath.length).replace(/^\//, "");
        }

        if (!relativePath) {
          setStatus("Folder must be inside the workspace", true);
          return;
        }

        // Tell backend to ensure the folder exists
        const r = await fetch(`/folders/${encodeURIComponent(relativePath)}`, { method: "POST" });
        if (r.ok) {
          const folderName = relativePath.split("/").pop();
          expandedFolders.add(relativePath);
          saveExpandedFolders();
          await loadFileList();
          setStatus(`Created folder "${folderName}"`);
        } else {
          setStatus("Failed to create folder", true);
        }
      }
      return;
    }
    
    // Fallback for web mode
    const name = prompt("Folder name:", suggestedName);
    if (!name) return;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const r = await fetch(`/folders/${encodeURIComponent(fullPath)}`, { method: "POST" });
    if (r.ok) { loadFileList(); setStatus(`Created folder "${name}"`); }
    else setStatus("Failed to create folder", true);
  }

  switch (action) {
    case "new-file":
    case "new-folder-from-file": {
      if (action === "new-folder-from-file") {
        const parent = target ? target.substring(0, target.lastIndexOf("/")) : "";
        await createFolder(parent);
        break;
      }
      
      // Use native file dialog in Electron (like Typora)
      if (window.electronAPI?.createNewFileDialog) {
        const folder = target && isFolder ? target : (target ? target.substring(0, target.lastIndexOf("/")) : "");
        const defaultPath = folder ? `${folder}/untitled.md` : "untitled.md";
        const filePath = await window.electronAPI.createNewFileDialog(defaultPath);
        
        if (filePath) {
          const r = await fetch(`/files/${encodeURIComponent(filePath)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "" })
          });
          
          if (r.ok) {
            currentFile = filePath;
            const fileName = filePath.split("/").pop();
            document.getElementById("filename-input").value = fileName;
            setContent("");
            await loadFileList();
            setStatus(`Created ${fileName}`);
          } else {
            setStatus("Failed to create file", true);
          }
        }
        break;
      }
      
      // Fallback for web mode
      const folder = target && isFolder ? target : (target ? target.substring(0, target.lastIndexOf("/")) : "");
      const res = await fetch("/files");
      const { files } = await res.json();
      let counter = 1;
      let fileName = "untitled.md";
      let fullPath = folder ? `${folder}/${fileName}` : fileName;
      while (files.includes(fullPath)) {
        fileName = `untitled-${counter}.md`;
        fullPath = folder ? `${folder}/${fileName}` : fileName;
        counter++;
      }
      
      const r = await fetch(`/files/${encodeURIComponent(fullPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" })
      });
      
      if (r.ok) {
        currentFile = fullPath;
        document.getElementById("filename-input").value = fileName;
        setContent("");
        await loadFileList();
        setStatus(`Created ${fileName}`);
        setTimeout(() => {
          const input = document.getElementById("filename-input");
          input.select();
        }, 100);
      } else {
        setStatus("Failed to create file", true);
      }
      break;
    }
    case "new-file-in-folder": {
      if (!target) break;
      const folder = target.replace(/\/$/, "");
      
      // Use native file dialog in Electron (like Typora)
      if (window.electronAPI?.createNewFileDialog) {
        const defaultPath = `${folder}/untitled.md`;
        const filePath = await window.electronAPI.createNewFileDialog(defaultPath);
        
        if (filePath) {
          const r = await fetch(`/files/${encodeURIComponent(filePath)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "" })
          });
          
          if (r.ok) {
            currentFile = filePath;
            const fileName = filePath.split("/").pop();
            document.getElementById("filename-input").value = fileName;
            setContent("");
            expandedFolders.add(folder);
            saveExpandedFolders();
            await loadFileList();
            setStatus(`Created ${fileName}`);
          } else {
            setStatus("Failed to create file", true);
          }
        }
        break;
      }
      
      // Fallback for web mode
      const res = await fetch("/files");
      const { files } = await res.json();
      let counter = 1;
      let fileName = "untitled.md";
      let fullPath = `${folder}/${fileName}`;
      while (files.includes(fullPath)) {
        fileName = `untitled-${counter}.md`;
        fullPath = `${folder}/${fileName}`;
        counter++;
      }
      
      const r = await fetch(`/files/${encodeURIComponent(fullPath)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" })
      });
      
      if (r.ok) {
        currentFile = fullPath;
        document.getElementById("filename-input").value = fileName;
        setContent("");
        expandedFolders.add(folder);
        saveExpandedFolders();
        await loadFileList();
        setStatus(`Created ${fileName}`);
        setTimeout(() => {
          const input = document.getElementById("filename-input");
          input.select();
        }, 100);
      } else {
        setStatus("Failed to create file", true);
      }
      break;
    }
    case "new-folder":
    case "new-subfolder": {
      const parent = isFolder && target ? target.replace(/\/$/, "") : "";
      await createFolder(parent);
      break;
    }
    case "open": {
      if (isFolder) { /* expand folder */ toggleFolderExpand(target); }
      else openFile(target);
      break;
    }
    case "rename": {
      if (isFolder) {
        const old = target.replace(/\/$/, "");
        const newLeaf = prompt("Rename folder:", old.split("/").pop());
        if (!newLeaf || newLeaf === old.split("/").pop()) break;
        const parent = old.substring(0, old.lastIndexOf("/"));
        const newFull = parent ? `${parent}/${newLeaf}` : newLeaf;
        const r = await fetch(`/folders/${encodeURIComponent(old)}?new_name=${encodeURIComponent(newFull)}`, { method: "PUT" });
        if (r.ok) { loadFileList(); setStatus(`Renamed to "${newLeaf}"`); }
        else setStatus("Rename failed", true);
      } else {
        const displayName = target.split("/").pop().replace(/\.md$/, "");
        const newLeaf = prompt("Rename note:", displayName);
        if (!newLeaf || newLeaf === displayName) break;
        const r = await fetch(`/files/${encodeURIComponent(target)}`);
        if (!r.ok) break;
        const { content } = await r.json();
        const parent = target.substring(0, target.lastIndexOf("/"));
        const finalName = newLeaf.endsWith(".md") ? newLeaf : newLeaf + ".md";
        const newFull = parent ? `${parent}/${finalName}` : finalName;
        await fetch(`/files/${encodeURIComponent(newFull)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
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
    case "duplicate": {
      if (!target) break;
      const r = await fetch(`/files/${encodeURIComponent(target)}`);
      if (!r.ok) break;
      const { content } = await r.json();
      const parent = target.substring(0, target.lastIndexOf("/"));
      const base = target.split("/").pop().replace(/\.md$/, "");
      let copyName, newFull, counter = 0;
      do {
        counter++;
        copyName = counter === 1 ? `${base} copy.md` : `${base} copy ${counter}.md`;
        newFull = parent ? `${parent}/${copyName}` : copyName;
      } while ((await fetch(`/files/${encodeURIComponent(newFull)}`)).ok);
      await fetch(`/files/${encodeURIComponent(newFull)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }),
      });
      loadFileList();
      setStatus(`Duplicated as "${copyName}"`);
      break;
    }
    case "move": {
      if (!target || isFolder) break;
      const dest = prompt("Move to folder (blank for root):", "");
      if (dest === null) break;
      const fileName = target.split("/").pop();
      const newPath = dest.trim() ? `${dest.trim()}/${fileName}` : fileName;
      if (target !== newPath) await moveFile(target, newPath);
      break;
    }
    case "copy-path": {
      if (!target) break;
      try { await navigator.clipboard.writeText(`notes/${target}`); setStatus("Path copied"); }
      catch { prompt("Copy path:", `notes/${target}`); }
      break;
    }
    case "reveal": {
      if (!target) break;
      await fetch(`/reveal/${encodeURIComponent(target)}`, { method: "POST" });
      setStatus("Opened in file manager");
      break;
    }
    case "refresh": {
      loadFileList();
      break;
    }
    case "delete": {
      if (isFolder) {
        const leaf = target.replace(/\/$/, "").split("/").pop();
        if (!confirm(`Delete folder "${leaf}" and all contents?`)) break;
        const r = await fetch(`/files/${encodeURIComponent(target)}`, { method: "DELETE" });
        if (r.ok) { loadFileList(); setStatus(`Deleted "${leaf}"`); }
      } else {
        const leaf = target.split("/").pop();
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

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════════
let searchDebounce = null;
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }
  searchDebounce = setTimeout(async () => {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const { results } = await res.json();
    searchResults.innerHTML = "";
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
      });
      searchResults.appendChild(li);
    });
  }, 250);
});

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
document.getElementById("btn-import")?.addEventListener("click", () => { closeAllMenus(); document.getElementById("file-input").click(); });
document.getElementById("btn-open-file")?.addEventListener("click", () => { closeAllMenus(); document.getElementById("file-input").click(); });

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

document.getElementById("image-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/upload/image", { method: "POST", body: form });
  if (!res.ok) { setStatus("Image upload failed", true); return; }
  const { url } = await res.json();
  insertBlock(`![${file.name.replace(/\.[^.]+$/, "")}](${url})`);
  setStatus(`Image inserted`);
  e.target.value = "";
});

document.getElementById("btn-dl-md")?.addEventListener("click", async () => {
  closeAllMenus();
  await saveFile(true);
  const a = document.createElement("a");
  a.href = `/download/md/${encodeURIComponent(currentFile)}`;
  a.download = currentFile;
  a.click();
});

document.getElementById("btn-export-html")?.addEventListener("click", async () => {
  closeAllMenus();
  const html = document.getElementById("preview").innerHTML;
  const res = await fetch(`/export/html/${encodeURIComponent(currentFile)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html }),
  });
  if (!res.ok) { setStatus("HTML export failed", true); return; }
  downloadBlob(await res.blob(), currentFile.replace(/\.md$/, ".html"));
});

document.getElementById("btn-export-pdf")?.addEventListener("click", async () => {
  closeAllMenus();
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

document.getElementById("btn-print")?.addEventListener("click", () => { closeAllMenus(); printPreview(); });

function printPreview() {
  const html = document.getElementById("preview").innerHTML;
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;line-height:1.6}pre{background:#f4f4f4;padding:1rem;border-radius:4px}code{background:#f4f4f4;padding:.2em .4em;border-radius:3px}blockquote{border-left:4px solid #ccc;margin:0;padding-left:1rem;color:#555}img{max-width:100%}</style></head><body>${html}</body></html>`);
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

document.getElementById("btn-save-as")?.addEventListener("click", () => { closeAllMenus(); saveAs(); });

// ═══════════════════════════════════════════════════════════════════════════════
// TABLE MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function buildTableGrid(rows, cols) {
  const grid = document.getElementById("table-grid");
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
  buildTableGrid(parseInt(document.getElementById("tbl-rows").value) || 3, parseInt(document.getElementById("tbl-cols").value) || 3);
}

["tbl-rows", "tbl-cols"].forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    buildTableGrid(parseInt(document.getElementById("tbl-rows").value) || 1, parseInt(document.getElementById("tbl-cols").value) || 1);
  });
});

document.getElementById("btn-cancel-table").addEventListener("click", () => document.getElementById("table-overlay").classList.add("hidden"));

document.getElementById("btn-insert-table").addEventListener("click", () => {
  const rows = Math.max(1, parseInt(document.getElementById("tbl-rows").value) || 3);
  const cols = Math.max(1, parseInt(document.getElementById("tbl-cols").value) || 3);
  const colWidth = 15;
  const pad = (text) => text.padEnd(colWidth, " ");
  const header = "| " + Array(cols).fill("Header").map((h, i) => pad(`${h} ${i + 1}`)).join(" | ") + " |";
  const sep = "| " + Array(cols).fill("-".repeat(colWidth)).join(" | ") + " |";
  const row = "| " + Array(cols).fill(pad("Cell")).join(" | ") + " |";
  const dataRows = Array(rows - 1).fill(row);
  insertSnippet([header, sep, ...dataRows].join("\n"));
  document.getElementById("table-overlay").classList.add("hidden");
});

document.getElementById("table-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("table-overlay")) document.getElementById("table-overlay").classList.add("hidden");
});

// ═══════════════════════════════════════════════════════════════════════════════
// DIAGRAM MODAL
// ═══════════════════════════════════════════════════════════════════════════════
const DIAGRAM_SNIPPETS = {
  "econ-supply-demand": "```econ\nsupply-demand\n```",
  "econ-ppf": "```econ\nppf\n```",
  "econ-cost": "```econ\ncost\n```",
  "econ-custom": "```econ\ntitle: My Graph\nxlabel: Quantity\nylabel: Price\nxmax: 10\nymax: 10\ncurve: Demand, [(0,9),(5,5),(10,1)], solid, #3b82f6\ncurve: Supply, [(0,1),(5,5),(10,9)], solid, #ef4444\npoint: Equilibrium, (5,5)\n```",
  flowchart: "```mermaid\nflowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Do something]\n    B -->|No| D[Something else]\n    C --> E[End]\n    D --> E\n```",
  sequence: "```mermaid\nsequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello!\n    B-->>A: Hi!\n```",
  gantt: "```mermaid\ngantt\n    title Plan\n    dateFormat YYYY-MM-DD\n    section Phase 1\n    Task A :a1, 2024-01-01, 7d\n    Task B :after a1, 5d\n```",
  pie: "```mermaid\npie title Distribution\n    \"A\" : 40\n    \"B\" : 35\n    \"C\" : 25\n```",
  er: "```mermaid\nerDiagram\n    STUDENT ||--o{ ENROLLMENT : enrolls\n    COURSE ||--o{ ENROLLMENT : includes\n```",
  mindmap: "```mermaid\nmindmap\n  root((Topic))\n    Branch 1\n      Detail\n    Branch 2\n```",
};

function openDiagramModal() {
  document.getElementById("diagram-overlay").classList.remove("hidden");
}

document.getElementById("diagram-overlay").querySelectorAll(".diagram-type").forEach(btn => {
  btn.addEventListener("click", () => {
    insertSnippet(DIAGRAM_SNIPPETS[btn.dataset.type] || "");
    document.getElementById("diagram-overlay").classList.add("hidden");
  });
});

document.getElementById("btn-cancel-diagram").addEventListener("click", () => document.getElementById("diagram-overlay").classList.add("hidden"));
document.getElementById("diagram-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("diagram-overlay")) document.getElementById("diagram-overlay").classList.add("hidden");
});

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH CANVAS
// ═══════════════════════════════════════════════════════════════════════════════
let graphCanvasInstance = null;
let graphEditInfo = null;

function openGraphCanvas(existingData = null, editOffset = null, editLength = null) {
  const overlay = document.getElementById("graph-overlay");
  overlay.classList.remove("hidden");
  const svgEl = document.getElementById("graph-svg");
  svgEl.innerHTML = "";
  graphCanvasInstance = new GraphCanvas(svgEl);
  graphEditInfo = editOffset !== null ? { offset: editOffset, length: editLength } : null;
  if (existingData) graphCanvasInstance.fromJSON(existingData);
  document.getElementById("gc-title").value = graphCanvasInstance.title || "";
  document.getElementById("gc-x-label").value = graphCanvasInstance.xLabel || "";
  document.getElementById("gc-y-label").value = graphCanvasInstance.yLabel || "";
  document.querySelectorAll("#graph-toolbar .gc-tool").forEach(b => {
    b.classList.toggle("active", b.dataset.tool === graphCanvasInstance.tool);
  });
}

function closeGraphCanvas() {
  document.getElementById("graph-overlay").classList.add("hidden");
  graphCanvasInstance = null;
  graphEditInfo = null;
}

document.querySelectorAll("#graph-toolbar .gc-tool").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!graphCanvasInstance) return;
    graphCanvasInstance.tool = btn.dataset.tool;
    document.querySelectorAll("#graph-toolbar .gc-tool").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

document.getElementById("gc-grid").addEventListener("change", e => { if (graphCanvasInstance) { graphCanvasInstance.showGrid = e.target.checked; graphCanvasInstance.render(); } });
document.getElementById("gc-snap").addEventListener("change", e => { if (graphCanvasInstance) graphCanvasInstance.snapToGrid = e.target.checked; });
document.getElementById("gc-color").addEventListener("input", e => { if (graphCanvasInstance) graphCanvasInstance.strokeColor = e.target.value; });
document.getElementById("gc-width").addEventListener("change", e => { if (graphCanvasInstance) graphCanvasInstance.strokeWidth = parseFloat(e.target.value); });
document.getElementById("gc-title").addEventListener("input", e => { if (graphCanvasInstance) { graphCanvasInstance.title = e.target.value; graphCanvasInstance.render(); } });
document.getElementById("gc-x-label").addEventListener("input", e => { if (graphCanvasInstance) { graphCanvasInstance.xLabel = e.target.value; graphCanvasInstance.render(); } });
document.getElementById("gc-y-label").addEventListener("input", e => { if (graphCanvasInstance) { graphCanvasInstance.yLabel = e.target.value; graphCanvasInstance.render(); } });
document.getElementById("gc-undo").addEventListener("click", () => graphCanvasInstance?.undo());
document.getElementById("gc-redo").addEventListener("click", () => graphCanvasInstance?.redo());
document.getElementById("gc-delete").addEventListener("click", () => graphCanvasInstance?.deleteSelected());
document.getElementById("gc-clear").addEventListener("click", () => { if (graphCanvasInstance && confirm("Clear all?")) graphCanvasInstance.clear(); });

document.getElementById("graph-overlay").addEventListener("keydown", e => {
  if (!graphCanvasInstance) return;
  const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
  if (e.key === "Escape") {
    if (inInput) { e.target.blur(); e.preventDefault(); return; }
    if (graphCanvasInstance._curvePoints?.length > 0) graphCanvasInstance.cancelCurve();
    else closeGraphCanvas();
    e.preventDefault();
    return;
  }
  if (inInput) return;
  if (e.key === "Delete" || e.key === "Backspace") { graphCanvasInstance.deleteSelected(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "z") { graphCanvasInstance.undo(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "y") { graphCanvasInstance.redo(); e.preventDefault(); }
  const step = e.shiftKey ? graphCanvasInstance.gridSize : (graphCanvasInstance.snapToGrid ? graphCanvasInstance.gridSize : 5);
  if (e.key === "ArrowLeft") { graphCanvasInstance.nudge(-step, 0); e.preventDefault(); }
  if (e.key === "ArrowRight") { graphCanvasInstance.nudge(step, 0); e.preventDefault(); }
  if (e.key === "ArrowUp") { graphCanvasInstance.nudge(0, -step); e.preventDefault(); }
  if (e.key === "ArrowDown") { graphCanvasInstance.nudge(0, step); e.preventDefault(); }
  if (e.ctrlKey && e.key === "c") { graphCanvasInstance.copySelected(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "v") { graphCanvasInstance.paste(); e.preventDefault(); }
  if (e.ctrlKey && e.key === "d") { graphCanvasInstance.duplicateSelected(); e.preventDefault(); }
});

document.getElementById("gc-cancel").addEventListener("click", closeGraphCanvas);
document.getElementById("graph-overlay").addEventListener("click", e => { if (e.target === document.getElementById("graph-overlay")) closeGraphCanvas(); });

document.getElementById("gc-save").addEventListener("click", () => {
  if (!graphCanvasInstance) return;
  const json = graphCanvasInstance.toJSON();
  const mdSnippet = "```graph\n" + JSON.stringify(json) + "\n```";
  if (graphEditInfo) {
    view.dispatch({ changes: { from: graphEditInfo.offset, to: graphEditInfo.offset + graphEditInfo.length, insert: mdSnippet } });
  } else {
    insertSnippet(mdSnippet);
  }
  closeGraphCanvas();
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDITOR CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════════
const editorCtxMenu = document.getElementById("editor-ctx-menu");

document.getElementById("cm-editor").addEventListener("contextmenu", e => {
  e.preventDefault();
  editorCtxMenu.classList.remove("hidden");
  let x = e.clientX, y = e.clientY;
  editorCtxMenu.style.left = "-9999px";
  editorCtxMenu.style.top = "-9999px";
  const rect = editorCtxMenu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  editorCtxMenu.style.left = `${x}px`;
  editorCtxMenu.style.top = `${y}px`;
});

document.addEventListener("click", e => {
  if (!e.target.closest("#editor-ctx-menu")) editorCtxMenu.classList.add("hidden");
});

editorCtxMenu.addEventListener("click", e => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  editorCtxMenu.classList.add("hidden");
  if (ACTIONS[btn.dataset.action]) ACTIONS[btn.dataset.action]();
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLISH
// ═══════════════════════════════════════════════════════════════════════════════
document.getElementById("btn-publish")?.addEventListener("click", () => {
  closeAllMenus();
  document.getElementById("publish-overlay").classList.remove("hidden");
});
document.getElementById("btn-cancel-publish")?.addEventListener("click", () => document.getElementById("publish-overlay").classList.add("hidden"));
document.getElementById("btn-confirm-publish")?.addEventListener("click", async () => {
  document.getElementById("publish-overlay").classList.add("hidden");
  setStatus("Publishing…");
  const res = await fetch("/publish", { method: "POST" });
  const data = await res.json();
  if (res.ok) {
    let msg = `Published ${data.published} notes`;
    if (data.results?.github) msg += ` • GitHub: ${data.results.github}`;
    if (data.results?.dropbox) msg += ` • Dropbox: ${data.results.dropbox}`;
    if (data.results?.gdrive) msg += ` • Drive: ${data.results.gdrive}`;
    setStatus(msg);
  } else {
    setStatus(data.detail || "Publish failed", true);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
async function openSettings() {
  closeAllMenus();
  const res = await fetch("/config");
  const cfg = await res.json();
  document.getElementById("cfg-repo-url").value = cfg?.github?.repo_url || "";
  document.getElementById("cfg-branch").value = cfg?.github?.branch || "main";

  const ghRes = await fetch("/github/status");
  const ghData = await ghRes.json();
  const ghStatus = document.getElementById("github-status");
  ghStatus.textContent = ghData.connected ? "✅ Connected" : "Not connected";
  ghStatus.style.color = ghData.connected ? "var(--accent-2)" : "";

  const dbRes = await fetch("/dropbox/status");
  const dbData = await dbRes.json();
  const dbStatus = document.getElementById("dropbox-status");
  dbStatus.textContent = dbData.connected ? "✅ Connected" : "Not connected";
  dbStatus.style.color = dbData.connected ? "var(--accent-2)" : "";

  const gdRes = await fetch("/gdrive/status");
  const gdData = await gdRes.json();
  const gdStatus = document.getElementById("gdrive-status");
  gdStatus.textContent = gdData.connected ? "✅ Connected" : "Not connected";
  gdStatus.style.color = gdData.connected ? "var(--accent-2)" : "";

  document.getElementById("modal-overlay").classList.remove("hidden");
}

document.getElementById("btn-settings")?.addEventListener("click", () => openSettings());
document.getElementById("btn-close-modal")?.addEventListener("click", () => document.getElementById("modal-overlay").classList.add("hidden"));

document.getElementById("btn-save-config")?.addEventListener("click", async () => {
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
  if (res.ok) { setStatus("Settings saved"); document.getElementById("modal-overlay").classList.add("hidden"); }
  else setStatus("Failed to save settings", true);
});

document.getElementById("btn-github-login")?.addEventListener("click", () => window.open("/github/auth", "_blank", "width=600,height=700"));
document.getElementById("btn-dropbox-login")?.addEventListener("click", () => window.open("/dropbox/auth", "_blank", "width=600,height=700"));
document.getElementById("btn-gdrive-login")?.addEventListener("click", () => window.open("/gdrive/auth", "_blank", "width=600,height=700"));

document.getElementById("modal-overlay")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); });
document.getElementById("publish-overlay")?.addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden"); });

// ═══════════════════════════════════════════════════════════════════════════════
// PREVIEW TOGGLE
// ═══════════════════════════════════════════════════════════════════════════════
const previewPane = document.getElementById("preview-pane");
let previewVisible = true;

function togglePreview() {
  previewVisible = !previewVisible;
  previewPane.classList.toggle("hidden-pane", !previewVisible);
}

document.getElementById("btn-toggle-preview")?.addEventListener("click", () => { closeAllMenus(); togglePreview(); });
document.getElementById("btn-toggle-source")?.addEventListener("click", () => { closeAllMenus(); togglePreview(); });

// ═══════════════════════════════════════════════════════════════════════════════
// FOCUS MODE
// ═══════════════════════════════════════════════════════════════════════════════
let focusModeActive = false;

function toggleFocusMode() {
  focusModeActive = !focusModeActive;
  document.body.classList.toggle("focus-mode", focusModeActive);
  if (focusModeActive) localStorage.setItem("sc-focus-mode", "true");
  else localStorage.removeItem("sc-focus-mode");
}

document.getElementById("btn-focus")?.addEventListener("click", () => { closeAllMenus(); toggleFocusMode(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleFocusMode();
  }
});

// Click exit focus pseudo-element
document.addEventListener("click", (e) => {
  if (document.body.classList.contains("focus-mode") && e.clientX > window.innerWidth - 130 && e.clientY < 40) {
    toggleFocusMode();
  }
});

if (localStorage.getItem("sc-focus-mode") === "true") toggleFocusMode();

// ═══════════════════════════════════════════════════════════════════════════════
// TYPEWRITER MODE
// ═══════════════════════════════════════════════════════════════════════════════
let typewriterMode = localStorage.getItem("sc-typewriter") === "true";

function toggleTypewriter() {
  typewriterMode = !typewriterMode;
  document.body.classList.toggle("typewriter-mode", typewriterMode);
  localStorage.setItem("sc-typewriter", String(typewriterMode));
  setStatus(typewriterMode ? "Typewriter mode on" : "Typewriter mode off");
}

document.getElementById("btn-typewriter")?.addEventListener("click", () => { closeAllMenus(); toggleTypewriter(); });
if (typewriterMode) document.body.classList.add("typewriter-mode");

// ═══════════════════════════════════════════════════════════════════════════════
// HELP PANEL
// ═══════════════════════════════════════════════════════════════════════════════
const helpPanel = document.getElementById("help-panel");

function toggleHelp() {
  helpPanel.classList.toggle("open");
}

document.getElementById("btn-help")?.addEventListener("click", () => { closeAllMenus(); toggleHelp(); });
document.getElementById("btn-close-help")?.addEventListener("click", () => helpPanel.classList.remove("open"));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && helpPanel.classList.contains("open")) helpPanel.classList.remove("open");
});

// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR RESIZE
// ═══════════════════════════════════════════════════════════════════════════════
const resizeHandle = document.getElementById("sidebar-resize-handle");
let isResizing = false;

resizeHandle?.addEventListener("mousedown", (e) => {
  isResizing = true;
  resizeHandle.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (!isResizing) return;
  const sidebar = document.getElementById("sidebar");
  const newWidth = Math.min(Math.max(e.clientX, 160), 500);
  sidebar.style.width = newWidth + "px";
});

document.addEventListener("mouseup", () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle?.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════
const HISTORY_KEY = "sc-editor-history";
let historySaveTimer = null;

function saveEditorHistory() {
  try {
    const content = getContent();
    if (content.trim()) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ content, file: currentFile, timestamp: Date.now() }));
    }
  } catch (e) {}
}

function restoreEditorHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      const h = JSON.parse(saved);
      if (h.content && (h.file === currentFile || currentFile === "untitled.md")) {
        setContent(h.content);
        if (h.file && h.file !== "untitled.md") {
          currentFile = h.file;
          document.getElementById("filename-input").value = currentFile.split("/").pop();
        }
        setStatus("Restored previous session");
      }
    }
  } catch (e) {}
}

function scheduleHistorySave() {
  clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(saveEditorHistory, 5000);
}

window.addEventListener("beforeunload", (e) => {
  saveEditorHistory();
  if (isDirty) { e.preventDefault(); e.returnValue = ""; }
});

setTimeout(restoreEditorHistory, 100);

// ═══════════════════════════════════════════════════════════════════════════════
// CLOUD BROWSER
// ═══════════════════════════════════════════════════════════════════════════════
async function openCloudBrowser(provider) {
  const section = document.getElementById("cloud-section");
  const label = document.getElementById("cloud-label");
  const list = document.getElementById("cloud-file-list");
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
    li.textContent = err.detail || "Error";
    list.appendChild(li);
    return;
  }
  const { files } = await res.json();
  if (!files.length) {
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = "No .md files";
    list.appendChild(li);
    return;
  }
  files.forEach(name => {
    const openUrl = provider === "dropbox" ? `/dropbox/open/${encodeURIComponent(name)}` : `/gdrive/open/${encodeURIComponent(name)}`;
    const li = document.createElement("li");
    li.textContent = name;
    li.style.cursor = "pointer";
    li.style.padding = "6px 12px";
    li.addEventListener("click", async () => {
      const r = await fetch(openUrl);
      if (!r.ok) { setStatus("Failed to open", true); return; }
      const { content } = await r.json();
      setContent(content);
      document.getElementById("filename-input").value = name;
      currentFile = name;
      setStatus(`Opened ${name} from ${label.textContent}`);
    });
    list.appendChild(li);
  });
}

document.getElementById("btn-close-cloud")?.addEventListener("click", () => document.getElementById("cloud-section").classList.add("hidden"));

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-SAVE / AUTO-PUBLISH
// ═══════════════════════════════════════════════════════════════════════════════
setInterval(() => {
  if (isDirty && currentFile !== "untitled.md") {
    saveFile(true);
  }
}, 60000);

setInterval(async () => {
  if (!navigator.onLine) return;
  try { await fetch("/publish", { method: "POST" }); } catch (e) {}
}, 600000);

// ═══════════════════════════════════════════════════════════════════════════════
// ELECTRON
// ═══════════════════════════════════════════════════════════════════════════════
const isElectron = navigator.userAgent.toLowerCase().includes("electron");
if (isElectron) {
  const quitBtn = document.getElementById("btn-quit");
  if (quitBtn) {
    quitBtn.style.display = "";
    quitBtn.addEventListener("click", () => {
      if (isDirty && !confirm("Unsaved changes. Quit anyway?")) return;
      window.close();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "q") {
      e.preventDefault();
      if (isDirty && !confirm("Unsaved changes. Quit anyway?")) return;
      window.close();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE / OPEN FOLDER
// ═══════════════════════════════════════════════════════════════════════════════
let workspacePath = "";
let workspaceName = "";

async function loadWorkspace() {
  try {
    const res = await fetch("/workspace");
    const data = await res.json();
    workspacePath = data.path;
    workspaceName = data.name;
    const el = document.getElementById("workspace-name");
    if (el) {
      el.textContent = workspaceName;
      el.title = workspacePath;
    }
  } catch {}
}

async function setWorkspace(folderPath) {
  const res = await fetch("/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: folderPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setStatus(err.detail || "Failed to open folder", true);
    return false;
  }
  const data = await res.json();
  workspacePath = data.path;
  workspaceName = data.name;
  const el = document.getElementById("workspace-name");
  if (el) {
    el.textContent = workspaceName;
    el.title = workspacePath;
  }
  // Reset editor state
  currentFile = "untitled.md";
  document.getElementById("filename-input").value = "untitled.md";
  setContent("");
  loadFileList();
  setStatus(`Opened folder: ${workspacePath}`);
  return true;
}

// ── Folder browser dialog ────────────────────────────────────────────────────
let folderBrowserCurrent = "";

async function openFolderDialog() {
  closeAllMenus();
  // In Electron, directly open native OS folder picker
  if (window.electronAPI?.openFolderDialog) {
    const folderPath = await window.electronAPI.openFolderDialog(workspacePath || "");
    if (folderPath) setWorkspace(folderPath);
    return;
  }
  // Fallback: custom HTML folder browser for web mode
  document.getElementById("folder-dialog-overlay").classList.remove("hidden");
  document.getElementById("folder-dialog").classList.remove("hidden");
  browseTo(workspacePath || "");
}

function closeFolderDialog() {
  document.getElementById("folder-dialog-overlay").classList.add("hidden");
  document.getElementById("folder-dialog")?.classList.add("hidden");
}

async function browseTo(dirPath) {
  try {
    const res = await fetch("/workspace/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath || "" }),
    });
    if (!res.ok) return;
    var data = await res.json();
  } catch { return; }
  folderBrowserCurrent = data.current || "";
  document.getElementById("folder-path-input").value = folderBrowserCurrent;
  document.getElementById("folder-selected-path").textContent = folderBrowserCurrent;

  const list = document.getElementById("folder-browser-list");
  list.innerHTML = "";

  (data.dirs || []).forEach(dir => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="folder-icon">📁</span> ${dir.name}`;
    li.addEventListener("click", () => browseTo(dir.path));
    li.addEventListener("dblclick", () => {
      setWorkspace(dir.path);
      closeFolderDialog();
    });
    list.appendChild(li);
  });

  if (!data.dirs || data.dirs.length === 0) {
    const li = document.createElement("li");
    li.style.color = "var(--text-muted)";
    li.style.fontStyle = "italic";
    li.textContent = "No subfolders";
    list.appendChild(li);
  }
}

document.getElementById("btn-open-folder")?.addEventListener("click", openFolderDialog);
document.getElementById("workspace-name")?.addEventListener("click", openFolderDialog);
document.getElementById("folder-dialog-close")?.addEventListener("click", closeFolderDialog);
document.getElementById("folder-dialog-overlay")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeFolderDialog();
});

document.getElementById("folder-up-btn")?.addEventListener("click", () => {
  const input = document.getElementById("folder-path-input").value.trim();
  const parent = input.replace(/\/[^/]*\/?$/, "") || "/";
  browseTo(parent);
});

document.getElementById("folder-go-btn")?.addEventListener("click", () => {
  browseTo(document.getElementById("folder-path-input").value.trim());
});

document.getElementById("folder-path-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") browseTo(e.target.value.trim());
});

document.getElementById("folder-open-btn")?.addEventListener("click", () => {
  setWorkspace(folderBrowserCurrent);
  closeFolderDialog();
});

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
loadWorkspace();
loadFileList();
