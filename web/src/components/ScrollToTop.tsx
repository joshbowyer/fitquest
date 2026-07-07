/**
 * ScrollToTop — auto-scroll to top of page on every route change.
 *
 * Why: the app uses <Link> / <NavLink> for in-app navigation, which
 * preserves scroll position by default. Long pages (Spiritual,
 * Coach, Insights, etc.) load in the scrolled-down position from
 * the previous page, so the user lands at the bottom and has to
 * scroll up to see the actual content. This component listens to
 * react-router's location changes and scrolls to top.
 *
 * Hash handling: if the URL has a `#fragment`, we scroll to that
 * element instead (gives #class and #anchor deep-links from the
 * roadmap their full meaning). Uses scrollIntoView with smooth
 * behavior so deep-links from a same-page jump animate instead
 * of snapping.
 *
 * Mount ONCE at the top of <App> (above the <Routes>); no props.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      // Defer one frame so the new route has rendered and the
      // target element is in the DOM before we try to scroll to
      // it. Without this, switching to a page with a #hash from
      // another page scrolls to 0 first then jumps (looks janky).
      const id = location.hash.slice(1);
      const tryScroll = () => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          // Element not mounted yet (lazy route component? route
          // guard not done?); retry on the next frame, up to 10
          // times before giving up and going to the top.
          if (retries < 10) {
            retries++;
            requestAnimationFrame(tryScroll);
          } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      };
      let retries = 0;
      requestAnimationFrame(tryScroll);
      return;
    }

    // No hash: scroll to the top of the page.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // `location` is in the dep array so the effect re-fires on
    // every route change. `location.key` is what react-router
    // increments per navigation; using it (not the whole object)
    // keeps the effect stable across query-param tweaks that don't
    // actually change the route.
  }, [location.pathname, location.search, location.hash, location.key]);

  return null;
}