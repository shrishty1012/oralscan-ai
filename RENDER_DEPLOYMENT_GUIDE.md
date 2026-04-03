# Complete Guide to Deploying OralScan on Render (Free Tier)

Here is a detailed, step-by-step guide to deploying your entire project—frontend, backend, AI model, and database—on the web for free.

## 1. Is it possible to deploy everything on Render for free?

**Short answer:** Mostly yes, but with some architectural adjustments for the Database and AI Model.

**Detailed Answer:**
*   🌐 **Frontend (HTML/JS/CSS):** **Yes, 100% Free.** You will host this on Render as a "Static Site" (Unlimited free hosting, extremely fast).
*   ⚙️ **Backend (Flask Python):** **Yes, Free.** Render offers a "Web Service" free tier.
*   🧠 **AI Code (TensorFlow Model):** **Proceed with Caution.** Your AI model requires `tensorflow==2.15.0`. TensorFlow usually takes **> 500 MB** of RAM just to load. **Render's free tier caps at 512 MB of RAM**. If your model is too heavy, the Render instance might crash with an "Out of Memory (OOM)" error. If this happens, you will either need to downgrade to a smaller model (like TFLite) or upgrade your Render tier.
*   🗄️ **Database (MongoDB):** **No.** Render does *not* offer free MongoDB hosting. However, you can seamlessly integrate a **MongoDB Atlas Free Tier** cluster (permanently free) with your Render backend.

---

## 2. Preparation (Local Code Changes)

I have already made the necessary code updates to your project for you:
1.  **Added `gunicorn`:** This is the production server required by Render to run your Flask application (`requirements.txt` has been updated).
2.  **Updated MongoDB Connection:** I modified `backend/app.py` to look for an environment variable named `MONGO_URI`. If it doesn't find one (i.e., when you test locally), it defaults to `mongodb://localhost:27017/`.

**CRITICAL STEP FOR FRONTEND:**
> You **must** change the API URLs in your frontend code before pushing them online. Right now they probably point to `http://localhost:5000`. You will need to change them to your deployed Render Backend URL once it is created in Step 5.

---

## Step 3: Setup your Database (MongoDB Atlas)

Since Render does not offer MongoDB, we will use the official creator of MongoDB.

1.  Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) and create an account.
2.  Deploy a new **M0 Free Cluster** (Select AWS and the region closest to you).
3.  **Database Access:** Create a database user (username and password). Save these!
4.  **Network Access:** Go to "Network Access" on the left menu, select "Add IP Address", and choose **"Allow Access from Anywhere"** (`0.0.0.0/0`). This allows Render to communicate with your database.
5.  **Get the URI:** Click "Connect" on your cluster -> "Connect your application" -> "Drivers" (Python).
6.  Copy the connection string. It will look like:
    `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
    *(Make sure to replace `<password>` with the actual password you just created).*

---

## Step 4: Push Your Code to GitHub

Render pulls your code directly from GitHub.

1.  Create a new repository on [GitHub](https://github.com/new).
2.  Push your entire `Oral Smart Screening` directory into this GitHub repository. Make sure the dataset `oral_cancer_model.h5` is pushed as well (if it is less than 100MB; otherwise you will need Git LFS).

---

## Step 5: Deploy the Backend (Python / AI)

1.  Go to [Render Dashboard](https://dashboard.render.com).
2.  Click **"New" -> "Web Service"**.
3.  Connect to your GitHub repository.
4.  Configure the settings as follows:
    *   **Name:** `oralscan-backend` (or similar)
    *   **Language:** Python
    *   **Root Directory:** `backend` *(<- This is very important!)*
    *   **Build Command:** `pip install -r requirements.txt`
    *   **Start Command:** `gunicorn app:app`
    *   **Instance Type:** Free ($0/month)
5.  Scroll down to **Environment Variables** and add:
    *   Key: `MONGO_URI`
    *   Value: *(Paste the Connection String you copied from MongoDB Atlas here)*
    *   Key: `SECRET_KEY`
    *   Value: `your-random-super-secret-key` (Any random string of letters and numbers)
6.  Click **"Create Web Service"**.

**Warning about AI Memory Limits:**
> This deployment may take around 5-10 minutes due to TensorFlow installation. If you check the "Logs" tab and see an "Out of Memory" crash or "Killed", it means the free tier's 512MB RAM cannot handle TensorFlow loading.

---

## Step 6: Connect your Frontend to the New Backend

Once your backend deploys successfully, you will get a URL like `https://oralscan-backend.onrender.com`.

1.  Open your frontend Javascript files (e.g., inside `frontend/js/`).
2.  Search and replace all instances of `http://localhost:5000` with your new backend URL: `https://oralscan-backend.onrender.com`.
3.  Save the changes and push the updated frontend code to GitHub.

---

## Step 7: Deploy the Frontend

1.  Go back to the [Render Dashboard](https://dashboard.render.com).
2.  Click **"New" -> "Static Site"**.
3.  Select the **same GitHub repository**.
4.  Configure the settings as follows:
    *   **Name:** `oralscan-app`
    *   **Root Directory:** `frontend`
    *   **Build Command:** *(Leave blank)*
    *   **Publish Directory:** `.` (Just explicitly type a single period if the UI complains).
5.  Click **"Create Static Site"**.

Your application will now be live on the URL provided by the Static Site deploy! You can access the UI publicly via this link, and it will securely communicate with your AI backend, which talks to the cloud database.
