import React from 'react';
import GlassSurface from './GlassSurface';

export default function GlassButton({
  as = 'button',
  variant = 'pill',
  className = '',
  liquid = true,
  children,
  ...props
}) {
  return (
    <GlassSurface
      as={as}
      variant={variant}
      className={className}
      liquid={liquid}
      {...props}
    >
      {children}
    </GlassSurface>
  );
}
