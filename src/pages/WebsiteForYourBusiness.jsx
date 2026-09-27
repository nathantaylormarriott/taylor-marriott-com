import React, { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import WebsiteIntakeForm from '../components/WebsiteIntakeForm';
import { useShell } from '../layout/Shell';
import {
  fadePageChromeIn,
  primeIncomingRoutePage,
  revealPageChromeInstant,
} from '../lib/pageTransition';

const PAGE_PATH = '/website-for-your-business';

const FAQ_ITEMS = [
  {
    q: 'How much does the local business website cost?',
    a: 'The fee is a one-time £299 — not a monthly retainer. Free hosting on fast Netlify static hosting is included, with unlimited content changes within reasonable use, as described in your agreement with Taylor-Marriott.',
  },
  {
    q: 'Who is this website product for?',
    a: 'It is built for local UK businesses that need a trustworthy online presence: clear contact details, maps, a share hub for social links, and local SEO foundations in GBP, structured for customers across the Midlands and the wider United Kingdom.',
  },
  {
    q: 'What happens after I submit the form?',
    a: 'We review your business name, phone number and any links you share, then respond within 24 hours with a demo preview of your site — a working preview shaped around your business before you commit further.',
  },
  {
    q: 'Do I need to provide a Google Business Profile?',
    a: 'No. Your Google Business Profile link is optional but helpful — it speeds up accurate maps, hours and local SEO signals on your preview.',
  },
  {
    q: 'Is email required?',
    a: 'No. Full name, phone number and business name are required so we can call or message you with your preview. Email is optional if you prefer phone contact.',
  },
  {
    q: 'How is this different from a bespoke Taylor-Marriott project?',
    a: 'This is a focused product for local businesses at a fixed price. For custom software, large marketing builds or digital products, see our main studio services via the contact page or book a discovery session.',
  },
];

export default function WebsiteForYourBusiness() {
  const { reduced, finishRouteTransition, hubRouteHandoffRef } = useShell();
  const entranceRan = useRef(false);

  useLayoutEffect(() => {
    if (entranceRan.current) return;
    entranceRan.current = true;

    window.scrollTo(0, 0);

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
  }, [finishRouteTransition, hubRouteHandoffRef, reduced]);

  return (
    <main className="website-offer-page discovery-session-page" id="website-offer-main">
      <div className="website-offer-inner discovery-session-inner">
        <div className="website-offer-copy discovery-session-copy">
          <p className="discovery-session-eyebrow speakable-offer-eyebrow">Local business websites · UK</p>
          <h1 className="discovery-session-title speakable-offer-headline">
            A professional website for your local business — £299, once.
          </h1>
          <p className="discovery-session-lead speakable-offer-summary">
            Taylor-Marriott Limited builds modern, fast websites for local UK businesses: one-time fee of{' '}
            <strong>£299</strong>, <strong>free hosting included</strong>, and{' '}
            <strong>unlimited changes within reasonable use</strong>. You get a contact form, maps,
            social share hub, and local SEO foundations — hosted on Netlify. Submit your details and
            we&apos;ll reply within <strong>24 hours</strong> with a demo preview built from your business
            information.
          </p>

          <ul className="website-offer-highlights" aria-label="What is included">
            <li>One-time £299 — no monthly website retainer</li>
            <li>Free hosting on fast static infrastructure (Netlify)</li>
            <li>Contact form, maps &amp; share hub for your channels</li>
            <li>Built for local UK SEO (GBP-friendly, GBP pricing)</li>
            <li>Preview demo tailored from your business details</li>
          </ul>

          <p className="discovery-session-alt">
            Need a larger build?{' '}
            <Link to="/contact" className="discovery-session-alt__link">
              Contact the studio
            </Link>{' '}
            or{' '}
            <Link to="/discovery-session" className="discovery-session-alt__link">
              book a discovery session
            </Link>
            .
          </p>
        </div>

        <div className="website-offer-form discovery-session-booking" id="website-intake">
          <WebsiteIntakeForm sourcePath={PAGE_PATH} />
        </div>
      </div>

      <section className="website-offer-faq" aria-labelledby="website-offer-faq-title">
        <h2 id="website-offer-faq-title" className="website-offer-faq__title">
          Frequently asked questions
        </h2>
        <dl className="website-offer-faq__list speakable-faq">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q} className="website-offer-faq__item">
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}

export { FAQ_ITEMS, PAGE_PATH };
