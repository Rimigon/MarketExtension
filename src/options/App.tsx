import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { UserSettings } from '@/shared/types';

const INTERVAL_OPTIONS: { value: UserSettings['updateInterval']; label: string }[] = [
  { value: 15, label: 'каждые 15 минут' },
  { value: 30, label: 'каждые 30 минут' },
  { value: 60, label: 'раз в час' },
  { value: 180, label: 'раз в 3 часа' },
];

export function App() {
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
    return <div className="p-8 text-sm text-slate-500">Загрузка…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold">PriceWatch · Настройки</h1>
        <p className="mt-1 text-sm text-slate-500">
          Параметры сохраняются автоматически и применяются сразу.
        </p>
      </header>

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

      <footer className="mt-10 flex items-center justify-between border-t border-slate-200 pt-4 text-xs text-slate-500">
        <a href="../dashboard/index.html" className="text-brand-500 hover:underline">
          Открыть dashboard ↗
        </a>
        {savedAt && <span>Сохранено</span>}
      </footer>
    </div>
  );
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
