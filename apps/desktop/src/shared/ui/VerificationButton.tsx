import type { ButtonHTMLAttributes } from 'react';

interface VerificationButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'children'
> {
  label: string;
  busy?: boolean;
  onVerify: () => void;
}

export function VerificationButton({
  label,
  busy = false,
  disabled,
  className = '',
  onVerify,
  ...props
}: VerificationButtonProps) {
  return (
    <button
      type="button"
      className={`secondary verification-button ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={onVerify}
      {...props}
    >
      {busy ? 'Testing…' : label}
    </button>
  );
}
