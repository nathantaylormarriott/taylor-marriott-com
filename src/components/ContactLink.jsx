import React from 'react';
import { Link } from 'react-router-dom';
import { useShell } from '../layout/Shell';

export default function ContactLink({ className, children }) {
  const { beginPageRouteTransition, reduced } = useShell();

  return (
    <Link
      to="/contact"
      className={className}
      onClick={(e) => {
        if (reduced) return;
        e.preventDefault();
        beginPageRouteTransition('/contact');
      }}
    >
      {children}
    </Link>
  );
}
