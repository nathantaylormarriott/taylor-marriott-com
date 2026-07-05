import React, { useState } from 'react';

export const PORTFOLIO = [
  { name: 'Women Leading Change', url: 'https://www.womenleadingchange.co.uk/' },
  { name: 'Saathi Snacks', url: 'https://saathisnacks.com/' },
  { name: 'Forza Service Centre', url: 'https://forzaservicecentre.co.uk/' },
  { name: 'Madina Halal Meat & Grocery', url: 'https://www.madinabutchers.co.uk/' },
  { name: 'Fiore Signature', url: 'https://fioresignature.com/' },
  { name: 'Baita Palmarusso', url: 'https://baita-palmarusso-demo.netlify.app/' },
  { name: 'Admir Rahić', url: 'https://admirrahic.com/' },
  { name: 'Stanchion Press', url: 'https://www.stanchionpress.com/' },
  { name: 'Al Miftāh Academy', url: 'https://almiftaah.org.uk/' },
];

export const siteDomain = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export const sitePreviewUrl = (url) =>
  `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=1200&h=750`;

export const SplitWords = ({ text, className }) => (
  <span className={className}>
    {text.split(' ').map((word, i, arr) => (
      <React.Fragment key={i}>
        <span className="split-word">{word}</span>
        {i < arr.length - 1 ? ' ' : null}
      </React.Fragment>
    ))}
  </span>
);

export const SplitLineMask = ({ children }) => (
  <div className="split-line-mask inline-block align-top mr-2"><div className="split-line">{children}</div></div>
);

export function PortfolioPreview({ item }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="portfolio-shot">
      {!failed ? (
        <img
          className="portfolio-plate"
          src={sitePreviewUrl(item.url)}
          alt={`Preview of ${item.name}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="portfolio-fallback">
          <span className="portfolio-fallback-name">{item.name}</span>
          <span className="portfolio-fallback-domain mono">{siteDomain(item.url)}</span>
        </div>
      )}
    </div>
  );
}
