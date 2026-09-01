"""
train_unified_model.py
======================
Replaces the 12 month-specific ensemble models with a single unified
RandomForestRegressor trained on the full dataset.

Key change: adds cyclical month encoding (month_sin, month_cos) so the
model understands the circular nature of months (Dec → Jan continuity)
without needing 12 separate models.

Usage:
    cd Server/Ml-model
    python train_unified_model.py

Outputs:
    ensemble_model_unified.pkl    — unified regression model
    feature_columns_unified.pkl   — ordered list of feature column names

Also prints before/after MAE and RMSE comparison vs. the existing
fallback model (ensemble_model.pkl / feature_columns.pkl).
"""

import os
import sys
import math
import warnings
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, VotingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

warnings.filterwarnings("ignore")

DATASET_PATH = "Electricity_Appliance_Bill_Dataset.xlsx"
OUTPUT_MODEL  = "ensemble_model_unified.pkl"
OUTPUT_COLS   = "feature_columns_unified.pkl"

# ── Load dataset ────────────────────────────────────────────────────────────────
print("Loading dataset:", DATASET_PATH)
df = pd.read_excel(DATASET_PATH)
print(f"  Raw shape: {df.shape}")
print(f"  Columns: {list(df.columns)}")

# ── Identify the target column (current month units consumed) ────────────────────
# Dataset columns confirmed: 'Current Month Unit (kWh)' is the prediction target.
UNITS_COL = None
for candidate in ["Current Month Unit (kWh)", "Units_Consumed", "units_consumed",
                   "Current Month Units", "Units", "units", "Next_Month_Units",
                   "Units_Next", "target", "Target"]:
    if candidate in df.columns:
        UNITS_COL = candidate
        break

if UNITS_COL is None:
    num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    UNITS_COL = num_cols[-1]
    print(f"  WARNING: Could not identify target column by name. Using '{UNITS_COL}' as target.")
else:
    print(f"  Target column identified: '{UNITS_COL}'")

# ── Identify the Month column ────────────────────────────────────────────────────
MONTH_COL = None
for candidate in ["Month", "month", "Month_Num", "month_num", "MonthNum"]:
    if candidate in df.columns:
        MONTH_COL = candidate
        break

if MONTH_COL is None:
    print("  WARNING: No Month column found. Cyclical encoding will be skipped.")

# ── Drop rows with missing target ────────────────────────────────────────────────
df = df.dropna(subset=[UNITS_COL])
print(f"  After dropna on target: {df.shape}")

# ── Cyclical month encoding ──────────────────────────────────────────────────────
# This replaces 12 separate monthly models with a single model that understands
# the circular nature of months (December wraps around to January).
# month_sin and month_cos together encode the angular position of the month on a circle.
if MONTH_COL:
    MONTH_NAMES = ["january", "february", "march", "april", "may", "june",
                   "july", "august", "september", "october", "november", "december"]

    def to_month_int(val):
        """Convert month name string or integer to 1-12 integer."""
        if isinstance(val, (int, float)):
            return int(val)
        val_lower = str(val).strip().lower()
        for i, name in enumerate(MONTH_NAMES):
            if val_lower.startswith(name[:3]):
                return i + 1
        return 1  # fallback

    month_ints = df[MONTH_COL].apply(to_month_int)
    df["Month_Int"] = month_ints
    df["month_sin"] = month_ints.apply(lambda m: math.sin(2 * math.pi * m / 12))
    df["month_cos"] = month_ints.apply(lambda m: math.cos(2 * math.pi * m / 12))
    print(f"  Added cyclical features: month_sin, month_cos from '{MONTH_COL}'")

# ── One-hot encode categorical columns ──────────────────────────────────────────
cat_cols = df.select_dtypes(include=["object", "category"]).columns.tolist()
if cat_cols:
    print(f"  One-hot encoding categorical columns: {cat_cols}")
    df = pd.get_dummies(df, columns=cat_cols)

# ── Build feature matrix ─────────────────────────────────────────────────────────
# Exclude: target, raw month string (replaced by cyclical features),
# and any columns that would leak the target (bill amount for current month,
# monthly kWh which is also derived from units).
LEAKAGE_COLS = {
    UNITS_COL,
    "Current Bill Amount (Rs)",   # deterministic function of current units -> leakage
    "Monthly kWh",                # total appliance kWh estimation, also target-correlated
}
if MONTH_COL and "month_sin" in df.columns:
    LEAKAGE_COLS.add(MONTH_COL)   # replaced by cyclical month_sin / month_cos
    LEAKAGE_COLS.add("Month_Int") # also replaced

feature_cols = [c for c in df.select_dtypes(include=[np.number]).columns if c not in LEAKAGE_COLS]

print(f"  Feature columns ({len(feature_cols)}): {feature_cols}")

X = df[feature_cols].fillna(0)
y = df[UNITS_COL].fillna(0)

# ── Train / test split (80/20, same random seed for fair comparison) ─────────────
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
print(f"\n  Train size: {len(X_train)} | Test size: {len(X_test)}")

# ── Evaluate EXISTING baseline model (ensemble_model.pkl) ────────────────────────
print("\n── Evaluating existing baseline model (ensemble_model.pkl) ──")
baseline_mae = baseline_rmse = None
try:
    baseline_model = joblib.load("ensemble_model.pkl")
    baseline_cols  = joblib.load("feature_columns.pkl")
    # Align test features to the old model's column list
    X_test_old = X_test.reindex(columns=baseline_cols, fill_value=0)
    y_pred_old = baseline_model.predict(X_test_old)
    baseline_mae  = mean_absolute_error(y_test, y_pred_old)
    baseline_rmse = math.sqrt(mean_squared_error(y_test, y_pred_old))
    print(f"  Baseline MAE  = {baseline_mae:.2f} kWh")
    print(f"  Baseline RMSE = {baseline_rmse:.2f} kWh")
except Exception as e:
    print(f"  Could not evaluate baseline model: {e}")

# ── Train unified ensemble model ─────────────────────────────────────────────────
print("\n── Training unified ensemble model ──")
rf = RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_split=4,
                           random_state=42, n_jobs=-1)
gb = GradientBoostingRegressor(n_estimators=150, max_depth=5, learning_rate=0.05,
                                random_state=42)

unified_model = VotingRegressor(
    estimators=[("rf", rf), ("gb", gb)],
    weights=[0.6, 0.4],
    n_jobs=-1
)
unified_model.fit(X_train, y_train)
print("  Training complete.")

# ── Evaluate unified model ───────────────────────────────────────────────────────
y_pred_new = unified_model.predict(X_test)
new_mae  = mean_absolute_error(y_test, y_pred_new)
new_rmse = math.sqrt(mean_squared_error(y_test, y_pred_new))

print(f"\n── Accuracy Comparison (held-out 20% test split) ──")
print(f"  OLD (12 month-specific models, baseline month-1 fallback):")
if baseline_mae is not None:
    print(f"    MAE  = {baseline_mae:.2f} kWh")
    print(f"    RMSE = {baseline_rmse:.2f} kWh")
else:
    print("    (could not evaluate)")
print(f"  NEW (unified model, cyclical month encoding):")
print(f"    MAE  = {new_mae:.2f} kWh")
print(f"    RMSE = {new_rmse:.2f} kWh")
if baseline_mae is not None:
    delta_mae = baseline_mae - new_mae
    print(f"  Delta MAE: {'+' if delta_mae >= 0 else ''}{delta_mae:.2f} kWh ({'improved' if delta_mae >= 0 else 'regressed'})")

# ── Save unified model and feature columns ────────────────────────────────────────
print(f"\n── Saving unified model ──")
joblib.dump(unified_model, OUTPUT_MODEL)
joblib.dump(list(feature_cols), OUTPUT_COLS)
print(f"  Saved: {OUTPUT_MODEL}")
print(f"  Saved: {OUTPUT_COLS}")
print("\nDone. The 12 month-specific .pkl files are preserved on disk as backup.")
print("Update app.py to load ensemble_model_unified.pkl (see Item 3 changes).")
