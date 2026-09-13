import React, { useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ContactHelloCarousel from '../components/ContactHelloCarousel';
import ContactPanel from '../components/ContactPanel';
import { useShell } from '../layout/Shell';
import {
  animateContactEntrance,
  primeContactPanels,
  primeIncomingContactPage,
  revealContactPanelsInstant,
} from '../lib/pageTransition';

export default function Contact() {
  const navigate = useNavigate();
  const {
    beginPageRouteTransition,
    reduced,
    contactEntranceFromRouteRef,
    finishRouteTransition,
  } = useShell();
  const entranceRan = useRef(false);
  const entranceHandoffRef = useRef(contactEntranceFromRouteRef.current);

  useLayoutEffect(() => {
    if (entranceRan.current) return;
    entranceRan.current = true;

    if (reduced) {
      revealContactPanelsInstant();
      finishRouteTransition();
      return;
    }

    const fromTransition = contactEntranceFromRouteRef.current;
    if (fromTransition) {
      primeIncomingContactPage();
    } else {
      primeContactPanels();
    }

    animateContactEntrance({
      handoff: fromTransition,
      onComplete: finishRouteTransition,
    });
  }, [contactEntranceFromRouteRef, finishRouteTransition, reduced]);

  const handleClose = () => {
    if (reduced) {
      navigate('/');
      return;
    }
    beginPageRouteTransition('/');
  };

  return (
    <main className="contact-page">
      <ContactPanel onClose={handleClose} />
      <ContactHelloCarousel reduced={reduced} entranceHandoff={entranceHandoffRef.current} />
    </main>
  );
}
