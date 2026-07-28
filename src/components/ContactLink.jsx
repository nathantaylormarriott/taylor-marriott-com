import React from 'react';
import { Link } from 'react-router-dom';
import { useShell } from '../layout/Shell';

export default function ContactLink({ className, children }) {
  const { openContact, isMobile } = useShell();

  if (isMobile) {
    return (
      <Link to="/contact" className={className}>
        {children}
      </Link>
    );
  }

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
