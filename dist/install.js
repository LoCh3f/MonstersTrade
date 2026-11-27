let installPrompt;
let installedThisVisit = false;

export function isInstalled() {
  return installedThisVisit || window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true;
}

export function setupInstallation(onInstalled) {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installedThisVisit = true;
    installPrompt = undefined;
    onInstalled();
  });
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(error => {
      console.warn('Offline setup failed.', error);
    });
  }
}

export async function promptInstallation() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = undefined;
  try {
    await prompt.prompt();
    return true;
  } catch {
    return false;
  }
}
