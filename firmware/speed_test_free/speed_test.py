"""Breathing SPEED test: how fast a breath can the fans follow, and does a lead help?
Goes with speed_test_free.ino (every period run once with no lead and once with a 600 ms lead).

Log a run (sketch flashed, Serial Monitor closed; this starts the run and stops at DONE):
    python speed_test.py log COM5 speed_01.csv
Analyze one or more runs (pooled):
    python speed_test.py speed_01.csv [speed_02.csv ...]

No testo: the measurement is the tach rpm (20 rows/s). For each breath period and lead the
breaths are folded onto one cycle (the first breath of each block is dropped: fan spin-up).
Top row, flow: target vs the flow implied by the ACTIVE fan's measured rpm (inhale fan in the
inhale half, exhale fan in the exhale half), median over breaths and runs, one line per lead.
Bottom row, rpm: measured vs the steady-state rpm for the target at that moment.
Metrics per period, lead and half: peak reached (% of target peak), swing reached (% of the
target's min-to-max within the half), lag (s, best-fit shift of measured behind target), R2.
Outputs: speed_test.png, speed_test_summary.csv.
A half whose fan isn't connected (rpm stays ~0) is reported as "no data".
"""
import datetime, sys
import numpy as np, pandas as pd

Q_PEAK = np.pi * 25.0      # must match VE_LPM in the sketch
MAX_BINS = 60              # bins per folded breath (fewer for short breaths, see nbins)
LOG_HZ = 20                # rows per second from the sketch
NO_FAN_RPM = 500           # a fan whose max rpm in a block stays below this isn't connected
LEAD_COLORS = ["tab:green", "tab:red", "tab:blue", "tab:orange"]


def log_run(port, out):
    """Record one run: pc_time + the sketch's columns, until DONE."""
    import serial  # pyserial
    ser = serial.Serial(port, 115200, timeout=1)
    print("waiting for the ESP32 ..."); ser.reset_input_buffer()
    t0 = datetime.datetime.now()
    while (datetime.datetime.now() - t0).total_seconds() < 3:   # board may reset when the port opens
        line = ser.readline().decode(errors="ignore").strip()
        if line: print(line)
    ser.write(b"r")
    header, n = None, 0
    with open(out, "w", newline="") as f:
        while True:
            line = ser.readline().decode(errors="ignore").strip()
            if not line: continue
            if line == "DONE": break
            if line.startswith("#"): print(line); continue
            if line.startswith("t_ms,"):
                header = line.split(","); f.write("pc_time," + line + "\n"); continue
            if header and len(line.split(",")) == len(header):
                f.write(datetime.datetime.now().isoformat(timespec="milliseconds") + "," + line + "\n")
                n += 1
                if n % 20 == 0: print(line, end="\r")
    print(f"\nsaved {out} ({n} rows)")


def load(path, run):
    d = pd.read_csv(path)
    d["phase"] = d["phase"].astype(str).str.strip()
    d = d[d["block"] >= 0].copy()
    if "lead_ms" not in d: d["lead_ms"] = 0
    d["run"] = run
    d["t_s"] = d["t_ms"] / 1000.0
    d["since"] = d["t_s"] - d.groupby("block")["t_s"].transform("min")
    d["breath"] = np.floor(d["since"] / d["period_s"]).astype(int)
    d["x"] = (d["since"] % d["period_s"]) / d["period_s"]              # 0..1 through the breath
    inh = d["phase"] == "in"
    # the active fan for the TARGET half only: no flap, so the idle fan's air isn't part of it
    d["q_meas"] = np.where(inh, d["q_rpm_in"], -d["q_rpm_ex"])
    d["rpm_meas"] = np.where(inh, d["rpm_in"], d["rpm_ex"]).astype(float)
    # A fan that never spins in this run isn't connected (e.g. runs 1-5 inhale fan only, 6-10
    # exhale fan only): drop its half from THIS run, so pooling runs doesn't add its zeros.
    for ph, col in (("in", "rpm_in"), ("ex", "rpm_ex")):
        if not (d[col].max() > NO_FAN_RPM):
            d.loc[d["phase"] == ph, ["q_meas", "rpm_meas"]] = np.nan
            print(f"{path}: {'inhale' if ph == 'in' else 'exhale'} fan not connected in this run, its half skipped")
    return d


def best_lag(target, meas, period, fine=1000):
    """Shift (s) of measured behind target that minimises the squared error over the folded cycle.
    Both curves are resampled to `fine` points first (wrapping round the cycle), so the lag isn't
    limited to whole bins (a bin is period/60 = 0.33 s at 20 s)."""
    ok = ~np.isnan(meas) & ~np.isnan(target)
    if ok.sum() < 5: return np.nan
    n = len(target)
    xb = (np.arange(n) + .5) / n
    xf = (np.arange(fine) + .5) / fine
    tf = np.interp(xf, xb[ok], target[ok], period=1)
    mf = np.interp(xf, xb[ok], meas[ok], period=1)
    errs = [np.mean((np.roll(tf, k) - mf) ** 2) for k in range(fine // 2)]
    return int(np.argmin(errs)) * period / fine


def q25(s): return s.quantile(.25)
def q75(s): return s.quantile(.75)


def main(paths):
    d = pd.concat([load(p, i + 1) for i, p in enumerate(paths)], ignore_index=True)
    d = d[d["breath"] >= 1]                                              # drop spin-up breath
    periods = sorted(d["period_s"].unique(), reverse=True)
    leads = sorted(d["lead_ms"].unique())
    # at least ~2 log rows per bin per breath, so no bin of a short breath is empty
    nbins = {P: int(min(MAX_BINS, P * LOG_HZ / 2)) for P in periods}
    d["bin"] = np.minimum((d["x"] * d["period_s"].map(nbins)).astype(int), d["period_s"].map(nbins) - 1)

    rows, folded = [], {}
    for P in periods:
        x = (np.arange(nbins[P]) + .5) / nbins[P]
        for L in leads:
            g = d[(d["period_s"] == P) & (d["lead_ms"] == L)]
            if g.empty: continue
            agg = g.groupby("bin").agg(target=("q_target", "median"), med=("q_meas", "median"),
                                       q1=("q_meas", q25), q3=("q_meas", q75),
                                       rpm_exp=("rpm_exp", "median"), rpm=("rpm_meas", "median"),
                                       r1=("rpm_meas", q25), r3=("rpm_meas", q75)).reindex(range(nbins[P]))
            lag = best_lag(agg["target"].values, agg["med"].values, P)
            for half, sel, fan_col, ph in (("inhale", x < .5, "rpm_in", "in"), ("exhale", x >= .5, "rpm_ex", "ex")):
                if not (g.loc[g["phase"] == ph, fan_col].max() > NO_FAN_RPM):
                    agg.loc[sel, ["med", "q1", "q3", "rpm", "r1", "r3"]] = np.nan
                    rows.append(dict(period_s=P, lead_ms=L, half=half, status="no data (fan not connected?)"))
                    continue
                t, m = agg.loc[sel, "target"].values, agg.loc[sel, "med"].values
                sgn = 1 if half == "inhale" else -1
                ss = np.nansum((t - np.nanmean(t)) ** 2)
                rows.append(dict(period_s=P, lead_ms=L, half=half, status="ok",
                                 n_runs=g.loc[(g["phase"] == ph) & g["q_meas"].notna(), "run"].nunique(),
                                 n_breaths=g[(g["phase"] == ph) & g["q_meas"].notna()].groupby(["run", "block", "breath"]).ngroups,
                                 peak_pct=100 * np.nanmax(sgn * m) / Q_PEAK,
                                 swing_pct=100 * (np.nanmax(sgn * m) - np.nanmin(sgn * m)) / (np.nanmax(sgn * t) - np.nanmin(sgn * t)),
                                 lag_s=lag,
                                 r2=1 - np.nansum((m - t) ** 2) / ss if ss > 0 else np.nan,
                                 rpm_peak_pct=100 * np.nanmax(agg.loc[sel, "rpm"]) / np.nanmax(agg.loc[sel, "rpm_exp"])))
            folded[(P, L)] = (x * P, agg)

    summ = pd.DataFrame(rows)
    summ.round(3).to_csv("speed_test_summary.csv", index=False)
    print(f"{len(paths)} run(s), peak target {Q_PEAK:.1f} L/min; first breath of each block dropped\n")
    with pd.option_context("display.width", 160):
        print(summ.round(2).to_string(index=False))
    print("\npeak_pct: measured peak / target peak.  swing_pct: measured min-to-max / target min-to-max in that half.\n"
          "lag_s: shift of measured behind target (whole cycle).  rpm_peak_pct: measured / expected rpm peak.")
    plot(periods, leads, folded, len(paths))


def plot(periods, leads, folded, n_runs):
    import matplotlib.pyplot as plt
    n = len(periods)
    fig, axs = plt.subplots(2, n, figsize=(3.4 * n + 1, 6.8), sharey="row", gridspec_kw=dict(height_ratios=[3, 2]))
    axs = np.asarray(axs).reshape(2, n)
    for i, P in enumerate(periods):
        ax, bx = axs[0, i], axs[1, i]
        key = next(((P, L) for L in leads if (P, L) in folded), None)
        if key is None: continue
        t, first = folded[key]
        ax.plot(t, first["target"], color="0.55", lw=5, alpha=.35, label="Target flow")
        bx.plot(t, first["rpm_exp"], color="0.55", lw=4, alpha=.4, label="Expected (steady state)")
        for j, L in enumerate(leads):
            if (P, L) not in folded: continue
            a, c = folded[(P, L)][1], LEAD_COLORS[j % len(LEAD_COLORS)]
            ax.fill_between(t, a["q1"], a["q3"], color=c, alpha=.18, lw=0)
            ax.plot(t, a["med"], color=c, lw=1.6, label=f"Measured, lead {L:g} ms")
            bx.fill_between(t, a["r1"], a["r3"], color=c, alpha=.18, lw=0)
            bx.plot(t, a["rpm"], color=c, lw=1.4, label=f"Measured, lead {L:g} ms")
        for z in (ax, bx):
            z.axvline(P / 2, color=".3", lw=.6, ls=":"); z.set_xlim(0, P); z.grid(alpha=.25)
        ax.axhline(0, color=".3", lw=.7)
        ax.set_title(f"{P:g} s breath ({60 / P:.0f} bpm)", fontsize=10)
        bx.set_xlabel("time in breath (s)")
    axs[0, 0].set_ylabel("flow from rpm (L/min)\ninhale +, exhale -")
    axs[1, 0].set_ylabel("active fan rpm")
    axs[0, 0].legend(fontsize=8, loc="lower left"); axs[1, 0].legend(fontsize=7, loc="upper right")
    fig.suptitle(f"Speed test (free delivery): can the fans follow faster breaths, and does a lead help?  {n_runs} run(s)")
    fig.tight_layout()
    fig.savefig("speed_test.png", dpi=150)
    print("saved speed_test.png, speed_test_summary.csv")


if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(__doc__)
    if sys.argv[1] == "log":
        if len(sys.argv) != 4: sys.exit("usage: python speed_test.py log COM5 speed_01.csv")
        log_run(sys.argv[2], sys.argv[3])
    else:
        main(sys.argv[1:])
