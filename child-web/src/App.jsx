import { useState } from "react";
import axios from "axios";
import "./App.css";

// Map imports
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// Fix default marker icons (otherwise sometimes invisible in builds)
L.Icon.Default.mergeOptions({ iconUrl, shadowUrl });

const API = "http://localhost:8080";

// 🔹 Helper: one-time GPS reading
function getGPS() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      return reject(new Error("Geolocation not supported on this device/browser."));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, // meters
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// 🔹 Helper: map backend error codes → user-friendly messages
function getFriendlyError(errorCode) {
  switch (errorCode) {
    case "invalid_email_format":
      return "❌ That email looks invalid. Please check the format.";
    case "invalid_email_domain":
      return "❌ This email domain cannot receive emails.";
    case "email_required":
      return "❌ Please enter an email.";
    case "email_failed":
      return "❌ Failed to send OTP. Try again later.";
    case "no_otp_requested":
      return "⚠️ You didn’t request an OTP yet.";
    case "otp_expired":
      return "⏰ OTP expired. Please request a new one.";
    case "invalid_otp":
      return "❌ The OTP you entered is wrong.";
    case "email_and_otp_required":
      return "❌ Both email and OTP are required.";
    case "viewer_email_required":
      return "❌ You must enter a viewer email.";
    case "no_permission":
      return "⚠️ You don’t have permission to view this sharer’s location.";
    case "no_location_found":
      return "⚠️ No location available for this sharer yet.";
    default:
      return errorCode || "An error occurred.";
  }
}

export default function App() {
  // ======================================================
  // 📌 State Management
  // ======================================================
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("");       // sharer | viewer
  const [step, setStep] = useState("role");
  const [msg, setMsg] = useState("");

  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [viewerEmail, setViewerEmail] = useState("");
  const [lookupEmail, setLookupEmail] = useState("");
  const [locationResult, setLocationResult] = useState(null);

  // ======================================================
  // 📌 Step 1: Select role
  // ======================================================
  function selectRole(r) {
    setRole(r);
    setStep("email");
  }

  // ======================================================
  // 📌 Step 2: Request OTP
  // ======================================================
  async function requestOtp(e) {
    e.preventDefault();
    setMsg("");
    try {
      await axios.post(`${API}/request-otp`, { email });
      setMsg("✅ OTP sent to your email. Check inbox!");
      setStep("otp");
    } catch (err) {
      setMsg(getFriendlyError(err?.response?.data?.error));
    }
  }

  // ======================================================
  // 📌 Step 3: Verify OTP
  // ======================================================
  async function verifyOtp(e) {
    e.preventDefault();
    setMsg("");
    try {
      const { data } = await axios.post(`${API}/verify-otp`, {
        email,
        otp: code,
        role,
      });
      localStorage.setItem("jwt", data.token);
      setMsg(`✅ Verified as ${role}!`);
      setStep("dashboard");
    } catch (err) {
      setMsg(getFriendlyError(err?.response?.data?.error));
    }
  }

  // ======================================================
  // 📌 Step 4a: Sharer → Send GPS
  // ======================================================
  async function sendLocation(e) {
    e.preventDefault();
    setMsg("");
    try {
      const { lat: gLat, lng: gLng, accuracy } = await getGPS();
      setLat(String(gLat));
      setLng(String(gLng));

      const token = localStorage.getItem("jwt");
      await axios.post(
        `${API}/locations`,
        { lat: Number(gLat), lng: Number(gLng) },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMsg(`📍 Location saved! (${gLat.toFixed(5)}, ${gLng.toFixed(5)} • ±${Math.round(accuracy)}m)`);
    } catch (err) {
      const friendly =
        err?.code === 1 ? "Permission denied. Please allow location access."
        : err?.code === 2 ? "Position unavailable. Try moving near a window or enabling GPS."
        : err?.code === 3 ? "Timed out. Try again."
        : err?.message || "Error getting/sending GPS.";
      setMsg(friendly);
    }
  }

  // ======================================================
  // 📌 Step 4b: Sharer → Grant Permission
  // ======================================================
  async function grantPermission(e) {
    e.preventDefault();
    setMsg("");
    try {
      const token = localStorage.getItem("jwt");
      await axios.post(
        `${API}/permissions/grant`,
        { viewerEmail },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMsg(`✅ Permission granted to ${viewerEmail}`);
    } catch (err) {
      setMsg(getFriendlyError(err?.response?.data?.error));
    }
  }

  // ======================================================
  // 📌 Step 4c: Viewer → Lookup Location
  // ======================================================
  async function lookupLocation(e) {
    e.preventDefault();
    setMsg("");
    try {
      const token = localStorage.getItem("jwt");
      const { data } = await axios.get(`${API}/locations/${lookupEmail}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLocationResult(data);
      setMsg("📍 Location fetched!");
    } catch (err) {
      setMsg(getFriendlyError(err?.response?.data?.error));
    }
  }

  // ======================================================
  // 📌 UI
  // ======================================================
  return (
    <div className="container">
      <h2>📍 Location Tracker</h2>

      {/* Step 1: Role selection */}
      {step === "role" && (
        <div className="grid">
          <button onClick={() => selectRole("sharer")}>I am a Sharer</button>
          <button onClick={() => selectRole("viewer")}>I am a Viewer</button>
        </div>
      )}

      {/* Step 2: Email input */}
      {step === "email" && (
        <form onSubmit={requestOtp} className="grid">
          <input
            type="email"
            placeholder="Enter your Gmail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button>Request OTP</button>
        </form>
      )}

      {/* Step 3: OTP input */}
      {step === "otp" && (
        <form onSubmit={verifyOtp} className="grid">
          <div>
            OTP sent to <b>{email}</b> as <b>{role}</b>
          </div>
          <input
            type="text"
            placeholder="6-digit OTP"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <button>Verify & Save JWT</button>
        </form>
      )}

      {/* Step 4: Dashboard */}
      {step === "dashboard" && role === "sharer" && (
        <div>
          {/* Send GPS */}
          <form onSubmit={sendLocation} className="grid">
            <h3>📍 Send My Current GPS</h3>
            <button>Get GPS & Send</button>
            {(lat && lng) && (
              <div className="message">
                Last GPS: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
              </div>
            )}
          </form>

          {/* Grant permission */}
          <form onSubmit={grantPermission} className="grid">
            <h3>👤 Grant Viewer Permission</h3>
            <input
              type="email"
              placeholder="Viewer Email"
              value={viewerEmail}
              onChange={(e) => setViewerEmail(e.target.value)}
              required
            />
            <button>Grant Permission</button>
          </form>
        </div>
      )}

      {step === "dashboard" && role === "viewer" && (
        <form onSubmit={lookupLocation} className="grid">
          <h3>🔍 Lookup Sharer Location</h3>
          <input
            type="email"
            placeholder="Sharer Email"
            value={lookupEmail}
            onChange={(e) => setLookupEmail(e.target.value)}
            required
          />
          <button>Fetch Location</button>

          {locationResult && (
            <div style={{ marginTop: "15px" }}>
              <h4>📍 Latest Location of {locationResult.email}</h4>
              <MapContainer
                center={[locationResult.lat, locationResult.lng]}
                zoom={15}
                style={{
                  height: "300px",
                  width: "100%",
                  borderRadius: "8px",
                  marginTop: "10px",
                }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[locationResult.lat, locationResult.lng]}>
                  <Popup>
                    Sharer’s latest location <br />
                    Updated: {new Date(locationResult.updatedAt).toLocaleString()}
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
          )}
        </form>
      )}

      {/* Messages */}
      {msg && <div className="message">{msg}</div>}

      {/* Debug JWT */}
      <button onClick={() => alert(localStorage.getItem("jwt") || "No token yet")}>
        Show stored JWT
      </button>
    </div>
  );
}
