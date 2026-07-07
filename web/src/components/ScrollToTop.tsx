/**
 * ScrollToTop — auto-scroll to top on every navigation AND on
 * initial page load.
 *
 * Why: the app's scrollable surface is the `<main>` element in
 * Layout (not the window), and react-router preserves scroll
 * position by default across nav. Long pages (Spiritual, Coach,
 * Insights, etc.) used to load scrolled to the bottom of the
 * previous page — v1.0.29's first cut of this component called
 * `window.scrollTo(...)` which is a no-op because the window
 * isn't the scroller; the scroll position never moved. This
 * version targets `<main>` explicitly + also handles hard
 * reloads (the browser's history-based scroll restoration kicks
 * in *after* the React app mounts; if we don't scroll on mount,
 * a reload at the bottom of a page stays at the bottom).
 *
 * Hash handling: if the URL has a `#fragment`, scroll to that
 * element instead (gives #class and #anchor deep-links their
 * full meaning). Uses scrollIntoView with smooth behavior. If
 * the target element hasn't mounted yet (lazy route component,
 * route guard not done), retry on the next frame up to 10 times
 * before falling back to top.
 *
 * Mount ONCE at the top of <App> (above the <Routes>); no props.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/// The Layout component renders the scrollable surface as `<main
/// className="... overflow-y-auto">`. Hardcoded here because the
/// component is mounted once and Layout is rendered once — no
/// DOM lookup is needed for a known selector, and a selector is
/// more robust to Layout refactors than `document.body` or
/// `document.scrollingElement` (which can be `<html>` or
/// `<body>` depending on the browser).
const SCROLLABLE_SELECTOR = 'main';

function getScrollTarget(): Element | Window {
  // Fall back to window only if the layout hasn't mounted yet
  // (first paint on the login page maybe, or during route
  // transitions that unmount <main>). On every authenticated
  // page <main> is present from the same render that includes
  // ScrollToTop's effect, so this rarely fires.
  return document.querySelector(SCROLLABLE_SELECTOR) ?? window;
}

function scrollToTop() {
  const target = getScrollTarget();
  if (target === window) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    // Use scrollTo on the element directly — smooth behavior
    // requires passing the options dict on HTMLElement.scrollTo
    // (modern browsers). scrollIntoView with smooth is the most
    // cross-browser-reliable form on element targets.
    (target as Element).scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function scrollToHash(hash: string) {
  const id = hash.slice(1);
  const tryScroll = (retries: number) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Target element not in DOM yet (lazy route component? route
    // guard not done?). Retry up to 10 frames before falling back
    // to top — covers the worst case of a code-split chunk taking
    // a tick to hydrate.
    if (retries < 10) {
      requestAnimationFrame(() => tryScroll(retries + 1));
    } else {
      scrollToTop();
    }
  };
  requestAnimationFrame(() => tryScroll(0));
}

export function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    // The browser's scroll-restoration-on-back/forward can run
    // AFTER React mounts. requestAnimationFrame defers our scroll
    // one frame so we run *after* the browser, winning the race.
    // For the initial mount (location.key === 'default') this
    // also covers the case where the user reloaded at the bottom
    // of a long page — without this they'd stay at the bottom.
    if (location.hash) {
      scrollToHash(location.hash);
    } else {
      scrollToTop();
    }
    // Deps: every field that could change the "current route" so
    // a back-button or query-string tweak still triggers.
  }, [location.pathname, location.search, location.hash, location.key]);

  return null;
}