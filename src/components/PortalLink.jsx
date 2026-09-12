import React from 'react';
import GlassSurface from './GlassSurface';
import { useShell } from '../layout/Shell';

export default function PortalLink({ className, children }) {
  const { openPortal } = useShell();

  return (
    <GlassSurface
      as="a"
      variant="pill"
      href="#portal"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openPortal();
      }}
    >
      <span className="glass-surface__content">{children}</span>
    </GlassSurface>
  );
}
