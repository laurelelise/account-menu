const VALID_STATES = new Set([
  "signed-out",
  "signed-in-sync-off",
  "signed-in",
  "connected-devices",
  "devices-added",
]);

const accountButton = document.getElementById("account-button");
const hamburgerButton = document.getElementById("hamburger-button");
const accountPanel = document.getElementById("account-panel");
const appMenuPanel = document.getElementById("app-menu-panel");
const subPanel = document.getElementById("sub-panel");
const scrim = document.getElementById("menu-scrim");

/* The main panel shows connected-devices when the state is devices-added —
   the device-detail content flies out into the separate sub-panel. */
function effectiveMainState(s) {
  return s === "devices-added" ? "connected-devices" : s;
}

const state = {
  openMenu: "none",
  accountState: readStateFromHash() ?? "signed-out",
};

accountPanel.dataset.activeState = effectiveMainState(state.accountState);
document.body.dataset.signinState =
  state.accountState === "signed-out" ? "signed-out" : "signed-in";

function readStateFromHash() {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  const match = raw.match(/(?:state=)?([\w-]+)/);
  if (!match) return null;
  const candidate = match[1];
  return VALID_STATES.has(candidate) ? candidate : null;
}

function setAccountState(next) {
  if (!VALID_STATES.has(next)) return;
  state.accountState = next;
  accountPanel.dataset.activeState = effectiveMainState(next);
  document.body.dataset.signinState =
    next === "signed-out" ? "signed-out" : "signed-in";
  // Sub-panel is only opened by explicit clicks on a device row, never auto.
  if (next !== "devices-added") hideSubPanel();
}

/* Sub-panel trigger: the .menu-item the user clicked to open the flyout.
   We use it both to keep the row in an "active" highlight and to align the
   sub-panel's first row with the trigger row (native cascading-menu pattern). */
let subPanelTrigger = null;

function showSubPanel(trigger, subState) {
  if (subState) subPanel.dataset.activeState = subState;
  if (trigger !== undefined) {
    if (subPanelTrigger && subPanelTrigger !== trigger) {
      subPanelTrigger.classList.remove("menu-item--active");
    }
    subPanelTrigger = trigger || null;
    if (subPanelTrigger) subPanelTrigger.classList.add("menu-item--active");
  }
  subPanel.hidden = false;
  positionSubPanel();
}

function hideSubPanel() {
  subPanel.hidden = true;
  if (subPanelTrigger) {
    subPanelTrigger.classList.remove("menu-item--active");
    subPanelTrigger = null;
  }
}

function positionSubPanel() {
  if (subPanel.hidden) return;
  const mainRect = accountPanel.getBoundingClientRect();
  const subWidth = subPanel.offsetWidth || 320;
  const gap = 4;
  const viewport = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;
  const edgePad = 8;
  const panelPadding = 8; // matches .panel padding so first row lines up

  let left = mainRect.right + gap;
  let placement = "right";
  if (left + subWidth > viewport - edgePad) {
    left = mainRect.left - subWidth - gap;
    placement = "left";
    if (left < edgePad) left = edgePad;
  }

  // Align sub-panel's top with the trigger row's top (item-to-item alignment).
  // Subtract the panel's own padding so the first sub-panel row sits at the
  // exact y of the trigger row. Clamp to viewport bounds.
  let top;
  if (subPanelTrigger) {
    const triggerRect = subPanelTrigger.getBoundingClientRect();
    top = triggerRect.top - panelPadding;
  } else {
    top = mainRect.top;
  }
  const subHeight = subPanel.offsetHeight || 220;
  if (top + subHeight > viewportH - edgePad) top = viewportH - subHeight - edgePad;
  if (top < edgePad) top = edgePad;

  subPanel.style.left = `${Math.round(left)}px`;
  subPanel.style.top = `${Math.round(top)}px`;
  subPanel.dataset.placement = placement;
}

function openPanel(which) {
  closePanels({ silent: true });
  state.openMenu = which;
  const panel = which === "account" ? accountPanel : appMenuPanel;
  const anchor = which === "account" ? accountButton : hamburgerButton;
  panel.hidden = false;
  scrim.hidden = false;
  anchor.setAttribute("aria-expanded", "true");
  positionPanel(panel, anchor);
  if (which === "account" && accountPanel.dataset.variant === "a") {
    retriggerSyncIconAnimation();
  }
  if (which === "account" && accountPanel.dataset.variant === "b") {
    runSyncStatusCheck();
  }
}

/* Retrigger the rotation animation on every visible Sync icon-button by
   removing then re-adding the class (with a forced reflow in between).
   Called when the account menu opens in variant A and when the user
   explicitly clicks a Sync icon button. */
function retriggerSyncIconAnimation(scope) {
  const buttons = (scope || accountPanel).querySelectorAll(
    '.icon-button[aria-label="Sync now"]'
  );
  buttons.forEach((btn) => {
    btn.classList.remove("is-syncing");
    void btn.offsetWidth; // force reflow so the next add re-runs the keyframes
    btn.classList.add("is-syncing");
  });
}

// Clicking the Sync icon button replays the spin (regardless of variant).
accountPanel.addEventListener("click", (event) => {
  const btn = event.target.closest('.icon-button[aria-label="Sync now"]');
  if (btn) retriggerSyncIconAnimation(btn.parentElement || btn);
});

/* Variant B sync-status microinteraction.
   - Triggered only when the account menu opens AND sync is on.
   - Single 500ms icon rotation + 250ms subtitle crossfade to "Updated just now".
   - Reverts to "Last synced 5 minutes ago" after 8s (or restarts on next open).
   - Respects prefers-reduced-motion (skips rotation, still updates text). */
const SYNC_STATUS_REVERT_MS = 8000;
const SYNC_STATUS_FADE_MS = 250;
const SYNC_STATUS_ROTATE_MS = 2000;
const SYNC_STATUS_DEFAULT_TEXT = "Last synced 5 minutes ago";
const SYNC_STATUS_FRESH_TEXT = "Updated just now";

function runSyncStatusCheck() {
  const syncOn =
    state.accountState === "signed-in" ||
    state.accountState === "connected-devices" ||
    state.accountState === "devices-added";
  if (!syncOn) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rows = accountPanel.querySelectorAll('[data-sync-status="on"]');
  rows.forEach((row) => animateSyncStatusRow(row, reducedMotion));
}

function animateSyncStatusRow(row, reducedMotion) {
  const icon = row.querySelector(".menu-item__icon");
  const subtitle = row.querySelector(".menu-item__subtitle");
  if (!icon || !subtitle) return;

  if (row._syncUpdateTimer) clearTimeout(row._syncUpdateTimer);
  if (row._syncRevertTimer) clearTimeout(row._syncRevertTimer);

  // Restart icon rotation by removing then re-adding the class.
  icon.classList.remove("is-checking");
  if (!reducedMotion) {
    void icon.offsetWidth;
    icon.classList.add("is-checking");
  }

  // After the rotation completes, crossfade subtitle to "Updated just now".
  const updateAfter = reducedMotion ? 0 : SYNC_STATUS_ROTATE_MS;
  row._syncUpdateTimer = setTimeout(() => {
    crossfadeText(subtitle, SYNC_STATUS_FRESH_TEXT);
  }, updateAfter);

  // After the dwell, revert to the relative timestamp.
  row._syncRevertTimer = setTimeout(() => {
    crossfadeText(subtitle, SYNC_STATUS_DEFAULT_TEXT);
  }, SYNC_STATUS_REVERT_MS);
}

function crossfadeText(el, nextText) {
  if (el.textContent === nextText) return;
  el.classList.add("is-fading");
  setTimeout(() => {
    el.textContent = nextText;
    el.classList.remove("is-fading");
  }, SYNC_STATUS_FADE_MS);
}

function closePanels({ silent = false } = {}) {
  accountPanel.hidden = true;
  appMenuPanel.hidden = true;
  hideSubPanel();
  scrim.hidden = true;
  accountButton.setAttribute("aria-expanded", "false");
  hamburgerButton.setAttribute("aria-expanded", "false");
  if (!silent) state.openMenu = "none";
}

function positionPanel(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const panelWidth = panel.offsetWidth || 320;
  const gap = 4;
  const viewport = document.documentElement.clientWidth;
  const edgePad = 8;

  let left = rect.right - panelWidth;
  if (left + panelWidth > viewport - edgePad) left = viewport - panelWidth - edgePad;
  if (left < edgePad) left = edgePad;

  const top = rect.bottom + gap;

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function togglePanel(which) {
  if (state.openMenu === which) {
    closePanels();
  } else {
    openPanel(which);
  }
}

accountButton.addEventListener("click", (event) => {
  event.stopPropagation();
  togglePanel("account");
});

hamburgerButton.addEventListener("click", (event) => {
  event.stopPropagation();
  togglePanel("hamburger");
});

/* ----------------------------------------------------------------
   Simulation modal — variant B confirmation dialog
   ---------------------------------------------------------------- */
const simModal = document.getElementById("sim-modal");
const simModalTitle = document.getElementById("sim-modal-title");
const simModalBody = document.getElementById("sim-modal-body");
const simModalConfirm = document.getElementById("sim-modal-confirm");
const simModalCancel = document.getElementById("sim-modal-cancel");
const simModalClose = document.getElementById("sim-modal-close");
const simModalBackdrop = document.getElementById("sim-modal-backdrop");
let simModalOnConfirm = null;

function showSimModal({ title, body, action, onConfirm }) {
  simModalTitle.textContent = title;
  simModalBody.textContent = body;
  simModalConfirm.textContent = action;
  simModalOnConfirm = onConfirm;
  simModal.hidden = false;
  simModalConfirm.focus();
}
function hideSimModal() {
  simModal.hidden = true;
  simModalOnConfirm = null;
}
simModalConfirm.addEventListener("click", () => {
  const fn = simModalOnConfirm;
  hideSimModal();
  if (fn) fn();
});
simModalCancel.addEventListener("click", hideSimModal);
simModalClose.addEventListener("click", hideSimModal);
simModalBackdrop.addEventListener("click", hideSimModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !simModal.hidden) hideSimModal();
});

function isVariantB() {
  return accountPanel.dataset.variant === "b";
}

const ACTIONS = {
  signin: () => {
    // Variant B splits sign-in and sync-on into separate steps; variant A
    // signs in and lands directly on the synced state.
    const variant = accountPanel.dataset.variant === "b" ? "b" : "a";
    const targetState = variant === "b" ? "signed-in-sync-off" : "signed-in";
    closePanels({ silent: true });
    showSimModal({
      title: "Sign in to Firefox",
      body:
        "You’ll be taken to accounts.firefox.com to sign in or create a Mozilla account.",
      action: "Sign in",
      onConfirm: () => {
        openPanel("account");
        setAccountState(targetState);
      },
    });
  },
  "enable-sync": () => {
    // Variant B: simulate an out-of-menu Sync settings flow with a confirm.
    if (isVariantB()) {
      closePanels({ silent: true });
      showSimModal({
        title: "Turn on Sync",
        body:
          "Sync keeps your bookmarks, history, open tabs, and passwords up to date across your devices.",
        action: "Turn on Sync",
        onConfirm: () => {
          openPanel("account");
          setAccountState("signed-in");
        },
      });
      return;
    }
    setAccountState("signed-in");
  },
  signout: () => {
    setAccountState("signed-out");
  },
  "dismiss-promo": (target) => {
    const section = target.closest("[data-promo-state]");
    if (section) section.dataset.promoState = "compact";
  },
  "manage-sync": () => {
    closePanels({ silent: true });
    showSimModal({
      title: "Sync settings",
      body:
        "Choose what gets synced across your devices — bookmarks, history, passwords, open tabs, and more — and review recent sync activity.",
      action: "Open Sync settings",
      onConfirm: () => {
        openPanel("account");
      },
    });
  },
  "manage-account": () => {
    closePanels({ silent: true });
    showSimModal({
      title: "Manage your Mozilla account",
      body:
        "You’ll be taken to accounts.firefox.com to update your sign-in info, password, and connected devices.",
      action: "Continue",
      onConfirm: () => {
        // Reopen the menu where the user left off — no state change.
        openPanel("account");
      },
    });
  },
  "add-device": () => {
    // Simulate the "connect a device" pairing flow with a confirm modal.
    closePanels({ silent: true });
    showSimModal({
      title: "Connect a device",
      body:
        "Open Firefox on another device and scan the pairing code to finish connecting.",
      action: "Continue",
      onConfirm: () => {
        openPanel("account");
        setAccountState("connected-devices");
      },
    });
  },
  "create-profile": () => {
    // Variant A: simulate the "create a profile" flow. On confirm, flip to
    // many-profile mode so the Original Profile + Work rows surface in the
    // signed-out menu (without requiring sign-in).
    closePanels({ silent: true });
    showSimModal({
      title: "Add a profile",
      body:
        "Profiles keep your browsing separate — each has its own history, tabs, bookmarks, and settings.",
      action: "Create profile",
      onConfirm: () => {
        document.body.dataset.profilesMode = "many";
        openPanel("account");
      },
    });
  },
  "secure-sync": () => {
    // Variant A: copy depends on whether sync is already on.
    // - Signed-out: "Sign in to sync" CTA → confirm transitions to signed-in.
    // - Signed-in / connected-devices: "Manage Sync" copy — informational,
    //   no state change.
    closePanels({ silent: true });
    const syncOn = state.accountState !== "signed-out";
    showSimModal({
      title: syncOn ? "Manage Sync" : "Sign in to sync",
      body: syncOn
        ? "Manage what you’re syncing across all your signed-in devices — bookmarks, history, open tabs, passwords, and more."
        : "Sync keeps your bookmarks, history, open tabs, and passwords up to date across your devices.",
      action: syncOn ? "Open Sync settings" : "Turn on sync",
      onConfirm: () => {
        openPanel("account");
        if (state.accountState === "signed-out") {
          setAccountState("signed-in");
        }
      },
    });
  },
  "open-device": (target) => {
    if (subPanelTrigger === target && !subPanel.hidden) {
      setAccountState("connected-devices");
      return;
    }
    state.accountState = "devices-added";
    accountPanel.dataset.activeState = effectiveMainState("devices-added");
    showSubPanel(target, "device-detail");
  },
  "open-profiles": (target) => {
    // Variant B "Add a Profile" (single mode) → show a confirmation modal
    // that simulates an out-of-menu "create profile" flow. On confirm, flip
    // to many-profile mode and open the Profiles flyout.
    if (isVariantB() && document.body.dataset.profilesMode !== "many") {
      closePanels({ silent: true });
      showSimModal({
        title: "Add a profile",
        body:
          "Profiles keep your browsing separate — each has its own history, tabs, bookmarks, and settings.",
        action: "Create profile",
        onConfirm: () => {
          document.body.dataset.profilesMode = "many";
          openPanel("account");
          // Sub-panel only opens on explicit click — user clicks Profiles › themselves.
        },
      });
      return;
    }
    if (subPanelTrigger === target && !subPanel.hidden) {
      hideSubPanel();
      return;
    }
    // If a different flyout (e.g. device-detail) was open, reset main state.
    if (state.accountState === "devices-added") {
      state.accountState = "connected-devices";
      accountPanel.dataset.activeState = "connected-devices";
    }
    showSubPanel(target, "profiles");
  },
  "open-devices-list": (target) => {
    if (subPanelTrigger === target && !subPanel.hidden) {
      hideSubPanel();
      return;
    }
    if (state.accountState === "devices-added") {
      state.accountState = "connected-devices";
      accountPanel.dataset.activeState = "connected-devices";
    }
    showSubPanel(target, "devices-list");
  },
  "back-to-devices": () => {
    setAccountState("connected-devices");
  },
  "open-account": () => {
    closePanels({ silent: true });
    openPanel("account");
  },
};

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    const action = actionTarget.dataset.action;
    const handler = ACTIONS[action];
    if (handler) {
      event.preventDefault();
      event.stopPropagation();
      handler(actionTarget);
      return;
    }
  }

  const insideMain = event.target.closest("#account-panel");
  const insideSub = event.target.closest("#sub-panel");
  const insidePanel =
    insideMain ||
    insideSub ||
    event.target.closest("#app-menu-panel") ||
    event.target.closest("#account-button") ||
    event.target.closest("#hamburger-button") ||
    event.target.closest("#dev-switcher") ||
    event.target.closest("#sim-modal");

  if (!insidePanel && state.openMenu !== "none") {
    closePanels();
    return;
  }

  // Click inside the main panel (but not inside the sub-panel and not on the
  // active trigger row) closes the flyout — like native cascading menus.
  if (insideMain && !insideSub && !subPanel.hidden) {
    if (state.accountState === "devices-added") {
      setAccountState("connected-devices");
    } else {
      hideSubPanel();
    }
  }
});

scrim.addEventListener("click", () => closePanels());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.openMenu !== "none") {
    closePanels();
    (state.openMenu === "account" ? accountButton : hamburgerButton).focus();
  }
});

window.addEventListener("resize", () => {
  if (state.openMenu === "account") {
    positionPanel(accountPanel, accountButton);
    positionSubPanel();
  } else if (state.openMenu === "hamburger") {
    positionPanel(appMenuPanel, hamburgerButton);
  }
});

window.addEventListener("hashchange", () => {
  const fromHash = readStateFromHash();
  if (fromHash) setAccountState(fromHash);
});

/* ----------------------------------------------------------------
   Dev switcher (A/B variant)
   - Visible by default. Click × to hide for the current page load only
     (refresh always restores it — no persistent hidden state).
   - Pass ?dev=0 to force-hide for moderated test sessions.
   - The active variant is mirrored to the URL as ?variant=a|b so the
     URL becomes a shareable link to whichever variant is showing.
   ---------------------------------------------------------------- */
const devSwitcher = document.getElementById("dev-switcher");
const devSwitcherHide = document.getElementById("dev-switcher-hide");
const devButtons = devSwitcher.querySelectorAll(".dev-switcher__btn");

const VALID_VARIANTS = new Set(["a", "b", "c"]);

function getVariantFromURL() {
  const v = new URLSearchParams(window.location.search).get("variant");
  return VALID_VARIANTS.has(v) ? v : "a";
}

function setVariant(v, { updateURL = true } = {}) {
  const variant = VALID_VARIANTS.has(v) ? v : "a";
  document.body.dataset.variant = variant;
  accountPanel.dataset.variant = variant;
  appMenuPanel.dataset.variant = variant;
  subPanel.dataset.variant = variant;
  for (const btn of devButtons) {
    btn.classList.toggle("is-active", btn.dataset.variant === variant);
    btn.setAttribute("aria-pressed", String(btn.dataset.variant === variant));
  }
  if (updateURL) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
  }
}

setVariant(getVariantFromURL(), { updateURL: true });

/* Variant B profile count — "single" (default) or "many". Controls the
   Profiles row's label, chevron, and whether the flyout opens. */
function getProfilesModeFromURL() {
  const m = new URLSearchParams(window.location.search).get("profiles");
  return m === "many" ? "many" : "single";
}
document.body.dataset.profilesMode = getProfilesModeFromURL();
window.addEventListener("popstate", () => {
  document.body.dataset.profilesMode = getProfilesModeFromURL();
});


const devParam = new URLSearchParams(window.location.search).get("dev");
devSwitcher.hidden = devParam === "0";

// Auto-open the account menu if the URL says so (e.g. ?account=open in
// research-test links so participants land directly on the menu).
const accountParam = new URLSearchParams(window.location.search).get("account");
if (accountParam === "open") {
  openPanel("account");
}

for (const btn of devButtons) {
  btn.addEventListener("click", () => setVariant(btn.dataset.variant));
}
devSwitcherHide.addEventListener("click", () => {
  devSwitcher.hidden = true;
});

window.addEventListener("popstate", () => setVariant(getVariantFromURL(), { updateURL: false }));
