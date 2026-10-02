"""
Preprocessing, exploratory statistics, and education-band model comparison.

Public API
----------
public_career_analytics()  → full analytics payload (EDA, models, feature importance, confusion matrices)
predict_education_band(soc_code) → per-model prediction with probabilities
"""

from __future__ import annotations

import csv
import os
import re
from collections import Counter, defaultdict
from functools import lru_cache, wraps
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.base import clone
from sklearn.dummy import DummyClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

EDUCATION_BANDS = {
    "Secondary / certificate": {"1", "2", "3"},
    "Undergraduate": {"4", "5", "6"},
    "Graduate / professional": {"7", "8", "9"},
    "Advanced professional": {"10", "11", "12"},
}
BAND_ORDER = list(EDUCATION_BANDS)
SEED = 42
_ANALYTICS_CACHE_LOCK = Lock()


# ── Cache helper ──────────────────────────────────────────────────────────────

def _single_flight_cache(function):
    cached = lru_cache(maxsize=1)(function)

    @wraps(function)
    def wrapped(*args, **kwargs):
        with _ANALYTICS_CACHE_LOCK:
            return cached(*args, **kwargs)

    return wrapped


# ── File helpers ──────────────────────────────────────────────────────────────

def _data_dir() -> Path:
    configured = os.getenv("CAREER_DATA_DIR")
    if configured:
        path = Path(configured).expanduser()
        if not path.is_absolute():
            path = Path(__file__).resolve().parents[1] / path
        return path.resolve()
    return Path(__file__).resolve().parents[2] / "career_projects"


def _read_csv(folder: Path, name: str) -> list[dict[str, str]]:
    file_path = folder / name
    if not file_path.is_file():
        raise FileNotFoundError(f"Required career data file not found: {file_path}")
    with file_path.open("r", encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def _number(value: Any) -> float | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        result = float(value)
        return result if np.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


# ── Education target derivation ───────────────────────────────────────────────

def _education_targets(rows: list[dict[str, str]]) -> dict[str, str]:
    by_occupation: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for row in rows:
        if row.get("Scale ID") != "RL" or row.get("Recommend Suppress") == "Y":
            continue
        code = row.get("O*NET-SOC Code", "")
        category = row.get("Category", "")
        value = _number(row.get("Data Value"))
        band = next((name for name, categories in EDUCATION_BANDS.items() if category in categories), None)
        if not code or band is None or value is None or value <= 0:
            continue
        by_occupation[code][band] += value

    labels = {
        code: max(BAND_ORDER, key=lambda band: (values.get(band, 0.0), -BAND_ORDER.index(band)))
        for code, values in by_occupation.items()
        if sum(values.values()) > 0
    }
    return labels


# ── Feature engineering ───────────────────────────────────────────────────────

def _feature_rows(
    occupations: list[dict[str, str]],
    skill_rows: list[dict[str, str]],
    software_rows: list[dict[str, str]],
    labels: dict[str, str],
    vocabulary_codes: set[str],
) -> tuple[list[dict[str, Any]], list[str], dict[str, dict[str, Any]]]:
    by_skill: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    skill_importance: Counter[str] = Counter()
    for row in skill_rows:
        code = row.get("O*NET-SOC Code", "")
        name = row.get("Element Name", "").strip()
        scale = row.get("Scale ID", "")
        value = _number(row.get("Data Value"))
        if not code or not name or scale not in {"IM", "LV"} or value is None:
            continue
        if row.get("Not Relevant") == "Y" or row.get("Recommend Suppress") == "Y":
            continue
        by_skill[code][name][scale] = value
        if scale == "IM" and code in vocabulary_codes:
            skill_importance[name] += value

    tool_counts: Counter[str] = Counter()
    software_by_occupation: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"count": 0, "hot": 0, "inDemand": 0, "tools": set()}
    )
    for row in software_rows:
        code = row.get("O*NET-SOC Code", "")
        name = row.get("Workplace Example", "").strip()
        if not code or not name:
            continue
        item = software_by_occupation[code]
        item["count"] += 1
        item["hot"] += row.get("Hot Technology") == "Y"
        item["inDemand"] += row.get("In Demand") == "Y"
        item["tools"].add(name)
        if code in vocabulary_codes:
            tool_counts[name] += 1

    skill_names = sorted(skill_importance)
    tool_names = [name for name, _ in tool_counts.most_common(25)]
    feature_names = [f"importance_{_slug(name)}" for name in skill_names]
    feature_names += [f"level_{_slug(name)}" for name in skill_names]
    feature_names += [f"tool_{_slug(name)}" for name in tool_names]
    feature_names += [
        "skill_count", "mean_importance", "mean_level",
        "software_count", "hot_technology_count", "in_demand_software_count",
    ]

    rows: list[dict[str, Any]] = []
    by_code: dict[str, dict[str, Any]] = {}

    for occupation in occupations:
        code = occupation.get("O*NET-SOC Code", "")
        if code not in labels:
            continue
        skills = by_skill.get(code, {})
        software = software_by_occupation.get(code, {"count": 0, "hot": 0, "inDemand": 0, "tools": set()})
        importance_values = [skill.get("IM") for skill in skills.values() if skill.get("IM") is not None]
        level_values = [skill.get("LV") for skill in skills.values() if skill.get("LV") is not None]
        values: list[float] = []
        importance_by_name: dict[str, float | None] = {}
        level_by_name: dict[str, float | None] = {}
        for name in skill_names:
            value = skills.get(name, {}).get("IM")
            values.append(value or 0.0)
            importance_by_name[name] = value
        for name in skill_names:
            value = skills.get(name, {}).get("LV")
            values.append(value or 0.0)
            level_by_name[name] = value
        values.extend(1.0 if name in software["tools"] else 0.0 for name in tool_names)
        values.extend([
            float(len(skills)),
            float(np.mean(importance_values)) if importance_values else 0.0,
            float(np.mean(level_values)) if level_values else 0.0,
            float(software["count"]),
            float(software["hot"]),
            float(software["inDemand"]),
        ])
        rows.append({"socCode": code, "title": occupation.get("Title", ""), "values": values})
        by_code[code] = {
            "socCode": code,
            "title": occupation.get("Title", ""),
            "description": occupation.get("Description", ""),
            "essentialSkills": [
                {"name": name, "importance": importance_by_name[name], "level": level_by_name[name]}
                for name in skills
            ],
            "softwareCount": int(software["count"]),
            "hotTechnologyCount": int(software["hot"]),
            "inDemandSoftwareCount": int(software["inDemand"]),
            "educationBand": labels[code],
        }

    return rows, feature_names, by_code


# ── Model factory ─────────────────────────────────────────────────────────────

def _make_models() -> dict[str, Any]:
    return {
        "Random Forest": RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=2,
            max_features="sqrt",
            class_weight="balanced_subsample",
            random_state=SEED,
            n_jobs=-1,
        ),
        "Gradient Boosting": HistGradientBoostingClassifier(
            max_iter=160,
            learning_rate=0.08,
            max_leaf_nodes=15,
            l2_regularization=1.0,
            random_state=SEED,
        ),
    }


# ── EDA helpers ───────────────────────────────────────────────────────────────

def _wrangling_stats(
    occupation_rows: list[dict[str, str]],
    skill_rows: list[dict[str, str]],
    software_rows: list[dict[str, str]],
    education_rows: list[dict[str, str]],
    labels: dict[str, str],
) -> dict[str, Any]:
    """Compute data-wrangling / preprocessing summary statistics."""
    total_occ = len(occupation_rows)
    labeled = len(labels)

    # Missing-value counts per file
    occ_missing_title = sum(1 for r in occupation_rows if not r.get("Title", "").strip())
    occ_missing_desc  = sum(1 for r in occupation_rows if not r.get("Description", "").strip())

    skill_suppressed  = sum(
        1 for r in skill_rows
        if r.get("Recommend Suppress") == "Y" or r.get("Not Relevant") == "Y"
    )
    skill_missing_val = sum(1 for r in skill_rows if _number(r.get("Data Value")) is None)

    edu_suppressed    = sum(1 for r in education_rows if r.get("Recommend Suppress") == "Y")
    edu_non_rl        = sum(1 for r in education_rows if r.get("Scale ID") != "RL")

    sw_missing_tool   = sum(1 for r in software_rows if not r.get("Workplace Example", "").strip())

    # Skill scale distribution
    im_vals = [_number(r.get("Data Value")) for r in skill_rows
               if r.get("Scale ID") == "IM" and _number(r.get("Data Value")) is not None
               and r.get("Not Relevant") != "Y" and r.get("Recommend Suppress") != "Y"]
    lv_vals = [_number(r.get("Data Value")) for r in skill_rows
               if r.get("Scale ID") == "LV" and _number(r.get("Data Value")) is not None
               and r.get("Not Relevant") != "Y" and r.get("Recommend Suppress") != "Y"]

    def _stats(vals: list[float]) -> dict[str, float]:
        if not vals:
            return {"min": 0, "max": 0, "mean": 0, "median": 0, "std": 0}
        a = np.asarray(vals, dtype=np.float64)
        return {
            "min":    round(float(a.min()), 3),
            "max":    round(float(a.max()), 3),
            "mean":   round(float(a.mean()), 3),
            "median": round(float(np.median(a)), 3),
            "std":    round(float(a.std()), 3),
        }

    return {
        "totalOccupationRows":       total_occ,
        "labeledOccupations":        labeled,
        "excludedNoEducationLabel":  total_occ - labeled,
        "occupationMissingTitle":    occ_missing_title,
        "occupationMissingDesc":     occ_missing_desc,
        "skillRowsSuppressedOrIrrelevant": skill_suppressed,
        "skillRowsMissingValue":     skill_missing_val,
        "skillRowsRetained":         len(skill_rows) - skill_suppressed - skill_missing_val,
        "educationRowsSuppressed":   edu_suppressed,
        "educationRowsNonRL":        edu_non_rl,
        "softwareRowsMissingTool":   sw_missing_tool,
        "importanceStats":           _stats(im_vals),
        "levelStats":                _stats(lv_vals),
        "steps": [
            "Loaded 5 CSV files: occupation_data, essential_skills, software_skills, education, related_occupations.",
            f"Removed {skill_suppressed:,} suppressed / irrelevant skill rows and {skill_missing_val:,} rows with missing numeric values.",
            f"Excluded {edu_suppressed:,} suppressed education rows; kept only Scale ID = 'RL' ({edu_non_rl:,} non-RL rows dropped).",
            f"Derived education bands by summing reported RL percentages per occupation into 4 broad bands.",
            f"{total_occ - labeled:,} occupations had no usable education label and were excluded from supervised learning.",
            "Built skill vocabulary from training occupations only (importance IM + level LV encoded).",
            "Selected top-25 software tools by training-set frequency; one-hot encoded per occupation.",
            "Added 6 aggregate features: skill count, mean importance, mean level, software count, hot-tech count, in-demand count.",
            "Applied stratified 80/20 holdout split (fixed seed=42); 5-fold cross-validation uses training data only.",
            "Refit serving models on the full labeled cohort after holdout evaluation.",
        ],
    }


def _eda_payload(
    feature_rows: list[dict[str, Any]],
    feature_names: list[str],
    labels: dict[str, str],
    skill_rows: list[dict[str, str]],
) -> dict[str, Any]:
    """
    Compute EDA data:
      - scatter: mean_importance vs mean_level per occupation (coloured by band)
      - correlationMatrix: top 8 numeric features pairwise Pearson r
      - outliers: IQR-based outlier counts per band
      - skillImportanceByBand: mean importance of top 5 skills broken out by band
    """
    # Index feature positions
    idx_mean_importance = feature_names.index("mean_importance") if "mean_importance" in feature_names else None
    idx_mean_level      = feature_names.index("mean_level")      if "mean_level"      in feature_names else None
    idx_sw_count        = feature_names.index("software_count")  if "software_count"  in feature_names else None
    idx_hot_count       = feature_names.index("hot_technology_count") if "hot_technology_count" in feature_names else None
    idx_skill_count     = feature_names.index("skill_count")     if "skill_count"     in feature_names else None

    # ── Scatter: mean_importance vs mean_level, coloured by band ──────────────
    scatter_points = []
    for row in feature_rows:
        code = row["socCode"]
        band = labels.get(code, "")
        vals = row["values"]
        mi = float(vals[idx_mean_importance]) if idx_mean_importance is not None else 0.0
        ml = float(vals[idx_mean_level])      if idx_mean_level      is not None else 0.0
        sw = float(vals[idx_sw_count])        if idx_sw_count        is not None else 0.0
        scatter_points.append({
            "title":         row["title"],
            "band":          band,
            "meanImportance": round(mi, 3),
            "meanLevel":      round(ml, 3),
            "softwareCount":  int(sw),
        })
    # Downsample to ≤ 200 points for frontend performance
    rng = np.random.default_rng(42)
    if len(scatter_points) > 200:
        idx = rng.choice(len(scatter_points), 200, replace=False)
        scatter_points = [scatter_points[i] for i in sorted(idx)]

    # ── Correlation matrix for 8 aggregate / numeric features ─────────────────
    agg_feature_names = [
        "mean_importance", "mean_level", "skill_count",
        "software_count", "hot_technology_count", "in_demand_software_count",
    ]
    agg_indices = [feature_names.index(n) for n in agg_feature_names if n in feature_names]
    used_names  = [feature_names[i] for i in agg_indices]
    matrix_data = np.array([[row["values"][i] for i in agg_indices] for row in feature_rows], dtype=np.float64)
    if matrix_data.shape[0] > 1 and matrix_data.shape[1] > 1:
        corr = np.corrcoef(matrix_data, rowvar=False)
    else:
        corr = np.eye(len(agg_indices))
    corr_matrix = []
    for i, name_a in enumerate(used_names):
        for j, name_b in enumerate(used_names):
            corr_matrix.append({
                "x": _readable_feature(name_a),
                "y": _readable_feature(name_b),
                "r": round(float(corr[i, j]), 3),
            })

    # ── Outlier detection (IQR) on mean_importance per band ───────────────────
    by_band: dict[str, list[float]] = defaultdict(list)
    for row in feature_rows:
        if idx_mean_importance is None:
            break
        band = labels.get(row["socCode"], "")
        by_band[band].append(float(row["values"][idx_mean_importance]))

    outlier_summary = []
    box_data = []
    for band in BAND_ORDER:
        vals = np.asarray(by_band.get(band, []), dtype=np.float64)
        if len(vals) < 4:
            continue
        q1, q3 = np.percentile(vals, [25, 75])
        iqr = q3 - q1
        lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        n_outliers = int(np.sum((vals < lower) | (vals > upper)))
        outlier_summary.append({"band": band, "outlierCount": n_outliers, "total": len(vals)})
        box_data.append({
            "band":   band,
            "min":    round(float(vals.min()), 3),
            "q1":     round(float(q1), 3),
            "median": round(float(np.median(vals)), 3),
            "q3":     round(float(q3), 3),
            "max":    round(float(vals.max()), 3),
            "mean":   round(float(vals.mean()), 3),
            "outlierCount": n_outliers,
        })

    # ── Skill importance broken out by band (top 6 skills) ────────────────────
    # Collect importance values per skill per band
    skill_importance_by_band: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in skill_rows:
        if row.get("Scale ID") != "IM":
            continue
        if row.get("Not Relevant") == "Y" or row.get("Recommend Suppress") == "Y":
            continue
        code  = row.get("O*NET-SOC Code", "")
        name  = row.get("Element Name", "").strip()
        value = _number(row.get("Data Value"))
        band  = labels.get(code)
        if not name or value is None or band is None:
            continue
        skill_importance_by_band[band][name].append(value)

    # Pick top 6 skills by global mean importance
    global_means: dict[str, float] = {}
    for band_skills in skill_importance_by_band.values():
        for skill, vals in band_skills.items():
            global_means[skill] = global_means.get(skill, 0) + float(np.mean(vals))
    top6_skills = sorted(global_means, key=global_means.get, reverse=True)[:6]  # type: ignore[arg-type]

    skill_by_band_chart = []
    for skill in top6_skills:
        entry: dict[str, Any] = {"skill": skill}
        for band in BAND_ORDER:
            vals = skill_importance_by_band[band].get(skill, [])
            entry[band] = round(float(np.mean(vals)), 3) if vals else 0.0
        skill_by_band_chart.append(entry)

    # ── Software count distribution (histogram buckets 0-2, 3-5, 6-10, 11+) ──
    sw_buckets = {"0-2": 0, "3-5": 0, "6-10": 0, "11+": 0}
    if idx_sw_count is not None:
        for row in feature_rows:
            n = int(row["values"][idx_sw_count])
            if n <= 2:
                sw_buckets["0-2"] += 1
            elif n <= 5:
                sw_buckets["3-5"] += 1
            elif n <= 10:
                sw_buckets["6-10"] += 1
            else:
                sw_buckets["11+"] += 1
    software_histogram = [{"range": k, "count": v} for k, v in sw_buckets.items()]

    return {
        "scatter":            scatter_points,
        "correlationMatrix":  corr_matrix,
        "correlationFeatures": [_readable_feature(n) for n in used_names],
        "boxPlot":            box_data,
        "outlierSummary":     outlier_summary,
        "skillByBand":        skill_by_band_chart,
        "topSkillsForBand":   top6_skills,
        "softwareHistogram":  software_histogram,
    }


def _readable_feature(name: str) -> str:
    """Convert snake_case feature name to a short human-readable label."""
    mapping = {
        "mean_importance":          "Mean Importance",
        "mean_level":               "Mean Level",
        "skill_count":              "Skill Count",
        "software_count":           "Software Count",
        "hot_technology_count":     "Hot Tech Count",
        "in_demand_software_count": "In-Demand SW",
    }
    return mapping.get(name, name.replace("_", " ").title())


# ── ML analytics helpers ──────────────────────────────────────────────────────

def _confusion_matrix_payload(y_true: np.ndarray, y_pred: np.ndarray) -> list[dict[str, Any]]:
    """Return confusion matrix as a flat list of {actual, predicted, count} dicts."""
    cm = confusion_matrix(y_true, y_pred, labels=BAND_ORDER)
    result = []
    for i, actual in enumerate(BAND_ORDER):
        for j, predicted in enumerate(BAND_ORDER):
            result.append({"actual": actual, "predicted": predicted, "count": int(cm[i, j])})
    return result


def _feature_importance_payload(
    model: Any,
    feature_names: list[str],
    top_n: int = 15,
    X_val: np.ndarray | None = None,
    y_val: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """
    Extract top-N feature importances.
    - RandomForest: uses built-in Gini importances (fast).
    - HistGradientBoosting: uses permutation importance on the validation set
      (n_repeats=5, scoring='accuracy') since it has no built-in attribute.
    - DummyClassifier / others: returns empty list.
    """
    importances = getattr(model, "feature_importances_", None)

    if importances is None:
        # Try permutation importance if we have validation data
        if X_val is None or y_val is None:
            return []
        try:
            result = permutation_importance(
                model, X_val, y_val,
                n_repeats=5, random_state=SEED, scoring="accuracy", n_jobs=1,
            )
            importances = result.importances_mean
        except Exception:
            return []

    pairs = sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)
    # Filter out zero / negative (can happen with permutation importance)
    pairs = [(n, v) for n, v in pairs if v > 0]
    total = sum(imp for _, imp in pairs) or 1.0
    result = []
    for name, imp in pairs[:top_n]:
        result.append({
            "feature":    name,
            "label":      _readable_feature(name),
            "importance": round(float(imp), 5),
            "percent":    round(float(imp / total * 100), 2),
        })
    return result


# ── Main cached computation ───────────────────────────────────────────────────

@_single_flight_cache
def get_career_analytics() -> dict[str, Any]:
    folder = _data_dir()
    occupation_rows = _read_csv(folder, "occupation_data.csv")
    skill_rows      = _read_csv(folder, "essential_skills.csv")
    software_rows   = _read_csv(folder, "software_skills.csv")
    education_rows  = _read_csv(folder, "education.csv")
    related_rows    = _read_csv(folder, "related_occupations.csv")

    labels = _education_targets(education_rows)

    labeled_codes = np.asarray(
        sorted({row.get("O*NET-SOC Code", "") for row in occupation_rows if row.get("O*NET-SOC Code") in labels}),
        dtype=object,
    )
    if len(labeled_codes) < 40:
        raise ValueError("Not enough labeled occupations to train and validate the models")

    codes_train, codes_test = train_test_split(
        labeled_codes,
        test_size=0.2,
        random_state=SEED,
        stratify=np.asarray([labels[code] for code in labeled_codes], dtype=object),
    )

    rows, feature_names, occupations_by_code = _feature_rows(
        occupation_rows, skill_rows, software_rows, labels, set(codes_train)
    )
    features_by_code = {row["socCode"]: row["values"] for row in rows}

    X_train = np.asarray([features_by_code[code] for code in codes_train], dtype=np.float32)
    y_train = np.asarray([labels[code] for code in codes_train], dtype=object)
    X_test  = np.asarray([features_by_code[code] for code in codes_test],  dtype=np.float32)
    y_test  = np.asarray([labels[code] for code in codes_test],  dtype=object)
    X_all   = np.asarray([features_by_code[code] for code in labeled_codes], dtype=np.float32)
    y_all   = np.asarray([labels[code] for code in labeled_codes], dtype=object)

    # ── Train, evaluate, and collect ML metrics ───────────────────────────────
    serving_models: dict[str, Any] = {}
    comparison = []
    confusion_matrices: dict[str, list[dict[str, Any]]] = {}
    feature_importances: dict[str, list[dict[str, Any]]] = {}

    for name, model in _make_models().items():
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
        cv_scores = cross_val_score(model, X_train, y_train, cv=cv, scoring="f1_macro", n_jobs=1)
        model.fit(X_train, y_train)
        prediction = model.predict(X_test)

        report = classification_report(
            y_test, prediction, labels=BAND_ORDER, output_dict=True, zero_division=0
        )
        comparison.append({
            "name":                     name,
            "accuracy":                 round(float(accuracy_score(y_test, prediction)), 4),
            "balancedAccuracy":         round(float(balanced_accuracy_score(y_test, prediction)), 4),
            "macroF1":                  round(float(f1_score(y_test, prediction, average="macro", zero_division=0)), 4),
            "crossValidationMacroF1":   round(float(cv_scores.mean()), 4),
            "crossValidationStd":       round(float(cv_scores.std()), 4),
            "testRecords":              int(len(y_test)),
            "perBand": [
                {
                    "label":     band,
                    "precision": round(float(report[band]["precision"]), 4),
                    "recall":    round(float(report[band]["recall"]), 4),
                    "f1":        round(float(report[band]["f1-score"]), 4),
                    "support":   int(report[band]["support"]),
                }
                for band in BAND_ORDER
            ],
        })

        confusion_matrices[name]  = _confusion_matrix_payload(y_test, prediction)
        feature_importances[name] = _feature_importance_payload(model, feature_names, X_val=X_test, y_val=y_test)

        serving_model = clone(model).fit(X_all, y_all)
        serving_models[name] = serving_model

    # Majority baseline
    baseline = DummyClassifier(strategy="most_frequent")
    baseline.fit(X_train, y_train)
    baseline_prediction = baseline.predict(X_test)
    baseline_cv = cross_val_score(
        DummyClassifier(strategy="most_frequent"),
        X_train, y_train,
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED),
        scoring="f1_macro",
    )
    baseline_report = classification_report(
        y_test, baseline_prediction, labels=BAND_ORDER, output_dict=True, zero_division=0
    )
    comparison.append({
        "name":                     "Majority baseline",
        "accuracy":                 round(float(accuracy_score(y_test, baseline_prediction)), 4),
        "balancedAccuracy":         round(float(balanced_accuracy_score(y_test, baseline_prediction)), 4),
        "macroF1":                  round(float(f1_score(y_test, baseline_prediction, average="macro", zero_division=0)), 4),
        "crossValidationMacroF1":   round(float(baseline_cv.mean()), 4),
        "crossValidationStd":       round(float(baseline_cv.std()), 4),
        "testRecords":              int(len(y_test)),
        "perBand": [
            {
                "label":     band,
                "precision": round(float(baseline_report[band]["precision"]), 4),
                "recall":    round(float(baseline_report[band]["recall"]), 4),
                "f1":        round(float(baseline_report[band]["f1-score"]), 4),
                "support":   int(baseline_report[band]["support"]),
            }
            for band in BAND_ORDER
        ],
    })
    confusion_matrices["Majority baseline"] = _confusion_matrix_payload(y_test, baseline_prediction)

    # ── Aggregate EDA stats ───────────────────────────────────────────────────
    education_counts = Counter(labels.values())
    aggregated_skills = _skills_by_occupation(skill_rows)

    top_skills = []
    all_skill_names = sorted({row.get("Element Name", "").strip() for row in skill_rows if row.get("Element Name")})
    for name in all_skill_names:
        values = [
            skills[name]["IM"]
            for code, skills in aggregated_skills.items()
            if code in labels and name in skills and skills[name].get("IM") is not None
        ]
        if values:
            top_skills.append({
                "name":           name,
                "meanImportance": round(float(np.mean(values)), 2),
                "occupationCount": len(values),
            })
    top_skills.sort(key=lambda item: item["meanImportance"], reverse=True)

    software_counts  = Counter()
    hot_counts       = Counter()
    in_demand_counts = Counter()
    for row in software_rows:
        tool = row.get("Workplace Example", "").strip()
        if not tool:
            continue
        software_counts[tool] += 1
        if row.get("Hot Technology") == "Y":
            hot_counts[tool] += 1
        if row.get("In Demand") == "Y":
            in_demand_counts[tool] += 1

    test_occupation_count = len(occupation_rows)
    labeled_count         = len(rows)

    # ── Extended EDA + wrangling payloads ─────────────────────────────────────
    wrangling = _wrangling_stats(occupation_rows, skill_rows, software_rows, education_rows, labels)
    eda       = _eda_payload(rows, feature_names, labels, skill_rows)

    return {
        # ── Existing keys (kept for backwards compat) ─────────────────────────
        "dataset": {
            "occupationRecords":        test_occupation_count,
            "labeledRecords":           labeled_count,
            "excludedMissingEducation": test_occupation_count - labeled_count,
            "skillSourceRows":          len(skill_rows),
            "softwareSourceRows":       len(software_rows),
            "educationSourceRows":      len(education_rows),
            "relatedOccupationRows":    len(related_rows),
            "featureCount":             len(feature_names),
            "trainRecords":             int(len(y_train)),
            "testRecords":              int(len(y_test)),
        },
        "educationDistribution": [
            {
                "label":   label,
                "count":   education_counts.get(label, 0),
                "percent": round(education_counts.get(label, 0) / labeled_count * 100, 1),
            }
            for label in BAND_ORDER
        ],
        "topSkills":   top_skills[:10],
        "topSoftware": [
            {
                "name":            name,
                "occupationCount": count,
                "hotCount":        hot_counts[name],
                "inDemandCount":   in_demand_counts[name],
            }
            for name, count in software_counts.most_common(10)
        ],
        "models": comparison,
        "preprocessing": wrangling["steps"],
        "targetDefinition": (
            "The education band with the largest summed reported required-level percentage for an occupation. "
            "Predictions describe occupation-level reference data, not an individual's required credentials."
        ),
        "occupations": [
            {"socCode": item["socCode"], "title": item["title"]}
            for item in occupations_by_code.values()
        ],
        # ── New extended keys ─────────────────────────────────────────────────
        "wrangling":          wrangling,
        "eda":                eda,
        "confusionMatrices":  confusion_matrices,
        "featureImportances": feature_importances,
        # ── Private (serving) keys ────────────────────────────────────────────
        "_models":     serving_models,
        "_features":   features_by_code,
        "_occupations": occupations_by_code,
    }


def _skills_by_occupation(skill_rows: list[dict[str, str]]) -> dict[str, dict[str, dict[str, float]]]:
    result: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    for row in skill_rows:
        code  = row.get("O*NET-SOC Code", "")
        name  = row.get("Element Name", "").strip()
        scale = row.get("Scale ID", "")
        value = _number(row.get("Data Value"))
        if (code and name and scale == "IM" and value is not None
                and row.get("Not Relevant") != "Y"
                and row.get("Recommend Suppress") != "Y"):
            result[code][name]["IM"] = value
    return result


# ── Public surface ────────────────────────────────────────────────────────────

def public_career_analytics() -> dict[str, Any]:
    result = get_career_analytics()
    return {key: value for key, value in result.items() if not key.startswith("_")}


def predict_education_band(soc_code: str) -> dict[str, Any]:
    result = get_career_analytics()
    occupation = result["_occupations"].get(soc_code)
    if occupation is None:
        raise KeyError(soc_code)
    vector = np.asarray([result["_features"][soc_code]], dtype=np.float32)
    predictions = []
    for name, model in result["_models"].items():
        probabilities = model.predict_proba(vector)[0]
        classes = model.classes_
        class_probabilities = sorted(
            [
                {"label": str(label), "probability": round(float(probability) * 100, 1)}
                for label, probability in zip(classes, probabilities)
            ],
            key=lambda item: item["probability"],
            reverse=True,
        )
        predictions.append({
            "model":       name,
            "prediction":  str(model.predict(vector)[0]),
            "confidence":  class_probabilities[0]["probability"],
            "probabilities": class_probabilities,
        })
    return {
        "occupation": {
            key: occupation[key]
            for key in ("socCode", "title", "description", "essentialSkills",
                        "softwareCount", "hotTechnologyCount", "inDemandSoftwareCount")
        },
        "observedEducationBand": occupation["educationBand"],
        "predictions":           predictions,
        "note": (
            "This is a model estimate from occupation-level reference patterns, "
            "not individual career or education advice."
        ),
    }
