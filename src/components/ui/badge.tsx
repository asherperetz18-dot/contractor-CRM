export function Badge({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="badge-chip"
      style={{ background: color + "1c", color, borderColor: color + "55" }}
    >
      {children}
    </span>
  );
}
