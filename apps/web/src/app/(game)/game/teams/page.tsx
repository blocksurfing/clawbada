'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LobsterData } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LobsterCard } from '@/components/game/lobster-card';
import { TransactionButton } from '@/components/game/transaction-button';
import { Plus, Users } from 'lucide-react';

export default function TeamsPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: teamsData } = useQuery({
    queryKey: ['teams', address],
    queryFn: () => api.teams.list(address!),
    enabled: !!address,
  });

  const { data: lobstersData } = useQuery({
    queryKey: ['lobsters', address],
    queryFn: () => api.agent.lobsters(address!),
    enabled: !!address,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['teams'] });
    queryClient.invalidateQueries({ queryKey: ['lobsters'] });
  };

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <Users className="size-8 text-muted-foreground mb-3" />
        <h1 className="text-2xl font-bold mb-2">Teams</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet to manage teams.</p>
      </div>
    );
  }

  const teams = teamsData?.teams ?? [];
  const availableLobsters = lobstersData?.lobsters.filter((l) => !l.locked) ?? [];

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-sm text-muted-foreground mt-1">Assemble teams of 3 lobsters</p>
        </div>
        <CreateTeamDialog lobsters={availableLobsters} onSuccess={invalidate} />
      </div>

      {teams.length === 0 ? (
        <div className="border border-border rounded-md p-12 text-center">
          <p className="text-muted-foreground text-sm">No teams yet. Create a team of 3 lobsters to start mining or battling.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {teams.map((team) => (
            <div key={team.teamId} className="border border-border rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Team #{team.teamId}</span>
                  {team.active && <Badge variant="outline" className="text-xs">Active</Badge>}
                </div>
                {!team.active && (
                  <TransactionButton
                    label="Disband"
                    variant="destructive"
                    size="sm"
                    fetchSteps={(auth) => api.teams.disband(team.teamId, auth)}
                    onSuccess={invalidate}
                  />
                )}
              </div>
              <div className="flex gap-2">
                {(team.lobsters ?? []).map((lob) => (
                  <LobsterCard
                    key={lob.tokenId}
                    tokenId={lob.tokenId}
                    dna={lob.dna}
                    lobsterClass={lob.class}
                    evolutionTier={lob.evolutionTier}
                    purity={lob.purity}
                    legend={lob.legend}
                    damage={lob.damage}
                    locked={lob.locked}
                    soulbound={lob.soulbound}
                    size="sm"
                  />
                ))}
                {!team.lobsters && team.lobsterIds.map((id) => (
                  <div key={id} className="w-[96px] h-[120px] border border-border rounded flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">#{id}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTeamDialog({ lobsters, onSuccess }: { lobsters: LobsterData[]; onSuccess: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const toggle = (tokenId: string) => {
    setSelected((prev) =>
      prev.includes(tokenId)
        ? prev.filter((id) => id !== tokenId)
        : prev.length < 3
          ? [...prev, tokenId]
          : prev,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected([]); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4 mr-1" /> Create Team
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Team — Select 3 Lobsters</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          Selected: {selected.length}/3
        </p>
        {lobsters.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 text-sm">No available lobsters.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {lobsters.map((lob) => (
              <LobsterCard
                key={lob.tokenId}
                tokenId={lob.tokenId}
                dna={lob.dna}
                lobsterClass={lob.class}
                evolutionTier={lob.evolutionTier}
                purity={lob.purity}
                legend={lob.legend}
                damage={lob.damage}
                locked={lob.locked}
                soulbound={lob.soulbound}
                size="sm"
                selected={selected.includes(lob.tokenId)}
                onClick={() => toggle(lob.tokenId)}
              />
            ))}
          </div>
        )}
        {selected.length === 3 && (
          <div className="mt-4">
            <TransactionButton
              label="Create Team"
              fetchSteps={(auth) => api.teams.create(selected as [string, string, string], auth)}
              onSuccess={() => { setOpen(false); setSelected([]); onSuccess(); }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
