import { useRef } from "react";
import { useAnimationFrame, useTelemetry, useTelemetryRef } from "../hooks/useTelemetry";
import { CYLINDER_STRIDE, Cyl, type EngineState } from "../sim/protocol";
import { useApp } from "../store";
import { fmt, units } from "../units";
import { Icon, type IconName } from "./ui";

const MONO = '"Geist Mono", ui-monospace, monospace';
const SANS = 'Geist, "Inter", sans-serif';

function prepare(canvas: HTMLCanvasElement | null) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!w || !h) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

/** Analog tachometer: smoothed needle, redline arc, digital readout. */
export function Tachometer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useTelemetryRef();
  const redline = useApp((s) => s.info?.redlineRpm ?? 7000);
  const needle = useRef(0);

  useAnimationFrame(() => {
    const p = prepare(canvasRef.current);
    if (!p) return;
    const { ctx, w, h } = p;
    const s = state.current;
    const rpm = s?.rpm ?? 0;
    needle.current += (rpm - needle.current) * 0.3;

    const max = Math.ceil((redline * 1.2) / 1000) * 1000;
    // Arc spans 252°; it needs ~1.1r above the center and ~0.7r below.
    const radius = Math.min(w * 0.45, (h - 8) / 1.82);
    const cx = w / 2;
    const cy = radius * 1.12 + 4;
    const start = Math.PI * 0.78;
    const sweep = Math.PI * 1.44;
    const angleOf = (v: number) => start + (Math.min(Math.max(v, 0), max) / max) * sweep;

    ctx.lineCap = "round";

    ctx.lineWidth = radius * 0.055;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + sweep);
    ctx.stroke();

    ctx.lineWidth = radius * 0.025;
    ctx.strokeStyle = "#ff453a";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.075, angleOf(redline), start + sweep);
    ctx.stroke();

    const inRed = needle.current >= redline;
    ctx.lineWidth = radius * 0.055;
    const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, inRed ? "#ff453a" : "#f5f5f7");
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, angleOf(needle.current));
    ctx.stroke();

    for (let v = 0; v <= max; v += 500) {
      const a = angleOf(v);
      const major = v % 1000 === 0;
      const r0 = radius * (major ? 0.8 : 0.85);
      const r1 = radius * 0.9;
      ctx.strokeStyle = v >= redline ? "#ff453a" : major ? "#a1a1aa" : "#52525b";
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = v >= redline ? "#ff453a" : "#71717a";
        ctx.font = `500 ${Math.max(9, radius * 0.1)}px ${MONO}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const rl = radius * 0.64;
        ctx.fillText(String(v / 1000), cx + Math.cos(a) * rl, cy + Math.sin(a) * rl);
      }
    }

    const a = angleOf(needle.current);
    ctx.strokeStyle = "#f5f5f7";
    ctx.shadowColor = "rgba(250,250,250,0.6)";
    ctx.shadowBlur = 8;
    ctx.lineWidth = Math.max(2, radius * 0.022);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * radius * 0.58, cy + Math.sin(a) * radius * 0.58);
    ctx.lineTo(cx + Math.cos(a) * radius * 0.96, cy + Math.sin(a) * radius * 0.96);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = inRed ? "#ff453a" : "#f5f5f7";
    ctx.font = `500 ${radius * 0.26}px ${MONO}`;
    ctx.fillText(Math.round(needle.current).toLocaleString("pt-BR"), cx, cy + radius * 0.1);
    ctx.fillStyle = "rgba(245,245,247,0.4)";
    ctx.font = `500 ${radius * 0.1}px ${SANS}`;
    ctx.fillText("rpm", cx, cy + radius * 0.3);
  });

  return <canvas ref={canvasRef} className="gauge-canvas" aria-label="Conta-giros" />;
}

/** Live waveform of the audio output. */
export function Oscilloscope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const client = useApp((s) => s.client);
  const buffer = useRef<Float32Array<ArrayBuffer> | null>(null);

  useAnimationFrame(() => {
    const p = prepare(canvasRef.current);
    if (!p || !client) return;
    const { ctx, w, h } = p;
    const analyser = client.analyser;
    if (!buffer.current || buffer.current.length !== analyser.fftSize) {
      buffer.current = new Float32Array(analyser.fftSize);
    }
    analyser.getFloatTimeDomainData(buffer.current);
    const data = buffer.current;
    ctx.strokeStyle = "rgba(245,245,247,0.85)";
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < data.length; i += 2) {
      const x = (i / (data.length - 1)) * w;
      const y = h / 2 - data[i] * h * 0.48;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  return <canvas ref={canvasRef} className="scope-canvas" aria-label="Forma de onda do som" />;
}

/** Per-cylinder pressure bars; amber while the mixture is burning. */
export function CylinderStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useTelemetryRef();

  useAnimationFrame(() => {
    const p = prepare(canvasRef.current);
    const s = state.current;
    if (!p || !s) return;
    const { ctx, w, h } = p;
    const n = s.cylinders.length / CYLINDER_STRIDE;
    const gap = n > 8 ? 2 : 3;
    const bw = (w - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const pressure = s.cylinders[i * CYLINDER_STRIDE + Cyl.pressure];
      const lit = s.cylinders[i * CYLINDER_STRIDE + Cyl.lit] > 0.5;
      const v = Math.min(1, Math.max(0, (pressure - 20000) / 6_000_000) ** 0.5);
      const x = i * (bw + gap);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(x, 0, bw, h, 2);
      ctx.fill();
      ctx.fillStyle = lit ? "#ffb340" : "rgba(245,245,247,0.85)";
      const bh = Math.max(1, h * v);
      ctx.beginPath();
      ctx.roundRect(x, h - bh, bw, bh, 2);
      ctx.fill();
    }
  });

  return <canvas ref={canvasRef} className="strip-canvas" aria-label="Pressão por cilindro" />;
}

type Summary = {
  speed: string;
  gear: string;
  torque: string;
  power: string;
  manifold: string;
  manifoldLabel: string;
  afr: string;
  load: number;
  steps: number;
};

const ATM = 101325;

function summarize(s: EngineState): Summary {
  const vacuum = s.manifoldPressure < ATM * 0.97;
  return {
    speed: fmt(s.vehicleSpeed * 3.6, 0),
    gear: s.gear < 0 ? "N" : String(s.gear + 1),
    torque: fmt(Math.max(0, s.dynoTorque), 0),
    power: fmt(Math.max(0, units.toCv(s.dynoPower)), 0),
    manifold: fmt(s.manifoldPressure / 1000, 0),
    manifoldLabel: vacuum ? "Vácuo no coletor" : "Coletor",
    afr: s.intakeAfr > 0 ? fmt(s.intakeAfr, 1) : "–",
    load: s.load,
    steps: s.fluidSimulationSteps,
  };
}

/** Speed + gear hero, key metrics with icons and a quiet performance footer. */
export function Readouts() {
  const v = useTelemetry(summarize, 10) ?? summarize(EMPTY_STATE);
  const metrics: { icon: IconName; label: string; value: string; unit: string }[] = [
    { icon: "rotateCw", label: "Torque", value: v.torque, unit: "N·m" },
    { icon: "bolt", label: "Potência", value: v.power, unit: "cv" },
    { icon: "wind", label: v.manifoldLabel, value: v.manifold, unit: "kPa" },
    { icon: "droplet", label: "Mistura ar/comb.", value: v.afr, unit: ":1" },
  ];
  const loadTone = v.load > 0.95 ? "danger" : v.load > 0.8 ? "warn" : "";
  return (
    <>
      <div className="hero">
        <span className="hero-label">
          <Icon name="speedometer" size={14} />
          Velocidade
        </span>
        <span className="hero-value">
          {v.speed}
          <small>km/h</small>
        </span>
      </div>
      <dl className="metrics">
        {metrics.map((m) => (
          <div key={m.icon} className="metric">
            <dt>
              <Icon name={m.icon} size={14} />
              {m.label}
            </dt>
            <dd>
              {m.value}
              <small>{m.unit}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className={`perf ${loadTone}`} title="Quanto do processador a simulação está usando">
        <Icon name="cpu" size={13} />
        <span>
          Simulação usando <b>{fmt(v.load * 100, 0)}%</b> da CPU
        </span>
      </div>
    </>
  );
}

const EMPTY_STATE: EngineState = {
  rpm: 0,
  speedControl: 0,
  throttle: 0,
  manifoldPressure: 101325,
  intakeAfr: 0,
  exhaustO2: 0,
  intakeFlow: 0,
  dynoTorque: 0,
  dynoPower: 0,
  dynoEnabled: false,
  dynoHold: false,
  dynoSpeedRpm: 0,
  starter: false,
  ignition: false,
  gear: -1,
  clutch: 1,
  vehicleSpeed: 0,
  distance: 0,
  fuelConsumed: 0,
  simulationFrequency: 0,
  simulationSpeed: 1,
  fluidSimulationSteps: 8,
  latency: 0,
  levelerGain: 0,
  crankAngles: [],
  cycleAngle: 0,
  cylinders: new Float64Array(0),
  load: 0,
  bufferedSamples: 0,
  underruns: 0,
};
