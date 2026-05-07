import { useEffect, useRef, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type { ProductDisplayMode, ThemeId, UserSettings } from '@/shared/types';
import { validatePayload } from '@/services/import-export';
import type { ImportSummary } from '@/services/import-export';
import { THEMES } from '@/shared/themes';

const INTERVAL_OPTIONS: { value: UserSettings['updateInterval']; label: string }[] = [
  { value: 15, label: '15 мин' },
  { value: 30, label: '30 мин' },
  { value: 60, label: 'раз в час' },
  { value: 180, label: 'раз в 3 часа' },
  { value: 360, label: 'раз в 6 часов' },
  { value: 720, label: 'раз в 12 часов' },
  { value: 1440, label: 'раз в сутки' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface Props {
  /** Notified after every successful patch — used to refresh dependent UI (e.g. sidebar timer). */
  onSettingsSaved?: () => void;
}

export function SettingsPage({ onSettingsSaved }: Props = {}) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Schedule (interval + dailyAtHour) is buffered locally and only sent to the
  // background when the user clicks «Применить». Other toggles still apply
  // immediately because their effect is local-only.
  const [pendingInterval, setPendingInterval] = useState<UserSettings['updateInterval']>(60);
  const [pendingDailyHour, setPendingDailyHour] = useState<number | null>(null);

  useEffect(() => {
    void sendRpc('settings/get', {}).then((resp) => {
      setSettings(resp.settings);
      setPendingInterval(resp.settings.updateInterval);
      setPendingDailyHour(resp.settings.dailyAtHour);
    });
  }, []);

  async function patch(patch: Partial<Omit<UserSettings, 'id'>>) {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    const resp = await sendRpc('settings/update', { patch });
    setSettings(resp.settings);
    setSavedAt(Date.now());
    onSettingsSaved?.();
  }

  async function applySchedule() {
    if (!settings) return;
    await patch({ updateInterval: pendingInterval, dailyAtHour: pendingDailyHour });
  }

  function resetSchedule() {
    if (!settings) return;
    setPendingInterval(settings.updateInterval);
    setPendingDailyHour(settings.dailyAtHour);
  }

  const scheduleDirty =
    settings != null &&
    (pendingInterval !== settings.updateInterval || pendingDailyHour !== settings.dailyAtHour);

  function pickInterval(value: UserSettings['updateInterval']) {
    setPendingInterval(value);
    if (value === 1440) {
      // Daily mode — default to 9:00 if user hasn't picked an hour yet.
      setPendingDailyHour((cur) => (cur == null ? 9 : cur));
    } else {
      setPendingDailyHour(null);
    }
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
          Тумблеры применяются сразу. Расписание — только по нажатию «Применить».
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
              description="Запускает периодический пересчёт цен в фоне для всех маркетплейсов (Ozon и Я.Маркет — через тихую закреплённую вкладку, Wildberries — через JSON-API)."
              checked={settings.scheduledUpdates}
              onChange={(v) => void patch({ scheduledUpdates: v })}
            />

            <div
              className={`rounded-md border p-4 ${
                settings.scheduledUpdates ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50/50 opacity-60'
              }`}
            >
              <div className="text-sm font-medium text-slate-900">Расписание</div>
              <p className="mt-0.5 text-xs text-slate-500">
                Выбери «раз в сутки» — появится поле для часа. Изменения применяются после нажатия «Применить».
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {INTERVAL_OPTIONS.map((opt) => {
                  const selected = pendingInterval === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!settings.scheduledUpdates}
                      onClick={() => pickInterval(opt.value)}
                      className={`rounded-md border px-3 py-2 text-sm transition ${
                        selected
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      } ${!settings.scheduledUpdates ? 'cursor-not-allowed' : ''}`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {pendingDailyHour != null && (
                <div className="mt-3 flex items-center gap-2">
                  <label className="text-sm text-slate-700">Час:</label>
                  <select
                    disabled={!settings.scheduledUpdates}
                    value={pendingDailyHour}
                    onChange={(e) => setPendingDailyHour(Number(e.target.value))}
                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed"
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-500">локальное время</span>
                </div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                {scheduleDirty && (
                  <button
                    type="button"
                    onClick={resetSchedule}
                    disabled={!settings.scheduledUpdates}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Отменить
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void applySchedule()}
                  disabled={!settings.scheduledUpdates || !scheduleDirty}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Применить
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Внешний вид
          </h2>
          <div className="mt-4 space-y-4">
            <ThemePicker
              value={settings.theme}
              onChange={(theme) => void patch({ theme })}
            />

            <DisplayModePicker
              value={settings.displayMode}
              onChange={(displayMode) => void patch({ displayMode })}
            />

            <Toggle
              label="Цветные метки маркетплейсов"
              description="Показывать цветную полосу слева у каждого товара и подсвеченную плашку маркетплейса в подписи (Ozon — синий, Wildberries — розовый, Я.Маркет — жёлтый)."
              checked={settings.marketplaceColorCoding}
              onChange={(v) => void patch({ marketplaceColorCoding: v })}
            />
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

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
}) {
  const lights = THEMES.filter((t) => t.variant === 'light');
  const darks = THEMES.filter((t) => t.variant === 'dark');
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-900">Тема оформления</div>
      <p className="mt-0.5 text-xs text-slate-500">
        10 палитр на выбор: 5 светлых и 5 тёмных. «Авто» подстраивается под системные
        настройки.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <ThemeChip
          id="auto"
          label="Авто"
          swatches={['#f8fafc', '#0f172a']}
          active={value === 'auto'}
          onClick={() => onChange('auto')}
        />
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Светлые
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {lights.map((t) => (
            <ThemeChip
              key={t.id}
              id={t.id}
              label={t.label}
              swatches={t.swatches}
              active={value === t.id}
              onClick={() => onChange(t.id)}
            />
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Тёмные
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {darks.map((t) => (
            <ThemeChip
              key={t.id}
              id={t.id}
              label={t.label}
              swatches={t.swatches}
              active={value === t.id}
              onClick={() => onChange(t.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeChip({
  label,
  swatches,
  active,
  onClick,
}: {
  id: ThemeId;
  label: string;
  swatches: [string, string];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition ${
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
      }`}
    >
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 overflow-hidden rounded border border-slate-200"
      >
        <span className="block h-full w-1/2" style={{ background: swatches[0] }} />
        <span className="block h-full w-1/2" style={{ background: swatches[1] }} />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function DisplayModePicker({
  value,
  onChange,
}: {
  value: ProductDisplayMode;
  onChange: (m: ProductDisplayMode) => void;
}) {
  const opts: { v: ProductDisplayMode; label: string; desc: string }[] = [
    { v: 'list',  label: 'Список',  desc: 'Плотные строки — больше товаров на экране.' },
    { v: 'cards', label: 'Каталог', desc: 'Крупные карточки с превью и ценой.' },
    { v: 'grid',  label: 'Сетка',   desc: 'Двухколоночная плитка с большим изображением.' },
  ];
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-900">Отображение списка товаров</div>
      <p className="mt-0.5 text-xs text-slate-500">
        Можно переключать прямо из заголовка списка — этот выбор синхронизирован.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {opts.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <div className="font-medium">{o.label}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{o.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
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
