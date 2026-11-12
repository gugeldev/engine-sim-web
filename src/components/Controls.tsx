import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useTelemetry } from "../hooks/useTelemetry";
import { useApp } from "../store";
import { fmt } from "../units";
import { GearSelector, Icon, Range } from "./ui";

type Phase = "off" | "ignition" | "cranking" | "running" | "limiter" | "stopping";

/** Derives a single, user-facing engine phase from controls + telemetry. */
export function useEnginePhase(): { phase: Phase; rpm: number } {
  const ignition = useApp((s) => s.controls.ignition);
  const starter = useApp((s) => s.controls.starter);
  const revLimit = useApp((s) => s.spec.ignition.revLimitRpm);
  const rpm = useTelemetry((s) => s.rpm, 8) ?? 0;

  let phase: Phase;
  if (starter) phase = "cranking";
  else if (!ignition) phase = rpm > 60 ? "stopping" : "off";
  else if (rpm < 250) phase = "ignition";
  else if (rpm > revLimit * 0.97) phase = "limiter";
  else phase = "running";
  return { phase, rpm };
}

const COPY: Record<Phase, { title: string; hint: ReactNode }> = {
  off: {
    title: "Desligado",
    hint: (
      <>
        Ligue a ignição <kbd>A</kbd>
      </>
    ),
  },
  ignition: {
    title: "Ignição ligada",
    hint: (
      <>
        Segure o arranque <kbd>S</kbd>
      </>
    ),
  },
  cranking: { title: "Dando partida", hint: "Segure até o motor pegar" },
  running: {
    title: "Funcionando",
    hint: (
      <>
        Acelere <kbd>W</kbd>
        <kbd>R</kbd> · marchas <kbd>↑</kbd>
        <kbd>↓</kbd>
      </>
    ),
  },
  limiter: { title: "Corte de giro", hint: "Alivie ou suba a marcha" },
  stopping: { title: "Desligando", hint: "Ignição cortada" },
};

export function StatusPill() {
  const { phase, rpm } = useEnginePhase();
  const status = useApp((s) => s.status);
  if (status !== "running") return null;
  const copy = COPY[phase];
  return (
    <div
      className="status glass"
      data-state={phase === "stopping" ? "off" : phase}
      role="status"
      aria-live="polite"
    >
      <span className="status-light" />
      <span className="status-title">{copy.title}</span>
      {(phase === "running" || phase === "limiter") && (
        <span className="status-rpm">{fmt(rpm, 0)} rpm</span>
      )}
      <span className="status-sub">{copy.hint}</span>
    </div>
  );
}

function holdHandlers(on: () => void, off: () => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      on();
    },
    onPointerUp: off,
    onPointerCancel: off,
    onKeyDown: (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) on();
    },
    onKeyUp: (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") off();
    },
  };
}

/** Primary controls in a single glass capsule. */
export function Dock() {
  const controls = useApp((s) => s.controls);
  const setControls = useApp((s) => s.setControls);
  const gears = useApp((s) => s.info?.gears ?? 0);
  const { phase } = useEnginePhase();

  return (
    <div className="dock glass" role="toolbar" aria-label="Controles do motor">
      <button
        type="button"
        className={`key ignition ${phase === "off" ? "attention" : ""}`}
        aria-pressed={controls.ignition}
        title="Ignição (A)"
        onClick={() => setControls({ ignition: !controls.ignition })}
      >
        <Icon name="key" />
        <span>Ignição</span>
        <span className="led" />
      </button>
      <button
        type="button"
        className={`key starter ${phase === "ignition" ? "attention" : ""}`}
        aria-pressed={controls.starter}
        title="Partida — segure (S)"
        {...holdHandlers(
          () => setControls({ starter: true }),
          () => setControls({ starter: false }),
        )}
      >
        <Icon name="starter" />
        <span>Partida</span>
      </button>

      <div className="throttle">
        <Icon name="gauge" />
        <Range
          big
          label="Acelerador"
          value={controls.throttle * 100}
          min={0}
          max={100}
          step={0.5}
          onChange={(v) => setControls({ throttle: v / 100 })}
        />
        <span className="throttle-value">{Math.round(controls.throttle * 100)}%</span>
      </div>

      <span className="dock-divider" />

      <GearSelector
        value={controls.gear}
        gears={gears}
        onChange={(gear) => setControls({ gear })}
      />
      <button
        type="button"
        className="key clutch icon-only"
        aria-label="Embreagem"
        aria-pressed={controls.clutch < 0.5}
        title="Embreagem — segure (Shift)"
        {...holdHandlers(
          () => setControls({ clutch: 0 }),
          () => setControls({ clutch: 1 }),
        )}
      >
        <Icon name="clutch" />
      </button>
    </div>
  );
}
