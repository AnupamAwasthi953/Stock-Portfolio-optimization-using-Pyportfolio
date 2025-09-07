import io
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import base64

from flask import Flask, render_template, request, redirect, url_for, send_file, flash
from scipy.optimize import minimize

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.secret_key = "portfolio_secret_key"
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# Custom Jinja2 filter to handle base64 encoding
def b64encode_filter(s):
    return base64.b64encode(s).decode('utf-8')
app.jinja_env.filters['b64encode'] = b64encode_filter

# ---------- Core functions (no changes) ----------

def to_returns(df: pd.DataFrame, assume_prices: bool) -> pd.DataFrame:
    df = df.copy()
    if assume_prices:
        df = df.set_index(df.columns[0])
        df.index = pd.to_datetime(df.index, errors="coerce")
        df = df.sort_index()
        rets = df.pct_change().dropna(how="all")
    else:
        if df.columns[0].lower() in {"date","time","timestamp"}:
            df = df.set_index(df.columns[0])
        rets = df.copy()
        rets = rets.apply(pd.to_numeric, errors="coerce").dropna(how="all")
    rets = rets.loc[:, rets.std(numeric_only=True) > 0]
    return rets

def annualize_returns(rets: pd.DataFrame, periods_per_year: int):
    mu = rets.mean() * periods_per_year
    Sigma = rets.cov() * periods_per_year
    return mu, Sigma

def portfolio_perf(weights, mu, Sigma, rf=0.0):
    ret = float(weights @ mu)
    vol = float(np.sqrt(weights @ Sigma @ weights))
    sharpe = (ret - rf) / vol if vol > 0 else np.nan
    return ret, vol, sharpe

def solve_min_var(Sigma, mu=None, target_return=None, rf=0.0, allow_short=False):
    n = Sigma.shape[0]
    bounds = None if allow_short else [(0.0, 1.0)] * n

    def obj(w):
        return float(w @ Sigma @ w)

    cons = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    if target_return is not None:
        cons.append({"type": "eq", "fun": lambda w, mu=mu: float(w @ mu) - target_return})

    x0 = np.ones(n) / n
    res = minimize(obj, x0=x0, method="SLSQP", bounds=bounds, constraints=cons)
    if not res.success:
        raise RuntimeError(res.message)
    return res.x

def solve_max_sharpe(mu, Sigma, rf=0.0, allow_short=False):
    n = Sigma.shape[0]
    bounds = None if allow_short else [(0.0, 1.0)] * n

    def neg_sharpe(w):
        r, v, s = portfolio_perf(w, mu, Sigma, rf)
        return -s

    cons = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    x0 = np.ones(n) / n
    res = minimize(neg_sharpe, x0=x0, method="SLSQP", bounds=bounds, constraints=cons)
    if not res.success:
        raise RuntimeError(res.message)
    return res.x

def efficient_frontier(mu, Sigma, allow_short, points=50):
    r_min, r_max = float(np.min(mu)), float(np.max(mu))
    targets = np.linspace(r_min, r_max, points)
    vols, rets = [], []
    for t in targets:
        try:
            w = solve_min_var(Sigma, mu=mu, target_return=t, allow_short=allow_short)
            r, v, _ = portfolio_perf(w, mu, Sigma)
            rets.append(r); vols.append(v)
        except Exception:
            rets.append(np.nan); vols.append(np.nan)
    return targets, vols, rets

# ---------- Flask routes (corrected) ----------

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        file = request.files.get("file")
        data_kind = request.form.get("data_kind")
        freq = request.form.get("freq")
        rf = float(request.form.get("rf"))
        allow_short = request.form.get("allow_short") == "on"
        objective = request.form.get("objective")
        target_ret = request.form.get("target_ret")

        if not file:
            flash("Please upload a CSV file")
            return redirect(url_for("index"))

        filepath = os.path.join(app.config["UPLOAD_FOLDER"], file.filename)
        file.save(filepath)

        try:
            df = pd.read_csv(filepath)
            assume_prices = (data_kind == "prices")
            rets = to_returns(df, assume_prices=assume_prices)
            if rets.shape[1] < 2:
                flash("Need at least 2 assets.")
                return redirect(url_for("index"))
        except Exception as e:
            flash(f"Error reading CSV: {e}")
            return redirect(url_for("index"))

        freq_map = {"daily": 252, "weekly": 52, "monthly": 12}
        mu, Sigma = annualize_returns(rets, freq_map[freq])

        mu_vec, Sigma_mat = mu.values, Sigma.values
        tickers = list(mu.index)

        try:
            if objective == "sharpe":
                w = solve_max_sharpe(mu_vec, Sigma_mat, rf=rf, allow_short=allow_short)
            elif objective == "variance":
                w = solve_min_var(Sigma_mat, allow_short=allow_short)
            else:
                if not target_ret:
                    flash("Provide target return")
                    return redirect(url_for("index"))
                w = solve_min_var(Sigma_mat, mu=mu_vec, target_return=float(target_ret), allow_short=allow_short)
        except Exception as e:
            flash(f"Optimization failed: {e}")
            return redirect(url_for("index"))

        ret, vol, sharpe = portfolio_perf(w, mu_vec, Sigma_mat, rf=rf)
        weights_df = pd.DataFrame({"Asset": tickers, "Weight": w}).sort_values("Weight", ascending=False)

        # Efficient frontier plot
        targets, vols, rets_line = efficient_frontier(mu_vec, Sigma_mat, allow_short, points=80)
        fig1 = plt.figure(figsize=(6,4))
        plt.plot(vols, rets_line, label="Frontier")
        plt.scatter([vol], [ret], c="red", label="Portfolio")
        plt.xlabel("Volatility")
        plt.ylabel("Return")
        plt.legend()
        buf1 = io.BytesIO()
        fig1.savefig(buf1, format="png", dpi=120)
        buf1.seek(0)
        fig1_b64 = buf1.getvalue()

        # Weights bar chart
        fig2 = plt.figure(figsize=(6,4))
        plt.bar(weights_df["Asset"], weights_df["Weight"])
        plt.xticks(rotation=45)
        plt.ylabel("Weight")
        buf2 = io.BytesIO()
        fig2.savefig(buf2, format="png", dpi=120)
        buf2.seek(0)
        fig2_b64 = buf2.getvalue()

        # Save weights file
        weights_csv = os.path.join(app.config["UPLOAD_FOLDER"], "weights.csv")
        weights_df.to_csv(weights_csv, index=False)

        # Corrected: Pass the raw byte data to the template
        return render_template("result.html",
                               summary=f"Return: {ret:.2%}, Vol: {vol:.2%}, Sharpe: {sharpe:.3f}",
                               chart1=fig1_b64,
                               chart2=fig2_b64,
                               download_url=url_for("download_weights"))
    return render_template("index.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/download")
def download_weights():
    path = os.path.join(app.config["UPLOAD_FOLDER"], "weights.csv")
    return send_file(path, as_attachment=True)

if __name__ == "__main__":
    app.run(debug=True)