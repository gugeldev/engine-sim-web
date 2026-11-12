import { type ReactNode, useState } from "react";
import { Dock, StatusPill } from "./components/Controls";
import { DynoPanel } from "./components/DynoPanel";
import { Engine3D, type ViewPreset } from "./components/Engine3D";
import { EnginePanel } from "./components/EnginePanel";
import { CylinderStrip, Oscilloscope, Readouts, Tachometer } from "./components/Gauges";
import { GeneratorPanel } from "./components/GeneratorPanel";
import { Header } from "./components/Header";
import { SoundPanel } from "./components/SoundPanel";
import { Icon, Segmented } from "./components/ui";
import { useKeyboard } from "./hooks/useKeyboard";
import { useApp } from "./store";

type Tab = "sound" | "create" | "engine" | "dyno";

const TABS: [Tab, ReactNode][] = [
  [
    "sound",
    <>
      <Icon name="waveform" size={15} /> Som
    </>,
  ],
  [
    "create",
    <>
      <Icon name="sparkles" size={15} /> Criar
    </>,
  ],
  [
    "engine",
    <>
      <Icon name="sliders" size={15} /> Ajustar
    </>,
  ],
  [
    "dyno",
    <>
      <Icon name="chart" size={15} /> Dyno
    </>,
  ],
];

function Welcome() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const power = useApp((s) => s.power);
  if (status !== "off" && status !== "starting" && status !== "error") return null;
  return (
    <div className="welcome">
      <div className="welcome-card glass">
        <div>
          <h1>Simulador de motor</h1>
          <p>Pistões, gases e combustão simulados em tempo real — o som vem da física.</p>
        </div>
        <ol className="steps">
          <li>
            <span className="num">1</span>
            <span>
              Ligue a <b>ignição</b>
            </span>
            <span className="keys-hint">
              <kbd>A</kbd>
            </span>
          </li>
          <li>
            <span className="num">2</span>
            <span>
              Segure o <b>arranque</b> até pegar
            </span>
            <span className="keys-hint">
              <kbd>S</kbd>
            </span>
          </li>
          <li>
            <span className="num">3</span>
            <span>
              <b>Acelere</b> e troque marchas
            </span>
            <span className="keys-hint">
              <kbd>W</kbd>
              <kbd>R</kbd>
              <kbd>↑</kbd>
              <kbd>↓</kbd>
            </span>
          </li>
        </ol>
        <button
          type="button"
          className="pill primary lg block"
          onClick={() => void power()}
          disabled={status === "starting"}
        >
          {status === "starting" ? "Carregando…" : "Começar"}
        </button>
        {error && <p className="hint error">Erro: {error}</p>}
      </div>
    </div>
  );
}

export function App() {
  useKeyboard();
  const status = useApp((s) => s.status);
  const [tab, setTab] = useState<Tab>("sound");
  const [sheetOpen, setSheetOpen] = useState(() => window.innerWidth > 1100);
  const [view, setView] = useState<ViewPreset>("iso");
  const [autoRotate, setAutoRotate] = useState(false);

  return (
    <div className="app" data-sheet={sheetOpen ? "open" : "closed"}>
      <Engine3D
        view={view}
        autoRotate={autoRotate}
        insets={{ top: 80, left: 320, right: 384, bottom: 80 }}
      />

      <Header
        sheetOpen={sheetOpen}
        onToggleSheet={() => setSheetOpen((o) => !o)}
        view={view}
        onView={setView}
        autoRotate={autoRotate}
        onAutoRotate={setAutoRotate}
      />
      <StatusPill />

      {status === "loading" && <div className="toast glass">Montando motor…</div>}

      <section className="cluster glass" aria-label="Instrumentos">
        <div className="tach">
          <Tachometer />
        </div>
        <Readouts />
        <div className="traces">
          <div className="trace">
            <span>Pressão nos cilindros</span>
            <CylinderStrip />
          </div>
          <div className="trace">
            <span>Onda sonora</span>
            <Oscilloscope />
          </div>
        </div>
      </section>

      <Dock />

      <aside className="sheet glass" data-open={sheetOpen} aria-label="Configurações">
        <div className="sheet-head">
          <Segmented value={tab} options={TABS} onChange={setTab} label="Seções" />
        </div>
        {tab === "sound" && <SoundPanel />}
        {tab === "create" && <GeneratorPanel />}
        {tab === "engine" && <EnginePanel />}
        {tab === "dyno" && <DynoPanel />}
      </aside>

      <Welcome />
    </div>
  );
}
