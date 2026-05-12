import { useEffect, useRef, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import type {
  NotificationRule,
  NotificationTrigger,
  ProductDisplayMode,
  ThemeId,
  UserSettings,
} from '@/shared/types';
import { validatePayload } from '@/services/import-export';
import type { ImportSummary } from '@/services/import-export';
import { THEMES } from '@/shared/themes';
import { formatPrice } from '@/shared/format';

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
    <div className="col-span-2 overflow-y-auto overscroll-contain bg-slate-50 px-8 py-6">
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
              description="Когда лимит превышен, уведомления продолжают сохраняться в журнале (бейдж на иконке растёт), но всплывающие уведомления Windows подавляются. 0 — без лимита."
            />

            <QuietHoursPanel
              value={settings.quietHours}
              onChange={(quietHours) => void patch({ quietHours })}
            />

            <Toggle
              label="Дайджест-режим"
              description="После каждой плановой проверки приходит одно общее уведомление со сводкой (например, «Обновлено 5/8 · 2 ↓, 1 ↑»). Отдельных всплывающих по минимумам/скидкам не будет — события всё равно сохраняются в ленте и на бейдже. Работает только если выше включено «Плановые обновления»."
              checked={settings.digestEnabled}
              onChange={(v) => void patch({ digestEnabled: v })}
            />

            <ExcludedDomainsPanel
              value={settings.excludedDomains}
              onChange={(excludedDomains) => void patch({ excludedDomains })}
            />

            <NotificationRulesPanel />
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

function QuietHoursPanel({
  value,
  onChange,
}: {
  value: { from: string; to: string } | null;
  onChange: (v: { from: string; to: string } | null) => void;
}) {
  const enabled = value != null;
  // Local draft so the user can type a partial time without immediately
  // round-tripping a half-formed value through settings storage.
  const [draft, setDraft] = useState({ from: value?.from ?? '23:00', to: value?.to ?? '08:00' });

  useEffect(() => {
    if (value) setDraft(value);
  }, [value]);

  function commit(next: { from: string; to: string }) {
    if (!isValidHHMM(next.from) || !isValidHHMM(next.to)) return;
    onChange(next);
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? draft : null)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">Тихие часы</div>
          <p className="mt-0.5 text-xs text-slate-500">
            В это время уведомления будут сохраняться в журнал, но без всплывающих
            окон ОС. Поддерживается переход через полночь (22:00 → 08:00).
          </p>
        </div>
      </label>
      {enabled && (
        <div className="mt-3 flex items-center gap-2 pl-7">
          <span className="text-sm text-slate-700">с</span>
          <input
            type="time"
            value={draft.from}
            onChange={(e) => {
              const next = { ...draft, from: e.target.value };
              setDraft(next);
              commit(next);
            }}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
          <span className="text-sm text-slate-700">до</span>
          <input
            type="time"
            value={draft.to}
            onChange={(e) => {
              const next = { ...draft, to: e.target.value };
              setDraft(next);
              commit(next);
            }}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">локальное время</span>
        </div>
      )}
    </div>
  );
}

function isValidHHMM(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s);
}

function ExcludedDomainsPanel({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState('');

  function add() {
    const cleaned = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!cleaned) return;
    if (value.includes(cleaned)) {
      setInput('');
      return;
    }
    onChange([...value, cleaned]);
    setInput('');
  }

  function remove(d: string) {
    onChange(value.filter((x) => x !== d));
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-900">Исключённые домены</div>
      <p className="mt-0.5 text-xs text-slate-500">
        Уведомления для товаров с этих доменов не будут срабатывать совсем —
        ни всплывающих, ни записи в журнал. Полезно, чтобы временно заглушить
        целый маркетплейс. Введите host (например, <code>www.ozon.ru</code>);
        совпадение проверяется и по поддоменам.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="например, ozon.ru"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={input.trim() === ''}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Добавить
        </button>
      </div>
      {value.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {value.map((d) => (
            <li key={d}>
              <button
                type="button"
                onClick={() => remove(d)}
                title="Убрать из списка"
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
              >
                {d}
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Пусто — уведомления приходят со всех доменов.</p>
      )}
    </div>
  );
}

/* --------------------------- notification rules --------------------------- */

const TRIGGER_OPTIONS: { value: NotificationTrigger['kind']; label: string; needsValue: boolean }[] = [
  { value: 'dropPct',          label: 'Падение цены на %',           needsValue: true  },
  { value: 'dropAbs',          label: 'Падение цены на ₽',           needsValue: true  },
  { value: 'priceBelow',       label: 'Цена ниже значения, ₽',       needsValue: true  },
  { value: 'discountAppeared', label: 'Появилась скидка',            needsValue: false },
  { value: 'backInStock',      label: 'Снова в наличии',             needsValue: false },
  { value: 'historicalLow',    label: 'Исторический минимум',        needsValue: false },
];

function NotificationRulesPanel() {
  const [rules, setRules] = useState<NotificationRule[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    const resp = await sendRpc('notificationRules/list', {});
    setRules(resp.rules);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function saveRule(rule: NotificationRule | (Omit<NotificationRule, 'id'> & { id?: string })) {
    await sendRpc('notificationRules/upsert', { rule });
    await reload();
  }

  async function removeRule(id: string) {
    if (!confirm('Удалить это правило?')) return;
    await sendRpc('notificationRules/remove', { id });
    await reload();
  }

  if (rules == null) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Загрузка правил…
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900">Правила уведомлений</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Глобальные правила применяются ко всем отслеживаемым товарам. Если
            ни одно правило не сработает — уведомление не придёт. Между
            повторными срабатываниями одного правила соблюдается «кулдаун» в
            минутах.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300"
        >
          + Добавить
        </button>
      </div>

      <ul className="mt-3 divide-y divide-slate-100">
        {rules.length === 0 && !adding && (
          <li className="py-3 text-xs text-slate-400">
            Правил пока нет. Уведомления приходить не будут.
          </li>
        )}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            onSave={saveRule}
            onRemove={() => removeRule(r.id)}
          />
        ))}
        {adding && (
          <li className="py-3">
            <RuleEditor
              initial={null}
              onCancel={() => setAdding(false)}
              onSubmit={async (draft) => {
                await saveRule(draft);
                setAdding(false);
              }}
            />
          </li>
        )}
      </ul>
    </div>
  );
}

function RuleRow({
  rule,
  onSave,
  onRemove,
}: {
  rule: NotificationRule;
  onSave: (r: NotificationRule) => Promise<void>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="py-3">
        <RuleEditor
          initial={rule}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            await onSave({ ...draft, id: rule.id });
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => void onSave({ ...rule, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
          title={rule.enabled ? 'Выключить' : 'Включить'}
        />
        <div className={`min-w-0 ${rule.enabled ? '' : 'opacity-50'}`}>
          <div className="text-sm text-slate-900">{describeTrigger(rule.trigger)}</div>
          <div className="text-[11px] text-slate-500">
            кулдаун {formatCooldown(rule.cooldownMinutes)}
            {rule.scope.kind === 'product' && ' · только для конкретного товара'}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          Изменить
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
        >
          Удалить
        </button>
      </div>
    </li>
  );
}

function RuleEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: NotificationRule | null;
  onSubmit: (rule: Omit<NotificationRule, 'id'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<NotificationTrigger['kind']>(
    initial?.trigger.kind ?? 'dropPct',
  );
  const [value, setValue] = useState<string>(() => initialValueString(initial?.trigger));
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(
    initial?.cooldownMinutes ?? 60 * 12,
  );
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
  const opt = TRIGGER_OPTIONS.find((o) => o.value === kind)!;
  const numericValue = Number(value);
  const valid =
    !opt.needsValue ||
    (Number.isFinite(numericValue) && numericValue > 0);

  async function submit() {
    if (!valid) return;
    const trigger = buildTrigger(kind, numericValue);
    if (!trigger) return;
    await onSubmit({
      scope: initial?.scope ?? { kind: 'global' },
      trigger,
      enabled,
      cooldownMinutes: Math.max(1, Math.round(cooldownMinutes)),
    });
  }

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Триггер
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as NotificationTrigger['kind'])}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          >
            {TRIGGER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {opt.needsValue && (
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {valueLabel(kind)}
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={kind === 'dropPct' ? 1 : 1}
              step={kind === 'dropPct' ? 1 : 10}
              className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Кулдаун, мин
          <input
            type="number"
            value={cooldownMinutes}
            onChange={(e) => setCooldownMinutes(Number(e.target.value))}
            min={1}
            className="w-28 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
          />
          Включено
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function buildTrigger(kind: NotificationTrigger['kind'], value: number): NotificationTrigger | null {
  switch (kind) {
    case 'priceBelow':
      return { kind: 'priceBelow', value };
    case 'dropPct':
      // UI shows percent (e.g. 5), internally evaluate uses ratio (0.05).
      return { kind: 'dropPct', value: value / 100 };
    case 'dropAbs':
      return { kind: 'dropAbs', value };
    case 'discountAppeared':
      return { kind: 'discountAppeared' };
    case 'backInStock':
      return { kind: 'backInStock' };
    case 'historicalLow':
      return { kind: 'historicalLow' };
    case 'sellerChanged':
      return null;
  }
}

function initialValueString(t: NotificationTrigger | undefined): string {
  if (!t) return '5';
  if (t.kind === 'dropPct') return String(Math.round(t.value * 100));
  if (t.kind === 'dropAbs' || t.kind === 'priceBelow') return String(t.value);
  return '';
}

function valueLabel(kind: NotificationTrigger['kind']): string {
  if (kind === 'dropPct') return 'Порог, %';
  if (kind === 'dropAbs') return 'Порог, ₽';
  if (kind === 'priceBelow') return 'Цена, ₽';
  return '';
}

function describeTrigger(t: NotificationTrigger): string {
  switch (t.kind) {
    case 'priceBelow':       return `Цена ниже ${formatPrice(t.value)}`;
    case 'dropPct':          return `Падение цены ≥ ${Math.round(t.value * 100)}%`;
    case 'dropAbs':          return `Падение цены ≥ ${formatPrice(t.value)}`;
    case 'discountAppeared': return 'Появилась скидка';
    case 'backInStock':      return 'Снова в наличии';
    case 'historicalLow':    return 'Исторический минимум';
    case 'sellerChanged':    return 'Сменился продавец';
  }
}

function formatCooldown(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const h = minutes / 60;
  if (h < 24) return `${h % 1 === 0 ? h : h.toFixed(1)} ч`;
  const d = h / 24;
  return `${d % 1 === 0 ? d : d.toFixed(1)} дн`;
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
