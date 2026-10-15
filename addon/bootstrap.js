/* Zotero's bootstrap scope supplies Services, Zotero, Cc, Ci, IOUtils and PathUtils.
 *
 * During an in-place upgrade Zotero may start the new version inside this same scope while it is still shutting the
 * old one down. So shutdown finishes synchronously (it only waits for pending saves when Zotero quits), startup first
 * clears any instance left in the scope, and an instance refuses a late shutdown that was meant for its predecessor. */
var GlossaZotero;
var APP_SHUTDOWN = 2;

async function startup(data, reason) {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  stop(0);
  try {
    Services.scriptloader.loadSubScript(data.rootURI + "glossa.js", this);
    await GlossaZotero.startup(data, reason);
  } catch (error) {
    stop(0);
    throw error;
  }
}

function stop(reason) {
  const instance = GlossaZotero;
  const result = instance?.shutdown(reason || 0);
  if (result === false) return undefined; // A newer instance already owns this scope.
  if (GlossaZotero === instance) GlossaZotero = undefined;
  return result;
}

function onMainWindowLoad({ window }) {
  GlossaZotero?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  GlossaZotero?.onMainWindowUnload(window);
}

function shutdown(data, reason) {
  // A promise only when Zotero quits, so the last state write finishes first.
  return reason === APP_SHUTDOWN ? stop(reason) : void stop(reason);
}

function install() {}
function uninstall() {}
