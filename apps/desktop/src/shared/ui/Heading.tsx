import type { HTMLAttributes } from 'react';

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  variant?: 'view' | 'section' | 'detail' | 'hero';
}

/** Semantic level and visual size are independent; shared typography lives in ui.css. */
export function Heading({
  as: Tag = 'h2',
  variant = 'section',
  className = '',
  ...props
}: HeadingProps) {
  return <Tag className={`ui-heading ui-heading--${variant} ${className}`.trim()} {...props} />;
}
