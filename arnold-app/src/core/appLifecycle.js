// core/appLifecycle.js — coordinates the mobile "resume → reset to Start" behavior with
// flows that legitimately background the WebView.
//
// THE PROBLEM: on Android/Capacitor, opening a NATIVE file picker (or camera) backgrounds
// the WebView. When the user returns (file chosen or cancelled), the app fires a resume
// event (visibilitychange / pageshow / focus) — and Arnold's lifecycle hook resets the
// user to the Start tab on every resume. That bounced the user off the Cloud Sync screen
// mid-import, losing the file they'd just selected (the Cronometer manual-import bug).
//
// THE FIX: any code that is ABOUT to open a file picker calls suppressResumeReset(); the
// lifecycle hook checks isResumeSuppressed() and skips the reset for a short window, so
// the user stays exactly where they were. Time-boxed so it always self-clears.

let _suppressUntil = 0;

// Suppress the resume→reset-to-Start for the next `ms` (default 3 min — generous enough to
// cover browsing to a Downloads folder and back).
export function suppressResumeReset(ms = 180000) {
  _suppressUntil = Date.now() + ms;
}

export function isResumeSuppressed() {
  return Date.now() < _suppressUntil;
}

export function clearResumeSuppression() {
  _suppressUntil = 0;
}
