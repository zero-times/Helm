import { healthResponseSchema, type HealthResponse } from '@helm/contracts';
import { useEffect, useState } from 'react';

type ApiState =
  | { status: 'checking' }
  | { status: 'connected'; health: HealthResponse }
  | { status: 'unavailable' };

export function App() {
  const [api, setApi] = useState<ApiState>({ status: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const response = await fetch('/api/health/live', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Health check returned ${response.status}`);

        const health = healthResponseSchema.parse(await response.json());
        setApi({ status: 'connected', health });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setApi({ status: 'unavailable' });
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  const statusLabel =
    api.status === 'connected'
      ? 'API connected'
      : api.status === 'checking'
        ? 'Checking API'
        : 'API unavailable';

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="foundation-title">
        <div className="eyebrow">
          <span className={`status-dot status-dot--${api.status}`} aria-hidden />
          <span>{statusLabel}</span>
        </div>

        <p className="product-mark">HELM / PHASE 0</p>
        <h1 id="foundation-title">Helm foundation ready</h1>
        <p className="lede">
          A typed modular monolith with explicit health, data, and quality
          boundaries. Business workflows arrive in the next layer.
        </p>

        <dl className="signals">
          <div>
            <dt>Web</dt>
            <dd>React + Vite</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>Fastify + Pino</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>PostgreSQL + Drizzle</dd>
          </div>
        </dl>

        {api.status === 'connected' ? (
          <p className="build-note">Server contract {api.health.version}</p>
        ) : null}
      </section>
    </main>
  );
}
