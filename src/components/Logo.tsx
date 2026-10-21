export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      {[6, 11, 16, 21].map((x, i) => (
        <rect key={x} x={x} y={22 - [6, 10, 7, 13][i]} width="3" height={[6, 10, 7, 13][i]} rx="1.5" fill="var(--accent-ink)" />
      ))}
      <rect x="5" y="24" width="22" height="1.5" rx="0.75" fill="var(--accent-ink)" opacity="0.5" />
    </svg>
  )
}
