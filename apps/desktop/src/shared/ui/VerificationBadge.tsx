import type { HTMLAttributes } from 'react';
import { CircleCheck } from 'lucide-react';

export type VerificationState = 'verified' | 'pending' | 'unsaved' | 'testing' | 'off';
interface VerificationBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  state: VerificationState;
}

export function VerificationBadge({
  state,
  className = '',
  children,
  ...props
}: VerificationBadgeProps) {
  return (
    <span className={`verification-badge ${state} ${className}`.trim()} role="status" {...props}>
      {state === 'verified' && <CircleCheck aria-hidden="true" />}
      {children}
    </span>
  );
}
