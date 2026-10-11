import React, { useEffect, useRef, useState } from 'react';

export default function CheckoutDeviceScreen({ siteUrl, frameWidth, frameHeight, label }) {
  const screenRef = useRef(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = screenRef.current;
    if (!el) return undefined;

    const sync = () => {
      const w = el.clientWidth;
      setScale(w > 0 ? w / frameWidth : 0);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frameWidth]);

  const src = siteUrl ? `/api/checkout-preview?url=${encodeURIComponent(siteUrl)}` : '';

  return (
    <div className="checkout-device__screen" ref={screenRef}>
      {src && scale > 0 ? (
        <iframe
          title={label}
          src={src}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          style={{
            width: frameWidth,
            height: frameHeight,
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
    </div>
  );
}
