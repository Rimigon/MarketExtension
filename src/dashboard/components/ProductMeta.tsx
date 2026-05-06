import { useEffect, useState } from 'react';
import { sendRpc } from '@/shared/rpc';
import { formatPrice, formatPercent } from '@/shared/format';
import type { Collection, PriceGoal, Product } from '@/shared/types';
import type { Recommendation } from '@/services/recommendation';

interface Props {
  product: Product;
  collections: Collection[];
  onChanged: () => void;
}

export function ProductMeta({ product, collections, onChanged }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FavoriteAndArchive product={product} onChanged={onChanged} />
      <RecommendationCard product={product} />
      <TagsEditor product={product} onChanged={onChanged} />
      <CollectionsEditor product={product} collections={collections} onChanged={onChanged} />
      <GoalEditor product={product} onChanged={onChanged} />
      <NotesEditor product={product} onChanged={onChanged} />
    </div>
  );
}

function FavoriteAndArchive({ product, onChanged }: { product: Product; onChanged: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Управление</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            await sendRpc('product/setFavorite', {
              productId: product.id,
              favorite: !product.isFavorite,
            });
            onChanged();
          }}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            product.isFavorite
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          {product.isFavorite ? '★ В избранном' : '☆ В избранное'}
        </button>
        <button
          type="button"
          onClick={async () => {
            await sendRpc('product/setArchived', {
              productId: product.id,
              archived: !product.isArchived,
            });
            onChanged();
          }}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            product.isArchived
              ? 'border-slate-300 bg-slate-100 text-slate-700'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          {product.isArchived ? 'Восстановить из архива' : 'В архив'}
        </button>
      </div>
    </section>
  );
}

function RecommendationCard({ product }: { product: Product }) {
  const [rec, setRec] = useState<Recommendation | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sendRpc('recommendation/get', { productId: product.id }).then((resp) => {
      if (!cancelled) setRec(resp.recommendation);
    });
    return () => {
      cancelled = true;
    };
  }, [product.id, product.updatedAt]);

  const tone =
    rec?.verdict === 'buy_now'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
      : rec?.verdict === 'good_price'
        ? 'border-emerald-200 bg-emerald-50/60 text-emerald-700'
        : rec?.verdict === 'fair_price'
          ? 'border-slate-200 bg-white text-slate-700'
          : rec?.verdict === 'overpriced'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : 'border-slate-200 bg-white text-slate-500';

  return (
    <section className={`rounded-lg border p-4 ${tone}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide opacity-70">Рекомендация</h3>
      <div className="mt-2 text-base font-semibold">{rec?.title ?? 'Загрузка…'}</div>
      <p className="mt-1 text-xs opacity-80">{rec?.hint}</p>
      {rec && rec.percentile != null && (
        <p className="mt-2 text-[11px] opacity-70">
          Перцентиль текущей цены — {formatPercent(rec.percentile)} (на {rec.sampleSize} точках).
          {rec.min != null && ` Минимум: ${formatPrice(rec.min)}.`}
        </p>
      )}
    </section>
  );
}

function TagsEditor({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [draft, setDraft] = useState('');

  async function add(name: string) {
    const next = Array.from(new Set([...product.tags, name.trim()].filter(Boolean)));
    await sendRpc('product/setTags', { productId: product.id, tags: next });
    setDraft('');
    onChanged();
  }

  async function remove(name: string) {
    const next = product.tags.filter((t) => t !== name);
    await sendRpc('product/setTags', { productId: product.id, tags: next });
    onChanged();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Теги</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {product.tags.length === 0 && (
          <span className="text-xs text-slate-400">Нет тегов.</span>
        )}
        {product.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          >
            {t}
            <button
              type="button"
              onClick={() => void remove(t)}
              className="text-slate-400 hover:text-rose-500"
              aria-label={`Удалить тег ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Добавить тег"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) void add(draft);
          }}
          className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => draft.trim() && void add(draft)}
          disabled={!draft.trim()}
          className="rounded bg-brand-500 px-2.5 py-1 text-sm text-white disabled:opacity-50"
        >
          +
        </button>
      </div>
    </section>
  );
}

function CollectionsEditor({
  product,
  collections,
  onChanged,
}: {
  product: Product;
  collections: Collection[];
  onChanged: () => void;
}) {
  async function toggle(id: string) {
    const has = product.collectionIds.includes(id);
    const next = has
      ? product.collectionIds.filter((x) => x !== id)
      : [...product.collectionIds, id];
    await sendRpc('product/setCollections', { productId: product.id, collectionIds: next });
    onChanged();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Коллекции</h3>
      {collections.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">
          Создайте коллекцию в боковой панели слева.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {collections.map((c) => {
            const active = product.collectionIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void toggle(c.id)}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color ?? '#94a3b8' }}
                  aria-hidden
                />
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GoalEditor({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [target, setTarget] = useState(product.goal?.targetPrice?.toString() ?? '');
  const [ideal, setIdeal] = useState(product.goal?.idealPrice?.toString() ?? '');
  const [deadline, setDeadline] = useState(
    product.goal?.deadline ? new Date(product.goal.deadline).toISOString().slice(0, 10) : '',
  );

  useEffect(() => {
    setTarget(product.goal?.targetPrice?.toString() ?? '');
    setIdeal(product.goal?.idealPrice?.toString() ?? '');
    setDeadline(
      product.goal?.deadline ? new Date(product.goal.deadline).toISOString().slice(0, 10) : '',
    );
  }, [product.id, product.goal?.targetPrice, product.goal?.idealPrice, product.goal?.deadline]);

  async function save() {
    const goal: PriceGoal = {};
    const t = Number(target);
    const i = Number(ideal);
    if (target.trim() && Number.isFinite(t) && t > 0) goal.targetPrice = t;
    if (ideal.trim() && Number.isFinite(i) && i > 0) goal.idealPrice = i;
    if (deadline) {
      const ts = new Date(deadline).getTime();
      if (Number.isFinite(ts)) goal.deadline = ts;
    }
    const isEmpty = goal.targetPrice == null && goal.idealPrice == null && goal.deadline == null;
    await sendRpc('product/setGoal', {
      productId: product.id,
      goal: isEmpty ? null : goal,
    });
    onChanged();
  }

  async function clear() {
    setTarget('');
    setIdeal('');
    setDeadline('');
    await sendRpc('product/setGoal', { productId: product.id, goal: null });
    onChanged();
  }

  const target_ = Number(target);
  const showAchieved =
    product.currentPrice != null &&
    Number.isFinite(target_) &&
    target_ > 0 &&
    product.currentPrice <= target_;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Цель по цене</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="text-xs text-slate-600">
          Целевая цена, ₽
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="—"
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-600">
          Идеальная цена, ₽
          <input
            type="number"
            value={ideal}
            onChange={(e) => setIdeal(e.target.value)}
            placeholder="—"
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
        <label className="text-xs text-slate-600">
          Дедлайн
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {showAchieved ? (
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Цель достигнута: текущая ≤ целевой
          </span>
        ) : (
          <span className="text-xs text-slate-400">
            Уведомление сработает, когда цена опустится до целевой.
          </span>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void clear()}
            className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Сбросить
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="rounded bg-brand-500 px-3 py-1 text-xs text-white hover:bg-brand-600"
          >
            Сохранить
          </button>
        </div>
      </div>
    </section>
  );
}

function NotesEditor({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [draft, setDraft] = useState(product.notes ?? '');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setDraft(product.notes ?? '');
  }, [product.id, product.notes]);

  async function save() {
    await sendRpc('product/setNotes', { productId: product.id, notes: draft });
    setSavedAt(Date.now());
    onChanged();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Заметки</h3>
        {savedAt && <span className="text-[11px] text-emerald-600">Сохранено</span>}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Добавьте заметку — комплектация, причина отслеживания, ссылки на конкурентов…"
        rows={3}
        className="mt-2 w-full resize-y rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          className="rounded bg-brand-500 px-3 py-1 text-xs text-white hover:bg-brand-600"
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}
