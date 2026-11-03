/* AAi install/update experience: Progressive Web App, no Capacitor required. */
(() => {
  'use strict';
  let deferredInstallPrompt = null;
  let previousController = Boolean(navigator.serviceWorker?.controller);
  const installButtons = () => document.querySelectorAll('[data-aai-install]');

  const standalone = () => window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  function updateInstallButtons() {
    installButtons().forEach(button => {
      button.hidden = standalone();
      button.setAttribute('aria-hidden', String(standalone()));
    });
  }

  function showInfo(title, message) {
    if (typeof window.showAlertMessage === 'function') {
      window.showAlertMessage(message, title);
    } else {
      window.alert(title + '\n\n' + message);
    }
  }

  window.installAAi = async function installAAi() {
    if (standalone()) return;

    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        showInfo('Pasang AAi', 'Buka menu browser lalu pilih Instal aplikasi atau Tambahkan ke layar utama.');
      }
      updateInstallButtons();
      return;
    }

    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      showInfo('Pasang AAi di iPhone', 'Buka AAi di Safari, ketuk tombol Bagikan (kotak dengan panah ke atas), lalu pilih Tambahkan ke Layar Utama.');
    } else {
      showInfo('Pasang AAi', 'Di Chrome atau Edge, buka menu browser (⋮) lalu pilih Instal aplikasi atau Tambahkan ke layar utama. Jika AAi sudah terpasang, buka dari ikon aplikasi.');
    }
  };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtons();
  });

  function syncNetworkNotice() {
    const notice = document.getElementById('aaiNetworkNotice');
    if (notice) notice.hidden = navigator.onLine;
  }

  window.addEventListener('online', syncNetworkNotice);
  window.addEventListener('offline', syncNetworkNotice);
  document.addEventListener('DOMContentLoaded', () => {
    updateInstallButtons();
    syncNetworkNotice();
    const reloadButton = document.getElementById('aaiReloadForUpdate');
    if (reloadButton) reloadButton.addEventListener('click', () => location.reload());
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (previousController) {
        const notice = document.getElementById('aaiUpdateNotice');
        if (notice) notice.hidden = false;
      }
      previousController = true;
    });

    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'});
        registration.update().catch(() => {});
      } catch (error) {
        console.warn('[AAi PWA] Service worker belum aktif:', error);
      }
    });
  }
})();
