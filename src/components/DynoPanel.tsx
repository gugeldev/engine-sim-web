import { useEffect, useRef, useState } from "react";
import { useAnimationFrame } from "../hooks/useTelemetry";
import { useApp } from "../store";
import { fmt, units } from "../units";
import { Icon, Section, Slider, SwitchRow } from "./ui";

type Point = { rpm: number; torque: number; power: number };
const BIN = 100;

/**
 * Records torque/power while the dynamometer sweeps the engine and plots the
 * curves. Points are binned by rpm, keeping the latest reading per bin.
 */
export function DynoPanel() {
  const client = useApp((s) => s.client);
  const controls = useApp((s) => s.controls);
  const setControls = useApp((s) => s.setControls);
  const engineName = useApp((s) => s.info?.name ?? "");
  const redline = useApp((s) => s.info?.redlineRpm ?? 7000);
  const points = useRef(new Map<number, Point>());
  const [summary, setSummary] = useState<{ torque: Point | null; power: Point | null }>({
    torque: null,
    power: null,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Clear when the engine changes.
  useEffect(() => {
    void engineName;
    points.current.clear();
    setSummary({ torque: null, power: null });
  }, [engineName]);

  useEffect(() => {
    if (!client) return;
    let lastSummary = 0;
    return client.subscribe((s) => {
      if (!s.dynoEnabled || s.dynoTorque <= 0 || s.rpm < 600) return;
      const bin = Math.round(s.rpm / BIN) * BIN;
      points.current.set(bin, { rpm: bin, torque: s.dynoTorque, power: s.dynoPower });
      const now = performance.now();
      if (now - lastSummary > 250) {
        lastSummary = now;
        let torque: Point | null = null;
        let power: Point | null = null;
        for (const p of points.current.values()) {
          if (!torque || p.torque > torque.torque) torque = p;
          if (!power || p.power > power.power) power = p;
        }
        setSummary({ torque, power });
      }
    });
  }, [client]);

  useAnimationFrame(() => drawChart(canvasRef.current, [...points.current.values()], redline));

  const running = controls.dyno.enabled && !controls.dyno.hold;

  return (
    <div className="panel">
      <Section title="Medir torque e potência" icon="chart">
        <div className="row">
          <button
            type="button"
            className={`pill ${running ? "" : "primary"}`}
            onClick={() => {
              if (running) {
                setControls({ dyno: { enabled: false }, throttle: 0 });
              } else {
                points.current.clear();
                setSummary({ torque: null, power: null });
                setControls({
                  gear: -1,
                  throttle: 1,
                  dyno: { enabled: true, hold: false, autoSweep: true },
                });
              }
            }}
          >
            <Icon name={running ? "stop" : "play"} size={16} />
            {running ? "Parar medição" : "Medir do lento ao corte"}
          </button>
          <button
            type="button"
            className="pill"
            onClick={() => {
              points.current.clear();
              setSummary({ torque: null, power: null });
            }}
          >
            <Icon name="trash" size={16} />
            Apagar gráfico
          </button>
        </div>
        {!controls.ignition && <p className="hint error">Ligue a ignição e dê partida antes.</p>}
      </Section>

      <Section title="Rotação fixa" icon="lock">
        <SwitchRow
          label="Travar o motor numa rotação"
          kbd="H"
          checked={controls.dyno.enabled && controls.dyno.hold}
          onChange={(on) =>
            setControls({
              dyno: { enabled: on, hold: on, autoSweep: false, rpm: controls.dyno.rpm || 3000 },
            })
          }
        />
        {controls.dyno.enabled && controls.dyno.hold && (
          <Slider
            icon="gauge"
            label="Rotação travada"
            value={controls.dyno.rpm || 3000}
            min={500}
            max={Math.ceil(redline / 500) * 500}
            step={100}
            unit="rpm"
            onChange={(rpm) => setControls({ dyno: { rpm } })}
          />
        )}
      </Section>

      <Section title="Resultado" icon="trendingUp">
        <div className="chart">
          <canvas ref={canvasRef} aria-label="Curvas de torque e potência" />
        </div>
        <div className="legend">
          <span>
            <i /> Torque (N·m)
          </span>
          <span>
            <i className="power" /> Potência (cv)
          </span>
        </div>
        <dl className="stats two">
          <div className="stat">
            <dt>Torque máx.</dt>
            <dd>
              {summary.torque ? fmt(summary.torque.torque, 0) : "–"}
              <small>N·m @ {summary.torque ? fmt(summary.torque.rpm, 0) : "–"}</small>
            </dd>
          </div>
          <div className="stat">
            <dt>Potência máx.</dt>
            <dd>
              {summary.power ? fmt(units.toCv(summary.power.power), 0) : "–"}
              <small>cv @ {summary.power ? fmt(summary.power.rpm, 0) : "–"}</small>
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}

function drawChart(canvas: HTMLCanvasElement | null, data: Point[], redline: number) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 34, r: 34, t: 8, b: 20 };
  const maxRpm = Math.ceil((redline * 1.1) / 1000) * 1000;
  const sorted = data.sort((a, b) => a.rpm - b.rpm);
  const maxTorque = Math.max(100, ...sorted.map((p) => p.torque)) * 1.15;
  const maxPower = Math.max(50, ...sorted.map((p) => units.toCv(p.power))) * 1.15;
  const x = (rpm: number) => pad.l + (rpm / maxRpm) * (w - pad.l - pad.r);
  const yT = (v: number) => h - pad.b - (v / maxTorque) * (h - pad.t - pad.b);
  const yP = (v: number) => h - pad.b - (v / maxPower) * (h - pad.t - pad.b);

  ctx.font = '10px "Geist Mono", monospace';
  ctx.fillStyle = "rgba(245,245,247,0.4)";
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  ctx.textAlign = "center";
  for (let r = 0; r <= maxRpm; r += 1000) {
    ctx.beginPath();
    ctx.moveTo(x(r), pad.t);
    ctx.lineTo(x(r), h - pad.b);
    ctx.stroke();
    ctx.fillText(String(r / 1000), x(r), h - 6);
  }
  ctx.textAlign = "right";
  ctx.fillText(fmt(maxTorque / 1.15, 0), pad.l - 4, yT(maxTorque / 1.15) + 3);
  ctx.textAlign = "left";
  ctx.fillText(fmt(maxPower / 1.15, 0), w - pad.r + 4, yP(maxPower / 1.15) + 3);

  const line = (color: string, y: (p: Point) => number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    sorted.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(p.rpm), y(p));
      else ctx.lineTo(x(p.rpm), y(p));
    });
    ctx.stroke();
  };
  line("#f5f5f7", (p) => yT(p.torque));
  line("rgba(245,245,247,0.4)", (p) => yP(units.toCv(p.power)));
}
