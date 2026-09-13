import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { createScene } from '../lib/scene';
import { CONFIG, HOME_BELOW_HERO, QURAN_ENABLED, SCENE_THEMES } from '../config';
import { hasLiquidGlassRoots } from '../lib/liquidGlassManager';
import { hasFieldBlur, setFieldBlurSceneApi } from '../lib/fieldBlurRegistry';
import { hasNavBlur, setNavBlurSceneApi } from '../lib/navBlurRegistry';
import { hasSceneRefractCanvases, setSceneRefractApi } from '../lib/sceneRefractRegistry';
import taylorMarriottWordmark from '../assets/taylor-marriott-wordmark.png';
import ContactLink from '../components/ContactLink';
import NavProgressiveBlur from '../components/NavProgressiveBlur';
import QuranToggle from '../components/QuranToggle';
import {
  fadeContactPageOut,
  fadePageChromeIn,
  fadePageChromeOut,
  primeIncomingRoutePage,
} from '../lib/pageTransition';

const ShellContext = createContext(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used within Shell');
  return ctx;
}

export default function Shell() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneApiRef = useRef(null);
  const lenisRef = useRef(null);
  const transitioningRef = useRef(false);
  const pageVisibleRef = useRef(
    typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
  );
  const lastIdleRenderMsRef = useRef(0);
  const routePathRef = useRef(null);
  const routeTweenRef = useRef(null);
  const contactEntranceFromRouteRef = useRef(false);
  const [isRouteTransitioning, setIsRouteTransitioning] = useState(false);

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
  const isForMuslimsRoute = location.pathname === '/for-muslims';
  const isAdminRoute = location.pathname === '/admin' || location.pathname === '/ops';

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
      setNavBlurSceneApi(sceneApiRef);
      setFieldBlurSceneApi(sceneApiRef);
      setSceneRefractApi(sceneApiRef);
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
      setNavBlurSceneApi(sceneApiRef);
      setFieldBlurSceneApi(sceneApiRef);
      setSceneRefractApi(sceneApiRef);
    }

    const IDLE_RENDER_INTERVAL_MS = 33;

    const renderTick = (time) => {
      if (!pageVisibleRef.current) return;

      const needsFullRate =
        hasNavBlur() ||
        hasFieldBlur() ||
        hasLiquidGlassRoots() ||
        hasSceneRefractCanvases() ||
        transitioningRef.current;

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
    if (isAdminRoute) {
      document.title = 'Admin — Taylor-Marriott';
      return;
    }
    if (isForMuslimsRoute) {
      document.title = 'For Muslims — Taylor-Marriott';
      return;
    }
    document.title = isContactRoute
      ? 'Contact — Taylor-Marriott'
      : 'Taylor-Marriott — Design & Build';
  }, [isContactRoute, isForMuslimsRoute, isAdminRoute]);

  useEffect(() => {
    const theme = isForMuslimsRoute
      ? SCENE_THEMES.muslims.nebula
      : isAdminRoute
        ? SCENE_THEMES.contact.nebula
        : SCENE_THEMES.home.nebula;
    sceneApiRef.current?.setNebula?.(theme);
  }, [isForMuslimsRoute, isAdminRoute]);

  useEffect(() => {
    const lockHomeScroll = isMobile && !HOME_BELOW_HERO;
    document.documentElement.classList.toggle('contact-route', isContactRoute || isAdminRoute || isForMuslimsRoute);
    document.documentElement.classList.toggle('site-scroll-lock', lockHomeScroll && !isContactRoute && !isAdminRoute && !isForMuslimsRoute);
    return () => {
      document.documentElement.classList.remove('contact-route', 'site-scroll-lock');
    };
  }, [isMobile, isContactRoute, isForMuslimsRoute, isAdminRoute]);

  useLayoutEffect(() => {
    const nextPath = location.pathname;
    const prevPath = routePathRef.current;

    if (prevPath === null) {
      routePathRef.current = nextPath;
      return;
    }

    if (prevPath === nextPath) return;

    const involvesContact = prevPath === '/contact' || nextPath === '/contact';
    routePathRef.current = nextPath;

    if (!involvesContact || reduced) return;

    // Entering /contact — Contact page runs its own entrance on mount.
    if (nextPath === '/contact') return;

    transitioningRef.current = true;
    routeTweenRef.current?.kill();
    primeIncomingRoutePage();
    routeTweenRef.current = fadePageChromeIn({
      handoff: true,
      onComplete: () => {
        transitioningRef.current = false;
        setIsRouteTransitioning(false);
      },
    });

    return () => routeTweenRef.current?.kill();
  }, [location.pathname, reduced]);

  const beginPageRouteTransition = useCallback((path) => {
    if (transitioningRef.current) return;
    if (reduced) {
      navigate(path);
      return;
    }

    transitioningRef.current = true;
    contactEntranceFromRouteRef.current = path === '/contact';
    setIsRouteTransitioning(true);
    routeTweenRef.current?.kill();

    const leavingContact = location.pathname === '/contact';

    if (leavingContact) {
      fadeContactPageOut({
        onComplete: () => {
          navigate(path);
        },
      });
      return;
    }

    fadePageChromeOut({
      onComplete: () => {
        navigate(path);
      },
    });
  }, [location.pathname, navigate, reduced]);

  useEffect(() => {
    if (!location.state?.openContact || location.pathname === '/contact') return;
    navigate('/contact', { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const registerLenis = useCallback((instance) => {
    lenisRef.current = instance;
  }, []);

  const finishRouteTransition = useCallback(() => {
    transitioningRef.current = false;
    contactEntranceFromRouteRef.current = false;
    setIsRouteTransitioning(false);
  }, []);

  const value = {
    containerRef,
    sceneApiRef,
    isMobile,
    reduced,
    registerLenis,
    beginPageRouteTransition,
    isRouteTransitioning,
    contactEntranceFromRouteRef,
    finishRouteTransition,
  };

  return (
    <ShellContext.Provider value={value}>
      <div ref={containerRef}>
        <canvas ref={canvasRef} id="webgl" aria-hidden="true"></canvas>
        <NavProgressiveBlur />

        <header className="site-head">
          <Link to="/" className="logo" aria-label="Taylor-Marriott">
            <img src={taylorMarriottWordmark} alt="Taylor-Marriott" width={180} height={24} />
          </Link>
          <div className="site-head-actions">
            {isContactRoute || isAdminRoute ? (
              <Link
                to="/"
                className="head-contact head-action"
                onClick={(e) => {
                  if (reduced || !isContactRoute) return;
                  e.preventDefault();
                  beginPageRouteTransition('/');
                }}
              >
                Home
              </Link>
            ) : isForMuslimsRoute ? (
              <>
                {QURAN_ENABLED && <QuranToggle />}
                <ContactLink className="head-contact head-action">Contact</ContactLink>
              </>
            ) : (
              <ContactLink className="head-contact head-action">Contact</ContactLink>
            )}
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </ShellContext.Provider>
  );
}
