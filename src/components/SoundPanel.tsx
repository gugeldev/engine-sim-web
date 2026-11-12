import { useRef, useState } from "react";
import { addCustomImpulseResponse, removeCustomImpulseResponse } from "../sim/sounds";
import type { ExhaustSpec } from "../sim/spec";
import { useApp } from "../store";
import { Icon, Section, Select, Slider } from "./ui";

export function SoundPanel() {
  const audio = useApp((s) => s.audio);
  const setAudio = useApp((s) => s.setAudio);
  const resetAudio = useApp((s) => s.resetAudio);
  const spec = useApp((s) => s.spec);

  if (!audio) return <div className="panel-empty">Ligue o simulador para ajustar o som.</div>;

  return (
    <div className="panel">
      <Section
        title="Mixagem"
        icon="sliders"
        actions={
          <button type="button" className="link" onClick={resetAudio}>
            Restaurar
          </button>
        }
      >
        <Slider
          icon="volume"
          label="Volume do motor"
          value={audio.volume}
          min={0}
          max={2}
          step={0.01}
          decimals={2}
          onChange={(volume) => setAudio({ volume })}
        />
        <Slider
          icon="waves"
          label="Ressonância do escapamento"
          value={audio.convolution * 100}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setAudio({ convolution: v / 100 })}
        />
        <Slider
          icon="sparkles"
          label="Estalos e aspereza"
          value={audio.highFreqGain}
          min={0.0005}
          max={0.5}
          log
          decimals={4}
          onChange={(highFreqGain) => setAudio({ highFreqGain })}
        />
        <Slider
          icon="wind"
          label="Sopro do ar"
          value={audio.airNoise * 100}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setAudio({ airNoise: v / 100 })}
        />
        <Slider
          icon="audioLines"
          label="Tom do sopro"
          value={audio.airNoiseCutoff}
          min={200}
          max={10000}
          log
          unit="Hz"
          onChange={(airNoiseCutoff) => setAudio({ airNoiseCutoff })}
        />
        <Slider
          icon="activity"
          label="Irregularidade das explosões"
          value={audio.jitter * 100}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setAudio({ jitter: v / 100 })}
        />
        <Slider
          icon="scale"
          label="Volume nivelado (compressor)"
          value={audio.levelerTarget}
          min={2000}
          max={32000}
          step={500}
          onChange={(levelerTarget) => setAudio({ levelerTarget })}
        />
      </Section>

      {spec.exhausts.map((ex, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: exhausts are positional
        <ExhaustSound key={i} index={i} exhaust={ex} />
      ))}

      <ExhaustGeometry />
    </div>
  );
}

function ExhaustSound({ index, exhaust }: { index: number; exhaust: ExhaustSpec }) {
  const library = useApp((s) => s.impulseLibrary);
  const setExhaustSound = useApp((s) => s.setExhaustSound);
  const refreshLibrary = useApp((s) => s.refreshImpulseLibrary);
  const exhaustCount = useApp((s) => s.spec.exhausts.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const current = library.find((ir) => ir.id === exhaust.impulseResponse);
  const builtins = library.filter((ir) => !ir.custom);

  const apply = (id: string, volume: number, allExhausts: boolean) => {
    if (allExhausts) {
      for (let k = 0; k < exhaustCount; k++) setExhaustSound(k, id, volume);
    } else {
      setExhaustSound(index, id, volume);
    }
  };

  const onUpload = async (file: File) => {
    setError(null);
    try {
      const info = await addCustomImpulseResponse(file);
      await refreshLibrary();
      apply(info.id, info.defaultVolume, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Section
      title={exhaustCount > 1 ? `Timbre do escape ${index + 1}` : "Timbre do escape"}
      icon="speaker"
    >
      <Select
        label="Timbre"
        value={exhaust.impulseResponse}
        options={library.map((ir) => ({
          value: ir.id,
          label: ir.name,
          group: ir.custom ? "Seus sons" : "Biblioteca",
        }))}
        onChange={(id) => {
          const ir = library.find((x) => x.id === id);
          if (ir) apply(ir.id, ir.defaultVolume, false);
        }}
      />
      <Slider
        icon="volume"
        label="Intensidade do timbre"
        value={exhaust.impulseVolume}
        min={0.0001}
        max={0.1}
        log
        decimals={4}
        onChange={(v) => setExhaustSound(index, exhaust.impulseResponse, v)}
      />
      <div className="row">
        {exhaustCount > 1 && (
          <button
            type="button"
            className="pill"
            onClick={() => apply(exhaust.impulseResponse, exhaust.impulseVolume, true)}
          >
            <Icon name="copy" size={16} />
            Usar em todos os escapes
          </button>
        )}
        <button type="button" className="pill" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} />
          Importar timbre (.wav)
        </button>
        {current?.custom && (
          <button
            type="button"
            className="pill danger"
            onClick={async () => {
              await removeCustomImpulseResponse(current.id);
              await refreshLibrary();
              const fallback = builtins[0];
              apply(fallback.id, fallback.defaultVolume, false);
            }}
          >
            <Icon name="trash" size={16} />
            Excluir este timbre
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file);
          e.target.value = "";
        }}
      />
      {error && <p className="hint error">{error}</p>}
    </Section>
  );
}

/** Exhaust geometry changes the physics, so it needs the engine to be rebuilt. */
function ExhaustGeometry() {
  const spec = useApp((s) => s.spec);
  const sourceId = useApp((s) => s.sourceId);
  const loadSpec = useApp((s) => s.loadSpec);
  const [draft, setDraft] = useState<ExhaustSpec[] | null>(null);
  const exhausts = draft ?? spec.exhausts;

  const edit = (i: number, patch: Partial<ExhaustSpec>) => {
    setDraft(exhausts.map((ex, k) => (k === i ? { ...ex, ...patch } : ex)));
  };

  return (
    <Section title="Tubulação do escape" icon="route">
      {exhausts.map((ex, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: exhausts are positional
        <div key={i} className="sub">
          {exhausts.length > 1 && <h4>Escape {i + 1}</h4>}
          <Slider
            icon="ruler"
            label="Comprimento do escapamento"
            value={ex.lengthMm / 1000}
            min={0.3}
            max={8}
            step={0.05}
            decimals={2}
            unit="m"
            onChange={(v) => edit(i, { lengthMm: v * 1000 })}
          />
          <Slider
            icon="volume"
            label="Volume deste escape"
            value={ex.audioVolume}
            min={0.1}
            max={20}
            step={0.1}
            decimals={1}
            onChange={(audioVolume) => edit(i, { audioVolume })}
          />
          <Slider
            icon="fan"
            label="Abertura do abafador"
            value={ex.outletFlowCfm}
            min={100}
            max={3000}
            step={10}
            unit="cfm"
            onChange={(outletFlowCfm) => edit(i, { outletFlowCfm })}
          />
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          className="pill primary"
          disabled={!draft}
          onClick={() => {
            if (!draft) return;
            void loadSpec({ ...spec, exhausts: draft }, sourceId);
            setDraft(null);
          }}
        >
          <Icon name="check" size={16} />
          Aplicar e reiniciar o motor
        </button>
        {draft && (
          <button type="button" className="pill" onClick={() => setDraft(null)}>
            <Icon name="undo" size={16} />
            Descartar
          </button>
        )}
      </div>
    </Section>
  );
}
