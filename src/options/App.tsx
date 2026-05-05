export function App() {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">PriceWatch · Настройки</h1>
      <p className="mt-2 text-sm text-slate-500">
        Полноценные настройки появятся в этапе V1: интервалы обновлений, тихие часы, тема,
        исключения, импорт/экспорт. Пока что используйте popup и dashboard.
      </p>
      <a
        href="../dashboard/index.html"
        className="mt-6 inline-block rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
      >
        Открыть dashboard
      </a>
    </div>
  );
}
