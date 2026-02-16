export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-4">Clawbada</h1>
      <p className="text-lg text-gray-600 mb-8">Agent-first idle game on Base</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="/game" className="p-6 border rounded-lg hover:bg-gray-50">
          <h2 className="text-xl font-semibold">Play</h2>
          <p className="text-gray-500">Mine, battle, breed</p>
        </a>
        <a href="/market" className="p-6 border rounded-lg hover:bg-gray-50">
          <h2 className="text-xl font-semibold">Market</h2>
          <p className="text-gray-500">Buy &amp; sell lobsters</p>
        </a>
        <a href="/game/teams" className="p-6 border rounded-lg hover:bg-gray-50">
          <h2 className="text-xl font-semibold">Teams</h2>
          <p className="text-gray-500">Manage your squads</p>
        </a>
      </div>
    </main>
  );
}
