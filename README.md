# 📸 Full-Stack Instagram Clone

A feature-rich, full-stack Instagram clone built from scratch. This project replicates the core functionality and UI of Instagram, including complex relational data handling, image processing, private accounts, and a fully realized real-time direct messaging system.

Unlike many tutorials that rely on ORMs, the backend of this project was built using **raw PostgreSQL queries** to ensure high performance and a deep understanding of database architecture.

## ✨ Key Features

### 💬 Real-Time Direct Messaging (WebSockets)
* **Instant Delivery:** Real-time messaging powered by Socket.io.
* **Live Statuses:** "Online" green dot indicators and "Active X hours ago" statuses.
* **Typing Indicators:** Live animated "User is typing..." bubbles.
* **Advanced Message Controls:** Reply to specific messages, and edit or delete messages (within a 12-hour window).
* **Smart Inbox:** Unread message badges and real-time conversation sorting.

### 🖼️ Posts & Engagement
* **Multiple Images:** Upload up to 10 images per post with a swipeable UI carousel.
* **Edit/Delete:** Update post captions after publishing or remove posts entirely.
* **Interactions:** Like posts and save/bookmark posts to a private profile tab.
* **Explore Page:** A dynamic grid of random posts from public accounts across the platform.

### 🗣️ Advanced Comments System
* **Engagement:** Add, delete, and like individual comments.
* **Creator Controls:** Post owners can "Pin" their favorite comments to the top.
* **Author Badges:** A "Liked by Author" mini-avatar badge appears when the post creator likes a comment.

### 🔒 User Profiles & Privacy
* **Custom Avatars:** Upload and crop profile pictures into perfect circles (using `react-easy-crop`).
* **Private Accounts:** Toggle account privacy. Private accounts hide posts from non-followers and convert the "Follow" button into a "Requested" state.
* **Notification Hub:** An activity feed to accept or decline incoming follow requests.
* **Trigram Search:** High-speed, typo-tolerant user searching powered by PostgreSQL `pg_trgm`.

### 📱 Stories
* **24-Hour Expiry:** Upload image stories that automatically disappear.
* **Instagram-Style Viewer:** Auto-progressing status bars, pause-on-click, and delete options.

---

## 🛠️ Tech Stack

**Frontend:**
* React.js (Vite)
* Tailwind CSS (Styling & Layout)
* React Router DOM (Navigation)
* Socket.io-client (Real-time connections)
* Lucide React (Icons)
* React-Easy-Crop (Image manipulation)

**Backend:**
* Node.js & Express.js
* Socket.io (WebSocket Server)
* JWT (JSON Web Tokens) & bcryptjs (Authentication & Security)
* Multer (Multipart/form-data for image uploads)

**Database:**
* PostgreSQL
* `pg` (Node-Postgres library for raw SQL queries - **No ORM**)

---

## 🚀 Getting Started (Local Development)

If you want to run this project locally, follow these steps:

### 1. Clone the repository
```bash
git clone [https://github.com/AbdullahNaeemRao/instagram-clone.git](https://github.com/AbdullahNaeemRao/instagram-clone.git)
cd instagram-clone
```

### 2. Set up the PostgreSQL Database
1. Open pgAdmin and create a new database.
2. Run the SQL schema files (provided in the project) to generate the tables.
3. Enable the trigram extension for search: 
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 3. Backend Setup
Create a `.env` file in the root directory with your database credentials:
```env
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database_name
JWT_SECRET=your_super_secret_jwt_key
```
Install dependencies and start the server:
```bash
npm install
node server.js
```

### 4. Frontend Setup
Open a new terminal window, navigate to the client folder, install dependencies, and start the Vite development server:
```bash
cd client
npm install
npm run dev
```

---

## 👨‍💻 Author

**Abdullah Naeem Rao**
* [GitHub](https://github.com/AbdullahNaeemRao)
