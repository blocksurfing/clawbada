'use client';

import { useCallback, useState } from 'react';
import { usePublicClient, useSendTransaction } from 'wagmi';
import type { CalldataStep } from '@/lib/api';

type TxStatus = 'idle' | 'pending' | 'confirming' | 'success' | 'error';

export function useCalldataTx() {
  const [status, setStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const execute = useCallback(
    async (steps: CalldataStep[]): Promise<string[]> => {
      if (!publicClient) throw new Error('No public client');

      setStatus('pending');
      setError(null);
      setTxHashes([]);
      setCurrentStep(0);
      const hashes: string[] = [];

      try {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];

          setCurrentStep(i);
          setStatus('pending');

          const hash = await sendTransactionAsync({
            to: step.calldata.to as `0x${string}`,
            data: step.calldata.data as `0x${string}`,
            value: step.calldata.value ? BigInt(step.calldata.value) : 0n,
            chainId: step.calldata.chainId,
          });

          hashes.push(hash);
          setTxHashes([...hashes]);
          setStatus('confirming');

          await publicClient.waitForTransactionReceipt({ hash });
        }

        setStatus('success');
        return hashes;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transaction failed';
        setError(msg);
        setStatus('error');
        throw err;
      }
    },
    [publicClient, sendTransactionAsync],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setTxHashes([]);
    setCurrentStep(0);
  }, []);

  return { execute, status, error, txHashes, currentStep, reset };
}
