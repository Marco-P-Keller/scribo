import { pressureCurve } from '../core/ink';
import { clamp } from '../core/geometry';
import { settings } from '../app/settings';
import type { PenAction } from '../app/settings';
import type { PageView } from '../viewer/pageview';
import type { Viewer } from '../viewer/viewer';
import type { Sample, Tool, ToolEvent } from './types';
import { penTouching } from './pen';

export interface ControllerDeps {
  viewer: Viewer;
  /** the tool selected in the toolbar */
  getTool(): Tool;
  toolForAction(a: PenAction): Tool | null;
  /** tools that draw / edit (as opposed to the pointer, which scrolls with a finger) */
  isDrawing(tool: Tool): boolean;
  isSpaceHeld(): boolean;
  /** a tool that takes precedence at this point (e.g. moving the current selection with the pen tip) */
  overrideAt?(page: PageView, clientX: number, clientY: number, pointerType: ToolEvent['pointerType']): Tool | null;
  /** live pen state for the settings panel (pressure meter, button tester) */
  onPenInfo?(info: { type: string; pressure: number; buttons: number; tiltX: number; tiltY: number } | null): void;
}

export class PanTool implements Tool {
  readonly id = 'pan' as const;
  readonly cursor = 'grab';
  private last = { x: 0, y: 0 };
  constructor(private viewer: Viewer) {}
  down(e: ToolEvent): boolean {
    this.last = { x: e.clientX, y: e.clientY };
    this.viewer.stage.classList.add('dragging');
    return true;
  }
  move(e: ToolEvent): void {
    this.viewer.panBy(this.last.x - e.clientX, this.last.y - e.clientY);
    this.last = { x: e.clientX, y: e.clientY };
  }
  up(): void {
    this.viewer.stage.classList.remove('dragging');
  }
  cancel(): void {
    this.viewer.stage.classList.remove('dragging');
  }
}

interface Active {
  id: number;
  tool: Tool;
  page: PageView | null;
  type: ToolEvent['pointerType'];
  convert: ((x: number, y: number) => { x: number; y: number }) | null;
  /** a pen stroke: it ends when the pen lifts, even if a button is still held (no pointerup arrives then) */
  viaContact: boolean;
}

interface Touch {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t0: number;
  vx: number;
  vy: number;
  lt: number;
}

const PEN_MEMORY_MS = 700;

/**
 * Turns raw pointer events into tool events: pen / mouse / finger roles,
 * pen buttons, palm rejection, touch pan & pinch, and the hover ring.
 */
export class InputController {
  readonly panTool: PanTool;
  private stage: HTMLElement;
  private active: Active | null = null;
  private touches = new Map<number, Touch>();
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  private penHoverButtons = 0;
  private lastPen = 0;
  private penInContact = false;
  private inertia = 0;
  private ring = document.createElement('div');
  private ringVisible = false;
  private touchTool: Tool | null = null;
  private lastTapEv: { t: number; x: number; y: number } = { t: 0, x: 0, y: 0 };

  constructor(private d: ControllerDeps) {
    this.stage = d.viewer.stage;
    this.panTool = new PanTool(d.viewer);
    this.ring.className = 'hover-ring';
    d.viewer.overlay.append(this.ring);
    const s = this.stage;
    s.addEventListener('pointerdown', this.onDown);
    s.addEventListener('pointermove', this.onMove);
    s.addEventListener('pointerup', this.onUp);
    s.addEventListener('pointercancel', this.onCancel);
    s.addEventListener('pointerleave', this.onLeave);
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    // a pen drag on PDF text must move / draw, not start a native text selection
    s.addEventListener('selectstart', (e) => {
      if (this.active) e.preventDefault();
    });
    s.addEventListener('dblclick', this.onDbl);
    s.addEventListener('wheel', this.onWheel, { passive: false });
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private kind(e: PointerEvent): ToolEvent['pointerType'] {
    return e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
  }

  private sampleOf(ev: PointerEvent, type: ToolEvent['pointerType'], convert: (x: number, y: number) => { x: number; y: number }): Sample {
    const q = convert(ev.clientX, ev.clientY);
    const p = type === 'pen' ? pressureCurve(ev.pressure, settings.get('sensitivity')) : 0.5;
    return { x: q.x, y: q.y, p, t: ev.timeStamp };
  }

  private makeEvent(
    e: PointerEvent,
    page: PageView | null,
    convert: ((x: number, y: number) => { x: number; y: number }) | null,
    withSamples = true,
  ): ToolEvent {
    const type = this.kind(e);
    const q = page && convert ? convert(e.clientX, e.clientY) : { x: 0, y: 0 };
    let samples: Sample[] = [];
    let predicted: Sample[] = [];
    if (page && convert && withSamples) {
      const co = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      samples = (co.length ? co : [e]).map((ev) => this.sampleOf(ev, type, convert));
      if (typeof e.getPredictedEvents === 'function' && type === 'pen') {
        predicted = e.getPredictedEvents().map((ev) => this.sampleOf(ev, type, convert));
      }
    }
    return {
      page,
      x: q.x,
      y: q.y,
      pressure: type === 'pen' ? pressureCurve(e.pressure, settings.get('sensitivity')) : 0.5,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      pointerType: type,
      buttons: e.buttons,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      time: e.timeStamp,
      clientX: e.clientX,
      clientY: e.clientY,
      samples,
      predicted,
      raw: e,
    };
  }

  /** Pen buttons held right now (bit 1 = tip excluded), including ones only reported as the changed button. */
  private penButtonBits(e: PointerEvent): number {
    return ((e.buttons | this.penHoverButtons) & ~1) | (e.button === 2 ? 2 : 0) | (e.button === 5 ? 32 : 0);
  }

  private pickTool(e: PointerEvent): Tool {
    if (this.d.isSpaceHeld()) return this.panTool;
    const base = this.d.getTool();
    if (e.pointerType === 'pen') {
      const bits = this.penButtonBits(e);
      const m = settings.get('penButtons');
      let act: PenAction = 'none';
      if (bits & 32) act = m.eraser;
      else if (bits & 2) act = m.barrel;
      else if (bits & 4) act = m.middle;
      if (act !== 'none') {
        const t = this.d.toolForAction(act);
        if (t) return t;
      }
    }
    if (e.pointerType !== 'touch' && this.d.overrideAt) {
      const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 18);
      const t = page ? this.d.overrideAt(page, e.clientX, e.clientY, this.kind(e)) : null;
      if (t) return t;
    }
    if (e.pointerType === 'mouse' && !settings.get('mouseDraws') && this.d.isDrawing(base)) return this.panTool;
    return base;
  }

  private palmBlocked(): boolean {
    return settings.get('palmRejection') && (this.penInContact || performance.now() - this.lastPen < PEN_MEMORY_MS);
  }

  /** Capture can fail for pointers the browser doesn't consider pressed (e.g. contact reported as a move). */
  private capture(id: number): void {
    try {
      this.stage.setPointerCapture(id);
    } catch {
      /* strokes still work without capture while the pen stays over the stage */
    }
  }

  // ── pointer events ────────────────────────────────────────────────────

  private onDown = (e: PointerEvent): void => {
    // buttons inside the document area (e.g. "add page") are ordinary UI
    if ((e.target as Element | null)?.closest?.('.viewer-ui')) return;
    const type = this.kind(e);
    if (type === 'pen') {
      this.lastPen = performance.now();
    }
    if (type === 'touch') return this.touchDown(e);
    if (this.active) return;
    if (type === 'mouse') {
      if (e.button === 1) {
        e.preventDefault();
        this.start(e, this.panTool);
        return;
      }
      if (e.button !== 0) return;
    }
    if (type === 'pen') {
      if (!penTouching(e)) {
        // button pressed in the air: remember it for the stroke that follows
        this.penHoverButtons = this.penButtonBits(e);
        return;
      }
      this.penInContact = true;
    }
    this.cancelInertia();
    this.start(e, this.pickTool(e));
  };

  private start(e: PointerEvent, tool: Tool): void {
    const type = this.kind(e);
    const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, tool.id === 'pan' ? 0 : 18);
    const convert = page ? page.converter() : null;
    const ev = this.makeEvent(e, page, convert);
    // native text selection / link clicks must not be hijacked
    const captured = tool.down(ev);
    if (!captured) {
      this.updateCursor(tool);
      return;
    }
    this.capture(e.pointerId);
    this.active = { id: e.pointerId, tool, page, type, convert, viaContact: type === 'pen' };
    if (type === 'pen') this.penInContact = true;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    this.hideRing();
    this.stage.style.cursor = tool.cursor;
  }

  private onMove = (e: PointerEvent): void => {
    const type = this.kind(e);
    if (type === 'pen') {
      this.lastPen = performance.now();
      this.d.onPenInfo?.({ type, pressure: e.pressure, buttons: e.buttons, tiltX: e.tiltX, tiltY: e.tiltY });
    }
    if (type === 'touch') return this.touchMove(e);
    const a = this.active;
    if (a && a.id === e.pointerId) {
      if (a.viaContact && !penTouching(e)) {
        // pen lifted while a button is still held: browsers report that as a move, not as pointerup
        this.finish(e);
        this.penHoverButtons = e.buttons & ~1;
        return;
      }
      a.tool.move(this.makeEvent(e, a.page, a.convert));
      return;
    }
    if (type === 'pen') {
      if (penTouching(e) && !a) {
        // the pen touched down while a button was already held: no pointerdown arrived
        this.penHoverButtons = this.penButtonBits(e);
        this.penInContact = true;
        this.cancelInertia();
        this.start(e, this.pickTool(e));
        return;
      }
      this.penHoverButtons = e.buttons & ~1;
    }
    this.hover(e);
  };

  private hover(e: PointerEvent): void {
    const type = this.kind(e);
    const tool: Tool = this.d.isSpaceHeld() ? this.panTool : this.pickToolForHover(e);
    const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 0);
    if (page && type === 'pen') page.warmLive();
    const ev = this.makeEvent(e, page, page ? page.converter() : null, false);
    tool.hover?.(ev);
    this.stage.style.cursor = tool.cursor;
    const r = tool.ring?.() ?? null;
    if (r !== null && page) this.showRing(e.clientX, e.clientY, r);
    else this.hideRing();
  }

  private pickToolForHover(e: PointerEvent): Tool {
    // show the ring / cursor of the tool a press would use (button held → eraser ring, over the selection → move)
    if (e.pointerType === 'pen' && this.penHoverButtons) return this.pickTool(e);
    if (e.pointerType !== 'touch' && this.d.overrideAt) {
      const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 18);
      const t = page ? this.d.overrideAt(page, e.clientX, e.clientY, this.kind(e)) : null;
      if (t) return t;
    }
    return this.d.getTool();
  }

  private onUp = (e: PointerEvent): void => {
    const type = this.kind(e);
    if (type === 'pen') {
      this.penInContact = false;
      this.lastPen = performance.now();
    }
    if (type === 'touch') return this.touchUp(e);
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.finish(e);
  };

  private finish(e: PointerEvent): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (a.type === 'pen') this.penInContact = false;
    try {
      this.stage.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    a.tool.up(this.makeEvent(e, a.page, a.convert));
    this.updateCursor(this.d.getTool());
  }

  private onCancel = (e: PointerEvent): void => {
    const type = this.kind(e);
    if (type === 'pen') this.penInContact = false;
    if (type === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (this.touchTool) {
        this.touchTool.cancel();
        this.touchTool = null;
        this.active = null;
      }
      return;
    }
    const a = this.active;
    if (a && a.id === e.pointerId) {
      this.active = null;
      a.tool.cancel();
    }
  };

  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') {
      this.penHoverButtons = 0;
      this.d.onPenInfo?.(null);
    }
    if (!this.active) this.hideRing();
  };

  private onDbl = (e: MouseEvent): void => {
    const tool = this.d.getTool();
    const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 0);
    if (!tool.dblclick || !page) return;
    const q = page.clientToPage(e.clientX, e.clientY);
    tool.dblclick({
      page, x: q.x, y: q.y, pressure: 0.5, tiltX: 0, tiltY: 0, pointerType: 'mouse', buttons: 0,
      shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, time: e.timeStamp, clientX: e.clientX, clientY: e.clientY,
      samples: [], predicted: [], raw: e as unknown as PointerEvent,
    });
  };

  // ── touch: pan, pinch, tap ────────────────────────────────────────────

  private touchDown(e: PointerEvent): void {
    if (this.palmBlocked()) return;
    this.cancelInertia();
    const tool = this.d.getTool();
    const wantsDraw = settings.get('fingerDraws') && this.d.isDrawing(tool);
    if (wantsDraw && !this.active && this.touches.size === 0) {
      const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 18);
      const convert = page ? page.converter() : null;
      if (tool.down(this.makeEvent(e, page, convert))) {
        this.capture(e.pointerId);
        this.active = { id: e.pointerId, tool, page, type: 'touch', convert, viaContact: false };
        this.touchTool = tool;
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, vx: 0, vy: 0, lt: e.timeStamp });
        e.preventDefault();
        return;
      }
    }
    if (this.touchTool && this.touches.size === 1) {
      // second finger while a finger stroke is running: it was a gesture after all
      this.touchTool.cancel();
      this.touchTool = null;
      this.active = null;
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, vx: 0, vy: 0, lt: e.timeStamp });
    this.capture(e.pointerId);
    if (this.touches.size === 2) this.beginPinch();
  }

  private beginPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    if (this.touchTool && this.active?.id === e.pointerId) {
      this.touchTool.move(this.makeEvent(e, this.active.page, this.active.convert));
      t.x = e.clientX;
      t.y = e.clientY;
      return;
    }
    const dt = Math.max(1, e.timeStamp - t.lt);
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.vx = 0.7 * (dx / dt) + 0.3 * t.vx;
    t.vy = 0.7 * (dy / dt) + 0.3 * t.vy;
    t.lt = e.timeStamp;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touches.size === 1) {
      this.d.viewer.panBy(-dx, -dy);
    } else if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const ratio = clamp(dist / this.pinch.dist, 0.5, 2);
      this.d.viewer.panBy(-(cx - this.pinch.cx), -(cy - this.pinch.cy));
      if (Math.abs(ratio - 1) > 0.002) this.d.viewer.zoomBy(ratio, { x: cx, y: cy });
      this.pinch = { dist, cx, cy };
    }
  }

  private touchUp(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touchTool && this.active?.id === e.pointerId) {
      const a = this.active;
      this.active = null;
      this.touchTool = null;
      try {
        this.stage.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      a.tool.up(this.makeEvent(e, a.page, a.convert));
      return;
    }
    if (!t) return;
    const wasPinch = this.pinch !== null;
    if (this.touches.size < 2) this.pinch = null;
    if (this.touches.size === 0 && !wasPinch) {
      const moved = Math.hypot(e.clientX - t.sx, e.clientY - t.sy);
      const dur = e.timeStamp - t.t0;
      if (moved < 10 && dur < 400) {
        this.tap(e);
        return;
      }
      const speed = Math.hypot(t.vx, t.vy);
      if (speed > 0.15 && e.timeStamp - t.lt < 60) this.startInertia(t.vx, t.vy);
    }
  }

  private tap(e: PointerEvent): void {
    const tool = this.d.getTool();
    const page = this.d.viewer.pageAtClient(e.clientX, e.clientY, 0);
    const ev = this.makeEvent(e, page, page ? page.converter() : null, false);
    const dbl = e.timeStamp - this.lastTapEv.t < 350 && Math.hypot(e.clientX - this.lastTapEv.x, e.clientY - this.lastTapEv.y) < 24;
    this.lastTapEv = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (dbl && tool.dblclick) tool.dblclick(ev);
    else tool.tap?.(ev);
  }

  private startInertia(vx: number, vy: number): void {
    this.cancelInertia();
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const decay = Math.exp(-dt / 330);
      vx *= decay;
      vy *= decay;
      this.d.viewer.panBy(-vx * dt, -vy * dt);
      if (Math.hypot(vx, vy) > 0.02) this.inertia = requestAnimationFrame(step);
      else this.inertia = 0;
    };
    this.inertia = requestAnimationFrame(step);
  }

  private cancelInertia(): void {
    if (this.inertia) cancelAnimationFrame(this.inertia);
    this.inertia = 0;
  }

  // ── wheel ─────────────────────────────────────────────────────────────

  private onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0022;
    this.d.viewer.zoomBy(Math.exp(-e.deltaY * unit), { x: e.clientX, y: e.clientY });
  };

  // ── hover ring ────────────────────────────────────────────────────────

  private showRing(cx: number, cy: number, r: number): void {
    const el = this.ring;
    const box = this.d.viewer.el.getBoundingClientRect();
    if (!this.ringVisible) {
      el.style.opacity = '1';
      this.ringVisible = true;
    }
    const size = r * 2;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${cx - box.left - r}px, ${cy - box.top - r}px)`;
  }

  hideRing(): void {
    if (!this.ringVisible) return;
    this.ring.style.opacity = '0';
    this.ringVisible = false;
  }

  updateCursor(tool: Tool): void {
    this.stage.style.cursor = tool.cursor;
    if (!tool.ring || tool.ring() === null) this.hideRing();
  }

  /** the toolbar tool changed or a stroke was cancelled from outside */
  cancelActive(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.tool.cancel();
  }

  get busy(): boolean {
    return !!this.active;
  }
}
