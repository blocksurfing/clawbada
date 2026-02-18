'use client';

import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useCalldataTx } from '@/hooks/use-calldata-tx';
import { useAuth } from '@/hooks/use-auth';
import type { CalldataStep, StepsResponse } from '@/lib/api';
import { Loader2, Check, X } from 'lucide-react';

interface TransactionButtonProps {
  label: string;
  fetchSteps: (auth: Record<string, string>) => Promise<StepsResponse>;
  onSuccess?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function TransactionButton({
  label,
  fetchSteps,
  onSuccess,
  disabled,
  variant = 'default',
  size = 'default',
  className,
}: TransactionButtonProps) {
  const { getAuthHeaders, isConnected } = useAuth();
  const { execute, status, error, reset, currentStep } = useCalldataTx();

  const handleClick = useCallback(async () => {
    try {
      const auth = await getAuthHeaders();
      const { steps } = await fetchSteps(auth);
      await execute(steps);
      onSuccess?.();
    } catch {
      // Error is captured in status
    }
  }, [getAuthHeaders, fetchSteps, execute, onSuccess]);

  if (status === 'success') {
    return (
      <Button variant="outline" size={size} className={className} onClick={reset}>
        <Check className="size-4" />
        Done
      </Button>
    );
  }

  if (status === 'error') {
    return (
      <Button variant="destructive" size={size} className={className} onClick={reset} title={error ?? undefined}>
        <X className="size-4" />
        Failed — Retry
      </Button>
    );
  }

  const isLoading = status === 'pending' || status === 'confirming';

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={disabled || !isConnected || isLoading}
    >
      {isLoading && <Loader2 className="size-4 animate-spin" />}
      {status === 'pending'
        ? `Confirm in wallet... (step ${currentStep + 1})`
        : status === 'confirming'
          ? 'Confirming...'
          : label}
    </Button>
  );
}
