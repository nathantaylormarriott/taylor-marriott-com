import React, { useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { CONFIG, HOME_BELOW_HERO } from '../config';
import { revealHeroTitle, runHeroEntrance } from '../lib/heroReveal';
import { useShell } from '../layout/Shell';
import ContactLink from '../components/ContactLink';
import {
  PORTFOLIO,
  SplitWords,
  PortfolioPreview,
  siteDomain,
} from '../components/shared';
import taylorMarriottLogo from '../assets/taylor-marriott-logo.png';

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const { containerRef, sceneApiRef, isMobile, reduced, registerLenis } = useShell();
  const mainRef = useRef(null);
  const lenisRef = useRef(null);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    sceneApiRef.current?.setScrollImmediate?.(0);
  }, [sceneApiRef]);

  useLayoutEffect(() => {
    if (reduced || (isMobile && !HOME_BELOW_HERO)) {
      registerLenis(null);
      return;
    }

    lenisRef.current = new Lenis({
      duration: CONFIG.scrollWeight,
      easing: CONFIG.scrollEasing,
      smoothWheel: true,
    });
    lenisRef.current.on('scroll', ScrollTrigger.update);
    ScrollTrigger.scrollerProxy(document.documentElement, {
      scrollTop(value) {
        if (arguments.length) lenisRef.current.scrollTo(value, { immediate: true });
        return lenisRef.current.scroll;
      },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
      },
    });
    ScrollTrigger.addEventListener('refresh', () => lenisRef.current?.resize());
    lenisRef.current.on('scroll', ({ scroll }) => {
      sceneApiRef.current?.setScroll(scroll * CONFIG.scrollFactor);
    });
    registerLenis(lenisRef.current);

    const lenisTick = (time) => lenisRef.current?.raf(time * 1000);
    gsap.ticker.add(lenisTick);

    return () => {
      registerLenis(null);
      gsap.ticker.remove(lenisTick);
      ScrollTrigger.scrollerProxy(document.documentElement, null);
      lenisRef.current?.destroy();
      lenisRef.current = null;
    };
  }, [reduced, isMobile, sceneApiRef, registerLenis]);

  useLayoutEffect(() => {
    const refreshScroll = () => ScrollTrigger.refresh();
    const syncFooterHeight = () => {
      if (!HOME_BELOW_HERO) return;
      const footer = document.querySelector('.site-footer');
      if (footer) {
        document.documentElement.style.setProperty('--footer-h', `${footer.offsetHeight}px`);
      }
      ScrollTrigger.refresh();
    };
    const onLoad = () => { refreshScroll(); syncFooterHeight(); };

    let entranceFrame = 0;
    let heroFallbackTimer = 0;

    const ctx = gsap.context(() => {
      gsap.defaults({ ease: CONFIG.ease });

      const startHeroEntrance = () => {
        const root = mainRef.current;
        const headEls = containerRef.current?.querySelectorAll('.logo, .head-action');
        const { fallbackMs } = runHeroEntrance({
          scope: root,
          headEls,
          reduced,
          onComplete: () => window.clearTimeout(heroFallbackTimer),
        });
        heroFallbackTimer = window.setTimeout(() => revealHeroTitle(root), fallbackMs || 4200);
      };

      entranceFrame = requestAnimationFrame(startHeroEntrance);

      requestAnimationFrame(() => {
        syncFooterHeight();
        ScrollTrigger.refresh(true);
      });

      // -- Hero Scroll Fade
      if (!reduced && HOME_BELOW_HERO) {
        gsap.to('.hero-inner', { yPercent: -28, autoAlpha: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      }

      if (HOME_BELOW_HERO) {
      // -- Arrival Pin
      if (reduced) {
        gsap.from('.arrival-line .split-word', { autoAlpha: 0, duration: 0.8, scrollTrigger: { trigger: '.arrival', start: 'top 60%' }, onStart: () => sceneApiRef.current?.setFocal(0.55) });
      } else {
        const focal = { v: 0 }, fov = { v: 60 };
        gsap.timeline({ scrollTrigger: { trigger: '.arrival', start: 'top top', end: '+=160%', pin: true, scrub: true, anticipatePin: 1 } })
          .to(focal, { v: 1, duration: 0.5, onUpdate: () => sceneApiRef.current?.setFocal(focal.v) }, 0)
          .to(fov, { v: 47, duration: 0.5, onUpdate: () => sceneApiRef.current?.setFov(fov.v) }, 0)
          .fromTo('.arrival-line .split-word', { autoAlpha: 0, y: 26, filter: 'blur(6px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.4, stagger: 0.05, ease: CONFIG.ease }, 0.25)
          .to({}, { duration: 0.15 })
          .to('.arrival-line', { autoAlpha: 0, y: -24, duration: 0.2 })
          .to(focal, { v: 0.16, duration: 0.2, onUpdate: () => sceneApiRef.current?.setFocal(focal.v) }, '<')
          .to(fov, { v: 60, duration: 0.2, onUpdate: () => sceneApiRef.current?.setFov(fov.v) }, '<');
      }

      // -- Portfolio
      const portfolio = document.querySelector('.portfolio'), portfolioTrack = document.querySelector('.portfolio-track');
      if (portfolio && portfolioTrack) {
        if (reduced || isMobile) {
          portfolio.classList.add('portfolio--stack');
          gsap.utils.toArray('.portfolio-intro, .portfolio-card').forEach((el) =>
            gsap.from(el, { autoAlpha: 0, y: reduced ? 0 : 40, duration: reduced ? 0.6 : 1.2, scrollTrigger: { trigger: el, start: 'top 86%' } })
          );
        } else {
          const portfolioDist = () => portfolioTrack.scrollWidth - window.innerWidth;
          gsap.to(portfolioTrack, {
            x: () => -portfolioDist(),
            ease: 'none',
            scrollTrigger: {
              trigger: portfolio,
              start: 'top top',
              end: () => '+=' + portfolioDist(),
              pin: true,
              scrub: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });
          gsap.from('.portfolio-intro > *', { autoAlpha: 0, y: 36, duration: 1.2, stagger: 0.1, scrollTrigger: { trigger: portfolio, start: 'top 72%' } });
          gsap.from('.portfolio-card', { autoAlpha: 0, y: 50, duration: 1.2, stagger: 0.08, scrollTrigger: { trigger: portfolio, start: 'top 68%' } });
        }
      }

      // -- Closing CTA
      gsap.from('.closing-title', { autoAlpha: 0, y: reduced ? 0 : 40, duration: reduced ? 0.8 : 1.5, scrollTrigger: { trigger: '.closing', start: 'top 65%' } });

      // -- Fixed footer reveal: footer stays put, clip-path opens as content scrolls over it
      syncFooterHeight();
      const footerEl = document.querySelector('.site-footer');
      if (footerEl) {
        const hideFooter = () => gsap.set(footerEl, {
          clipPath: 'inset(100% 0% 0% 0%)',
          visibility: 'hidden',
          pointerEvents: 'none',
        });
        const showFooter = () => gsap.set(footerEl, {
          clipPath: 'inset(0% 0% 0% 0%)',
          visibility: 'visible',
          pointerEvents: 'auto',
        });
        const closingBtn = document.querySelector('.closing-btn');

        if (reduced) {
          showFooter();
        } else {
          hideFooter();
          gsap.to(footerEl, {
            clipPath: 'inset(0% 0% 0% 0%)',
            ease: 'none',
            scrollTrigger: {
              trigger: '.closing-btn',
              start: 'bottom 50%',
              end: 'bottom top-=4',
              scrub: true,
              invalidateOnRefresh: true,
              onUpdate: (self) => {
                if (!closingBtn) return;
                gsap.set(closingBtn, { autoAlpha: self.progress >= 0.995 ? 0 : 1 });
              },
              onEnter: () => gsap.set(footerEl, { visibility: 'visible' }),
              onLeave: () => {
                showFooter();
                if (closingBtn) gsap.set(closingBtn, { autoAlpha: 0 });
              },
              onEnterBack: () => {
                gsap.set(footerEl, { visibility: 'visible' });
                if (closingBtn) gsap.set(closingBtn, { autoAlpha: 1 });
              },
              onLeaveBack: () => {
                hideFooter();
                if (closingBtn) gsap.set(closingBtn, { autoAlpha: 1 });
              },
            },
          });
        }
      }

      } // HOME_BELOW_HERO

      window.addEventListener('resize', syncFooterHeight);

      ScrollTrigger.refresh();
      window.addEventListener('load', onLoad);

    }, mainRef);
    return () => {
      cancelAnimationFrame(entranceFrame);
      window.clearTimeout(heroFallbackTimer);
      window.removeEventListener('resize', syncFooterHeight);
      window.removeEventListener('load', onLoad);
      ctx.revert();
      revealHeroTitle(mainRef.current);
      gsap.set(containerRef.current?.querySelectorAll('.logo, .head-action'), {
        autoAlpha: 1,
        opacity: 1,
        visibility: 'visible',
        y: 0,
        filter: 'none',
        pointerEvents: 'auto',
        clearProps: 'transform,filter',
      });
    };
  }, [reduced, isMobile, sceneApiRef, containerRef]);

  return (
    <>
      <main ref={mainRef}>
        <section className="hero" id="hero">
          <div className="hero-inner">
            <h1 className="hero-title">
              <span className="hero-title-line"><SplitWords text="We design, build, and" /></span>
              <span className="hero-title-line"><SplitWords text="grow the digital products" /></span>
              <span className="hero-title-line"><SplitWords text="your brand deserves." /></span>
            </h1>
          </div>
        </section>

        {HOME_BELOW_HERO && (
        <>
        <section className="portfolio" id="work">
          <div className="portfolio-track">
            <div className="portfolio-intro">
              <h2 className="portfolio-title">Selected work</h2>
              <p className="portfolio-hint mono">Scroll to explore →</p>
            </div>
            {PORTFOLIO.map((item) => (
              <figure key={item.url} className="portfolio-card">
                <a className="portfolio-card-link" href={item.url} target="_blank" rel="noopener noreferrer">
                  <div className="portfolio-preview">
                    <div className="portfolio-browser mono" aria-hidden="true">
                      <span className="portfolio-browser-dots">
                        <i /><i /><i />
                      </span>
                      <span className="portfolio-browser-url">{siteDomain(item.url)}</span>
                    </div>
                    <PortfolioPreview item={item} />
                  </div>
                  <figcaption className="portfolio-caption">
                    <span className="portfolio-card-name">{item.name}</span>
                    <span className="portfolio-card-out mono">Visit ↗</span>
                  </figcaption>
                </a>
              </figure>
            ))}
          </div>
        </section>

        <section className="arrival" id="arrival">
          <p className="arrival-line">
            <SplitWords text="Four hundred light-years out," /><br />
            <SplitWords text="the noise of home goes quiet." />
          </p>
        </section>

        <section className="closing" id="closing">
          <h2 className="closing-title">Let's make your<br />idea real.</h2>
          <ContactLink className="closing-btn">Start a Conversation</ContactLink>
        </section>

        <div className="footer-scroll-spacer" aria-hidden="true"></div>
        </>
        )}
      </main>

      {HOME_BELOW_HERO && (
      <footer className="site-footer" id="site-footer">
        <div className="site-footer-wrap">
          <div className="site-footer-top">
            <div className="site-footer-mark">
              <img src={taylorMarriottLogo} alt="Taylor-Marriott" width={320} height={48} />
            </div>
            <div className="site-footer-cols">
              <div className="site-footer-col">
                <h4>Work</h4>
                <a href="#work">Selected work</a>
              </div>
              <div className="site-footer-col">
                <h4>Studio</h4>
                <ContactLink>Contact</ContactLink>
              </div>
              <div className="site-footer-col">
                <h4>Connect</h4>
                <a href="mailto:hello@taylor-marriott.com">hello@taylor-marriott.com</a>
                <a href="#hero">Back to top</a>
              </div>
            </div>
          </div>
          <div className="site-footer-base">
            <span>© {new Date().getFullYear()} Taylor-Marriott. All rights reserved.</span>
            <span className="site-footer-built">
              <span className="site-footer-glow" aria-hidden="true"></span>
              Taylor-Marriott Limited · 17070186 · England &amp; Wales
            </span>
          </div>
        </div>
      </footer>
      )}
    </>
  );
}