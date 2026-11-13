// (V9) Frame meter, adaptive render scale and the frame-time readout.
//
// Every frame of the game's own loop: the time since the last frame (as the browser schedules them), the CPU time of
// the frame (step and render calls), and how long the GPU took to finish the frame's work after it was submitted
// (device.queue.onSubmittedWorkDone, one probe in flight at a time: when the GPU keeps up this is the frame's GPU time;
// when it falls behind, frames queue and it grows past the frame interval). Each is smoothed over about 0.4 s.
//
// Adaptive render scale (PERF.adapt, on by default; `?perf=-adapt` or `demo.adapt.enabled = false` holds it at the
// top): the picture is drawn at between `max` (1.5 device pixels per CSS pixel, or the display's own if lower) and
// `floor` (1.0) device pixels per CSS pixel. When the GPU is what holds the frame back (its smoothed time over 13.5 ms
// and over the CPU's, or frames coming slower than 54 a second while the GPU is the larger part) for half a second, the
// scale steps down by 0.1 (about 13 % fewer pixels); when the GPU has had room for three seconds (under 8 ms, frames on
// time) it steps back up by 0.1. At most one step a second down and one every three seconds up, so the picture does
// not pump; a CPU-bound frame never lowers it (fewer pixels would not help). Measured: a step costs one frame of
// about 13 ms at 2268 x 1350 (the render targets re-made), no slow frame.
//
// Readout (the ` key, left of 1): fps, the frame interval (mean and worst over the last second), CPU and GPU ms, the
// render scale and the canvas size, in the top-right panel.

const TAU = 0.4; // s, smoothing
const DOWN_GPU = 13.5; // ms
const DOWN_GAP = 18.5; // ms (54 fps)
const UP_GPU = 8; // ms
const UP_GAP = 17.5; // ms
const STEP = 0.1;

export class FrameMeter {
  /**
   * renderer: the WebGPURenderer; max / floor: device pixels per CSS pixel; setScale(s): applies a render scale.
   */
  constructor(renderer, { max = 1.5, floor = 1.0, enabled = true, setScale = null, el = null } = {}) {
    this.renderer = renderer;
    this.device = renderer.backend && renderer.backend.device ? renderer.backend.device : null;
    this.max = max;
    this.floor = Math.min(floor, max);
    this.enabled = enabled;
    this.scale = max;
    this.setScale = setScale || ((s) => renderer.setPixelRatio(s));
    this.el = el;
    this.show = false;
    this.fakeGpu = 0; // (for testing the controller: ms added to the measured GPU time)
    this.gapS = 0;
    this.cpuS = 0;
    this.gpuS = 0;
    this.gpu = 0;
    this._last = null;
    this._t0 = 0;
    this._probe = false;
    this._down = 0; // s the down condition has held
    this._up = 0;
    this._since = 0; // s since the last change
    this._shown = 0;
    this.recent = []; // [gap, cpu, gpu] of the last second, for the readout
    this.changes = []; // [time s, scale]
    this._time = 0;
  }

  /** At the start of a frame (the animation loop's timestamp). */
  begin(now) {
    this._t0 = performance.now();
    const gap = this._last === null ? 0 : now - this._last;
    this._last = now;
    this._gap = gap;
  }

  /** After the frame's render call: the CPU time, a GPU probe, the controller, the readout. */
  end() {
    const t1 = performance.now();
    const cpu = t1 - this._t0;
    const gap = this._gap;
    if (this.device && !this._probe) {
      this._probe = true;
      this.device.queue.onSubmittedWorkDone().then(() => {
        this.gpu = performance.now() - t1;
        this._probe = false;
      });
    }
    // (a gap of more than 0.1 s is the tab coming back or a load: not a frame to judge by)
    if (!(gap > 0 && gap < 100)) return;
    const dt = gap / 1000;
    this._time += dt;
    const k = 1 - Math.exp(-dt / TAU);
    const gpu = this.gpu + this.fakeGpu;
    this.gapS += (gap - this.gapS) * k;
    this.cpuS += (cpu - this.cpuS) * k;
    this.gpuS += (gpu - this.gpuS) * k;
    this.recent.push([gap, cpu, gpu]);
    if (this.recent.length > 240) this.recent.shift();
    this._since += dt;
    this._control(dt);
    this._shown += dt;
    if (this.show && this.el && this._shown > 0.25) {
      this._shown = 0;
      this.el.textContent = this.text();
    }
  }

  _control(dt) {
    if (!this.enabled) {
      if (this.scale !== this.max) this._apply(this.max);
      return;
    }
    const gpuBound = this.gpuS >= this.cpuS;
    const down = (this.gpuS > DOWN_GPU && gpuBound) || (this.gapS > DOWN_GAP && gpuBound);
    const up = this.gpuS < UP_GPU && this.gapS < UP_GAP;
    this._down = down ? this._down + dt : 0;
    this._up = up ? this._up + dt : 0;
    if (this._down > 0.5 && this._since > 1 && this.scale > this.floor + 1e-6) this._apply(Math.max(this.floor, +(this.scale - STEP).toFixed(2)));
    else if (this._up > 3 && this._since > 3 && this.scale < this.max - 1e-6) this._apply(Math.min(this.max, +(this.scale + STEP).toFixed(2)));
  }

  _apply(s) {
    this.scale = s;
    this.setScale(s);
    this._since = 0;
    this._down = this._up = 0;
    this.changes.push([+this._time.toFixed(2), s]);
    if (this.changes.length > 50) this.changes.shift();
  }

  /** The readout's line. */
  text() {
    const r = this.recent.slice(-Math.max(1, Math.round(1000 / Math.max(1, this.gapS))));
    if (!r.length) return 'measuring…';
    const mean = (i) => r.reduce((a, x) => a + x[i], 0) / r.length;
    const worst = Math.max(...r.map((x) => x[0]));
    const c = this.renderer.domElement;
    return `${Math.round(1000 / Math.max(1e-3, mean(0)))} fps · ${mean(0).toFixed(1)} ms (worst ${worst.toFixed(0)}) · CPU ${mean(1).toFixed(1)} · GPU ${mean(2).toFixed(1)} · ×${this.scale.toFixed(2)} ${c.width}×${c.height}${this.enabled ? '' : ' (fixed)'}`;
  }

  toggle() {
    this.show = !this.show;
    if (this.el) {
      this.el.parentElement.hidden = !this.show;
      if (this.show) this.el.textContent = this.text();
    }
    return this.show;
  }
}
