import { shortAddress } from "../lib/solana/format";

/** A shortened address; the full value is in the tooltip and for screen readers. */
export function Address({ value }: { value: string }) {
  const short = shortAddress(value);
  if (short === value) return <span className="font-mono break-all">{value}</span>;
  return (
    <span className="font-mono" title={value}>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
