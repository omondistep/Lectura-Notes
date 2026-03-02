// ── Graph Canvas — Interactive SVG drawing tool with Office Draw-style editing ──
// No dependencies. Exports a single GraphCanvas class used by editor.js.

export class GraphCanvas {
  constructor(svgEl, opts = {}) {
    this.svg = svgEl;
    this.w = opts.width || 600;
    this.h = opts.height || 450;
    this.svg.setAttribute("viewBox", `0 0 ${this.w} ${this.h}`);
    this.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    this.elements = [];
    this.undoStack = [];
    this.redoStack = [];
    this.nextId = 1;

    this.tool = "line";
    this.strokeColor = "#3b82f6";
    this.strokeWidth = 2.5;
    this.showGrid = true;
    this.snapToGrid = true;
    this.gridSize = 30;
    this.pad = { left: 50, bottom: 45, top: 25, right: 20 };

    this.title = "";
    this.xLabel = "";
    this.yLabel = "";

    // interaction state
    this._drawing = false;
    this._start = null;
    this._freehandPts = [];
    this._selected = null;
    this._dragOffset = null;

    // Endpoint handle dragging: { id, endpoint: "start"|"end"|"p1"|"p2"|"p3"|"p4" }
    this._draggingHandle = null;

    // Curve: multi-point path.  Left-click adds points, right-click finishes.
    this._curvePoints = [];

    // Clipboard for copy/paste
    this._clipboard = null;

    this._bindEvents();
    this.render();
  }

  // ── Grid & Axes ──────────────────────────────────────────────────────────────
  _renderGrid() {
    this.svg.querySelectorAll(".gc-grid, .gc-axis").forEach(e => e.remove());
    const { left, bottom, top, right } = this.pad;

    if (this.showGrid) {
      const g = this._svgG("gc-grid");
      for (let x = left; x <= this.w - right; x += this.gridSize)
        g.appendChild(this._svgEl("line", { x1: x, y1: top, x2: x, y2: this.h - bottom, stroke: "#2a2a2a", "stroke-width": 0.5 }));
      for (let y = top; y <= this.h - bottom; y += this.gridSize)
        g.appendChild(this._svgEl("line", { x1: left, y1: y, x2: this.w - right, y2: y, stroke: "#2a2a2a", "stroke-width": 0.5 }));
      this.svg.prepend(g);
    }

    const ag = this._svgG("gc-axis");
    ag.appendChild(this._svgEl("line", { x1: left, y1: this.h - bottom, x2: this.w - right, y2: this.h - bottom, stroke: "#888", "stroke-width": 1.5 }));
    ag.appendChild(this._svgEl("line", { x1: left, y1: top, x2: left, y2: this.h - bottom, stroke: "#888", "stroke-width": 1.5 }));
    ag.appendChild(this._svgEl("polygon", { points: `${this.w - right},${this.h - bottom} ${this.w - right - 8},${this.h - bottom - 4} ${this.w - right - 8},${this.h - bottom + 4}`, fill: "#888" }));
    ag.appendChild(this._svgEl("polygon", { points: `${left},${top} ${left - 4},${top + 8} ${left + 4},${top + 8}`, fill: "#888" }));

    // Title
    if (this.title) {
      const t = this._svgEl("text", { x: (left + this.w - right) / 2, y: top - 4, fill: "#ccc", "font-size": "15", "text-anchor": "middle", "font-family": "sans-serif", "font-weight": "bold" });
      t.textContent = this.title;
      ag.appendChild(t);
    }
    // X-axis label
    if (this.xLabel) {
      const t = this._svgEl("text", { x: (left + this.w - right) / 2, y: this.h - bottom + 30, fill: "#aaa", "font-size": "12", "text-anchor": "middle", "font-family": "sans-serif" });
      t.textContent = this.xLabel;
      ag.appendChild(t);
    }
    // Y-axis label
    if (this.yLabel) {
      const cx = left - 30, cy = (top + this.h - bottom) / 2;
      const t = this._svgEl("text", { x: cx, y: cy, fill: "#aaa", "font-size": "12", "text-anchor": "middle", "font-family": "sans-serif", transform: `rotate(-90, ${cx}, ${cy})` });
      t.textContent = this.yLabel;
      ag.appendChild(t);
    }

    this.svg.prepend(ag);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  _snap(x, y) {
    if (!this.snapToGrid) return { x, y };
    const gs = this.gridSize;
    return { x: Math.round(x / gs) * gs, y: Math.round(y / gs) * gs };
  }

  _svgPt(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (this.w / r.width), y: (e.clientY - r.top) * (this.h / r.height) };
  }

  _svgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  _svgG(cls) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (cls) g.classList.add(cls);
    return g;
  }

  // ── Undo / Redo ────────────────────────────────────────────────────────────────
  _pushUndo() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.elements)));
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.elements)));
    this.elements = this.undoStack.pop();
    this._selected = null;
    this.render();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.elements)));
    this.elements = this.redoStack.pop();
    this._selected = null;
    this.render();
  }

  deleteSelected() {
    if (this._selected == null) return;
    this._pushUndo();
    this.elements = this.elements.filter(e => e.id !== this._selected);
    this._selected = null;
    this.render();
  }

  _addElement(el) {
    this._pushUndo();
    el.id = this.nextId++;
    this.elements.push(el);
    this.render();
    return el;
  }

  // ── Arrow key nudge for selected element ──────────────────────────────────────
  nudge(dx, dy) {
    if (this._selected == null) return;
    const el = this.elements.find(e => e.id === this._selected);
    if (!el) return;
    this._pushUndo();
    if (el.type === "line" || el.type === "arrow" || el.type === "rect") {
      el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
    } else if (el.type === "curve" || el.type === "freehand") {
      el.points.forEach(p => { p.x += dx; p.y += dy; });
    } else if (el.type === "text") {
      el.x += dx; el.y += dy;
    }
    this.render();
  }

  // ── Copy / Paste ──────────────────────────────────────────────────────────────
  copySelected() {
    if (this._selected == null) return;
    const el = this.elements.find(e => e.id === this._selected);
    if (el) this._clipboard = JSON.parse(JSON.stringify(el));
  }

  paste() {
    if (!this._clipboard) return;
    const el = JSON.parse(JSON.stringify(this._clipboard));
    // Offset the pasted element slightly
    const offset = 20;
    if (el.type === "line" || el.type === "arrow" || el.type === "rect") {
      el.x1 += offset; el.y1 += offset; el.x2 += offset; el.y2 += offset;
    } else if (el.type === "curve" || el.type === "freehand") {
      el.points.forEach(p => { p.x += offset; p.y += offset; });
    } else if (el.type === "text") {
      el.x += offset; el.y += offset;
    }
    const added = this._addElement(el);
    this._selected = added.id;
    this._clipboard = JSON.parse(JSON.stringify(el)); // update clipboard offset
    this.render();
  }

  // ── Duplicate selected ────────────────────────────────────────────────────────
  duplicateSelected() {
    this.copySelected();
    this.paste();
  }

  // ── Edit element properties via prompt ────────────────────────────────────────
  editElement(id) {
    const el = this.elements.find(e => e.id === id);
    if (!el) return;

    if (el.type === "text") {
      const text = prompt("Edit label:", el.text);
      if (text !== null) { this._pushUndo(); el.text = text; this.render(); }
    } else if (el.type === "arrow") {
      const label = prompt("Arrow label:", el.label || "");
      if (label !== null) { this._pushUndo(); el.label = label; this.render(); }
    } else if (el.type === "line" || el.type === "rect" || el.type === "curve" || el.type === "freehand") {
      // Edit color for any shape
      const color = prompt("Stroke color (hex):", el.color);
      if (color !== null && color.trim()) {
        this._pushUndo();
        el.color = color.trim();
        this.render();
      }
    }
  }

  // ── Build smooth SVG path from points array ──────────────────────────────────
  _buildSmoothPath(pts) {
    if (pts.length < 2) return "";
    if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  render() {
    this.svg.querySelectorAll(".gc-el, .gc-temp, .gc-temp-curve").forEach(e => e.remove());
    this._renderGrid();

    for (const el of this.elements) {
      const g = this._renderElement(el);
      if (g) {
        g.classList.add("gc-el");
        g.dataset.id = el.id;
        if (el.id === this._selected) g.classList.add("gc-selected");
        this.svg.appendChild(g);
      }
    }
  }

  // ── Render endpoint handles for selected line/arrow/rect ──────────────────────
  _renderHandles(g, el) {
    const handleR = 5;
    const handleStyle = { r: handleR, fill: "#f59e0b", stroke: "#fff", "stroke-width": 1.5, class: "gc-handle", cursor: "pointer" };

    if (el.type === "line" || el.type === "arrow") {
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: el.x1, cy: el.y1, "data-handle": "start" }));
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: el.x2, cy: el.y2, "data-handle": "end" }));
      // Midpoint handle for moving
      const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
      g.appendChild(this._svgEl("circle", { r: 4, fill: "#3b82f6", stroke: "#fff", "stroke-width": 1, cx: mx, cy: my, class: "gc-handle", "data-handle": "mid", cursor: "move" }));
    } else if (el.type === "rect") {
      const x1 = Math.min(el.x1, el.x2), y1 = Math.min(el.y1, el.y2);
      const x2 = Math.max(el.x1, el.x2), y2 = Math.max(el.y1, el.y2);
      // Four corner handles
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: x1, cy: y1, "data-handle": "tl" }));
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: x2, cy: y1, "data-handle": "tr" }));
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: x1, cy: y2, "data-handle": "bl" }));
      g.appendChild(this._svgEl("circle", { ...handleStyle, cx: x2, cy: y2, "data-handle": "br" }));
      // Edge midpoint handles
      g.appendChild(this._svgEl("rect", { x: (x1+x2)/2 - 3, y: y1 - 3, width: 6, height: 6, fill: "#3b82f6", stroke: "#fff", "stroke-width": 1, class: "gc-handle", "data-handle": "tm", cursor: "n-resize" }));
      g.appendChild(this._svgEl("rect", { x: (x1+x2)/2 - 3, y: y2 - 3, width: 6, height: 6, fill: "#3b82f6", stroke: "#fff", "stroke-width": 1, class: "gc-handle", "data-handle": "bm", cursor: "s-resize" }));
      g.appendChild(this._svgEl("rect", { x: x1 - 3, y: (y1+y2)/2 - 3, width: 6, height: 6, fill: "#3b82f6", stroke: "#fff", "stroke-width": 1, class: "gc-handle", "data-handle": "ml", cursor: "w-resize" }));
      g.appendChild(this._svgEl("rect", { x: x2 - 3, y: (y1+y2)/2 - 3, width: 6, height: 6, fill: "#3b82f6", stroke: "#fff", "stroke-width": 1, class: "gc-handle", "data-handle": "mr", cursor: "e-resize" }));
    }
  }

  _renderElement(el) {
    const g = this._svgG();
    const isSelected = el.id === this._selected;

    switch (el.type) {
      case "line": {
        // Invisible fat hit area for easier clicking
        g.appendChild(this._svgEl("line", {
          x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
          stroke: "transparent", "stroke-width": Math.max(el.width + 8, 12),
        }));
        g.appendChild(this._svgEl("line", {
          x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
          stroke: el.color, "stroke-width": el.width, "stroke-linecap": "round",
        }));
        if (isSelected) this._renderHandles(g, el);
        break;
      }

      case "curve": {
        const d = this._buildSmoothPath(el.points);
        // Fat hit area
        g.appendChild(this._svgEl("path", {
          d, fill: "none", stroke: "transparent", "stroke-width": Math.max(el.width + 8, 12),
        }));
        g.appendChild(this._svgEl("path", {
          d, fill: "none", stroke: el.color, "stroke-width": el.width, "stroke-linecap": "round",
        }));
        if (isSelected) {
          el.points.forEach((p, i) => {
            g.appendChild(this._svgEl("circle", {
              cx: p.x, cy: p.y, r: 5,
              fill: i === 0 || i === el.points.length - 1 ? el.color : "#f59e0b",
              stroke: "#fff", "stroke-width": 1, class: "gc-cp", "data-pt-idx": i,
            }));
          });
        }
        break;
      }

      case "arrow": {
        const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        const hl = 12;
        // Fat hit area
        g.appendChild(this._svgEl("line", {
          x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
          stroke: "transparent", "stroke-width": Math.max(el.width + 8, 12),
        }));
        g.appendChild(this._svgEl("line", {
          x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
          stroke: el.color, "stroke-width": el.width, "stroke-linecap": "round",
        }));
        g.appendChild(this._svgEl("polygon", {
          points: `${el.x2},${el.y2} ${el.x2 - hl * Math.cos(angle - 0.4)},${el.y2 - hl * Math.sin(angle - 0.4)} ${el.x2 - hl * Math.cos(angle + 0.4)},${el.y2 - hl * Math.sin(angle + 0.4)}`,
          fill: el.color,
        }));
        if (el.label) {
          const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2 - 8;
          const t = this._svgEl("text", { x: mx, y: my, fill: el.color, "font-size": "12", "text-anchor": "middle", "font-family": "sans-serif" });
          t.textContent = el.label;
          g.appendChild(t);
        }
        if (isSelected) this._renderHandles(g, el);
        break;
      }

      case "text": {
        const fontSize = el.fontSize || 14;
        const vertical = el.vertical || false;
        const text = el.text || "";

        const charW = fontSize * 0.58;
        const textW = text.length * charW;
        const textH = fontSize;
        const padX = 6, padY = 4;

        let boxW, boxH, tx, ty, transform = "";
        if (vertical) {
          boxW = textH + padY * 2;
          boxH = textW + padX * 2;
          tx = el.x + boxW / 2;
          ty = el.y + boxH / 2;
          transform = `rotate(-90, ${tx}, ${ty})`;
        } else {
          boxW = textW + padX * 2;
          boxH = textH + padY * 2;
          tx = el.x + padX;
          ty = el.y + padY + textH * 0.85;
        }

        g.appendChild(this._svgEl("rect", {
          x: el.x, y: el.y, width: boxW, height: boxH,
          fill: "rgba(10,10,10,0.8)", stroke: el.color, "stroke-width": 1, rx: 3,
        }));

        const t = this._svgEl("text", {
          x: tx, y: ty, fill: el.color, "font-size": fontSize,
          "font-family": "sans-serif",
          "text-anchor": vertical ? "middle" : "start",
          ...(transform ? { transform } : {}),
        });
        t.textContent = text;
        g.appendChild(t);

        if (isSelected) {
          const indicator = vertical ? "↕" : "↔";
          const indT = this._svgEl("text", {
            x: el.x + boxW + 4, y: el.y + 12,
            fill: "#f59e0b", "font-size": "11", "font-family": "sans-serif", class: "gc-orient-toggle",
          });
          indT.textContent = indicator;
          g.appendChild(indT);
        }
        break;
      }

      case "rect": {
        g.appendChild(this._svgEl("rect", {
          x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2),
          width: Math.abs(el.x2 - el.x1), height: Math.abs(el.y2 - el.y1),
          fill: "none", stroke: el.color, "stroke-width": el.width, rx: 2,
        }));
        if (isSelected) this._renderHandles(g, el);
        break;
      }

      case "freehand": {
        if (el.points.length < 2) break;
        let d = `M${el.points[0].x},${el.points[0].y}`;
        for (let i = 1; i < el.points.length; i++) d += ` L${el.points[i].x},${el.points[i].y}`;
        // Fat hit area
        g.appendChild(this._svgEl("path", {
          d, fill: "none", stroke: "transparent", "stroke-width": Math.max(el.width + 8, 12),
        }));
        g.appendChild(this._svgEl("path", {
          d, fill: "none", stroke: el.color, "stroke-width": el.width, "stroke-linecap": "round", "stroke-linejoin": "round",
        }));
        break;
      }
    }
    return g;
  }

  // ── Events ─────────────────────────────────────────────────────────────────────
  _bindEvents() {
    this.svg.addEventListener("pointerdown", e => this._onDown(e));
    this.svg.addEventListener("pointermove", e => this._onMove(e));
    this.svg.addEventListener("pointerup", e => this._onUp(e));
    this.svg.addEventListener("dblclick", e => this._onDblClick(e));
    this.svg.addEventListener("contextmenu", e => this._onRightClick(e));
  }

  _onDown(e) {
    if (e.button === 2) return;
    const raw = this._svgPt(e);
    const pt = this._snap(raw.x, raw.y);

    // ── Select tool ──
    if (this.tool === "select") {
      // Check orient toggle
      if (e.target.classList.contains("gc-orient-toggle")) {
        const el = this.elements.find(el => el.id === this._selected);
        if (el && el.type === "text") {
          this._pushUndo();
          el.vertical = !el.vertical;
          this.render();
          return;
        }
      }

      // Check endpoint handle drag
      if (e.target.classList.contains("gc-handle")) {
        const handle = e.target.getAttribute("data-handle");
        const elG = e.target.closest(".gc-el");
        if (elG) {
          this._draggingHandle = { id: parseInt(elG.dataset.id), handle };
          this._pushUndo();
          return;
        }
      }

      // Check curve control point drag
      if (e.target.classList.contains("gc-cp")) {
        const idx = parseInt(e.target.getAttribute("data-pt-idx"));
        const elG = e.target.closest(".gc-el");
        if (elG) {
          this._draggingCp = { id: parseInt(elG.dataset.id), idx };
          this._pushUndo();
          return;
        }
      }

      // Click on element to select
      const target = e.target.closest(".gc-el");
      if (target) {
        this._selected = parseInt(target.dataset.id);
        this._dragOffset = { x: raw.x, y: raw.y };
        this.render();
      } else {
        this._selected = null;
        this.render();
      }
      return;
    }

    // ── Text tool ──
    if (this.tool === "text") {
      const text = prompt("Label text:", "P");
      if (text) {
        this._addElement({ type: "text", x: pt.x, y: pt.y, text, color: this.strokeColor, fontSize: 14, vertical: false });
      }
      return;
    }

    // ── Curve tool ──
    if (this.tool === "curve") {
      this._curvePoints.push(pt);
      this._renderTempCurve();
      return;
    }

    // ── Line / Arrow / Rect / Freehand ──
    this._drawing = true;
    this._start = pt;
    if (this.tool === "freehand") this._freehandPts = [pt];
  }

  _onMove(e) {
    const raw = this._svgPt(e);
    const pt = this._snap(raw.x, raw.y);

    // Dragging an endpoint handle
    if (this._draggingHandle && e.buttons) {
      const el = this.elements.find(el => el.id === this._draggingHandle.id);
      if (!el) return;
      const h = this._draggingHandle.handle;

      if (el.type === "line" || el.type === "arrow") {
        if (h === "start") { el.x1 = pt.x; el.y1 = pt.y; }
        else if (h === "end") { el.x2 = pt.x; el.y2 = pt.y; }
        else if (h === "mid") {
          const dx = raw.x - (this._lastHandlePt || raw).x;
          const dy = raw.y - (this._lastHandlePt || raw).y;
          el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
          this._lastHandlePt = { x: raw.x, y: raw.y };
        }
      } else if (el.type === "rect") {
        // Normalize so x1,y1 is always TL and x2,y2 is BR for handle ops
        let x1 = Math.min(el.x1, el.x2), y1 = Math.min(el.y1, el.y2);
        let x2 = Math.max(el.x1, el.x2), y2 = Math.max(el.y1, el.y2);

        if (h === "tl") { x1 = pt.x; y1 = pt.y; }
        else if (h === "tr") { x2 = pt.x; y1 = pt.y; }
        else if (h === "bl") { x1 = pt.x; y2 = pt.y; }
        else if (h === "br") { x2 = pt.x; y2 = pt.y; }
        else if (h === "tm") { y1 = pt.y; }
        else if (h === "bm") { y2 = pt.y; }
        else if (h === "ml") { x1 = pt.x; }
        else if (h === "mr") { x2 = pt.x; }

        el.x1 = x1; el.y1 = y1; el.x2 = x2; el.y2 = y2;
      }
      this.render();
      return;
    }

    // Dragging a curve control point
    if (this._draggingCp && e.buttons) {
      const el = this.elements.find(el => el.id === this._draggingCp.id);
      if (el && el.type === "curve") {
        el.points[this._draggingCp.idx] = pt;
        this.render();
      }
      return;
    }

    // Live preview while building curve
    if (this.tool === "curve" && this._curvePoints.length > 0) {
      this._renderTempCurve(pt);
      return;
    }

    // Drag selected element (whole element move)
    if (!this._drawing && this.tool === "select" && this._selected && this._dragOffset && e.buttons) {
      const dx = raw.x - this._dragOffset.x;
      const dy = raw.y - this._dragOffset.y;
      this._dragOffset = { x: raw.x, y: raw.y };
      const el = this.elements.find(el => el.id === this._selected);
      if (!el) return;
      if (el.type === "line" || el.type === "arrow" || el.type === "rect") {
        el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
      } else if (el.type === "curve") {
        el.points.forEach(p => { p.x += dx; p.y += dy; });
      } else if (el.type === "text") {
        el.x += dx; el.y += dy;
      } else if (el.type === "freehand") {
        el.points.forEach(p => { p.x += dx; p.y += dy; });
      }
      this.render();
      return;
    }

    if (!this._drawing) return;

    if (this.tool === "freehand") {
      this._freehandPts.push(pt);
      this._renderTempFreehand();
      return;
    }

    // Temp preview for line/arrow/rect
    this._removeTempEl();
    const g = this._svgG("gc-temp");
    if (this.tool === "line" || this.tool === "arrow") {
      g.appendChild(this._svgEl("line", {
        x1: this._start.x, y1: this._start.y, x2: pt.x, y2: pt.y,
        stroke: this.strokeColor, "stroke-width": this.strokeWidth, "stroke-dasharray": "6 3", opacity: 0.7,
      }));
    } else if (this.tool === "rect") {
      g.appendChild(this._svgEl("rect", {
        x: Math.min(this._start.x, pt.x), y: Math.min(this._start.y, pt.y),
        width: Math.abs(pt.x - this._start.x), height: Math.abs(pt.y - this._start.y),
        fill: "none", stroke: this.strokeColor, "stroke-width": this.strokeWidth, "stroke-dasharray": "6 3", opacity: 0.7,
      }));
    }
    this.svg.appendChild(g);
  }

  _onUp(e) {
    // Finish handle drag
    if (this._draggingHandle) {
      this._draggingHandle = null;
      this._lastHandlePt = null;
      return;
    }

    // Finish cp drag
    if (this._draggingCp) {
      this._draggingCp = null;
      return;
    }

    if (this.tool === "select") {
      if (this._selected && this._dragOffset) {
        this._pushUndo();
        this._dragOffset = null;
      }
      return;
    }

    if (!this._drawing) return;
    this._drawing = false;
    this._removeTempEl();

    const raw = this._svgPt(e);
    const pt = this._snap(raw.x, raw.y);
    const s = this._start;
    const dist = Math.hypot(pt.x - s.x, pt.y - s.y);
    if (this.tool !== "freehand" && dist < 5) return;

    if (this.tool === "line") {
      this._addElement({ type: "line", x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, color: this.strokeColor, width: this.strokeWidth });
    } else if (this.tool === "arrow") {
      this._addElement({ type: "arrow", x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, color: this.strokeColor, width: this.strokeWidth, label: "" });
    } else if (this.tool === "rect") {
      this._addElement({ type: "rect", x1: s.x, y1: s.y, x2: pt.x, y2: pt.y, color: this.strokeColor, width: this.strokeWidth });
    } else if (this.tool === "freehand") {
      if (this._freehandPts.length > 1) {
        this._addElement({ type: "freehand", points: [...this._freehandPts], color: this.strokeColor, width: this.strokeWidth });
      }
      this._freehandPts = [];
      this._removeTempEl();
    }
  }

  // ── Right-click: finish curve, or toggle text orientation ──
  _onRightClick(e) {
    e.preventDefault();

    if (this.tool === "curve" && this._curvePoints.length >= 2) {
      this._addElement({
        type: "curve",
        points: [...this._curvePoints],
        color: this.strokeColor,
        width: this.strokeWidth,
      });
      this._curvePoints = [];
      this._removeTempCurve();
      return;
    }

    if (this._selected) {
      const el = this.elements.find(el => el.id === this._selected);
      if (el && el.type === "text") {
        this._pushUndo();
        el.vertical = !el.vertical;
        this.render();
      }
    }
  }

  _onDblClick(e) {
    const target = e.target.closest(".gc-el");
    if (!target) return;
    const id = parseInt(target.dataset.id);
    this._selected = id;
    this.editElement(id);
  }

  // ── Temp rendering helpers ─────────────────────────────────────────────────────
  _removeTempEl() {
    this.svg.querySelectorAll(".gc-temp").forEach(e => e.remove());
  }

  _renderTempFreehand() {
    this._removeTempEl();
    if (this._freehandPts.length < 2) return;
    let d = `M${this._freehandPts[0].x},${this._freehandPts[0].y}`;
    for (let i = 1; i < this._freehandPts.length; i++) d += ` L${this._freehandPts[i].x},${this._freehandPts[i].y}`;
    const g = this._svgG("gc-temp");
    g.appendChild(this._svgEl("path", { d, fill: "none", stroke: this.strokeColor, "stroke-width": this.strokeWidth, opacity: 0.7 }));
    this.svg.appendChild(g);
  }

  _renderTempCurve(mousePos) {
    this._removeTempCurve();
    const pts = [...this._curvePoints];
    if (mousePos) pts.push(mousePos);
    if (pts.length < 2) {
      if (pts.length === 1) {
        const g = this._svgG("gc-temp-curve");
        g.appendChild(this._svgEl("circle", { cx: pts[0].x, cy: pts[0].y, r: 4, fill: this.strokeColor }));
        this.svg.appendChild(g);
      }
      return;
    }

    const d = this._buildSmoothPath(pts);
    const g = this._svgG("gc-temp-curve");
    g.appendChild(this._svgEl("path", { d, fill: "none", stroke: this.strokeColor, "stroke-width": this.strokeWidth, opacity: 0.6 }));
    for (const p of this._curvePoints) {
      g.appendChild(this._svgEl("circle", { cx: p.x, cy: p.y, r: 4, fill: this.strokeColor, stroke: "#fff", "stroke-width": 1 }));
    }
    this.svg.appendChild(g);
  }

  _removeTempCurve() {
    this.svg.querySelectorAll(".gc-temp-curve").forEach(e => e.remove());
  }

  cancelCurve() {
    this._curvePoints = [];
    this._removeTempCurve();
  }

  // ── Serialize ──────────────────────────────────────────────────────────────────
  toJSON() {
    return { w: this.w, h: this.h, elements: this.elements, showGrid: this.showGrid, nextId: this.nextId, title: this.title, xLabel: this.xLabel, yLabel: this.yLabel };
  }

  fromJSON(data) {
    this.elements = data.elements || [];
    this.showGrid = data.showGrid !== undefined ? data.showGrid : true;
    this.nextId = data.nextId || (this.elements.length ? Math.max(...this.elements.map(e => e.id)) + 1 : 1);
    this.title = data.title || "";
    this.xLabel = data.xLabel || "";
    this.yLabel = data.yLabel || "";
    this._selected = null;
    this.render();
  }

  toSVG() {
    const clone = this.svg.cloneNode(true);
    clone.querySelectorAll(".gc-temp, .gc-temp-curve").forEach(e => e.remove());
    clone.querySelectorAll(".gc-selected").forEach(e => e.classList.remove("gc-selected"));
    clone.querySelectorAll(".gc-cp, .gc-orient-toggle, .gc-handle").forEach(e => e.remove());
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", this.w);
    bg.setAttribute("height", this.h);
    bg.setAttribute("fill", "#1a1a2e");
    clone.prepend(bg);
    return new XMLSerializer().serializeToString(clone);
  }

  clear() {
    this._pushUndo();
    this.elements = [];
    this._selected = null;
    this._curvePoints = [];
    this._removeTempCurve();
    this.render();
  }
}
