(() => {
  'use strict';

  const APP_PATH = '/apps/sst-controle/';
  const MANIFEST_URL = `${APP_PATH}manifest.webmanifest?v=3`;
  let deferredPrompt = null;
  const ua = String(navigator.userAgent || '').toLowerCase();

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isAndroid() { return /android/i.test(navigator.userAgent); }
  function isInAppBrowser() { return /whatsapp|instagram|fbav|fban|messenger|; wv\)|\bwv\b/i.test(ua); }

  function ensureMetadata() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = MANIFEST_URL;
      document.head.appendChild(link);
    }
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement('link');
      icon.rel = 'apple-touch-icon';
      icon.href = `${APP_PATH}icon-192.png?v=3`;
      document.head.appendChild(icon);
    }
    const meta = (name, content) => {
      if (document.querySelector(`meta[name="${name}"]`)) return;
      const node = document.createElement('meta');
      node.name = name;
      node.content = content;
      document.head.appendChild(node);
    };
    meta('apple-mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    meta('apple-mobile-web-app-title', 'Nexus SST');
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
    try {
      const registration = await navigator.serviceWorker.register(`${APP_PATH}sw.js?v=3`, { scope: APP_PATH, updateViaCache: 'none' });
      navigator.serviceWorker.ready.then(() => window.dispatchEvent(new CustomEvent('nexus:pwa-ready'))).catch(() => undefined);
      return registration;
    } catch (error) {
      console.warn('[Nexus PWA] Service worker não registrado.', error);
      return null;
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    window.dispatchEvent(new CustomEvent('nexus:pwa-installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('nexus:pwa-installed'));
  });

  function openInChrome() {
    if (!isAndroid()) return false;
    const current = new URL(location.href);
    const fallback = encodeURIComponent(current.href);
    const target = `${current.host}${current.pathname}${current.search}${current.hash}`;
    location.href = `intent://${target}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
    return true;
  }

  async function install() {
    if (isStandalone()) return { status: 'installed' };
    if (isIOS()) return { status: 'ios-manual' };
    if (isAndroid() && isInAppBrowser()) return { status: 'android-inapp' };
    if (!deferredPrompt) return { status: 'manual' };

    const prompt = deferredPrompt;
    deferredPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return { status: choice?.outcome === 'accepted' ? 'accepted' : 'dismissed' };
  }

  window.NexusPWA = {
    install,
    openInChrome,
    isStandalone,
    isIOS,
    isAndroid,
    isInAppBrowser,
    get installPromptReady() { return !!deferredPrompt; },
    installerUrl: `${APP_PATH}instalar.html`
  };

  ensureMetadata();
  registerServiceWorker();
})();
