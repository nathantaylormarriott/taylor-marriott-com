import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { createScene } from '../lib/scene';
import { CONFIG, HOME_BELOW_HERO, SCENE_THEMES } from '../config';
import { getGlassSurfaceCount, setGlassSceneApi } from '../lib/glassBackdropRegistry';
import taylorMarriottWordmark from '../assets/taylor-marriott-wordmark.png';
import ContactLink from '../components/ContactLink';
import ContactPanel from '../components/ContactPanel';
import PortalLink from '../components/PortalLink';
import PortalLoginPanel from '../components/PortalLoginPanel';

const ShellContext = createContext(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within Shell');
  return ctx;
}

function suspendScroll(lenisRef) {
  lenisRef.current?.stop();
}

function hidePageContentForOverlay() {
  gsap.set('.page-content', {
    autoAlpha: 0,
    visibility: 'hidden',
    filter: 'none',
    pointerEvents: 'none',
  });
}

function revealHomeContent() {
  gsap.killTweensOf(['.page-content', '.logo', '.head-action']);

  gsap.set(['.logo', '.head-action', '.page-content'], {
    autoAlpha: 1,
    opacity: 1,
    visibility: 'visible',
    y: 0,
    yPercent: 0,
    filter: 'none',
    pointerEvents: 'auto',
    clearProps: 'transform,filter',
  });
}

function resetOverlayPanelVisibility() {
  gsap.killTweensOf('.contact-inner, .contact-inner *');
  gsap.set(['.contact-inner > *', '.contact-intro-copy', '.contact-main', '.contact-form', '.portal-login-form > *'], {
    autoAlpha: 1,
    opacity: 1,
    visibility: 'visible',
    y: 0,
    filter: 'blur(0px)',
    clearProps: 'transform',
  });
  gsap.set('.contact-success-view', {
    autoAlpha: 0,
    visibility: 'hidden',
    filter: 'blur(12px)',
  });
}

function showOverlayPanel() {
  gsap.set('.contact-overlay', { autoAlpha: 1, visibility: 'visible', pointerEvents: 'auto' });
  hidePageContentForOverlay();
  resetOverlayPanelVisibility();
  gsap.from('.contact-inner > *, .portal-login-form > *', {
    autoAlpha: 0,
    duration: 0.6,
    stagger: 0.06,
    ease: CONFIG.ease,
  });
}

function hideOverlayPanel(onComplete) {
  gsap.killTweensOf('.contact-inner, .contact-inner *, .portal-login-form, .portal-login-form > *');
  gsap.to('.contact-inner > *, .portal-login-form > *', {
    autoAlpha: 0,
    duration: 0.35,
    stagger: 0.04,
    ease: 'power2.in',
  });
  gsap.to('.contact-overlay', {
    autoAlpha: 0,
    duration: 0.4,
    delay: 0.08,
    ease: 'power2.in',
    onComplete: () => {
      gsap.set('.contact-overlay', { visibility: 'hidden', pointerEvents: 'none' });
      onComplete?.();
    },
  });
}

export default function Shell() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneApiRef = useRef(null);
  const lenisRef = useRef(null);
  const transitioningRef = useRef(false);
  const overlayOpenRef = useRef(false);
  const pageVisibleRef = useRef(
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
  );
  const lastIdleRenderMsRef = useRef(0);
  const preOverlaySceneScrollRef = useRef(0);
  const [overlayMode, setOverlayMode] = useState(null);
  const [overlaySession, setOverlaySession] = useState(0);
  const overlayOpen = overlayMode !== null;
  useEffect(() => {
    overlayOpenRef.current = overlayOpen;
  }, [overlayOpen]);

  useEffect(() => {
    const onVisibility = () => {
      pageVisibleRef.current = document.visibilityState !== 'hidden';
      if (pageVisibleRef.current) {
        lastIdleRenderMsRef.current = 0;
        sceneApiRef.current?.render(performance.now());
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const [isMobile] = useState(
    () => window.matchMedia('(max-width: 768px)').matches || window.matchMedia('(pointer: coarse)').matches
  );
  const [reduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const location = useLocation();
  const navigate = useNavigate();
  const isContactRoute = location.pathname === '/contact';

  useEffect(() => {
    if (reduced || isMobile) return;
    const onMove = (e) => {
      sceneApiRef.current?.setPointer(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1
      );
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [reduced, isMobile]);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;

    const sceneConfig = {
      ...CONFIG,
      nebula: SCENE_THEMES.home.nebula,
    };

    try {
      sceneApiRef.current = createScene({
        canvas: canvasRef.current,
        config: sceneConfig,
        isMobile,
        reduced,
      });
      sceneApiRef.current.render(0);
      setGlassSceneApi(sceneApiRef);
    } catch (err) {
      console.warn('[Taylor-Marriott] WebGL unavailable', err);
      sceneApiRef.current = {
        render: () => {},
        setScroll: () => {},
        setScrollImmediate: () => {},
        setFocal: () => {},
        setFov: () => {},
        getCamera: () => ({ focal: 0, fov: 60 }),
        getScroll: () => 0,
        resetCamera: () => {},
        resetPointer: () => {},
        lockView: () => {},
        setNebulaTransitionZoom: () => {},
        getNebulaTransitionZoom: () => 1,
        freezeNebulaAnim: () => {},
        resetNebulaTransition: () => {},
        setPointer: () => {},
        setNebula: () => {},
        onAfterRender: () => () => {},
        dispose: () => {},
      };
      canvasRef.current.style.display = 'none';
      setGlassSceneApi(sceneApiRef);
    }

    gsap.set('.contact-overlay', { autoAlpha: 0, visibility: 'hidden', pointerEvents: 'none' });

    const IDLE_RENDER_INTERVAL_MS = 33;

    const renderTick = (time) => {
      if (!pageVisibleRef.current) return;

      const needsFullRate =
        getGlassSurfaceCount() > 0 ||
        transitioningRef.current ||
        overlayOpenRef.current;

      if (!needsFullRate) {
        const now = performance.now();
        if (now - lastIdleRenderMsRef.current < IDLE_RENDER_INTERVAL_MS) return;
        lastIdleRenderMsRef.current = now;
      }

      sceneApiRef.current?.render(time);
    };
    gsap.ticker.add(renderTick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(renderTick);
      sceneApiRef.current?.dispose();
    };
  }, [isMobile, reduced]);

  useEffect(() => {
    const titles = {
      contact: 'Contact — Taylor-Marriott',
      portal: 'Client Portal — Taylor-Marriott',
    };
    if (overlayMode) {
      document.title = titles[overlayMode];
      return;
    }
    document.title = isContactRoute
      ? 'Contact — Taylor-Marriott'
      : 'Taylor-Marriott — Design & Build';
  }, [overlayMode, isContactRoute]);

  useEffect(() => {
    if (overlayOpen) return;
    const theme = isContactRoute ? SCENE_THEMES.contact.nebula : SCENE_THEMES.home.nebula;
    sceneApiRef.current?.setNebula?.(theme);
  }, [isContactRoute, overlayOpen]);

  useEffect(() => {
    const lockHomeScroll = isMobile && !HOME_BELOW_HERO;
    document.documentElement.classList.toggle('overlay-open', overlayOpen);
    document.documentElement.classList.toggle('contact-route', isContactRoute);
    document.documentElement.classList.toggle('site-scroll-lock', lockHomeScroll && !overlayOpen && !isContactRoute);
    return () => {
      document.documentElement.classList.remove('overlay-open', 'contact-route', 'site-scroll-lock');
    };
  }, [isMobile, overlayOpen, isContactRoute]);

  useLayoutEffect(() => {
    if (!overlayMode) return;
    showOverlayPanel();
  }, [overlayMode, overlaySession]);

  const registerLenis = useCallback((instance) => {
    lenisRef.current = instance;
  }, []);

  const openOverlay = useCallback((mode) => {
    if (transitioningRef.current || overlayOpen) return;
    transitioningRef.current = true;

    const startScroll = sceneApiRef.current?.getScroll?.() ?? 0;
    preOverlaySceneScrollRef.current = startScroll;
    const scrollProxy = { scroll: startScroll };
    const zoomProxy = { zoom: sceneApiRef.current?.getNebulaTransitionZoom?.() ?? 1 };

    sceneApiRef.current?.freezeNebulaAnim?.();
    suspendScroll(lenisRef);

    const completeOpen = () => {
      hidePageContentForOverlay();
      setOverlaySession((session) => session + 1);
      setOverlayMode(mode);
      transitioningRef.current = false;
    };

    if (reduced) {
      hidePageContentForOverlay();
      setOverlaySession((session) => session + 1);
      setOverlayMode(mode);
      transitioningRef.current = false;
      return;
    }

    gsap.timeline({ onComplete: completeOpen })
      .to('.page-content', {
        autoAlpha: 0,
        filter: 'blur(12px)',
        duration: CONFIG.transitionDuration * 0.55,
        ease: 'power2.in',
      }, 0)
      .to(scrollProxy, {
        scroll: startScroll + CONFIG.transitionScroll,
        duration: CONFIG.transitionDuration,
        ease: 'power3.inOut',
        onUpdate: () => sceneApiRef.current?.setScroll(scrollProxy.scroll),
      }, 0)
      .to(zoomProxy, {
        zoom: CONFIG.transitionNebulaZoom,
        duration: CONFIG.transitionDuration,
        ease: 'power3.inOut',
        onUpdate: () => sceneApiRef.current?.setNebulaTransitionZoom?.(zoomProxy.zoom),
      }, 0);
  }, [overlayOpen, reduced]);

  const openContact = useCallback(() => openOverlay('contact'), [openOverlay]);
  const openPortal = useCallback(() => openOverlay('portal'), [openOverlay]);

  const closeOverlay = useCallback(() => {
    if (transitioningRef.current || !overlayOpen) return;
    transitioningRef.current = true;

    const finishClose = () => {
      sceneApiRef.current?.setScrollImmediate?.(preOverlaySceneScrollRef.current);
      sceneApiRef.current?.resetNebulaTransition?.();
      setOverlayMode(null);
      revealHomeContent();
      lenisRef.current?.start();
      transitioningRef.current = false;
    };

    hideOverlayPanel(() => {
      if (reduced) {
        finishClose();
        return;
      }

      const zoomProxy = { zoom: sceneApiRef.current?.getNebulaTransitionZoom?.() ?? CONFIG.transitionNebulaZoom };
      gsap.to(zoomProxy, {
        zoom: 1,
        duration: CONFIG.transitionDuration * 0.85,
        ease: 'power3.out',
        onUpdate: () => sceneApiRef.current?.setNebulaTransitionZoom?.(zoomProxy.zoom),
        onComplete: finishClose,
      });
    });
  }, [overlayOpen, reduced]);

  useLayoutEffect(() => {
    const mode = location.state?.openContact
      ? 'contact'
      : location.state?.openPortal
        ? 'portal'
        : null;
    if (!mode || overlayOpen || transitioningRef.current) return;

    navigate('.', { replace: true, state: null });
    openOverlay(mode);
  }, [location.state, overlayOpen, navigate, openOverlay]);

  const value = {
    containerRef,
    sceneApiRef,
    isMobile,
    reduced,
    registerLenis,
    overlayMode,
    overlayOpen,
    contactOpen: overlayMode === 'contact',
    openContact,
    openPortal,
    closeOverlay,
    closeContact: closeOverlay,
  };

  return (
    <ShellContext.Provider value={value}>
      <div ref={containerRef}>
        <canvas ref={canvasRef} id="webgl" aria-hidden="true"></canvas>

        <header className="site-head">
          <Link
            to="/"
            className="logo"
            aria-label="Taylor-Marriott"
            onClick={(e) => {
              if (!overlayOpen) return;
              e.preventDefault();
              closeOverlay();
            }}
          >
            <img src={taylorMarriottWordmark} alt="Taylor-Marriott" width={180} height={24} />
          </Link>
          <div className="site-head-actions">
            {!overlayOpen && !isContactRoute && (
              <PortalLink className="head-portal head-action">Client Portal</PortalLink>
            )}
            {overlayOpen ? (
              <button type="button" className="head-contact head-action" onClick={closeOverlay}>
                Return
              </button>
            ) : isContactRoute ? (
              <Link to="/" className="head-contact head-action">
                Home
              </Link>
            ) : (
              <ContactLink className="head-contact head-action">Contact</ContactLink>
            )}
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>

        <div
          className={`contact-overlay${overlayMode === 'portal' ? ' contact-overlay--portal' : ''}`}
          aria-hidden={!overlayOpen}
        >
          {overlayMode === 'contact' && <ContactPanel key={overlaySession} onClose={closeOverlay} />}
          {overlayMode === 'portal' && <PortalLoginPanel key={overlaySession} />}
        </div>
      </div>
    </ShellContext.Provider>
  );
}
