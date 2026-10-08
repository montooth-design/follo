import type { HTMLAttributes } from 'react';

interface SectionCardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article';
  variant?: 'repository' | 'settings' | 'plain';
}

/** Preserves the native section/article element; feature classes add layout, not shared styling. */
export function SectionCard({
  as: Tag = 'section',
  variant = 'plain',
  className = '',
  ...props
}: SectionCardProps) {
  const variantClass = variant === 'plain' ? '' : `${variant}-card`;

  return <Tag className={`section-card ${variantClass} ${className}`.trim()} {...props} />;
}
