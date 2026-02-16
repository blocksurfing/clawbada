export default function GameDashboard() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <a href="/game/mining" className="p-4 border rounded-lg hover:bg-gray-50">
          <h2 className="font-semibold">Mining</h2>
          <p className="text-sm text-gray-500">Active expeditions</p>
        </a>
        <a href="/game/battle" className="p-4 border rounded-lg hover:bg-gray-50">
          <h2 className="font-semibold">Battle</h2>
          <p className="text-sm text-gray-500">PvP combat arena</p>
        </a>
        <a href="/game/breeding" className="p-4 border rounded-lg hover:bg-gray-50">
          <h2 className="font-semibold">Breeding</h2>
          <p className="text-sm text-gray-500">Breed new lobsters</p>
        </a>
        <a href="/game/teams" className="p-4 border rounded-lg hover:bg-gray-50">
          <h2 className="font-semibold">Teams</h2>
          <p className="text-sm text-gray-500">Manage squads</p>
        </a>
      </div>
    </main>
  );
}
