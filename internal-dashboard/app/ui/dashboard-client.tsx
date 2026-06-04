"use client";

import { useMemo, useState } from "react";

type Signal = {
  id: string;
  company: string;
  vertical: string;
  location: string;
  trigger: string;
  evidenceUrl: string;
  urgency: number;
  confidence: number;
  relevance: string;
};

type Data = {
  summary: Record<string, number>;
  signals: Signal[];
};

type EngineResult = {
  ranAt: string;
  count: number;
  logs: string[];
  candidates: Array<Record<string, unknown>>;
  error?: string;
};

const AGENTS = [
  ["Signal Acquisition", "Finds freight-relevant public movement."],
  ["Scoring", "Ranks urgency, confidence, and freight relevance."],
  ["Lane/Need", "Infers likely logistics need and service fit."],
  ["Contact/Org", "Maps buyer role and access path."],
  ["Outbound Angle", "Creates sales-ready positioning."],
  ["Compliance", "Blocks overclaims and bad-fit sources."],
  ["Strategic Edge", "Finds repeatable territory and vertical patterns."],
  ["CEO/Mastermind", "Controls pricing, vertical focus, and scale decisions."]
];

export default function DashboardClient({ initialData }: { initialData: Data }) {
  const [data, setData] = useState<Data>(initialData);
  const [engine, setEngine] = useState<EngineResult | null>(null);
  const [running, setRunning] = useState(false);

  const topSignals = useMemo(
    () => [...(data.signals ?? [])].sort((a, b) => b.urgency - a.urgency).slice(0, 12),
    [data.signals]
  );

  async function refresh() {
    const response = await fetch("/api/summary");
    setData(await response.json());
  }

  async function runEngine() {
    setRunning(true);
    setEngine(null);
    try {
      const response = await fetch("/api/engine/run", { method: "POST" });
      setEngine(await response.json());
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">FT</span>
          <span>FreightTrigger Ops</span>
        </div>
        <span>Faceless signal intelligence cockpit</span>
      </header>

      <div className="container">
        <section className="hero">
          <div>
            <p className="eyebrow">Internal operator dashboard</p>
            <h1>Signal engine control room.</h1>
            <p>
              Review seeded intelligence, monitor Airtable records, run the first-pass
              signal engine, and keep noisy sources out before paid reports go out.
            </p>
          </div>
          <div>
            <button className="button" onClick={runEngine} disabled={running}>
              {running ? "Engine running..." : "Run signal engine"}
            </button>{" "}
            <button className="button secondary" onClick={refresh}>
              Refresh Airtable
            </button>
          </div>
        </section>

        <section className="grid">
          {Object.entries(data.summary ?? {}).map(([table, count]) => (
            <div className="stat" key={table}>
              <span>{table}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </section>

        <section className="two-col">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Seeded signal database</h2>
                <p>Top Airtable records currently available for report generation.</p>
              </div>
            </div>
            <div className="signals">
              {topSignals.map((signal) => (
                <div className="signal-row" key={signal.id}>
                  <div>
                    <strong>{signal.company}</strong>
                    <p>{signal.vertical} · {signal.location}</p>
                  </div>
                  <div>
                    <strong>{signal.trigger}</strong>
                    <p><a href={signal.evidenceUrl} target="_blank" rel="noreferrer">Evidence URL</a></p>
                  </div>
                  <div>
                    <span className="pill">{signal.relevance}</span>
                  </div>
                  <div>
                    <span className="pill amber">Urgency {signal.urgency}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Agent team</h2>
                <p>The internal operating roles behind the engine.</p>
              </div>
            </div>
            <div className="agent-list">
              {AGENTS.map(([name, detail]) => (
                <div key={name}>
                  <strong>{name}</strong>
                  <span>{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Latest engine run</h2>
              <p>Candidate output stays review-first until the filter rules are stable.</p>
            </div>
            {engine?.ranAt ? <span className="pill">Ran {new Date(engine.ranAt).toLocaleString()}</span> : null}
          </div>
          <pre className="engine-output">
            {engine
              ? JSON.stringify(engine, null, 2)
              : "No engine run in this browser session yet."}
          </pre>
        </section>
      </div>
    </main>
  );
}
