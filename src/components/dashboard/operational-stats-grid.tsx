type OperationalStatItem = readonly [label: string, value: string];

export function OperationalStatsGrid({
  items,
}: {
  items: readonly OperationalStatItem[];
}) {
  return (
    <section className="operational-stats">
      {items.map(([label, value]) => (
        <article className="panel operational-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}
