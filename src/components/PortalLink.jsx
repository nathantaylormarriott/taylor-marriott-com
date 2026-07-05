import React from 'react';
import { useShell } from '../layout/Shell';

export default function PortalLink({ className, children }) {
  const { openPortal } = useShell();

  return (
    <a
      href="#portal"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openPortal();
      }}
    >
      {children}
    </a>
  );
}
