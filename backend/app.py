from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
import numpy as np
import cv2
import base64
import os
import json
import uuid
from datetime import datetime
import io
from PIL import Image

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# ── Load model ──────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'Oral Cancer Dataset', 'oral_cancer_model.h5')
model = tf.keras.models.load_model(MODEL_PATH)
IMG_SIZE = 224

# ── Simple JSON "database" ───────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'db.json')

def load_db():
    if not os.path.exists(DB_PATH):
        return {"scans": [], "users": {}}
    with open(DB_PATH, 'r') as f:
        return json.load(f)

def save_db(data):
    with open(DB_PATH, 'w') as f:
        json.dump(data, f, indent=2)

# ── Image preprocessing ──────────────────────────────────────────────────────
def preprocess_image(img_array):
    """Accept numpy array (H, W, 3) in RGB, return model-ready array."""
    img = cv2.resize(img_array, (IMG_SIZE, IMG_SIZE))
    img = img.astype('float32') / 255.0
    img = np.expand_dims(img, axis=0)
    return img

def predict(img_array):
    processed = preprocess_image(img_array)

    raw = float(model.predict(processed, verbose=0)[0][0])

    if raw > 0.5:
        label      = "Suspicious"
        confidence = raw
        risk       = "High" if raw > 0.75 else "Medium"
    else:
        label      = "Normal"
        confidence = 1.0 - raw
        risk       = "Low"

    return {
        "label":      label,
        "confidence": round(float(confidence) * 100.0, 1),
        "risk":       risk,
        "raw":        round(float(raw), 4)
    }

# ── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('../frontend', path)

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model": "oral_cancer_model.h5", "version": "1.0"})

@app.route('/api/predict/upload', methods=['POST'])
def predict_upload():
    """Accept an uploaded image file and return prediction."""
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']
    img_bytes = file.read()
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    result = predict(img_rgb)
    result["scan_id"] = str(uuid.uuid4())[:8].upper()
    result["timestamp"] = datetime.now().isoformat()
    result["method"] = "upload"

    # Persist result
    patient_name = request.form.get('patient_name', 'Anonymous')
    patient_age  = request.form.get('patient_age', 'N/A')
    patient_id   = request.form.get('patient_id', str(uuid.uuid4())[:8].upper())

    db = load_db()
    db["scans"].append({
        "scan_id":      result["scan_id"],
        "patient_id":   patient_id,
        "patient_name": patient_name,
        "patient_age":  patient_age,
        "label":        result["label"],
        "confidence":   result["confidence"],
        "risk":         result["risk"],
        "raw":          result["raw"],
        "method":       result["method"],
        "timestamp":    result["timestamp"]
    })
    save_db(db)
    return jsonify(result)

@app.route('/api/predict/base64', methods=['POST'])
def predict_base64():
    """Accept a base64-encoded image (from live camera) and return prediction."""
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"error": "No image data"}), 400

    img_data = data['image']
    if ',' in img_data:
        img_data = img_data.split(',')[1]

    img_bytes = base64.b64decode(img_data)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    result = predict(img_rgb)
    result["scan_id"]   = str(uuid.uuid4())[:8].upper()
    result["timestamp"] = datetime.now().isoformat()
    result["method"]    = "camera"

    patient_name = data.get('patient_name', 'Anonymous')
    patient_age  = data.get('patient_age', 'N/A')
    patient_id   = data.get('patient_id',  str(uuid.uuid4())[:8].upper())

    db = load_db()
    db["scans"].append({
        "scan_id":      result["scan_id"],
        "patient_id":   patient_id,
        "patient_name": patient_name,
        "patient_age":  patient_age,
        "label":        result["label"],
        "confidence":   result["confidence"],
        "risk":         result["risk"],
        "raw":          result["raw"],
        "method":       result["method"],
        "timestamp":    result["timestamp"]
    })
    save_db(db)
    return jsonify(result)

@app.route('/api/scans', methods=['GET'])
def get_scans():
    """Return all scan results (dashboard data)."""
    db = load_db()
    scans = db.get("scans", [])
    # Sort newest first
    scans = sorted(scans, key=lambda x: x["timestamp"], reverse=True)

    total      = len(scans)
    suspicious = sum(1 for s in scans if s["label"] == "Suspicious")
    normal_ct  = total - suspicious

    return jsonify({
        "scans":   scans,
        "summary": {
            "total":      total,
            "suspicious": suspicious,
            "normal":     normal_ct,
            "risk_rate":  round(float(suspicious) / float(total) * 100.0, 1) if total else 0.0
        }
    })

@app.route('/api/scans/<scan_id>', methods=['GET'])
def get_scan(scan_id):
    db = load_db()
    for s in db.get("scans", []):
        if s["scan_id"] == scan_id:
            return jsonify(s)
    return jsonify({"error": "Scan not found"}), 404

@app.route('/api/scans', methods=['DELETE'])
def clear_scans():
    db = load_db()
    db["scans"] = []
    save_db(db)
    return jsonify({"message": "All scans cleared"})

if __name__ == '__main__':
    print("🦷 Oral Cancer Screening API starting...")
    print(f"   Model: {MODEL_PATH}")
    app.run(debug=True, host='0.0.0.0', port=5000)
