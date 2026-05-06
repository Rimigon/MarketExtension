import { useEffect, useRef, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { UserSettings } from '@/shared/types';
import { validatePayload } from '@/services/import-export';
import type { ImportSummary } from '@/services/import-export';

const INTERVAL_OPTIONS: { value: UserSettings['updateInterval']; label: string }[] = [
  { value: 15, label: 'каждые 15 минут' },
  { value: 30, label: 'каждые 30 минут' },
  { value: 60, label: 'раз в час' },
  { value: 180, label: 'раз в 3 часа' },
];

export function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void sendRpc('settings/get', {}).then((resp) => setSettings(resp.settings));
  }, []);

  async function patch(patch: Partial<Omit<UserSettings, 'id'>>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    const resp = await sendRpc('settings/update', { patch });
    setSettings(resp.settings);
    setSavedAt(Date.now());
  }

  if (!settings) {
    return (
      <div className="col-span-2 flex items-center justify-center text-sm text-slate-500">
        Загрузка…
      </div>
    );
  }

  return (
    <div className="col-span-2 overflow-y-auto bg-slate-50 px-8 py-6">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-xl font-semibold text-slate-900">Настройки</h1>
        <p className="mt-1 text-sm text-slate-500">
          Параметры сохраняются автоматически и применяются сразу.
        </p>
      </header>

      <div className="mx-auto max-w-2xl">
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Обновление цен
          </h2>

          <div className="mt-4 space-y-4">
            <Toggle
              label="Обновлять при заходе на карточку"
              description="Когда вы открываете страницу отслеживаемого товара, цена тихо подтягивается и записывается в историю."
              checked={settings.passiveUpdates}
              onChange={(v) => void patch({ passiveUpdates: v })}
            />

            <Toggle
              label="Фоновое обновление"
              description="Запускает периодический пересчёт цен в фоне. Сейчас работает для Wildberries (через JSON-API). Для Ozon и Я.Маркета фон будет включён в следующем релизе — пока такие товары обновляются только при заходе."
              checked={settings.scheduledUpdates}
              onChange={(v) => void patch({ scheduledUpdates: v })}
            />

            <div
              className={`rounded-md border p-4 ${
                settings.scheduledUpdates ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50/50 opacity-60'
              }`}
            >
              <div className="text-sm font-medium text-slate-900">Частота фонового обновления</div>
              <p className="mt-0.5 text-xs text-slate-500">
                Слишком частые проверки могут перегрузить маркетплейс. Реальная частота немного варьируется (±20% jitter), чтобы запросы шли неравномерно.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!settings.scheduledUpdates}
                    onClick={() => void patch({ updateInterval: opt.value })}
                    className={`rounded-md border px-3 py-2 text-sm transition ${
                      settings.updateInterval === opt.value
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    } ${!settings.scheduledUpdates ? 'cursor-not-allowed' : ''}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Уведомления
          </h2>
          <div className="mt-4 space-y-4">
            <NumericField
              label="Максимум уведомлений в час"
              value={settings.maxNotificationsPerHour}
              onChange={(v) => void patch({ maxNotificationsPerHour: v })}
              min={0}
              max={50}
              description="Если уведомлений больше — лишние сольются в дайджест (V1)."
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Данные
          </h2>
          <div className="mt-4">
            <DataImportExport />
          </div>
        </section>

        <footer className="mt-10 flex items-center justify-end border-t border-slate-200 pt-4 text-xs text-slate-500">
          {savedAt && <span>Сохранено</span>}
        </footer>
      </div>
    </div>
  );
}

function DataImportExport() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function handleExport() {
    setBusy(true);
    setMessage(null);
    try {
      const { payload } = await sendRpc('data/export', {});
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      a.download = `pricewatch-export-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage({
        tone: 'ok',
        text: `Экспортировано: ${payload.products.length} товаров, ${payload.pricePoints.length} точек истории.`,
      });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const payload = validatePayload(raw);
      const { summary } = await sendRpc('data/import', { payload });
      setMessage({ tone: 'ok', text: summarize(summary) });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-900">Резервная копия</div>
      <p className="mt-0.5 text-xs text-slate-500">
        Экспорт записывает товары, всю историю цен, события, коллекции и правила уведомлений в один JSON-файл.
        Импорт добавляет недостающие записи; существующие товары не перезаписываются.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={busy}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Экспорт JSON
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300 disabled:opacity-50"
        >
          Импорт JSON…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      {message && (
        <p
          className={`mt-3 text-xs ${
            message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function summarize(s: ImportSummary): string {
  const parts: string[] = [];
  parts.push(`Добавлено товаров: ${s.productsAdded}`);
  if (s.productsSkipped > 0) parts.push(`пропущено как дубли: ${s.productsSkipped}`);
  parts.push(`точек истории: ${s.pricePointsAdded}`);
  if (s.collectionsAdded > 0) parts.push(`коллекций: ${s.collectionsAdded}`);
  if (s.rulesAdded > 0) parts.push(`правил: ${s.rulesAdded}`);
  return parts.join(', ') + '.';
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white p-4 hover:border-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
      </div>
    </label>
  );
}

function NumericField({
  label,
  value,
  onChange,
  min,
  max,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  description?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>
      {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
    </div>
  );
}
