from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
import numpy as np
import cv2
import base64
import os
import json
import uuid
from datetime import datetime, timedelta
import io
from PIL import Image
import jwt
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# ── Load model ──────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), 'oral_cancer_model.h5')
model = tf.keras.models.load_model(MODEL_PATH)
IMG_SIZE = 224

# ── MongoDB Database ─────────────────────────────────────────────────────────
from pymongo import MongoClient

# Initialize MongoDB connection
import os
mongo_uri = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/')
client = MongoClient(mongo_uri)
db = client['oral_cancer_db']
scans_collection = db['scans']
users_collection = db['users']

app.config['SECRET_KEY'] = 'oralscan_super_secret_key_123'

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

# ── Auth Middleware & Routes ─────────────────────────────────────────────────
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            parts = request.headers['Authorization'].split()
            if len(parts) == 2 and parts[0] == 'Bearer':
                token = parts[1]
        
        if not token:
            return jsonify({'error': 'Token is missing!'}), 401
            
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = users_collection.find_one({'_id': data['user_id']})
            if not current_user:
                raise Exception("User not found")
        except:
            return jsonify({'error': 'Token is invalid!'}), 401
            
        return f(current_user, *args, **kwargs)
    return decorated

@app.route('/api/auth/signup', methods=['POST'])
def signup():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password') or not data.get('name'):
        return jsonify({'error': 'Missing required fields'}), 400
        
    if users_collection.find_one({'email': data['email']}):
        return jsonify({'error': 'User already exists'}), 400
        
    hashed_password = generate_password_hash(data['password'])
    user_id = str(uuid.uuid4())
    
    users_collection.insert_one({
        '_id': user_id,
        'name': data['name'],
        'email': data['email'],
        'password': hashed_password
    })
    
    return jsonify({'message': 'User created successfully', 'user_id': user_id, 'name': data['name']}), 201

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400
        
    user = users_collection.find_one({'email': data['email']})
    if not user or not check_password_hash(user['password'], data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401
        
    token = jwt.encode({
        'user_id': user['_id'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }, app.config['SECRET_KEY'], algorithm="HS256")
    
    return jsonify({'token': token, 'name': user['name']}), 200

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
@token_required
def predict_upload(current_user):
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

    scans_collection.insert_one({
        "user_id":      current_user['_id'],
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
    return jsonify(result)

@app.route('/api/predict/base64', methods=['POST'])
@token_required
def predict_base64(current_user):
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

    scans_collection.insert_one({
        "user_id":      current_user['_id'],
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
    return jsonify(result)

@app.route('/api/scans', methods=['GET'])
@token_required
def get_scans(current_user):
    """Return all scan results (dashboard data)."""
    # Fetch all scans, excluding the MongoDB _id field, sorted by timestamp descending
    scans = list(scans_collection.find({'user_id': current_user['_id']}, {'_id': 0, 'user_id': 0}).sort("timestamp", -1))

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
@token_required
def get_scan(current_user, scan_id):
    scan = scans_collection.find_one({"scan_id": scan_id, "user_id": current_user['_id']}, {'_id': 0, 'user_id': 0})
    if scan:
        return jsonify(scan)
    return jsonify({"error": "Scan not found"}), 404

@app.route('/api/scans', methods=['DELETE'])
@token_required
def clear_scans(current_user):
    scans_collection.delete_many({"user_id": current_user['_id']})
    return jsonify({"message": "All scans for the current user cleared"})

if __name__ == '__main__':
    print("🦷 Oral Cancer Screening API starting...")
    print(f"   Model: {MODEL_PATH}")
    app.run(debug=True, host='0.0.0.0', port=5000)
