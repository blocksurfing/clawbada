/**
 * Tracks the last processed block per contract.
 * Uses the indexer_state table in the database.
 */
import { eq } from 'drizzle-orm';
import { db, indexerState } from '@clawbada/db';

export class BlockTracker {
  /**
   * Get the last processed block for a contract.
   */
  async getLastBlock(contractName: string): Promise<bigint> {
    const result = await db
      .select()
      .from(indexerState)
      .where(eq(indexerState.contractName, contractName))
      .limit(1);

    if (result.length === 0) return 0n;
    return result[0].lastProcessedBlock;
  }

  /**
   * Update the last processed block for a contract.
   * Upserts — creates if not exists, updates if exists.
   */
  async setLastBlock(contractName: string, blockNumber: bigint): Promise<void> {
    const existing = await db
      .select()
      .from(indexerState)
      .where(eq(indexerState.contractName, contractName))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(indexerState).values({
        contractName,
        lastProcessedBlock: blockNumber,
      });
    } else {
      await db
        .update(indexerState)
        .set({ lastProcessedBlock: blockNumber, updatedAt: new Date() })
        .where(eq(indexerState.contractName, contractName));
    }
  }
}
