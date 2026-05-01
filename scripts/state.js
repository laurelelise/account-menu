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
const sidebarPanel = document.getElementById("sidebar-panel");
const syncedTabsButton = document.querySelector('[data-action="toggle-synced-tabs"]');
const historyButton = document.querySelector('[data-action="toggle-history"]');

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
  // Early return on no-op so the hashchange listener can't trigger a
  // write→read→write loop once we mirror state to the URL below.
  if (next === state.accountState) return;
  state.accountState = next;
  accountPanel.dataset.activeState = effectiveMainState(next);
  document.body.dataset.signinState =
    next === "signed-out" ? "signed-out" : "signed-in";
  // Sub-panel is only opened by explicit clicks on a device row, never auto.
  if (next !== "devices-added") hideSubPanel();
  // The "Sync is off / Last sync 2w ago" copy is only shown when the user
  // explicitly turned sync off. Any transition out of signed-in-sync-off
  // resets the flag so a future sign-in lands on the fresh prompt.
  if (next !== "signed-in-sync-off") {
    delete document.body.dataset.syncHistory;
  }
  // Sync the devices-added body attribute (drives the chrome's synced-tabs
  // sidebar icon visibility). Auto-close the sidebar panel when leaving
  // connected-devices so participants never see a panel for a state they
  // are no longer in.
  syncDevicesAdded();
  // Mirror the visible state to the URL so research tooling can compare
  // the starting URL to the ending URL. Use replaceState to keep the back
  // button useful (no per-step history entries). Use the effective state so
  // the URL matches what the panel is rendering — never the internal
  // "devices-added" sub-panel display state.
  const url = new URL(window.location.href);
  url.hash = "state=" + effectiveMainState(next);
  window.history.replaceState(null, "", url);
}

/* Synced-tabs sidebar panel ---------------------------------------------- */
function syncDevicesAdded() {
  // Variants B and D both surface devices and connect to the chrome's
  // synced-tabs sidebar panel. Variant B shows devices only in the
  // connected-devices state; Variant D's signed-in section already lists
  // them, so signed-in counts too.
  const variant = accountPanel.dataset.variant;
  const here = state.accountState;
  const hasDevicesUI =
    (variant === "b" && effectiveMainState(here) === "connected-devices") ||
    (variant === "d" && (here === "signed-in" || here === "connected-devices"));
  if (hasDevicesUI) {
    document.body.dataset.devicesAdded = "true";
  } else {
    delete document.body.dataset.devicesAdded;
    closeSidebarPanel();
  }
}

function setSidebarToolActive(button, isActive) {
  if (!button) return;
  if (isActive) button.dataset.active = "true";
  else delete button.dataset.active;
}

function openSidebarPanel(mode = "synced-tabs") {
  document.body.dataset.sidebarPanel = mode;
  if (sidebarPanel) sidebarPanel.hidden = false;
  // Each sidebar tool only highlights when its own panel mode is showing.
  setSidebarToolActive(syncedTabsButton, mode === "synced-tabs");
  setSidebarToolActive(historyButton, mode === "history");
}

function closeSidebarPanel() {
  delete document.body.dataset.sidebarPanel;
  if (sidebarPanel) sidebarPanel.hidden = true;
  setSidebarToolActive(syncedTabsButton, false);
  setSidebarToolActive(historyButton, false);
}

function toggleSidebarPanelMode(mode) {
  if (document.body.dataset.sidebarPanel === mode) {
    closeSidebarPanel();
  } else {
    openSidebarPanel(mode);
  }
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
  // Only one menu at a time — dismiss any other top-level menu if open.
  if (typeof hideTabContextMenu === "function") hideTabContextMenu();
  if (typeof hideTabsMenu === "function") hideTabsMenu();
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
  if (which === "account" && accountPanel.dataset.variant === "d") {
    retriggerKitPop();
  }
}

/* Re-runs the "Kit pops in" animation on Variant D's signed-out promo
   each time the menu opens. Removes + re-adds the class with a forced
   reflow so the animation restarts. */
function retriggerKitPop() {
  const logo = accountPanel.querySelector(
    '[data-variant="d"][data-menu-state="signed-out"] .panel-promo__logo'
  );
  if (!logo) return;
  logo.classList.remove("is-popping");
  void logo.offsetWidth;
  logo.classList.add("is-popping");
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
const SYNC_STATUS_REVERT_MS = 12000;
const SYNC_STATUS_FADE_MS = 250;
const SYNC_STATUS_ROTATE_MS = 1300;
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
const simModalSecondary = document.getElementById("sim-modal-secondary");
const simModalCancel = document.getElementById("sim-modal-cancel");
const simModalClose = document.getElementById("sim-modal-close");
const simModalBackdrop = document.getElementById("sim-modal-backdrop");
let simModalOnConfirm = null;
let simModalOnSecondary = null;

function showSimModal({ title, body, action, onConfirm, secondary }) {
  simModalTitle.textContent = title;
  simModalBody.textContent = body;
  simModalConfirm.textContent = action;
  simModalOnConfirm = onConfirm;
  if (secondary) {
    simModalSecondary.textContent = secondary.label;
    simModalSecondary.hidden = false;
    simModalOnSecondary = secondary.onClick;
  } else {
    simModalSecondary.hidden = true;
    simModalOnSecondary = null;
  }
  simModal.hidden = false;
  simModalConfirm.focus();
}
function hideSimModal() {
  simModal.hidden = true;
  simModalOnConfirm = null;
  simModalOnSecondary = null;
  simModalSecondary.hidden = true;
}
simModalConfirm.addEventListener("click", () => {
  const fn = simModalOnConfirm;
  hideSimModal();
  if (fn) fn();
});
simModalSecondary.addEventListener("click", () => {
  const fn = simModalOnSecondary;
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
    // Both variants now treat plain Sign in as a sign-in-only step. Sync only
    // turns on when the user explicitly opts in via Secure Sync / Sync your
    // Data, or implicitly when they connect a phone.
    closePanels({ silent: true });
    showSimModal({
      title: "Sign in to Firefox",
      body:
        "You’ll be taken to accounts.firefox.com to sign in or create a Mozilla account.",
      action: "Sign in",
      onConfirm: () => {
        // Mark that the participant has been through sign-in at least once
        // so the next visit to the signed-out state shows Variant D's cache
        // sign-out treatment (avatar header) rather than the fresh promo.
        document.body.dataset.accountHistory = "seen-signin";
        openPanel("account");
        setAccountState("signed-in-sync-off");
      },
    });
  },
  "enable-sync": () => {
    // Variant B: simulate an out-of-menu Sync settings flow with a confirm.
    // From signed-out the modal frames it as a sign-in step; from
    // signed-in-sync-off it's a straight "turn on Sync" step.
    if (isVariantB()) {
      const isSignedOut = state.accountState === "signed-out";
      closePanels({ silent: true });
      showSimModal({
        title: isSignedOut ? "Sign in to sync" : "Turn on Sync",
        body:
          "Sync keeps your bookmarks, history, open tabs, and passwords up to date across your devices.",
        action: isSignedOut ? "Turn on sync" : "Turn on Sync",
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
    // Reachable only from variant B's signed-in / connected-devices "Sync is
    // On" row, so sync is always on here. The Turn off sync secondary lands
    // on signed-in-sync-off, which strips the connected-device representation
    // — today's behavior, where sync is the link between devices.
    closePanels({ silent: true });
    const here = state.accountState;
    const body = here === "connected-devices"
      ? "Choose what gets synced across your devices — bookmarks, history, passwords, open tabs, and more — and review recent sync activity. Turning off sync will disconnect your other devices."
      : "Choose what gets synced across your devices — bookmarks, history, passwords, open tabs, and more — and review recent sync activity.";
    showSimModal({
      title: "Sync settings",
      body,
      action: "Open Sync settings",
      onConfirm: () => {
        openPanel("account");
      },
      secondary: {
        label: "Turn off sync",
        onClick: () => {
          // Mark this as an explicit turn-off so the sync-off section
          // shows the "Sync is off / Last sync 2w ago" copy instead of
          // the fresh-sign-in prompt.
          document.body.dataset.syncHistory = "turned-off";
          openPanel("account");
          setAccountState("signed-in-sync-off");
        },
      },
    });
  },
  "manage-account": () => {
    closePanels({ silent: true });
    // Variant A only: surface a secondary "Sign out" so participants can
    // exit the signed-in flow without leaving the modal. Confirming returns
    // the menu to the signed-out state.
    const offerSignOut = !isVariantB();
    showSimModal({
      title: "Manage your Mozilla account",
      body:
        "You’ll be taken to accounts.firefox.com to update your sign-in info, password, and connected devices.",
      action: "Continue",
      onConfirm: () => {
        // Reopen the menu where the user left off — no state change.
        openPanel("account");
      },
      secondary: offerSignOut
        ? {
            label: "Sign out",
            onClick: () => {
              openPanel("account");
              setAccountState("signed-out");
            },
          }
        : undefined,
    });
  },
  "add-device": () => {
    // From signed-out we surface a sign-in intermediary first — a phone can't
    // pair without an account. Variant A's sign-in lands on signed-in (no
    // device yet); variant B's sign-in collapses sign-in + sync + pair into
    // one step and lands on connected-devices. Once already signed-in (any
    // sync state) both variants fall through to the existing pairing modal.
    closePanels({ silent: true });
    if (state.accountState === "signed-out") {
      if (isVariantB()) {
        showSimModal({
          title: "Sign in to connect a phone",
          body:
            "You’ll be taken to accounts.firefox.com to sign in or create a Mozilla account, then your phone can pair and sync with this device.",
          action: "Sign in",
          onConfirm: () => {
            openPanel("account");
            setAccountState("connected-devices");
          },
        });
        return;
      }
      showSimModal({
        title: "Sign in to connect and sync your phone",
        body:
          "You’ll be taken to accounts.firefox.com to sign in or create a Mozilla account, then your phone can pair with this device.",
        action: "Sign in",
        onConfirm: () => {
          openPanel("account");
          setAccountState("signed-in");
        },
      });
      return;
    }
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
        setProfilesMode("many");
        openPanel("account");
      },
    });
  },
  "secure-sync": () => {
    // Variant A: copy depends on the current state.
    // - Signed-out: "Sign in to sync" CTA → confirm transitions to signed-in
    //   (sync on).
    // - Signed-in-sync-off: "Turn on Sync" CTA → confirm transitions to
    //   signed-in (sync on).
    // - Signed-in / connected-devices: "Manage Sync" copy — informational,
    //   no state change.
    closePanels({ silent: true });
    const here = state.accountState;
    const syncOn = here === "signed-in" || here === "connected-devices";
    let title;
    let body;
    let action;
    if (syncOn) {
      title = "Manage Sync";
      body = here === "connected-devices"
        ? "Manage what you’re syncing across all your signed-in devices — bookmarks, history, open tabs, passwords, and more. Turning off sync will disconnect your other devices."
        : "Manage what you’re syncing across all your signed-in devices — bookmarks, history, open tabs, passwords, and more.";
      action = "Open Sync settings";
    } else if (here === "signed-in-sync-off") {
      title = "Turn on Sync";
      body =
        "Sync keeps your bookmarks, history, open tabs, and passwords up to date across your devices.";
      action = "Turn on sync";
    } else {
      title = "Sign in to sync";
      body =
        "Sync keeps your bookmarks, history, open tabs, and passwords up to date across your devices.";
      action = "Turn on sync";
    }
    showSimModal({
      title,
      body,
      action,
      onConfirm: () => {
        openPanel("account");
        if (!syncOn) {
          setAccountState("signed-in");
        }
      },
      secondary: syncOn
        ? {
            label: "Turn off sync",
            onClick: () => {
              openPanel("account");
              setAccountState("signed-in-sync-off");
            },
          }
        : undefined,
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
          setProfilesMode("many");
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
  /* Generic back/close button used inside flyouts that don't change the
     main panel's state — just hides the sub-panel. */
  "close-sub-panel": () => {
    hideSubPanel();
  },
  /* Variant D device row → opens the device-tabs flyout (Figma 21094:29052).
     Toggles like the other Variant D flyouts. Updates the title and the
     section's data-device so CSS shows the right tab list per device. */
  "open-device-tabs": (target) => {
    if (subPanelTrigger === target && !subPanel.hidden) {
      hideSubPanel();
      return;
    }
    const deviceName =
      target.querySelector(".menu-item__title")?.textContent?.trim() ?? "Device";
    const deviceId = target.dataset.device || "iphone";
    const section = subPanel.querySelector(
      '[data-variant="d"][data-sub-state="device-detail"]'
    );
    if (section) section.dataset.device = deviceId;
    const titleEl = subPanel.querySelector("[data-device-title]");
    if (titleEl) titleEl.textContent = deviceName;
    showSubPanel(target, "device-detail");
  },
  /* Variant D fresh signed-out: "Create a New Profile" row opens the
     new create-profile flyout (a sub-panel rather than the modal). */
  "open-create-profile": (target) => {
    if (subPanelTrigger === target && !subPanel.hidden) {
      hideSubPanel();
      return;
    }
    showSubPanel(target, "create-profile");
  },
  /* Confirm button inside the Variant D create-profile flyout —
     flips profiles-mode to many and closes the flyout. The account
     menu stays open. Profiles can exist independent of sign-in. */
  "confirm-create-profile": () => {
    setProfilesMode("many");
    hideSubPanel();
  },
  /* Variant B "Sync is On" row: opens a flyout with Sync now + Manage sync.
     Toggles like the other Variant B sub-panels. */
  "open-sync-actions": (target) => {
    if (subPanelTrigger === target && !subPanel.hidden) {
      hideSubPanel();
      return;
    }
    showSubPanel(target, "sync-actions");
  },
  /* Sync now: keep the main menu open and just close the sync-actions
     flyout. Re-trigger the sync icon spin + "Updated just now" subtitle
     so the participant gets visual feedback the sync ran. */
  "sync-now": () => {
    hideSubPanel();
    runSyncStatusCheck();
  },
  "open-account": () => {
    closePanels({ silent: true });
    openPanel("account");
  },
  /* Variant B's connected-devices flyout: clicking another device opens the
     synced-tabs panel; clicking the current device opens the history panel.
     Both close the account menu. */
  "open-synced-tabs": () => {
    closePanels();
    openSidebarPanel("synced-tabs");
  },
  "open-history": () => {
    closePanels();
    openSidebarPanel("history");
  },
  "toggle-synced-tabs": () => {
    toggleSidebarPanelMode("synced-tabs");
  },
  "toggle-history": () => {
    toggleSidebarPanelMode("history");
  },
  "close-sidebar-panel": () => {
    closeSidebarPanel();
  },
  "toggle-tabs-menu": (target) => {
    toggleTabsMenu(target);
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

/* Tab right-click context menu ------------------------------------------
   Right-click on any chrome tab opens a Firefox-style context menu at the
   cursor. Click outside / Escape / picking an item closes it. */
const tabContextMenu = document.getElementById("tab-context-menu");
const tabSendMobileMenu = document.getElementById("tab-send-mobile-menu");
const toastEl = document.getElementById("toast");
let toastTimer = 0;

document.addEventListener("contextmenu", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  event.preventDefault();
  showTabContextMenu(event.clientX, event.clientY);
});

/* Left-click on a tab also opens the context menu. Useful during user
   testing on a hosted prototype where right-click could conflict with
   the host browser's own context menu. */
document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  // Don't fire if the participant clicked the close X inside an active tab.
  if (event.target.closest(".tab__close")) return;
  event.preventDefault();
  event.stopPropagation();
  showTabContextMenu(event.clientX, event.clientY);
});

/* Show a brief toast (e.g. "Page sent to Sam's iPhone"). */
function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  // Restart the in-animation by removing/adding the node.
  toastEl.style.animation = "none";
  void toastEl.offsetWidth;
  toastEl.style.animation = "";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
    toastTimer = 0;
  }, 2200);
}

function showTabContextMenu(x, y) {
  if (!tabContextMenu) return;
  // Only one menu at a time — close any open account / hamburger panel.
  closePanels({ silent: true });
  state.openMenu = "none";
  hideTabSendMobileMenu();
  if (typeof hideTabsMenu === "function") hideTabsMenu();
  tabContextMenu.hidden = false;
  tabContextMenu.style.left = `${x}px`;
  tabContextMenu.style.top = `${y}px`;
  // Reflow then nudge inside the viewport if it overflows.
  const rect = tabContextMenu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const pad = 8;
  if (rect.right > vw - pad) {
    tabContextMenu.style.left = `${Math.max(pad, vw - rect.width - pad)}px`;
  }
  if (rect.bottom > vh - pad) {
    tabContextMenu.style.top = `${Math.max(pad, vh - rect.height - pad)}px`;
  }
}

function hideTabContextMenu() {
  if (tabContextMenu) tabContextMenu.hidden = true;
  hideTabSendMobileMenu();
}

/* Show the "Send to Mobile" submenu beside its trigger row. Auto-flips
   to the left if it would overflow the viewport on the right. */
function showTabSendMobileMenu(triggerEl) {
  if (!tabSendMobileMenu || !triggerEl) return;
  tabSendMobileMenu.hidden = false;
  // Align top of submenu with the trigger row.
  const triggerRect = triggerEl.getBoundingClientRect();
  const subRect = tabSendMobileMenu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = 4;
  const pad = 8;
  let left = triggerRect.right + gap;
  if (left + subRect.width > vw - pad) {
    left = triggerRect.left - subRect.width - gap;
    if (left < pad) left = pad;
  }
  let top = triggerRect.top - 8; // pull up slightly so first item lines up
  if (top + subRect.height > vh - pad) {
    top = Math.max(pad, vh - subRect.height - pad);
  }
  tabSendMobileMenu.style.left = `${left}px`;
  tabSendMobileMenu.style.top = `${top}px`;
}

function hideTabSendMobileMenu() {
  if (tabSendMobileMenu) tabSendMobileMenu.hidden = true;
}

document.addEventListener("click", (event) => {
  if (!tabContextMenu || tabContextMenu.hidden) return;
  // "Send to Mobile" trigger: open the submenu, keep parent menu open.
  const sendMobileTrigger = event.target.closest('[data-action="open-send-mobile"]');
  if (sendMobileTrigger) {
    event.preventDefault();
    event.stopPropagation();
    showTabSendMobileMenu(sendMobileTrigger);
    return;
  }
  // Click on a submenu item: fire a "Page sent to …" toast and close.
  const submenuItem = event.target.closest("#tab-send-mobile-menu .menu-item");
  if (submenuItem) {
    const deviceName = submenuItem.querySelector(".menu-item__title")?.textContent.trim();
    if (deviceName) showToast(`Page sent to ${deviceName}`);
    hideTabContextMenu();
    return;
  }
  // Click anywhere else outside the menus dismisses them. The tab-click
  // handler above runs first with stopPropagation, so clicking a tab
  // re-opens the menu rather than just dismissing.
  if (
    !event.target.closest("#tab-context-menu") &&
    !event.target.closest("#tab-send-mobile-menu")
  ) {
    hideTabContextMenu();
    return;
  }
  // Click on a regular context menu item: action taken, close.
  if (event.target.closest("#tab-context-menu .menu-item")) {
    hideTabContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tabContextMenu && !tabContextMenu.hidden) {
    hideTabContextMenu();
  }
});

window.addEventListener("scroll", hideTabContextMenu, { passive: true });

/* "List all tabs" menu — opened by the down-arrow in the tabstrip.
   Anchored below the trigger; behaves like the other panels for
   one-menu-at-a-time and click-outside dismiss. */
const tabsMenu = document.getElementById("tabs-menu");

function showTabsMenu(triggerEl) {
  if (!tabsMenu || !triggerEl) return;
  closePanels({ silent: true });
  state.openMenu = "none";
  hideTabContextMenu();
  tabsMenu.hidden = false;
  // Anchor below the trigger; align to its right edge.
  const triggerRect = triggerEl.getBoundingClientRect();
  const menuRect = tabsMenu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const pad = 8;
  let left = triggerRect.right - menuRect.width;
  if (left < pad) left = pad;
  if (left + menuRect.width > vw - pad) left = vw - menuRect.width - pad;
  let top = triggerRect.bottom + 4;
  if (top + menuRect.height > vh - pad) {
    top = Math.max(pad, vh - menuRect.height - pad);
  }
  tabsMenu.style.left = `${left}px`;
  tabsMenu.style.top = `${top}px`;
}

function hideTabsMenu() {
  if (tabsMenu) tabsMenu.hidden = true;
}

function toggleTabsMenu(triggerEl) {
  if (!tabsMenu) return;
  if (!tabsMenu.hidden) {
    hideTabsMenu();
  } else {
    showTabsMenu(triggerEl);
  }
}

document.addEventListener("click", (event) => {
  if (!tabsMenu || tabsMenu.hidden) return;
  // Toggle button is dispatched via the ACTIONS table — leave it alone.
  if (event.target.closest('[data-action="toggle-tabs-menu"]')) return;
  // Click on Search All Tabs (open-history) or a tab row — close the
  // menu after the action runs. The action handler runs in the dispatcher
  // above, then this listener fires and dismisses the menu.
  if (event.target.closest("#tabs-menu .menu-item")) {
    hideTabsMenu();
    return;
  }
  // Click anywhere else outside the menu closes it.
  if (!event.target.closest("#tabs-menu")) {
    hideTabsMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tabsMenu && !tabsMenu.hidden) {
    hideTabsMenu();
  }
});

window.addEventListener("scroll", hideTabsMenu, { passive: true });

window.addEventListener("resize", () => {
  if (state.openMenu === "account") {
    positionPanel(accountPanel, accountButton);
    positionSubPanel();
  } else if (state.openMenu === "hamburger") {
    positionPanel(appMenuPanel, hamburgerButton);
  }
});

// Keep an open menu glued to its trigger button as the page scrolls — the
// menu uses position:fixed and is placed once on open, so without this it
// would drift away from the avatar on short viewports. rAF-coalesced so we
// re-position at most once per frame.
let scrollRaf = 0;
window.addEventListener(
  "scroll",
  () => {
    if (state.openMenu === "none") return;
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (state.openMenu === "account") {
        positionPanel(accountPanel, accountButton);
        positionSubPanel();
      } else if (state.openMenu === "hamburger") {
        positionPanel(appMenuPanel, hamburgerButton);
      }
    });
  },
  { passive: true }
);

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

const VALID_VARIANTS = new Set(["a", "b", "c", "d"]);

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
  // The synced-tabs sidebar icon is variant-B-only, so any variant change
  // needs to re-evaluate whether it should be visible.
  syncDevicesAdded();
  // Variant C reuses Variant B's section markup but wants Profiles above
  // Sync. Reorder DOM directly — CSS `order` can't cleanly swap just two
  // siblings without numbering everything in between.
  applyProfilesAboveSync(variant === "c");
  if (updateURL) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
  }
}

function applyProfilesAboveSync(profilesFirst) {
  const sections = accountPanel.querySelectorAll(
    '.panel__slot[data-variant="b"][data-menu-state]'
  );
  sections.forEach((section) => {
    const sync = section.querySelector(
      '[data-action="open-sync-actions"], [data-action="enable-sync"]'
    );
    const profiles = section.querySelector(".menu-item--profiles");
    if (!sync || !profiles) return;
    const syncIdx = Array.prototype.indexOf.call(section.children, sync);
    const profilesIdx = Array.prototype.indexOf.call(section.children, profiles);
    if (profilesFirst && profilesIdx > syncIdx) {
      sync.before(profiles);
    } else if (!profilesFirst && syncIdx > profilesIdx) {
      profiles.before(sync);
    }
  });
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

/* Set profiles mode and mirror it to the URL (for start-vs-end URL
   comparison in research tooling). Only flips the body attribute when
   it actually changes. */
function setProfilesMode(mode) {
  const next = mode === "many" ? "many" : "single";
  if (document.body.dataset.profilesMode !== next) {
    document.body.dataset.profilesMode = next;
  }
  const url = new URL(window.location.href);
  if (next === "many") {
    url.searchParams.set("profiles", "many");
  } else {
    url.searchParams.delete("profiles");
  }
  window.history.replaceState(null, "", url);
}


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
