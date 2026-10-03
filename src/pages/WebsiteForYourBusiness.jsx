import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import WebsiteIntakeForm from '../components/WebsiteIntakeForm';
import WebsiteWorkWheel from '../components/WebsiteWorkWheel';
import { CONFIG } from '../config';
import { useShell } from '../layout/Shell';
import {
  fadePageChromeIn,
  primeIncomingRoutePage,
  revealPageChromeInstant,
} from '../lib/pageTransition';

const PAGE_PATH = '/website-for-your-business';

const INCLUDED = [
  {
    title: 'A site people can trust',
    body: 'Your name, what you do, how to reach you, and a map — laid out so a first-time visitor knows they are in the right place.',
  },
  {
    title: 'Found locally',
    body: 'Structured for local search, with room for your Google Business Profile, opening hours and the areas you serve.',
  },
  {
    title: 'Yours to update',
    body: 'Hosting is included. When your phone number, photos or services change, we update the site within reasonable use.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Send the essentials',
    body: 'Name, phone and business name are enough to start. Links and extra context help, but they are not required.',
  },
  {
    n: '02',
    title: 'Preview within 24 hours',
    body: 'We come back with a working preview built from what you sent, so you can see the site before you commit.',
  },
  {
    n: '03',
    title: 'Go live for £299',
    body: 'One payment. No monthly website fee. We publish when you are happy with the preview.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'Who is this for?',
    a: 'Local businesses that need a proper presence online: a clear offer, a way to be contacted, and a page customers can find.',
  },
  {
    q: 'What do I have to send?',
    a: 'Your name, phone number and business name. Email, a short description, your Google Business Profile and social links are useful, not required.',
  },
  {
    q: 'Is this a custom studio project?',
    a: 'No. This is a fixed-price website. For software, a larger brand build or an ongoing marketing programme, book a discovery session.',
  },
];

export default function WebsiteForYourBusiness() {
  const { reduced, finishRouteTransition, hubRouteHandoffRef, sceneApiRef } = useShell();
  const entranceRan = useRef(false);

  useLayoutEffect(() => {
    if (entranceRan.current) return;
    entranceRan.current = true;

    window.scrollTo(0, 0);
    sceneApiRef.current?.setScrollImmediate?.(0);

    const handoff = hubRouteHandoffRef.current;
    hubRouteHandoffRef.current = false;

    if (reduced || !handoff) {
      revealPageChromeInstant();
      finishRouteTransition();
      return;
    }

    primeIncomingRoutePage();
    fadePageChromeIn({
      handoff: true,
      onComplete: finishRouteTransition,
    });
  }, [finishRouteTransition, hubRouteHandoffRef, reduced, sceneApiRef]);

  useEffect(() => {
    if (reduced) return undefined;

    const syncSceneScroll = () => {
      sceneApiRef.current?.setScroll(window.scrollY * CONFIG.scrollFactor);
    };

    syncSceneScroll();
    window.addEventListener('scroll', syncSceneScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', syncSceneScroll);
      sceneApiRef.current?.setScrollImmediate?.(0);
    };
  }, [reduced, sceneApiRef]);

  return (
    <main className="website-offer-page" id="website-offer-main">
      <section className="website-offer-hero">
        <div className="website-offer-copy">
          <h1 className="website-offer-title speakable-offer-headline">
            A professional website<br />for your local business — £299, once.
          </h1>
          <p className="website-offer-lead speakable-offer-summary">
            A site your customers can find, trust and contact. One payment.
            No monthly website fee. We reply within 24 hours with a preview
            built from your business.
          </p>
        </div>
        <div className="website-offer-form" id="website-intake">
          <WebsiteIntakeForm sourcePath={PAGE_PATH} />
        </div>
      </section>

      <WebsiteWorkWheel />

      <section className="website-offer-band" aria-labelledby="website-offer-included">
        <h2 id="website-offer-included" className="website-offer-band__title">What you get</h2>
        <ul className="website-offer-cards">
          {INCLUDED.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="website-offer-band" aria-labelledby="website-offer-steps">
        <h2 id="website-offer-steps" className="website-offer-band__title">How it works</h2>
        <ol className="website-offer-steps">
          {STEPS.map((step) => (
            <li key={step.n}>
              <span className="website-offer-steps__n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="website-offer-faq" aria-labelledby="website-offer-faq-title">
        <h2 id="website-offer-faq-title" className="website-offer-faq__title">Questions</h2>
        <dl className="website-offer-faq__list speakable-faq">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q} className="website-offer-faq__item">
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="website-offer-close">
          Building something beyond a local site?{' '}
          <Link to="/discovery-session" className="website-offer-link">Book a discovery session</Link>.
        </p>
      </section>
    </main>
  );
}

export { FAQ_ITEMS, PAGE_PATH };
