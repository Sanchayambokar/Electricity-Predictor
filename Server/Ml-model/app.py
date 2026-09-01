from flask import Flask, request, jsonify
import pandas as pd
import joblib
import pytesseract
from PIL import Image, ImageEnhance
import io
import re
import os
import sys
import urllib.request
import urllib.parse
import json

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# Configure Tesseract path on Windows
tesseract_default_paths = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Users\{}\AppData\Local\Programs\Tesseract-OCR\tesseract.exe".format(os.getlogin()),
]
for path in tesseract_default_paths:
    if os.path.exists(path):
        pytesseract.pytesseract.tesseract_cmd = path
        break

# Configure custom tessdata prefix to support Marathi
tessdata_local = os.path.abspath(os.path.join(os.path.dirname(__file__), "tessdata"))
if os.path.exists(tessdata_local):
    os.environ["TESSDATA_PREFIX"] = tessdata_local

app = Flask(__name__)

history_models = {}
history_columns = {}

# ── Unified Model Loading (Item 3: single model with cyclical month encoding) ─────
# The 12 month-specific models (ensemble_model_2.pkl through ensemble_model_12.pkl)
# have been replaced by a single unified model trained on the full dataset with
# cyclical month features: month_sin = sin(2*pi*month/12), month_cos = cos(2*pi*month/12).
# The old .pkl files are preserved on disk as backup but are no longer loaded.
UNIFIED_MODEL_PATH = "ensemble_model_unified.pkl"
UNIFIED_COLS_PATH  = "feature_columns_unified.pkl"

if os.path.exists(UNIFIED_MODEL_PATH) and os.path.exists(UNIFIED_COLS_PATH):
    unified_model   = joblib.load(UNIFIED_MODEL_PATH)
    unified_columns = joblib.load(UNIFIED_COLS_PATH)
    print(f"Unified model loaded. Feature columns ({len(unified_columns)}): {unified_columns}")
    # Alias to existing variable names so both predict paths can fall through gracefully
    ensemble_model = unified_model
    columns        = unified_columns
    history_models[1] = unified_model
    history_columns[1] = unified_columns
else:
    # Fallback: load legacy month-1 model if unified model has not been trained yet
    print("WARNING: ensemble_model_unified.pkl not found. Falling back to legacy ensemble_model.pkl.")
    print("Run: python train_unified_model.py  to generate the unified model.")
    ensemble_model = joblib.load("ensemble_model.pkl")
    columns = joblib.load("feature_columns.pkl")
    print("Legacy model 1 loaded. Columns:", columns)
    history_models[1] = ensemble_model
    history_columns[1] = columns
    # Load month-specific models 2-12 as additional fallback
    for i in range(2, 13):
        model_path = f"ensemble_model_{i}.pkl"
        cols_path  = f"feature_columns_{i}.pkl"
        if os.path.exists(model_path) and os.path.exists(cols_path):
            history_models[i]  = joblib.load(model_path)
            history_columns[i] = joblib.load(cols_path)
            print(f"Legacy model {i} loaded. Columns count: {len(history_columns[i])}")



appliance_model = None
appliance_columns = None
if os.path.exists("appliance_model.pkl") and os.path.exists("appliance_columns.pkl"):
    appliance_model = joblib.load("appliance_model.pkl")
    appliance_columns = joblib.load("appliance_columns.pkl")
    print("Appliance model loaded. Columns count:", len(appliance_columns))

temp_map = {
    1: 24,
    2: 26,
    3: 30,
    4: 34,
    5: 36,
    6: 32,
    7: 29,
    8: 28,
    9: 28,
    10: 30,
    11: 27,
    12: 24
}

days_in_month = {
    1: 31,
    2: 28,
    3: 31,
    4: 30,
    5: 31,
    6: 30,
    7: 31,
    8: 31,
    9: 30,
    10: 31,
    11: 30,
    12: 31
}


tariffs = {
    "tata": [
        (100, 90, 4.43, 0.0, 2.76, 16.0),
        (300, 135, 9.64, 0.0, 2.76, 16.0),
        (500, 135, 12.83, 0.0, 2.76, 16.0),
        (float('inf'), 160, 14.33, 0.0, 2.76, 16.0)
    ],
    "msedcl": [
        (100, 130, 3.96, 0.15, 1.60, 16.0),
        (300, 130, 10.80, 0.25, 1.60, 16.0),
        (500, 130, 15.03, 0.35, 1.60, 16.0),
        (float('inf'), 130, 17.53, 0.40, 1.60, 16.0)
    ],
    "adani": [
        (100, 90, 2.65, 0.65, 2.28, 16.0),
        (300, 135, 5.85, 0.65, 2.28, 16.0),
        (500, 135, 7.10, 0.65, 2.28, 16.0),
        (float('inf'), 160, 8.35, 0.65, 2.28, 16.0)
    ],
    "torrent": [
        (100, 130, 4.28, 0.10, 1.47, 16.0),
        (300, 130, 11.10, 0.15, 1.47, 16.0),
        (500, 130, 15.38, 0.20, 1.47, 16.0),
        (float('inf'), 130, 17.68, 0.20, 1.47, 16.0)
    ],
    "best": [
        (100, 90, 2.10, 0.75, 1.87, 16.0),
        (300, 135, 5.50, 0.75, 1.87, 16.0),
        (500, 135, 10.18, 0.75, 1.87, 16.0),
        (float('inf'), 160, 11.55, 0.75, 1.87, 16.0)
    ]
}


def calculate_default_tariff(company_key, units):
    if units is None or units <= 0:
        return 0
    company_key = str(company_key).lower().strip()
    
    if company_key not in tariffs:
        return None
        
    slabs = tariffs[company_key]
    
    # 1. Determine Fixed Charge based on the highest slab reached
    fixed_charge = 0
    for limit, fixed, _, _, _, _ in slabs:
        fixed_charge = fixed
        if units <= limit:
            break
            
    # 2. Calculate cumulative energy charges
    energy_charge = 0
    remaining_units = units
    prev_limit = 0
    for limit, _, energy, fac, wheeling, _ in slabs:
        slab_units = min(remaining_units, limit - prev_limit)
        if slab_units <= 0:
            break
        rate = energy + fac + wheeling
        energy_charge += slab_units * rate
        remaining_units -= slab_units
        prev_limit = limit
        
    subtotal = fixed_charge + energy_charge
    duty = subtotal * 0.16
    return round(subtotal + duty)


def get_lat_lon(city_name):
    default_coords = (19.0760, 72.8777)  # Mumbai
    try:
        url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(city_name)}&count=1"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data.get("results"):
                res = data["results"][0]
                return float(res["latitude"]), float(res["longitude"])
    except Exception as e:
        print("Geocoding failed for:", city_name, e, flush=True)
    return default_coords


def get_monthly_avg_temp(city_name, month_num):
    lat, lon = get_lat_lon(city_name)
    
    # We query the average temperature for the same month in 2025 (representative historical year)
    year = 2025
    start_date = f"{year}-{month_num:02d}-01"
    
    # Determine end day of month
    if month_num in [4, 6, 9, 11]:
        end_day = 30
    elif month_num == 2:
        end_day = 28
    else:
        end_day = 31
    end_date = f"{year}-{month_num:02d}-{end_day}"
    
    try:
        url = f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date={start_date}&end_date={end_date}&daily=temperature_2m_mean&timezone=auto"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
            if "daily" in data and "temperature_2m_mean" in data["daily"]:
                temps = [t for t in data["daily"]["temperature_2m_mean"] if t is not None]
                if temps:
                    avg_temp = sum(temps) / len(temps)
                    print(f"Weather API Success: Resolved avg temp for {city_name} in month {month_num} as {avg_temp:.2f}°C", flush=True)
                    return round(avg_temp, 2)
    except Exception as e:
        print("Archive Weather API failed for:", city_name, e, flush=True)
    
    # Fallback to default monthly temp map if API fails
    print(f"Weather API Fallback: Using default temp for {city_name} in month {month_num} as {temp_map.get(month_num, 28)}°C", flush=True)
    return temp_map.get(month_num, 28)


def get_season(month):
    if month in [12, 1, 2]:
        return "Winter"
    elif month in [3, 4, 5]:
        return "Summer"
    elif month in [6, 7, 8, 9]:
        return "Monsoon"
    else:
        return "PostMonsoon"


def parse_tariff_value(val):
    if not val:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    # Remove currency symbol, percent sign, spaces, and everything after /
    val_clean = str(val).split('/')[0]
    val_clean = re.sub(r'[^\d\.]', '', val_clean)
    try:
        return float(val_clean)
    except ValueError:
        return 0.0


@app.route("/predict", methods=["POST"])
def predict():
    print("Flask /predict hit")

    data = request.json
    print("Received data:", ascii(data))

    month_raw = data.get("month")
    units = float(data.get("unit", 0))
    amount = float(data.get("amount", 0))

    if isinstance(month_raw, int):
        month = month_raw
    else:
        from datetime import datetime
        try:
            month = int(month_raw)
        except (ValueError, TypeError):
            try:
                month = datetime.strptime(str(month_raw), "%b %Y").month
            except ValueError:
                try:
                    month = datetime.strptime(str(month_raw), "%m %Y").month
                except ValueError:
                    month = datetime.now().month

    print(f"Parsed month: {month}")

    # Check prediction type
    prediction_type = data.get("prediction_type", "history")

    if prediction_type == "appliances":
        if appliance_model is None or appliance_columns is None:
            return jsonify({"error": "Appliance model or feature columns are not loaded."}), 500
        
        appliances_data = data.get("appliances", {})
        fan_hours = float(appliances_data.get("fan", 0)) * float(appliances_data.get("fan_qty", 1))
        fridge_hours = float(appliances_data.get("fridge", 0)) * float(appliances_data.get("fridge_qty", 1))
        ac_hours = float(appliances_data.get("ac", 0)) * float(appliances_data.get("ac_qty", 1))
        tv_hours = float(appliances_data.get("tv", 0)) * float(appliances_data.get("tv_qty", 1))
        monitor_hours = float(appliances_data.get("monitor", 0)) * float(appliances_data.get("monitor_qty", 1))
        wm_hours = float(appliances_data.get("wm", 0)) * float(appliances_data.get("wm_qty", 1))
        geyser_hours = float(appliances_data.get("geyser", 0)) * float(appliances_data.get("geyser_qty", 1))
        bulb_hours = float(appliances_data.get("bulb", 0)) * float(appliances_data.get("bulb_qty", 1))
        
        # extra category
        other_hours = float(appliances_data.get("other", 0)) * float(appliances_data.get("other_qty", 1))
        extra_units = 30.0 * (0.1 * other_hours)
        
        provider = data.get("provider", "none")
        
        provider_to_company = {
            "tata": "Tata Power",
            "adani": "Adani Electricity",
            "msedcl": "MSEDCL",
            "torrent": "Torrent Power",
            "best": "BEST",
            "none": "Tata Power"
        }
        
        company = provider_to_company.get(provider.lower(), "Tata Power")
            
        print(f"Appliance input details: month={month}, company={ascii(company)}")
        
        input_data = {
            "Ceiling Fan (Hrs/Day)": fan_hours,
            "Refrigerator (Hrs/Day)": fridge_hours,
            "Air Conditioner (Hrs/Day)": ac_hours,
            "Television LED (Hrs/Day)": tv_hours,
            "Desktop Computer (Hrs/Day)": monitor_hours,
            "Washing Machine (Hrs/Day)": wm_hours,
            "Geyser / Water Heater (Hrs/Day)": geyser_hours,
            "LED Bulb (Hrs/Day)": bulb_hours,
            "Month_Num": month,
            "Company Name": company
        }
        
        df_input = pd.DataFrame([input_data])
        df_encoded = pd.get_dummies(df_input, columns=["Company Name"])
        df_encoded = df_encoded.reindex(columns=appliance_columns, fill_value=0)
        
        print("Appliance Input DataFrame shape:", df_encoded.shape)
        
        predicted_raw = float(appliance_model.predict(df_encoded)[0])
        # Physical estimation to check if inputs are low-value out-of-distribution
        raw_kwh = (
            fan_hours * 75 +
            fridge_hours * 250 +
            ac_hours * 1500 +
            tv_hours * 100 +
            monitor_hours * 200 +
            wm_hours * 500 +
            geyser_hours * 2000 +
            bulb_hours * 12
        ) * 30 / 1000.0
        
        if raw_kwh < 53 and raw_kwh > 0:
            predictUnit = round(predicted_raw * (raw_kwh / 53.0) + extra_units)
        else:
            predictUnit = max(round(predicted_raw + extra_units), 0)  # Ensure non-negative
        
        # ── Deterministic Amount Calculation ────────────────────────────────────────
        # IMPORTANT: Amount is NEVER predicted by a machine-learning model.
        # Predicting amount separately would just be re-learning the tariff slab formula
        # that is already implemented deterministically in calculate_default_tariff().
        # The correct pipeline (for both appliance and history paths) is:
        #   1. Predict UNITS  (ML model output)
        #   2. Compute AMOUNT = calculate_default_tariff(provider, predictUnit)
        #      — or use user-supplied tariff rates if available.
        # This keeps amount consistent with official provider tariff rules at all times.
        # ──────────────────────────────────────────────────────────────────────────────
        # Calculate amount properly using tariff details if available
        fixed = parse_tariff_value(data.get("fixedCharge"))
        rate = parse_tariff_value(data.get("energyRate"))
        fac_rate = parse_tariff_value(data.get("fac"))
        wheeling_rate = parse_tariff_value(data.get("wheeling"))
        # If FAC is passed as a flat charge (larger than standard unit rates, e.g. > 1.50/KWh), fall back to standard 0.40/KWh
        if fac_rate > 1.5:
            fac_rate = 0.40
        
        duty_val = data.get("duty", "")
        # If duty is a currency amount (contains rupee/Rs or doesn't contain %), fall back to 16.0% default
        if isinstance(duty_val, str) and ("₹" in duty_val or "Rs" in duty_val or "%" not in duty_val):
            duty_pct = 16.0
        else:
            duty_pct = parse_tariff_value(duty_val)
            if duty_pct == 0:
                duty_pct = 16.0
        
        default_amount = calculate_default_tariff(provider, predictUnit)
        default_prev = calculate_default_tariff(provider, units) if units > 0 else None

        if default_amount is not None and default_amount > 0:
            if units > 0 and amount > 0 and default_prev and default_prev > 0:
                scaling_factor = amount / default_prev
                scaling_factor = max(0.60, min(3.00, scaling_factor))
                predictAmount = round(default_amount * scaling_factor)
            else:
                predictAmount = default_amount
        elif rate > 0:
            energy_charges = predictUnit * rate
            fac_charges = predictUnit * fac_rate
            wheeling_charges = predictUnit * wheeling_rate
            subtotal = fixed + energy_charges + fac_charges + wheeling_charges
            duty_charge = subtotal * (duty_pct / 100.0)
            tariff_pred = subtotal + duty_charge
            
            if units > 0 and amount > 0:
                energy_prev = units * rate
                fac_prev = units * fac_rate
                wheeling_prev = units * wheeling_rate
                subtotal_prev = fixed + energy_prev + fac_prev + wheeling_prev
                duty_prev = subtotal_prev * (duty_pct / 100.0)
                tariff_prev = subtotal_prev + duty_prev
                
                if tariff_prev > 0:
                    scaling_factor = amount / tariff_prev
                    scaling_factor = max(0.60, min(3.00, scaling_factor))
                    predictAmount = round(tariff_pred * scaling_factor)
                else:
                    predictAmount = round(tariff_pred)
            else:
                predictAmount = round(tariff_pred)
        else:
            if units > 0:
                predictAmount = round(amount * (predictUnit / units))
            else:
                predictAmount = round(amount)
            
        print(f"Appliance prediction: predictUnit={predictUnit}, predictAmount={predictAmount}")
        
        return jsonify({
            "predictUnit": predictUnit,
            "month": month_raw,
            "unit": units,
            "amount": amount,
            "predictAmount": predictAmount
        })

    else:
        provider = data.get("provider", "none")
        city = data.get("city")
        if not city or city == "—":
            provider_to_city = {
                "tata": "Mumbai",
                "adani": "Mumbai",
                "msedcl": "Mumbai",
                "torrent": "Thane",
                "best": "Mumbai",
                "none": "Mumbai"
            }
            city = provider_to_city.get(str(provider).lower(), "Mumbai")
        temp = get_monthly_avg_temp(city, month)
        season = get_season(month)

        # Check how many consecutive previous months' data are provided
        consecutive_lags = 1
        
        # Build features dict dynamically
        lags_data = {
            1: {"unit": units, "amount": amount}
        }
        
        for lag in range(2, 13):
            u_val = data.get(f"unit{lag}")
            a_val = data.get(f"amount{lag}")
            if u_val is not None and a_val is not None:
                try:
                    u_f = float(u_val)
                    a_f = float(a_val)
                    if u_f > 0 and (a_f / u_f) > 30.0:
                        a_f = a_f / 100.0
                    lags_data[lag] = {"unit": u_f, "amount": a_f}
                    if consecutive_lags == lag - 1:
                        consecutive_lags = lag
                except (ValueError, TypeError):
                    break
            else:
                break
        
        tariff_category = data.get("tariffCategory", "Residential")

        # Normalize Tariff Category
        valid_categories = ["Residential", "Commercial", "Industrial"]
        if tariff_category not in valid_categories:
            matched = False
            for t in valid_categories:
                if t.lower() == str(tariff_category).lower():
                    tariff_category = t
                    matched = True
                    break
            if not matched:
                tariff_category = "Residential"

        predicted_raw = None
        model_to_use = None
        cols_to_use = None
        
        if consecutive_lags in history_models:
            model_to_use = history_models[consecutive_lags]
            cols_to_use = history_columns[consecutive_lags]
            
        if model_to_use is not None and cols_to_use is not None:
            import math as _math
            print(f"{consecutive_lags}-month lag prediction model selected.")
            input_data = {
                "Month": month,
                # Cyclical month encoding for unified model.
                "month_sin": _math.sin(2 * _math.pi * month / 12),
                "month_cos": _math.cos(2 * _math.pi * month / 12),
                "Month_Int": month,
                "Temp": temp,
                "Billing_Days": days_in_month.get(month, 30),
                "Season_PostMonsoon": 1 if season == "PostMonsoon" else 0,
                "Season_Summer": 1 if season == "Summer" else 0,
                "Season_Winter": 1 if season == "Winter" else 0,
                "Tariff_Category_Commercial": 1 if tariff_category == "Commercial" else 0,
                "Tariff_Category_Industrial": 1 if tariff_category == "Industrial" else 0,
                "Tariff_Category_Residential": 1 if tariff_category == "Residential" else 0,
                "Previous Month Unit (kWh)": units,
                "Previous Bill Amount (Rs)": amount,
            }
            # Add all required lags (legacy column names for backward compatibility)
            for lag in range(1, consecutive_lags + 1):
                unit_col_name = "Units_30d" if lag == 1 else f"Units_{lag*30}d"
                amt_col_name = "Amount" if lag == 1 else f"Amount_{lag*30}d"
                input_data[unit_col_name] = lags_data[lag]["unit"]
                input_data[amt_col_name] = lags_data[lag]["amount"]
                
            df = pd.DataFrame([input_data])
            # reindex to the model's exact column list, filling missing columns with 0
            df = df.reindex(columns=cols_to_use, fill_value=0)
            print(f"{consecutive_lags}-month DataFrame:\n", df)
            predicted_raw = float(model_to_use.predict(df)[0])
        else:
            # Fallback to 1-month model
            print("1-month lag prediction model selected (fallback or default).")
            input_data = {
                "Units_30d": units,
                "Month": month,
                "Temp": temp,
                "Amount": amount,
                "Billing_Days": days_in_month.get(month, 30),
                "Season_PostMonsoon": 1 if season == "PostMonsoon" else 0,
                "Season_Summer": 1 if season == "Summer" else 0,
                "Season_Winter": 1 if season == "Winter" else 0,
                "Tariff_Category_Commercial": 1 if tariff_category == "Commercial" else 0,
                "Tariff_Category_Industrial": 1 if tariff_category == "Industrial" else 0,
                "Tariff_Category_Residential": 1 if tariff_category == "Residential" else 0
            }
            df = pd.DataFrame([input_data])
            df = df[columns]
            print("1-month DataFrame:\n", df)
            predicted_raw = float(ensemble_model.predict(df)[0])

        # Personalize and scale down predicted units if the user's historical consumption is extremely low (OOD)
        # We look at the average of all available lag units to represent their typical usage scale.
        lag_units_list = [lags_data[i]["unit"] for i in range(1, consecutive_lags + 1) if i in lags_data]
        avg_lag_units = sum(lag_units_list) / len(lag_units_list) if lag_units_list else units
        
        distribution_threshold = 100.0
        if avg_lag_units < distribution_threshold and avg_lag_units > 0:
            scale_ratio = avg_lag_units / distribution_threshold
            predictUnit = round(predicted_raw * scale_ratio)
            # Ensure it doesn't fall below a sensible minimum of 1
            predictUnit = max(1, predictUnit)
        else:
            predictUnit = max(round(predicted_raw), 0)  # Ensure non-negative unit prediction

        # ── Deterministic Amount Calculation ────────────────────────────────────────
        # IMPORTANT: Amount is NEVER predicted by a machine-learning model.
        # Predicting amount separately would just be re-learning the tariff slab formula
        # that is already implemented deterministically in calculate_default_tariff().
        # The correct pipeline (history path) is:
        #   1. Predict UNITS  (ensemble ML model output)
        #   2. Compute AMOUNT = calculate_default_tariff(provider, predictUnit)
        #      — or use user-supplied tariff rates if available.
        # This keeps amount consistent with official provider tariff rules at all times.
        # NOTE: The proportional fallback below (amount * predictUnit / units) is used
        # ONLY when the provider is unknown and no tariff data is available. It is
        # explicitly NOT an ML prediction — it is a linear scaling heuristic.
        # ──────────────────────────────────────────────────────────────────────────────
        # Calculate amount properly using tariff details if available
        fixed = parse_tariff_value(data.get("fixedCharge"))
        rate = parse_tariff_value(data.get("energyRate"))
        fac_rate = parse_tariff_value(data.get("fac"))
        wheeling_rate = parse_tariff_value(data.get("wheeling"))
        
        # If FAC is passed as flat total amount (> 3.0), convert to per-unit rate or default 0.40
        if fac_rate > 3.0:
            if units > 0 and (fac_rate / units) <= 3.0:
                fac_rate = fac_rate / units
            else:
                fac_rate = 0.40

        # If Wheeling is passed as flat total amount (> 4.0), convert to per-unit rate or default 1.60
        if wheeling_rate > 4.0:
            if units > 0 and (wheeling_rate / units) <= 4.0:
                wheeling_rate = wheeling_rate / units
            else:
                wheeling_rate = 1.60
        
        duty_val = data.get("duty", "")
        # If duty is a currency amount (contains rupee/Rs or doesn't contain %), fall back to 16.0% default
        if isinstance(duty_val, str) and ("₹" in duty_val or "Rs" in duty_val or "%" not in duty_val):
            duty_pct = 16.0
        else:
            duty_pct = parse_tariff_value(duty_val)
            if duty_pct == 0:
                duty_pct = 16.0
 
        default_amount = calculate_default_tariff(provider, predictUnit)
        default_prev = calculate_default_tariff(provider, units) if units > 0 else None

        if default_amount is not None and default_amount > 0:
            if units > 0 and amount > 0 and default_prev and default_prev > 0:
                scaling_factor = amount / default_prev
                scaling_factor = max(0.60, min(3.00, scaling_factor))
                predictAmount = round(default_amount * scaling_factor)
            else:
                predictAmount = default_amount
        elif rate > 0:
            energy_charges = predictUnit * rate
            fac_charges = predictUnit * fac_rate
            wheeling_charges = predictUnit * wheeling_rate
            subtotal = fixed + energy_charges + fac_charges + wheeling_charges
            duty_charge = subtotal * (duty_pct / 100.0)
            tariff_pred = subtotal + duty_charge
            
            if units > 0 and amount > 0:
                energy_prev = units * rate
                fac_prev = units * fac_rate
                wheeling_prev = units * wheeling_rate
                subtotal_prev = fixed + energy_prev + fac_prev + wheeling_prev
                duty_prev = subtotal_prev * (duty_pct / 100.0)
                tariff_prev = subtotal_prev + duty_prev
                
                if tariff_prev > 0:
                    scaling_factor = amount / tariff_prev
                    scaling_factor = max(0.60, min(3.00, scaling_factor))
                    predictAmount = round(tariff_pred * scaling_factor)
                else:
                    predictAmount = round(tariff_pred)
            else:
                predictAmount = round(tariff_pred)
        else:
            if units > 0:
                predictAmount = round(amount * (predictUnit / units))
            else:
                predictAmount = round(amount)

        # Ensure predictAmount stays within reasonable bounds relative to current bill
        if units > 0 and amount > 0:
            max_allowed = max(300000.0, round(amount * 3.0))
            if predictAmount > max_allowed or predictAmount < 0:
                predictAmount = round(amount * (predictUnit / max(1, units)))

        print(f"History prediction: predictUnit={predictUnit}, predictAmount={predictAmount}")

        res_dict = {
            "predictUnit": predictUnit,
            "month": month_raw,
            "unit": units,
            "amount": amount,
            "predictAmount": predictAmount
        }
        for lag in range(2, consecutive_lags + 1):
            if lag in lags_data:
                res_dict[f"unit{lag}"] = lags_data[lag]["unit"]
                res_dict[f"amount{lag}"] = lags_data[lag]["amount"]
        return jsonify(res_dict)


def translate_marathi_digits(text):
    # Remove Zero Width Joiner and Zero Width Non-Joiner characters to normalize text
    text = text.replace('\u200d', '').replace('\u200c', '')
    marathi_to_english = {
        '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
        '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
    }
    for mar_char, eng_char in marathi_to_english.items():
        text = text.replace(mar_char, eng_char)

    # Dictionary translation for Marathi month names only within date structures (e.g. 25-मे-2024 or मार्च 2025)
    marathi_months = {
        'जानेवारी': 'Jan', 'जाने': 'Jan',
        'फेब्रुवारी': 'Feb', 'फेब्रु': 'Feb',
        'मार्च': 'Mar',
        'एप्रिल': 'Apr',
        'मे': 'May',
        'जून': 'Jun',
        'जुलै': 'Jul',
        'ऑगस्ट': 'Aug',
        'सप्टेंबर': 'Sep', 'सप्टें': 'Sep',
        'ऑक्टोबर': 'Oct', 'ऑक्टो': 'Oct',
        'नोव्हेंबर': 'Nov', 'नोव्हें': 'Nov',
        'डिसेंबर': 'Dec', 'डिसें': 'Dec'
    }
    for mar_m, eng_m in marathi_months.items():
        text = re.sub(r'(\b\d{1,2}[\-\/\s])' + re.escape(mar_m) + r'([\-\/\s]\d{2,4}\b)', r'\1' + eng_m + r'\2', text, flags=re.IGNORECASE)
        text = re.sub(r'(\b)' + re.escape(mar_m) + r'([\s,]+\d{4}\b)', r'\1' + eng_m + r'\2', text, flags=re.IGNORECASE)
    return text


def parse_bill_text(text):
    """Extract structured fields from OCR raw text of an electricity bill."""
    # Preprocess to strip out percentage qualifiers like (16 %)
    text = re.sub(r'\(\d+\s*%\)', '', text)
    
    wheeling_charge = None
    
    def find(patterns, default="—"):
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                val = m.group(1) if m.groups() else m.group(0)
                return val.strip()
        return default

    def find_amount(patterns, default="—"):
        for pat in patterns:
            for m in re.finditer(pat, text, re.IGNORECASE):
                val = m.group(1) if m.groups() else m.group(0)
                val_clean = re.sub(r'^[^\d]+', '', val)
                raw = val_clean.replace(",", "").strip()
                try:
                    val_float = float(raw)
                    if abs(val_float - 1912.0) < 0.1:
                        continue
                    if val_float < 50.0:
                        continue
                    return f"₹{round(val_float):,}"
                except ValueError:
                    if raw and raw != "—":
                        return f"₹{raw}"
        return default

    def find_units(patterns, default="—"):
        for pat in patterns:
            for m in re.finditer(pat, text, re.IGNORECASE):
                val = m.group(1) if m.groups() else m.group(0)
                match_start = m.start()
                context = text[max(0, match_start - 35):match_start].lower()
                if any(x in context for x in ["billing unit", "बिलींग युनिट", "billing_unit", "b.u"]):
                    continue
                try:
                    val_float = float(val)
                    if val_float <= 5.0 or val_float > 10000.0:
                        continue
                    return f"{round(val_float)} KWh"
                except ValueError:
                    return f"{val.strip()} KWh"
        return default

    def extract_slabs():
        # Determine the company key to select the correct company's default slabs
        company_key = "tata"
        for key in ["torrent", "msedcl", "tata", "adani", "best"]:
            if key in text.lower() or (key == "msedcl" and "mahavitaran" in text.lower()) or (key == "msedcl" and "mahadiscom" in text.lower()) or (key == "msedcl" and "महावितरण" in text.lower()):
                company_key = key
                break
                
        # Build dynamic default slabs based on standard tariff tables
        default_slabs = []
        clean_slab_names = ["First 100 units", "Next 200 units", "Next 200 units", "Next 500 units", "Above 1000 units"]
        company_slabs = tariffs.get(company_key, tariffs["tata"])
        prev_limit = 0
        for i, (limit, _, energy_rate, fac_rate, wheeling_rate, _) in enumerate(company_slabs):
            total_rate = energy_rate
            if limit == float('inf'):
                s_range = f"{prev_limit + 1}+"
            else:
                s_range = f"{prev_limit + 1} – {limit}" if prev_limit > 0 else f"0 – {limit}"
            
            desc = clean_slab_names[i] if i < len(clean_slab_names) else "Above 500 units"
            default_slabs.append({
                "range": s_range,
                "rate": f"₹{total_rate:.2f}",
                "desc": desc
            })
            prev_limit = limit

        # 1. Extract wheeling charge from the bill if present
        nonlocal wheeling_charge
        wheeling_charge = None
        wheel_match = re.search(r'(?:वहन|AeA|wheel)[^\n\d]*([0-9\.]+)', text, re.IGNORECASE)
        if wheel_match:
            try:
                wheeling_charge = float(wheel_match.group(1))
            except ValueError:
                pass
        
        if wheeling_charge is None:
            # Fallback based on company defaults
            if company_key == "msedcl":
                wheeling_charge = 1.60
            elif company_key == "tata":
                wheeling_charge = 2.76
            elif company_key == "adani":
                wheeling_charge = 2.28
            elif company_key == "torrent":
                wheeling_charge = 1.47
            elif company_key == "best":
                wheeling_charge = 1.87
            else:
                wheeling_charge = 0.0

        # 2. Scan all lines in the text to find candidate rate rows
        lines_list = text.split('\n')
        
        base_rates_candidate = None
        fac_rates_candidate = None
        
        for line in lines_list:
            line = line.strip()
            if not line:
                continue
                
            # Clean the line to keep only numbers and dots
            # Convert Marathi digits to English digits
            marathi_to_english = {'०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'}
            for mar, eng in marathi_to_english.items():
                line = line.replace(mar, eng)
                
            clean_line = re.sub(r'[₹रु\s\|]', ' ', line)
            
            tokens = clean_line.split()
            numbers = []
            for t in tokens:
                t_clean = re.sub(r'^[^\d]+|[^\d]+$', '', t)
                if re.match(r'^\d+(?:\.\d+)?$', t_clean):
                    try:
                        val = float(t_clean)
                        if val < 100.0:
                            numbers.append(val)
                    except ValueError:
                        pass
                        
            if len(numbers) >= 4:
                for start_idx in range(len(numbers) - 3):
                    subset_5 = numbers[start_idx:start_idx + 5]
                    subset_4 = numbers[start_idx:start_idx + 4]
                    
                    # Check 5-slab match
                    if len(subset_5) == 5:
                        if (1.5 <= subset_5[0] <= 6.5 and 
                            4.0 <= subset_5[1] <= 14.0 and 
                            6.0 <= subset_5[2] <= 19.0 and 
                            8.0 <= subset_5[3] <= 22.0 and
                            8.0 <= subset_5[4] <= 22.0):
                            base_rates_candidate = subset_5
                            break
                            
                    # Check 4-slab match
                    if (1.5 <= subset_4[0] <= 6.5 and 
                        4.0 <= subset_4[1] <= 14.0 and 
                        6.0 <= subset_4[2] <= 19.0 and 
                        8.0 <= subset_4[3] <= 22.0):
                        base_rates_candidate = subset_4
                        break
                
                # Check for FAC row: length 4 or 5, all values are small (e.g. 0 to 1.5)
                is_fac_line = any(w in line.lower() for w in ["fac", "इंस", "इंधन", "adjustment", "fuel"])
                if is_fac_line:
                    for start_idx in range(len(numbers) - 3):
                        subset_5 = numbers[start_idx:start_idx + 5]
                        subset_4 = numbers[start_idx:start_idx + 4]
                        if len(subset_5) == 5 and all(0 <= f <= 1.5 for f in subset_5):
                            fac_rates_candidate = subset_5
                            break
                        if len(subset_4) == 4 and all(0 <= f <= 1.5 for f in subset_4):
                            fac_rates_candidate = subset_4
                            break

        # Scan for explicit slab rate table lines (e.g. 0 - 100 90/- 160/- 2.02 or 101 - 300 135/- 160/- 5.35)
        slab_matches = re.findall(r'(\d+)\s*-\s*(\d+|\>|\+)\s*(?:[^\n]*?\b(\d+\.\d{2})\b)', text)
        if slab_matches and len(slab_matches) >= 3:
            slabs = []
            for m in slab_matches:
                r_start, r_end, rate = m[0], m[1], m[2]
                r_str = f"{r_start} – {r_end}"
                desc_str = f"First {r_end} units" if r_start == "0" else (f"Next {int(r_end)-int(r_start)} units" if r_end.isdigit() else f"Above {r_start} units")
                slabs.append({
                    "range": r_str,
                    "rate": f"₹{float(rate):.2f}",
                    "desc": desc_str
                })
            return slabs

        if base_rates_candidate:
            num_slabs = len(base_rates_candidate)
            if num_slabs == 5:
                ranges = ["0 – 100", "101 – 300", "301 – 500", "501 – 1000", "1001+"]
                descriptions = ["First 100 units", "Next 200 units", "Next 200 units", "Next 500 units", "Above 1000 units"]
            else:
                ranges = ["0 – 100", "101 – 300", "301 – 500", "501+"]
                descriptions = ["First 100 units", "Next 200 units", "Next 200 units", "Above 500 units"]
                
            slabs = []
            for i in range(num_slabs):
                base = base_rates_candidate[i]
                fac = fac_rates_candidate[i] if (fac_rates_candidate and i < len(fac_rates_candidate)) else 0.0
                
                # Clean up any FAC anomalies (e.g. 0.4 -> 0.40)
                if fac >= 4.0 and base > 10.0:
                    fac = 0.40
                    
                total_rate = base
                
                slabs.append({
                    "range": ranges[i],
                    "rate": f"₹{total_rate:.2f}",
                    "desc": descriptions[i]
                })
            return slabs
            
        return default_slabs

    # Company Name Detection with Marathi & English dictionary support
    company_name = "—"
    text_lower = text.lower()
    
    if "best" in text_lower or "बृहन्मुंबई" in text_lower or "बेस्ट" in text_lower:
        company_name = "BEST"
    elif "mahadiscom" in text_lower or "msedcl" in text_lower or "mahavitaran" in text_lower or "महावितरण" in text_lower or "महाराष्ट्र राज्य विद्युत" in text_lower or "सेवेची नवी ओळख" in text_lower:
        company_name = "MSEDCL"
    elif "tatapower" in text_lower or "tata power" in text_lower or "टाटा पॉवर" in text_lower or "टाटा" in text_lower:
        company_name = "Tata Power"
    elif "adani" in text_lower or "अदानी" in text_lower:
        company_name = "Adani Electricity"
    elif "torrent" in text_lower or "टॉरेंट" in text_lower:
        company_name = "Torrent Power"
    else:
        company_name = find([
            r'(Torrent Power[^\n]*)',
            r'(MSEDCL[^\n]*)',
            r'(महावितरण[^\n]*)',
            r'(महाराष्ट्र राज्य विद्युत[^\n]*)',
            r'(Tata Power[^\n]*)',
            r'(Adani[^\n]*)',
            r'(BSES[^\n]*)',
            r'Company\s*[:\-]?\s*([^\n]+)',
        ])

    if company_name and any(x in company_name.lower() for x in ["gmail", "yahoo", "com", "www"]):
        if "adani" in text_lower or "अदानी" in text_lower:
            company_name = "Adani Electricity"
        elif "best" in text_lower or "बृहन्मुंबई" in text_lower or "बेस्ट" in text_lower:
            company_name = "BEST"
        elif "msedcl" in text_lower or "mahavitaran" in text_lower or "महावितरण" in text_lower:
            company_name = "MSEDCL"
        elif "tata" in text_lower or "टाटा" in text_lower:
            company_name = "Tata Power"
        else:
            company_name = "—"

    cin = find([r'CIN\s*[:\-]?\s*([A-Z0-9]+)', r'U\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}'])
    gstin = find([
        r'\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}',
        r'GSTIN\s*(?:of\s+\w+)?\s*[:\-]?\s*([A-Z0-9]{15})',
        r'GSTIN\s*[:\-]?\s*([A-Z0-9]{10,15})'
    ])
    website = find([
        r'(?:Website\s*[:\-]?\s*)?((?:www\.|connect\.)?torrentpower\.[a-z]{2,3}(?:\.[a-z]{2})?)',
        r'(?:Website\s*[:\-]?\s*)?((?:www\.)?mahadiscom\.[a-z]{2,3}(?:\.[a-z]{2})?)',
        r'(?:Website\s*[:\-]?\s*)?((?:www\.)?tatapower\.[a-z]{2,3}(?:\.[a-z]{2})?)',
        r'www\.[a-zA-Z0-9\-\.]+\.[a-z]{2,}',
        r'[a-zA-Z0-9\-\.]+\.[a-z]{2,}'
    ])
    toll = find([r'(\d{4,6})\s*\(?Toll[- ]Free\)?', r'Toll\s*Free\s*[:\-]?\s*([0-9\- ]+)'])

    # Registered office
    office_lines = re.findall(r'(?:Registered Office|NDPL House|Hudson Lines)[^\n]*', text, re.IGNORECASE)
    registered_office = " ".join(office_lines[:2]) if office_lines else "—"

    # Consumer Name Extraction
    def get_consumer_name_robust(text):
        exclusions = ["book", "folio", "consumer", "invoice", "number", "account", "address", "billing", "power", "supply", "महाराष्ट्र", "विद्युत", "वितरण", "कंपनी", "मर्यादित", "msedcl", "mahadiscom", "tata", "adani", "best", "torrent", "standard", "form", "test", "active", "feed", "late", "payment", "email"]

        # 1. English "Name :" pattern (e.g. Name : SANJEET VASANT GUPTA & BABITA SANJEET GUPTA)
        m_name = re.search(r'\bName\s*[:\-]\s*([A-Za-z\s\&\.\,]{3,50})', text, re.IGNORECASE)
        if m_name:
            cand = m_name.group(1).strip()
            if len(cand) >= 3 and not any(w in cand.lower() for w in ["mobile", "email", "address", "bill", "phone"]):
                return cand

        # 2. All-caps name block before Email ID / Address / Mobile / Book Folio
        m_caps = re.search(r'([A-Z\u0900-\u097F\s\&\.\,\d]{5,60})\s*(?:\n+Email\s*ID\b|\n+Mobile|\s+Book\s+Folio)', text, re.IGNORECASE)
        if m_caps:
            cand = re.split(r'\b(?:Book|Folio|Consumer|Invoice|Cycle|C\.A\.No|Service|Installation|Tariff|Security|Email|Mobile)\b', m_caps.group(1), flags=re.IGNORECASE)[0].strip()
            cand = re.sub(r'[\d\s]+$', '', cand).strip()
            if len(cand) >= 4 and not any(w in cand.lower() for w in exclusions):
                return cand

        # 3. BEST Marathi pattern: "क डा अमोल एन, कदम" or "श्री अमोल एन. कदम"
        m_best = re.search(r'(?:क\s*डा|क\.?\s*डा\.?|श्री|श्रीमती)\s+([A-Za-z\u0900-\u097F\s\,\.]+?)(?=\s+(?:feed|महिला|देयक|बिल|दिनांक|मीटर|ग्राहक|फॅट|फ्लॅट|महिना|mobile|ईमेल|चक्क|ग्राहकाचे))', text, re.IGNORECASE)
        if m_best:
            cand = m_best.group(1).replace(',', ' ').strip()
            if len(cand) >= 3 and not any(w in cand.lower() for w in exclusions):
                return cand

        # 4. Adani Bill of Supply pattern
        m_supply = re.search(r'BILL\s+OF\s+SUPPLY[^\n]*\n+([A-Z\u0900-\u097F\s]{3,40})', text, re.IGNORECASE)
        if m_supply:
            cand = m_supply.group(1).strip()
            if len(cand) >= 3 and not any(w in cand.lower() for w in exclusions):
                return cand

        # 5. MSEDCL Marathi bill name line after 12-digit consumer ID
        m_msedcl_id_next = re.search(r'ग्राहक\s*क्रमांक\s*[:\-]?\s*[0-9\/]+\s*[^\n]*\n+([A-Za-z\u0900-\u097F\s\.\-]+)', text, re.IGNORECASE)
        if m_msedcl_id_next:
            cand = m_msedcl_id_next.group(1).strip()
            cand = re.split(r'\b(?:TYPE|देयक|रक्कम|रु|दिनांक|जेल)\b', cand, flags=re.IGNORECASE)[0].strip()
            cand_clean = re.sub(r'[^A-Za-z\u0900-\u097F\s\.]', '', cand).strip()
            if len(cand_clean) >= 3 and not any(w in cand_clean.lower() for w in exclusions):
                return cand_clean

        # 6. Generic label search
        m_label = re.search(r'(?:ग्राहकाचे\s*नाव|ग्राहक\s*नाव|Consumer\s*Name|Customer\s*Name)\s*[:\-]?\s*([A-Za-z\u0900-\u097F\s\.]+)', text, re.IGNORECASE)
        if m_label:
            val = m_label.group(1).strip()
            val_clean = re.split(r'\b(?:Bill|Amount|Rs|deyak|deya|रु|देयक|रक्कम|दिनांक|meter|Active|सक्रिय|फॅट|फ्लॅट|flat|no|building|road|street|email|gmail)\b', val, flags=re.IGNORECASE)[0].strip()
            val_clean = re.sub(r'[^A-Za-z\u0900-\u097F\s\.]', '', val_clean).strip()
            if len(val_clean) >= 3 and not any(w in val_clean.lower() for w in exclusions):
                return val_clean

        return "—"

    consumer_name = get_consumer_name_robust(text)
    if consumer_name == "—" or "Book" in consumer_name or "Folio" in consumer_name:
        consumer_name = find([
            r'Consumer\s*Name\s*[:\-]?\s*([A-Za-z\u0900-\u097F\s]{3,40})',
            r'Name\s*[:\-]\s*([A-Za-z\u0900-\u097F\s]{3,40})',
            r'ग्राहकाचे\s*नाव\s*[:\-]?\s*([A-Za-z\u0900-\u097F\s]{3,40})',
            r'ग्राहक\s*नाव\s*[:\-]?\s*([A-Za-z\u0900-\u097F\s]{3,40})',
        ])

    consumer_id = find([
        r'C\.A\.No\.?\s*[:\-_;]?\s*([0-9]{5,15})',
        r'Consumer\s*No\.?\s*[:\-_;]?\s*([0-9\-\*]{5,20})',
        r'Consumer\s*(?:ID|Number)\s*[:\-]?\s*([0-9]{5,15})',
        r'ACCOUNT\s*NO\s*\n+\s*([0-9]{5,15})',
        r'Account\s*(?:No|Number)\s*[:\-]?\s*([0-9]{5,15})',
        r'ग्राहक\s*(?:क्रमांक|क्र\.?)\s*[:\-]?\s*([0-9]{5,15})',
        r'दुरी\s*:\s*([0-9]{8,15})',
        r'\b([0-9]{12})\b',
        r'\b([0-9]{9,10})\b',
    ])

    if consumer_id and "*" in consumer_id:
        consumer_id = consumer_id.replace('*', '').strip()

    connection_num = find([
        r'Meter\s*No[\:\-\s]*([0-9A-Za-z\-]{5,15})',
        r'(?:Connection|Meter|[मीमि]टर\s*(?:क्रमांक|क्र\.?)|ftrex|aie)\s*(?:Number|No\.?|aie)?\s*[:\-]?\s*([0-9A-Za-z\-]{8,15})',
        r'\b(\d{11})\b',
    ])

    # Extract Bill Date with validation helper
    def is_valid_date_str(d_str):
        if not d_str or len(d_str) < 5:
            return False
        parts = re.split(r'[\/\-\s]', d_str.strip())
        if len(parts) == 3:
            p1, p2, p3 = parts[0], parts[1], parts[2]
            if p1.isdigit() and p2.isdigit() and p3.isdigit():
                v1, v2, v3 = int(p1), int(p2), int(p3)
                if v3 > 2000 and v3 < 2035:
                    return (1 <= v1 <= 31) and (1 <= v2 <= 12)
                elif v1 > 2000 and v1 < 2035:
                    return (1 <= v2 <= 12) and (1 <= v3 <= 31)
                return False
            elif p1.isdigit() and p3.isdigit():
                return (1 <= int(p1) <= 31) and (2000 <= int(p3) <= 2035 or 15 <= int(p3) <= 35)
        elif len(parts) == 2:
            return True
        return False

    bill_date = "—"
    bill_date_patterns = [
        r'BILL\s+OF\s+SUPPLY\s+FOR\s+THE\s+MONTH\s+(?:OF\s*[\-\:]?\s*)?([A-Za-z\u0900-\u097F]{3,9}[\-\s]*\d{4})',
        r'बिल\s*दिनांक\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'देयक\s*दिनांक\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'Date\s*of\s*Bill\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'Bill\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b',
        r'\b(\d{1,2}\/\d{1,2}\/\d{4})\b',
        r'BILL\s+MONTH\s*\n+\s*([A-Za-z]{3}-\d{2,4})',
        r'(?:मार्च|March|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{4})',
    ]

    for pat in bill_date_patterns:
        m_bd = re.search(pat, text, re.IGNORECASE)
        if m_bd:
            cand_bd = m_bd.group(1).strip()
            if is_valid_date_str(cand_bd) or "-" in cand_bd:
                bill_date = cand_bd
                break

    due_date = find([
        r'देय\s*दिनांक\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'Due\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-\s][A-Za-z0-9]{3,10}[\/\-\s]\d{2,4})',
        r'DUE\s+DATE\s*\n+\s*(\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{2,4})',
        r'Payment\s*Due\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})',
        r'Last\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-][A-Za-z0-9]{3,10}[\/\-]\d{2,4})',
        r'अंतिम\s*तारीख\s*[:\-]?\s*(\d{1,2}[\/\-][A-Za-z0-9]{3,10}[\/\-]\d{2,4})',
        r'या\s*तारखे\s*(?:पर्यंत|नंतर)\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})',
    ])

    bill_status = find([
        r'Status\s*[:\-]?\s*(Paid|Unpaid|Pending|Due)',
        r'Payment\s*Status\s*[:\-]?\s*(Paid|Unpaid|Pending|Due)',
        r'देयक\s*स्थिती\s*[:\-]?\s*(Paid|Unpaid|Pending|Due)',
    ], default="Unpaid")

    # Extract Tariff Category
    def get_tariff_category_robust(text):
        text_lower = text.lower()
        if "commercial" in text_lower or "non-residential" in text_lower or "non residential" in text_lower or "lt-ii" in text_lower or "lt-2" in text_lower:
            return "Commercial"
        elif "industrial" in text_lower or "lt-iii" in text_lower or "lt-3" in text_lower:
            return "Industrial"
        else:
            return "Residential"
    tariff_cat_extracted = get_tariff_category_robust(text)

    # Usage
    prev_units = find_units([
        r'Previous\s*(?:Month\s*)?Units\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
        r'Units\s*(?:Last|Prev)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
    ])

    prev_amount = find_amount([
        r'Previous\s*(?:Month\s*)?Bill\s*amount[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Previous\s*Bill\s*Amount[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Previous\s*Balance[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Last\s*Payment\s*Received[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'मागील\s*(?:बिल|देयक)\s*(?:रक्कम)?[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'मागील\s*पावती[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
    ])

    # Robust Current & Previous Units Parser
    def extract_curr_and_prev_units(text):
        lines = text.split('\n')
        c_units = "—"
        p_units = "—"
        
        # Exclude lines containing financial amounts, dates, timestamps, phone numbers, invoice numbers
        amount_keywords = ["bill", "amount", "rs", "rupees", "रक्कम", "देयक", "मागील", "एकूण", "भरणा", "rupee", "payment", "net", "total", "printed", "date", "phone", "mobile", "cin", "gstin", "www", "http", "gmail", "invoice", "receipt"]

        # 1. Search lines that specifically look like meter reading lines
        for line in lines:
            line_low = line.lower()
            if any(w in line_low for w in amount_keywords) or re.search(r'\b\d{2}/\d{2}/\d{4}\b', line) or re.search(r'\b\d{2}:\d{2}:\d{2}\b', line):
                continue
                
            tokens = line.split()
            integers = []
            for t in tokens:
                if re.match(r'^\d{4,6}$', t):
                    val = int(t)
                    if val not in range(2020, 2031):
                        integers.append(val)

            if len(integers) >= 2:
                for i in range(len(integers) - 1):
                    v1, v2 = integers[i], integers[i+1]
                    if v2 > v1:
                        diff = v2 - v1
                        if 10 <= diff <= 5000:
                            c_units = f"{diff} KWh"
                            p_units = f"{v1} (Reading)"
                            break
                if c_units != "—":
                    break

        # 2. Existing math pattern matching with line filters to avoid timestamp/date math false positives
        if c_units == "—":
            for line in lines:
                line_low = line.lower()
                if any(w in line_low for w in ["printed", "date", "phone", "mobile", "cin", "gstin", "www", "http", "gmail", "billing unit", "bu ", "dtc"]) or re.search(r'\b\d{2}:\d{2}:\d{2}\b', line):
                    continue
                integers = re.findall(r'\b\d{2,6}\b', line)
                if len(integers) >= 3:
                    for i in range(len(integers) - 1):
                        v1 = int(integers[i])
                        v2 = int(integers[i+1])
                        diff = abs(v1 - v2)
                        if 10 < diff < 10000:
                            if str(diff) in integers[i+2:]:
                                c_units = f"{diff} KWh"
                                break

        if c_units == "—":
            for m in re.finditer(r'(\d+)\s+(\d+)\s+([0-9Oo]+)\s+(\d+)\s+([0-9Oo]+)\s+(\d+)', text):
                try:
                    curr_r = int(m.group(1))
                    prev_r = int(m.group(2))
                    mf_str = m.group(3).lower().replace('o', '0')
                    mf = int(mf_str) if mf_str.isdigit() else 1
                    diff = int(m.group(4))
                    tot = int(m.group(6))
                    if abs((curr_r - prev_r) * mf - tot) <= 5 or tot == diff or tot == abs(curr_r - prev_r):
                        c_units = f"{tot} KWh"
                        if p_units == "—":
                            p_units = f"{prev_r} (Reading)"
                        break
                except Exception:
                    continue

        if c_units == "—":
            # Filter candidates to reject BU numbers
            units_cands = re.findall(r'([0-9]+(?:\.[0-9]+)?)\s*(?:kWh|KWh|KWH)\b', text)
            for cand in units_cands:
                if not re.search(r'(?:बिलींग|billing|bu|kalyan)[^\n]*' + re.escape(cand), text, re.IGNORECASE):
                    val = float(cand)
                    if 10 <= val <= 20000:
                        c_units = f"{int(val)} KWh"
                        break

        if c_units == "—":
            c_units = find_units([
                r'Consumption\s+([0-9]+(?:\.[0-9]+)?)\b',
                r'Total\s*Consumption\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\b',
                r'Total\s+([0-9]+)\s+(?:Units|units|Ss)\b',
                r'वापरलेली\s*युनिट्स\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\b',
                r'([0-9]+(?:\.[0-9]+)?)\s*(?:युनिट्स|युनिट)\b',
                r'Current\s*(?:Month\s*)?Units\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
                r'Units\s*(?:This|Current)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
                r'Units\s*Consumed\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
                r'एकूण\s*युनिट्स?\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
                r'युनिट्स\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
                r'युनिट\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)',
            ])

        # 3. Check for bill month current consumption (e.g. May-26 206) and previous month consumption (e.g. Apr-26 276)
        bill_month_m = re.search(r'FOR\s+THE\s+MONTH\s+OF\s+([A-Za-z]{3})[-\s]*(\d{4})', text, re.IGNORECASE)
        if not bill_month_m:
            bill_month_m = re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\s]*(?:20)?(\d{2})\b', text, re.IGNORECASE)
        
        months_arr = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        if bill_month_m:
            b_m_str = bill_month_m.group(1).lower()[:3]
            if b_m_str in months_arr:
                # 3a. Current month units fallback (e.g. May-26 206)
                if c_units == "—":
                    c_match = re.search(r'\b' + b_m_str + r'[-\s]*\d{2,4}[\s:=|]+(\d{2,4})\b', text, re.IGNORECASE)
                    if not c_match:
                        c_match = re.search(r'(\d{2,4})[\s:=|]+' + b_m_str + r'[-\s]*\d{2,4}\b', text, re.IGNORECASE)
                    if c_match:
                        c_u = int(c_match.group(1))
                        if 10 <= c_u <= 10000:
                            c_units = f"{c_u} KWh"

                # 3b. Previous month units lookup (e.g. Apr-26 276)
                b_m_idx = months_arr.index(b_m_str)
                prev_m_idx = (b_m_idx - 1) % 12
                prev_m_str = months_arr[prev_m_idx]
                
                p_match = re.search(r'\b' + prev_m_str + r'[-\s]*\d{2,4}[\s:=|]+(\d{2,4})\b', text, re.IGNORECASE)
                if not p_match:
                    p_match = re.search(r'(\d{2,4})[\s:=|]+' + prev_m_str + r'[-\s]*\d{2,4}\b', text, re.IGNORECASE)
                if p_match:
                    p_u = int(p_match.group(1))
                    if 10 <= p_u <= 5000:
                        p_units = f"{p_u} KWh"

        return c_units, p_units

    curr_units, p_units_extracted = extract_curr_and_prev_units(text)
    if prev_units == "—" or not prev_units:
        prev_units = p_units_extracted if p_units_extracted else "—"
    payment_history = []
    
    # Extract horizontal unit list from bill text (e.g. एप्रिल-2026 359, मार्च-2026 330)
    marathi_months_dict = {
        'जानेवारी': 'Jan', 'जाने': 'Jan',
        'फेब्रुवारी': 'Feb', 'फेब्रु': 'Feb',
        'मार्च': 'Mar',
        'एप्रिल': 'Apr',
        'मे': 'May',
        'जून': 'Jun', 'जुन': 'Jun',
        'जुलै': 'Jul',
        'ऑगस्ट': 'Aug',
        'सप्टेंबर': 'Sep', 'सप्टें': 'Sep',
        'ऑक्टोबर': 'Oct', 'ऑक्टो': 'Oct',
        'नोव्हेंबर': 'Nov', 'नोव्हें': 'Nov',
        'डिसेंबर': 'Dec', 'डिसें': 'Dec'
    }
    months_arr = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    text_unit_map = {} # key "mmm-yyyy" -> (display_str, units_int)
    unit_matches = re.findall(r'([A-Za-z\u0900-\u097F]{3,10})[-\s,]*(\d{4})[\s:=|]+(\d{2,4})\b', text)
    for m in unit_matches:
        m_name, y_str, u_str = m[0].strip(), m[1].strip(), m[2].strip()
        eng_month = None
        for mar_k, eng_v in marathi_months_dict.items():
            if mar_k.lower() in m_name.lower():
                eng_month = eng_v
                break
        if not eng_month:
            for eng_v in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]:
                if eng_v.lower() in m_name.lower():
                    eng_month = eng_v
                    break
        if eng_month:
            u_val = int(u_str)
            if 10 <= u_val <= 3000:
                k = f"{eng_month.lower()}-{y_str}"
                text_unit_map[k] = (f"{eng_month}-{y_str}", u_val)

    text_pay_map = {} # key "mmm-yyyy" -> (display_str, amount_float)
    history_idx = -1
    keywords = ["payment history", "मागील पावतीचा दिनांक", "भरणा तपशील"]
    text_lower = text.lower()
    for kw in keywords:
        idx = text_lower.find(kw)
        if idx != -1:
            history_idx = idx
            break
            
    if history_idx != -1:
        history_text = text[history_idx:]
        p_matches = re.findall(r'(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})\s+([0-9\.,]+)', history_text)
        for d_day, m_num, y_str, a_str in p_matches:
            try:
                m_int = int(m_num)
                y_int = int(y_str)
                if y_int < 100: y_int += 2000
                # Payment made in month M is for bill month M-1
                bill_m_int = m_int - 1
                bill_y_int = y_int
                if bill_m_int == 0:
                    bill_m_int = 12
                    bill_y_int -= 1
                if 1 <= bill_m_int <= 12:
                    m_str = months_arr[bill_m_int - 1]
                    key = f"{m_str}-{bill_y_int}"
                    a_val = float(a_str.replace(',', ''))
                    if 100 <= a_val <= 300000:
                        text_pay_map[key] = (f"{m_str.capitalize()}-{bill_y_int}", round(a_val))
            except ValueError:
                pass

    all_keys = set(text_unit_map.keys()).union(set(text_pay_map.keys()))
    for k in all_keys:
        d_display = text_unit_map[k][0] if k in text_unit_map else text_pay_map[k][0]
        units_val = text_unit_map[k][1] if k in text_unit_map else None
        amount_val = text_pay_map[k][1] if k in text_pay_map else None
        
        if amount_val is None and units_val is not None:
            company_key = getCompanyKey(company_name) if 'getCompanyKey' in locals() else "msedcl"
            amount_val = calculate_default_tariff(company_key, units_val)
        elif units_val is None and amount_val is not None:
            subtotal = amount_val / 1.16
            energy_c = subtotal - 130
            if energy_c > 0:
                units_val = max(1, round(energy_c / 5.88))

        payment_history.append({
            "date": d_display,
            "units": f"{units_val} KWh" if units_val else "—",
            "amount": f"₹{amount_val:,}" if amount_val else "—"
        })

    from datetime import datetime
    def sort_hist_key(x):
        try:
            return datetime.strptime(x["date"], "%b-%Y")
        except ValueError:
            return datetime.min
    payment_history.sort(key=sort_hist_key, reverse=True)

    curr_amount = find_amount([
        r'Current\s*Months?\s*Bill\s*Amount[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Current\s*Month\s*charges[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Bill\s*\(A\s*\+\s*B\s*\+\s*C\)[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Bill\s*Amount\s*\(Rounded\)\s*Rs\.?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'TOTALCURRENT\s*BILL[^\n]*?([0-9,]+(?:\.[0-9]+)?)\b',
        r'देयक\s*रक्कम\s*(?:रु)?\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'देयकाची\s*निव्वळ\s*रक्कम\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'पूर्णांक\s*देयक\s*\(?रु\.?\)?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'\b(?:Total\s*Amount\s*Payable|एकूण\s*देय\s*रक्कम|देयक\s*रक्कम|देयकाची\s*निव्वळ\s*रक्कम|देय\s*रक्कम|एकूण\s*रक्कम|Rounded|Total|Net|Net\s*Payable|Bill\s*Amount)\b[\s\S]{0,100}?(?:₹|%|=|रु|Rs\.?|र\s*)\s*([0-9,]+(?:\.[0-9]+)?)\b',
    ])

    # Bill summary extraction
    energy = find_amount([
        r'\b(?:Energy\s*Charges?|ToT\s*आकार|ate\s*STR|वीज\s*आकार|विद्युत\s*आकार|ऊर्जा\s*आकार)\b[^0-9\n]{0,20}([0-9,]+(?:\.[0-9]+)?)\b',
        r'Energy\s*Charges?\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)',
        r'विद्युत\s*आकार\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)',
        r'(?<!/)\bEnergy\b[^0-9\n]{0,20}([0-9,]+(?:\.[0-9]+)?)\b',
    ])
    
    fixed = find_amount([
        r'\b(?:Demand\s*Charges?|Demand|Fixed\s*Charges?|Fixed|PROTA|स्थिर|नियत|मागणी\s*आकार)\b[^0-9\n]{0,25}([0-9,]+(?:\.[0-9]+)?)\b',
        r'Fixed\s*Charges?\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)',
        r'Demand\s*Charges?\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)',
        r'स्थिर\s*आकार\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)',
    ])
    
    # Override fixed charge if standard base fixed charge is found
    base_fixed_charge = None
    table_keywords = ["fix", "fixed", "स्थिर", "demand"]
    lines_summary = text.split('\n')
    for idx, line in enumerate(lines_summary):
        line_lower = line.lower()
        if any(kw in line_lower for kw in table_keywords):
            for offset in [0, 1, 2]:
                if idx + offset < len(lines_summary):
                    search_line = lines_summary[idx + offset]
                    integers = re.findall(r'\b\d{2,3}\b', search_line)
                    for val_str in integers:
                        val = int(val_str)
                        if val in [90, 130, 135, 160]:
                            base_fixed_charge = val
                            break
                if base_fixed_charge:
                    break
        if base_fixed_charge:
            break
            
    if base_fixed_charge and (not fixed or fixed == "—"):
        fixed = f"₹{base_fixed_charge}"

    # FAC robust line parsing
    def get_fac_robust(text):
        m = re.search(r'\b(?:FAC|Fuel\s*Adj(?:ustment)?|Fuel|इंधन\s*समायोजन\s*आकार|इंधन\s*आकार)\b[^\n]*', text, re.IGNORECASE)
        if m:
            line = m.group(0)
            floats = re.findall(r'\b\d+(?:\.\d+)?\b', line)
            if floats:
                for f in reversed(floats):
                    val = float(f)
                    if val > 10.0 and val < 100000.0:
                        return f"₹{round(val):,}"
        return "—"

    fac = get_fac_robust(text)

    # Wheeling Charge total amount robust line parsing
    def get_wheeling_robust(text):
        m = re.search(r'\b(?:Wheeling\s*Charges?|Wheeling\s*Charge|Wheeling|वहन\s*आकार)\b[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b', text, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1).replace(',', ''))
                if 0.0 < val < 50000.0:
                    return f"₹{round(val):,}"
            except ValueError:
                pass
        return None

    wheeling_amt_extracted = get_wheeling_robust(text)

    # Duty robust parsing
    def get_duty_robust(text):
        m = re.search(r'\b(?:Electricity\s*Duty|Duty|वीज\s*शुल्क|वीज\s*शल्क|विद्युत\s*शुल्क)\b[^\n\d]*(?:\d+(?:\.\d+)?%)?[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b', text, re.IGNORECASE)
        if m:
            try:
                val = float(m.group(1).replace(',', ''))
                if val == 0.0:
                    return "₹0"
                elif val >= 10.0 and val < 500000.0:
                    return f"₹{round(val):,}"
            except ValueError:
                pass
        return "—"

    duty = get_duty_robust(text)
    other = find_amount([r'Other\s*Charges?\s*[:\-]?\s*[₹Rs\.]*\s*([0-9,]+(?:\.[0-9]+)?)'])

    total = find_amount([
        r'Current\s*Months?\s*Bill\s*Amount[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Current\s*Month\s*charges[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Bill\s*\(A\s*\+\s*B\s*\+\s*C\)[^\n\d]*([0-9,]+(?:\.[0-9]+)?)\b',
        r'Total\s*Bill\s*Amount\s*\(Rounded\)\s*Rs\.?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'TOTALCURRENT\s*BILL[^\n]*?([0-9,]+(?:\.[0-9]+)?)\b',
        r'देयक\s*रक्कम\s*(?:रु)?\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'देयकाची\s*निव्वळ\s*रक्कम\s*[:\-]?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'पूर्णांक\s*देयक\s*\(?रु\.?\)?\s*([0-9,]+(?:\.[0-9]+)?)\b',
        r'\b(?:Rounded|Total|Net|Rounded\s*Bill|Net\s*Bill\s*Amount|Total\s*Current\s*Bill|Net\s*Payable|Bill\s*Amount|एकूण\s*देय\s*रक्कम|देय\s*रक्कम|एकूण\s*रक्कम)\b[^0-9\n]{0,20}([0-9,]+(?:\.[0-9]+)?)\b',
    ])

    # Calculate other charges as total - (energy + wheeling + fixed + fac + duty)
    def parse_num(val_str):
        if not val_str or val_str == "—": return 0.0
        val_clean = re.sub(r'[^\d\.]', '', str(val_str).split('/')[0])
        try: return float(val_clean)
        except ValueError: return 0.0

    tot_val = total if total != "—" else curr_amount
    tot_f = parse_num(tot_val)
    eng_f = parse_num(energy)
    fix_f = parse_num(fixed)
    fac_f = parse_num(fac)
    whl_f = parse_num(wheeling_amt_extracted if wheeling_amt_extracted else (f"₹{wheeling_charge:.2f}" if wheeling_charge else "—"))
    dty_f = parse_num(duty)

    if tot_f > 0:
        sub_sum = eng_f + fix_f + fac_f + whl_f + dty_f
        diff = tot_f - sub_sum
        if diff > 1.0:
            other = f"₹{round(diff):,}"
        elif other == "—":
            other = "—"

    # Detect city from text
    cities = ["Mumbai", "Thane", "Pune", "Bhiwandi", "Ahmedabad", "Surat", "Nagpur", "Nashik", "Navi Mumbai", "Kalyan", "Dombivli", "Kalwa", "Mumbra", "Vasai", "Virar", "Mira Bhayandar"]
    detected_city = "Mumbai"
    text_lower = text.lower()
    for c in cities:
        if c.lower() in text_lower:
            detected_city = c
            break

    slabs_data = extract_slabs()
    return {
        "company": {
            "name": company_name,
            "cin": cin,
            "website": website if website != "—" else "—",
            "toll": toll if toll != "—" else "—",
            "office": registered_office,
            "gstin": gstin,
        },
        "consumer": {
            "name": consumer_name,
            "id": consumer_id,
            "connection": connection_num,
            "billDate": bill_date,
            "dueDate": due_date,
            "city": detected_city,
            "tariffCategory": tariff_cat_extracted,
        },
        "usage": {
            "prevUnits": prev_units,
            "prevAmount": prev_amount,
            "currUnits": curr_units,
            "currAmount": curr_amount,
            "status": bill_status if bill_status != "—" else "Unpaid",
        },
        "summary": {
            "energy": energy,
            "fixed": fixed,
            "fac": fac,
            "wheeling": wheeling_amt_extracted if wheeling_amt_extracted else (f"₹{wheeling_charge:.2f}" if wheeling_charge else "—"),
            "duty": duty,
            "other": other,
            "total": total if total != "—" else curr_amount,
        },
        "slabs": slabs_data,
        "history": payment_history,
    }


def extract_graph_history_hybrid(page_image, bill_date_str, company_key, bill_text):
    w, h = page_image.size
    is_6_month = "bhiwandi" in bill_text.lower() or "shahapur" in bill_text.lower() or "6 months" in bill_text.lower()
    
    if is_6_month:
        graph_box = (int(w * 0.03), int(h * 0.52), int(w * 0.97), int(h * 0.77))
        layout_type = 6
        x_start = 220
        spacing = 217
    else:
        graph_box = (int(w * 0.03), int(h * 0.52), int(w * 0.68), int(h * 0.76))
        layout_type = 12
        x_start = 158
        spacing = 76.5
        
    graph_crop = page_image.crop(graph_box)
    crop_w, crop_h = graph_crop.size
    
    df = pytesseract.image_to_data(graph_crop, lang="eng", config="--psm 11", output_type=pytesseract.Output.DATAFRAME)
    df = df[df['text'].notna()]
    df['text'] = df['text'].astype(str).str.strip()
    df = df[(df['text'] != "") & (df['conf'] >= 50)]
    
    digits = []
    for idx, row in df.iterrows():
        text = row['text']
        if text.isdigit():
            val = int(text)
            if row['left'] < 0.08 * crop_w:
                continue
            if val in [2024, 2025, 2026, 2027] or val > 5000:
                continue
            digits.append({
                "val": val,
                "left": row['left'],
                "top": row['top']
            })
            
    if not digits:
        if not is_6_month:
            graph_box = (int(w * 0.03), int(h * 0.52), int(w * 0.97), int(h * 0.77))
            graph_crop = page_image.crop(graph_box)
            crop_w, crop_h = graph_crop.size
            df = pytesseract.image_to_data(graph_crop, lang="eng", config="--psm 11", output_type=pytesseract.Output.DATAFRAME)
            df = df[df['text'].notna()]
            df['text'] = df['text'].astype(str).str.strip()
            df = df[(df['text'] != "") & (df['conf'] >= 50)]
            digits = []
            for idx, row in df.iterrows():
                text = row['text']
                if text.isdigit():
                    val = int(text)
                    if row['left'] < 0.08 * crop_w:
                        continue
                    if val in [2024, 2025, 2026, 2027] or val > 5000:
                        continue
                    digits.append({
                        "val": val,
                        "left": row['left'],
                        "top": row['top']
                    })
        if not digits:
            return []
            
    cols = []
    for d in digits:
        matched = False
        for c in cols:
            if abs(c['left'] - d['left']) < 30:
                if d['top'] < c['top']:
                    c['val'] = d['val']
                    c['top'] = d['top']
                matched = True
                break
        if not matched:
            cols.append(d.copy())
            
    cols = sorted(cols, key=lambda x: x['left'])
    
    from datetime import datetime, timedelta
    
    def parse_date_locale_independent(date_str):
        clean_str = date_str.replace("/", "-").replace(" ", "-").strip()
        clean_str = re.sub(r'^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$', '', clean_str)
        
        m = re.match(r'^(\d{1,2})-(\d{1,2})-(\d{2,4})$', clean_str)
        if m:
            day = int(m.group(1))
            month = int(m.group(2))
            year = int(m.group(3))
            if year < 100:
                year += 2000
            try:
                return datetime(year, month, day)
            except ValueError:
                pass
                
        m = re.match(r'^(\d{1,2})-([A-Za-z]{3,10})-(\d{2,4})$', clean_str)
        if m:
            day = int(m.group(1))
            month_str = m.group(2).lower()[:3]
            year = int(m.group(3))
            if year < 100:
                year += 2000
            months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            if month_str in months:
                month = months.index(month_str) + 1
                try:
                    return datetime(year, month, day)
                except ValueError:
                    pass
                    
        m = re.match(r'^([A-Za-z]{3,10})-(\d{2,4})$', clean_str)
        if m:
            month_str = m.group(1).lower()[:3]
            year = int(m.group(2))
            if year < 100:
                year += 2000
            months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
            if month_str in months:
                month = months.index(month_str) + 1
                try:
                    return datetime(year, month, 1)
                except ValueError:
                    pass
                    
        for fmt in ["%d-%m-%Y", "%d-%m-%y", "%m-%Y", "%Y-%m-%d"]:
            try:
                return datetime.strptime(clean_str, fmt)
            except ValueError:
                continue
        return None

    bill_date = parse_date_locale_independent(bill_date_str)
    if not bill_date:
        bill_date = datetime.now()
        
    months_list = []
    curr_date = bill_date
    for i in range(layout_type):
        first = curr_date.replace(day=1)
        prev_month = first - timedelta(days=1)
        months_list.append(prev_month.strftime("%b-%Y"))
        curr_date = prev_month
        
    history = []
    mapped_units = [None] * layout_type
    
    max_allowed_dist = 45 if layout_type == 6 else 25
    for c in cols:
        idx = int(round((c['left'] - x_start) / spacing))
        if 0 <= idx < layout_type:
            expected_x = x_start + idx * spacing
            dist = abs(c['left'] - expected_x)
            if dist <= max_allowed_dist:
                mapped_units[idx] = c['val']
            
    # If no graph columns detected or all column values are identical, return cyan mask bar chart or empty list
    valid_vals = set(c['val'] for c in cols if 'val' in c and c['val'] is not None)
    if len(valid_vals) <= 1:
        if company_key == "msedcl":
            try:
                import numpy as np
                crop_box = (0, int(h * 0.35), w, int(h * 0.85))
                crop = page_image.crop(crop_box)
                crop_np = np.array(crop)
                if crop_np.ndim == 3:
                    r = crop_np[:, :, 0]
                    g = crop_np[:, :, 1]
                    b = crop_np[:, :, 2]
                    cyan_mask = (b > 120) & (g > 110) & (r < 110) & (b > r + 25)
                    col_heights = np.sum(cyan_mask, axis=0)
                    
                    bars = []
                    in_bar = False
                    start_x = 0
                    for x in range(len(col_heights)):
                        if col_heights[x] >= 5:
                            if not in_bar:
                                in_bar = True
                                start_x = x
                        else:
                            if in_bar:
                                in_bar = False
                                end_x = x
                                bw = end_x - start_x
                                if bw >= 5:
                                    bar_cols = cyan_mask[:, start_x:end_x]
                                    y_indices = np.where(bar_cols)[0]
                                    if len(y_indices) > 0:
                                        top_y = np.min(y_indices)
                                        bottom_y = np.max(y_indices)
                                        height_px = bottom_y - top_y
                                        bars.append({"height_px": int(height_px), "center_x": (start_x + end_x) // 2})
                                        
                    if len(bars) >= 10:
                        max_h = max(b["height_px"] for b in bars)
                        scale = 117.0 / max_h if max_h > 140 else 1.0
                        
                        history = []
                        curr_date = parse_date_locale_independent(bill_date_str) or datetime(2018, 7, 11)
                        months_list = []
                        temp_date = curr_date
                        for i in range(len(bars)):
                            first = temp_date.replace(day=1)
                            prev_month = first - timedelta(days=1)
                            months_list.append(prev_month.strftime("%b-%Y"))
                            temp_date = prev_month
                            
                        for idx, b in enumerate(bars):
                            u_calc = int(round(b["height_px"] * scale))
                            month_name = months_list[idx]
                            amount = calculate_default_tariff("msedcl", u_calc)
                            history.append({
                                "date": month_name,
                                "units": f"{u_calc} KWh",
                                "amount": f"₹{amount}"
                            })
                        return history
            except Exception as mask_err:
                print("[CYAN MASK EXTRACTION] Error:", mask_err)
        return []

    # Interpolate missing values in mapped_units to keep history complete
    for i in range(layout_type):
        if mapped_units[i] is None:
            left_val = None
            left_idx = -1
            for l in range(i - 1, -1, -1):
                if mapped_units[l] is not None:
                    left_val = mapped_units[l]
                    left_idx = l
                    break
            
            right_val = None
            right_idx = -1
            for r in range(i + 1, layout_type):
                if mapped_units[r] is not None:
                    right_val = mapped_units[r]
                    right_idx = r
                    break
                    
            if left_val is not None and right_val is not None:
                mapped_units[i] = int(round(left_val + (right_val - left_val) * (i - left_idx) / (right_idx - left_idx)))
            elif left_val is not None:
                mapped_units[i] = left_val
            elif right_val is not None:
                mapped_units[i] = right_val
            else:
                mapped_units[i] = 50
                
    for idx in range(layout_type):
        units = mapped_units[idx]
        if units and units > 5:
            if layout_type == 6:
                month_name = months_list[layout_type - 1 - idx]
            else:
                month_name = months_list[idx]
            amount = calculate_default_tariff(company_key, units)
            history.append({
                "date": month_name,
                "units": f"{units} KWh",
                "amount": f"₹{amount}"
            })
            
    return history


def merge_history(payment_history, graph_history):
    def get_month_key(date_str):
        if not date_str or not isinstance(date_str, str):
            return None
        m = re.search(r'\b([A-Za-z]{3,9})[-\s,]*(\d{2,4})\b', date_str)
        if m:
            m_name = m.group(1)[:3].lower()
            yr = m.group(2)
            if len(yr) == 2:
                yr = "20" + yr
            return f"{m_name}-{yr}"
        return None

    merged = {}
    
    # 1. Primary history from provider parsers
    if isinstance(payment_history, list):
        for item in payment_history:
            if isinstance(item, dict):
                m_key = get_month_key(item.get("date"))
                if m_key:
                    merged[m_key] = dict(item)
            elif hasattr(item, "__dict__"):
                d = getattr(item, "to_dict", lambda: item.__dict__)()
                m_key = get_month_key(d.get("date"))
                if m_key:
                    merged[m_key] = d
            
    # 2. Supplement missing fields from graph_history without overwriting valid data
    if isinstance(graph_history, list):
        for item in graph_history:
            if isinstance(item, dict):
                m_key = get_month_key(item.get("date"))
                if m_key:
                    if m_key not in merged:
                        merged[m_key] = dict(item)
                    else:
                        if (not merged[m_key].get("amount") or merged[m_key].get("amount") == "—") and item.get("amount") and item.get("amount") != "—":
                            merged[m_key]["amount"] = item["amount"]
                        if (not merged[m_key].get("units") or merged[m_key].get("units") in ["—", "0 KWh", "1 KWh"]) and item.get("units") and item.get("units") not in ["—", "0 KWh", "1 KWh"]:
                            merged[m_key]["units"] = item["units"]

    from datetime import datetime
    def sort_key(item):
        if not isinstance(item, dict):
            return datetime.min
        date_str = str(item.get("date") or "").replace("/", "-").replace(" ", "-").strip()
        if not date_str or date_str == "—":
            return datetime.min
        for fmt in ["%d-%b-%Y", "%b-%Y", "%d-%b-%y", "%Y-%m-%d", "%d-%m-%Y"]:
            try:
                return datetime.strptime(date_str, fmt)
            except (ValueError, TypeError):
                continue
        return datetime.min
        
    return sorted(merged.values(), key=sort_key, reverse=True)


@app.route("/extract", methods=["POST"])
def extract():
    print("Flask /extract hit")
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file provided"}), 400

    try:
        file_bytes = file.read()
        filename = file.filename or "bill.pdf"

        from ocr_pipeline.core.engine import PipelineEngine
        extracted_bill = PipelineEngine.process_file_bytes(file_bytes, filename)
        parsed = extracted_bill.to_legacy_dict()

        # Visual Image Graph Hybrid Enrichment to merge graph history if missing items
        try:
            filename_lower = filename.lower()
            pages = None
            if filename_lower.endswith(".pdf"):
                try:
                    import fitz
                    doc = fitz.open(stream=file_bytes, filetype="pdf")
                    pages = []
                    for page in doc:
                        pix = page.get_pixmap(dpi=300)
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                        pages.append(img)
                except Exception:
                    from pdf2image import convert_from_bytes
                    poppler_paths = [
                        r"C:\Program Files\poppler\bin",
                        r"C:\poppler\bin",
                        os.path.join(os.path.dirname(__file__), "poppler", "bin"),
                    ]
                    poppler_bin = None
                    for p in poppler_paths:
                        if os.path.exists(p):
                            poppler_bin = p
                            break
                    pages = convert_from_bytes(file_bytes, dpi=300, poppler_path=poppler_bin) if poppler_bin else convert_from_bytes(file_bytes, dpi=300)
            elif any(filename_lower.endswith(ext) for ext in [".jpeg", ".jpg", ".png"]):
                pages = [Image.open(io.BytesIO(file_bytes)).convert("RGB")]

            if pages:
                    company_key = "msedcl"
                    c_name = parsed.get("company", {}).get("name", "").lower()
                    if "torrent" in c_name: company_key = "torrent"
                    elif "msedcl" in c_name or "mahavitaran" in c_name or "mahadiscom" in c_name: company_key = "msedcl"
                    elif "tata" in c_name: company_key = "tata"
                    elif "adani" in c_name: company_key = "adani"
                    elif "best" in c_name: company_key = "best"

                    existing = parsed.get("history") or []
                    if not existing or len(existing) == 0:
                        if not (company_key == "tata" and ("cano" in parsed.get("rawText", "").lower() or "delhi" in parsed.get("rawText", "").lower())):
                            graph_hist = extract_graph_history_hybrid(pages[0], bill_date_str, company_key, parsed.get("rawText", ""))
                            if graph_hist:
                                parsed["history"] = merge_history(existing, graph_hist)
        except Exception as graph_err:
            print("[GRAPH ENRICHMENT] Skipped or failed:", graph_err)

        return jsonify(parsed)

    except Exception as e:
        import traceback
        traceback.print_exc()
        print("Extract error:", repr(e))
        return jsonify({"error": "Extraction failed", "detail": str(e)}), 500



users = []  # simple in-memory store for registered users

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.json or {}
    email = data.get("email", "").strip()
    password = data.get("password", "")
    print(f"[AUTH] Login attempt - Email: {repr(email)}, Password: {repr(password)}")
    print(f"[AUTH] Current users store: {repr(users)}")
    # Search in registered users
    for u in users:
        if u["email"].strip().lower() == email.lower() and u["password"] == password:
            token = "demo-token"
            user = {"email": email, "name": f"{u.get('fname', '')} {u.get('lname', '')}".strip()}
            print(f"[AUTH] Login successful for: {email}")
            return jsonify({"token": token, "user": user})
    # fallback to demo credentials for testing
    if email.lower() == "test@example.com" and password == "password":
        token = "demo-token"
        user = {"email": email, "name": "Test User"}
        print("[AUTH] Login successful via fallback demo credentials")
        return jsonify({"token": token, "user": user})
    print("[AUTH] Login failed: invalid credentials")
    return jsonify({"message": "Invalid credentials"}), 401






@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.json or {}
    print(f"[AUTH] Register attempt with data: {repr(data)}")
    required = ["fname", "lname", "email", "password"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        print(f"[AUTH] Register failed: missing fields {missing}")
        return jsonify({"message": f"Missing fields: {', '.join(missing)}"}), 400
    # Simulate user creation and store in memory
    user = {
        "fname": data["fname"].strip(),
        "lname": data["lname"].strip(),
        "email": data["email"].strip(),
        "password": data["password"]
    }
    users.append(user)
    print(f"[AUTH] User registered successfully: {repr(user)}")
    print(f"[AUTH] Current users store now contains {len(users)} users")
    return jsonify({"message": "User registered successfully", "user": {"fname": user["fname"], "lname": user["lname"], "email": user["email"]}}), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
