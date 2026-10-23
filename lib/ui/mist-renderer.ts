/**
 * The PayRead "dreamy mist" background: a full-screen WebGL fragment shader of
 * slow, domain-warped light ribbons, god rays and drifting bokeh.
 *
 * Built for a content site, not a demo: renders at reduced resolution, pauses
 * when the tab is hidden or the canvas is off-screen, draws one still frame for
 * reduced-motion users, and silently does nothing where WebGL is unavailable
 * (the page keeps its solid background).
 */
export type MistOptions = {
  accent?: string;
  intensity?: number;
  resolutionScale?: number;
  /** Called once the first frame is on screen (the CSS still can fade out). */
  onFirstFrame?: () => void;
  /** Called if the GPU context is lost later; the CSS still should show again. */
  onLost?: () => void;
};

const VERTEX = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

const FRAGMENT = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform vec3 uAccent; uniform float uMist;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0; float a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
void main(){
  float W = uRes.x;
  float x = gl_FragCoord.x / W;
  float yTop = (uRes.y - gl_FragCoord.y) / W;
  float t = uTime * 0.045;
  vec2 q = vec2(x, yTop) * 2.6 + (uMouse - 0.5) * vec2(0.22, 0.12);
  vec2 w = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3) - t));
  float n = fbm(q + 2.4 * w + vec2(t * 0.7, -t));
  float ribbon = smoothstep(0.42, 0.92, n);
  float fine = pow(fbm(q * 3.2 + w * 4.0 + t * 1.5), 2.0);
  vec3 ground = vec3(0.027, 0.063, 0.051);
  vec3 deep = vec3(0.035, 0.17, 0.15);
  vec3 violet = vec3(0.34, 0.30, 0.78);
  vec3 pearl = vec3(0.96, 0.92, 0.85);
  vec3 col = mix(ground, deep, smoothstep(0.25, 0.85, n) * 0.95);
  col = mix(col, violet * 0.5, smoothstep(0.55, 0.92, w.x) * 0.38 * uMist);
  col += uAccent * ribbon * 0.42 * uMist;
  col += pearl * pow(ribbon, 3.0) * fine * 0.75 * uMist;
  vec2 d = vec2(x, yTop) - vec2(0.84 + (uMouse.x - 0.5) * 0.05, -0.04);
  float glow = exp(-dot(d, d) * 5.5);
  float ang = atan(d.y, d.x);
  float rays = pow(0.55 * noise(vec2(ang * 10.0, t * 2.0)) + 0.45 * noise(vec2(ang * 27.0, -t * 3.0)), 3.0);
  col += pearl * glow * 0.32 + pearl * rays * glow * 0.55;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float sp = 0.25 + hash(vec2(fi, 3.1));
    vec2 bp = vec2(hash(vec2(fi, 1.3)), fract(hash(vec2(fi, 7.7)) - t * 0.35 * sp) * 0.95);
    bp.x += sin(t * 2.0 + fi) * 0.01 + (uMouse.x - 0.5) * 0.03 * sp;
    float r = 0.008 + 0.026 * hash(vec2(fi, 9.4));
    float b = smoothstep(r, r * 0.55, length(vec2(x, yTop) - bp));
    vec3 bc = mix(uAccent, pearl, hash(vec2(fi, 4.4)));
    col += bc * b * (0.10 + 0.12 * hash(vec2(fi, 2.2))) * uMist;
  }
  float fade = exp(-yTop * 1.05);
  col = mix(ground, col, 0.32 + 0.68 * fade);
  col *= 1.0 - 0.32 * pow(abs(x - 0.5) * 2.0, 2.2);
  col = 1.0 - exp(-col * 1.55);
  col += (hash(gl_FragCoord.xy + fract(uTime * 0.37) * 91.0) - 0.5) * 0.032;
  gl_FragColor = vec4(col, 1.0);
}`;

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = /^[0-9a-f]{6}$/i.test(h) ? parseInt(h, 16) : 0x8fe3b5;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class MistRenderer {
  private gl: WebGLRenderingContext | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private time = 12;
  private last = 0;
  private visible = true;
  private onScreen = true;
  private running = false;
  private mouse: [number, number] = [0.5, 0.3];
  private mouseTarget: [number, number] = [0.5, 0.3];
  private accent: [number, number, number];
  private intensity: number;
  private readonly scale: number;
  private readonly reducedMotion: boolean;
  private resizeObserver?: ResizeObserver;
  private intersectionObserver?: IntersectionObserver;
  private readonly onVisibility = () => { this.visible = !document.hidden; this.schedule(); };
  private firstFrameSent = false;
  private readonly onFirstFrame?: () => void;
  private readonly onLost?: () => void;
  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.firstFrameSent = false;
    this.onLost?.();
  };

  constructor(private readonly canvas: HTMLCanvasElement, options: MistOptions = {}) {
    this.accent = hexToRgb(options.accent ?? '#8fe3b5');
    this.intensity = options.intensity ?? 0.85;
    this.scale = options.resolutionScale ?? 0.6;
    this.onFirstFrame = options.onFirstFrame;
    this.onLost = options.onLost;
    this.reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** True when WebGL initialised; false leaves the canvas untouched. */
  start(): boolean {
    const gl = this.init();
    if (!gl) return false;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => { this.resize(); if (this.reducedMotion) this.draw(); });
      this.resizeObserver.observe(this.canvas);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(([entry]) => { this.onScreen = entry.isIntersecting; this.schedule(); });
      this.intersectionObserver.observe(this.canvas);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.running = true;
    if (this.reducedMotion) this.draw(); else this.schedule();
    return true;
  }

  setPointer(x: number, y: number): void {
    this.mouseTarget = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  }

  setAccent(hex: string): void { this.accent = hexToRgb(hex); if (this.reducedMotion) this.draw(); }
  setIntensity(value: number): void { this.intensity = value; if (this.reducedMotion) this.draw(); }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    // No loseContext(): the same canvas may be started again (React dev double-mount).
    this.gl = null;
  }

  private init(): WebGLRenderingContext | null {
    let gl: WebGLRenderingContext | null = null;
    try { gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); }
    catch { return null; }
    if (!gl) return null;
    const compile = (type: number, src: string) => {
      const shader = gl!.createShader(type);
      if (!shader) return null;
      gl!.shaderSource(shader, src);
      gl!.compileShader(shader);
      return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['uRes', 'uTime', 'uMouse', 'uAccent', 'uMist']) this.uniforms[name] = gl.getUniformLocation(program, name);
    this.gl = gl;
    return gl;
  }

  private resize(): void {
    if (!this.gl) return;
    const rect = this.canvas.getBoundingClientRect();
    const s = Math.min(window.devicePixelRatio || 1, 1.5) * this.scale;
    const w = Math.max(1, Math.round(rect.width * s));
    const h = Math.max(1, Math.round(rect.height * s));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  private schedule(): void {
    if (!this.running || this.reducedMotion || this.raf) return;
    if (!this.visible || !this.onScreen) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    this.raf = 0;
    if (!this.running || !this.visible || !this.onScreen) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    const gl = this.gl;
    if (!gl) return;
    this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * 0.04;
    this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * 0.04;
    const u = this.uniforms;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, this.time);
    gl.uniform2f(u.uMouse, this.mouse[0], this.mouse[1]);
    gl.uniform3f(u.uAccent, this.accent[0], this.accent[1], this.accent[2]);
    gl.uniform1f(u.uMist, this.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this.firstFrameSent && !gl.isContextLost()) {
      this.firstFrameSent = true;
      this.onFirstFrame?.();
    }
  }
}
