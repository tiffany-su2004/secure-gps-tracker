# 📍 Secure GPS Tracker

A full-stack project that allows **location sharing via GPS** with **secure email-based OTP verification**.  
Built with **React (frontend)** + **Express/Node.js (backend)** + **SQLite**.

---

## ✨ Features
- ✅ **Email OTP Authentication** – Users verify identity via Gmail OTP.
- ✅ **Sharer & Viewer Roles** – Sharer can share their GPS location, Viewer can fetch it.
- ✅ **GPS Tracking** – Sharer location captured from device GPS API.
- ✅ **Secure Access** – Permissions system ensures only granted viewers can see sharer’s location.
- ✅ **Interactive Map** – Locations displayed on an embedded OpenStreetMap using Leaflet.

---

## 🛠️ Tech Stack
- **Frontend**: React + Vite + Axios + Leaflet  
- **Backend**: Node.js + Express + JWT + Nodemailer  
- **Database**: SQLite (better-sqlite3)  
- **Auth**: OTP (via Gmail SMTP)


