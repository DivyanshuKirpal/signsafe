export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-black tracking-tight">SignSafe</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        See what a Solana transaction will actually do before you sign it.
        SignSafe decodes the instructions, simulates the transaction on devnet,
        checks the changes against fixed risk rules, and explains the result in
        plain English.
      </p>
      <p className="mt-6 text-sm text-muted">
        The transaction checker is being built. Devnet only.
      </p>
    </main>
  );
}
