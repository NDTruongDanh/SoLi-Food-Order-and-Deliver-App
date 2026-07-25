# 🍔 UITFood Food Ordering Platform

UITFood is a modern, high-performance, and robust Food Ordering & Delivery platform. It provides a complete ecosystem for customers to order food, restaurants to manage their menus and operations, and administrators to oversee platform analytics and payouts.

Built as a **Monorepo** using Turborepo, it strictly adheres to scalable architectural patterns (like CQRS and Event-Driven snapshots for core domains) and utilizes a state-of-the-art technology stack.

---

## 🚀 Features

### 🏢 Restaurant Management
* **Interactive Geocoding & Mapping:** Restaurants can accurately pinpoint their delivery zones and storefront locations using interactive Leaflet maps combined with the Photon Geocoding API.
* **Media Management:** Secure, direct-to-cloud uploads for menus and restaurant cover photos using Cloudinary.
* **Order Operations:** Real-time dashboards to accept, prepare, and dispatch orders.
* **Settings & Profiles:** Comprehensive settings allowing managers to tweak opening hours, addresses, notification preferences, and cuisine tags.

### 👑 System Administration "Mission Control"
* **"God's Eye" Overview:** Real-time tracking of Platform GMV, Revenue, and live operational stats.
* **Visual Analytics:** Interactive Recharts area graphs showing daily loads and revenue trends.
* **Live Heatmaps:** See exactly where orders are happening across the city via Leaflet heatmaps.
* **Restaurant Leaderboards:** Identify top earners and operational bottlenecks (e.g., high cancellation rates).

### 🛒 Customer Ordering (Upcoming/Core)
* Browse restaurants by delivery coverage (distance checking via PostGIS/Haversine).
* Real-time push notifications via native browser Notification APIs to track order status.

---

## 🛠️ Technology Stack

### Frontend (`apps/web`)
* **Framework:** React / Vite (TypeScript)
* **Design System:** Custom "Stitch Design System" using Tailwind CSS (`oklch` color spaces, glassmorphism, fluid typography).
* **UI Components:** Shadcn UI, Base UI (headless accessibility).
* **Data Fetching:** React Query (TanStack Query) & `react-hook-form` with Zod validation.
* **Mapping & Visuals:** `react-leaflet` (Leaflet.js), `recharts` for analytics.

### Backend (`apps/api`)
* **Framework:** NestJS (TypeScript)
* **Database:** PostgreSQL managed via Drizzle ORM.
* **Architecture:** Hybrid communication. Core domains (like Ordering) use ACL snapshots for high reliability, while public APIs interface seamlessly for standard CRUD.
* **APIs:** Comprehensive REST endpoints for menus, restaurants, geocoding, and user sessions.

### Infrastructure & Tooling
* **Monorepo:** Turborepo (`pnpm` workspaces)
* **Cloud Services:** Cloudinary (Images), Photon API (Geocoding)
* **Linting/Formatting:** Prettier, ESLint

---

## 💻 Getting Started

### Prerequisites
* Node.js (v18+)
* pnpm (v8+)
* PostgreSQL running locally or via Docker

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/UITFood-food-delivery.git
   cd UITFood-food-delivery
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Environment Setup:**
   Copy the example environment files and fill in your database and Cloudinary credentials.
   ```bash
   cp .env.example .env
   ```

4. **Database Migration & Seeding:**
   ```bash
   pnpm --filter api db:push
   pnpm --filter api db:seed
   ```

5. **Run the Development Servers:**
   Start both the backend API and the frontend web app simultaneously via Turborepo:
   ```bash
   pnpm dev
   ```

   * The Web App will be available at `http://localhost:5173`
   * The API will be available at `http://localhost:3000`

---

