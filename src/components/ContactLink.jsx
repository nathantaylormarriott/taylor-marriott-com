import React from 'react';
import { useShell } from '../layout/Shell';

export default function ContactLink({ className, children }) {
  const { openContact } = useShell();

  return (
    <a
      href="#contact"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        openContact();
      }}
    >
      {children}
    </a>
  );
}
