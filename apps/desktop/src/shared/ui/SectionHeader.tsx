import type { HTMLAttributes, ReactNode } from 'react';
import { Heading } from './Heading';

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  headingLevel?: 'h2' | 'h3';
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  headingLevel = 'h3',
  actions,
  children,
  className = '',
  ...props
}: SectionHeaderProps) {
  return (
    <div className={`section-heading ${className}`.trim()} {...props}>
      {title && <Heading as={headingLevel}>{title}</Heading>}
      {children}
      {actions}
    </div>
  );
}
