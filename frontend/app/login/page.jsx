"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Login is always editorial-styled — a single, memorable first impression
// that sets the tone before the dashboard's design preference even applies.
// The data-force-editorial attribute on <main> opts this page into the
// editorial token system regardless of the user's saved design choice.

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);

  // After a successful login the server has set the cookie. We push to the
  // requested `next` — router.push triggers a fresh middleware check, which
  // now sees the cookie and lets the user through.
  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Unable to sign in.");
        setSubmitting(false);
        return;
      }
      router.replace(next);
    } catch (err) {
      setError(String((err && err.message) || err));
      setSubmitting(false);
    }
  };

  return (
    <main
      data-force-editorial="true"
      className="min-h-screen relative overflow-hidden"
      style={{
        background: "var(--ed-paper)",
        backgroundImage: "var(--ed-grain)",
        backgroundBlendMode: "multiply",
      }}
    >
      {/* Tall decorative dateline rule running down the left edge on desktop.
          On mobile this collapses to a thin top rule above the masthead so
          the vertical type doesn't fight the small viewport. */}
      <div className="hidden md:flex absolute left-8 top-8 bottom-8 flex-col items-start gap-6 ed-set">
        <div className="ed-caption">VOL. I · ED. 06 · MAY 2026</div>
        <div className="w-px flex-1 bg-[var(--ed-rule)] opacity-50" />
        <div className="ed-caption rotate-180" style={{ writingMode: "vertical-rl" }}>
          INTERNAL · NOT FOR REDISTRIBUTION
        </div>
      </div>

      <div className="mx-auto max-w-[820px] px-6 md:px-16 py-12 md:py-20">
        {/* Masthead. Mobile-first: stacked, generous vertical rhythm. */}
        <header className="ed-set">
          <p className="ed-caption mb-2">A FINANCIAL WEEKLY · INTERNAL EDITION</p>
          <h1 className="ed-masthead text-[clamp(56px,14vw,128px)]">
            Grip<br/>Weekly.
          </h1>
          <hr className="ed-rule-double mt-4 md:mt-6" />
          <p className="ed-dateline mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>VOL. I</span><span>·</span>
            <span>NO. 06</span><span>·</span>
            <span>MAY 11, 2026</span><span>·</span>
            <span>NEW DELHI</span>
          </p>
        </header>

        {/* Editor's note — gives the login a reason to exist on this page. */}
        <section className="mt-12 md:mt-16 grid gap-10 md:grid-cols-[1.5fr_1fr] ed-set ed-set-delay-1">
          <div>
            <p className="ed-overline mb-4">FROM THE EDITOR</p>
            <h2 className="ed-headline text-[clamp(28px,5vw,44px)] mb-5">
              Six weeks of search,<br/>
              <em style={{ fontFamily: "var(--ed-display)", fontVariationSettings: "'opsz' 96, 'SOFT' 80, 'WONK' 1" }}>
                read against the lift.
              </em>
            </h2>
            <p className="ed-lede ed-dropcap" style={{ maxWidth: "44ch" }}>
              Each issue gathers the live data behind Grip's asset-search feature into a single readable
              account. Adoption, abandonment, the issuers that rise and fall — the same numbers your
              dashboards would render, set instead like a weekly broadside.
            </p>
            <p className="ed-byline mt-6">
              The page you are signing into is private; the editor's masthead is for ceremony.
            </p>
          </div>

          {/* Sign-in panel. Bottom-ruled inputs, no card. The decorative
              page-number sits to the right like a folio mark. */}
          <form onSubmit={submit} className="relative">
            <div className="absolute -top-4 right-0 ed-section-no">PAGE 06</div>
            <p className="ed-overline mb-6">SIGN IN TO READ</p>

            <label className="block mb-7">
              <span className="ed-caption block mb-2">USERNAME</span>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your reader id"
                className="ed-input"
                required
              />
            </label>

            <label className="block mb-7">
              <span className="ed-caption block mb-2">PASSWORD</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="ed-input"
                required
              />
            </label>

            {error && (
              <p
                role="alert"
                className="mb-5 text-[13px] italic"
                style={{ fontFamily: "var(--ed-body)", color: "var(--ed-rust)" }}
              >
                {error}
              </p>
            )}

            <button type="submit" className="ed-btn w-full mt-2" disabled={submitting}>
              {submitting ? "Verifying…" : "Open the issue ↗"}
            </button>

            <p className="ed-byline mt-6 leading-relaxed">
              Demo credentials are pre-circulated. If you don't have them, this isn't your issue.
            </p>
          </form>
        </section>

        {/* Footer rule + colophon — the kind of small line a print issue sets
            in the gutter. Adds finish without bloat. */}
        <footer className="mt-20 md:mt-28 ed-set ed-set-delay-2">
          <hr className="ed-rule" />
          <p className="ed-byline mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Set in <strong style={{ fontStyle: "normal", fontWeight: 500 }}>Fraunces</strong>,
              <strong style={{ fontStyle: "normal", fontWeight: 500 }}> Newsreader</strong>, and
              <strong style={{ fontStyle: "normal", fontWeight: 500 }}> IBM Plex Mono</strong>.</span>
            <span>·</span>
            <span>Printed on screen at 144dpi.</span>
            <span>·</span>
            <span>© Grip Invest 2026</span>
          </p>
        </footer>
      </div>
    </main>
  );
}
