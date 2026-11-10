"""Slow breathing-waveform test: testo anemometer vs target flow, two fans, free delivery.
Goes with breath_test_free.ino.

1) LOG one run (start the testo recording first, then run this; it starts the run itself):
       python breath_test.py log COM5 esp_in_01.csv
   Writes pc_time + the sketch's columns, stops at DONE.

2) ANALYZE: give each set's runs as ESP/testo pairs. Probe on the inhale fan -> --inhale,
   probe on the exhale fan -> --exhale (either set may be left out):
       python breath_test.py analyze --inhale esp_in_01.csv testo_in_01.csv esp_in_02.csv testo_in_02.csv ...
                                     --exhale esp_ex_01.csv testo_ex_01.csv ...
   The plot spans the first --breaths breaths (default 3). Each half-breath gets 3 boxes, at 1/4,
   1/2 and 3/4 of the half (rising, peak, falling); each box is the spread over runs of the testo
   readings within +-window/2 of that moment, from the fan that blows in that half. If the fans
   follow the waveform, the boxes sit on the target wave drawn behind them (inhale +, exhale -).
   Outputs: breath_test_boxplot.png, breath_test_readings.csv (every aligned testo reading),
            breath_test_boxes.csv (one row per box).

Clock alignment (as compare_rpm_testo.py): the run starts with both fans off for >= 5 s; the first
rise in testo velocity is matched to the first ESP row where the probed fan's measured rpm rises.
Matching to the rpm (not the duty) keeps the fan's own lag behind duty visible in the result.
The laptop-vs-testo offset should be about the same every run; a run whose offset is more than
MAX_DEV_S from the median uses the median instead.
"""
import argparse, datetime, sys
import numpy as np, pandas as pd

D_MM = 12.0            # inner diameter (mm) of the OUTLET tube where the testo probe sits (blowing side)
V_ON = 0.5             # m/s: testo reads "flow on" above this
OFF_READINGS = 5       # need >= this many "off" readings (s) before the rise
ON_READINGS = 3        # ... and this many "on" readings after it
RPM_ON = 1000          # ESP side: fan counts as spinning above this rpm
MAX_DEV_S = 2.0        # max deviation of a run's clock offset from the median (s)


# ---------------------------------------------------------------- logging
def log_run(port, out):
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
                if n % 10 == 0: print(line, end="\r")
    print(f"\nsaved {out} ({n} rows)")


# ---------------------------------------------------------------- loading + alignment
def read_testo(path):
    rows = []
    for line in open(path, encoding="utf-8-sig", errors="ignore").read().splitlines()[1:]:
        p = line.split(",")
        try:
            t = datetime.datetime.strptime(p[0].strip(), "%d/%m/%y %I:%M:%S %p")
        except (ValueError, IndexError):
            break                                   # end of data ("Overall", "< Images >", ...)
        try: v = float(p[2])
        except ValueError: v = np.nan               # testo dropout ("-")
        rows.append((t, v))
    df = pd.DataFrame(rows, columns=["time", "v"])
    if df["v"].isna().any(): print(f"{path}: {int(df['v'].isna().sum())} testo readings missing, skipped")
    df = df.dropna().reset_index(drop=True)
    df["q_meas"] = df["v"] * np.pi * (D_MM / 1000) ** 2 / 4 * 60000      # m/s -> L/min
    return df


def testo_rise(df):
    """Time velocity crosses V_ON after >= OFF_READINGS off. Interpolated between the last off and
    first on reading: at 1 reading/s, taking the first on reading would bias every offset late
    by up to 1 s."""
    v = df["v"].values
    on = v > V_ON
    for i in range(OFF_READINGS, len(on) - ON_READINGS + 1):
        if on[i:i + ON_READINGS].all() and not on[i - OFF_READINGS:i].any():
            frac = (V_ON - v[i - 1]) / (v[i] - v[i - 1])
            dt = (df["time"].iloc[i] - df["time"].iloc[i - 1]).total_seconds()
            return df["time"].iloc[i - 1] + pd.Timedelta(seconds=frac * dt)
    return None


def load_pair(esp_path, testo_path, fan):
    esp = pd.read_csv(esp_path, parse_dates=["pc_time"])
    esp["phase"] = esp["phase"].astype(str).str.strip()
    testo = read_testo(testo_path)
    rpm = esp[f"rpm_{fan}"]
    spin = esp.loc[(esp["phase"] != "off") & (rpm > RPM_ON), "pc_time"]
    rise = testo_rise(testo)
    off = (rise - spin.iloc[0]).total_seconds() if (rise is not None and len(spin)) else np.nan
    breath0 = esp.loc[esp["phase"] != "off", "pc_time"].iloc[0]
    return dict(esp=esp, testo=testo, off=off, breath0=breath0, esp_path=esp_path)


# ---------------------------------------------------------------- analysis
def analyze(args):
    sets = [("in", args.inhale or []), ("ex", args.exhale or [])]
    for name, files in sets:
        if len(files) % 2: sys.exit(f"--{'inhale' if name == 'in' else 'exhale'}: give files in pairs (esp testo)")
    runs = [(fan, i // 2 + 1, load_pair(files[i], files[i + 1], fan))
            for fan, files in sets for i in range(0, len(files), 2)]
    if not runs: sys.exit("no runs given")

    good = [r["off"] for _, _, r in runs if not np.isnan(r["off"])]
    if not good: sys.exit("could not find the flow rise in any testo file")
    med = float(np.median(good))

    period = args.period
    readings, pred, n_plot = [], [], None
    for fan, k, r in runs:
        o = r["off"]
        if np.isnan(o) or abs(o - med) > MAX_DEV_S:
            print(f"{fan} run {k}: detected offset {o:+.1f} s looks wrong -> using median {med:+.1f} s"); o = med
        else:
            print(f"{fan} run {k}: clock offset {o:+.1f} s")
        n_breaths = int(np.round((r["esp"]["phase"] != "off").sum() * 0.1 / period))
        n_keep = min(n_breaths, args.breaths)
        t = r["testo"].copy(); t["time"] = t["time"] - pd.Timedelta(seconds=o)
        t["t_s"] = (t["time"] - r["breath0"]).dt.total_seconds()        # seconds since breath 1 starts
        t = t[(t["t_s"] >= 0) & (t["t_s"] < n_keep * period)]
        sign = 1 if fan == "in" else -1                      # inhale +, exhale -
        readings.append(pd.DataFrame(dict(fan=fan, run=k, t_s=t["t_s"], q_meas=sign * t["q_meas"])))
        e = r["esp"][r["esp"]["phase"] != "off"].copy()
        e["t_s"] = (e["pc_time"] - r["breath0"]).dt.total_seconds()
        e = e[e["t_s"] < n_keep * period]
        pred.append(pd.DataFrame(dict(t_s=e["t_s"], q_target=e["q_target"],
                                      q_rpm=e["q_rpm_in"] - e["q_rpm_ex"])))   # each fan's own sign
        n_plot = n_keep if n_plot is None else min(n_plot, n_keep)
    rd = pd.concat(readings, ignore_index=True)
    pr = pd.concat(pred, ignore_index=True)
    rd.round(3).to_csv("breath_test_readings.csv", index=False)

    # target + rpm prediction on a 0.1 s grid (median over runs)
    fine = pr.assign(f=(pr["t_s"] / 0.1).round().astype(int)).groupby("f")[["q_target", "q_rpm"]].median()
    tf = fine.index.values * 0.1
    target_at = lambda ts: np.interp(ts, tf, fine["q_target"].values)

    # boxes: 3 per half-breath, at 1/4, 1/2, 3/4 of the half (rising, peak, falling), each from the
    # readings within +-window/2 of that moment across all runs of the fan that blows in that half
    half = period / 2
    rows = []
    for fan, h in (("in", 0), ("ex", 1)):
        g = rd[rd["fan"] == fan]
        if g.empty: continue
        for b in range(n_plot):
            for j, frac in enumerate((.25, .5, .75)):
                c = b * period + h * half + frac * half
                sel = g[(g["t_s"] - c).abs() <= args.window_s / 2]
                x = sel["q_meas"]
                rows.append(dict(fan=fan, breath=b + 1, point=("rising", "peak", "falling")[j], t_center_s=c,
                                 mean_t_s=sel["t_s"].mean(), n=len(x), n_runs=sel["run"].nunique(),
                                 # target at the readings' own times, so timing jitter doesn't bias it
                                 target=target_at(sel["t_s"]).mean() if len(x) else np.nan,
                                 median=x.median(), q1=x.quantile(.25), q3=x.quantile(.75),
                                 mean=x.mean(), sd=x.std(), values=x.values))
    boxes = pd.DataFrame(rows)
    boxes.drop(columns="values").round(2).to_csv("breath_test_boxes.csv", index=False)

    print(f"\nD = {D_MM} mm, period {period:g} s, {n_plot} breaths, box window {args.window_s:g} s")
    for fan in ("in", "ex"):
        a = boxes[(boxes["fan"] == fan) & (boxes["n"] > 0)]
        if a.empty: continue
        err = a["median"] - a["target"]
        print(f"{'inhale' if fan == 'in' else 'exhale'} fan ({rd[rd.fan == fan].run.nunique()} runs): "
              f"median - target: mean {err.mean():+.1f}, RMSE {np.sqrt((err ** 2).mean()):.1f} L/min")
        for pt in ("rising", "peak", "falling"):
            q = a[a["point"] == pt]
            print(f"   {pt:8s} target {q['target'].mean():+6.1f}  measured median {q['median'].mean():+6.1f} L/min")

    plot(boxes, tf, fine, period, n_plot, rd, args)


def plot(boxes, tf, fine, period, n_plot, rd, args):
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(4.2 * n_plot + 2, 5.5))
    ax.plot(tf, fine["q_target"], color="0.55", lw=6, alpha=0.35, zorder=1, label="Target flow")
    ax.plot(tf, fine["q_rpm"], color="tab:green", lw=1.3, ls="--", zorder=3, label="Predicted from measured rpm")
    colors = {"in": "tab:orange", "ex": "tab:blue"}
    labels = {"in": "testo, inhale fan", "ex": "testo, exhale fan"}
    for fan in ("in", "ex"):
        g = boxes[(boxes["fan"] == fan) & (boxes["n"] > 0)]
        if g.empty: continue
        # each box sits at the mean time of its readings (the testo's 1 s sampling phase varies by run)
        bp = ax.boxplot(list(g["values"]), positions=g["mean_t_s"].values, widths=period * 0.06, patch_artist=True,
                        manage_ticks=False, showfliers=True, zorder=2,
                        flierprops=dict(marker=".", markersize=3, alpha=.5))
        for box in bp["boxes"]:
            box.set(facecolor=colors[fan], alpha=.6, edgecolor=colors[fan])
        for m in bp["medians"]:
            m.set(color="black", lw=1.2)
        ax.plot([], [], color=colors[fan], lw=8, alpha=.6, label=f"{labels[fan]} ({rd[rd.fan == fan].run.nunique()} runs)")
    ax.axhline(0, color="0.3", lw=.8)
    for b in range(n_plot + 1):
        ax.axvline(b * period, color="0.3", lw=.8)
        if b < n_plot:
            ax.axvline(b * period + period / 2, color="0.3", lw=.6, ls=":")
            ax.text(b * period + period / 2, 1.01, f"breath {b + 1}", ha="center", va="bottom", color="0.3",
                    transform=ax.get_xaxis_transform())
    ax.set_xlim(0, n_plot * period)
    ax.set_xlabel(f"time since the first breath (s)  -  slowed breath, period {period:g} s (inhale | exhale)")
    ax.set_ylabel("flow (L/min)   inhale +, exhale -")
    ax.set_title("Breathing waveform: testo vs target (free delivery)", pad=18)
    ax.legend(loc="lower left", fontsize=9)
    ax.grid(alpha=.25)
    fig.tight_layout()
    fig.savefig("breath_test_boxplot.png", dpi=160)
    print("saved breath_test_boxplot.png, breath_test_boxes.csv, breath_test_readings.csv")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    lg = sub.add_parser("log"); lg.add_argument("port"); lg.add_argument("out")
    an = sub.add_parser("analyze")
    an.add_argument("--inhale", nargs="+", metavar="CSV")
    an.add_argument("--exhale", nargs="+", metavar="CSV")
    an.add_argument("--period", type=float, default=20.0, help="breath period in the sketch (s)")
    an.add_argument("--breaths", type=int, default=3, help="breaths to plot (from the first)")
    an.add_argument("--window-s", type=float, default=1.0,
                    help="each box takes the readings within +-window/2 of its moment; 1 s = one testo reading per run")
    a = p.parse_args()
    if a.cmd == "log": log_run(a.port, a.out)
    else: analyze(a)


if __name__ == "__main__":
    main()
