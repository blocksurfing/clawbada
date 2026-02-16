export default async function LobsterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold mb-6">Lobster #{id}</h1>
      <p className="text-gray-500">Lobster detail view. Coming soon.</p>
    </main>
  );
}
