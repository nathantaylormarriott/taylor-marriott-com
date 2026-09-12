import React from 'react';

/**
 * Hidden full-viewport canvas + SVG displacement filter for hero title ripple.
 * The canvas is updated each frame by waterRipple.js; feImage references it by id.
 */
export default function WaterRippleDisplace({ canvasRef }) {
  return (
    <>
      <canvas
        ref={canvasRef}
        id="ripple-displace-map"
        className="ripple-displace-map"
        aria-hidden="true"
      />
      <svg
        className="ripple-displace-svg"
        xmlns="http://www.w3.org/2000/svg"
        xmlnsXlink="http://www.w3.org/1999/xlink"
        aria-hidden="true"
      >
        <defs>
          <filter
            id="hero-water-ripple"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feImage
              href="#ripple-displace-map"
              xlinkHref="#ripple-displace-map"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              result="rippleMap"
              preserveAspectRatio="none"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="rippleMap"
              scale="140"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    </>
  );
}
