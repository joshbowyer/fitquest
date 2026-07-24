import { useEffect, useRef, useState } from 'react';

/**
 * Trackpoint for the map + streams chart. Mirrors the API's TrackPoint.
 * Coordinates and metrics are nullable per-point because FIT GPS
 * fixes aren't always present (tunnels, indoor segments, watches
 * that record only cadence, etc.).
 */
export type TrackPoint = {
  t: number;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  hr: number | null;
  cad: number | null;
  pwr: number | null;
  spd: number | null;
  dist: number | null;
};

declare global {
  interface Window {
    L?: any;
    __leafletLoadingPromise?: Promise<any>;
  }
}

/**
 * ActivityMap — renders an activity's track on a Leaflet map.
 *
 * Leaflet is loaded from a CDN (no npm dependency) and stashed on
 * `window.L` for the lifetime of the page. CSS is also pulled from
 * unpkg so we don't have to bundle leaflet.css.
 *
 * Shows a polyline through all trackpoints that have a GPS fix,
 * plus a green "start" marker and a red "finish" marker.
 */
export function ActivityMap({ points, height = 360 }: { points: TrackPoint[]; height?: number }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  // Load Leaflet + CSS once on mount
  useEffect(() => {
    const cssHref = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    if (!document.querySelector(`link[href="${cssHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    const w = window;
    if (w.L) {
      setLoadStatus('ready');
      return;
    }
    if (w.__leafletLoadingPromise) {
      w.__leafletLoadingPromise
        .then(() => setLoadStatus('ready'))
        .catch(() => setLoadStatus('failed'));
      return;
    }
    w.__leafletLoadingPromise = new Promise<any>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin = '';
      script.onload = () => resolve(w.L);
      script.onerror = () => reject(new Error('Leaflet CDN failed to load'));
      document.head.appendChild(script);
    });
    w.__leafletLoadingPromise
      .then(() => setLoadStatus('ready'))
      .catch(() => setLoadStatus('failed'));
  }, []);

  // Build / refresh map when points change
  useEffect(() => {
    let cancelled = false;
    const w = window;

    function drawMap(L: any) {
      if (cancelled || !mapRef.current || !L) return;
      // Tear down previous instance (Leaflet doesn't react well to
      // re-rendering into the same div).
      if (mapInstance.current) {
        try { mapInstance.current.remove(); } catch {}
        mapInstance.current = null;
      }

      const withGps = points.filter(
        (p): p is TrackPoint & { lat: number; lon: number } => p.lat != null && p.lon != null,
      );
      if (withGps.length === 0) return;

      try {
        // Center on the mean of all points
        const sumLat = withGps.reduce((s, p) => s + p.lat, 0);
        const sumLon = withGps.reduce((s, p) => s + p.lon, 0);
        const center: [number, number] = [sumLat / withGps.length, sumLon / withGps.length];

        const map = L.map(mapRef.current, {
          zoomControl: true,
          scrollWheelZoom: false,
          attributionControl: true,
        }).setView(center, 14);
        mapInstance.current = map;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap',
          maxZoom: 19,
        }).addTo(map);

        const latlngs = withGps.map((p) => [p.lat, p.lon] as [number, number]);
        const polyline = L.polyline(latlngs, {
          color: '#14d6e8',
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);

        // Start (green) + finish (red) markers
        const startIcon = L.divIcon({
          className: '',
          html: '<div style="background:#9bff5c;width:14px;height:14px;border:2px solid #0e0f1a;border-radius:50%;box-shadow:0 0 8px #9bff5c;"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const endIcon = L.divIcon({
          className: '',
          html: '<div style="background:#ff2bd6;width:14px;height:14px;border:2px solid #0e0f1a;border-radius:50%;box-shadow:0 0 8px #ff2bd6;"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        L.marker(latlngs[0], { icon: startIcon, title: 'Start' }).addTo(map);
        L.marker(latlngs[latlngs.length - 1], { icon: endIcon, title: 'Finish' }).addTo(map);

        // Fit polyline to view with padding
        map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
      } catch (err) {
        console.error('[ActivityMap] failed to render:', err);
        setLoadStatus('failed');
      }
    }

    if (loadStatus !== 'ready') return;

    if (w.L) {
      drawMap(w.L);
    } else if (w.__leafletLoadingPromise) {
      w.__leafletLoadingPromise.then((L) => { if (!cancelled) drawMap(L); }).catch(() => {});
    }

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        try { mapInstance.current.remove(); } catch {}
        mapInstance.current = null;
      }
    };
  }, [points, loadStatus]);

  const withGps = points.filter((p) => p.lat != null && p.lon != null).length;

  if (withGps === 0) {
    return (
      <div
        className="border border-ink-500/30 bg-bg-800/40 flex items-center justify-center text-[10px] font-mono text-ink-400"
        style={{ height }}
      >
        No GPS data in this activity (treadmill / indoor / unsynced watch).
      </div>
    );
  }

  if (loadStatus === 'failed') {
    return (
      <div
        className="border border-neon-red/40 bg-neon-red/5 flex items-center justify-center text-[10px] font-mono text-neon-red p-3 text-center"
        style={{ height }}
      >
        Map library failed to load (CDN blocked?). {withGps} GPS pts are still available for the streams chart below.
      </div>
    );
  }

  return (
    // isolation: isolate traps every Leaflet-internal z-index (tile/
    // overlay/marker/popup panes at 200-700, plus .leaflet-top/
    // .leaflet-bottom zoom+attribution controls at 1000 via the
    // CDN leaflet.css we don't control) inside this wrapper's own
    // stacking context. The wrapper itself then participates in the
    // page's root stacking context at z-index: auto, which always
    // loses to the sticky header — permanently, regardless of what
    // z-index future Leaflet versions use internally.
    <div className="relative isolate">
      <div
        ref={mapRef}
        className="border border-ink-500/30"
        style={{ height, width: '100%' }}
      />
      <div className="absolute top-1 right-1 bg-bg-900/80 border border-ink-500/40 px-1.5 py-0.5 text-[9px] font-mono text-ink-300 tracking-widest uppercase pointer-events-none">
        {withGps} GPS pts
      </div>
    </div>
  );
}