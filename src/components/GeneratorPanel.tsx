import { useState } from "react";
import {
  configOf,
  configs,
  defaultParams,
  displacementCc,
  firingOrderText,
  type GeneratorParams,
  generateEngine,
  type Layout,
  type VehicleKind,
  vehicles,
} from "../sim/generator";
import { builtinImpulseResponses } from "../sim/sounds";
import { useApp } from "../store";
import { fmt } from "../units";
import { ChoiceList, Icon, Section, Segmented, Select, Slider, TextField } from "./ui";

const LAYOUTS: [Layout, string][] = [
  ["inline", "Em linha"],
  ["v", "Em V"],
  ["boxer", "Boxer"],
];

const STORAGE_KEY = "engine-sim-web:generator";

function loadParams(): GeneratorParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultParams, ...JSON.parse(raw) } : defaultParams;
  } catch {
    return defaultParams;
  }
}

/** Builds an engine from a handful of intuitive parameters. */
export function GeneratorPanel() {
  const loadSpec = useApp((s) => s.loadSpec);
  const status = useApp((s) => s.status);
  const [p, setP] = useState<GeneratorParams>(loadParams);
  const config = configOf(p.configId);
  const layout = config.layout;

  const update = (patch: Partial<GeneratorParams>) => setP((x) => ({ ...x, ...patch }));
  const pickConfig = (id: string) => {
    const c = configOf(id);
    update({
      configId: id,
      vAngle: c.vAngle ?? p.vAngle,
      exhaust: c.layout === "inline" ? "single" : "per-bank",
    });
  };

  const generate = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      // ignore
    }
    void loadSpec(generateEngine(p), `generated:${Date.now()}`);
  };

  const disp = displacementCc(p);

  return (
    <div className="panel">
      <div className="actions">
        <button
          type="button"
          className="pill primary"
          onClick={generate}
          disabled={status === "off"}
        >
          <Icon name="play" size={16} />
          Gerar e ligar este motor
        </button>
      </div>

      <Section title="Arquitetura" icon="boxes">
        <Segmented
          value={layout}
          options={LAYOUTS}
          label="Arquitetura"
          onChange={(l) => pickConfig(configs.find((c) => c.layout === l)?.id ?? p.configId)}
        />
        <ChoiceList
          label="Configuração"
          value={p.configId}
          options={configs
            .filter((c) => c.layout === layout)
            .map((c) => ({ value: c.id, title: c.label, description: c.note }))}
          onChange={pickConfig}
        />
        {layout === "v" && (
          <Slider
            icon="compass"
            label="Ângulo entre as bancadas"
            value={p.vAngle}
            min={15}
            max={120}
            step={1}
            unit="°"
            onChange={(vAngle) => update({ vAngle })}
          />
        )}
        <p className="hint">
          Ordem de ignição: <b>{firingOrderText(config)}</b>
          {layout !== "inline" && ` (cilindros 1–${config.cylinders / 2} na bancada esquerda)`}
        </p>
      </Section>

      <Section title="Cilindros e pistões" icon="cylinder">
        <Slider
          icon="crosshair"
          label="Diâmetro do cilindro"
          value={p.boreMm}
          min={40}
          max={140}
          step={0.5}
          decimals={1}
          unit="mm"
          onChange={(boreMm) => update({ boreMm })}
        />
        <Slider
          icon="ruler"
          label="Curso do pistão"
          value={p.strokeMm}
          min={30}
          max={160}
          step={0.5}
          decimals={1}
          unit="mm"
          onChange={(strokeMm) => update({ strokeMm })}
        />
        <Slider
          icon="spline"
          label="Proporção biela / curso"
          value={p.rodRatio}
          min={1.4}
          max={2.2}
          step={0.01}
          decimals={2}
          onChange={(rodRatio) => update({ rodRatio })}
        />
        <Slider
          icon="layers"
          label="Taxa de compressão"
          value={p.compressionRatio}
          min={6}
          max={15}
          step={0.1}
          decimals={1}
          unit=":1"
          onChange={(compressionRatio) => update({ compressionRatio })}
        />
        <p className="hint">
          {config.cylinders} cilindros · <b>{fmt(disp / 1000, 2)} L</b> (
          {fmt(disp / config.cylinders, 0)} cc por cilindro)
        </p>
      </Section>

      <Section title="Comando e rotação" icon="gauge">
        <Slider
          icon="siren"
          label="Corte de giro"
          value={p.redlineRpm}
          min={2500}
          max={16000}
          step={100}
          unit="rpm"
          onChange={(redlineRpm) => update({ redlineRpm })}
        />
        <Slider
          icon="timer"
          label="Duração do comando (bravura)"
          value={p.camDurationDeg}
          min={180}
          max={290}
          step={1}
          unit="°"
          onChange={(camDurationDeg) => update({ camDurationDeg })}
        />
        <Slider
          icon="trendingUp"
          label="Levante das válvulas"
          value={p.camLiftMm}
          min={5}
          max={16}
          step={0.1}
          decimals={1}
          unit="mm"
          onChange={(camLiftMm) => update({ camLiftMm })}
        />
        <Slider
          icon="orbit"
          label="Separação dos lóbulos"
          value={p.lobeSeparationDeg}
          min={100}
          max={120}
          step={0.5}
          decimals={1}
          unit="°"
          onChange={(lobeSeparationDeg) => update({ lobeSeparationDeg })}
        />
        <Slider
          icon="weight"
          label="Peso do volante"
          value={p.flywheelKg}
          min={1}
          max={30}
          step={0.5}
          decimals={1}
          unit="kg"
          onChange={(flywheelKg) => update({ flywheelKg })}
        />
        <Slider
          icon="hourglass"
          label="Rotação da marcha lenta"
          value={p.idle * 100}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => update({ idle: v / 100 })}
        />
      </Section>

      <Section title="Escapamento e som" icon="speaker">
        {layout !== "inline" && (
          <Segmented
            value={p.exhaust}
            options={[
              ["per-bank", "Um por bancada"],
              ["single", "Unificado"],
            ]}
            onChange={(exhaust) => update({ exhaust })}
          />
        )}
        <Segmented
          value={p.header}
          options={[
            ["equal", "Coletor igual"],
            ["unequal", "Coletor desigual"],
          ]}
          onChange={(header) => update({ header })}
        />
        <Slider
          icon="ruler"
          label="Comprimento do escapamento"
          value={p.exhaustLengthM}
          min={0.3}
          max={6}
          step={0.05}
          decimals={2}
          unit="m"
          onChange={(exhaustLengthM) => update({ exhaustLengthM })}
        />
        <Select
          label="Timbre"
          value={p.impulseResponse}
          options={builtinImpulseResponses.map((ir) => ({
            value: ir.id,
            label: ir.name,
            description: ir.description,
          }))}
          onChange={(impulseResponse) => update({ impulseResponse })}
        />
      </Section>

      <Section title="Veículo e nome" icon="car">
        <Segmented
          value={p.vehicle}
          options={(Object.keys(vehicles) as VehicleKind[]).map((v) => [v, vehicles[v].label])}
          onChange={(vehicle) => update({ vehicle })}
        />
        <TextField label="Nome" value={p.name} onChange={(name) => update({ name })} />
        <div className="row">
          <button type="button" className="pill" onClick={() => setP(defaultParams)}>
            <Icon name="reset" size={16} />
            Voltar aos valores padrão
          </button>
        </div>
      </Section>
    </div>
  );
}
