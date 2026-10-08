import type { ReactNode } from 'react';
import { Heading } from './Heading';

interface ViewHeaderProps {
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}

export function ViewHeader({ title, subtitle, actions }: ViewHeaderProps) {
  const heading = (
    <Heading as="h1" variant="view">
      {title}
    </Heading>
  );

  return (
    <>
      {actions ? (
        <div className="page-heading">
          {heading}
          {actions}
        </div>
      ) : (
        heading
      )}
      {subtitle && <p className="subtitle">{subtitle}</p>}
    </>
  );
}
